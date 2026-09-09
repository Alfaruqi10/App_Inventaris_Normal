// ============================================================
// ShopeeAds/core/Phase2JoiaAudit.gs — READ-ONLY DIAGNOSTIC AUDIT
// ============================================================
// 
// PURPOSE: Investigate Sales = 0 for Joia campaign (479360465) on 07/07/2026
// 
// CONSTRAINTS:
// - 100% READ-ONLY (no database writes)
// - No schema modifications
// - No resync/rebuild operations
// - Uses existing production infrastructure
// 
// TARGET:
// - Date: 07/07/2026
// - CampaignID: 479360465
// - Campaign: ANSLA - Joia - Long Outer Wanita
// - Ad Type: Individual
// 
// ============================================================

/**
 * PHASE 2 JOIA AUDIT — Main Entry Point
 * 
 * READ-ONLY investigation function that traces the complete data flow
 * from Shopee API → Database to identify root cause of Sales = 0.
 */
function runPhase2JoiaAudit() {
  Logger.log("=".repeat(80));
  Logger.log("PHASE 2: READ-ONLY JOIA AUDIT — EXECUTION START");
  Logger.log("=".repeat(80));
  Logger.log("Target: Campaign 479360465 (Joia) on 07/07/2026");
  Logger.log("Mode: 100% READ-ONLY");
  Logger.log("=".repeat(80));
  
  const report = {
    metadata: {
      executionTime: getJakartaTimeString(),
      targetDate: "2026-07-07",
      targetCampaignId: "479360465",
      targetCampaignName: "ANSLA - Joia - Long Outer Wanita",
      targetAdType: "Individual",
      mode: "READ-ONLY"
    },
    step1_rawAPI: null,
    step2_adsProductDaily: null,
    step3_adsReport: null,
    step4_shopTotal: null,
    step5_automaticAds: null,
    step6_comparison: null,
    step7_codePath: null,
    step8_divergence: null,
    step9_valueOrigin: null,
    step10_historicalAnomalies: null,
    step11_rootCause: null,
    step12_recommendation: null
  };
  
  try {
    // STEP 1: Fetch Raw API (Campaign-Specific)
    Logger.log("\n[STEP 1] Fetching raw API for campaign 479360465...");
    report.step1_rawAPI = fetchRawCampaignAPI();
    
    // STEP 2: Read Ads_Product_Daily
    Logger.log("\n[STEP 2] Reading Ads_Product_Daily...");
    report.step2_adsProductDaily = readAdsProductDailyForJoia();
    
    // STEP 3: Read Ads_Report
    Logger.log("\n[STEP 3] Reading Ads_Report...");
    report.step3_adsReport = readAdsReportForJoia();
    
    // STEP 4: Fetch Shop Total
    Logger.log("\n[STEP 4] Fetching shop total for cross-check...");
    report.step4_shopTotal = fetchShopTotalForDate();
    
    // STEP 5: Check Automatic Ads
    Logger.log("\n[STEP 5] Checking Automatic Ads data...");
    report.step5_automaticAds = checkAutomaticAdsForDate();
    
    // STEP 6: Build Comparison Matrix
    Logger.log("\n[STEP 6] Building comparison matrix...");
    report.step6_comparison = buildComparisonMatrix(report);
    
    // STEP 7: Trace Code Path
    Logger.log("\n[STEP 7] Tracing exact code path...");
    report.step7_codePath = traceCodePath(report);
    
    // STEP 8: Identify First Point of Divergence
    Logger.log("\n[STEP 8] Identifying first point of divergence...");
    report.step8_divergence = identifyDivergence(report);
    
    // STEP 9: Verify Value Origins (145500 / 145485)
    Logger.log("\n[STEP 9] Verifying origin of Rp145.500 and Rp145.485...");
    report.step9_valueOrigin = verifyValueOrigins(report);
    
    // STEP 10: Scan Historical Anomalies (READ-ONLY)
    Logger.log("\n[STEP 10] Scanning historical anomalies...");
    report.step10_historicalAnomalies = scanHistoricalAnomalies();
    
    // STEP 11: Determine Root Cause
    Logger.log("\n[STEP 11] Determining root cause verdict...");
    report.step11_rootCause = determineRootCause(report);
    
    // STEP 12: Generate Recommendations
    Logger.log("\n[STEP 12] Generating recommendations...");
    report.step12_recommendation = generateRecommendations(report);
    
    // Output Final Report
    Logger.log("\n" + "=".repeat(80));
    Logger.log("PHASE 2 AUDIT COMPLETE");
    Logger.log("=".repeat(80));
    outputFinalReport(report);
    
    return {
      status: "success",
      report: report
    };
    
  } catch (error) {
    Logger.log("\n[ERROR] Phase 2 Audit failed: " + error.toString());
    Logger.log("Stack: " + error.stack);
    report.error = {
      message: error.toString(),
      stack: error.stack
    };
    return {
      status: "error",
      message: error.toString(),
      report: report
    };
  }
}

// ============================================================
// STEP 1: FETCH RAW CAMPAIGN API
// ============================================================

function fetchRawCampaignAPI() {
  Logger.log("[Step 1] Fetching raw API for campaign 479360465, date 07-07-2026...");
  
  const result = {
    endpoint: "/api/v2/ads/get_product_campaign_daily_performance",
    campaignId: "479360465",
    date: "07-07-2026",
    rawResponse: null,
    extractedFields: {},
    error: null
  };
  
  try {
    // Use existing shopeeGet function
    if (typeof shopeeGet !== "function") {
      throw new Error("shopeeGet function not available");
    }
    
    // Fetch campaign-specific performance
    const response = shopeeGet("/api/v2/ads/get_product_campaign_daily_performance", {
      campaign_id_list: "479360465",
      start_date: "07-07-2026",
      end_date: "07-07-2026"
    });
    
    result.rawResponse = response;
    
    // Extract relevant fields
    if (response && response.response && Array.isArray(response.response.campaign_list)) {
      const campaignData = response.response.campaign_list.find(c => String(c.campaign_id) === "479360465");
      
      if (campaignData && Array.isArray(campaignData.metrics_list) && campaignData.metrics_list.length > 0) {
        const metrics = campaignData.metrics_list[0]; // First day (07-07-2026)
        
        result.extractedFields = {
          campaign_id: String(campaignData.campaign_id),
          date: metrics.date || "07-07-2026",
          broad_gmv: metrics.broad_gmv !== undefined ? parseFloat(metrics.broad_gmv) : "NOT AVAILABLE",
          direct_order: metrics.direct_order !== undefined ? parseInt(metrics.direct_order) : "NOT AVAILABLE",
          broad_order: metrics.broad_order !== undefined ? parseInt(metrics.broad_order) : "NOT AVAILABLE",
          broad_order_amount: metrics.broad_order_amount !== undefined ? parseInt(metrics.broad_order_amount) : "NOT AVAILABLE",
          item_sold: metrics.item_sold !== undefined ? parseInt(metrics.item_sold) : "NOT AVAILABLE",
          broad_item_sold: metrics.broad_item_sold !== undefined ? parseInt(metrics.broad_item_sold) : "NOT AVAILABLE",
          expense: metrics.expense !== undefined ? parseFloat(metrics.expense) : "NOT AVAILABLE",
          clicks: metrics.clicks !== undefined ? parseInt(metrics.clicks) : "NOT AVAILABLE",
          impression: metrics.impression !== undefined ? parseInt(metrics.impression) : "NOT AVAILABLE"
        };
        
        Logger.log("[Step 1] Raw API fields extracted:");
        Logger.log("  broad_gmv: " + result.extractedFields.broad_gmv);
        Logger.log("  broad_order: " + result.extractedFields.broad_order);
        Logger.log("  broad_item_sold: " + result.extractedFields.broad_item_sold);
        Logger.log("  expense: " + result.extractedFields.expense);
        Logger.log("  clicks: " + result.extractedFields.clicks);
        Logger.log("  impression: " + result.extractedFields.impression);
        
      } else {
        result.extractedFields = {
          error: "Campaign 479360465 not found in API response or no metrics for 07-07-2026"
        };
        Logger.log("[Step 1] WARNING: Campaign not found in API response");
      }
    } else {
      result.extractedFields = {
        error: "Invalid API response structure"
      };
      Logger.log("[Step 1] WARNING: Invalid API response structure");
    }
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 1] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================
// STEP 2: READ ADS_PRODUCT_DAILY
// ============================================================

function readAdsProductDailyForJoia() {
  Logger.log("[Step 2] Reading Ads_Product_Daily for campaign 479360465, date 2026-07-07...");
  
  const result = {
    sheetName: ADS_PRODUCT_DAILY_SHEET,
    targetDate: "2026-07-07",
    targetCampaignId: "479360465",
    found: false,
    data: null,
    error: null
  };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ADS_PRODUCT_DAILY_SHEET);
    
    if (!sheet) {
      result.error = "Sheet not found: " + ADS_PRODUCT_DAILY_SHEET;
      Logger.log("[Step 2] ERROR: " + result.error);
      return result;
    }
    
    // Read all data
    const allObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    Logger.log("[Step 2] Total rows in Ads_Product_Daily: " + allObjects.length);
    
    // Find matching row
    const targetRow = allObjects.find(row => {
      const reportDate = parseAdsDateToISO(getPropCaseInsensitive(row, "ReportDate"));
      const campaignId = String(getPropCaseInsensitive(row, "CampaignID")).trim();
      
      return reportDate === "2026-07-07" && campaignId === "479360465";
    });
    
    if (targetRow) {
      result.found = true;
      result.data = {
        ReportDate: getPropCaseInsensitive(targetRow, "ReportDate"),
        CampaignID: getPropCaseInsensitive(targetRow, "CampaignID"),
        CampaignName: getPropCaseInsensitive(targetRow, "CampaignName"),
        JenisIklan: getPropCaseInsensitive(targetRow, "JenisIklan"),
        ItemID: getPropCaseInsensitive(targetRow, "ItemID"),
        NamaProduk: getPropCaseInsensitive(targetRow, "NamaProduk"),
        StatusCampaign: getPropCaseInsensitive(targetRow, "StatusCampaign"),
        Impressions: parseFloat(getPropCaseInsensitive(targetRow, "Impressions")) || 0,
        Clicks: parseFloat(getPropCaseInsensitive(targetRow, "Clicks")) || 0,
        Spend: parseFloat(getPropCaseInsensitive(targetRow, "Spend")) || 0,
        Sales: parseFloat(getPropCaseInsensitive(targetRow, "Sales")) || 0,
        Orders: parseFloat(getPropCaseInsensitive(targetRow, "Orders")) || 0,
        SoldQty: parseFloat(getPropCaseInsensitive(targetRow, "SoldQty")) || 0,
        ROAS: getPropCaseInsensitive(targetRow, "ROAS"),
        CPC: getPropCaseInsensitive(targetRow, "CPC"),
        ACOS: getPropCaseInsensitive(targetRow, "ACOS"),
        CPM: getPropCaseInsensitive(targetRow, "CPM"),
        CTR: getPropCaseInsensitive(targetRow, "CTR")
      };
      
      Logger.log("[Step 2] FOUND in Ads_Product_Daily:");
      Logger.log("  Sales: " + result.data.Sales);
      Logger.log("  Orders: " + result.data.Orders);
      Logger.log("  SoldQty: " + result.data.SoldQty);
      Logger.log("  Spend: " + result.data.Spend);
      Logger.log("  Clicks: " + result.data.Clicks);
      Logger.log("  Impressions: " + result.data.Impressions);
      
    } else {
      Logger.log("[Step 2] NOT FOUND in Ads_Product_Daily");
      result.found = false;
    }
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 2] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================
// STEP 3: READ ADS_REPORT
// ============================================================

function readAdsReportForJoia() {
  Logger.log("[Step 3] Reading Ads_Report for campaign 479360465, date 2026-07-07...");
  
  const result = {
    sheetName: ADS_REPORT_SHEET,
    targetDate: "2026-07-07",
    targetCampaignId: "479360465",
    found: false,
    data: null,
    error: null
  };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ADS_REPORT_SHEET);
    
    if (!sheet) {
      result.error = "Sheet not found: " + ADS_REPORT_SHEET;
      Logger.log("[Step 3] ERROR: " + result.error);
      return result;
    }
    
    // Read all data
    const allObjects = readSheetObjects(ADS_REPORT_SHEET) || [];
    Logger.log("[Step 3] Total rows in Ads_Report: " + allObjects.length);
    
    // Find matching row
    const targetRow = allObjects.find(row => {
      const reportDate = parseAdsDateToISO(getPropCaseInsensitive(row, "ReportDate"));
      const campaignId = String(getPropCaseInsensitive(row, "CampaignID")).trim();
      
      return reportDate === "2026-07-07" && campaignId === "479360465";
    });
    
    if (targetRow) {
      result.found = true;
      result.data = {
        ReportDate: getPropCaseInsensitive(targetRow, "ReportDate"),
        CampaignID: getPropCaseInsensitive(targetRow, "CampaignID"),
        CampaignName: getPropCaseInsensitive(targetRow, "CampaignName"),
        JenisIklan: getPropCaseInsensitive(targetRow, "JenisIklan"),
        ItemID: getPropCaseInsensitive(targetRow, "ItemID"),
        NamaProduk: getPropCaseInsensitive(targetRow, "NamaProduk"),
        Impressions: parseFloat(getPropCaseInsensitive(targetRow, "Impressions")) || 0,
        Clicks: parseFloat(getPropCaseInsensitive(targetRow, "Clicks")) || 0,
        Spend: parseFloat(getPropCaseInsensitive(targetRow, "Spend")) || 0,
        Sales: parseFloat(getPropCaseInsensitive(targetRow, "Sales")) || 0,
        Orders: parseFloat(getPropCaseInsensitive(targetRow, "Orders")) || 0,
        SoldQty: parseFloat(getPropCaseInsensitive(targetRow, "SoldQty")) || 0
      };
      
      Logger.log("[Step 3] FOUND in Ads_Report:");
      Logger.log("  Sales: " + result.data.Sales);
      Logger.log("  Orders: " + result.data.Orders);
      Logger.log("  SoldQty: " + result.data.SoldQty);
      
    } else {
      Logger.log("[Step 3] NOT FOUND in Ads_Report");
      result.found = false;
    }
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 3] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================
// STEP 4: FETCH SHOP TOTAL
// ============================================================

function fetchShopTotalForDate() {
  Logger.log("[Step 4] Fetching shop total for date 07-07-2026...");
  
  const result = {
    endpoint: "/api/v2/ads/get_all_cpc_ads_daily_performance",
    date: "07-07-2026",
    rawResponse: null,
    extractedFields: {},
    error: null,
    warning: "Shop Total is NOT campaign-specific. Do NOT use for Joia attribution."
  };
  
  try {
    if (typeof shopeeGet !== "function") {
      throw new Error("shopeeGet function not available");
    }
    
    const response = shopeeGet("/api/v2/ads/get_all_cpc_ads_daily_performance", {
      start_date: "07-07-2026",
      end_date: "07-07-2026"
    });
    
    result.rawResponse = response;
    
    if (response && Array.isArray(response.response) && response.response.length > 0) {
      const dayData = response.response[0];
      
      result.extractedFields = {
        date: dayData.date || "07-07-2026",
        broad_gmv: dayData.broad_gmv !== undefined ? parseFloat(dayData.broad_gmv) : "NOT AVAILABLE",
        broad_order: dayData.broad_order !== undefined ? parseInt(dayData.broad_order) : "NOT AVAILABLE",
        broad_item_sold: dayData.broad_item_sold !== undefined ? parseInt(dayData.broad_item_sold) : "NOT AVAILABLE",
        expense: dayData.expense !== undefined ? parseFloat(dayData.expense) : "NOT AVAILABLE",
        clicks: dayData.clicks !== undefined ? parseInt(dayData.clicks) : "NOT AVAILABLE",
        impression: dayData.impression !== undefined ? parseInt(dayData.impression) : "NOT AVAILABLE"
      };
      
      Logger.log("[Step 4] Shop Total extracted:");
      Logger.log("  Sales (broad_gmv): " + result.extractedFields.broad_gmv);
      Logger.log("  Orders: " + result.extractedFields.broad_order);
      Logger.log("  SoldQty: " + result.extractedFields.broad_item_sold);
      Logger.log("  WARNING: This is shop-level, NOT campaign-specific!");
      
    } else {
      result.extractedFields.error = "No shop total data for 07-07-2026";
      Logger.log("[Step 4] WARNING: No shop total data found");
    }
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 4] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================
// STEP 5: CHECK AUTOMATIC ADS
// ============================================================

function checkAutomaticAdsForDate() {
  Logger.log("[Step 5] Checking Automatic Ads for date 2026-07-07...");
  
  const result = {
    date: "2026-07-07",
    found: false,
    data: null,
    note: "Automatic Ads should NOT be mixed with Individual Joia attribution"
  };
  
  try {
    // Check Ads_Product_Daily for "auto" or "Otomatis" campaigns
    const allObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    
    const autoRows = allObjects.filter(row => {
      const reportDate = parseAdsDateToISO(getPropCaseInsensitive(row, "ReportDate"));
      const jenisIklan = String(getPropCaseInsensitive(row, "JenisIklan")).trim();
      const campaignId = String(getPropCaseInsensitive(row, "CampaignID")).trim();
      
      return reportDate === "2026-07-07" && (jenisIklan === "Otomatis" || campaignId === "auto" || campaignId === "1");
    });
    
    if (autoRows.length > 0) {
      result.found = true;
      result.data = autoRows.map(row => ({
        CampaignID: getPropCaseInsensitive(row, "CampaignID"),
        CampaignName: getPropCaseInsensitive(row, "CampaignName"),
        Sales: parseFloat(getPropCaseInsensitive(row, "Sales")) || 0,
        Orders: parseFloat(getPropCaseInsensitive(row, "Orders")) || 0,
        SoldQty: parseFloat(getPropCaseInsensitive(row, "SoldQty")) || 0,
        Spend: parseFloat(getPropCaseInsensitive(row, "Spend")) || 0
      }));
      
      Logger.log("[Step 5] FOUND " + autoRows.length + " Automatic Ads rows:");
      result.data.forEach((row, idx) => {
        Logger.log("  Row " + (idx + 1) + ": Sales=" + row.Sales + ", Orders=" + row.Orders);
      });
      
    } else {
      Logger.log("[Step 5] NO Automatic Ads found for this date");
    }
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 5] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================
// STEP 6: BUILD COMPARISON MATRIX
// ============================================================

function buildComparisonMatrix(report) {
  Logger.log("[Step 6] Building comparison matrix...");
  
  const api = report.step1_rawAPI.extractedFields || {};
  const productDaily = report.step2_adsProductDaily.data || {};
  const adsReport = report.step3_adsReport.data || {};
  const shopTotal = report.step4_shopTotal.extractedFields || {};
  
  const matrix = {
    Sales: {
      raw_api: api.broad_gmv !== "NOT AVAILABLE" ? api.broad_gmv : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.Sales : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.Sales : "NOT FOUND",
      shop_total: shopTotal.broad_gmv !== "NOT AVAILABLE" ? shopTotal.broad_gmv : "ERROR",
      seller_center: 145500 // From evidence
    },
    Orders: {
      raw_api: api.broad_order !== "NOT AVAILABLE" ? api.broad_order : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.Orders : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.Orders : "NOT FOUND",
      shop_total: shopTotal.broad_order !== "NOT AVAILABLE" ? shopTotal.broad_order : "ERROR"
    },
    SoldQty: {
      raw_api: api.broad_item_sold !== "NOT AVAILABLE" ? api.broad_item_sold : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.SoldQty : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.SoldQty : "NOT FOUND",
      shop_total: shopTotal.broad_item_sold !== "NOT AVAILABLE" ? shopTotal.broad_item_sold : "ERROR"
    },
    Spend: {
      raw_api: api.expense !== "NOT AVAILABLE" ? api.expense : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.Spend : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.Spend : "NOT FOUND"
    },
    Clicks: {
      raw_api: api.clicks !== "NOT AVAILABLE" ? api.clicks : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.Clicks : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.Clicks : "NOT FOUND"
    },
    Impressions: {
      raw_api: api.impression !== "NOT AVAILABLE" ? api.impression : "ERROR",
      ads_product_daily: report.step2_adsProductDaily.found ? productDaily.Impressions : "NOT FOUND",
      ads_report: report.step3_adsReport.found ? adsReport.Impressions : "NOT FOUND"
    }
  };
  
  Logger.log("[Step 6] Comparison Matrix built");
  Logger.log("  Sales: API=" + matrix.Sales.raw_api + " | DB=" + matrix.Sales.ads_product_daily + " | Report=" + matrix.Sales.ads_report);
  Logger.log("  Orders: API=" + matrix.Orders.raw_api + " | DB=" + matrix.Orders.ads_product_daily);
  Logger.log("  Seller Center: " + matrix.Sales.seller_center);
  Logger.log("  Shop Total: " + matrix.Sales.shop_total);
  
  return matrix;
}

// ============================================================================
// STEP 7: TRACE CODE PATH
// ============================================================================

function traceCodePath(report) {
  Logger.log("[Step 7] Tracing exact code path...");
  
  const trace = {
    pipeline: [
      {
        stage: "API Fetch",
        file: "ShopeeAds/core/AdsEngine.gs",
        function: "syncAdsProductDaily()",
        lineApprox: "264-456",
        input: "campaign_id=479360465, date=07-07-2026",
        output: report.step1_rawAPI.extractedFields.broad_gmv || "ERROR"
      },
      {
        stage: "Parser",
        file: "ShopeeAds/core/AdsEngine.gs",
        function: "syncAdsProductDaily() inline",
        lineApprox: "357-358",
        input: "p.broad_gmv from API",
        output: "parseFloat(p.broad_gmv) || 0",
        note: "Parser uses parseFloat with fallback to 0"
      },
      {
        stage: "Mapper",
        file: "ShopeeAds/core/AdsEngine.gs",
        function: "syncAdsProductDaily() inline",
        lineApprox: "383-394",
        input: "sales variable from parser",
        output: "Row array position [11] (Sales column)",
        note: "Mapped to Ads_Product_Daily row"
      },
      {
        stage: "Validator",
        file: "ShopeeAds/core/AdsDatabase.gs",
        function: "validateAdsDailyRow()",
        lineApprox: "243-296",
        input: "Row array with Sales at index 11",
        output: "validation result",
        note: "Validates CampaignID, checks for legacy identifiers, column shift detection"
      },
      {
        stage: "Database Writer",
        file: "ShopeeAds/core/AdsDatabase.gs",
        function: "upsertAdsDailyRowsIdempotent()",
        lineApprox: "303-496",
        input: "Validated row array",
        output: report.step2_adsProductDaily.found ? report.step2_adsProductDaily.data.Sales : "NOT WRITTEN",
        note: "UPSERT with primary key: Date + CampaignID + ItemID"
      },
      {
        stage: "Report Builder",
        file: "ShopeeAds/core/AdsEngine.gs",
        function: "rebuildAdsReport()",
        lineApprox: "1115+",
        input: "Data from Ads_Product_Daily",
        output: report.step3_adsReport.found ? report.step3_adsReport.data.Sales : "NOT FOUND",
        note: "Aggregates from Ads_Product_Daily to Ads_Report"
      }
    ],
    notes: [
      "Pipeline executes in sequence: API → Parser → Mapper → Validator → UPSERT → Aggregator",
      "Each stage transforms data before passing to next stage",
      "Validation layer can REJECT rows (but does not modify values)",
      "UPSERT uses primary key matching: if key exists UPDATE, else INSERT"
    ]
  };
  
  Logger.log("[Step 7] Code path traced through " + trace.pipeline.length + " stages");
  
  return trace;
}

// ============================================================================
// STEP 8: IDENTIFY FIRST POINT OF DIVERGENCE
// ============================================================================

function identifyDivergence(report) {
  Logger.log("[Step 8] Identifying first point of divergence...");
  
  const matrix = report.step6_comparison;
  const divergence = {
    found: false,
    location: null,
    details: null,
    severity: null
  };
  
  // Check API → Ads_Product_Daily
  if (matrix.Sales.raw_api !== "ERROR" && matrix.Sales.ads_product_daily !== "NOT FOUND") {
    if (matrix.Sales.raw_api > 0 && matrix.Sales.ads_product_daily === 0) {
      divergence.found = true;
      divergence.location = "API → Ads_Product_Daily";
      divergence.details = "API returns Sales=" + matrix.Sales.raw_api + " but database has Sales=0";
      divergence.severity = "CRITICAL";
      divergence.stage = "PIPELINE (Parser/Mapper/Validator/Writer)";
      
      Logger.log("[Step 8] DIVERGENCE FOUND: " + divergence.location);
      Logger.log("  API: " + matrix.Sales.raw_api);
      Logger.log("  DB: " + matrix.Sales.ads_product_daily);
      return divergence;
    }
  }
  
  // Check Ads_Product_Daily → Ads_Report
  if (matrix.Sales.ads_product_daily !== "NOT FOUND" && matrix.Sales.ads_report !== "NOT FOUND") {
    if (matrix.Sales.ads_product_daily > 0 && matrix.Sales.ads_report === 0) {
      divergence.found = true;
      divergence.location = "Ads_Product_Daily → Ads_Report";
      divergence.details = "Product Daily has Sales=" + matrix.Sales.ads_product_daily + " but Ads_Report has Sales=0";
      divergence.severity = "CRITICAL";
      divergence.stage = "AGGREGATION (rebuildAdsReport)";
      
      Logger.log("[Step 8] DIVERGENCE FOUND: " + divergence.location);
      return divergence;
    }
  }
  
  // Check for API = 0 but Seller Center > 0
  if (matrix.Sales.raw_api === 0 && matrix.Sales.seller_center > 0) {
    divergence.found = true;
    divergence.location = "Shopee API vs Seller Center UI";
    divergence.details = "API returns Sales=0 but Seller Center shows Sales=" + matrix.Sales.seller_center;
    divergence.severity = "HIGH";
    divergence.stage = "SHOPEE ATTRIBUTION";
    
    Logger.log("[Step 8] DIVERGENCE FOUND: " + divergence.location);
    return divergence;
  }
  
  // No divergence found
  if (matrix.Sales.raw_api === 0 && matrix.Sales.ads_product_daily === 0 && matrix.Sales.ads_report === 0) {
    divergence.found = false;
    divergence.location = "None - All sources consistent";
    divergence.details = "API, Ads_Product_Daily, and Ads_Report all show Sales=0";
    divergence.severity = "INFO";
    
    Logger.log("[Step 8] NO DIVERGENCE: All sources show Sales=0");
  }
  
  return divergence;
}

// ============================================================================
// STEP 9: VERIFY VALUE ORIGINS (145500 / 145485)
// ============================================================================

function verifyValueOrigins(report) {
  Logger.log("[Step 9] Verifying origin of Rp145.500 and Rp145.485...");
  
  const result = {
    value_145500: {
      value: 145500,
      found: false,
      sources: [],
      validForJoia: false,
      analysis: []
    },
    value_145485: {
      value: 145485,
      found: false,
      sources: [],
      validForJoia: false,
      analysis: []
    },
    conclusion: null
  };
  
  // Check 145500
  if (report.step1_rawAPI.extractedFields.broad_gmv === 145500) {
    result.value_145500.found = true;
    result.value_145500.sources.push("raw_api_campaign_specific");
    result.value_145500.validForJoia = true;
    result.value_145500.analysis.push("Found in campaign-specific API for CampaignID 479360465");
  }
  
  if (report.step2_adsProductDaily.found && report.step2_adsProductDaily.data.Sales === 145500) {
    result.value_145500.found = true;
    result.value_145500.sources.push("ads_product_daily");
    result.value_145500.validForJoia = true;
    result.value_145500.analysis.push("Found in Ads_Product_Daily");
  }
  
  // Check 145485
  if (report.step4_shopTotal.extractedFields.broad_gmv === 145485) {
    result.value_145485.found = true;
    result.value_145485.sources.push("shop_total_api");
    result.value_145485.validForJoia = false;
    result.value_145485.analysis.push("Found in Shop Total API (shop-level aggregate)");
    result.value_145485.analysis.push("WARNING: Shop Total is NOT campaign-specific");
    result.value_145485.analysis.push("DO NOT use this value for Joia Individual attribution");
  }
  
  // Analyze difference
  const diff = 145500 - 145485;
  result.conclusion = "Difference between 145500 and 145485 is Rp" + diff;
  
  if (result.value_145485.sources.includes("shop_total_api") && !result.value_145500.found) {
    result.conclusion += ". Shop Total (145485) is shop-level aggregate and should NOT be attributed to Joia.";
  }
  
  Logger.log("[Step 9] Value origins verified:");
  Logger.log("  145500: Found=" + result.value_145500.found + ", Valid for Joia=" + result.value_145500.validForJoia);
  Logger.log("  145485: Found=" + result.value_145485.found + ", Valid for Joia=" + result.value_145485.validForJoia);
  
  return result;
}

// ============================================================================
// STEP 10: SCAN HISTORICAL ANOMALIES (READ-ONLY)
// ============================================================================

function scanHistoricalAnomalies() {
  Logger.log("[Step 10] Scanning historical anomalies (READ-ONLY)...");
  
  const result = {
    totalScanned: 0,
    anomaliesFound: 0,
    anomalies: [],
    summary: {}
  };
  
  try {
    // This is a lightweight scan - not full historical
    // Focus on finding similar patterns to Joia case
    
    const allObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    result.totalScanned = allObjects.length;
    
    Logger.log("[Step 10] Scanning " + result.totalScanned + " rows...");
    
    allObjects.forEach(row => {
      const sales = parseFloat(getPropCaseInsensitive(row, "Sales")) || 0;
      const orders = parseFloat(getPropCaseInsensitive(row, "Orders")) || 0;
      const soldQty = parseFloat(getPropCaseInsensitive(row, "SoldQty")) || 0;
      const spend = parseFloat(getPropCaseInsensitive(row, "Spend")) || 0;
      const jenisIklan = String(getPropCaseInsensitive(row, "JenisIklan")).trim();
      
      // Only check Individual ads
      if (jenisIklan !== "Individual") return;
      
      // Anomaly patterns
      const anomalyReasons = [];
      
      if (sales === 0 && orders > 0) {
        anomalyReasons.push("Sales=0 but Orders>0");
      }
      
      if (sales === 0 && soldQty > 0) {
        anomalyReasons.push("Sales=0 but SoldQty>0");
      }
      
      if (spend > 0 && sales === 0 && (orders > 0 || soldQty > 0)) {
        anomalyReasons.push("Spend>0 and Sales=0 but has conversion");
      }
      
      if (anomalyReasons.length > 0) {
        result.anomaliesFound++;
        
        // Only store first 50 anomalies for performance
        if (result.anomalies.length < 50) {
          result.anomalies.push({
            date: getPropCaseInsensitive(row, "ReportDate"),
            campaignId: getPropCaseInsensitive(row, "CampaignID"),
            campaignName: getPropCaseInsensitive(row, "CampaignName"),
            sales: sales,
            orders: orders,
            soldQty: soldQty,
            spend: spend,
            reasons: anomalyReasons
          });
        }
      }
    });
    
    result.summary = {
      totalRows: result.totalScanned,
      anomaliesCount: result.anomaliesFound,
      anomalyRate: result.totalScanned > 0 ? ((result.anomaliesFound / result.totalScanned) * 100).toFixed(2) + "%" : "0%",
      note: "Only showing first 50 anomalies"
    };
    
    Logger.log("[Step 10] Scan complete: Found " + result.anomaliesFound + " anomalies in " + result.totalScanned + " rows");
    
  } catch (error) {
    result.error = error.toString();
    Logger.log("[Step 10] ERROR: " + error.toString());
  }
  
  return result;
}

// ============================================================================
// STEP 11: DETERMINE ROOT CAUSE
// ============================================================================

function determineRootCause(report) {
  Logger.log("[Step 11] Determining root cause verdict...");
  
  const divergence = report.step8_divergence;
  const matrix = report.step6_comparison;
  
  let verdict = {
    case: null,
    title: null,
    description: null,
    firstDivergence: null,
    actionRequired: null,
    severity: null,
    evidence: []
  };
  
  // CASE A: APPLICATION PIPELINE BUG
  if (divergence.found && divergence.location === "API → Ads_Product_Daily") {
    verdict.case = "CASE A";
    verdict.title = "APPLICATION PIPELINE BUG";
    verdict.description = "Raw API returns Sales > 0 but Ads_Product_Daily = 0. Data lost in pipeline.";
    verdict.firstDivergence = "API → Ads_Product_Daily";
    verdict.actionRequired = "Investigate Parser/Mapper/Validator/Writer. Fix data loss in Phase 3.";
    verdict.severity = "CRITICAL";
    verdict.evidence = [
      "API broad_gmv: " + matrix.Sales.raw_api,
      "Ads_Product_Daily Sales: " + matrix.Sales.ads_product_daily,
      "Divergence detected at: " + divergence.stage
    ];
    
    Logger.log("[Step 11] VERDICT: CASE A - APPLICATION PIPELINE BUG");
    return verdict;
  }
  
  // CASE B: ADS_REPORT AGGREGATION BUG
  if (divergence.found && divergence.location === "Ads_Product_Daily → Ads_Report") {
    verdict.case = "CASE B";
    verdict.title = "ADS_REPORT AGGREGATION BUG";
    verdict.description = "Ads_Product_Daily has Sales > 0 but Ads_Report = 0. Aggregation error.";
    verdict.firstDivergence = "Ads_Product_Daily → Ads_Report";
    verdict.actionRequired = "Fix rebuildAdsReport() aggregation logic in Phase 3.";
    verdict.severity = "CRITICAL";
    verdict.evidence = [
      "Ads_Product_Daily Sales: " + matrix.Sales.ads_product_daily,
      "Ads_Report Sales: " + matrix.Sales.ads_report,
      "Divergence detected at: " + divergence.stage
    ];
    
    Logger.log("[Step 11] VERDICT: CASE B - ADS_REPORT AGGREGATION BUG");
    return verdict;
  }
  
  // CASE C: NO APPLICATION BUG
  if (!divergence.found && matrix.Sales.raw_api === 0 && matrix.Sales.ads_product_daily === 0 && matrix.Sales.seller_center === 0) {
    verdict.case = "CASE C";
    verdict.title = "NO APPLICATION BUG FOUND";
    verdict.description = "All sources consistently show Sales = 0. Data is correct.";
    verdict.firstDivergence = "None";
    verdict.actionRequired = "None - Close audit. Update documentation.";
    verdict.severity = "INFO";
    verdict.evidence = [
      "API broad_gmv: 0",
      "Ads_Product_Daily Sales: 0",
      "Ads_Report Sales: 0",
      "Seller Center: 0"
    ];
    
    Logger.log("[Step 11] VERDICT: CASE C - NO APPLICATION BUG");
    return verdict;
  }
  
  // CASE D: SHOPEE ATTRIBUTION DISCREPANCY
  if (divergence.found && divergence.location === "Shopee API vs Seller Center UI") {
    verdict.case = "CASE D";
    verdict.title = "SHOPEE ATTRIBUTION DISCREPANCY";
    verdict.description = "API returns Sales = 0 but Seller Center shows Sales > 0. Attribution mismatch.";
    verdict.firstDivergence = "Shopee API vs Seller Center UI";
    verdict.actionRequired = "Investigate API endpoint selection. Verify campaign mapping. May need Shopee support contact.";
    verdict.severity = "HIGH";
    verdict.evidence = [
      "API broad_gmv: " + matrix.Sales.raw_api,
      "Seller Center: " + matrix.Sales.seller_center,
      "Application data is consistent with API",
      "Issue is between Shopee API and Shopee UI"
    ];
    
    Logger.log("[Step 11] VERDICT: CASE D - SHOPEE ATTRIBUTION DISCREPANCY");
    return verdict;
  }
  
  // CASE E: INSUFFICIENT DATA
  if (matrix.Sales.raw_api === "ERROR" || matrix.Sales.ads_product_daily === "NOT FOUND") {
    verdict.case = "CASE E";
    verdict.title = "INSUFFICIENT DATA";
    verdict.description = "Unable to fetch required data for complete verification.";
    verdict.firstDivergence = "Cannot determine";
    verdict.actionRequired = "Fix data access issues and re-run verification.";
    verdict.severity = "BLOCKER";
    verdict.evidence = [
      "API status: " + (matrix.Sales.raw_api === "ERROR" ? "ERROR" : "OK"),
      "Database status: " + (matrix.Sales.ads_product_daily === "NOT FOUND" ? "NOT FOUND" : "OK")
    ];
    
    Logger.log("[Step 11] VERDICT: CASE E - INSUFFICIENT DATA");
    return verdict;
  }
  
  // CASE F: UNKNOWN/COMPLEX
  verdict.case = "CASE F";
  verdict.title = "UNKNOWN/COMPLEX PATTERN";
  verdict.description = "Data pattern does not match standard cases. Requires manual analysis.";
  verdict.firstDivergence = "Requires investigation";
  verdict.actionRequired = "Review comparison matrix manually. Deep-dive into specific data values.";
  verdict.severity = "HIGH";
  verdict.evidence = [
    "API: " + matrix.Sales.raw_api,
    "Product Daily: " + matrix.Sales.ads_product_daily,
    "Ads Report: " + matrix.Sales.ads_report,
    "Pattern does not match CASE A-E"
  ];
  
  Logger.log("[Step 11] VERDICT: CASE F - UNKNOWN/COMPLEX");
  return verdict;
}

// ============================================================================
// STEP 12: GENERATE RECOMMENDATIONS
// ============================================================================

function generateRecommendations(report) {
  Logger.log("[Step 12] Generating recommendations...");
  
  const verdict = report.step11_rootCause;
  const recommendations = {
    immediate: [],
    shortTerm: [],
    longTerm: [],
    doNot: []
  };
  
  if (verdict.case === "CASE A" || verdict.case === "CASE B") {
    recommendations.immediate = [
      "Identify exact code location where data is lost",
      "Add detailed logging at each pipeline stage",
      "Create unit tests for the failing scenario"
    ];
    recommendations.shortTerm = [
      "Fix the identified bug in Phase 3",
      "Test fix with Joia campaign data",
      "Resync historical data for affected campaigns",
      "Verify fix with integration tests"
    ];
    recommendations.longTerm = [
      "Implement data validation alerts",
      "Add end-to-end pipeline monitoring",
      "Build automated anomaly detection"
    ];
  } else if (verdict.case === "CASE D") {
    recommendations.immediate = [
      "Verify correct API endpoint is being used",
      "Check campaign ID mapping accuracy",
      "Review Seller Center attribution methodology"
    ];
    recommendations.shortTerm = [
      "Contact Shopee support if API discrepancy confirmed",
      "Document attribution differences",
      "Update internal expectations based on API reality"
    ];
    recommendations.longTerm = [
      "Build reconciliation report (API vs Seller Center)",
      "Set up alerts for large discrepancies"
    ];
  } else if (verdict.case === "CASE C") {
    recommendations.immediate = [
      "Confirm with user that Sales = 0 is expected",
      "Document findings for audit trail"
    ];
    recommendations.shortTerm = [
      "Close audit as no bug found",
      "Update monitoring to prevent false alarms"
    ];
  }
  
  // Universal DO NOT recommendations
  recommendations.doNot = [
    "DO NOT use Shop Total sales for Joia Individual attribution",
    "DO NOT use remainder logic (shop_total - others) for campaign attribution",
    "DO NOT modify database schema during fix implementation",
    "DO NOT assume Seller Center values are campaign-specific without verification",
    "DO NOT resync data before root cause is definitively confirmed and fix is tested"
  ];
  
  Logger.log("[Step 12] Recommendations generated");
  
  return recommendations;
}

// ============================================================================
// OUTPUT FINAL REPORT
// ============================================================================

function outputFinalReport(report) {
  Logger.log("\n" + "=".repeat(80));
  Logger.log("PHASE 2 READ-ONLY VERIFICATION REPORT");
  Logger.log("=".repeat(80));
  
  Logger.log("\n## 1. RAW API EVIDENCE");
  Logger.log("Campaign: 479360465");
  Logger.log("Date: 07-07-2026");
  if (report.step1_rawAPI.extractedFields) {
    Logger.log("  broad_gmv: " + report.step1_rawAPI.extractedFields.broad_gmv);
    Logger.log("  broad_order: " + report.step1_rawAPI.extractedFields.broad_order);
    Logger.log("  broad_item_sold: " + report.step1_rawAPI.extractedFields.broad_item_sold);
    Logger.log("  expense: " + report.step1_rawAPI.extractedFields.expense);
    Logger.log("  clicks: " + report.step1_rawAPI.extractedFields.clicks);
    Logger.log("  impression: " + report.step1_rawAPI.extractedFields.impression);
  }
  
  Logger.log("\n## 2. ADS_PRODUCT_DAILY EVIDENCE");
  Logger.log("Found: " + report.step2_adsProductDaily.found);
  if (report.step2_adsProductDaily.found) {
    Logger.log("  Sales: " + report.step2_adsProductDaily.data.Sales);
    Logger.log("  Orders: " + report.step2_adsProductDaily.data.Orders);
    Logger.log("  SoldQty: " + report.step2_adsProductDaily.data.SoldQty);
    Logger.log("  Spend: " + report.step2_adsProductDaily.data.Spend);
  }
  
  Logger.log("\n## 3. ADS_REPORT EVIDENCE");
  Logger.log("Found: " + report.step3_adsReport.found);
  if (report.step3_adsReport.found) {
    Logger.log("  Sales: " + report.step3_adsReport.data.Sales);
    Logger.log("  Orders: " + report.step3_adsReport.data.Orders);
    Logger.log("  SoldQty: " + report.step3_adsReport.data.SoldQty);
  }
  
  Logger.log("\n## 4. SHOP TOTAL EVIDENCE");
  if (report.step4_shopTotal.extractedFields) {
    Logger.log("  Sales: " + report.step4_shopTotal.extractedFields.broad_gmv);
    Logger.log("  WARNING: " + report.step4_shopTotal.warning);
  }
  
  Logger.log("\n## 5. COMPARISON MATRIX");
  Logger.log("Sales:");
  Logger.log("  Raw API:           " + report.step6_comparison.Sales.raw_api);
  Logger.log("  Ads_Product_Daily: " + report.step6_comparison.Sales.ads_product_daily);
  Logger.log("  Ads_Report:        " + report.step6_comparison.Sales.ads_report);
  Logger.log("  Shop Total:        " + report.step6_comparison.Sales.shop_total);
  Logger.log("  Seller Center:     " + report.step6_comparison.Sales.seller_center);
  
  Logger.log("\n## 6. FIRST POINT OF DIVERGENCE");
  Logger.log("Found: " + report.step8_divergence.found);
  Logger.log("Location: " + report.step8_divergence.location);
  if (report.step8_divergence.details) {
    Logger.log("Details: " + report.step8_divergence.details);
  }
  Logger.log("Severity: " + report.step8_divergence.severity);
  
  Logger.log("\n## 7. ORIGIN OF RP145.500 / RP145.485");
  Logger.log("145500:");
  Logger.log("  Found: " + report.step9_valueOrigin.value_145500.found);
  Logger.log("  Valid for Joia: " + report.step9_valueOrigin.value_145500.validForJoia);
  Logger.log("  Sources: " + report.step9_valueOrigin.value_145500.sources.join(", "));
  Logger.log("145485:");
  Logger.log("  Found: " + report.step9_valueOrigin.value_145485.found);
  Logger.log("  Valid for Joia: " + report.step9_valueOrigin.value_145485.validForJoia);
  Logger.log("  Sources: " + report.step9_valueOrigin.value_145485.sources.join(", "));
  
  Logger.log("\n## 8. HISTORICAL ANOMALIES");
  Logger.log("Total scanned: " + report.step10_historicalAnomalies.totalScanned);
  Logger.log("Anomalies found: " + report.step10_historicalAnomalies.anomaliesFound);
  Logger.log("Anomaly rate: " + report.step10_historicalAnomalies.summary.anomalyRate);
  
  Logger.log("\n## 9. ROOT CAUSE VERDICT");
  Logger.log("=".repeat(80));
  Logger.log("CASE: " + report.step11_rootCause.case);
  Logger.log("TITLE: " + report.step11_rootCause.title);
  Logger.log("DESCRIPTION: " + report.step11_rootCause.description);
  Logger.log("FIRST DIVERGENCE: " + report.step11_rootCause.firstDivergence);
  Logger.log("SEVERITY: " + report.step11_rootCause.severity);
  Logger.log("ACTION REQUIRED: " + report.step11_rootCause.actionRequired);
  Logger.log("=".repeat(80));
  
  Logger.log("\n## 10. RECOMMENDATIONS");
  Logger.log("Immediate:");
  report.step12_recommendation.immediate.forEach(r => Logger.log("  - " + r));
  Logger.log("\nDO NOT:");
  report.step12_recommendation.doNot.forEach(r => Logger.log("  - " + r));
  
  Logger.log("\n" + "=".repeat(80));
  Logger.log("END OF PHASE 2 VERIFICATION REPORT");
  Logger.log("=".repeat(80));
  Logger.log("\nStatus: READ-ONLY verification complete");
  Logger.log("Database: NO CHANGES MADE");
  Logger.log("Schema: LOCKED (no modifications)");
  Logger.log("\nAwaiting approval for Phase 3 (if fix required)");
  Logger.log("=".repeat(80));
}
