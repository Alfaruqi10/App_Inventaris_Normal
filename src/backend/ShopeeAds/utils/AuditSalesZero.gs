// ============================================================
// ShopeeAds/utils/AuditSalesZero.gs — Sales = 0 Anomaly Auditor
// ============================================================

/**
 * Scans Ads_Product_Daily for all rows with Sales = 0 but Spend > 0.
 * Cross-references with Ads_Daily_Summary to detect anomalies.
 * Returns list of affected dates and campaigns that need re-sync.
 */
function auditSalesZeroAnomalies() {
  Logger.log("[auditSalesZeroAnomalies] Starting comprehensive Sales=0 audit...");
  
  var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  var summaryObjects = readSheetObjects(ADS_DAILY_SUMMARY_SHEET) || [];
  
  var summaryMap = {};
  summaryObjects.forEach(function(s) {
    var isoDate = parseAdsDateToISO(getPropCaseInsensitive(s, "Date"));
    if (isoDate) {
      summaryMap[isoDate] = {
        spend: cleanNumericValue(getPropCaseInsensitive(s, "Spend")),
        sales: cleanNumericValue(getPropCaseInsensitive(s, "Sales")),
        orders: cleanNumericValue(getPropCaseInsensitive(s, "Orders"))
      };
    }
  });
  
  var anomalies = [];
  var affectedDatesSet = {};
  var affectedCampaignsSet = {};
  
  dailyObjects.forEach(function(d) {
    var isoDate = parseAdsDateToISO(getPropCaseInsensitive(d, "ReportDate") || getPropCaseInsensitive(d, "Date"));
    var cId = cleanText(getPropCaseInsensitive(d, "CampaignID"));
    var cName = cleanText(getPropCaseInsensitive(d, "CampaignName"));
    var spend = cleanNumericValue(getPropCaseInsensitive(d, "Spend"));
    var sales = cleanNumericValue(getPropCaseInsensitive(d, "Sales"));
    var orders = cleanNumericValue(getPropCaseInsensitive(d, "Orders"));
    var clicks = cleanNumericValue(getPropCaseInsensitive(d, "Clicks"));
    
    if (spend > 0 && sales === 0) {
      var summary = summaryMap[isoDate];
      var isAnomaly = false;
      var reason = "";
      
      if (summary && summary.sales > 0) {
        isAnomaly = true;
        reason = "Shop total sales > 0 but individual campaign sales = 0";
      } else if (clicks > 0) {
        isAnomaly = true;
        reason = "Clicks > 0 but Sales = 0 (possible missing conversion data)";
      }
      
      if (isAnomaly) {
        anomalies.push({
          date: isoDate,
          campaignId: cId,
          campaignName: cName,
          spend: spend,
          sales: sales,
          orders: orders,
          clicks: clicks,
          shopTotalSales: summary ? summary.sales : 0,
          reason: reason
        });
        
        affectedDatesSet[isoDate] = true;
        affectedCampaignsSet[cId] = true;
      }
    }
  });
  
  var affectedDates = Object.keys(affectedDatesSet).sort();
  var affectedCampaigns = Object.keys(affectedCampaignsSet);
  
  Logger.log("[auditSalesZeroAnomalies] Audit complete.");
  Logger.log("  Total rows scanned    : " + dailyObjects.length);
  Logger.log("  Anomalies found       : " + anomalies.length);
  Logger.log("  Affected dates        : " + affectedDates.length);
  Logger.log("  Affected campaigns    : " + affectedCampaigns.length);
  
  return {
    status: "success",
    totalRowsScanned: dailyObjects.length,
    anomaliesFound: anomalies.length,
    affectedDates: affectedDates,
    affectedCampaigns: affectedCampaigns,
    anomalies: anomalies,
    summary: {
      earliestDate: affectedDates.length > 0 ? affectedDates[0] : null,
      latestDate: affectedDates.length > 0 ? affectedDates[affectedDates.length - 1] : null,
      totalDaysAffected: affectedDates.length
    }
  };
}

/**
 * Generates a batch re-sync plan for all affected dates.
 * Groups dates into optimal chunks for syncAdsHistoricalRange().
 */
function generateResyncPlan() {
  Logger.log("[generateResyncPlan] Generating re-sync execution plan...");
  
  var auditResult = auditSalesZeroAnomalies();
  
  if (auditResult.affectedDates.length === 0) {
    Logger.log("[generateResyncPlan] No anomalies found. No re-sync needed.");
    return {
      status: "success",
      message: "No anomalies detected. Database is clean.",
      chunks: []
    };
  }
  
  var dates = auditResult.affectedDates;
  var chunks = [];
  var maxChunkDays = 15;
  
  var i = 0;
  while (i < dates.length) {
    var chunkStart = dates[i];
    var chunkEnd = dates[i];
    var daysInChunk = 1;
    
    while (i + 1 < dates.length && daysInChunk < maxChunkDays) {
      var nextDate = dates[i + 1];
      var daysDiff = Math.round((new Date(nextDate) - new Date(dates[i])) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 3) {
        i++;
        chunkEnd = dates[i];
        daysInChunk++;
      } else {
        break;
      }
    }
    
    var startParts = chunkStart.split("-");
    var endParts = chunkEnd.split("-");
    var startDDMMYYYY = startParts[2] + "-" + startParts[1] + "-" + startParts[0];
    var endDDMMYYYY = endParts[2] + "-" + endParts[1] + "-" + endParts[0];
    
    chunks.push({
      startDate: startDDMMYYYY,
      endDate: endDDMMYYYY,
      startISO: chunkStart,
      endISO: chunkEnd,
      daysInChunk: daysInChunk,
      command: "syncAdsHistoricalRange(\"" + startDDMMYYYY + "\", \"" + endDDMMYYYY + "\")"
    });
    
    i++;
  }
  
  Logger.log("[generateResyncPlan] Re-sync plan generated.");
  Logger.log("  Total chunks: " + chunks.length);
  Logger.log("  Date range  : " + auditResult.summary.earliestDate + " to " + auditResult.summary.latestDate);
  
  return {
    status: "success",
    message: "Re-sync plan generated for " + auditResult.affectedDates.length + " affected dates.",
    totalChunks: chunks.length,
    totalDays: auditResult.affectedDates.length,
    dateRange: {
      start: auditResult.summary.earliestDate,
      end: auditResult.summary.latestDate
    },
    chunks: chunks,
    auditSummary: auditResult.summary
  };
}

/**
 * Executes the complete fix pipeline:
 * 1. Audit anomalies
 * 2. Generate re-sync plan
 * 3. Execute re-sync for all affected dates
 * 4. Rebuild Ads_Report
 * 5. Verify fix
 */
function executeCompleteSalesZeroFix() {
  Logger.log("============================================================");
  Logger.log("[executeCompleteSalesZeroFix] STARTING COMPLETE FIX PIPELINE");
  Logger.log("============================================================");
  
  var startTime = new Date().getTime();
  
  var plan = generateResyncPlan();
  
  if (plan.chunks.length === 0) {
    Logger.log("[executeCompleteSalesZeroFix] No fixes needed.");
    return {
      status: "success",
      message: "No anomalies detected. Database is clean.",
      executionTime: (new Date().getTime() - startTime) + "ms"
    };
  }
  
  Logger.log("[executeCompleteSalesZeroFix] Executing " + plan.chunks.length + " re-sync chunks...");
  
  var results = [];
  
  for (var i = 0; i < plan.chunks.length; i++) {
    var chunk = plan.chunks[i];
    Logger.log("[executeCompleteSalesZeroFix] Chunk " + (i + 1) + "/" + plan.chunks.length + ": " + chunk.startDate + " to " + chunk.endDate);
    
    try {
      var syncResult = syncAdsHistoricalRange(chunk.startDate, chunk.endDate);
      results.push({
        chunk: i + 1,
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        status: syncResult.status,
        rowsSynced: syncResult.totalDailyRows || 0
      });
      Logger.log("[executeCompleteSalesZeroFix] Chunk " + (i + 1) + " completed: " + syncResult.status);
    } catch (e) {
      Logger.log("[executeCompleteSalesZeroFix] Chunk " + (i + 1) + " FAILED: " + e.toString());
      results.push({
        chunk: i + 1,
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        status: "error",
        error: e.toString()
      });
    }
  }
  
  Logger.log("[executeCompleteSalesZeroFix] All chunks completed. Rebuilding Ads_Report...");
  var reportCount = rebuildAdsReport();
  
  Logger.log("[executeCompleteSalesZeroFix] Running post-fix verification...");
  var verifyResult = auditSalesZeroAnomalies();
  
  var executionTime = (new Date().getTime() - startTime) / 1000;
  
  Logger.log("============================================================");
  Logger.log("[executeCompleteSalesZeroFix] COMPLETE FIX PIPELINE FINISHED");
  Logger.log("  Total chunks executed   : " + plan.chunks.length);
  Logger.log("  Ads_Report rebuilt      : " + reportCount + " rows");
  Logger.log("  Remaining anomalies     : " + verifyResult.anomaliesFound);
  Logger.log("  Execution time          : " + executionTime.toFixed(2) + "s");
  Logger.log("============================================================");
  
  return {
    status: "success",
    message: "Complete Sales=0 fix pipeline executed successfully.",
    totalChunks: plan.chunks.length,
    totalDaysFixed: plan.totalDays,
    reportRowsRebuilt: reportCount,
    remainingAnomalies: verifyResult.anomaliesFound,
    executionTime: executionTime.toFixed(2) + "s",
    chunkResults: results,
    verification: {
      totalRowsScanned: verifyResult.totalRowsScanned,
      anomaliesFound: verifyResult.anomaliesFound,
      affectedDates: verifyResult.affectedDates.length
    }
  };
}

/**
 * Quick fix for a single date (e.g., 07/07/2026).
 */
function fixSalesZeroForDate(dateStr) {
  Logger.log("[fixSalesZeroForDate] Fixing Sales=0 for date: " + dateStr);
  
  var syncResult = syncAdsHistoricalRange(dateStr, dateStr);
  
  Logger.log("[fixSalesZeroForDate] Re-sync completed. Rebuilding Ads_Report...");
  var reportCount = rebuildAdsReport();
  
  Logger.log("[fixSalesZeroForDate] Verifying fix...");
  var auditResult = auditSalesZeroAnomalies();
  
  var remainingAnomaliesForDate = auditResult.anomalies.filter(function(a) {
    var parts = a.date.split("-");
    var ddmmyyyy = parts[2] + "/" + parts[1] + "/" + parts[0];
    return ddmmyyyy === dateStr || a.date === dateStr;
  });
  
  Logger.log("[fixSalesZeroForDate] Fix completed.");
  Logger.log("  Date                    : " + dateStr);
  Logger.log("  Sync status             : " + syncResult.status);
  Logger.log("  Ads_Report rebuilt      : " + reportCount + " rows");
  Logger.log("  Remaining anomalies     : " + remainingAnomaliesForDate.length);
  
  return {
    status: "success",
    message: "Sales=0 fix completed for " + dateStr,
    date: dateStr,
    syncResult: syncResult,
    reportRowsRebuilt: reportCount,
    remainingAnomalies: remainingAnomaliesForDate.length,
    anomalies: remainingAnomaliesForDate
  };
}
