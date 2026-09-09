// ============================================================
// ShopeeAds/core/Phase2JoiaAuditRunner.gs — Execution Wrapper
// ============================================================
//
// WRAPPER FUNCTION untuk menjalankan Phase 2 Joia Audit
// dari environment Kiro menggunakan existing production infrastructure.
//
// USAGE:
// 1. Deploy script ini ke Google Apps Script project
// 2. Run function: executePhase2JoiaAudit()
// 3. Check execution log untuk hasil audit
//
// NOTE:
// - 100% READ-ONLY (tidak ada database write)
// - Menggunakan existing shopeeGet, getShopeeTokens, dan helper functions
// - Tidak memerlukan credential baru
// ============================================================

/**
 * MAIN EXECUTION WRAPPER
 * 
 * Function ini adalah entry point untuk menjalankan Phase 2 Joia Audit.
 * Dapat dipanggil langsung dari Apps Script Editor atau via API endpoint.
 */
function executePhase2JoiaAudit() {
  Logger.log("=".repeat(80));
  Logger.log("PHASE 2 JOIA AUDIT — WRAPPER EXECUTION START");
  Logger.log("Execution Time: " + new Date().toISOString());
  Logger.log("=".repeat(80));
  
  try {
    // Pre-flight checks
    Logger.log("\n[PRE-FLIGHT] Running environment checks...");
    const preflightResult = runPreflightChecks();
    
    if (!preflightResult.success) {
      Logger.log("[PRE-FLIGHT] FAILED: " + preflightResult.error);
      return {
        status: "error",
        phase: "preflight",
        message: preflightResult.error,
        timestamp: getJakartaTimeString()
      };
    }
    
    Logger.log("[PRE-FLIGHT] PASSED: All checks OK");
    Logger.log("  - shopeeGet: Available");
    Logger.log("  - getShopeeTokens: Available");
    Logger.log("  - Ads_Product_Daily: Exists");
    Logger.log("  - Ads_Report: Exists");
    Logger.log("  - Ads_Daily_Summary: Exists");
    
    // Execute main audit
    Logger.log("\n[EXECUTION] Starting Phase 2 Joia Audit...");
    const auditResult = runPhase2JoiaAudit();
    
    if (auditResult.status === "success") {
      Logger.log("\n[EXECUTION] Phase 2 Audit COMPLETED SUCCESSFULLY");
      Logger.log("Root Cause: " + auditResult.report.step11_rootCause.case + " - " + auditResult.report.step11_rootCause.title);
      
      // Write summary to a temporary location for easy access
      writeSummaryToTempSheet(auditResult.report);
      
      return {
        status: "success",
        phase: "completed",
        rootCause: auditResult.report.step11_rootCause,
        comparison: auditResult.report.step6_comparison,
        divergence: auditResult.report.step8_divergence,
        recommendations: auditResult.report.step12_recommendation,
        fullReport: auditResult.report,
        timestamp: getJakartaTimeString(),
        message: "Phase 2 Audit completed. Check execution log for detailed report."
      };
      
    } else {
      Logger.log("\n[EXECUTION] Phase 2 Audit FAILED");
      Logger.log("Error: " + auditResult.message);
      
      return {
        status: "error",
        phase: "execution",
        message: auditResult.message,
        report: auditResult.report,
        timestamp: getJakartaTimeString()
      };
    }
    
  } catch (error) {
    Logger.log("\n[FATAL ERROR] " + error.toString());
    Logger.log("Stack: " + error.stack);
    
    return {
      status: "fatal_error",
      phase: "wrapper",
      message: error.toString(),
      stack: error.stack,
      timestamp: getJakartaTimeString()
    };
  }
}

/**
 * PRE-FLIGHT CHECKS
 * 
 * Memverifikasi bahwa semua dependencies dan data sources tersedia
 * sebelum menjalankan audit.
 */
function runPreflightChecks() {
  const result = {
    success: true,
    error: null,
    checks: {
      shopeeGetAvailable: false,
      tokensAvailable: false,
      sheetsExist: false,
      dataAvailable: false
    }
  };
  
  try {
    // Check 1: shopeeGet function
    if (typeof shopeeGet !== "function") {
      result.success = false;
      result.error = "shopeeGet function not available";
      return result;
    }
    result.checks.shopeeGetAvailable = true;
    
    // Check 2: getShopeeTokens function
    if (typeof getShopeeTokens !== "function") {
      result.success = false;
      result.error = "getShopeeTokens function not available";
      return result;
    }
    
    try {
      const tokens = getShopeeTokens();
      if (!tokens || !tokens.shopId) {
        result.success = false;
        result.error = "Shopee tokens not configured properly";
        return result;
      }
      result.checks.tokensAvailable = true;
    } catch (e) {
      result.success = false;
      result.error = "Cannot retrieve Shopee tokens: " + e.toString();
      return result;
    }
    
    // Check 3: Required sheets exist
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const requiredSheets = [
      ADS_PRODUCT_DAILY_SHEET,
      ADS_REPORT_SHEET,
      ADS_DAILY_SUMMARY_SHEET
    ];
    
    for (let i = 0; i < requiredSheets.length; i++) {
      const sheetName = requiredSheets[i];
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        result.success = false;
        result.error = "Required sheet not found: " + sheetName;
        return result;
      }
    }
    result.checks.sheetsExist = true;
    
    // Check 4: Data availability
    const productDailyRows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
    if (productDailyRows.length === 0) {
      result.success = false;
      result.error = "Ads_Product_Daily sheet is empty. Run sync first.";
      return result;
    }
    result.checks.dataAvailable = true;
    
    // All checks passed
    result.success = true;
    return result;
    
  } catch (error) {
    result.success = false;
    result.error = "Preflight check failed: " + error.toString();
    return result;
  }
}

/**
 * WRITE SUMMARY TO TEMPORARY SHEET
 * 
 * Menulis summary hasil audit ke temporary sheet untuk akses mudah.
 * Sheet ini dapat dihapus setelah review selesai.
 */
function writeSummaryToTempSheet(report) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = "Phase2_Joia_Audit_Summary_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss");
    
    // Create new sheet
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    // Write header
    sheet.getRange(1, 1).setValue("PHASE 2 JOIA AUDIT SUMMARY");
    sheet.getRange(1, 1).setFontWeight("bold").setFontSize(14).setBackground("#0369A1").setFontColor("#FFFFFF");
    
    let row = 3;
    
    // Metadata
    sheet.getRange(row++, 1).setValue("METADATA").setFontWeight("bold");
    sheet.getRange(row++, 1, 1, 2).setValues([["Execution Time", report.metadata.executionTime]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Target Date", report.metadata.targetDate]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Target Campaign ID", report.metadata.targetCampaignId]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Target Campaign Name", report.metadata.targetCampaignName]]);
    row++;
    
    // Comparison Matrix
    sheet.getRange(row++, 1).setValue("COMPARISON MATRIX").setFontWeight("bold");
    sheet.getRange(row, 1, 1, 6).setValues([["Field", "Raw API", "Ads_Product_Daily", "Ads_Report", "Shop Total", "Seller Center"]]);
    sheet.getRange(row++, 1, 1, 6).setFontWeight("bold").setBackground("#E5E7EB");
    
    const matrix = report.step6_comparison;
    sheet.getRange(row++, 1, 1, 6).setValues([["Sales", matrix.Sales.raw_api, matrix.Sales.ads_product_daily, matrix.Sales.ads_report, matrix.Sales.shop_total, matrix.Sales.seller_center]]);
    sheet.getRange(row++, 1, 1, 5).setValues([["Orders", matrix.Orders.raw_api, matrix.Orders.ads_product_daily, matrix.Orders.ads_report, matrix.Orders.shop_total]]);
    sheet.getRange(row++, 1, 1, 5).setValues([["SoldQty", matrix.SoldQty.raw_api, matrix.SoldQty.ads_product_daily, matrix.SoldQty.ads_report, matrix.SoldQty.shop_total]]);
    sheet.getRange(row++, 1, 1, 4).setValues([["Spend", matrix.Spend.raw_api, matrix.Spend.ads_product_daily, matrix.Spend.ads_report]]);
    sheet.getRange(row++, 1, 1, 4).setValues([["Clicks", matrix.Clicks.raw_api, matrix.Clicks.ads_product_daily, matrix.Clicks.ads_report]]);
    sheet.getRange(row++, 1, 1, 4).setValues([["Impressions", matrix.Impressions.raw_api, matrix.Impressions.ads_product_daily, matrix.Impressions.ads_report]]);
    row++;
    
    // Divergence
    sheet.getRange(row++, 1).setValue("FIRST POINT OF DIVERGENCE").setFontWeight("bold");
    sheet.getRange(row++, 1, 1, 2).setValues([["Found", report.step8_divergence.found]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Location", report.step8_divergence.location]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Severity", report.step8_divergence.severity]]);
    if (report.step8_divergence.details) {
      sheet.getRange(row++, 1, 1, 2).setValues([["Details", report.step8_divergence.details]]);
    }
    row++;
    
    // Root Cause
    sheet.getRange(row++, 1).setValue("ROOT CAUSE VERDICT").setFontWeight("bold");
    sheet.getRange(row, 1, 1, 2).setValues([[report.step11_rootCause.case, report.step11_rootCause.title]]);
    sheet.getRange(row++, 1, 1, 2).setFontWeight("bold").setBackground("#FEE2E2").setFontColor("#991B1B");
    sheet.getRange(row++, 1, 1, 2).setValues([["Description", report.step11_rootCause.description]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["First Divergence", report.step11_rootCause.firstDivergence]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Severity", report.step11_rootCause.severity]]);
    sheet.getRange(row++, 1, 1, 2).setValues([["Action Required", report.step11_rootCause.actionRequired]]);
    row++;
    
    // Recommendations
    sheet.getRange(row++, 1).setValue("RECOMMENDATIONS").setFontWeight("bold");
    sheet.getRange(row++, 1).setValue("Immediate Actions:").setFontWeight("bold");
    report.step12_recommendation.immediate.forEach(rec => {
      sheet.getRange(row++, 1, 1, 2).setValues([["•", rec]]);
    });
    row++;
    sheet.getRange(row++, 1).setValue("DO NOT:").setFontWeight("bold").setFontColor("#DC2626");
    report.step12_recommendation.doNot.forEach(rec => {
      sheet.getRange(row++, 1, 1, 2).setValues([["⚠", rec]]);
    });
    
    // Auto-resize columns
    sheet.autoResizeColumn(1);
    sheet.autoResizeColumn(2);
    
    Logger.log("[SUMMARY] Written to sheet: " + sheetName);
    
  } catch (error) {
    Logger.log("[SUMMARY] Warning: Could not write summary sheet: " + error.toString());
    // Non-critical error, continue execution
  }
}

/**
 * QUICK STATUS CHECK
 * 
 * Function untuk quick check status tanpa menjalankan full audit.
 * Berguna untuk memverifikasi bahwa environment siap.
 */
function checkPhase2AuditReadiness() {
  Logger.log("=".repeat(80));
  Logger.log("PHASE 2 AUDIT READINESS CHECK");
  Logger.log("=".repeat(80));
  
  const preflightResult = runPreflightChecks();
  
  if (preflightResult.success) {
    Logger.log("\n✅ READY: All preflight checks passed");
    Logger.log("  - shopeeGet: Available");
    Logger.log("  - Tokens: Configured");
    Logger.log("  - Sheets: All exist");
    Logger.log("  - Data: Available");
    Logger.log("\nYou can now run: executePhase2JoiaAudit()");
  } else {
    Logger.log("\n❌ NOT READY: Preflight checks failed");
    Logger.log("Error: " + preflightResult.error);
    Logger.log("\nFix the issue above before running audit.");
  }
  
  Logger.log("=".repeat(80));
  
  return preflightResult;
}

/**
 * CLEANUP FUNCTION
 * 
 * Menghapus temporary summary sheets yang sudah tidak diperlukan.
 */
function cleanupPhase2AuditSummaries() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    let deletedCount = 0;
    
    sheets.forEach(sheet => {
      const name = sheet.getName();
      if (name.indexOf("Phase2_Joia_Audit_Summary_") === 0) {
        ss.deleteSheet(sheet);
        deletedCount++;
        Logger.log("Deleted summary sheet: " + name);
      }
    });
    
    Logger.log("Cleanup complete. Deleted " + deletedCount + " summary sheets.");
    
    return {
      status: "success",
      deletedCount: deletedCount
    };
    
  } catch (error) {
    Logger.log("Cleanup error: " + error.toString());
    return {
      status: "error",
      message: error.toString()
    };
  }
}
