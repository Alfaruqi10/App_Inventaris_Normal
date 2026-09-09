const MIN_DATE_LIMIT = new Date("2026-06-01T00:00:00Z");

// ── FEATURE FLAGS FOR ANALYTICS V2 REDESIGN ──────────────────────────
const ENABLE_ANALYTICS_V2 = true;
const ENABLE_ANALYTICS_CACHE = true;
const ENABLE_ANALYTICS_AUDIT = true;
const ENABLE_ANALYTICS_ESTIMATED = true;

const ENABLE_PRODUCT_DAILY_ANALYTICS = true;
const ENABLE_NEW_ANALYTICS_ENGINE = true;
const ENABLE_MULTI_SHOP = true;
const ENABLE_AI_METADATA = false;

// ── FEATURE FLAGS FOR DEPRECATED / INACTIVE MODULES ──────────────────
const ENABLE_AI_MODULE = false;
const ENABLE_FORECAST_MODULE = false;
const ENABLE_PROMOTION_MODULE = false;

/**
 * Membangun ulang (rebuild) seluruh data analitik dari awal.
 * Mengambil data mentah dari MasterBarang, SalesLedger, dan Transaksi.
 */
function rebuildAnalytics() {
  ensureAnalyticsDatabase();
  Logger.log("[AnalyticsEngine] Memulai pembangunan ulang (rebuild) analitik...");
  
  // 1. Ambil data dasar
  const ledgerRows = readSheetObjects(SALES_LEDGER_SHEET) || [];
  const masterRows = readSheetObjects(MASTER_SHEET_NAME) || [];
  const transRows = readSheetObjects(TRANSACTION_SHEET_NAME) || [];
  
  // Filter ledger hanya setelah batas waktu 1 Juni 2026
  const filteredLedger = ledgerRows.filter(row => {
    const dStr = formatDateStr(row["Tanggal Order"]);
    if (!dStr) return false;
    const d = new Date(dStr + "T00:00:00Z");
    return d >= MIN_DATE_LIMIT;
  });

  // Map Master Barang untuk lookup Harga Beli (COGS) dan Kategori
  const masterMap = {};
  masterRows.forEach(item => {
    const sku = cleanText(item["Kode Barang"]);
    if (sku) {
      masterMap[sku] = {
        name: cleanText(item["Nama Barang"]),
        cogs: parseFloat(item["Harga Beli"]) || 0,
        stock: parseInt(item["Stok Saat Ini"]) || 0,
        category: cleanText(item["Keterangan"]) || "Umum",
        warna: cleanText(item["Warna"]) || "",
        ukuran: cleanText(item["Ukuran"]) || ""
      };
    }
  });

  // 2. Jalankan perhitungan analitik modular
  calculateDashboardAnalytics(filteredLedger, masterMap);
  calculateProductAnalytics(filteredLedger, masterMap, ledgerRows);
  calculateSalesAnalytics(filteredLedger);
  calculateInventoryAnalytics(masterRows, filteredLedger);
  calculateCustomerAnalytics(filteredLedger);
  calculateProfitAnalytics(filteredLedger, masterMap);
  calculateShippingAnalytics(filteredLedger);
  if (ENABLE_FORECAST_MODULE) {
    calculateForecastAnalytics(masterMap, filteredLedger);
  }

  // Simpan waktu terakhir pembaruan ke Script Properties
  PropertiesService.getScriptProperties().setProperty("LAST_ANALYTICS_BUILD", new Date().toISOString());
  
  Logger.log("[AnalyticsEngine] Pembangunan ulang analitik selesai.");
  return { status: "success", message: "Analitik berhasil dibangun ulang dari data transaksi." };
}

/**
 * Memperbarui analitik secara dinamis jika data kosong atau usang.
 */
function refreshAnalytics() {
  const lastBuild = PropertiesService.getScriptProperties().getProperty("LAST_ANALYTICS_BUILD");
  let needsRebuild = false;

  if (!lastBuild) {
    needsRebuild = true;
  } else {
    const lastDate = new Date(lastBuild);
    const diffHours = (new Date() - lastDate) / (1000 * 60 * 60);
    if (diffHours >= 1) { // Rebuild otomatis jika sudah > 1 jam
      needsRebuild = true;
    }
  }

  // Jika salah satu dari sheet analitik utama kosong, paksa rebuild
  if (!needsRebuild) {
    const sheetsToCheck = [
      ANALYTICS_DAILY_SHEET,
      ANALYTICS_PRODUCT_SHEET,
      ANALYTICS_SKU_SHEET,
      ANALYTICS_INVENTORY_SHEET,
      ANALYTICS_PROFIT_SHEET,
      ANALYTICS_CUSTOMER_SHEET
    ];
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (let i = 0; i < sheetsToCheck.length; i++) {
      const sheet = ss.getSheetByName(sheetsToCheck[i]);
      if (!sheet || sheet.getLastRow() <= 1) {
        needsRebuild = true;
        break;
      }
    }
  }

  if (needsRebuild) {
    return rebuildAnalytics();
  }
  return { status: "success", message: "Data analitik masih aktual." };
}

/**
 * 1. Kalkulasi Ringkasan Bisnis & KPI Harian
 */
function calculateDashboardAnalytics(ledger, masterMap) {
  ledger = getSalesLedgerLines({ rows: ledger || [], strict: false });
  const dailyGroups = {};

  // Hitung jumlah katalog aktif
  let activeCount = 0;
  let lowStockCount = 0;
  let deadCount = 0;
  Object.keys(masterMap).forEach(sku => {
    activeCount++;
    if (masterMap[sku].stock <= 5) lowStockCount++;
    if (masterMap[sku].stock === 0) deadCount++;
  });

  ledger.forEach(row => {
    const dateStr = formatDateStr(row["Tanggal Order"]);
    if (!dateStr) return;

    if (!dailyGroups[dateStr]) {
      dailyGroups[dateStr] = {
        date: dateStr,
        revenue: 0,
        netProfit: 0,
        orders: new Set(),
        deductions: 0,
        returns: 0,
        cancels: 0,
        mappedCount: 0,
        totalCount: 0
      };
    }

    const qty = parseInt(row["Qty"]) || 0;
    const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
    const cogs = masterMap[sku] ? masterMap[sku].cogs : 0;
    
    const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
    const voucher = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
    const discount = parseFloat(row["Adjustment"] || 0);
    const shopeeFee = parseFloat(row["Commission Fee"] || 0) + parseFloat(row["Transaction Fee"] || 0) + parseFloat(row["Campaign Fee"] || 0);
    const serviceFee = parseFloat(row["Service Fee"] || 0);
    
    const netProfit = revenue - (cogs * qty) - voucher - discount - shopeeFee - serviceFee;

    dailyGroups[dateStr].revenue += revenue;
    dailyGroups[dateStr].netProfit += netProfit;
    dailyGroups[dateStr].orders.add(row["Order SN"]);

    const status = String(row["Status Shopee"] || "").toUpperCase();
    if (status.indexOf("BATAL") !== -1 || status.indexOf("CANCEL") !== -1) {
      dailyGroups[dateStr].cancels++;
    } else if (status.indexOf("RETUR") !== -1 || status.indexOf("REFUND") !== -1 || status.indexOf("RETURN") !== -1) {
      dailyGroups[dateStr].returns++;
    }

    if (row["SKU Inventaris"]) dailyGroups[dateStr].mappedCount++;
    dailyGroups[dateStr].totalCount++;

    if (row["Deduction Status"] === "SUCCESS" || row["Deduction Status"] === "DEDUCTED") {
      dailyGroups[dateStr].deductions++;
    }
  });

  const newRows = Object.keys(dailyGroups).sort().map(date => {
    const g = dailyGroups[date];
    const mapRate = g.totalCount > 0 ? (g.mappedCount / g.totalCount) * 100 : 100;
    return [
      date,
      g.revenue,
      g.netProfit,
      g.orders.size,
      activeCount,
      lowStockCount,
      deadCount,
      g.deductions,
      g.returns,
      g.cancels,
      mapRate.toFixed(1) + "%",
      new Date()
    ];
  });

  writeSheetRowsIdempotent(ANALYTICS_DAILY_SHEET, ANALYTICS_DAILY_HEADERS, newRows, 11, "#1E3A8A");
}

/**
 * 2. Kalkulasi Analitik Produk & SKU
 */
function calculateProductAnalytics(ledger, masterMap, fullLedger) {
  const prodGroups = {};
  const skuGroups = {};

  // Load ShopeeOrders for precise decomposition of multi-item orders
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const soSheet = ss.getSheetByName(SHOPEE_ORDERS_SHEET);
  const soMap = {};
  if (soSheet && soSheet.getLastRow() > 1) {
    const soRows = soSheet.getDataRange().getValues();
    const soHeaders = soRows[0];
    const soCol = {};
    soHeaders.forEach((h, i) => { soCol[h] = i; });
    for (let i = 1; i < soRows.length; i++) {
      const row = soRows[i];
      const sn = String(row[soCol["order_sn"]] || "").trim();
      if (!sn) continue;
      if (!soMap[sn]) soMap[sn] = [];
      soMap[sn].push({
        itemId: String(row[soCol["item_id"]] || ""),
        modelId: String(row[soCol["model_id"]] || ""),
        prodName: String(row[soCol["product_name"]] || ""),
        varName: String(row[soCol["variation_name"]] || ""),
        qty: Number(row[soCol["qty"]] || 0),
        amount: Number(row[soCol["amount"]] || 0),
        sku: String(row[soCol["inventory_sku"]] || row[soCol["model_sku"]] || row[soCol["item_sku"]] || ""),
        shopId: String(row[soCol["shop_id"]] || "")
      });
    }
  }

  // Load Shopee Products for variant details
  const shopeeProds = readSheetObjects(SHOPEE_PRODUCTS_SHEET) || [];
  const prodVariantsMap = {};
  shopeeProds.forEach(sp => {
    const pName = cleanText(sp.nama_produk || sp.product_name);
    if (!pName) return;
    if (!prodVariantsMap[pName]) prodVariantsMap[pName] = new Set();
    if (sp.variasi || sp.variation_name) prodVariantsMap[pName].add(sp.variasi || sp.variation_name);
  });

  const now = new Date();
  const d7Limit = new Date(now.getTime() - 7 * 86400000);
  const d7PrevLimit = new Date(now.getTime() - 14 * 86400000);
  const d30Limit = new Date(now.getTime() - 30 * 86400000);
  const d30PrevLimit = new Date(now.getTime() - 60 * 86400000);
  const d90Limit = new Date(now.getTime() - 90 * 86400000);
  const d90PrevLimit = new Date(now.getTime() - 180 * 86400000);

  const varSalesMap = {}; // productName -> { varName -> qty }
  const dailyAnalyticsMap = {};
  const defaultShopId = PropertiesService.getScriptProperties().getProperty("SHOPEE_SHOP_ID") || "12345678";

  // Helper function to register dynamic groups
  const registerItem = (name, sku, qty, itemPrice, itemId, modelId, varName, shopId, orderDate, sn, status, orderEscrow, orderGrossRevenue, totalVoucherShopee, totalVoucherSeller, totalAdminFee, totalServiceFee, totalShippingFee, totalCampaignFee, totalAdjustment, totalRefund, totalOtherFee, isCompleted, isLogicalLine) => {
    if (!name) return;
    
    const orderDateTime = orderDate ? orderDate.getTime() : 0;
    const isWithinPeriod = orderDate >= MIN_DATE_LIMIT;

    const isCurr7 = orderDateTime >= d7Limit.getTime();
    const isPrev7 = orderDateTime >= d7PrevLimit.getTime() && orderDateTime < d7Limit.getTime();
    const isCurr30 = orderDateTime >= d30Limit.getTime();
    const isPrev30 = orderDateTime >= d30PrevLimit.getTime() && orderDateTime < d30Limit.getTime();
    const isCurr90 = orderDateTime >= d90Limit.getTime();
    const isPrev90 = orderDateTime >= d90PrevLimit.getTime() && orderDateTime < d90Limit.getTime();

    const items = soMap[sn] || [];
    const totalItemSubtotal = items.length > 0 ? items.reduce((sum, it) => sum + (it.qty * it.amount), 0) : (qty * itemPrice);
    // Logical lines must retain their own gross product value. Settlement is
    // deliberately not allocated to products without an official source.
    const prop = isLogicalLine ? 1 : (totalItemSubtotal > 0 ? (qty * itemPrice) / totalItemSubtotal : 1);

    const allocatedGrossRev = orderGrossRevenue * prop;
    const allocatedVoucherShopee = totalVoucherShopee * prop;
    const allocatedVoucherSeller = totalVoucherSeller * prop;
    const allocatedAdminFee = totalAdminFee * prop;
    const allocatedServiceFee = totalServiceFee * prop;
    const allocatedShippingFee = totalShippingFee * prop;
    const allocatedCampaignFee = totalCampaignFee * prop;
    const allocatedAdjustment = totalAdjustment * prop;
    const allocatedRefund = totalRefund * prop;
    const allocatedOtherFee = totalOtherFee * prop;

    const finalRevenue = (isCompleted && orderEscrow > 0) ? orderEscrow * prop : allocatedGrossRev;

    const masterItem = masterMap[sku];
    const cogs = masterItem ? masterItem.cogs : 0;
    const allocatedCogs = cogs * qty;

    const netProfit = finalRevenue - allocatedCogs - allocatedVoucherShopee - allocatedVoucherSeller - allocatedAdminFee - allocatedServiceFee - allocatedShippingFee - allocatedCampaignFee - allocatedAdjustment - allocatedRefund - allocatedOtherFee;

    if (varName) {
      if (!varSalesMap[name]) varSalesMap[name] = {};
      varSalesMap[name][varName] = (varSalesMap[name][varName] || 0) + qty;
    }

    // 1. Group Product
    if (!prodGroups[name]) {
      prodGroups[name] = {
        name, category: masterItem ? masterItem.category : "Umum", sku: sku || "", itemId: itemId || "-", parentSku: masterItem ? masterItem.parentSku || "-" : "-",
        brand: "ANSLA", photoUrl: masterItem && masterItem.photo ? masterItem.photo : "icons/logo-ansla.png", status: "Aktif",
        lifetimeOrders: new Set(), lifetimeQty: 0, lifetimeRevenue: 0, lifetimeProfit: 0,
        periodOrders: new Set(), periodQty: 0, periodRevenue: 0, periodProfit: 0,
        returns: 0, cancels: 0, 
        rev7D_curr: 0, rev7D_prev: 0, rev30D_curr: 0, rev30D_prev: 0, rev90D_curr: 0, rev90D_prev: 0,
        qty7D_curr: 0, qty7D_prev: 0, qty30D_curr: 0, qty30D_prev: 0, qty90D_curr: 0, qty90D_prev: 0,
        profit7D_curr: 0, profit7D_prev: 0, profit30D_curr: 0, profit30D_prev: 0, profit90D_curr: 0, profit90D_prev: 0,
        firstSold: orderDate, lastSold: orderDate, dailySales: {}
      };
    }
    const p = prodGroups[name];
    p.lifetimeOrders.add(sn);
    p.lifetimeQty += qty;
    p.lifetimeRevenue += finalRevenue;
    p.lifetimeProfit += netProfit;

    if (isWithinPeriod) {
      p.periodOrders.add(sn);
      p.periodQty += qty;
      p.periodRevenue += finalRevenue;
      p.periodProfit += netProfit;

      if (isCurr7) { p.rev7D_curr += finalRevenue; p.qty7D_curr += qty; p.profit7D_curr += netProfit; }
      if (isPrev7) { p.rev7D_prev += finalRevenue; p.qty7D_prev += qty; p.profit7D_prev += netProfit; }
      if (isCurr30) { p.rev30D_curr += finalRevenue; p.qty30D_curr += qty; p.profit30D_curr += netProfit; }
      if (isPrev30) { p.rev30D_prev += finalRevenue; p.qty30D_prev += qty; p.profit30D_prev += netProfit; }
      if (isCurr90) { p.rev90D_curr += finalRevenue; p.qty90D_curr += qty; p.profit90D_curr += netProfit; }
      if (isPrev90) { p.rev90D_prev += finalRevenue; p.qty90D_prev += qty; p.profit90D_prev += netProfit; }
    }

    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes("cancel") || lowerStatus.includes("batal")) p.cancels++;
    if (lowerStatus.includes("return") || lowerStatus.includes("retur") || lowerStatus.includes("refund")) p.returns++;

    if (orderDate && (!p.firstSold || orderDate < p.firstSold)) p.firstSold = orderDate;
    if (orderDate && (!p.lastSold || orderDate > p.lastSold)) p.lastSold = orderDate;

    const dStr = formatDateStr(orderDate);
    if (dStr) {
      if (!p.dailySales[dStr]) p.dailySales[dStr] = { date: dStr, shopId: shopId || "-", itemId: itemId || "-", modelId: modelId || "-", sku: sku || "-", qty: 0, revenue: 0, profit: 0, orders: new Set() };
      const ds = p.dailySales[dStr];
      ds.qty += qty;
      ds.revenue += finalRevenue;
      ds.profit += netProfit;
      ds.orders.add(sn);
      if (ds.modelId === "-" && modelId) ds.modelId = modelId;
      if (ds.itemId === "-" && itemId) ds.itemId = itemId;
    }

    // 2. Group SKU
    if (sku) {
      if (!skuGroups[sku]) {
        skuGroups[sku] = {
          sku, name, category: masterItem ? masterItem.category : "Umum", itemId: itemId || "-", parentSku: masterItem ? masterItem.parentSku || "-" : "-",
          brand: "ANSLA", photoUrl: masterItem && masterItem.photo ? masterItem.photo : "icons/logo-ansla.png", status: "Aktif",
          lifetimeOrders: new Set(), lifetimeQty: 0, lifetimeRevenue: 0, lifetimeProfit: 0,
          periodOrders: new Set(), periodQty: 0, periodRevenue: 0, periodProfit: 0,
          returns: 0, cancels: 0, 
          rev7D_curr: 0, rev7D_prev: 0, rev30D_curr: 0, rev30D_prev: 0, rev90D_curr: 0, rev90D_prev: 0,
          qty7D_curr: 0, qty7D_prev: 0, qty30D_curr: 0, qty30D_prev: 0, qty90D_curr: 0, qty90D_prev: 0,
          profit7D_curr: 0, profit7D_prev: 0, profit30D_curr: 0, profit30D_prev: 0, profit90D_curr: 0, profit90D_prev: 0,
          firstSold: orderDate, lastSold: orderDate, dailySales: {}
        };
      }
      const s = skuGroups[sku];
      s.lifetimeOrders.add(sn);
      s.lifetimeQty += qty;
      s.lifetimeRevenue += finalRevenue;
      s.lifetimeProfit += netProfit;

      if (isWithinPeriod) {
        s.periodOrders.add(sn);
        s.periodQty += qty;
        s.periodRevenue += finalRevenue;
        s.periodProfit += netProfit;

        if (isCurr7) { s.rev7D_curr += finalRevenue; s.qty7D_curr += qty; s.profit7D_curr += netProfit; }
        if (isPrev7) { s.rev7D_prev += finalRevenue; s.qty7D_prev += qty; s.profit7D_prev += netProfit; }
        if (isCurr30) { s.rev30D_curr += finalRevenue; s.qty30D_curr += qty; s.profit30D_curr += netProfit; }
        if (isPrev30) { s.rev30D_prev += finalRevenue; s.qty30D_prev += qty; s.profit30D_prev += netProfit; }
        if (isCurr90) { s.rev90D_curr += finalRevenue; s.qty90D_curr += qty; s.profit90D_curr += netProfit; }
        if (isPrev90) { s.rev90D_prev += finalRevenue; s.qty90D_prev += qty; s.profit90D_prev += netProfit; }
      }

      if (lowerStatus.includes("cancel") || lowerStatus.includes("batal")) s.cancels++;
      if (lowerStatus.includes("return") || lowerStatus.includes("retur") || lowerStatus.includes("refund")) s.returns++;

      if (orderDate && (!s.firstSold || orderDate < s.firstSold)) s.firstSold = orderDate;
      if (orderDate && (!s.lastSold || orderDate > s.lastSold)) s.lastSold = orderDate;

      if (dStr) {
        if (!s.dailySales[dStr]) s.dailySales[dStr] = { date: dStr, shopId: shopId || "-", itemId: itemId || "-", modelId: modelId || "-", sku: sku || "-", qty: 0, revenue: 0, profit: 0, orders: new Set() };
        const ds = s.dailySales[dStr];
        ds.qty += qty;
        ds.revenue += finalRevenue;
        ds.profit += netProfit;
        ds.orders.add(sn);
      }
    }
  };

  // Iterate over fullLedger (falling back to period ledger if fullLedger is missing)
  const targetLedger = getSalesLedgerLines({ rows: fullLedger || ledger || [], strict: false });
  const settlementByOrder = {};
  getSalesLedgerSettlements({ rows: targetLedger, strict: false }).forEach(function(row) {
    settlementByOrder[String(row["Order SN"] || "").trim()] = row;
  });
  targetLedger.forEach(row => {
    const sn = String(row["Order SN"] || "").trim();
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
    const dStr = formatDateStr(orderDate);
    if (!dStr) return;

    const sourceItems = soMap[sn] || [];
    const isLogicalLine = Object.prototype.hasOwnProperty.call(row, SALES_LEDGER_SETTLEMENT_OWNER_HEADER);
    const items = isLogicalLine ? [{
      itemId: String(row["Item ID"] || ""), modelId: String(row["Model ID"] || ""),
      prodName: String(row["Nama Produk"] || ""), varName: String(row["Variasi"] || ""),
      qty: Number(row["Qty"] || 0), amount: Number(row["Harga Produk"] || 0),
      sku: String(row["SKU Inventaris"] || row["SKU Shopee"] || "")
    }] : sourceItems;
    const shopId = (sourceItems[0] && sourceItems[0].shopId) || defaultShopId;
    const settlement = settlementByOrder[sn] || row;

    const registerDaily = (itemId, modelId, sku, qty, finalRevenue, netProfit) => {
      const key = `${dStr}_${shopId}_${itemId || "-"}_${modelId || "-"}`;
      if (!dailyAnalyticsMap[key]) {
        dailyAnalyticsMap[key] = {
          date: dStr,
          shopId: shopId,
          itemId: itemId || "-",
          modelId: modelId || "-",
          sku: sku || "-",
          qty: 0,
          revenue: 0,
          profit: 0,
          orders: new Set(),
          views: 0,
          clicks: 0
        };
      }
      const da = dailyAnalyticsMap[key];
      da.qty += qty;
      da.revenue += finalRevenue;
      da.profit += netProfit;
      da.orders.add(sn);
    };

    const orderGrossRevenue = parseFloat(isLogicalLine ? (row["Product Subtotal"] || row["Subtotal"]) : (row["Subtotal"] || row["Product Subtotal"])) || 0;
    const totalVoucherShopee = isLogicalLine ? 0 : (parseFloat(settlement["Shopee Voucher"]) || 0);
    const totalVoucherSeller = isLogicalLine ? 0 : (parseFloat(settlement["Seller Voucher"]) || parseFloat(settlement["Voucher Total"]) || parseFloat(settlement["Voucher"] || 0));
    const totalAdminFee = isLogicalLine ? 0 : (parseFloat(settlement["Commission Fee"]) || parseFloat(settlement["Biaya Admin"] || 0));
    const totalServiceFee = isLogicalLine ? 0 : (parseFloat(settlement["Service Fee"]) || parseFloat(settlement["Biaya Layanan"] || 0));
    const totalShippingFee = isLogicalLine ? 0 : (parseFloat(settlement["Shipping Fee Buyer"]) || parseFloat(settlement["Ongkir"] || 0));
    const totalCampaignFee = isLogicalLine ? 0 : (parseFloat(settlement["Campaign Fee"]) || 0);
    const totalAdjustment = isLogicalLine ? 0 : (parseFloat(settlement["Adjustment"]) || 0);
    const totalRefund = isLogicalLine ? 0 : (parseFloat(settlement["Refund"]) || 0);
    const totalOtherFee = isLogicalLine ? 0 : (parseFloat(settlement["Other Fee"]) || 0);
    const orderEscrow = isLogicalLine ? 0 : (parseFloat(settlement["Escrow Amount"]) || 0);
    const isCompleted = status === "COMPLETED";

    if (items.length > 0) {
      items.forEach(itm => {
        const totalItemSubtotal = items.reduce((sum, it) => sum + (it.qty * it.amount), 0);
        const prop = totalItemSubtotal > 0 ? (itm.qty * itm.amount) / totalItemSubtotal : 1;
        const finalRevenue = (isCompleted && orderEscrow > 0) ? orderEscrow * prop : (orderGrossRevenue * prop);
        const masterItem = masterMap[itm.sku];
        const cogs = masterItem ? masterItem.cogs : 0;
        const netProfit = finalRevenue - (cogs * itm.qty) - (totalVoucherShopee * prop) - (totalVoucherSeller * prop) - (totalAdminFee * prop) - (totalServiceFee * prop) - (totalShippingFee * prop) - (totalCampaignFee * prop) - (totalAdjustment * prop) - (totalRefund * prop) - (totalOtherFee * prop);

        registerItem(cleanText(itm.prodName), cleanText(itm.sku), itm.qty, itm.amount, itm.itemId, itm.modelId, cleanText(itm.varName), shopId, orderDate, sn, status, orderEscrow, orderGrossRevenue, totalVoucherShopee, totalVoucherSeller, totalAdminFee, totalServiceFee, totalShippingFee, totalCampaignFee, totalAdjustment, totalRefund, totalOtherFee, isCompleted, isLogicalLine);
        
        if (ENABLE_PRODUCT_DAILY_ANALYTICS) {
          registerDaily(itm.itemId, itm.modelId, cleanText(itm.sku), itm.qty, finalRevenue, netProfit);
        }
      });
    } else {
      const name = cleanText(row["Nama Produk"]);
      const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
      const qty = parseInt(row["Qty"]) || 0;
      const price = parseFloat(row["Harga Produk"]) || 0;
      const finalRevenue = (isCompleted && orderEscrow > 0) ? orderEscrow : orderGrossRevenue;
      const masterItem = masterMap[sku];
      const cogs = masterItem ? masterItem.cogs : 0;
      const netProfit = finalRevenue - (cogs * qty) - totalVoucherShopee - totalVoucherSeller - totalAdminFee - totalServiceFee - totalShippingFee - totalCampaignFee - totalAdjustment - totalRefund - totalOtherFee;

      registerItem(name, sku, qty, price, "", "", cleanText(row["Variasi"]), shopId, orderDate, sn, status, orderEscrow, orderGrossRevenue, totalVoucherShopee, totalVoucherSeller, totalAdminFee, totalServiceFee, totalShippingFee, totalCampaignFee, totalAdjustment, totalRefund, totalOtherFee, isCompleted, isLogicalLine);
      
      if (ENABLE_PRODUCT_DAILY_ANALYTICS) {
        registerDaily("", "", sku, qty, finalRevenue, netProfit);
      }
    }
  });

  const hashCode = function(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  };

  // Helper to generate dynamic header rows (PRD V4 Shopee Matrix Compliance)
  const buildFinalRows = (groups, headers, isSkuLevel) => {
    const list = Object.keys(groups).map(k => groups[k]);
    
    const sortedByRev = [...list].sort((a, b) => b.periodRevenue - a.periodRevenue);
    const sortedByProfit = [...list].sort((a, b) => b.periodProfit - a.periodProfit);

    const revRankMap = {};
    const profitRankMap = {};
    sortedByRev.forEach((item, index) => { revRankMap[isSkuLevel ? item.sku : item.name] = index + 1; });
    sortedByProfit.forEach((item, index) => { profitRankMap[isSkuLevel ? item.sku : item.name] = index + 1; });

    return list.map(item => {
      const key = isSkuLevel ? item.sku : item.name;
      const totalOrdersCount = item.periodOrders.size;
      const avgPrice = item.periodQty > 0 ? item.periodRevenue / item.periodQty : 0;
      const avgProfit = item.periodQty > 0 ? item.periodProfit / item.periodQty : 0;

      const masterItem = masterMap[isSkuLevel ? item.sku : item.sku];
      const stock = masterItem ? masterItem.stock : 0;
      const cogs = masterItem ? masterItem.cogs : 0;
      const incomingStock = 0;
      const reservedStock = 0; // Real allocated pending orders if available, no fake 10% formula!
      const stockStatus = masterItem ? (stock === 0 ? "Habis" : "Aktif") : "Aktif";

      let variantCount = 1;
      let activeVariantCount = 1;
      let bestVar = "-";
      let worstVar = "-";
      if (!isSkuLevel) {
        variantCount = prodVariantsMap[item.name] ? prodVariantsMap[item.name].size : 1;
        activeVariantCount = variantCount;
        
        const varSales = varSalesMap[item.name];
        if (varSales) {
          const sortedVars = Object.keys(varSales).sort((a, b) => varSales[b] - varSales[a]);
          bestVar = sortedVars[0] || "-";
          worstVar = sortedVars[sortedVars.length - 1] || "-";
        }
      }

      // Historical Growth calculations strictly from sales history
      const growth7 = item.rev7D_prev > 0 ? ((item.rev7D_curr - item.rev7D_prev) / item.rev7D_prev) * 100 : "";
      const growth30 = item.rev30D_prev > 0 ? ((item.rev30D_curr - item.rev30D_prev) / item.rev30D_prev) * 100 : "";
      const growth90 = item.rev90D_prev > 0 ? ((item.rev90D_curr - item.rev90D_prev) / item.rev90D_prev) * 100 : "";

      const daysWithoutSale = item.lastSold ? Math.round((now - item.lastSold) / 86400000) : "";

      // Construct row object mapped to headers dynamically (PRD V4 Matrix Compliance)
      const rowObj = {};
      
      // SECTION 1 — Product Identity
      rowObj["ShopID"] = item.shopId || defaultShopId;
      rowObj["ProductID"] = key;
      rowObj["SKU"] = key;
      rowObj["ItemID"] = item.itemId || "-";
      rowObj["ModelID"] = item.modelId || "-";
      rowObj["ParentSKU"] = item.parentSku || "-";
      rowObj["ProductName"] = item.name;
      rowObj["VariationName"] = item.variationName || "-";
      rowObj["ShortName"] = ""; // Manual field if unpopulated from MasterBarang
      rowObj["Brand"] = item.brand || "-";
      rowObj["Category"] = item.category || "-";
      rowObj["Status"] = stockStatus;
      rowObj["PhotoURL"] = item.photoUrl || "";

      // SECTION 2 — Shopee Metrics (Shopee Seller Centre Matrix)
      rowObj["Views"] = item.views !== undefined ? item.views : "";
      rowObj["UniqueViews"] = "";
      rowObj["PageViews"] = "";
      rowObj["Visitors"] = "";
      rowObj["Clicks"] = item.clicks !== undefined ? item.clicks : "";
      rowObj["CTR"] = (item.views > 0 && item.clicks !== undefined) ? parseFloat(((item.clicks / item.views) * 100).toFixed(2)) : "";
      rowObj["Favorites"] = item.favorite !== undefined ? item.favorite : "";
      rowObj["AddToCart"] = item.addToCart !== undefined ? item.addToCart : "";
      rowObj["Orders"] = totalOrdersCount;
      rowObj["ItemsSold"] = item.periodQty;
      rowObj["Revenue"] = item.periodRevenue;

      // SECTION 3 — Business Metrics (Internal ANSLA Financials & Stock)
      const marginPercent = item.periodRevenue > 0 ? parseFloat(((item.periodProfit / item.periodRevenue) * 100).toFixed(2)) : 0;
      rowObj["GrossRevenue"] = item.periodRevenue;
      rowObj["GrossProfit"] = item.periodRevenue - (cogs * item.periodQty);
      rowObj["NetProfit"] = item.periodProfit;
      rowObj["AverageSellingPrice"] = avgPrice;
      rowObj["AverageProfit"] = avgProfit;
      rowObj["MarginPercent"] = marginPercent;
      rowObj["CurrentStock"] = stock;
      rowObj["IncomingStock"] = incomingStock;
      rowObj["ReservedStock"] = reservedStock;
      rowObj["StockStatus"] = stockStatus;

      // SECTION 4 — Variant Metrics
      rowObj["VariantCount"] = variantCount;
      rowObj["ActiveVariantCount"] = activeVariantCount;
      rowObj["BestSellingVariant"] = bestVar;
      rowObj["WorstSellingVariant"] = worstVar;

      // SECTION 5 — Historical & Ranking Metrics
      rowObj["FirstSoldDate"] = item.firstSold ? formatDateStr(new Date(item.firstSold)) : "";
      rowObj["LastSoldDate"] = item.lastSold ? formatDateStr(new Date(item.lastSold)) : "";
      rowObj["DaysWithoutSale"] = daysWithoutSale;
      rowObj["RevenueGrowth7D"] = growth7 !== "" ? parseFloat(growth7.toFixed(2)) : "";
      rowObj["RevenueGrowth30D"] = growth30 !== "" ? parseFloat(growth30.toFixed(2)) : "";
      rowObj["RevenueGrowth90D"] = growth90 !== "" ? parseFloat(growth90.toFixed(2)) : "";
      rowObj["RevenueRank"] = revRankMap[key] || 99;
      rowObj["ProfitRank"] = profitRankMap[key] || 99;

      // SECTION 6 — Metadata
      rowObj["UpdatedAt"] = now;
      rowObj["AnalyticsVersion"] = "4.0";
      rowObj["SchemaVersion"] = "4.0";
      rowObj["FormulaVersion"] = "v4";
      rowObj["LastAnalyticsRebuild"] = now;
      rowObj["AnalyticsSource"] = "SalesLedger";

      // Map object properties to ordering in headers (Dynamic Header Mapping Rule)
      const rowArr = [];
      headers.forEach(h => {
        rowArr.push(rowObj[h] !== undefined ? rowObj[h] : "");
      });
      return rowArr;
    });
  };

  const finalProdRows = buildFinalRows(prodGroups, ANALYTICS_PRODUCT_HEADERS, false);
  const finalSkuRows = buildFinalRows(skuGroups, ANALYTICS_SKU_HEADERS, true);

  // Write Product and SKU Materialized Views
  writeSheetRowsIdempotent(ANALYTICS_PRODUCT_SHEET, ANALYTICS_PRODUCT_HEADERS, finalProdRows, 30, "#065F46");
  writeSheetRowsIdempotent(ANALYTICS_SKU_SHEET, ANALYTICS_SKU_HEADERS, finalSkuRows, 35, "#0F766E");

  // Force number formatting on TotalOrders column (index 10) to remove legacy Date formats
  const pSheet = ss.getSheetByName(ANALYTICS_PRODUCT_SHEET);
  if (pSheet && pSheet.getLastRow() > 1) {
    pSheet.getRange(2, 11, pSheet.getLastRow() - 1, 1).setNumberFormat("0");
  }
  const sSheet = ss.getSheetByName(ANALYTICS_SKU_SHEET);
  if (sSheet && sSheet.getLastRow() > 1) {
    sSheet.getRange(2, 21, sSheet.getLastRow() - 1, 1).setNumberFormat("0");
  }

  // Write ProductDailyAnalytics Fact Table (Date, ShopID, ItemID, Revenue, Orders, Qty, Views, Clicks, Favorites, AddToCart)
  if (ENABLE_PRODUCT_DAILY_ANALYTICS) {
    const dailyRows = Object.keys(dailyAnalyticsMap).map(k => {
      const da = dailyAnalyticsMap[k];
      const daObj = {
        "Date": da.date,
        "ShopID": da.shopId || defaultShopId,
        "ItemID": da.itemId || "-",
        "Revenue": da.revenue,
        "Orders": da.orders.size,
        "Qty": da.qty,
        "Views": da.views !== undefined ? da.views : "",
        "Clicks": da.clicks !== undefined ? da.clicks : "",
        "Favorites": da.favorite !== undefined ? da.favorite : "",
        "AddToCart": da.addToCart !== undefined ? da.addToCart : "",
        "FormulaVersion": "v3",
        "UpdatedAt": now
      };
      return ANALYTICS_PRODUCT_DAILY_HEADERS.map(h => daObj[h] !== undefined ? daObj[h] : "");
    });
    writeSheetRowsIdempotent(ANALYTICS_PRODUCT_DAILY_SHEET, ANALYTICS_PRODUCT_DAILY_HEADERS, dailyRows, 11, "#0D9488");
  }
}

/**
 * 3. Kalkulasi Analitik Penjualan (Jam/Hari Terlaris)
 */
function calculateSalesAnalytics(ledger) {
  // Disimpan dalam format agregat di database jika diperlukan,
  // namun RPC handleGetSalesAnalytics menghitungnya real-time dari filtered ledger.
  // Jadi kita tidak perlu menulis tabel penunjang khusus untuk sales trends.
}

/**
 * 4. Kalkulasi Analitik Persediaan (Fast/Slow/Dead classification)
 */
function calculateInventoryAnalytics(masterRows, ledger) {
  const velocityMap = {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  ledger.forEach(row => {
    const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
    const qty = parseInt(row["Qty"]) || 0;
    const date = new Date(row["Tanggal Order"]);
    if (sku && date >= thirtyDaysAgo) {
      velocityMap[sku] = (velocityMap[sku] || 0) + qty;
    }
  });

  const newRows = [];
  masterRows.forEach(item => {
    const sku = cleanText(item["Kode Barang"]);
    if (!sku) return;

    const name = cleanText(item["Nama Barang"]);
    const stock = parseInt(item["Stok Saat Ini"]) || 0;
    const velocity = velocityMap[sku] || 0;

    let classification = "Slow Moving";
    if (stock <= 5) classification = "Critical Stock";
    else if (velocity === 0) classification = "Dead Stock";
    else if (stock > 100 || (stock / (velocity / 30) > 180)) classification = "Overstock";
    else if (velocity > 15) classification = "Fast Moving";

    const coverage = velocity > 0 ? (stock / (velocity / 30)).toFixed(0) : "180"; // default 180 days jika tidak ada penjualan
    const turnover = velocity > 0 ? (velocity / stock).toFixed(2) : "0.00";

    newRows.push([
      sku,
      name,
      classification,
      stock,
      velocity,
      coverage,
      turnover,
      new Date()
    ]);
  });

  writeSheetRowsIdempotent(ANALYTICS_INVENTORY_SHEET, ANALYTICS_INVENTORY_HEADERS, newRows, 7, "#854D0E");
}

/**
 * 5. Kalkulasi Analitik Pelanggan (LTV & Frekuensi)
 */
function calculateCustomerAnalytics(ledger) {
  ledger = getSalesLedgerLines({ rows: ledger || [], strict: false });
  const custMap = {};

  ledger.forEach(row => {
    const name = cleanText(row["Buyer Name"] || row["Buyer Username"]);
    if (!name) return;

    const qty = parseInt(row["Qty"]) || 0;
    const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
    const date = new Date(row["Tanggal Order"]);

    if (!custMap[name]) {
      custMap[name] = {
        name,
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
  const newRows = Object.keys(custMap)
    .map(k => custMap[k])
    .sort((a, b) => b.revenue - a.revenue)
    .map(c => {
      const sevenDays = new Date();
      sevenDays.setDate(sevenDays.getDate() - 7);
      const isNew = c.first >= sevenDays;

      return [
        "CUST_" + String(custId++).padStart(4, "0"),
        c.name,
        isNew ? "TRUE" : "FALSE",
        c.orders.size,
        c.qty,
        c.revenue,
        c.revenue,
        c.last,
        c.orders.size.toFixed(1),
        new Date()
      ];
    });

  writeSheetRowsIdempotent(ANALYTICS_CUSTOMER_SHEET, ANALYTICS_CUSTOMER_HEADERS, newRows, 9, "#9D174D");
}

/**
 * 6. Kalkulasi Analitik Keuntungan Bulanan
 */
function calculateProfitAnalytics(ledger, masterMap) {
  ledger = getSalesLedgerLines({ rows: ledger || [], strict: false });
  const monthlyGroups = {};

  ledger.forEach(row => {
    const dateStr = formatDateStr(row["Tanggal Order"]);
    if (!dateStr) return;
    const month = dateStr.substring(0, 7); // YYYY-MM

    if (!monthlyGroups[month]) {
      monthlyGroups[month] = {
        month: month,
        revenue: 0,
        cogs: 0,
        voucher: 0,
        discount: 0,
        shopeeFee: 0,
        serviceFee: 0,
        netProfit: 0
      };
    }

    const qty = parseInt(row["Qty"]) || 0;
    const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
    const cogs = masterMap[sku] ? masterMap[sku].cogs : 0;
    const modal = cogs * qty;

    const revenue = parseFloat(row["Subtotal"] || row["Product Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
    const voucher = parseFloat(row["Seller Voucher"] || row["Voucher Total"]) || 0;
    const discount = parseFloat(row["Adjustment"] || 0);
    const shopeeFee = parseFloat(row["Commission Fee"] || 0) + parseFloat(row["Transaction Fee"] || 0) + parseFloat(row["Campaign Fee"] || 0);
    const serviceFee = parseFloat(row["Service Fee"] || 0);
    const netProfit = revenue - modal - voucher - discount - shopeeFee - serviceFee;

    monthlyGroups[month].revenue += revenue;
    monthlyGroups[month].cogs += modal;
    monthlyGroups[month].voucher += voucher;
    monthlyGroups[month].discount += discount;
    monthlyGroups[month].shopeeFee += shopeeFee;
    monthlyGroups[month].serviceFee += serviceFee;
    monthlyGroups[month].netProfit += netProfit;
  });

  const newRows = Object.keys(monthlyGroups).sort().map(m => {
    const g = monthlyGroups[m];
    const margin = g.revenue > 0 ? (g.netProfit / g.revenue) * 100 : 0;
    return [
      m,
      g.revenue,
      g.cogs,
      g.voucher,
      g.discount,
      g.shopeeFee,
      g.serviceFee,
      g.netProfit,
      margin.toFixed(1) + "%",
      new Date()
    ];
  });

  writeSheetRowsIdempotent(ANALYTICS_PROFIT_SHEET, ANALYTICS_PROFIT_HEADERS, newRows, 9, "#3730A3");
}

/**
 * 7. Kalkulasi Analitik Pengiriman
 */
function calculateShippingAnalytics(ledger) {
  // Pengiriman teragregasi dihitung real-time di RPC atau dari filtered ledger
}

/**
 * 8. Kalkulasi Prediksi Bisnis & Wawasan AI
 */
function calculateForecastAnalytics(masterMap, ledger) {
  if (!ENABLE_FORECAST_MODULE && !ENABLE_AI_MODULE) return;
  const skuVelocity = {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  ledger.forEach(row => {
    const sku = cleanText(row["SKU Inventaris"] || row["SKU Shopee"]);
    const qty = parseInt(row["Qty"]) || 0;
    const date = new Date(row["Tanggal Order"]);
    if (sku && date >= thirtyDaysAgo) {
      skuVelocity[sku] = (skuVelocity[sku] || 0) + qty;
    }
  });

  // Tulis AI Insights secara batch
  const newAiRows = [];
  let insightId = 1;
  Object.keys(masterMap).forEach(sku => {
    const item = masterMap[sku];
    const velocity = skuVelocity[sku] || 0;

    if (item.stock <= 5 && velocity > 0) {
      newAiRows.push([
        "AI_INS_" + String(insightId++).padStart(3, "0"),
        "Persediaan",
        `Stok Kritis SKU ${sku} (${item.name})`,
        `Produk ${item.name} tersisa ${item.stock} unit dengan penjualan 30 hari terakhir sebanyak ${velocity} unit.`,
        "Laju penjualan melebihi kapasitas stok saat ini.",
        `Disarankan restok minimal ${Math.max(15, velocity * 2)} unit agar terhindar dari stok habis.`,
        "High",
        new Date()
      ]);
    }

    if (item.stock > 15 && velocity === 0) {
      newAiRows.push([
        "AI_INS_" + String(insightId++).padStart(3, "0"),
        "Katalog",
        `Produk Tidak Bergerak SKU ${sku}`,
        `Stok melimpah (${item.stock} unit) namun nihil transaksi penjualan dalam 30 hari terakhir.`,
        "Kurangnya visibilitas atau harga jual kurang kompetitif.",
        "Cobalah daftarkan ke Flash Sale Shopee atau tawarkan sebagai bundling produk terlaris.",
        "Medium",
        new Date()
      ]);
    }
  });

  writeSheetRowsIdempotent(ANALYTICS_AI_SHEET, ANALYTICS_AI_HEADERS, newAiRows, 7, "#581C87");

  // Tulis Forecast secara batch
  const newForecastRows = [];
  Object.keys(masterMap).forEach(sku => {
    const item = masterMap[sku];
    const velocity = skuVelocity[sku] || 0;

    if (velocity > 0) {
      const forecastSales = Math.round(velocity * 1.15); // estimasi kenaikan demand +15%
      const forecastRev = forecastSales * (item.cogs * 1.4);
      const restock = item.stock < forecastSales ? (forecastSales - item.stock) : 0;

      newForecastRows.push([
        sku,
        "30 Hari Ke Depan",
        forecastSales,
        forecastRev,
        restock,
        "88%",
        new Date()
      ]);
    }
  });

  writeSheetRowsIdempotent(ANALYTICS_FORECAST_SHEET, ANALYTICS_FORECAST_HEADERS, newForecastRows, 6, "#1F2937");
}

/**
 * Helper: Format date object, timestamp, or string into YYYY-MM-DD.
 * Menangani berbagai tipe input tanggal secara robust.
 */
function formatDateStr(val) {
  if (!val) return null;
  let d;
  if (val instanceof Date) {
    d = val;
  } else {
    if (typeof val === 'number') {
      d = new Date(val);
    } else {
      const str = String(val).trim();
      if (!str) return null;
      // Cocokkan format DD/MM/YYYY atau DD-MM-YYYY
      const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/);
      if (dmy) {
        const day = parseInt(dmy[1], 10);
        const month = parseInt(dmy[2], 10) - 1;
        const year = parseInt(dmy[3], 10);
        const timePart = dmy[4].trim();
        if (timePart) {
          const hms = timePart.split(':');
          const hours = parseInt(hms[0] || 0, 10);
          const minutes = parseInt(hms[1] || 0, 10);
          const seconds = parseInt(hms[2] || 0, 10);
          d = new Date(year, month, day, hours, minutes, seconds);
        } else {
          d = new Date(year, month, day);
        }
      } else {
        d = new Date(str);
      }
    }
  }
  
  if (isNaN(d.getTime())) return null;
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Kompatibilitas mundur untuk pemanggilan calculateAllAnalytics.
 */
function calculateAllAnalytics() {
  return rebuildAnalytics();
}
