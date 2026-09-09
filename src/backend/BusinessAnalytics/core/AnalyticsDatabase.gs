// ============================================================
// BusinessAnalytics/core/AnalyticsDatabase.gs — DB Initialization
// ============================================================

var ANALYTICS_DAILY_SHEET = "Analytics_Daily";
var ANALYTICS_PRODUCT_SHEET = "Analytics_Product";
var ANALYTICS_PRODUCT_TRAFFIC_SHEET = "Analytics_ProductTraffic";
var ANALYTICS_PRODUCT_INVENTORY_SHEET = "Analytics_ProductInventory";
var ANALYTICS_PRODUCT_GROWTH_SHEET = "Analytics_ProductGrowth";
var ANALYTICS_SKU_SHEET = "Analytics_SKU";
var ANALYTICS_INVENTORY_SHEET = "Analytics_Inventory";
var ANALYTICS_PROFIT_SHEET = "Analytics_Profit";
var ANALYTICS_CUSTOMER_SHEET = "Analytics_Customer";
var ANALYTICS_PRODUCT_DAILY_SHEET = "ProductDailyAnalytics";
var ANALYTICS_ERROR_LOG_SHEET = "Analytics_Error_Log";

var ANALYTICS_DAILY_HEADERS = [
  "Date", "Revenue", "NetProfit", "TotalOrders", "ActiveProducts", 
  "LowStockProducts", "DeadProducts", "ApprovalDeductions", "Returns", 
  "Cancels", "MappingRate", "UpdatedAt"
];

// ProductDailyAnalytics PRD V4 Fact Table Headers
var ANALYTICS_PRODUCT_DAILY_HEADERS = [
  "Date", "ShopID", "ItemID", "Revenue", "Orders", "Qty", "Views", "Clicks", "Favorites", "AddToCart", "FormulaVersion", "UpdatedAt"
];

// Analytics_Product PRD V4 Materialized Summary Headers
var ANALYTICS_PRODUCT_HEADERS = [
  // ============================================================
  // SECTION 1 — Product Identity
  // ============================================================
  "ShopID", "ItemID", "ParentSKU", "ProductName", "ShortName", "Brand", "Category", "Status", "PhotoURL",

  // ============================================================
  // SECTION 2 — Shopee Metrics (Shopee Seller Centre Matrix)
  // ============================================================
  "Views", "UniqueViews", "Visitors", "PageViews", "Clicks", "CTR", "Favorites", "AddToCart", "Orders", "ItemsSold", "Revenue",

  // ============================================================
  // SECTION 3 — Business Metrics (Internal ANSLA Financials & Stock)
  // ============================================================
  "GrossRevenue", "GrossProfit", "NetProfit", "AverageSellingPrice", "AverageProfit", "MarginPercent", "CurrentStock", "IncomingStock", "ReservedStock", "StockStatus",

  // ============================================================
  // SECTION 4 — Variant Metrics
  // ============================================================
  "VariantCount", "ActiveVariantCount", "BestSellingVariant", "WorstSellingVariant",

  // ============================================================
  // SECTION 5 — Historical & Ranking Metrics
  // ============================================================
  "FirstSoldDate", "LastSoldDate", "DaysWithoutSale", "RevenueGrowth7D", "RevenueGrowth30D", "RevenueGrowth90D", "RevenueRank", "ProfitRank",

  // ============================================================
  // SECTION 6 — Metadata
  // ============================================================
  "UpdatedAt", "AnalyticsVersion", "SchemaVersion", "AnalyticsSource", "FormulaVersion", "LastAnalyticsRebuild"
];

// Analytics_SKU PRD V4 Materialized Summary Headers (SKU Level)
var ANALYTICS_SKU_HEADERS = [
  // ============================================================
  // SECTION 1 — Product Identity (SKU Level)
  // ============================================================
  "ShopID", "SKU", "ItemID", "ModelID", "ParentSKU", "ProductName", "VariationName", "Brand", "Category", "Status", "PhotoURL",

  // ============================================================
  // SECTION 2 — Shopee Metrics
  // ============================================================
  "Views", "UniqueViews", "Visitors", "PageViews", "Clicks", "CTR", "Favorites", "AddToCart", "Orders", "ItemsSold", "Revenue",

  // ============================================================
  // SECTION 3 — Business Metrics
  // ============================================================
  "GrossRevenue", "GrossProfit", "NetProfit", "AverageSellingPrice", "AverageProfit", "MarginPercent", "CurrentStock", "IncomingStock", "ReservedStock", "StockStatus",

  // ============================================================
  // SECTION 4 — Historical & Ranking Metrics
  // ============================================================
  "FirstSoldDate", "LastSoldDate", "DaysWithoutSale", "RevenueGrowth7D", "RevenueGrowth30D", "RevenueGrowth90D", "RevenueRank", "ProfitRank",

  // ============================================================
  // SECTION 5 — Metadata
  // ============================================================
  "UpdatedAt", "AnalyticsVersion", "SchemaVersion", "AnalyticsSource", "FormulaVersion", "LastAnalyticsRebuild"
];

var ANALYTICS_INVENTORY_HEADERS = [
  "SKU", "ProductName", "Classification", "StockOnHand", 
  "MonthlyVelocity", "StockCoverageDays", "TurnoverRate", "UpdatedAt"
];

var ANALYTICS_PROFIT_HEADERS = [
  "DateOrMonth", "Revenue", "COGS", "VoucherSpent", "DiscountSpent", 
  "ShopeeFee", "ServiceFee", "NetProfit", "MarginPercent", "UpdatedAt"
];

var ANALYTICS_CUSTOMER_HEADERS = [
  "CustomerID", "CustomerName", "IsNewCustomer", "TotalOrders", 
  "TotalQtySpent", "TotalRevenue", "LifetimeValue", "LastOrderDate", 
  "Frequency", "UpdatedAt"
];

const ANALYTICS_ERROR_LOG_HEADERS = [
  "Timestamp", "OrderSN", "SKU", "IssueType", "RawPayload", "Status"
];

/**
 * Pastikan seluruh tabel penunjang Analitik Bisnis siap di spreadsheet.
 * Menggunakan caching nama sheet untuk mencegah Google Apps Script API bottleneck (anti-timeout).
 */
function ensureAnalyticsDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  // Cache nama sheet untuk menghindari pemanggilan API berulang (remote call bottleneck)
  const sheetCache = sheets.map(s => {
    return {
      sheet: s,
      nameClean: s.getName().trim().toLowerCase(),
      nameRaw: s.getName()
    };
  });
  
  const config = [
    { name: ANALYTICS_DAILY_SHEET, headers: ANALYTICS_DAILY_HEADERS, color: "#1E3A8A" },
    { name: ANALYTICS_PRODUCT_SHEET, headers: ANALYTICS_PRODUCT_HEADERS, color: "#065F46" },
    { name: ANALYTICS_SKU_SHEET, headers: ANALYTICS_SKU_HEADERS, color: "#0F766E" },
    { name: ANALYTICS_INVENTORY_SHEET, headers: ANALYTICS_INVENTORY_HEADERS, color: "#854D0E" },
    { name: ANALYTICS_PROFIT_SHEET, headers: ANALYTICS_PROFIT_HEADERS, color: "#3730A3" },
    { name: ANALYTICS_CUSTOMER_SHEET, headers: ANALYTICS_CUSTOMER_HEADERS, color: "#9D174D" },
    { name: ANALYTICS_PRODUCT_DAILY_SHEET, headers: ANALYTICS_PRODUCT_DAILY_HEADERS, color: "#0D9488" },
    { name: ANALYTICS_ERROR_LOG_SHEET, headers: ANALYTICS_ERROR_LOG_HEADERS, color: "#991B1B" }
  ];

  config.forEach(cfg => {
    let sheet = null;
    const targetNameClean = cfg.name.trim().toLowerCase();
    
    // Cari dari cache lokal (cepat & zero API overhead)
    const found = sheetCache.find(c => c.nameClean === targetNameClean);
    if (found) {
      sheet = found.sheet;
      // Koreksi nama jika tidak cocok persis case/spasi
      if (found.nameRaw !== cfg.name) {
        try {
          sheet.setName(cfg.name);
        } catch(e) {
          Logger.log("Warning: Gagal rename sheet: " + e.toString());
        }
      }
    }

    if (!sheet) {
      try {
        sheet = ss.insertSheet(cfg.name);
        sheet.appendRow(cfg.headers);
        sheet.getRange(1, 1, 1, cfg.headers.length)
          .setFontWeight("bold")
          .setBackground(cfg.color)
          .setFontColor("#FFFFFF");
      } catch (e) {
        Logger.log("Warning: Gagal insertSheet '" + cfg.name + "', mencoba fallback. Error: " + e.toString());
        sheet = ss.getSheetByName(cfg.name);
        if (!sheet) {
          throw new Error("Gagal membuat atau menemukan sheet '" + cfg.name + "': " + e.toString());
        }
      }
    } else {
      // Jalankan migrasi kolom jika ada kolom baru / tidak sesuai
      const lastCol = sheet.getLastColumn();
      let needsHeaderUpdate = false;
      if (lastCol > 0) {
        const checkColCount = Math.min(lastCol, 100);
        const currentHeaders = sheet.getRange(1, 1, 1, checkColCount).getValues()[0];
        if (lastCol < cfg.headers.length) {
          needsHeaderUpdate = true;
        } else {
          for (let i = 0; i < cfg.headers.length; i++) {
            if (String(currentHeaders[i] || "").trim() !== cfg.headers[i]) {
              needsHeaderUpdate = true;
              break;
            }
          }
        }
      } else {
        needsHeaderUpdate = true;
      }
      
      if (needsHeaderUpdate) {
        sheet.getRange(1, 1, 1, cfg.headers.length)
          .setValues([cfg.headers])
          .setFontWeight("bold")
          .setBackground(cfg.color)
          .setFontColor("#FFFFFF");
        Logger.log("[ensureAnalyticsDatabase] Skema sheet '" + cfg.name + "' berhasil diperbarui/dimigrasikan.");
      }
    }
  });
}

/**
 * Menulis baris data secara batch (setValues) ke sheet analitik,
 * dengan komparasi idempotensi untuk menghindari write operations jika data identik.
 */
function writeSheetRowsIdempotent(sheetName, headers, newRows, timestampColIndex, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // Ambil data yang ada di sheet saat ini
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let existingData = [];
  if (lastRow > 1 && lastCol > 0) {
    existingData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  }

  // Jika jumlah baris berbeda, pasti ada perubahan
  let isIdentical = true;
  if (existingData.length !== newRows.length) {
    isIdentical = false;
  } else {
    // Bandingkan isi sel demi sel (abaikan kolom timestamp jika ada)
    for (let r = 0; r < newRows.length; r++) {
      const existingRow = existingData[r];
      const newRow = newRows[r];
      
      // Pad newRow/existingRow jika lebarnya berbeda
      const maxCols = Math.max(existingRow.length, newRow.length);
      for (let c = 0; c < maxCols; c++) {
        // Jika kolom ini adalah kolom timestamp, lewati komparasi
        if (c === timestampColIndex) continue;
        
        const v1 = String(existingRow[c] !== undefined ? existingRow[c] : "").trim();
        const v2 = String(newRow[c] !== undefined ? newRow[c] : "").trim();
        if (v1 !== v2) {
          isIdentical = false;
          break;
        }
      }
      if (!isIdentical) break;
    }
  }

  if (isIdentical && lastRow > 1) {
    Logger.log("[Idempotent] Data untuk '" + sheetName + "' identik. SKIP WRITE.");
    return false;
  }

  // Jika tidak identik, tulis ulang
  sheet.clearContents();
  
  // Tulis Header
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground(color || "#1F2937")
    .setFontColor("#FFFFFF");

  if (newRows.length > 0) {
    // Pad and trim all rows to match header length exactly (prevents column count mismatch exception)
    const paddedRows = newRows.map(row => {
      let r = Array.isArray(row) ? row.slice(0, headers.length) : [];
      while (r.length < headers.length) r.push("");
      return r;
    });
    sheet.getRange(2, 1, paddedRows.length, headers.length).setValues(paddedRows);
  }
  
  Logger.log("[writeSheetRowsIdempotent] Sheet '" + sheetName + "' berhasil diperbarui dengan " + newRows.length + " baris.");
  return true;
}
