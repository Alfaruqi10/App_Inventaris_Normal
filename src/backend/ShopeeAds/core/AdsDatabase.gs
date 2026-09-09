// ============================================================
// ShopeeAds/core/AdsDatabase.gs — DB Initialization & Feature Flags
// ============================================================

var ADS_BALANCE_SHEET = "Ads_Balance";
var ADS_CAMPAIGN_SHEET = "Ads_Campaign";
var ADS_PRODUCT_DAILY_SHEET = "Ads_Product_Daily";
var ADS_PRODUCT_HOURLY_SHEET = "Ads_Product_Hourly";
var ADS_KEYWORD_SHEET = "Ads_Keyword";
var ADS_RECOMMENDATION_SHEET = "Ads_Recommendation";
var ADS_REPORT_SHEET = "Ads_Report";
var ADS_AUDIT_LOG_SHEET = "Ads_Audit_Log";
var ADS_DAILY_SUMMARY_SHEET = "Ads_Daily_Summary";
var ADS_DATA_INTEGRITY_SHEET = "Ads_Data_Integrity";

// ── FEATURE FLAGS FOR SHOPEE ADS ──────────────────────────────────────────
if (typeof FEATURE_FLAGS !== "undefined") {
  FEATURE_FLAGS.ENABLE_SHOPEE_ADS = true;
  FEATURE_FLAGS.ENABLE_ADS_REPORT = true;
  FEATURE_FLAGS.ENABLE_ADS_RECOMMENDATION = true;
}

// ── HEADERS DEFINITION ───────────────────────────────────────────────────
var ADS_BALANCE_HEADERS = [
  "ShopID", "Balance", "Currency", "UpdatedAt", "Source"
];

var ADS_CAMPAIGN_HEADERS = [
  "ShopID", "CampaignID", "CampaignName", "CampaignType", "ItemID", 
  "Status", "Budget", "BudgetType", "TargetROI", "CreatedAt", "UpdatedAt", "Source"
];

var ADS_PRODUCT_DAILY_HEADERS = [
  "ReportDate", "CampaignID", "CampaignName", "JenisIklan", "ItemID", "NamaProduk",
  "StatusCampaign", "Impressions", "Clicks", "CTR", "Spend", "Sales", "Orders", "SoldQty",
  "ROAS", "CPC", "ACOS", "CPM"
];

var ADS_PRODUCT_HOURLY_HEADERS = [
  "Date", "Hour", "ShopID", "CampaignID", "ItemID", 
  "Spend", "Sales", "Orders", "SoldQty", "Clicks", "Impressions", "CTR", "CPC", "ROAS", "cpm", "acos", "UpdatedAt"
];

var ADS_KEYWORD_HEADERS = [
  "ShopID", "CampaignID", "ItemID", "InputKeyword", "Keyword", "QualityScore", "SearchVolume", "SuggestedBid", "Status", "UpdatedAt"
];

var ADS_RECOMMENDATION_HEADERS = [
  "ShopID", "ItemID", "RecommendationType", "Recommendation", "Value", "UpdatedAt"
];

var ADS_REPORT_HEADERS = [
  "ReportDate", "CampaignID", "CampaignName", "JenisIklan", "ItemID", "NamaProduk",
  "StatusCampaign", "Impressions", "Clicks", "CTR", "Spend", "Sales", "Orders", "SoldQty",
  "ROAS", "CPC", "ACOS", "CPM"
];

var ADS_AUDIT_LOG_HEADERS = [
  "Timestamp", "User", "Action", "CampaignID", "OldValue", "NewValue", "Status", "Details"
];

var ADS_DAILY_SUMMARY_HEADERS = [
  "Date", "ShopID", "Spend", "Sales", "Orders", "SoldQty", 
  "Clicks", "Impressions", "CTR", "CPC", "CPM", "ROAS", "ACOS", 
  "UpdatedAt", "Source"
];

var ADS_DATA_INTEGRITY_HEADERS = [
  "ValidationID", "ValidationTime", "ValidationType", "Status", "Date", "Metric", 
  "ExpectedValue", "ActualValue", "Delta", "DeltaPercent", "EarliestDate", 
  "LatestDate", "ExpectedDays", "ActualDays", "MissingDays", "MissingDateRanges", 
  "CoveragePercent", "Notes"
];

/**
 * Ensures all Shopee Ads database tables exist and headers are dynamically mapped/migrated.
 */
function ensureAdsDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  const sheetCache = sheets.map(s => {
    return {
      sheet: s,
      nameClean: s.getName().trim().toLowerCase(),
      nameRaw: s.getName()
    };
  });
  
  const config = [
    { name: ADS_BALANCE_SHEET, headers: ADS_BALANCE_HEADERS, color: "#0284C7" },
    { name: ADS_CAMPAIGN_SHEET, headers: ADS_CAMPAIGN_HEADERS, color: "#0369A1" },
    { name: ADS_PRODUCT_DAILY_SHEET, headers: ADS_PRODUCT_DAILY_HEADERS, color: "#0F766E" },
    { name: ADS_PRODUCT_HOURLY_SHEET, headers: ADS_PRODUCT_HOURLY_HEADERS, color: "#0D9488" },
    { name: ADS_KEYWORD_SHEET, headers: ADS_KEYWORD_HEADERS, color: "#7C3AED" },
    { name: ADS_RECOMMENDATION_SHEET, headers: ADS_RECOMMENDATION_HEADERS, color: "#D97706" },
    { name: ADS_REPORT_SHEET, headers: ADS_REPORT_HEADERS, color: "#15803D" },
    { name: ADS_AUDIT_LOG_SHEET, headers: ADS_AUDIT_LOG_HEADERS, color: "#B91C1C" },
    { name: ADS_DAILY_SUMMARY_SHEET, headers: ADS_DAILY_SUMMARY_HEADERS, color: "#047857" },
    { name: ADS_DATA_INTEGRITY_SHEET, headers: ADS_DATA_INTEGRITY_HEADERS, color: "#047857" }
  ];

  config.forEach(cfg => {
    let sheet = null;
    const targetNameClean = cfg.name.trim().toLowerCase();
    
    const found = sheetCache.find(c => c.nameClean === targetNameClean);
    if (found) {
      sheet = found.sheet;
      if (found.nameRaw !== cfg.name) {
        try { sheet.setName(cfg.name); } catch(e) {}
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
        sheet.setFrozenRows(1);
      } catch (e) {
        sheet = ss.getSheetByName(cfg.name);
        if (!sheet) throw new Error("Gagal membuat sheet '" + cfg.name + "': " + e.toString());
      }
    } else {
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
        sheet.setFrozenRows(1);
        Logger.log("[ensureAdsDatabase] Dynamic Header Sheet '" + cfg.name + "' disesuaikan.");
      }
    }
  });
}

/**
 * Idempotent batch row writer for Shopee Ads tables.
 */
function writeAdsSheetRowsIdempotent(sheetName, headers, newRows, timestampColIndex, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let existingData = [];
  if (lastRow > 1 && lastCol > 0) {
    existingData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  }

  let isIdentical = true;
  if (existingData.length !== newRows.length) {
    isIdentical = false;
  } else {
    for (let r = 0; r < newRows.length; r++) {
      const existingRow = existingData[r];
      const newRow = newRows[r];
      const maxCols = Math.max(existingRow.length, newRow.length);
      for (let c = 0; c < maxCols; c++) {
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
    Logger.log("[Idempotent Ads] Data '" + sheetName + "' identik. SKIP WRITE.");
    return false;
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground(color || "#1E293B")
    .setFontColor("#FFFFFF");

  if (newRows.length > 0) {
    const paddedRows = newRows.map(row => {
      let r = Array.isArray(row) ? row.slice(0, headers.length) : [];
      while (r.length < headers.length) r.push("");
      return r;
    });
    sheet.getRange(2, 1, paddedRows.length, headers.length).setValues(paddedRows);
    
    // Force plain number formatting (no "Rp" currency symbol, plain integer numbers)
    try {
      if (paddedRows.length > 0) {
        if (sheetName === ADS_PRODUCT_DAILY_SHEET || sheetName === ADS_REPORT_SHEET) {
          sheet.getRange(2, 8, paddedRows.length, 2).setNumberFormat("0");   // Impressions (H), Clicks (I)
          sheet.getRange(2, 11, paddedRows.length, 4).setNumberFormat("0");  // Spend (K), Sales (L), Orders (M), SoldQty (N)
          sheet.getRange(2, 16, paddedRows.length, 1).setNumberFormat("0");  // CPC (P)
          sheet.getRange(2, 18, paddedRows.length, 1).setNumberFormat("0");  // CPM (R)
        } else if (sheetName === ADS_DAILY_SUMMARY_SHEET) {
          sheet.getRange(2, 3, paddedRows.length, 6).setNumberFormat("0");   // Spend, Sales, Orders, SoldQty, Clicks, Impressions
        }
      }
    } catch (formatErr) {}
  }
  
  Logger.log("[writeAdsSheetRowsIdempotent] Sheet '" + sheetName + "' diperbarui dengan " + newRows.length + " baris.");
  return true;
}

/**
 * CANONICAL VALIDATOR: validateAdsDailyRow(row)
 * Single source of truth for validating any row destined for Ads_Product_Daily.
 * Returns: { valid: boolean, normalizedRow: Array, reason: string, failedRule: string }
 */
function validateAdsDailyRow(row) {
  if (!row || !Array.isArray(row)) {
    return { valid: false, normalizedRow: null, reason: "Row is empty or not an array", failedRule: "RULE_NON_ARRAY" };
  }

  // Ensure row has exactly 18 fields matching schema A:R
  var preserveSales = row._preserveSales === true;
  var normRow = row.slice(0, 18);
  while (normRow.length < 18) {
    normRow.push("");
  }
  if (preserveSales) normRow._preserveSales = true;

  var rawDate = normRow[0];
  var isoDate = (typeof parseAdsDateToISO === "function" ? parseAdsDateToISO(rawDate) : "") || normalizeDateToISO(rawDate);
  if (!isoDate) {
    return { valid: false, normalizedRow: null, reason: "Invalid date format: '" + rawDate + "'", failedRule: "RULE_INVALID_DATE" };
  }
  normRow[0] = isoDate; // Enforce YYYY-MM-DD canonical date in Col A (0)

  var cId = String(normRow[1] !== undefined ? normRow[1] : "").trim();
  var cName = String(normRow[2] !== undefined ? normRow[2] : "").trim();
  var itemId = String(normRow[4] !== undefined ? normRow[4] : "").trim();
  var spendVal = typeof cleanNumericValue === "function" ? cleanNumericValue(normRow[10]) : (parseFloat(normRow[10]) || 0);
  var cIdNum = typeof cleanNumericValue === "function" ? cleanNumericValue(cId) : (parseFloat(cId) || 0);

  // Detect the legacy layout where ShopID occupied CampaignID and all following
  // fields shifted right. ItemID must be blank or a numeric Shopee item-id list.
  var campaignNameLooksLikeId = /^\d{5,}$/.test(cName);
  var itemIdLooksValid = itemId === "" || /^\d+(,\d+)*$/.test(itemId);
  var invalidMetricLayout = [7, 8, 10, 11, 12, 13, 14, 15, 17].some(function(idx) {
    var value = normRow[idx];
    if (value === "" || value === null || value === undefined) return false;
    if (value instanceof Date) return true;
    if (typeof value === "string" && value.indexOf("%") >= 0) return true;
    return !isFinite(Number(value));
  });

  if ((campaignNameLooksLikeId && cName !== cId) || !itemIdLooksValid || invalidMetricLayout) {
    return {
      valid: false,
      normalizedRow: null,
      reason: "Legacy/misaligned Ads row layout detected",
      failedRule: "RULE_LEGACY_LAYOUT_SHIFT"
    };
  }

  // RULE 1: Legacy Identifier Check ("SHOP_TOTAL", "Total Toko")
  if (cId === "SHOP_TOTAL" || cId === "Total Toko" || cName === "Total Toko" || cName === "SHOP_TOTAL") {
    return {
      valid: false,
      normalizedRow: null,
      reason: "Legacy shop-wide identifier forbidden in detail daily: '" + cId + "'",
      failedRule: "RULE_LEGACY_IDENTIFIER"
    };
  }

  // RULE 2: Valid CampaignID check (Allows "1", numeric IDs >= 5 digits, and "auto")
  if (cId === "") {
    return { valid: false, normalizedRow: null, reason: "CampaignID is blank", failedRule: "RULE_BLANK_CAMPAIGN_ID" };
  }
  if (cId !== "auto" && cId !== "1" && !/^\d{5,}$/.test(cId)) {
    return { valid: false, normalizedRow: null, reason: "Invalid CampaignID: '" + cId + "'", failedRule: "RULE_INVALID_CAMPAIGN_ID" };
  }

  // RULE 3: Column Shift Corruption Check (Spend equals CampaignID)
  if (spendVal > 0 && cIdNum > 0 && Math.round(spendVal) === cIdNum) {
    return {
      valid: false,
      normalizedRow: null,
      reason: "Column Shift Anomaly: Spend (" + spendVal + ") equals CampaignID (" + cId + ")",
      failedRule: "RULE_COLUMN_SHIFT_ANOMALY"
    };
  }

  return { valid: true, normalizedRow: normRow, reason: "", failedRule: "" };
}

/**
 * Applies the in-memory preserve marker before a daily row is written.
 * A new row with unavailable Sales is skipped instead of creating a false zero.
 */
function prepareAdsDailyRowForUpsert(existingRow, incomingRow) {
  var preserveSales = incomingRow && incomingRow._preserveSales === true;
  var preparedRow = Array.isArray(incomingRow) ? incomingRow.slice() : [];

  if (!preserveSales) {
    return { shouldWrite: true, row: preparedRow, salesPreserved: false };
  }
  if (!existingRow) {
    return { shouldWrite: false, row: null, salesPreserved: false };
  }

  preparedRow[11] = existingRow[11];
  var spend = Number(preparedRow[10]);
  var sales = Number(preparedRow[11]);
  if (!isFinite(spend)) spend = 0;
  if (!isFinite(sales)) sales = 0;
  preparedRow[14] = spend > 0 ? (sales / spend).toFixed(2) : "0.00";
  preparedRow[16] = sales > 0 ? ((spend / sales) * 100).toFixed(2) + "%" : "0.00%";

  return { shouldWrite: true, row: preparedRow, salesPreserved: true };
}

/**
 * Primary key-based UPSERT (Update or Insert) for Shopee Ads daily performance sheets.
 * Preserves historical date rows while updating matching keys.
 * Primary Key: Date (col 0) + CampaignID (col 1) + ItemID (col 4)
 */
function upsertAdsDailyRowsIdempotent(sheetName, headers, newRows, keyColIndices, timestampColIndex, color) {
  if (!newRows || newRows.length === 0) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight("bold")
      .setBackground(color || "#1E293B")
      .setFontColor("#FFFFFF");
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let existingData = [];
  if (lastRow > 1 && lastCol > 0) {
    existingData = sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, headers.length)).getValues();
  }

  // Self-contained ISO Date Normalizer (Zero Dependency on Scope / Execution Order)
  function normalizeDateToISO(val) {
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

  // Key function generator with ISO Date Normalization for 100% Idempotency
  keyColIndices = keyColIndices || [0, 1, 4]; // Default: Date (0), CampaignID (1), ItemID (4)
  function makeKey(row) {
    return keyColIndices.map((idx) => {
      let val = row[idx] !== undefined ? row[idx] : "";
      if (idx === 0) { // Date column
        const iso = normalizeDateToISO(val);
        if (iso) return iso;
      }
      return String(val).trim();
    }).join("|");
  }

  // Build map of existing row index by primary key (PURGE DUPLICATES: keep only last occurrence)
  const existingMap = {};
  const duplicateIndices = new Set();
  existingData.forEach((row, idx) => {
    // Force date column normalization in existing rows
    if (row[0]) row[0] = normalizeDateToISO(row[0]);
    const k = makeKey(row);
    if (k) {
      if (existingMap[k] !== undefined) {
        // Mark the previous row with same key as duplicate for removal
        duplicateIndices.add(existingMap[k]);
      }
      existingMap[k] = idx;
    }
  });

  // Purge duplicate rows from existingData (keep only last occurrence per key)
  if (duplicateIndices.size > 0) {
    Logger.log("[upsertAdsDailyRowsIdempotent] Purging " + duplicateIndices.size + " duplicate rows from '" + sheetName + "'");
    existingData = existingData.filter((_, idx) => !duplicateIndices.has(idx));
    // Rebuild map after purge with correct indices
    const rebuiltMap = {};
    existingData.forEach((row, idx) => {
      const k = makeKey(row);
      if (k) rebuiltMap[k] = idx;
    });
    Object.keys(rebuiltMap).forEach(k => { existingMap[k] = rebuiltMap[k]; });
  }

  // LAYER 1 & 4: Pre-Write Sanitization & Incoming Batch Deduplication (for Ads_Product_Daily)
  var sanitizedRows = [];
  var incomingBatchKeysMap = {};
  var rejectedRowsCount = 0;

  newRows.forEach(function(r) {
    var targetRow = r;
    if (sheetName === ADS_PRODUCT_DAILY_SHEET) {
      var vRes = validateAdsDailyRow(r);
      if (!vRes.valid) {
        rejectedRowsCount++;
        Logger.log("[PRE-WRITE REJECT] Rule: " + vRes.failedRule + " | Reason: " + vRes.reason + " | Row: " + JSON.stringify(r.slice(0, 5)));
        return;
      }
      targetRow = vRes.normalizedRow;
    }

    var k = makeKey(targetRow);
    if (k) {
      // Deduplicate incoming batch (keep latest in batch)
      incomingBatchKeysMap[k] = targetRow;
    } else {
      sanitizedRows.push(targetRow);
    }
  });

  var finalIncomingRows = Object.values(incomingBatchKeysMap).concat(sanitizedRows.filter(r => !makeKey(r)));

  let updatedCount = 0;
  let insertedCount = 0;

  // Process finalIncomingRows
  finalIncomingRows.forEach(newRow => {
    const incomingKey = makeKey(newRow);
    const existingRow = incomingKey && existingMap[incomingKey] !== undefined
      ? existingData[existingMap[incomingKey]]
      : null;
    const prepared = sheetName === ADS_PRODUCT_DAILY_SHEET
      ? prepareAdsDailyRowForUpsert(existingRow, newRow)
      : { shouldWrite: true, row: newRow, salesPreserved: false };

    if (!prepared.shouldWrite) {
      Logger.log("[upsertAdsDailyRowsIdempotent] Skipped new Ads_Product_Daily row with unavailable Sales: " + incomingKey);
      return;
    }

    const paddedNewRow = Array.isArray(prepared.row) ? prepared.row.slice(0, headers.length) : [];
    while (paddedNewRow.length < headers.length) paddedNewRow.push("");

    // Force date column in newRow to clean ISO YYYY-MM-DD string
    if (paddedNewRow[0]) paddedNewRow[0] = normalizeDateToISO(paddedNewRow[0]);

    const k = makeKey(paddedNewRow);

    if (k && existingMap[k] !== undefined) {
      // Key exists -> Update existing row in place
      const rowIdx = existingMap[k];
      existingData[rowIdx] = paddedNewRow;
      if (prepared.salesPreserved) {
        Logger.log("[upsertAdsDailyRowsIdempotent] Preserved existing Sales for unavailable API field: " + k);
      }
      updatedCount++;
    } else {
      // Key does not exist -> Append new row
      existingData.push(paddedNewRow);
      if (k) existingMap[k] = existingData.length - 1;
      insertedCount++;
    }
  });


  if (updatedCount === 0 && insertedCount === 0) {
    Logger.log("[upsertAdsDailyRowsIdempotent] Sheet '" + sheetName + "' tidak ada perubahan.");
    return false;
  }

  // Sort existingData by clean ISO date descending
  existingData.sort((a, b) => {
    const dA = normalizeDateToISO(a[0]);
    const dB = normalizeDateToISO(b[0]);
    return dB.localeCompare(dA);
  });

  // Write updated data back to sheet (preserving header)
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground(color || "#1E293B")
    .setFontColor("#FFFFFF");

  // Force date column to plain text to prevent Google Sheets auto-parsing ISO dates as Date objects
  sheet.getRange(2, 1, Math.max(existingData.length, 1), 1).setNumberFormat("@");

  sheet.getRange(2, 1, existingData.length, headers.length).setValues(existingData);

  // Force plain number formatting (no "Rp" currency symbol, plain integer numbers)
  try {
    if (existingData.length > 0) {
      if (sheetName === ADS_PRODUCT_DAILY_SHEET || sheetName === ADS_REPORT_SHEET) {
        sheet.getRange(2, 8, existingData.length, 2).setNumberFormat("0");   // Impressions (H), Clicks (I)
        sheet.getRange(2, 11, existingData.length, 4).setNumberFormat("0");  // Spend (K), Sales (L), Orders (M), SoldQty (N)
        sheet.getRange(2, 16, existingData.length, 1).setNumberFormat("0");  // CPC (P)
        sheet.getRange(2, 18, existingData.length, 1).setNumberFormat("0");  // CPM (R)
      } else if (sheetName === ADS_DAILY_SUMMARY_SHEET) {
        sheet.getRange(2, 3, existingData.length, 6).setNumberFormat("0");   // Spend, Sales, Orders, SoldQty, Clicks, Impressions
      }
    }
  } catch (formatErr) {}

  Logger.log("[upsertAdsDailyRowsIdempotent] Sheet '" + sheetName + "' updated: " + updatedCount + " updated, " + insertedCount + " inserted. Total rows: " + existingData.length);
  return true;
}

/**
 * Primary key-based UPSERT for Ads_Daily_Summary (1 row per date per shop).
 * Primary Key: ShopID (col 1) + Date (col 0)
 */
function upsertAdsDailySummaryIdempotent(sheetName, headers, newRows, color) {
  return upsertAdsDailyRowsIdempotent(sheetName, headers, newRows, [1, 0], 13, color || "#047857");
}

/**
 * Purges old mock rows from all Ads sheets, keeping headers intact.
 */
function clearAdsMockDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToClear = [
    ADS_BALANCE_SHEET,
    ADS_CAMPAIGN_SHEET,
    ADS_PRODUCT_DAILY_SHEET,
    ADS_PRODUCT_HOURLY_SHEET,
    ADS_KEYWORD_SHEET,
    ADS_RECOMMENDATION_SHEET,
    ADS_REPORT_SHEET,
    ADS_DAILY_SUMMARY_SHEET,
    ADS_DATA_INTEGRITY_SHEET
  ];

  sheetsToClear.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      try {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        Logger.log("[clearAdsMockDatabase] Cleared old rows from " + name);
      } catch (e) {
        Logger.log("[clearAdsMockDatabase Error] " + name + ": " + e.toString());
      }
    }
  });
  return { status: "success", message: "Database Ads berhasil dibersihkan dari data lama." };
}

/**
 * Log audit mutation for campaign & bid management.
 */
function logAdsAudit(user, action, campaignId, oldValue, newValue, status, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(ADS_AUDIT_LOG_SHEET);
    if (!sheet) {
      ensureAdsDatabase();
      sheet = ss.getSheetByName(ADS_AUDIT_LOG_SHEET);
    }
    const row = [
      getJakartaTimeString(),
      user || "System",
      action || "MUTATION",
      campaignId || "-",
      typeof oldValue === "object" ? JSON.stringify(oldValue) : String(oldValue || ""),
      typeof newValue === "object" ? JSON.stringify(newValue) : String(newValue || ""),
      status || "SUCCESS",
      details || ""
    ];
    sheet.appendRow(row);
  } catch (e) {
    Logger.log("[logAdsAudit Error] " + e.toString());
  }
}
