# PHASE 2 — READ-ONLY API + DATABASE VERIFICATION SCRIPT

**Status:** READY TO EXECUTE  
**Mode:** READ-ONLY (No database writes, no sync, no rebuild)  
**Target:** CampaignID 479360465, Date 07/07/2026

---

## SCRIPT PURPOSE

This script will:
1. Fetch raw API response for campaign 479360465 on 07/07/2026
2. Read existing Ads_Product_Daily database row
3. Read existing Ads_Report database row
4. Compare values across the pipeline
5. Identify first point of divergence
6. Determine origin of Rp145.500/145.485

**NO DATA WILL BE MODIFIED.**

---

## EXECUTION SCRIPT (Google Apps Script)

```javascript
/**
 * PHASE 2 READ-ONLY VERIFICATION
 * Execute this in Google Apps Script console
 */
function phase2ReadOnlyVerification() {
  Logger.log("=================================================================");
  Logger.log("PHASE 2: READ-ONLY API + DATABASE VERIFICATION");
  Logger.log("Target: CampaignID 479360465, Date 07/07/2026");
  Logger.log("Mode: READ-ONLY (No database modifications)");
  Logger.log("=================================================================");
  
  var report = {
    timestamp: new Date().toISOString(),
    targetDate: "07/07/2026",
    targetCampaignId: "479360465",
    targetCampaignName: "ANSLA - Joia - Long Outer Wanita",
    rawApi: {},
    adsProductDaily: {},
    adsReport: {},
    shopTotal: {},
    automaticAds: {},
    comparison: {},
    divergence: {},
    conclusion: {}
  };
  
  // ═══════════════════════════════════════════════════════════
  // STEP 1: FETCH RAW API - CAMPAIGN SPECIFIC
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 1] Fetching raw API for campaign 479360465...");
  
  try {
    var apiResponse = shopeeGet("/api/v2/ads/get_product_campaign_daily_performance", {
      campaign_id_list: "479360465",
      start_date: "07-07-2026",
      end_date: "07-07-2026"
    });
    
    Logger.log("[API] Full response: " + JSON.stringify(apiResponse, null, 2));
    
    if (apiResponse && apiResponse.response && Array.isArray(apiResponse.response.campaign_list)) {
      var campaignData = apiResponse.response.campaign_list.find(function(c) {
        return String(c.campaign_id) === "479360465";
      });
      
      if (campaignData && Array.isArray(campaignData.metrics_list)) {
        var metrics = campaignData.metrics_list.find(function(m) {
          return String(m.date) === "07-07-2026";
        });
        
        if (metrics) {
          report.rawApi = {
            campaign_id: String(campaignData.campaign_id),
            date: String(metrics.date),
            broad_gmv: metrics.broad_gmv !== undefined ? metrics.broad_gmv : "NOT AVAILABLE",
            direct_order: metrics.direct_order !== undefined ? metrics.direct_order : "NOT AVAILABLE",
            broad_order: metrics.broad_order !== undefined ? metrics.broad_order : "NOT AVAILABLE",
            broad_order_amount: metrics.broad_order_amount !== undefined ? metrics.broad_order_amount : "NOT AVAILABLE",
            broad_item_sold: metrics.broad_item_sold !== undefined ? metrics.broad_item_sold : "NOT AVAILABLE",
            direct_item_sold: metrics.direct_item_sold !== undefined ? metrics.direct_item_sold : "NOT AVAILABLE",
            expense: metrics.expense !== undefined ? metrics.expense : "NOT AVAILABLE",
            clicks: metrics.clicks !== undefined ? metrics.clicks : "NOT AVAILABLE",
            impression: metrics.impression !== undefined ? metrics.impression : "NOT AVAILABLE"
          };
          
          Logger.log("[API] Campaign 479360465 found:");
          Logger.log("  broad_gmv: " + report.rawApi.broad_gmv);
          Logger.log("  direct_order: " + report.rawApi.direct_order);
          Logger.log("  broad_order: " + report.rawApi.broad_order);
          Logger.log("  broad_item_sold: " + report.rawApi.broad_item_sold);
          Logger.log("  expense: " + report.rawApi.expense);
          Logger.log("  clicks: " + report.rawApi.clicks);
          Logger.log("  impression: " + report.rawApi.impression);
        } else {
          report.rawApi.error = "No metrics found for date 07-07-2026";
          Logger.log("[API] ERROR: No metrics found for 07-07-2026");
        }
      } else {
        report.rawApi.error = "No metrics_list in campaign data";
        Logger.log("[API] ERROR: No metrics_list found");
      }
    } else {
      report.rawApi.error = "API response structure unexpected";
      Logger.log("[API] ERROR: Unexpected response structure");
    }
  } catch (apiError) {
    report.rawApi.error = apiError.toString();
    Logger.log("[API] ERROR: " + apiError.toString());
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 2: FETCH SHOP TOTAL (for comparison)
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 2] Fetching shop total for 07/07/2026...");
  
  try {
    var shopTotalResponse = shopeeGet("/api/v2/ads/get_all_cpc_ads_daily_performance", {
      start_date: "07-07-2026",
      end_date: "07-07-2026"
    });
    
    Logger.log("[SHOP TOTAL] Full response: " + JSON.stringify(shopTotalResponse, null, 2));
    
    if (shopTotalResponse && Array.isArray(shopTotalResponse.response)) {
      var shopMetrics = shopTotalResponse.response.find(function(item) {
        return String(item.date) === "07-07-2026";
      });
      
      if (shopMetrics) {
        report.shopTotal = {
          date: String(shopMetrics.date),
          broad_gmv: shopMetrics.broad_gmv !== undefined ? shopMetrics.broad_gmv : "NOT AVAILABLE",
          direct_order: shopMetrics.direct_order !== undefined ? shopMetrics.direct_order : "NOT AVAILABLE",
          broad_order: shopMetrics.broad_order !== undefined ? shopMetrics.broad_order : "NOT AVAILABLE",
          broad_item_sold: shopMetrics.broad_item_sold !== undefined ? shopMetrics.broad_item_sold : "NOT AVAILABLE",
          expense: shopMetrics.expense !== undefined ? shopMetrics.expense : "NOT AVAILABLE",
          clicks: shopMetrics.clicks !== undefined ? shopMetrics.clicks : "NOT AVAILABLE",
          impression: shopMetrics.impression !== undefined ? shopMetrics.impression : "NOT AVAILABLE"
        };
        
        Logger.log("[SHOP TOTAL] Found:");
        Logger.log("  broad_gmv: " + report.shopTotal.broad_gmv);
        Logger.log("  broad_order: " + report.shopTotal.broad_order);
        Logger.log("  broad_item_sold: " + report.shopTotal.broad_item_sold);
        Logger.log("  expense: " + report.shopTotal.expense);
      } else {
        report.shopTotal.error = "No data for 07-07-2026";
        Logger.log("[SHOP TOTAL] ERROR: No data found");
      }
    }
  } catch (shopError) {
    report.shopTotal.error = shopError.toString();
    Logger.log("[SHOP TOTAL] ERROR: " + shopError.toString());
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 3: READ ADS_PRODUCT_DAILY
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 3] Reading Ads_Product_Daily...");
  
  try {
    var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    Logger.log("[DB] Total rows in Ads_Product_Daily: " + dailyObjects.length);
    
    var foundDaily = dailyObjects.filter(function(d) {
      var isoDate = parseAdsDateToISO(getPropCaseInsensitive(d, "ReportDate") || getPropCaseInsensitive(d, "Date"));
      var cId = cleanText(getPropCaseInsensitive(d, "CampaignID"));
      return isoDate === "2026-07-07" && cId === "479360465";
    });
    
    if (foundDaily.length > 0) {
      var row = foundDaily[0];
      report.adsProductDaily = {
        ReportDate: getPropCaseInsensitive(row, "ReportDate") || getPropCaseInsensitive(row, "Date"),
        CampaignID: getPropCaseInsensitive(row, "CampaignID"),
        CampaignName: getPropCaseInsensitive(row, "CampaignName"),
        JenisIklan: getPropCaseInsensitive(row, "JenisIklan"),
        ItemID: getPropCaseInsensitive(row, "ItemID"),
        Sales: getPropCaseInsensitive(row, "Sales"),
        Orders: getPropCaseInsensitive(row, "Orders"),
        SoldQty: getPropCaseInsensitive(row, "SoldQty"),
        Spend: getPropCaseInsensitive(row, "Spend"),
        Clicks: getPropCaseInsensitive(row, "Clicks"),
        Impressions: getPropCaseInsensitive(row, "Impressions"),
        ROAS: getPropCaseInsensitive(row, "ROAS"),
        CTR: getPropCaseInsensitive(row, "CTR")
      };
      
      Logger.log("[Ads_Product_Daily] Found row:");
      Logger.log("  CampaignID: " + report.adsProductDaily.CampaignID);
      Logger.log("  CampaignName: " + report.adsProductDaily.CampaignName);
      Logger.log("  Sales: " + report.adsProductDaily.Sales);
      Logger.log("  Orders: " + report.adsProductDaily.Orders);
      Logger.log("  SoldQty: " + report.adsProductDaily.SoldQty);
      Logger.log("  Spend: " + report.adsProductDaily.Spend);
      Logger.log("  Clicks: " + report.adsProductDaily.Clicks);
      Logger.log("  Impressions: " + report.adsProductDaily.Impressions);
    } else {
      report.adsProductDaily.error = "No row found for 2026-07-07 + CampaignID 479360465";
      Logger.log("[Ads_Product_Daily] ERROR: No row found");
    }
  } catch (dbError) {
    report.adsProductDaily.error = dbError.toString();
    Logger.log("[Ads_Product_Daily] ERROR: " + dbError.toString());
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 4: READ ADS_REPORT
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 4] Reading Ads_Report...");
  
  try {
    var reportObjects = readSheetObjects(ADS_REPORT_SHEET) || [];
    Logger.log("[DB] Total rows in Ads_Report: " + reportObjects.length);
    
    var foundReport = reportObjects.filter(function(r) {
      var rdRaw = r["ReportDate"] || r["Tanggal"];
      var rdIso = parseAdsDateToISO(rdRaw);
      var parts = rdIso ? rdIso.split("-") : [];
      var reportDate = parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : "";
      var cId = cleanText(r["CampaignID"]);
      return reportDate === "07/07/2026" && cId === "479360465";
    });
    
    if (foundReport.length > 0) {
      var rRow = foundReport[0];
      report.adsReport = {
        ReportDate: rRow["ReportDate"] || rRow["Tanggal"],
        CampaignID: rRow["CampaignID"],
        CampaignName: rRow["CampaignName"],
        JenisIklan: rRow["JenisIklan"],
        ItemID: rRow["ItemID"],
        Sales: rRow["Sales"],
        Orders: rRow["Orders"],
        SoldQty: rRow["SoldQty"],
        Spend: rRow["Spend"],
        Clicks: rRow["Clicks"],
        Impressions: rRow["Impressions"],
        ROAS: rRow["ROAS"],
        CTR: rRow["CTR"]
      };
      
      Logger.log("[Ads_Report] Found row:");
      Logger.log("  CampaignID: " + report.adsReport.CampaignID);
      Logger.log("  CampaignName: " + report.adsReport.CampaignName);
      Logger.log("  Sales: " + report.adsReport.Sales);
      Logger.log("  Orders: " + report.adsReport.Orders);
      Logger.log("  SoldQty: " + report.adsReport.SoldQty);
      Logger.log("  Spend: " + report.adsReport.Spend);
    } else {
      report.adsReport.error = "No row found for 07/07/2026 + CampaignID 479360465";
      Logger.log("[Ads_Report] ERROR: No row found");
    }
  } catch (reportError) {
    report.adsReport.error = reportError.toString();
    Logger.log("[Ads_Report] ERROR: " + reportError.toString());
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 5: COMPARISON TABLE
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 5] Building comparison table...");
  
  report.comparison = {
    sales: {
      rawApi: report.rawApi.broad_gmv,
      adsProductDaily: report.adsProductDaily.Sales,
      adsReport: report.adsReport.Sales
    },
    orders: {
      rawApi_direct: report.rawApi.direct_order,
      rawApi_broad: report.rawApi.broad_order,
      adsProductDaily: report.adsProductDaily.Orders,
      adsReport: report.adsReport.Orders
    },
    soldQty: {
      rawApi: report.rawApi.broad_item_sold,
      adsProductDaily: report.adsProductDaily.SoldQty,
      adsReport: report.adsReport.SoldQty
    },
    spend: {
      rawApi: report.rawApi.expense,
      adsProductDaily: report.adsProductDaily.Spend,
      adsReport: report.adsReport.Spend
    },
    clicks: {
      rawApi: report.rawApi.clicks,
      adsProductDaily: report.adsProductDaily.Clicks,
      adsReport: report.adsReport.Clicks
    },
    impressions: {
      rawApi: report.rawApi.impression,
      adsProductDaily: report.adsProductDaily.Impressions,
      adsReport: report.adsReport.Impressions
    }
  };
  
  Logger.log("\n=== COMPARISON TABLE ===");
  Logger.log("Sales:");
  Logger.log("  Raw API (broad_gmv): " + report.comparison.sales.rawApi);
  Logger.log("  Ads_Product_Daily: " + report.comparison.sales.adsProductDaily);
  Logger.log("  Ads_Report: " + report.comparison.sales.adsReport);
  Logger.log("Orders:");
  Logger.log("  Raw API (direct_order): " + report.comparison.orders.rawApi_direct);
  Logger.log("  Raw API (broad_order): " + report.comparison.orders.rawApi_broad);
  Logger.log("  Ads_Product_Daily: " + report.comparison.orders.adsProductDaily);
  Logger.log("  Ads_Report: " + report.comparison.orders.adsReport);
  Logger.log("Spend:");
  Logger.log("  Raw API (expense): " + report.comparison.spend.rawApi);
  Logger.log("  Ads_Product_Daily: " + report.comparison.spend.adsProductDaily);
  Logger.log("  Ads_Report: " + report.comparison.spend.adsReport);
  
  // ═══════════════════════════════════════════════════════════
  // STEP 6: IDENTIFY FIRST POINT OF DIVERGENCE
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 6] Identifying first point of divergence...");
  
  var apiSales = parseFloat(report.rawApi.broad_gmv) || 0;
  var dbSales = parseFloat(report.adsProductDaily.Sales) || 0;
  var reportSales = parseFloat(report.adsReport.Sales) || 0;
  
  if (apiSales === 0 && dbSales === 0 && reportSales === 0) {
    report.divergence = {
      status: "NO_DIVERGENCE",
      message: "API, Ads_Product_Daily, and Ads_Report all show Sales = 0",
      conclusion: "DATA IS CONSISTENT. No bug in pipeline. Joia genuinely had no attributed sales."
    };
  } else if (apiSales > 0 && dbSales === 0) {
    report.divergence = {
      status: "DIVERGENCE_FOUND",
      layer: "API_TO_DATABASE",
      message: "API shows Sales > 0 but Ads_Product_Daily shows Sales = 0",
      apiValue: apiSales,
      dbValue: dbSales,
      conclusion: "BUG IN PIPELINE: Data loss between API fetch and database write"
    };
  } else if (apiSales === 0 && dbSales > 0) {
    report.divergence = {
      status: "DIVERGENCE_FOUND",
      layer: "UNEXPECTED",
      message: "API shows Sales = 0 but Ads_Product_Daily shows Sales > 0",
      apiValue: apiSales,
      dbValue: dbSales,
      conclusion: "UNEXPECTED: Database has data not from API (historical data?)"
    };
  } else if (dbSales > 0 && reportSales === 0) {
    report.divergence = {
      status: "DIVERGENCE_FOUND",
      layer: "DATABASE_TO_REPORT",
      message: "Ads_Product_Daily shows Sales > 0 but Ads_Report shows Sales = 0",
      dbValue: dbSales,
      reportValue: reportSales,
      conclusion: "BUG IN rebuildAdsReport(): Data loss during report generation"
    };
  } else if (apiSales > 0 && dbSales > 0 && reportSales > 0) {
    report.divergence = {
      status: "NO_ISSUE",
      message: "All layers show Sales > 0",
      conclusion: "NO BUG. Data flows correctly."
    };
  }
  
  Logger.log("\n=== DIVERGENCE ANALYSIS ===");
  Logger.log("Status: " + report.divergence.status);
  Logger.log("Message: " + report.divergence.message);
  Logger.log("Conclusion: " + report.divergence.conclusion);
  
  // ═══════════════════════════════════════════════════════════
  // STEP 7: ORIGIN OF Rp145.500 / Rp145.485
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n[STEP 7] Analyzing origin of Rp145.500...");
  
  var shopTotalSales = parseFloat(report.shopTotal.broad_gmv) || 0;
  
  if (apiSales > 145000 && apiSales < 146000) {
    report.conclusion.rp145500 = "Campaign API broad_gmv = " + apiSales + " (matches Rp145.485)";
  } else if (shopTotalSales > 4000000) {
    report.conclusion.rp145500 = "Shop total broad_gmv = " + shopTotalSales + " (Rp145.485 likely from different source)";
  } else {
    report.conclusion.rp145500 = "Rp145.485 origin unknown. Not found in campaign API or shop total.";
  }
  
  Logger.log("Origin analysis: " + report.conclusion.rp145500);
  
  // ═══════════════════════════════════════════════════════════
  // FINAL OUTPUT
  // ═══════════════════════════════════════════════════════════
  Logger.log("\n=================================================================");
  Logger.log("PHASE 2 READ-ONLY VERIFICATION COMPLETE");
  Logger.log("=================================================================");
  Logger.log("\nFull Report:");
  Logger.log(JSON.stringify(report, null, 2));
  
  return report;
}
```

---

## EXECUTION INSTRUCTIONS

1. Open Google Apps Script Editor
2. Paste the function above
3. Run: `phase2ReadOnlyVerification()`
4. Check execution log for full output
5. Save log output to file

---

## EXPECTED OUTPUT

The script will generate a comprehensive JSON report with:

```json
{
  "timestamp": "2026-08-24T04:50:00.000Z",
  "targetDate": "07/07/2026",
  "targetCampaignId": "479360465",
  "rawApi": {
    "campaign_id": "479360465",
    "broad_gmv": 0 OR 145485 OR "NOT AVAILABLE",
    "direct_order": ?,
    "expense": 59028,
    ...
  },
  "adsProductDaily": {
    "Sales": 0 OR ?,
    "Orders": 0 OR ?,
    ...
  },
  "adsReport": {
    "Sales": 0 OR ?,
    ...
  },
  "comparison": {
    "sales": {
      "rawApi": ?,
      "adsProductDaily": ?,
      "adsReport": ?
    }
  },
  "divergence": {
    "status": "NO_DIVERGENCE" OR "DIVERGENCE_FOUND",
    "layer": "API_TO_DATABASE" OR "DATABASE_TO_REPORT",
    "conclusion": "..."
  }
}
```

---

## POST-EXECUTION ANALYSIS

After running the script, we will determine:

1. ✅ What does raw API actually return for `broad_gmv`?
2. ✅ Does database match API response?
3. ✅ Where does Rp145.485 come from?
4. ✅ Is this a bug or correct data?
5. ✅ What is the first point of divergence (if any)?

---

**READY TO EXECUTE?**

Please confirm if you want me to:
- Provide this script for you to run manually in GAS
- OR if you have access to run it, execute and share the output
- OR if you prefer a different approach

**Status:** AWAITING APPROVAL TO EXECUTE READ-ONLY VERIFICATION
