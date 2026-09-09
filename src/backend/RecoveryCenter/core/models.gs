// ============================================================
// RecoveryCenter/core/models.gs — Standard Response & Job Models
// ============================================================

/**
 * RecoveryResponse - Model respon standar untuk seluruh tool.
 */
function createRecoveryResponse(params) {
  return {
    status:       params.status || "failed", // success, failed, warning, cancelled, preview, rollback
    message:      params.message || "",
    affectedRows: params.affectedRows || 0,
    successCount: params.successCount || 0,
    failedCount:  params.failedCount || 0,
    duration:     params.duration || "0.0s",
    errors:       params.errors || [],
    metadata:     params.metadata || {}
  };
}

/**
 * Helper untuk format durasi eksekusi.
 */
function formatRecoveryDuration(startTimeMs) {
  var diff = new Date().getTime() - startTimeMs;
  return (diff / 1000).toFixed(1) + "s";
}

/**
 * UUID Generator sederhana untuk Job ID.
 */
function generateRecoveryJobId() {
  return "job_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
}
