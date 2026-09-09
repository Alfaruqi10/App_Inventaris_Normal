// ============================================================
// ShopeeAds/api/AdsAPI.gs — Backend API Controller Handlers
// ============================================================

/**
 * Helper to robustly convert sheet Date values (Date objects, DD-MM-YYYY, YYYY-MM-DD) into ISO YYYY-MM-DD string.
 */
function parseAdsDateToISO(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (typeof Utilities !== "undefined" && typeof Utilities.formatDate === "function") {
      return Utilities.formatDate(val, "Asia/Jakarta", "yyyy-MM-dd");
    }
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, "0");
    const dd = String(val.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  const s = String(val).trim();
  if (s.match(/^\d{2}[-\/]\d{2}[-\/]\d{4}$/)) {
    const p = s.split(/[-\/]/);
    return p[2] + "-" + p[1] + "-" + p[0];
  }
  if (s.match(/^\d{4}[-\/]\d{2}[-\/]\d{2}$/)) {
    const p = s.split(/[-\/]/);
    return p[0] + "-" + p[1] + "-" + p[2];
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    if (typeof Utilities !== "undefined" && typeof Utilities.formatDate === "function") {
      return Utilities.formatDate(d, "Asia/Jakarta", "yyyy-MM-dd");
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  return s;
}

/**
 * Helper: Batch retrieves all mapping and inventory stock maps.
 * Mapped by: itemId -> { sku, stock, status }
 */
function getInventoryMappingMap() {
  const map = {};
  try {
    const mappings = readSheetObjects("Shopee_Mapping") || [];
    const stockMap = {};
    const masterRows = readSheetObjects("MasterBarang") || [];

    masterRows.forEach(row => {
      const sku = String(row["Kode Barang"] || "").trim();
      const stock = parseInt(row["Stok Saat Ini"]) || 0;
      if (sku) {
        stockMap[sku] = stock;
      }
    });

    mappings.forEach(m => {
      const itemId = String(m.item_id || "").trim();
      const sku = String(m.inventory_sku || "").trim();
      if (itemId) {
        const stock = stockMap[sku] !== undefined ? stockMap[sku] : 0;
        let status = "NORMAL";
        if (stock <= 0) status = "OUT_OF_STOCK";
        else if (stock <= 5) status = "LOW_STOCK";

        map[itemId] = {
          sku: sku,
          stock: stock,
          status: status
        };
      }
    });
  } catch (e) {
    Logger.log("[getInventoryMappingMap] Error: " + e.toString());
  }
  return map;
}

/**
 * Endpoint: Get API Capability Registry (Phase 0)
 */
function handleGetAdsCapabilityRegistry(params) {
  try {
    const registry = getAdsCapabilityRegistry();
    return {
      status: "success",
      registry: registry
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Run Diagnostic API Validation Suite (Phase 0)
 */
function handleRunAdsDiagnosticValidation(params) {
  try {
    const res = validateShopeeAdsApiEndpoints();
    return res;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Manual Sync Trigger for Ads Sync Center (Phase 1)
 */
function handleSyncShopeeAds(params) {
  try {
    const res = runAdsSyncCenter();
    return res;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: PHASE 1 — LANGKAH 1 — Read-only Forensic Preview
 */
function handlePreviewAdsDataRepair(params) {
  try {
    const res = previewAdsDataRepairPhase1();
    return { status: "success", preview: res };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: PHASE 1 — LANGKAH 2 — Timestamped Backup
 */
function handleBackupAdsDatabase(params) {
  try {
    const backups = backupAdsSheetsWithTimestamp();
    return { status: "success", backups: backups };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: PHASE 1 — LANGKAH 3 s/d 6 — Execute Purge, Historical Resync, Key Normalization & Rebuild
 */
function handleExecuteAdsDataRepairPhase1(params) {
  try {
    const res = executeAdsDataRepairPhase1();
    return res;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: PHASE 1 — LANGKAH 7 — Verification Audit
 */
function handleVerifyAdsDataRepair(params) {
  try {
    const res = verifyAdsDataRepairPhase1();
    return { status: "success", verification: res };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: PHASE 7 — Actual Mutation Controlled Historical Re-Sync
 */
function handleExecutePhase7HistoricalResync(params) {
  try {
    const res = executePhase7HistoricalResync();
    return { status: "success", executionReport: res };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}






/**
 * Endpoint: Get Ads Dashboard KPIs & Charts (Phase 1, 2 & Phase 11)
 */
function handleGetAdsDashboard(params) {
  try {
    ensureAdsDatabase();
    
    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    const balanceRows = readSheetObjects(ADS_BALANCE_SHEET) || [];
    const campaignRows = readSheetObjects(ADS_CAMPAIGN_SHEET) || [];
    const summaryRows = readSheetObjects(ADS_DAILY_SUMMARY_SHEET) || [];

    // Balance KPI
    let currentBalance = 0;
    let currency = "IDR";
    let balanceUpdatedAt = "—";
    if (balanceRows.length > 0) {
      const lastB = balanceRows[balanceRows.length - 1];
      currentBalance = parseFloat(lastB["Balance"]) || 0;
      currency = lastB["Currency"] || "IDR";
      balanceUpdatedAt = lastB["UpdatedAt"] || "—";
    }

    // Campaign Count KPIs (excluding the virtual "auto" campaign)
    let totalCampaigns = 0;
    let activeCampaigns = 0;
    let pausedCampaigns = 0;
    campaignRows.forEach(c => {
      const cId = cleanText(c["CampaignID"]);
      if (cId === "auto" || cId === "SHOP_TOTAL") return;
      totalCampaigns++;
      const st = String(c["Status"] || "").toLowerCase();
      if (st === "ongoing" || st === "active") activeCampaigns++;
      else if (st === "paused" || st === "closed" || st === "schedule") pausedCampaigns++;
    });

    // Performance Aggregations for Date Range (Sourced directly from Ads_Daily_Summary)
    let totalSpend = 0;
    let totalSales = 0;
    let totalOrders = 0;
    let totalSoldQty = 0;
    let totalClicks = 0;
    let totalImpressions = 0;

    let manualSpendDebug = 0;
    let manualSalesDebug = 0;
    let autoSpendDebug = 0;
    let autoSalesDebug = 0;
    let totalClicksDebug = 0;
    let totalImpressionsDebug = 0;

    const dailyPerformanceMap = {};

    summaryRows.forEach(r => {
      const isoDate = parseAdsDateToISO(r["Date"]);
      if (isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
        const spend = parseFloat(r["Spend"]) || 0;
        const sales = parseFloat(r["Sales"]) || 0;
        const orders = parseInt(r["Orders"]) || 0;
        const soldQty = parseInt(r["SoldQty"]) || 0;
        const clicks = parseInt(r["Clicks"]) || 0;
        const impressions = parseInt(r["Impressions"]) || 0;

        totalSpend += spend;
        totalSales += sales;
        totalOrders += orders;
        totalSoldQty += soldQty;
        totalClicks += clicks;
        totalImpressions += impressions;

        const cId = cleanText(r["CampaignID"]);
        if (cId === "auto") {
          autoSpendDebug += spend;
          autoSalesDebug += sales;
        } else {
          manualSpendDebug += spend;
          manualSalesDebug += sales;
        }
        totalClicksDebug += clicks;
        totalImpressionsDebug += impressions;

        if (!dailyPerformanceMap[isoDate]) {
          dailyPerformanceMap[isoDate] = { date: isoDate, spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0 };
        }
        dailyPerformanceMap[isoDate].spend += spend;
        dailyPerformanceMap[isoDate].sales += sales;
        dailyPerformanceMap[isoDate].orders += orders;
        dailyPerformanceMap[isoDate].soldQty += soldQty;
        dailyPerformanceMap[isoDate].clicks += clicks;
        dailyPerformanceMap[isoDate].impressions += impressions;
      }
    });

    const roas = totalSpend > 0 ? (totalSales / totalSpend).toFixed(2) : "0.00";
    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + "%" : "0.00%";
    const cpc = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(0) : 0;
    const cpm = totalImpressions > 0 ? ((totalSpend / totalImpressions) * 1000).toFixed(0) : 0;
    const acos = totalSales > 0 ? ((totalSpend / totalSales) * 100).toFixed(2) + "%" : "0.00%";

    const debugInfo = {
      campaignsFound: totalCampaigns,
      campaignsProcessed: totalCampaigns,
      manualSpend: manualSpendDebug,
      manualSales: manualSalesDebug,
      autoSpend: autoSpendDebug,
      autoSales: autoSalesDebug,
      totalSpend: totalSpend,
      totalSales: totalSales,
      totalClicks: totalClicksDebug,
      totalImpressions: totalImpressionsDebug,
      roas: roas
    };

    const chartDates = Object.keys(dailyPerformanceMap).sort();
    const chartSeries = {
      dates: chartDates,
      spend: chartDates.map(d => dailyPerformanceMap[d].spend),
      sales: chartDates.map(d => dailyPerformanceMap[d].sales),
      orders: chartDates.map(d => dailyPerformanceMap[d].orders),
      soldQty: chartDates.map(d => dailyPerformanceMap[d].soldQty),
      clicks: chartDates.map(d => dailyPerformanceMap[d].clicks),
      ctr: chartDates.map(d => dailyPerformanceMap[d].impressions > 0 ? parseFloat(((dailyPerformanceMap[d].clicks / dailyPerformanceMap[d].impressions) * 100).toFixed(2)) : 0),
      roas: chartDates.map(d => dailyPerformanceMap[d].spend > 0 ? parseFloat((dailyPerformanceMap[d].sales / dailyPerformanceMap[d].spend).toFixed(2)) : 0)
    };

    // Inventory Integration: Get Low stock or Out of stock items mapped to Ads
    const mappingMap = getInventoryMappingMap();
    const inventoryAlerts = [];
    let topSellingProducts = [];

    // Map item details and alert if low stock or out of stock
    campaignRows.forEach(c => {
      const itemId = String(c["ItemID"] || "").trim();
      const campaignName = String(c["CampaignName"] || "").trim();
      const cId = String(c["CampaignID"] || "");
      if (cId === "auto") return; // Skip virtual campaign
      if (itemId && mappingMap[itemId]) {
        const inv = mappingMap[itemId];
        if (inv.status === "LOW_STOCK" || inv.status === "OUT_OF_STOCK") {
          inventoryAlerts.push({
            campaignId: cId,
            campaignName: campaignName,
            sku: inv.sku,
            stock: inv.stock,
            status: inv.status
          });
        }
      }
    });

    // Top selling products by Ads Sales (read from Ads_Product_Daily detail table)
    const dailyRows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    const productSalesMap = {};
    dailyRows.forEach(r => {
      const itemId = String(r["ItemID"] || "").trim();
      const pName = String(r["ProductName"] || "").trim();
      const cId = String(r["CampaignID"] || "");
      if (cId === "auto") return; // Skip virtual campaign for product level stock check
      if (itemId) {
        if (!productSalesMap[itemId]) {
          productSalesMap[itemId] = { itemId: itemId, name: pName, spend: 0, sales: 0, orders: 0, soldQty: 0 };
        }
        productSalesMap[itemId].spend += parseFloat(r["Spend"]) || 0;
        productSalesMap[itemId].sales += parseFloat(r["Sales"]) || 0;
        productSalesMap[itemId].orders += parseInt(r["Orders"]) || 0;
        productSalesMap[itemId].soldQty += parseInt(r["SoldQty"]) || 0;
      }
    });

    topSellingProducts = Object.values(productSalesMap).map(p => {
      const inv = mappingMap[p.itemId] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };
      return {
        ...p,
        sku: inv.sku,
        stock: inv.stock,
        status: inv.status,
        needRestock: (inv.status === "LOW_STOCK" || inv.status === "OUT_OF_STOCK") ? "Ya" : "Tidak"
      };
    });
    // Sort by sales descending
    // Operational Metrics Context (Single Source of Truth: ShopeeOrders & SalesLedger_V2)
    // Option C: ROAS Operasional = READY_TO_SHIP + PROCESSED + SHIPPED
    const OPERATIONAL_GROUP = ["READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE"];
    const RETURN_CANCEL_GROUP = ["CANCELLED", "IN_CANCEL", "TO_RETURN", "RETURNED"];

    let opStockCount = 0;
    let opReadyToShipCount = 0;
    let opReadyToShipSales = 0;
    let opShippedCount = 0;
    let opShippedSales = 0;
    let opCompletedCount = 0;
    let opCompletedSales = 0;
    let opCancelledCount = 0;
    let opReturnedCount = 0;

    const auditReasons = [];

    try {
      const masterRows = readSheetObjects("MasterBarang") || [];
      masterRows.forEach(m => {
        opStockCount += parseNumber(m["Stok Saat Ini"] || m["Stok"] || m["stok"] || m["Stock"] || 0);
      });
    } catch(mErr) {
      auditReasons.push("MasterBarang error: " + mErr.toString());
    }

    let shopeeOrderRows = [];
    try {
      shopeeOrderRows = readSheetObjects("ShopeeOrders") || [];
      shopeeOrderRows.forEach(o => {
        const st = String(o["order_status"] || o["Status"] || o["status"] || "").toUpperCase().trim();
        const amt = parseNumber(o["amount"] || o["total_amount"] || o["TotalHarga"] || o["harga_total"] || o["Total"] || 0);
        const rawUpdateDate = o["update_time"] || o["create_time"];
        const isoUpdateDate = parseAdsDateToISO(rawUpdateDate);
        
        // Operational Pipeline (Option B: READY_TO_SHIP + PROCESSED + SHIPPED filtered by update_time)
        if (OPERATIONAL_GROUP.indexOf(st) >= 0) {
          if (!isoUpdateDate || (isoUpdateDate >= dateFrom && isoUpdateDate <= dateTo)) {
            opReadyToShipCount++;
            opReadyToShipSales += amt;
            if (st === "SHIPPED" || st === "PROCESSED") {
              opShippedCount++;
              opShippedSales += amt;
            }
          }
        } else if (st === "COMPLETED") {
          const rawCreateDate = o["create_time"] || o["update_time"];
          const isoCreateDate = parseAdsDateToISO(rawCreateDate);
          if (!isoCreateDate || (isoCreateDate >= dateFrom && isoCreateDate <= dateTo)) {
            opCompletedCount++;
            opCompletedSales += amt;
          }
        } else if (st === "CANCELLED" || st === "IN_CANCEL") {
          opCancelledCount++;
        } else if (st === "TO_RETURN" || st === "RETURNED") {
          opReturnedCount++;
        }
      });
    } catch(oErr) {
      auditReasons.push("ShopeeOrders error: " + oErr.toString());
    }

    // Financial Layer uses one settlement owner per Order SN. Never sum raw line rows.
    let salesLedgerRows = [];
    try {
      salesLedgerRows = readSheetObjects(SALES_LEDGER_SHEET) || [];
      if (salesLedgerRows.length > 0) {
        let ledgerRevenue = 0;
        let ledgerOrderSet = {};
        let settlementRows = getSalesLedgerSettlements({ rows: salesLedgerRows, strict: false });
        settlementRows.forEach(l => {
          const st = String(l["Status Shopee"] || l["Settlement Status"] || l["Status"] || "").toUpperCase().trim();
          const amt = parseNumber(l["Total Dibayar"] || l["Escrow Amount"] || 0);
          const rawDate = l["Tanggal Order"] || l["Tanggal Update"] || l["create_time"] || l["Sync Time"];
          const isoDate = parseAdsDateToISO(rawDate);

          if (st === "COMPLETED" || st === "SETTLED" || st === "") {
            // Apply date range filter to one settlement per order.
            if (!isoDate || (isoDate >= dateFrom && isoDate <= dateTo)) {
              ledgerOrderSet[String(l["Order SN"] || "").trim()] = true;
              ledgerRevenue += amt;
            }
          }
        });
        
        // If SalesLedger_V2 has date-filtered records, use them for ROAS Final
        opCompletedSales = ledgerRevenue;
        opCompletedCount = Object.keys(ledgerOrderSet).length;
      }
    } catch(lErr) {
      auditReasons.push("SalesLedger settlement error: " + lErr.toString());
    }

    // Reason Diagnostic logging
    if (opReadyToShipCount === 0) {
      auditReasons.push("OPERATIONAL_ORDERS = 0. Reason: tidak ada baris status READY_TO_SHIP, PROCESSED, atau SHIPPED di sheet ShopeeOrders (" + shopeeOrderRows.length + " total baris).");
    }
    if (opCompletedCount === 0) {
      auditReasons.push("COMPLETED = 0. Reason: tidak ada baris status COMPLETED / SETTLED di ShopeeOrders maupun SalesLedger_V2 untuk periode " + dateFrom + " s/d " + dateTo + ".");
    }

    const auditDiagnostics = {
      shopeeOrdersTotal: shopeeOrderRows.length,
      salesLedgerTotal: salesLedgerRows.length,
      readyToShipFound: opReadyToShipCount,
      completedFound: opCompletedCount,
      reasons: auditReasons
    };

    return {
      status: "success",
      dateFrom: dateFrom,
      dateTo: dateTo,
      kpis: {
        balance: currentBalance,
        currency: currency,
        balanceUpdatedAt: balanceUpdatedAt,
        totalCampaigns: totalCampaigns,
        activeCampaigns: activeCampaigns,
        pausedCampaigns: pausedCampaigns,
        totalSpend: totalSpend,
        totalSales: totalSales,
        totalOrders: totalOrders,
        totalSoldQty: totalSoldQty,
        totalClicks: totalClicks,
        totalImpressions: totalImpressions,
        roas: roas,
        ctr: ctr,
        cpc: cpc,
        cpm: cpm,
        acos: acos
      },
      opKpis: {
        totalStock: opStockCount,
        readyToShip: opReadyToShipCount,
        readyToShipSales: opReadyToShipSales,
        shipped: opShippedCount,
        shippedSales: opShippedSales,
        completed: opCompletedCount,
        completedSales: opCompletedSales
      },
      auditDiagnostics: auditDiagnostics,
      chartSeries: chartSeries,
      inventoryAlerts: inventoryAlerts,
      topSellingProducts: topSellingProducts.slice(0, 5), // top 5 only
      debugInfo: debugInfo
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Get Campaign Management List with Stock Integration (Phase 3 & Phase 11)
 */
function handleGetAdsCampaigns(params) {
  try {
    ensureAdsDatabase();
    const campaignRows = readSheetObjects(ADS_CAMPAIGN_SHEET) || [];
    const dailyRows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    const mappingMap = getInventoryMappingMap();

    const search = (params && params.search) ? cleanText(params.search).toLowerCase() : "";
    const statusFilter = (params && params.status) ? cleanText(params.status).toUpperCase() : "";
    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());

    // Calculate aggregated metrics per campaign inside selected date range
    const metricsMap = {};
    dailyRows.forEach(r => {
      const cId = cleanText(r["CampaignID"]);
      const isoDate = parseAdsDateToISO(r["Date"]);
      if (cId && isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
        if (!metricsMap[cId]) {
          metricsMap[cId] = { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
        }
        metricsMap[cId].spend += parseFloat(r["Spend"]) || 0;
        metricsMap[cId].sales += parseFloat(r["Sales"]) || 0;
        metricsMap[cId].orders += parseInt(r["Orders"]) || 0;
        metricsMap[cId].clicks += parseInt(r["Clicks"]) || 0;
        metricsMap[cId].impressions += parseInt(r["Impressions"]) || 0;
      }
    });

    const campaigns = campaignRows.map(c => {
      const cId = cleanText(c["CampaignID"]);
      const name = cleanText(c["CampaignName"]) || ("Iklan #" + cId);
      const status = cleanText(c["Status"]) || "unknown";
      const budget = parseFloat(c["Budget"]) || 0;
      const budgetType = cleanText(c["BudgetType"]) || "DAILY";
      const itemIdsStr = cleanText(c["ItemID"] || "");
      const firstItemId = itemIdsStr.split(",")[0] || "";

      const m = metricsMap[cId] || { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };

      const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(2) + "%" : "0.00%";
      const cpc = m.clicks > 0 ? (m.spend / m.clicks).toFixed(0) : 0;
      const roas = m.spend > 0 ? (m.sales / m.spend).toFixed(2) : "0.00";

      // Inventory integration
      const inv = mappingMap[firstItemId] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };

      return {
        ShopID: cleanText(c["ShopID"]) || "0",
        CampaignID: cId,
        CampaignName: name,
        CampaignType: cleanText(c["CampaignType"]) || "SEARCH_AD",
        ItemID: itemIdsStr,
        Status: status,
        Budget: budget,
        BudgetType: budgetType,
        Spend: m.spend,
        Sales: m.sales,
        Orders: m.orders,
        Clicks: m.clicks,
        Impressions: m.impressions,
        CTR: ctr,
        CPC: cpc,
        ROAS: roas,
        InventorySKU: inv.sku,
        Stock: inv.stock,
        StockStatus: inv.status,
        CreatedTime: c["CreatedAt"] || "—",
        UpdatedTime: c["UpdatedAt"] || "—"
      };
    }).filter(c => {
      if (search && !c.CampaignName.toLowerCase().includes(search) && !c.CampaignID.toLowerCase().includes(search)) return false;
      if (statusFilter && statusFilter !== "ALL") {
        const cStatus = c.Status.toUpperCase();
        if (statusFilter === "ONGOING" && cStatus !== "ONGOING" && cStatus !== "ACTIVE") return false;
        if (statusFilter === "PAUSED" && cStatus !== "PAUSED" && cStatus !== "CLOSED") return false;
      }
      return true;
    });

    return {
      status: "success",
      campaigns: campaigns
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Get Product Ads Performance Table (Phase 4 & Phase 11)
 */
function handleGetAdsProductPerformance(params) {
  try {
    ensureAdsDatabase();
    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());
    const sortBy = (params && params.sortBy) ? params.sortBy : "roas";
    const campaignFilter = (params && params.campaign) ? cleanText(params.campaign) : "";
    const productFilter = (params && params.product) ? cleanText(params.product).toLowerCase() : "";
    const statusFilter = (params && params.status) ? cleanText(params.status).toUpperCase() : "";

    const dailyRows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    const campaignRows = readSheetObjects(ADS_CAMPAIGN_SHEET) || [];
    
    // Build campaign settings status map
    const campaignStatusMap = {};
    campaignRows.forEach(c => {
      campaignStatusMap[cleanText(c["CampaignID"])] = cleanText(c["Status"]) || "unknown";
    });

    const mappingMap = getInventoryMappingMap();
    const itemMap = {};

    dailyRows.forEach(r => {
      const isoDate = parseAdsDateToISO(r["ReportDate"] || r["Date"]);
      if (isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
        const itemId = cleanText(r["ItemID"]);
        const cId = cleanText(r["CampaignID"]);
        const pName = cleanText(r["NamaProduk"] || r["ProductName"]) || "Produk Iklan #" + itemId;

        // Filters mapping
        if (campaignFilter && cId !== campaignFilter) return;
        if (productFilter && !pName.toLowerCase().includes(productFilter) && !itemId.includes(productFilter)) return;
        
        const cStatus = campaignStatusMap[cId] || "unknown";
        if (statusFilter && statusFilter !== "ALL") {
          const uStatus = cStatus.toUpperCase();
          if (statusFilter === "ONGOING" && uStatus !== "ONGOING" && uStatus !== "ACTIVE") return false;
          if (statusFilter === "PAUSED" && uStatus !== "PAUSED" && uStatus !== "CLOSED") return false;
        }

        const key = cId + "_" + itemId;
        if (!itemMap[key]) {
          itemMap[key] = {
            ShopID: cleanText(r["ShopID"]) || "0",
            CampaignID: cId,
            ItemID: itemId,
            ProductName: pName,
            Spend: 0,
            Sales: 0,
            Orders: 0,
            SoldQty: 0,
            Clicks: 0,
            Impressions: 0
          };
        }

        itemMap[key].Spend += parseFloat(r["Spend"]) || 0;
        itemMap[key].Sales += parseFloat(r["Sales"]) || 0;
        itemMap[key].Orders += parseInt(r["Orders"]) || 0;
        itemMap[key].SoldQty += parseInt(r["SoldQty"]) || 0;
        itemMap[key].Clicks += parseInt(r["Clicks"]) || 0;
        itemMap[key].Impressions += parseInt(r["Impressions"]) || 0;
      }
    });

    const products = Object.values(itemMap).map(item => {
      const ctr = item.Impressions > 0 ? ((item.Clicks / item.Impressions) * 100).toFixed(2) + "%" : "0.00%";
      const cpc = item.Clicks > 0 ? (item.Spend / item.Clicks).toFixed(0) : 0;
      const roas = item.Spend > 0 ? (item.Sales / item.Spend).toFixed(2) : "0.00";

      // Inventory & mapping mapping
      const inv = mappingMap[item.ItemID] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };
      const status = campaignStatusMap[item.CampaignID] || "unknown";

      return {
        ...item,
        CTR: ctr,
        CPC: cpc,
        ROAS: parseFloat(roas),
        InventorySKU: inv.sku,
        Stock: inv.stock,
        StockStatus: inv.status,
        Status: status
      };
    });

    // Dynamic Sorting
    products.sort((a, b) => {
      if (sortBy === "spend") return b.Spend - a.Spend;
      if (sortBy === "sales") return b.Sales - a.Sales;
      if (sortBy === "orders") return b.Orders - a.Orders;
      if (sortBy === "soldQty") return b.SoldQty - a.SoldQty;
      if (sortBy === "clicks") return b.Clicks - a.Clicks;
      if (sortBy === "ctr") return parseFloat(b.CTR) - parseFloat(a.CTR);
      return b.ROAS - a.ROAS;
    });

    return {
      status: "success",
      dateFrom: dateFrom,
      dateTo: dateTo,
      products: products
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Helper: Robustly converts any ReportDate format (Date object, dd/MM/yyyy, yyyy-MM-dd) to ISO YYYY-MM-DD string.
 */
function parseReportDateToISO(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (typeof Utilities !== "undefined" && typeof Utilities.formatDate === "function") {
      return Utilities.formatDate(val, "Asia/Jakarta", "yyyy-MM-dd");
    }
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, "0");
    const dd = String(val.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  const s = String(val).trim();
  if (!s) return "";
  
  // Format dd/MM/yyyy or dd-MM-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return yyyy + "-" + mm + "-" + dd;
  }
  
  // Format yyyy-MM-dd or yyyy/MM/dd
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2].padStart(2, "0");
    const dd = m[3].padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    if (typeof Utilities !== "undefined" && typeof Utilities.formatDate === "function") {
      return Utilities.formatDate(d, "Asia/Jakarta", "yyyy-MM-dd");
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  return "";
}

/**
 * Endpoint: Get Performa Iklan — Paged, Filtered, Sorted (SSOT from Ads_Report)
 * Supports server-side pagination, search, filter, timing logs, and KPI aggregation.
 */
function handleGetAdsPerformancePaged(params) {
  const tStart = new Date().getTime();
  try {
    const page = parseInt((params && params.page) || 1);
    const limit = parseInt((params && params.limit) || 25);
    const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
    const dateTo = (params && params.dateTo) ? params.dateTo : formatDateStr(new Date());
    const sortBy = (params && params.sortBy) ? params.sortBy : "date";
    const search = (params && params.search) ? cleanText(params.search).toLowerCase() : "";
    const jenisFilter = (params && params.jenisIklan) ? cleanText(params.jenisIklan) : "";
    const statusFilter = (params && params.status) ? cleanText(params.status).toUpperCase() : "";
    const showEmpty = (params && params.showEmpty) ? (params.showEmpty === true || params.showEmpty === "true" || params.showEmpty === "ALL") : false;

    // Convert ISO dateFrom/dateTo to comparable format
    const isoFrom = parseAdsDateToISO(dateFrom);
    const isoTo = parseAdsDateToISO(dateTo);

    Logger.log("[AdsPerfQuery] Start Query | Period: " + isoFrom + " to " + isoTo + " | Page: " + page);

    let reportRows = readSheetObjects(ADS_REPORT_SHEET) || [];
    
    // Auto-population fallback: If Ads_Report is empty, attempt 1-time rebuild from existing Ads_Product_Daily
    if (reportRows.length === 0) {
      Logger.log("[AdsPerfQuery] Ads_Report sheet is empty. Triggering quick local rebuild...");
      if (typeof rebuildAdsReport === "function") {
        rebuildAdsReport();
        reportRows = readSheetObjects(ADS_REPORT_SHEET) || [];
      }
    }

    const tRead = new Date().getTime();
    Logger.log("[AdsPerfQuery] Finish Read Sheet | Duration: " + (tRead - tStart) + " ms | Total Rows Read: " + reportRows.length);

    // Filter rows
    let filtered = reportRows.filter(function(r) {
      // Robust Date Filter: Parse ReportDate (Date object, dd/MM/yyyy, yyyy-MM-dd)
      var rdRaw = r["ReportDate"] || r["Tanggal"] || "";
      var rdIso = parseReportDateToISO(rdRaw);
      
      if (isoFrom && rdIso && rdIso < isoFrom) return false;
      if (isoTo && rdIso && rdIso > isoTo) return false;

      var spend = parseFloat(r["Spend"]) || 0;
      var sales = parseFloat(r["Sales"]) || 0;
      var clicks = parseInt(r["Clicks"]) || 0;
      var impressions = parseInt(r["Impressions"]) || 0;

      // Default optimization: Exclude zero-activity rows unless showEmpty is true
      if (!showEmpty && spend === 0 && sales === 0 && clicks === 0 && impressions === 0) {
        return false;
      }

      // Search filter
      if (search) {
        var nama = cleanText(r["NamaProduk"] || "").toLowerCase();
        var cName = cleanText(r["CampaignName"] || "").toLowerCase();
        var itemId = cleanText(r["ItemID"] || "").toLowerCase();
        if (!nama.includes(search) && !cName.includes(search) && !itemId.includes(search)) return false;
      }

      // JenisIklan filter
      if (jenisFilter && jenisFilter !== "ALL") {
        var jenis = cleanText(r["JenisIklan"] || "");
        if (jenis !== jenisFilter) return false;
      }

      // Status filter
      if (statusFilter && statusFilter !== "ALL") {
        var st = cleanText(r["StatusCampaign"] || "").toUpperCase();
        if (statusFilter === "ONGOING" && st !== "ONGOING" && st !== "ACTIVE") return false;
        if (statusFilter === "PAUSED" && st !== "PAUSED" && st !== "CLOSED") return false;
        if (statusFilter === "ENDED" && st !== "ENDED") return false;
      }

      return true;
    });

    const tFilter = new Date().getTime();
    Logger.log("[AdsPerfQuery] Finish Filtering | Duration: " + (tFilter - tRead) + " ms | Filtered Rows: " + filtered.length);

    // Separate campaign rows for paged table view
    var campaignTableRows = filtered.slice();

    // KPI Aggregation across all filtered rows (Individual + Otomatis)
    var totalSpend = 0, totalSales = 0, totalOrders = 0, totalSoldQty = 0, totalClicks = 0, totalImpressions = 0;
    
    filtered.forEach(function(r) {
      totalSpend += parseFloat(r["Spend"]) || 0;
      totalSales += parseFloat(r["Sales"]) || 0;
      totalOrders += parseInt(r["Orders"]) || 0;
      totalSoldQty += parseInt(r["SoldQty"]) || 0;
      totalClicks += parseInt(r["Clicks"]) || 0;
      totalImpressions += parseInt(r["Impressions"]) || 0;
    });

    var totalRoas = totalSpend > 0 ? (totalSales / totalSpend).toFixed(2) : "0.00";
    var totalCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + "%" : "0.00%";
    var totalCpc = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(0) : 0;
    var totalCpm = totalImpressions > 0 ? ((totalSpend / totalImpressions) * 1000).toFixed(0) : 0;
    var totalAcos = totalSales > 0 ? ((totalSpend / totalSales) * 100).toFixed(2) + "%" : "0.00%";

    const tKpi = new Date().getTime();
    Logger.log("[AdsPerfQuery] Finish KPI | Duration: " + (tKpi - tFilter) + " ms");

    // Sorting campaign rows
    campaignTableRows.sort(function(a, b) {
      if (sortBy === "spend") return (parseFloat(b["Spend"]) || 0) - (parseFloat(a["Spend"]) || 0);
      if (sortBy === "sales") return (parseFloat(b["Sales"]) || 0) - (parseFloat(a["Sales"]) || 0);
      if (sortBy === "roas") return (parseFloat(b["ROAS"]) || 0) - (parseFloat(a["ROAS"]) || 0);
      if (sortBy === "orders") return (parseInt(b["Orders"]) || 0) - (parseInt(a["Orders"]) || 0);
      if (sortBy === "clicks") return (parseInt(b["Clicks"]) || 0) - (parseInt(a["Clicks"]) || 0);
      
      // Default sort by date descending
      var dA = parseReportDateToISO(a["ReportDate"] || a["Tanggal"] || "");
      var dB = parseReportDateToISO(b["ReportDate"] || b["Tanggal"] || "");
      return dB.localeCompare(dA);
    });

    // Pagination on campaignTableRows
    var totalRecords = campaignTableRows.length;
    var totalPages = Math.ceil(totalRecords / limit) || 1;
    var safePage = Math.min(Math.max(page, 1), totalPages);
    var startIdx = (safePage - 1) * limit;
    var paged = campaignTableRows.slice(startIdx, startIdx + limit);

    const tPage = new Date().getTime();
    Logger.log("[AdsPerfQuery] Finish Pagination | Duration: " + (tPage - tKpi) + " ms | Sliced Items: " + paged.length);

    // Map to clean response objects
    var items = paged.map(function(r) {
      var rdRaw = r["ReportDate"] || r["Tanggal"] || "";
      var rdIso = parseReportDateToISO(rdRaw);
      var formattedDate = rdIso ? rdIso.split("-").reverse().join("/") : cleanText(rdRaw);

      return {
        ReportDate: formattedDate,
        CampaignID: cleanText(r["CampaignID"]),
        CampaignName: cleanText(r["CampaignName"]),
        JenisIklan: cleanText(r["JenisIklan"]) || "Individual",
        ItemID: cleanText(r["ItemID"]),
        NamaProduk: cleanText(r["NamaProduk"]),
        StatusCampaign: cleanText(r["StatusCampaign"]) || "ONGOING",
        Impressions: parseInt(r["Impressions"]) || 0,
        Clicks: parseInt(r["Clicks"]) || 0,
        CTR: cleanText(r["CTR"]) || "0.00%",
        Spend: parseFloat(r["Spend"]) || 0,
        Sales: parseFloat(r["Sales"]) || 0,
        Orders: parseInt(r["Orders"]) || 0,
        SoldQty: parseInt(r["SoldQty"]) || 0,
        ROAS: parseFloat(r["ROAS"]) || 0,
        CPC: parseFloat(r["CPC"]) || 0,
        ACOS: cleanText(r["ACOS"]) || "0.00%",
        CPM: parseFloat(r["CPM"]) || 0
      };
    });

    const tEnd = new Date().getTime();
    Logger.log("[AdsPerfQuery] Response Sent | Total Execution Time: " + (tEnd - tStart) + " ms");

    return {
      status: "success",
      page: safePage,
      limit: limit,
      totalRecords: totalRecords,
      totalPages: totalPages,
      executionTimeMs: (tEnd - tStart),
      kpi: {
        totalSpend: totalSpend,
        totalSales: totalSales,
        totalRoas: parseFloat(totalRoas),
        totalOrders: totalOrders,
        totalClicks: totalClicks,
        totalImpressions: totalImpressions
      },
      items: items
    };
  } catch (e) {
    Logger.log("[AdsPerfQuery Error] " + e.toString());
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Get Campaign Historical Trend (SSOT from Ads_Report)
 * Returns daily breakdown timeline for a specific CampaignID or ItemID.
 */
function handleGetAdsCampaignTrend(params) {
  try {
    const cId = params && params.campaignId ? cleanText(params.campaignId) : "";
    const itemId = params && params.itemId ? cleanText(params.itemId) : "";
    const limit = parseInt((params && params.limit) || 30);

    if (!cId && !itemId) {
      return { status: "error", message: "CampaignID atau ItemID wajib diisi." };
    }

    const reportRows = readSheetObjects(ADS_REPORT_SHEET) || [];
    
    let filtered = reportRows.filter(function(r) {
      if (cId && cleanText(r["CampaignID"]) === cId) return true;
      if (itemId && cleanText(r["ItemID"]) === itemId) return true;
      return false;
    });

    // Sort by ReportDate ascending
    filtered.sort(function(a, b) {
      var dA = parseReportDateToISO(a["ReportDate"] || a["Tanggal"] || "");
      var dB = parseReportDateToISO(b["ReportDate"] || b["Tanggal"] || "");
      return dA.localeCompare(dB);
    });

    if (filtered.length > limit) {
      filtered = filtered.slice(filtered.length - limit);
    }

    var history = filtered.map(function(r) {
      var rdRaw = r["ReportDate"] || r["Tanggal"] || "";
      var rdIso = parseReportDateToISO(rdRaw);
      var formattedDate = rdIso ? rdIso.split("-").reverse().join("/") : cleanText(rdRaw);

      return {
        ReportDate: formattedDate,
        ReportDateISO: rdIso,
        Spend: parseFloat(r["Spend"]) || 0,
        Sales: parseFloat(r["Sales"]) || 0,
        Orders: parseInt(r["Orders"]) || 0,
        Clicks: parseInt(r["Clicks"]) || 0,
        Impressions: parseInt(r["Impressions"]) || 0,
        ROAS: parseFloat(r["ROAS"]) || 0,
        CTR: cleanText(r["CTR"]) || "0.00%",
        CPC: parseFloat(r["CPC"]) || 0
      };
    });

    return {
      status: "success",
      campaignId: cId,
      itemId: itemId,
      totalRecords: history.length,
      history: history
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Toggle Campaign Status (Pause / Resume) (Phase 3 Action)
 */
function handleToggleAdsCampaign(params) {
  try {
    const campaignId = (params && params.campaignId) ? cleanText(params.campaignId) : "";
    const newStatus = (params && params.status) ? cleanText(params.status).toUpperCase() : "";
    const user = (params && params.user) ? params.user : "User";

    if (!campaignId || !newStatus) {
      return { status: "error", message: "CampaignID dan Status wajib diisi." };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(ADS_CAMPAIGN_SHEET);
    if (!sheet) throw new Error("Sheet Ads_Campaign tidak ditemukan.");

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) throw new Error("Data Kampanye kosong.");

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const cIdCol = headers.indexOf("CampaignID");
    const statusCol = headers.indexOf("Status");
    const updatedCol = headers.indexOf("UpdatedAt");

    let found = false;
    let oldStatus = "";

    const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (let r = 0; r < values.length; r++) {
      if (String(values[r][cIdCol]).trim() === campaignId) {
        oldStatus = String(values[r][statusCol]);
        sheet.getRange(r + 2, statusCol + 1).setValue(newStatus);
        if (updatedCol !== -1) {
          sheet.getRange(r + 2, updatedCol + 1).setValue(getJakartaTimeString());
        }
        found = true;
        break;
      }
    }

    if (!found) {
      return { status: "error", message: "Kampanye '" + campaignId + "' tidak ditemukan." };
    }

    // Write audit log
    logAdsAudit(user, "TOGGLE_STATUS", campaignId, oldStatus, newStatus, "SUCCESS", "Status kampanye diubah.");

    return {
      status: "success",
      message: "Status Kampanye #" + campaignId + " berhasil diubah menjadi " + newStatus + "."
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Get Keywords List with Current Bid (Phase 5)
 */
function handleGetAdsKeywords(params) {
  try {
    ensureAdsDatabase();
    const rows = readSheetObjects(ADS_KEYWORD_SHEET) || [];
    
    // Load ShopeeProducts mapping (for ProductName and SellerSKU lookup)
    var productMap = {};
    try {
      var products = readSheetObjects("ShopeeProducts") || [];
      products.forEach(function(p) {
        var itemIdStr = String(p["item_id"] || "").trim();
        if (itemIdStr && !productMap[itemIdStr]) {
          productMap[itemIdStr] = {
            ProductName: String(p["nama_produk"] || "").trim(),
            SellerSKU: String(p["seller_sku"] || "").trim()
          };
        }
      });
    } catch (pErr) {
      Logger.log("[handleGetAdsKeywords] Warning loading ShopeeProducts: " + pErr.toString());
    }

    // Load Ads_Campaign mapping (for CampaignID lookup using ItemID)
    var campaignMap = {};
    try {
      var campaigns = readSheetObjects(ADS_CAMPAIGN_SHEET) || [];
      campaigns.forEach(function(c) {
        var itemIdStr = String(c["ItemID"] || "").trim();
        var campaignIdStr = String(c["CampaignID"] || "").trim();
        if (itemIdStr && campaignIdStr) {
          campaignMap[itemIdStr] = campaignIdStr;
        }
      });
    } catch (cErr) {
      Logger.log("[handleGetAdsKeywords] Warning loading Ads_Campaign: " + cErr.toString());
    }

    const keywords = rows.map(r => {
      // Fallback for old rows where ItemID might not exist, but was stored under CampaignID!
      var itemId = cleanText(r["ItemID"]) || cleanText(r["CampaignID"]) || "";
      var prodInfo = productMap[itemId] || { ProductName: "", SellerSKU: "" };
      
      var productName = prodInfo.ProductName || "";
      var sellerSku = prodInfo.SellerSKU || "";
      
      var campaignId = cleanText(r["CampaignID"]) || campaignMap[itemId] || "";
      if (campaignId === itemId) {
        campaignId = campaignMap[itemId] || "";
      }

      // Check if product lookup actually worked
      var productFound = !!productName;

      // Extract new fields with backwards compatibility fallbacks
      var suggestedBid = parseFloat(r["SuggestedBid"]) || parseFloat(r["Bid"]) || 0;
      var qualityScore = parseInt(r["QualityScore"]) || parseInt(r["quality_score"]) || 0;
      var searchVolume = parseInt(r["SearchVolume"]) || parseInt(r["search_volume"]) || 0;
      var inputKeyword = cleanText(r["InputKeyword"]) || "";

      return {
        ShopID: cleanText(r["ShopID"]) || "0",
        CampaignID: campaignId,
        ItemID: itemId,
        InputKeyword: inputKeyword,
        Keyword: cleanText(r["Keyword"]) || "",
        QualityScore: qualityScore,
        SearchVolume: searchVolume,
        SuggestedBid: suggestedBid,
        CurrentBid: "—", // Not returned by recommended keyword list API
        Status: cleanText(r["Status"]) || "ACTIVE",
        UpdatedAt: r["UpdatedAt"] || "—",
        ProductName: productName,
        SellerSKU: sellerSku,
        ProductFound: productFound
      };
    });

    return {
      status: "success",
      keywords: keywords
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Clear Ads database sheets from old mock rows
 */
function handleClearAdsDatabase(params) {
  try {
    const res = clearAdsMockDatabase();
    return res;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Run ad-hoc Shopee Ads custom API queries for diagnostics
 */
function handleRunAdsCustomQuery(params) {
  try {
    var path = params.path || "/api/v2/ads/get_product_level_campaign_id_list";
    var query = params.query || {};
    var res = shopeeGet(path, query);
    return { status: "success", response: res };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Run Historical Shopee Ads Sync for custom date range (e.g. 01-06-2026 to today)
 */
function handleRunHistoricalAdsSync(params) {
  try {
    params = params || {};
    var startDate = params.startDate || "01-06-2026";
    var endDate = params.endDate || formatAdsDateDDMMYYYY(new Date());
    var res = syncAdsHistoricalRange(startDate, endDate, params);
    return res;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Explicitly run ensureAdsDatabase and return active spreadsheet URL & sheet names
 */
function handleEnsureAdsDatabase(params) {
  try {
    ensureAdsDatabase();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetNames = ss.getSheets().map(s => s.getName());
    return {
      status: "success",
      spreadsheetName: ss.getName(),
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl(),
      totalSheets: sheetNames.length,
      sheetNames: sheetNames
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Endpoint: Explicitly run syncAdsProductDaily
 */
function handleSyncAdsProductDaily(params) {
  try {
    const dailyCount = syncAdsProductDaily();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const summarySheet = ss.getSheetByName(ADS_DAILY_SUMMARY_SHEET);
    const summaryRows = summarySheet ? summarySheet.getLastRow() - 1 : 0;
    return {
      status: "success",
      message: "Sinkronisasi harian iklan produk dan summary berhasil diselesaikan.",
      dailyProductRowsCount: dailyCount,
      dailySummaryRowsCount: Math.max(0, summaryRows)
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

// ────────────────────────────────────────────────────────────
// ADS PERMANENT FRESHNESS HARDENING
// Scheduled maintenance entrypoint + trigger setup.
// Target: syncAdsHistoricalRange (NOT refreshRecentAdsHistory,
// which triggers a redundant rebuildAdsReport()).
// ────────────────────────────────────────────────────────────

const ADS_SCHEDULED_REFRESH_WINDOW_DAYS = 14;
const ADS_SCHEDULED_TRIGGER_FUNCTION = "adsScheduledRefresh";

/**
 * Scheduled Ads maintenance job.
 * Refreshes the last 14 days (today-14 .. today) using the existing
 * syncAdsHistoricalRange() pipeline:
 *   Ads_Product_Daily (idempotent upsert, existing key -> UPDATE, new key -> INSERT)
 *   -> rebuildAdsReport()
 *   -> verifyAdsDataIntegrity()
 * Runs under a ScriptLock to prevent concurrent daily sync + maintenance.
 */
function adsScheduledRefresh() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const today = new Date();
    const past = new Date();
    past.setDate(today.getDate() - ADS_SCHEDULED_REFRESH_WINDOW_DAYS);

    const startStr = formatAdsDateDDMMYYYY(past);
    const endStr = formatAdsDateDDMMYYYY(today);

    Logger.log("[adsScheduledRefresh] Memulai refresh Ads terjadwal (window " + ADS_SCHEDULED_REFRESH_WINDOW_DAYS + " hari).");
    Logger.log("[adsScheduledRefresh] startDate=" + startStr + " | endDate=" + endStr);

    const result = syncAdsHistoricalRange(startStr, endStr);

    Logger.log("[adsScheduledRefresh] Refresh Ads selesai: " + JSON.stringify(result));
    return result;
  } catch (e) {
    Logger.log("[adsScheduledRefresh ERROR] " + e.toString());
    return { status: "error", message: "Scheduled Ads refresh gagal: " + e.toString() };
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
      Logger.log("[adsScheduledRefresh] Lock dilepaskan.");
    }
  }
}

/**
 * Setup time-based trigger for adsScheduledRefresh (every 12 hours).
 * Idempotent: only creates a trigger if none exists for the handler.
 */
function setupAdsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const existing = triggers.some(function(t) {
    return t.getHandlerFunction() === ADS_SCHEDULED_TRIGGER_FUNCTION;
  });

  if (existing) {
    Logger.log("✅ Trigger Ads sudah ada (" + ADS_SCHEDULED_TRIGGER_FUNCTION + "). Tidak membuat duplicate.");
    return "Trigger Ads sudah aktif: " + ADS_SCHEDULED_TRIGGER_FUNCTION + " setiap 12 jam.";
  }

  ScriptApp.newTrigger(ADS_SCHEDULED_TRIGGER_FUNCTION)
    .timeBased()
    .everyHours(12)
    .create();

  Logger.log("✅ Trigger Ads berhasil dibuat (" + ADS_SCHEDULED_TRIGGER_FUNCTION + ") setiap 12 jam.");
  return "Trigger Ads aktif: " + ADS_SCHEDULED_TRIGGER_FUNCTION + " setiap 12 jam.";
}
