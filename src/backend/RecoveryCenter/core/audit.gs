// ============================================================
// RecoveryCenter/core/audit.gs — Audit Logger
// ============================================================

var RecoveryAuditLogger = (function() {
  
  var SYSTEM_AUDIT_SHEET = "DeductionAudit"; // Reuse sheet log audit yang sudah ada

  return {
    /**
     * Menulis entri log audit recovery secara aman ke spreadsheet.
     * @param {Object} auditData - Objek berisi semua informasi audit
     */
    log: function(auditData) {
      console.log("[RecoveryAudit] Menulis audit log untuk job: " + auditData.jobId);
      
      try {
        ensureDatabase(); // Pastikan database dan sheet diinisialisasi
        
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName(SYSTEM_AUDIT_SHEET);
        if (!sheet) {
          console.warn("[RecoveryAudit] Sheet " + SYSTEM_AUDIT_SHEET + " tidak ditemukan. Lewati.");
          return;
        }

        // Format pesan catatan audit lengkap
        var note = "[Recovery Center] " +
                   "Preview: " + (auditData.previewResult || "-") + " | " +
                   "Exec: " + (auditData.executionResult || "-") + " | " +
                   "Success: " + (auditData.successCount || 0) + " | " +
                   "Failed: " + (auditData.failedCount || 0) + " | " +
                   "Dur: " + (auditData.duration || "0.0s") + " | " +
                   "Rollback: " + (auditData.rollbackStatus || "-") + " | " +
                   "Err: " + (auditData.errorMessage || "-");

        // Format entri sheet DeductionAudit:
        // Column: [Timestamp, Order SN, Action, Old Status, New Status, Reason, Note, User, Ext1]
        // (menyesuaikan format kolom asli sheet DeductionAudit di code.gs L2437)
        sheet.appendRow([
          new Date(),
          auditData.jobId, // Simpan Job ID di kolom Order SN
          auditData.toolId, // Simpan Tool ID di kolom Action
          auditData.status === "preview" ? "PREVIEW" : "EXECUTE", // Old Status
          auditData.status, // New Status
          auditData.category, // Reason
          note, // Note
          auditData.user || "System", // User
          "" // Ext1
        ]);
        
        SpreadsheetApp.flush();
        console.log("[RecoveryAudit] Log berhasil ditulis ke " + SYSTEM_AUDIT_SHEET);

      } catch (e) {
        console.error("[RecoveryAudit ERROR] Gagal menulis log audit ke sheet: " + e.toString());
      }
    }
  };
})();
