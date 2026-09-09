// ============================================================
// RecoveryCenter/core/executor.gs — Recovery Executor
// ============================================================

/**
 * executeRecoveryTool - Executor utama untuk menjalankan recovery lifecycle.
 * Dipanggil dari doPost di code.gs.
 * 
 * @param {string} toolId - ID tool yang didaftarkan di registry
 * @param {Object} options - Opsi eksekusi (auth, ownerPassword, parameter tool)
 * @return {Object} RecoveryResponse JSON format standar
 */
function executeRecoveryTool(toolId, options) {
  var t0 = new Date().getTime();
  var jobId = generateRecoveryJobId();
  var auth = options.auth || {};
  var userEmail = auth.userEmail || "Admin";

  console.log("[RecoveryExecutor] Memulai eksekusi job ID: " + jobId + " | Tool: " + toolId);

  // 1. Dapatkan Tool dari Registry
  var tool = RecoveryToolRegistry.getTool(toolId);
  if (!tool) {
    var errMessage = "Gagal Eksekusi: Tool ID '" + toolId + "' tidak terdaftar di registry.";
    console.error("[RecoveryExecutor ERROR] " + errMessage);
    return createRecoveryResponse({
      status: "failed",
      message: errMessage,
      duration: formatRecoveryDuration(t0)
    });
  }

  // Initialize data objek log audit & job history
  var auditData = {
    jobId:           jobId,
    toolId:          toolId,
    category:        tool.category,
    user:            userEmail,
    status:          "failed",
    previewResult:   "",
    executionResult: "",
    successCount:    0,
    failedCount:     0,
    duration:        "0.0s",
    rollbackStatus:  "NOT_SUPPORTED",
    errorMessage:    ""
  };

  var jobData = {
    id:              jobId,
    toolId:          toolId,
    startTime:       t0,
    user:            userEmail,
    status:          "failed",
    previewResult:   "",
    executionResult: "",
    affectedRows:    0,
    errors:          []
  };

  // 2. Jalankan Permission Validation
  var validation = RecoveryPermissionValidator.validate(tool, options);
  if (!validation.valid) {
    console.warn("[RecoveryExecutor] Izin ditolak: " + validation.message);
    auditData.status = "failed";
    auditData.errorMessage = "Permission Denied: " + validation.message;
    auditData.duration = formatRecoveryDuration(t0);
    RecoveryAuditLogger.log(auditData);

    return createRecoveryResponse({
      status: "failed",
      message: validation.message,
      duration: formatRecoveryDuration(t0)
    });
  }

  // 3. Cek Mode Simulasi (Preview)
  if (options.preview && tool.supportsPreview) {
    var previewResult = RecoveryPreviewEngine.run(tool, options, t0);
    
    // Simpan data audit
    auditData.status = "preview";
    auditData.previewResult = previewResult.message;
    auditData.affectedRows = previewResult.affectedRows;
    auditData.successCount = previewResult.successCount;
    auditData.failedCount = previewResult.failedCount;
    auditData.duration = previewResult.duration;
    RecoveryAuditLogger.log(auditData);

    // Simpan riwayat job
    jobData.status = "preview";
    jobData.finishTime = new Date().getTime();
    jobData.duration = previewResult.duration;
    jobData.previewResult = previewResult.message;
    jobData.affectedRows = previewResult.affectedRows;
    RecoveryJobHistory.record(jobData);

    return previewResult;
  }

  // 4. Jalankan Transaksi Eksekusi Sebenarnya
  var lockAcquired = false;
  var rollbackState = null;

  try {
    // A. Dapatkan Lock
    lockAcquired = RecoveryLockManager.acquire(tool);

    // B. Simpan State Awal untuk Rollback jika didukung
    if (tool.supportsRollback && typeof tool.handlerFunction === "function") {
      // Dapatkan data state awal (misal membaca sheet sebelum diedit)
      if (typeof tool.rollbackFunction === "function" || typeof tool.rollbackFunction === "string") {
        console.log("[RecoveryExecutor] Menyimpan state awal untuk potensi rollback.");
        // Tool dapat mendefinisikan mekanisme state capturing dalam opsi atau di-resolve
        rollbackState = {
          orderSn: options.orderSn,
          timestamp: new Date().getTime()
        };
      }
    }

    // C. Panggil Handler Fungsi
    var handler = typeof tool.handlerFunction === "function" 
      ? tool.handlerFunction 
      : (typeof tool.handlerFunction === "string" ? RecoveryPreviewEngine.resolveHandler(tool.handlerFunction) : null);

    if (!handler) {
      throw new Error("Handler function tidak terdaftar dengan benar.");
    }

    console.log("[RecoveryExecutor] Memulai eksekusi handler untuk: " + toolId);
    var execResult = handler(options);
    console.log("[RecoveryExecutor] Eksekusi handler sukses.");

    // D. Buat Standar Respon Sukses
    var successResponse = createRecoveryResponse({
      status:       execResult.status || "success",
      message:      execResult.message || "Tindakan pemeliharaan sukses diselesaikan.",
      affectedRows: execResult.affectedRows || 0,
      successCount: execResult.successCount || 0,
      failedCount:  execResult.failedCount || 0,
      duration:     formatRecoveryDuration(t0),
      metadata:     execResult.metadata || {}
    });

    // Update log audit & riwayat job
    auditData.status = successResponse.status;
    auditData.executionResult = successResponse.message;
    auditData.affectedRows = successResponse.affectedRows;
    auditData.successCount = successResponse.successCount;
    auditData.failedCount = successResponse.failedCount;
    auditData.duration = successResponse.duration;
    RecoveryAuditLogger.log(auditData);

    jobData.status = successResponse.status;
    jobData.finishTime = new Date().getTime();
    jobData.duration = successResponse.duration;
    jobData.executionResult = successResponse.message;
    jobData.affectedRows = successResponse.affectedRows;
    RecoveryJobHistory.record(jobData);

    return successResponse;

  } catch (e) {
    var errorMsg = e.toString();
    console.error("[RecoveryExecutor ERROR] Kegagalan eksekusi tool " + toolId + ": " + errorMsg);

    // E. Jalankan Rollback jika didukung
    var rollbackStatus = "NOT_SUPPORTED";
    if (tool.supportsRollback) {
      var rollbackRes = RecoveryRollbackManager.rollback(tool, rollbackState);
      rollbackStatus = rollbackRes.success ? "SUCCESS" : "FAILED (" + rollbackRes.reason + ")";
    }

    // Update log audit & riwayat job dengan status gagal
    auditData.status = "failed";
    auditData.errorMessage = errorMsg;
    auditData.rollbackStatus = rollbackStatus;
    auditData.duration = formatRecoveryDuration(t0);
    RecoveryAuditLogger.log(auditData);

    jobData.status = "failed";
    jobData.finishTime = new Date().getTime();
    jobData.duration = formatRecoveryDuration(t0);
    jobData.errors = [errorMsg];
    RecoveryJobHistory.record(jobData);

    return createRecoveryResponse({
      status: "failed",
      message: "Tindakan pemeliharaan gagal: " + errorMsg + " | Status Rollback: " + rollbackStatus,
      duration: formatRecoveryDuration(t0),
      errors: [errorMsg],
      metadata: { rollbackStatus: rollbackStatus }
    });

  } finally {
    // F. Selalu Release Lock di bagian akhir
    if (lockAcquired) {
      RecoveryLockManager.release();
    }
  }
}
