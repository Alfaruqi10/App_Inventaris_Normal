// ============================================================
// BusinessAnalytics/core/Scheduler.gs — Time-Driven Scheduler
// ============================================================

/**
 * Setup time-driven triggers for Business Intelligence analytics calculations.
 * Runs daily at midnight / early morning hours (00:30, 02:00, 03:00 equivalents).
 */
function setupAnalyticsScheduler() {
  // Clear any existing triggers for analytics
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const handler = t.getHandlerFunction();
    if (handler === "runDailyAnalyticsJob") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 1. Run full recalculation daily at 00:30 AM (Spreadsheet local time zone)
  ScriptApp.newTrigger("runDailyAnalyticsJob")
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(30)
    .create();

  Logger.log("[Scheduler] Triggers for Business Analytics successfully configured.");
}

/**
 * Handler function triggered daily.
 */
function runDailyAnalyticsJob() {
  Logger.log("[Scheduler] Starting scheduled daily analytics recalculation...");
  try {
    const result = calculateAllAnalytics();
    Logger.log("[Scheduler] Daily analytics job completed: " + JSON.stringify(result));
  } catch (e) {
    Logger.error("[Scheduler] Error in daily analytics job: " + e.toString());
  }

  // Reuse the existing daily trigger; stock alert failures must not block BI.
  try {
    const stockResult = runStockProductionDailyCheck();
    Logger.log("[Scheduler] Daily stock/production check: " + JSON.stringify(stockResult));
  } catch (stockError) {
    Logger.log("[Scheduler] Stock/production check failed: " + stockError.toString());
  }
}
