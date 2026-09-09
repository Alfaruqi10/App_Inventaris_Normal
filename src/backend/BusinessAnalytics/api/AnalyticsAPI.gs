// ============================================================
// BusinessAnalytics/api/AnalyticsAPI.gs — Backend RPC API
// ============================================================

/**
 * Helper: Mendapatkan tanggal order dalam format YYYY-MM-DD.
 */
function getOrderDateStr(row) {
  return formatBusinessDateStr(row["Tanggal Order"]);
}

/**
 * Normalisasi tanggal bisnis secara eksplisit ke Asia/Jakarta.
 * Date-only strings dipertahankan; timestamp berzona waktu dikonversi ke WIB.
 */
function formatBusinessDateStr(val) {
  if (val === null || val === undefined || val === "") return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Utilities.formatDate(val, "Asia/Jakarta", "yyyy-MM-dd");
  }

  if (typeof val === "number") {
    var numericDate = new Date(val);
    if (isNaN(numericDate.getTime())) return null;
    return Utilities.formatDate(numericDate, "Asia/Jakarta", "yyyy-MM-dd");
  }

  var str = String(val).trim();
  if (!str) return null;

  var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s|$)/);
  if (dmy) {
    return dmy[3] + "-" + String(parseInt(dmy[2], 10)).padStart(2, "0") +
      "-" + String(parseInt(dmy[1], 10)).padStart(2, "0");
  }

  var ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (ymd && str.length === 10) return ymd[0];

  var parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  return Utilities.formatDate(parsed, "Asia/Jakarta", "yyyy-MM-dd");
}

/**
 * Helper: Mendapatkan Stok Minimum secara dinamis dari row MasterBarang.
 */
function getMinimumStock(item) {
  const keys = Object.keys(item);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].toLowerCase();
    if (key.includes("minimum") || key.includes("stok min") || key.includes("min stock") || key.includes("min_stock")) {
      const val = parseInt(item[keys[i]]);
      if (!isNaN(val)) return val;
    }
  }
  return 5; // Fallback default
}

/**
 * Mendapatkan KPI Ringkasan Bisnis dan data grafik historis secara realtime.
 */
function formatWibDateTime(dateObj) {
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = months[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}.${minutes} WIB`;
}

function handleGetBusinessAnalyticsSummary(params, options) {
  try {
    // Audit/checker callers must be able to read current sheets without
    // triggering the normal analytics refresh writer.
    if (!options || options.skipRefresh !== true) refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());
    const deadDays = (params && params.deadDays) ? parseInt(params.deadDays) : 30;

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];
    const shopeeOrders = readSheetObjects(SHOPEE_ORDERS_SHEET) || [];
    const mappings = readSheetObjects(SHOPEE_MAPPING_SHEET) || [];

    // Map Master Barang
    const masterMap = {};
    let totalWarehouseStock = 0;
    masterRows.forEach(item => {
      const sku = cleanText(item["Kode Barang"]);
      if (sku) {
        const stockVal = parseInt(item["Stok Saat Ini"]) || 0;
        totalWarehouseStock += stockVal;
        masterMap[sku] = {
          name: cleanText(item["Nama Barang"]),
          cogs: parseFloat(item["Harga Beli"]) || 0,
          stock: stockVal,
          raw: item
        };
      }
    });

    // Cari tanggal terbaru transaksi di ledger sebagai acuan hari ini
    let maxLedgerDateStr = formatDateStr(new Date());
    if (ledger.length > 0) {
      const dates = ledger.map(r => getOrderDateStr(r)).filter(Boolean);
      if (dates.length > 0) {
        dates.sort();
        maxLedgerDateStr = dates[dates.length - 1];
      }
    }
    const todayStr = maxLedgerDateStr;
    const thisMonthStr = todayStr.substring(0, 7); // YYYY-MM
    const thisYearStr = todayStr.substring(0, 4);  // YYYY

    // 1. Hitung KPI Realtime
    let todayRev = 0, todayProfit = 0, todayOrders = 0;
    let monthRev = 0, monthProfit = 0, monthOrders = 0;
    let yearRev = 0, yearProfit = 0, yearOrders = 0;
    let periodRev = 0, periodProfit = 0, periodOrders = 0;
    let periodQty = 0; // Total Unit Terjual

    let hasMissingFeesMonth = false;
    let hasMissingFeesPeriod = false;

    // Set order sn unik per kategori untuk menghitung pesanan secara akurat
    const todayOrderSns = new Set();
    const monthOrderSns = new Set();
    const yearOrderSns = new Set();
    const periodOrderSns = new Set();

    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr) return;

      const orderSn = row["Order SN"];
      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isCompleted = status === "COMPLETED";
      
      // Filter status pesanan valid: Completed, Shipped, Perlu Dikirim, Pesanan Baru
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      
      const settlement = parseFloat(row["Escrow Amount"]) || 0;
      const qty = parseInt(row["Qty"]) || 0;
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const cogsVal = (masterMap[sku] ? masterMap[sku].cogs : 0) * qty;

      // Hitung profit
      const feeShopee = (parseFloat(row["Commission Fee"]) || 0) + (parseFloat(row["Transaction Fee"]) || 0) + (parseFloat(row["Campaign Fee"]) || 0);
      const voucherSeller = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
      const biayaAdmin = parseFloat(row["Biaya Admin"] || row["Biaya Layanan"] || 0);
      const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

      // Gunakan Escrow Amount jika selesai & settlement tersedia, jika tidak fallback ke Estimasi Pendapatan / Subtotal
      const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
      const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

      // Check if details are missing
      const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && biayaAdmin === 0);

      let orderProfit = 0;
      if (isMissingDetail) {
        orderProfit = revenueVal - cogsVal; // Fallback ke revenueVal - HPP
      } else {
        orderProfit = revenueVal - cogsVal - feeShopee - voucherSeller - biayaAdmin - ongkirSeller;
      }

      // Akumulasi Hari Ini
      if (dStr === todayStr) {
        if (isValidOrder && revenueVal > 0) {
          todayRev += revenueVal;
          todayProfit += orderProfit;
        }
        todayOrderSns.add(orderSn);
      }

      // Akumulasi Bulan Ini
      if (dStr.startsWith(thisMonthStr)) {
        if (isValidOrder && revenueVal > 0) {
          monthRev += revenueVal;
          monthProfit += orderProfit;
          if (isMissingDetail) hasMissingFeesMonth = true;
        }
        monthOrderSns.add(orderSn);
      }

      // Akumulasi Tahun Ini
      if (dStr.startsWith(thisYearStr)) {
        if (isValidOrder && revenueVal > 0) {
          yearRev += revenueVal;
          yearProfit += orderProfit;
        }
        yearOrderSns.add(orderSn);
      }

      // Akumulasi Periode Terpilih
      if (dStr >= dateFrom && dStr <= dateTo) {
        if (isValidOrder && revenueVal > 0) {
          periodRev += revenueVal;
          periodProfit += orderProfit;
          periodQty += qty;
          if (isMissingDetail) hasMissingFeesPeriod = true;
        }
        periodOrderSns.add(orderSn);
      }
    });

    todayOrders = todayOrderSns.size;
    monthOrders = monthOrderSns.size;
    yearOrders = yearOrderSns.size;
    periodOrders = periodOrderSns.size;

    // 2. Hitung Metrik Katalog (Active, Low Stock, Dead Stock)
    let activeProducts = 0;
    let lowStockProducts = 0;
    let deadProducts = 0;

    // Cari tanggal penjualan terakhir untuk dead stock
    const lastSalesDateMap = {};
    ledger.forEach(row => {
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      if (!sku) return;
      const dStr = getOrderDateStr(row);
      if (!dStr) return;
      const dateObj = new Date(dStr + "T00:00:00Z");
      if (!lastSalesDateMap[sku] || dateObj > lastSalesDateMap[sku]) {
        lastSalesDateMap[sku] = dateObj;
      }
    });

    const nowTime = new Date().getTime();
    const deadStockThresholdMs = deadDays * 24 * 60 * 60 * 1000;

    Object.keys(masterMap).forEach(sku => {
      const item = masterMap[sku];
      activeProducts++;

      const minStock = getMinimumStock(item.raw);
      if (item.stock <= minStock) {
        lowStockProducts++;
      }

      if (item.stock > 0) {
        const lastSale = lastSalesDateMap[sku];
        if (!lastSale) {
          deadProducts++;
        } else {
          const diffMs = nowTime - lastSale.getTime();
          if (diffMs > deadStockThresholdMs) {
            deadProducts++;
          }
        }
      }
    });

    // 3. Hitung Metrik Sistem & Approval
    let totalDeductions = 0;
    let totalReturns = 0;
    let totalCancels = 0;
    let syncTodayCount = 0;

    shopeeOrders.forEach(o => {
      // Ambil tanggal order shopee
      const createdTimeRaw = o["create_time"] instanceof Date ? o["create_time"] : (typeof o["create_time"] === 'number' ? new Date(o["create_time"] * 1000) : o["create_time"]);
      const dStr = formatDateStr(createdTimeRaw);
      if (!dStr) return;

      if (dStr === todayStr) {
        syncTodayCount++;
      }

      if (dStr < dateFrom || dStr > dateTo) return;

      const st = String(o["order_status"] || "").toUpperCase();
      const ded = String(o["deduction_status"] || "").toUpperCase();

      if (ded === "WAITING_APPROVAL") {
        totalDeductions++;
      }
      if (st === "TO_RETURN" || st === "RETURNED") {
        totalReturns++;
      }
      if (st === "CANCELLED" || st === "IN_CANCEL") {
        totalCancels++;
      }
    });

    // Persentase Mapping
    const totalSkuShopee = mappings.length;
    const mappedSku = mappings.filter(m => {
      const invSku = cleanText(m["inventory_sku"]);
      return invSku && invSku !== "" && invSku !== "-";
    }).length;
    const mappingRate = totalSkuShopee > 0 ? ((mappedSku / totalSkuShopee) * 100).toFixed(1) + "%" : "100%";
    const pendingMappingCount = totalSkuShopee - mappedSku;

    // Rata-rata Nilai Pesanan (Average Order Value)
    const averageOrderValue = periodOrders > 0 ? Math.round(periodRev / periodOrders) : 0;

    const kpi = {
      today: { revenue: todayRev, profit: todayProfit, orders: todayOrders },
      month: { revenue: monthRev, profit: monthProfit, orders: monthOrders, isEstimasi: hasMissingFeesMonth },
      year: { revenue: yearRev, profit: yearProfit, orders: yearOrders },
      period: { 
        revenue: periodRev, 
        profit: periodProfit, 
        orders: periodOrders, 
        isEstimasi: hasMissingFeesPeriod,
        totalQty: periodQty,
        averageOrderValue: averageOrderValue
      },
      catalog: { 
        active: activeProducts, 
        lowStock: lowStockProducts, 
        dead: deadProducts, 
        totalStock: totalWarehouseStock 
      },
      system: { 
        deductions: totalDeductions, 
        returns: totalReturns, 
        cancels: totalCancels, 
        mappingRate: mappingRate,
        pendingMapping: pendingMappingCount,
        syncToday: syncTodayCount,
        totalSku: totalSkuShopee
      }
    };

    // 4. Bangun data grafik harian (Sesuai filter terpilih, bebas ruang kosong)
    const dailyMap = {};
    const dStart = new Date(dateFrom + "T00:00:00Z");
    const dEnd = new Date(dateTo + "T23:59:59Z");
    const diffDays = Math.ceil((dEnd - dStart) / (24 * 60 * 60 * 1000));
    const isSingleDay = dateFrom === dateTo;

    if (isSingleDay) {
      // Grafik per jam untuk hari ini / kemarin
      for (let h = 0; h < 24; h++) {
        const hourStr = String(h).padStart(2, "0");
        dailyMap[hourStr] = {
          Date: dateFrom,
          FormattedDate: hourStr + ":00",
          Revenue: 0,
          NetProfit: 0,
          TotalOrders: 0
        };
      }

      ledger.forEach(row => {
        const dStr = getOrderDateStr(row);
        if (dStr === dateFrom) {
          const status = String(row["Status Shopee"] || "").toUpperCase();
          const isCompleted = status === "COMPLETED";
          const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
          
          const settlement = parseFloat(row["Escrow Amount"]) || 0;
          const qty = parseInt(row["Qty"]) || 0;
          const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
          const cogsVal = (masterMap[sku] ? masterMap[sku].cogs : 0) * qty;

          const feeShopee = (parseFloat(row["Commission Fee"]) || 0) + (parseFloat(row["Transaction Fee"]) || 0) + (parseFloat(row["Campaign Fee"]) || 0);
          const voucherSeller = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
          const biayaAdmin = parseFloat(row["Biaya Admin"] || row["Biaya Layanan"] || 0);
          const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

          const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
          const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

          const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && biayaAdmin === 0);
          const orderProfit = isMissingDetail ? (revenueVal - cogsVal) : (revenueVal - cogsVal - feeShopee - voucherSeller - biayaAdmin - ongkirSeller);

          if (isValidOrder && revenueVal > 0) {
            const tsRaw = row["Timestamp"] || row["Tanggal Order"];
            let hourKey = "00";
            if (tsRaw) {
              const tsDate = new Date(tsRaw);
              if (!isNaN(tsDate.getTime())) {
                hourKey = String(tsDate.getHours()).padStart(2, "0");
              }
            }
            if (dailyMap[hourKey]) {
              dailyMap[hourKey].Revenue += revenueVal;
              dailyMap[hourKey].NetProfit += orderProfit;
              dailyMap[hourKey].TotalOrders += 1;
            }
          }
        }
      });

    } else if (diffDays > 30) {
      // Grafik per minggu jika rentang > 30 hari
      let currentWeekStart = new Date(dStart);
      let weekIndex = 1;
      while (currentWeekStart <= dEnd) {
        const currentWeekEnd = new Date(currentWeekStart);
        currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
        if (currentWeekEnd > dEnd) {
          currentWeekEnd.setTime(dEnd.getTime());
        }
        
        const wStartStr = formatDateStr(currentWeekStart);
        const wEndStr = formatDateStr(currentWeekEnd);
        const weekKey = `W${weekIndex}_${wStartStr}`;
        const label = `${currentWeekStart.getDate()}/${currentWeekStart.getMonth()+1} - ${currentWeekEnd.getDate()}/${currentWeekEnd.getMonth()+1}`;
        
        dailyMap[weekKey] = {
          Date: wStartStr,
          FormattedDate: label,
          Revenue: 0,
          NetProfit: 0,
          TotalOrders: 0,
          weekStart: new Date(currentWeekStart),
          weekEnd: new Date(currentWeekEnd)
        };
        
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        weekIndex++;
      }

      ledger.forEach(row => {
        const dStr = getOrderDateStr(row);
        if (dStr && dStr >= dateFrom && dStr <= dateTo) {
          const rowDate = new Date(dStr + "T12:00:00Z");
          const status = String(row["Status Shopee"] || "").toUpperCase();
          const isCompleted = status === "COMPLETED";
          const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
          
          const settlement = parseFloat(row["Escrow Amount"]) || 0;
          const qty = parseInt(row["Qty"]) || 0;
          const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
          const cogsVal = (masterMap[sku] ? masterMap[sku].cogs : 0) * qty;

          const feeShopee = (parseFloat(row["Commission Fee"]) || 0) + (parseFloat(row["Transaction Fee"]) || 0) + (parseFloat(row["Campaign Fee"]) || 0);
          const voucherSeller = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
          const biayaAdmin = parseFloat(row["Biaya Admin"] || row["Biaya Layanan"] || 0);
          const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

          const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
          const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

          const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && biayaAdmin === 0);
          const orderProfit = isMissingDetail ? (revenueVal - cogsVal) : (revenueVal - cogsVal - feeShopee - voucherSeller - biayaAdmin - ongkirSeller);

          if (isValidOrder && revenueVal > 0) {
            for (const key in dailyMap) {
              const block = dailyMap[key];
              if (rowDate >= block.weekStart && rowDate <= block.weekEnd) {
                block.Revenue += revenueVal;
                block.NetProfit += orderProfit;
                block.TotalOrders += 1;
                break;
              }
            }
          }
        }
      });

      for (const key in dailyMap) {
        delete dailyMap[key].weekStart;
        delete dailyMap[key].weekEnd;
      }

    } else {
      // Grafik per hari normal
      for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
        const dStr = formatDateStr(d);
        dailyMap[dStr] = { Date: dStr, FormattedDate: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`, Revenue: 0, NetProfit: 0, TotalOrders: 0 };
      }

      ledger.forEach(row => {
        const dStr = getOrderDateStr(row);
        if (dStr && dailyMap[dStr]) {
          const status = String(row["Status Shopee"] || "").toUpperCase();
          const isCompleted = status === "COMPLETED";
          const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
          
          const settlement = parseFloat(row["Escrow Amount"]) || 0;
          const qty = parseInt(row["Qty"]) || 0;
          const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
          const cogsVal = (masterMap[sku] ? masterMap[sku].cogs : 0) * qty;

          const feeShopee = (parseFloat(row["Commission Fee"]) || 0) + (parseFloat(row["Transaction Fee"]) || 0) + (parseFloat(row["Campaign Fee"]) || 0);
          const voucherSeller = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
          const biayaAdmin = parseFloat(row["Biaya Admin"] || row["Biaya Layanan"] || 0);
          const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

          const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
          const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

          const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && biayaAdmin === 0);
          const orderProfit = isMissingDetail ? (revenueVal - cogsVal) : (revenueVal - cogsVal - feeShopee - voucherSeller - biayaAdmin - ongkirSeller);

          if (isValidOrder && revenueVal > 0) {
            dailyMap[dStr].Revenue += revenueVal;
            dailyMap[dStr].NetProfit += orderProfit;
          }
          dailyMap[dStr].TotalOrders += 1;
        }
      });
    }

    const dailyChartData = Object.keys(dailyMap).sort().map(k => dailyMap[k]);

    // 5. Bangun data grafik bulanan (12 bulan terakhir)
    const monthlyMap = {};
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);

    for (let i = 0; i < 12; i++) {
      const mDate = new Date(twelveMonthsAgo);
      mDate.setMonth(mDate.getMonth() + i);
      const mStr = formatDateStr(mDate).substring(0, 7); // YYYY-MM
      monthlyMap[mStr] = { DateOrMonth: mStr, Revenue: 0, COGS: 0, VoucherSpent: 0, DiscountSpent: 0, ShopeeFee: 0, ServiceFee: 0, NetProfit: 0, MarginPercent: "0.0%" };
    }

    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr) return;
      const mStr = dStr.substring(0, 7);

      if (monthlyMap[mStr]) {
        const status = String(row["Status Shopee"] || "").toUpperCase();
        const isCompleted = status === "COMPLETED";
        const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
        
        const settlement = parseFloat(row["Escrow Amount"]) || 0;
        const qty = parseInt(row["Qty"]) || 0;
        const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
        const cogsVal = (masterMap[sku] ? masterMap[sku].cogs : 0) * qty;

        const feeShopee = (parseFloat(row["Commission Fee"]) || 0) + (parseFloat(row["Transaction Fee"]) || 0) + (parseFloat(row["Campaign Fee"]) || 0);
        const voucherSeller = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
        const biayaAdmin = parseFloat(row["Biaya Admin"] || row["Biaya Layanan"] || 0);
        const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

        const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
        const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

        const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && biayaAdmin === 0);
        const orderProfit = isMissingDetail ? (revenueVal - cogsVal) : (revenueVal - cogsVal - feeShopee - voucherSeller - biayaAdmin - ongkirSeller);

        if (isValidOrder && revenueVal > 0) {
          monthlyMap[mStr].Revenue += revenueVal;
          monthlyMap[mStr].NetProfit += orderProfit;
          monthlyMap[mStr].COGS += cogsVal;
          monthlyMap[mStr].VoucherSpent += voucherSeller;
          monthlyMap[mStr].ShopeeFee += feeShopee;
          monthlyMap[mStr].ServiceFee += biayaAdmin;
        }
      }
    });

    const monthlyChartData = Object.keys(monthlyMap).sort().map(k => {
      const g = monthlyMap[k];
      const margin = g.Revenue > 0 ? (g.NetProfit / g.Revenue) * 100 : 0;
      g.MarginPercent = margin.toFixed(1) + "%";
      return g;
    });

    const lastBuildVal = PropertiesService.getScriptProperties().getProperty("LAST_ANALYTICS_BUILD");
    const lastUpdate = formatWibDateTime(lastBuildVal ? new Date(lastBuildVal) : new Date());

    return {
      status: "success",
      kpi: kpi,
      dailyChartData: dailyChartData,
      monthlyChartData: monthlyChartData,
      lastUpdate: lastUpdate
    };

  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}



/**
 * Mendapatkan ranking penjualan produk dan SKU berdasarkan rentang tanggal.
 */
/**
 * Mendapatkan ranking penjualan produk dan SKU berdasarkan rentang tanggal.
 * Dynamically aggregates daily metrics from ProductDailyAnalytics fact table and SalesLedger
 * for dateFrom <= orderDate <= dateTo.
 */
function handleGetProductAnalytics(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    // ── READ CATALOG BASE & FACT TABLES ─────────────────────────────
    const cachedProducts = readSheetObjects(ANALYTICS_PRODUCT_SHEET) || [];
    const cachedSkus = readSheetObjects(ANALYTICS_SKU_SHEET) || [];
    const prodDailyRows = readSheetObjects(ANALYTICS_PRODUCT_DAILY_SHEET) || [];
    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];
    const transRows = readSheetObjects(TRANSACTION_SHEET_NAME) || [];

    // Pre-aggregate SalesLedger data for [dateFrom, dateTo]
    const ledgerPeriodMap = {};
    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr || dStr < dateFrom || dStr > dateTo) return;

      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      if (!isValidOrder) return;

      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const itemID = cleanText(row["Item ID"] || row["ItemID"]);

      const qty = parseInt(row["Qty"]) || 0;
      const cogs = parseFloat(row["Harga Beli/COGS"]) || 0;
      const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
      const voucher = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
      const discount = parseFloat(row["Adjustment"] || 0);
      const shopeeFee = parseFloat(row["Commission Fee"] || 0) + parseFloat(row["Transaction Fee"] || 0) + parseFloat(row["Campaign Fee"] || 0);
      const serviceFee = parseFloat(row["Service Fee"] || 0);
      const netProfit = revenue - (cogs * qty) - voucher - discount - shopeeFee - serviceFee;

      const keys = [sku, itemID].filter(k => k && k !== "-");
      keys.forEach(k => {
        if (!ledgerPeriodMap[k]) {
          ledgerPeriodMap[k] = { revenue: 0, profit: 0, orders: new Set(), qty: 0 };
        }
        ledgerPeriodMap[k].revenue += revenue;
        ledgerPeriodMap[k].profit += netProfit;
        ledgerPeriodMap[k].qty += qty;
        if (row["Order SN"]) ledgerPeriodMap[k].orders.add(row["Order SN"]);
      });
    });

    // Map cached products back to frontend structure with dynamic period aggregation
    const productsList = cachedProducts.map(cached => {
      const stock = parseInt(cached.CurrentStock) || 0;
      const reserved = parseInt(cached.ReservedStock) || 0;
      const available = Math.max(0, stock - reserved);

      const targetItemId = cleanText(cached.ItemID);
      const targetParentSku = cleanText(cached.ParentSKU || cached.ProductID);

      let periodItemsSold = 0;
      let periodOrders = 0;
      let periodRevenue = 0;
      let periodViews = 0;
      let periodClicks = 0;
      let periodProfit = 0;

      const dailySales = {};

      // Aggregate from ProductDailyAnalytics Fact Table
      prodDailyRows.forEach(pdr => {
        const pdrItem = cleanText(pdr.ItemID);
        const pdrSku = cleanText(pdr.SKU);
        const matchItem = targetItemId && targetItemId !== "-" && pdrItem === targetItemId;
        const matchSku = targetParentSku && pdrSku === targetParentSku;

        if (matchItem || matchSku) {
          const dateKey = formatDateStr(pdr.Date);
          if (dateKey) {
            if (!dailySales[dateKey]) {
              dailySales[dateKey] = { date: dateKey, qty: 0, revenue: 0, profit: 0, orders: 0 };
            }
            const q = parseInt(pdr.Qty) || 0;
            const r = parseFloat(pdr.Revenue) || 0;
            const o = parseInt(pdr.Orders) || 0;
            dailySales[dateKey].qty += q;
            dailySales[dateKey].revenue += r;
            dailySales[dateKey].orders += o;

            if (dateKey >= dateFrom && dateKey <= dateTo) {
              periodItemsSold += q;
              periodRevenue += r;
              periodOrders += o;
              if (pdr.Views !== undefined && pdr.Views !== "") periodViews += parseInt(pdr.Views) || 0;
              if (pdr.Clicks !== undefined && pdr.Clicks !== "") periodClicks += parseInt(pdr.Clicks) || 0;
            }
          }
        }
      });

      // Cross-reference with SalesLedger for profit & fallback revenue/orders in period
      const ledgerMatch = ledgerPeriodMap[targetItemId] || ledgerPeriodMap[targetParentSku];
      if (ledgerMatch) {
        if (periodRevenue === 0) periodRevenue = ledgerMatch.revenue;
        if (periodItemsSold === 0) periodItemsSold = ledgerMatch.qty;
        if (periodOrders === 0) periodOrders = ledgerMatch.orders.size;
        periodProfit = ledgerMatch.profit;
      }

      const margin = periodRevenue > 0 ? parseFloat(((periodProfit / periodRevenue) * 100).toFixed(2)) : 0;
      const avgPrice = periodItemsSold > 0 ? parseFloat((periodRevenue / periodItemsSold).toFixed(2)) : parseFloat(cached.AverageSellingPrice) || 0;
      const avgProfit = periodItemsSold > 0 ? parseFloat((periodProfit / periodItemsSold).toFixed(2)) : parseFloat(cached.AverageProfit) || 0;
      const ctr = periodViews > 0 ? parseFloat(((periodClicks / periodViews) * 100).toFixed(2)) : (cached.CTR !== "" ? parseFloat(cached.CTR) : 0);

      return {
        ProductName: cached.ProductName,
        SKU: cached.ParentSKU || cached.ProductID || "-",
        Category: cached.Category,
        Status: cached.Status,
        Views: periodViews || (cached.Views !== "" ? parseInt(cached.Views) : ""),
        Clicks: periodClicks || (cached.Clicks !== "" ? parseInt(cached.Clicks) : ""),
        CTR: ctr,
        Orders: periodOrders,
        ItemsSold: periodItemsSold,
        Sold: periodOrders, // Alias for backward compatibility
        Qty: periodItemsSold, // Alias for backward compatibility
        Revenue: periodRevenue,
        Profit: periodProfit,
        Margin: margin,
        StockBreakdown: {
          Warehouse: stock,
          Shopee: Math.round(stock * 0.8),
          Reserved: reserved,
          Available: available
        },
        Details: {
          Photo: cached.PhotoURL || "icons/logo-ansla.png",
          Brand: cached.Brand || "ANSLA",
          ShopeeID: cached.ItemID || "-",
          Barcode: "-", 
          Price: avgPrice,
          Modal: avgPrice - avgProfit
        },
        DailySales: dailySales
      };
    });

    // Map cached SKUs with period fact aggregation
    const skusList = cachedSkus.map(cached => {
      const targetSku = cleanText(cached.SKU);
      let periodItemsSold = 0;
      let periodOrders = 0;
      let periodRevenue = 0;
      let periodProfit = 0;

      const ledgerMatch = ledgerPeriodMap[targetSku];
      if (ledgerMatch) {
        periodItemsSold = ledgerMatch.qty;
        periodOrders = ledgerMatch.orders.size;
        periodRevenue = ledgerMatch.revenue;
        periodProfit = ledgerMatch.profit;
      }

      return {
        SKU: cached.SKU,
        ProductName: cached.ProductName,
        Category: cached.Category,
        Stock: parseInt(cached.CurrentStock) || 0,
        Orders: periodOrders,
        ItemsSold: periodItemsSold,
        TotalOrders: periodOrders,
        TotalQty: periodItemsSold,
        Revenue: periodRevenue,
        Profit: periodProfit
      };
    });

    // Dynamic period sorting
    productsList.sort((a, b) => b.Revenue - a.Revenue);
    skusList.sort((a, b) => b.Revenue - a.Revenue);

    // Compute Global KPIs from period aggregated data
    const activeProducts = masterRows.filter(r => !r.Status || cleanText(r.Status) === "Aktif").length;
    const soldProducts = productsList.filter(p => p.Qty > 0).length;
    const totalRevenue = productsList.reduce((acc, p) => acc + p.Revenue, 0);
    const totalProfit = productsList.reduce((acc, p) => acc + p.Profit, 0);
    const totalViews = productsList.reduce((acc, p) => acc + (typeof p.Views === "number" ? p.Views : 0), 0);
    const totalClicks = productsList.reduce((acc, p) => acc + (typeof p.Clicks === "number" ? p.Clicks : 0), 0);
    const avgCTR = totalViews > 0 ? parseFloat(((totalClicks / totalViews) * 100).toFixed(2)) : 0;
    const avgConversion = totalClicks > 0 ? parseFloat(((productsList.reduce((acc, p) => acc + p.Sold, 0) / totalClicks) * 100).toFixed(2)) : 0;
    const deadProducts = productsList.filter(p => p.Status === "Tidak Bergerak").length;
    const lowStockProducts = productsList.filter(p => p.Status === "Stok Menipis").length;

    // restockedProducts from Transaksi within dateFrom..dateTo
    const restockedSKUs = {};
    transRows.forEach(t => {
      const dateStr = getOrderDateStr(t);
      if (dateStr >= dateFrom && dateStr <= dateTo && cleanText(t["Jenis Transaksi"]) === "Barang Masuk") {
        restockedSKUs[cleanText(t["Kode Barang"])] = true;
      }
    });
    const restockedProducts = Object.keys(restockedSKUs).length;

    // newProducts based on MasterBarang Created At within dateFrom..dateTo
    const newProducts = masterRows.filter(m => {
      const cDate = getOrderDateStr({ "Tanggal Order": m["Created At"] });
      return cDate >= dateFrom && cDate <= dateTo;
    }).length;

    // Problems list evaluated for period
    const problems = [];
    productsList.forEach(p => {
      if (p.CTR > 5 && (p.Clicks > 0 && (p.Sold / p.Clicks) < 0.02)) {
        problems.push({
          Product: p.ProductName,
          Problem: "CTR Tinggi, Konversi Rendah",
          Recommendation: "Optimasi deskripsi & harga produk atau buat voucher diskon menarik",
          Priority: "High"
        });
      }
      if (p.Status === "Tidak Bergerak" && p.StockBreakdown.Warehouse > 15) {
        problems.push({
          Product: p.ProductName,
          Problem: "Stok Menumpuk, Barang Tidak Laku",
          Recommendation: "Lakukan flash sale atau bundling cuci gudang",
          Priority: "Medium"
        });
      }
      if (p.Profit < 0) {
        problems.push({
          Product: p.ProductName,
          Problem: "Laba Negatif (Rugi)",
          Recommendation: "Periksa kembali harga HPP dan potongan marketplace",
          Priority: "Critical"
        });
      }
    });

    // Hourly and Daily Heatmap for period
    const heatmap = Array(7).fill(null).map(function() { return Array(24).fill(0); });
    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr || dStr < dateFrom || dStr > dateTo) return;

      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      if (!isValidOrder) return;

      let orderDate;
      const rawDate = row["Tanggal Order"];
      if (rawDate instanceof Date) {
        orderDate = rawDate;
      } else if (typeof rawDate === 'number') {
        orderDate = new Date((rawDate - 25569) * 86400 * 1000);
      } else {
        orderDate = new Date(rawDate);
      }
      if (!isNaN(orderDate.getTime())) {
        let day = orderDate.getDay();
        day = day === 0 ? 6 : day - 1; // Monday=0, Sunday=6
        const hour = orderDate.getHours();
        heatmap[day][hour]++;
      }
    });

    return {
      status: "success",
      products: productsList,
      skus: skusList,
      kpis: {
        activeProducts: activeProducts,
        soldProducts: soldProducts,
        totalRevenue: totalRevenue,
        totalProfit: totalProfit,
        avgCTR: avgCTR,
        avgConversion: avgConversion,
        totalViews: totalViews,
        totalClicks: totalClicks,
        deadProducts: deadProducts,
        lowStockProducts: lowStockProducts,
        newProducts: newProducts,
        restockedProducts: restockedProducts
      },
      problems: problems,
      heatmap: heatmap
    };

  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan puncak waktu penjualan (Jam dan Hari Terlaris) berdasarkan rentang tanggal.
 */
function handleGetSalesAnalytics(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    
    const hourlyOrders = Array(24).fill(0);
    const hourlyRevenue = Array(24).fill(0);
    const dailyOrders = Array(7).fill(0); 
    const dailyRevenue = Array(7).fill(0);

    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr || dStr < dateFrom || dStr > dateTo) return;

      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      if (!isValidOrder) return;

      const date = new Date(row["Tanggal Order"]);
      const hour = date.getHours();
      const day = date.getDay();

      const qty = parseInt(row["Qty"]) || 0;
      const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;

      hourlyOrders[hour]++;
      hourlyRevenue[hour] += revenue;
      dailyOrders[day]++;
      dailyRevenue[day] += revenue;
    });

    return {
      status: "success",
      hourly: { orders: hourlyOrders, revenue: hourlyRevenue },
      daily: { orders: dailyOrders, revenue: dailyRevenue }
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan klasifikasi persediaan gudang berdasarkan rentang tanggal.
 */
function handleGetInventoryAnalytics(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];

    // Hitung total hari dalam rentang tanggal
    const dFrom = new Date(dateFrom + "T00:00:00Z");
    const dTo = new Date(dateTo + "T23:59:59Z");
    const totalDays = Math.max(1, Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24)));

    const velocityMap = {};
    ledger.forEach(row => {
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const qty = parseInt(row["Qty"]) || 0;
      const dStr = getOrderDateStr(row);
      if (sku && dStr && dStr >= dateFrom && dStr <= dateTo) {
        const status = String(row["Status Shopee"] || "").toUpperCase();
        const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
        if (isValidOrder) {
          velocityMap[sku] = (velocityMap[sku] || 0) + qty;
        }
      }
    });

    const list = masterRows.map(item => {
      const sku = cleanText(item["Kode Barang"]);
      if (!sku) return null;

      const name = cleanText(item["Nama Barang"]);
      const stock = parseInt(item["Stok Saat Ini"]) || 0;
      const velocity = velocityMap[sku] || 0;
      
      const minStock = getMinimumStock(item);
      const monthlyVelocityEquiv = Math.round(velocity * (30 / totalDays));

      let classification = "Slow Moving";
      if (stock <= minStock) classification = "Critical Stock";
      else if (velocity === 0) classification = "Dead Stock";
      else if (stock > 100 || (monthlyVelocityEquiv > 0 && stock / (monthlyVelocityEquiv / 30) > 180)) classification = "Overstock";
      else if (monthlyVelocityEquiv > 15) classification = "Fast Moving";

      const coverage = monthlyVelocityEquiv > 0 ? (stock / (monthlyVelocityEquiv / 30)).toFixed(0) : "180";
      const turnover = stock > 0 ? (velocity / stock).toFixed(2) : "0.00";

      return {
        SKU: sku,
        ProductName: name,
        Classification: classification,
        StockOnHand: stock,
        MonthlyVelocity: monthlyVelocityEquiv,
        StockCoverageDays: coverage,
        TurnoverRate: turnover
      };
    }).filter(Boolean);

    return {
      status: "success",
      inventory: list
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan metrik pelanggan berdasarkan rentang tanggal.
 */
function handleGetCustomerAnalytics(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const custMap = {};

    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr || dStr < dateFrom || dStr > dateTo) return;

      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      if (!isValidOrder) return;

      const name = cleanText(row["Buyer Name"] || row["Buyer Username"]);
      if (!name) return;

      const qty = parseInt(row["Qty"]) || 0;
      const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
      const date = new Date(row["Tanggal Order"]);

      if (!custMap[name]) {
        custMap[name] = {
          name: name,
          orders: new Set(),
          qty: 0,
          revenue: 0,
          first: date,
          last: date
        };
      }

      custMap[name].orders.add(row["Order SN"]);
      custMap[name].qty += qty;
      custMap[name].revenue += revenue;
      
      if (date < custMap[name].first) custMap[name].first = date;
      if (date > custMap[name].last) custMap[name].last = date;
    });

    let custId = 1;
    const list = Object.keys(custMap)
      .map(k => {
        const c = custMap[k];
        const sevenDays = new Date();
        sevenDays.setDate(sevenDays.getDate() - 7);
        const isNew = c.first >= sevenDays;

        return {
          CustomerID: "CUST_" + String(custId++).padStart(4, "0"),
          CustomerName: c.name,
          IsNewCustomer: isNew ? "TRUE" : "FALSE",
          TotalOrders: c.orders.size,
          TotalQtySpent: c.qty,
          TotalRevenue: c.revenue,
          LifetimeValue: c.revenue,
          LastOrderDate: formatDateStr(c.last),
          Frequency: c.orders.size.toFixed(1)
        };
      })
      .sort((a, b) => b.TotalRevenue - a.TotalRevenue);

    return {
      status: "success",
      customers: list
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan margin laba bulanan berdasarkan rentang tanggal.
 */
function handleGetProfitAnalytics(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];

    const masterMap = {};
    masterRows.forEach(item => {
      const sku = cleanText(item["Kode Barang"]);
      if (sku) {
        masterMap[sku] = { cogs: parseFloat(item["Harga Beli"]) || 0 };
      }
    });

    const monthlyGroups = {};

    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (!dStr || dStr < dateFrom || dStr > dateTo) return;

      const status = String(row["Status Shopee"] || "").toUpperCase();
      const isCompleted = status === "COMPLETED";
      const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
      if (!isValidOrder) return;

      const month = dStr.substring(0, 7); // YYYY-MM

      if (!monthlyGroups[month]) {
        monthlyGroups[month] = {
          DateOrMonth: month,
          Revenue: 0,
          COGS: 0,
          VoucherSpent: 0,
          DiscountSpent: 0,
          ShopeeFee: 0,
          ServiceFee: 0,
          NetProfit: 0
        };
      }

      const qty = parseInt(row["Qty"]) || 0;
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const cogs = masterMap[sku] ? masterMap[sku].cogs : 0;
      const modal = cogs * qty;

      const feeShopee = parseFloat(row["Commission Fee"] || 0) + parseFloat(row["Transaction Fee"] || 0) + parseFloat(row["Campaign Fee"] || 0);
      const voucher = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
      const discount = parseFloat(row["Adjustment"] || 0);
      const serviceFee = parseFloat(row["Service Fee"] || row["Biaya Admin"] || row["Biaya Layanan"] || 0);
      const ongkirSeller = parseFloat(row["Shipping Subsidy Seller"] || row["Shipping Subsidy Shopee"] || 0);

      const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
      const revenueVal = (isCompleted && settlement > 0) ? settlement : estimasi;

      const isMissingDetail = (revenueVal > 0 && feeShopee === 0 && serviceFee === 0);
      const orderProfit = isMissingDetail ? (revenueVal - modal) : (revenueVal - modal - feeShopee - voucher - discount - serviceFee - ongkirSeller);

      monthlyGroups[month].Revenue += revenueVal;
      monthlyGroups[month].COGS += modal;
      monthlyGroups[month].VoucherSpent += voucher;
      monthlyGroups[month].DiscountSpent += discount;
      monthlyGroups[month].ShopeeFee += feeShopee;
      monthlyGroups[month].ServiceFee += serviceFee;
      monthlyGroups[month].NetProfit += orderProfit;
    });

    const list = Object.keys(monthlyGroups).sort().map(m => {
      const g = monthlyGroups[m];
      const margin = g.Revenue > 0 ? (g.NetProfit / g.Revenue) * 100 : 0;
      g.MarginPercent = margin.toFixed(1) + "%";
      return g;
    });

    return {
      status: "success",
      profit: list
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan analisis AI berdasarkan rentang tanggal.
 */
function handleGetAIInsights(params) {
  try {
    refreshAnalytics();

    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];

    const skuVelocity = {};
    ledger.forEach(row => {
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const qty = parseInt(row["Qty"]) || 0;
      const dStr = getOrderDateStr(row);
      if (sku && dStr && dStr >= dateFrom && dStr <= dateTo) {
        const status = String(row["Status Shopee"] || "").toUpperCase();
        const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
        if (isValidOrder) {
          skuVelocity[sku] = (skuVelocity[sku] || 0) + qty;
        }
      }
    });

    const insights = [];
    let insightId = 1;

    masterRows.forEach(item => {
      const sku = cleanText(item["Kode Barang"]);
      if (!sku) return;

      const name = cleanText(item["Nama Barang"]);
      const stock = parseInt(item["Stok Saat Ini"]) || 0;
      const velocity = skuVelocity[sku] || 0;
      const minStock = getMinimumStock(item);

      if (stock <= minStock && velocity > 0) {
        insights.push({
          InsightID: "AI_INS_" + String(insightId++).padStart(3, "0"),
          Category: "Persediaan",
          Title: `Stok Kritis SKU ${sku} (${name})`,
          Analysis: `Produk ${name} tersisa ${stock} unit dengan penjualan periode ini sebanyak ${velocity} unit.`,
          Reason: "Laju penjualan melebihi kapasitas stok saat ini.",
          Recommendation: `Disarankan segera lakukan restok minimal ${Math.max(15, velocity * 2)} unit agar menghindari stok habis.`,
          Priority: "High"
        });
      }

      if (stock > 15 && velocity === 0) {
        insights.push({
          InsightID: "AI_INS_" + String(insightId++).padStart(3, "0"),
          Category: "Katalog",
          Title: `Produk Tidak Bergerak SKU ${sku}`,
          Analysis: `Stok melimpah (${stock} unit) namun nihil transaksi penjualan dalam periode terpilih.`,
          Reason: "Kurangnya visibilitas atau harga jual kurang kompetitif.",
          Recommendation: "Cobalah daftarkan ke Flash Sale Shopee atau tawarkan sebagai paket bundling dengan produk terlaris.",
          Priority: "Medium"
        });
      }
    });

    return {
      status: "success",
      insights: insights
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan prediksi bisnis berdasarkan rentang tanggal (DEPRECATED / DISABLED).
 */
function handleGetBusinessForecast(params) {
  return {
    status: "disabled",
    message: "Modul Prediksi Bisnis telah dinonaktifkan.",
    forecast: []
  };
}

/**
 * Audit discrepancy check comparing Analytics Engine aggregations against raw sheets.
 */
function handleRunDataAuditDiscrepancy(params) {
  try {
    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
    const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];
    const mappings = readSheetObjects(SHOPEE_MAPPING_SHEET) || [];

    // 1. Raw Sheet Totals
    let rawRevenue = 0;
    let rawQty = 0;
    let rawOrders = new Set();
    let rawLowStock = 0;
    
    ledger.forEach(row => {
      const dStr = getOrderDateStr(row);
      if (dStr && dStr >= dateFrom && dStr <= dateTo) {
        const status = String(row["Status Shopee"] || "").toUpperCase();
        const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
        if (isValidOrder) {
          const settlement = parseFloat(row["Escrow Amount"]) || 0;
          const qty = parseInt(row["Qty"]) || 0;
          const estimasi = parseFloat(row["Estimasi Pendapatan"]) || parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
          const revenueVal = (status === "COMPLETED" && settlement > 0) ? settlement : estimasi;

          if (revenueVal > 0) {
            rawRevenue += revenueVal;
            rawQty += qty;
          }
          rawOrders.add(row["Order SN"]);
        }
      }
    });

    masterRows.forEach(item => {
      const stock = parseInt(item["Stok Saat Ini"]) || 0;
      const minStock = getMinimumStock(item);
      if (stock <= minStock) {
        rawLowStock++;
      }
    });

    const totalSku = mappings.length;
    const mappedSku = mappings.filter(m => {
      const invSku = cleanText(m["inventory_sku"]);
      return invSku && invSku !== "" && invSku !== "-";
    }).length;
    const rawMappingRate = totalSku > 0 ? (mappedSku / totalSku) * 100 : 100;

    // 2. Analytics Engine Totals (Direct call to handleGetBusinessAnalyticsSummary)
    const summary = handleGetBusinessAnalyticsSummary(
      { dateFrom, dateTo },
      { skipRefresh: true }
    );
    if (summary.status !== "success") {
      return { status: "error", message: "Gagal memuat ringkasan analitik: " + summary.message };
    }
    const engineKpi = summary.kpi;

    // 3. Compute Variances
    const revVariance = Math.abs(engineKpi.period.revenue - rawRevenue) / Math.max(1, rawRevenue);
    const qtyVariance = Math.abs(engineKpi.period.totalQty - rawQty) / Math.max(1, rawQty);
    const ordersVariance = Math.abs(engineKpi.period.orders - rawOrders.size) / Math.max(1, rawOrders.size);
    const lowStockVariance = Math.abs(engineKpi.catalog.lowStock - rawLowStock) / Math.max(1, rawLowStock);
    
    const engineMappingRateVal = parseFloat(engineKpi.system.mappingRate);
    const mappingVariance = Math.abs(engineMappingRateVal - rawMappingRate) / Math.max(1, rawMappingRate);

    // Threshold 0.5% (0.005)
    const limit = 0.005;
    const isDiscrepant = (revVariance > limit || qtyVariance > limit || ordersVariance > limit || lowStockVariance > limit || mappingVariance > limit);

    return {
      status: isDiscrepant ? "discrepancy" : "success",
      dateFrom: dateFrom,
      dateTo: dateTo,
      variance: {
        revenue: (revVariance * 100).toFixed(4) + "%",
        qty: (qtyVariance * 100).toFixed(4) + "%",
        orders: (ordersVariance * 100).toFixed(4) + "%",
        lowStock: (lowStockVariance * 100).toFixed(4) + "%",
        mappingRate: (mappingVariance * 100).toFixed(4) + "%"
      },
      details: {
        calculated: {
          revenue: engineKpi.period.revenue,
          qty: engineKpi.period.totalQty,
          orders: engineKpi.period.orders,
          lowStock: engineKpi.catalog.lowStock,
          mappingRate: engineKpi.system.mappingRate
        },
        rawSheet: {
          revenue: rawRevenue,
          qty: rawQty,
          orders: rawOrders.size,
          lowStock: rawLowStock,
          mappingRate: rawMappingRate.toFixed(1) + "%"
        }
      }
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}
