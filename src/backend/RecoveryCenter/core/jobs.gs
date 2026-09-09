// ============================================================
// RecoveryCenter/core/jobs.gs — Job History Manager
// ============================================================

var RecoveryJobHistory = (function() {
  
  var PROPERTY_KEY = "RECOVERY_JOB_HISTORY";
  var MAX_HISTORY = 50; // Menyimpan maksimal 50 job terakhir

  return {
    /**
     * Menyimpan data job baru ke dalam riwayat eksekusi.
     * @param {Object} job - Objek RecoveryJob
     */
    record: function(job) {
      console.log("[RecoveryJob] Mencatat riwayat untuk job: " + job.id);
      
      try {
        var history = this.getHistory();
        
        // Sisipkan di bagian paling atas (terbaru)
        history.unshift({
          id:              job.id,
          toolId:          job.toolId,
          startTime:       job.startTime,
          finishTime:      job.finishTime || new Date().getTime(),
          duration:        job.duration || "0.0s",
          status:          job.status || "failed",
          user:            job.user || "System",
          previewResult:   job.previewResult || "",
          executionResult: job.executionResult || "",
          affectedRows:    job.affectedRows || 0,
          errors:          job.errors || []
        });

        // Batasi ukuran riwayat
        if (history.length > MAX_HISTORY) {
          history = history.slice(0, MAX_HISTORY);
        }

        // Simpan kembali ke Script Properties
        PropertiesService.getScriptProperties().setProperty(PROPERTY_KEY, JSON.stringify(history));
        console.log("[RecoveryJob] Riwayat berhasil diperbarui.");

      } catch (e) {
        console.error("[RecoveryJob ERROR] Gagal menyimpan riwayat job: " + e.toString());
      }
    },

    /**
     * Mengambil riwayat eksekusi job.
     * @return {Array} Daftar job historis
     */
    getHistory: function() {
      try {
        var raw = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEY);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (e) {
        console.error("[RecoveryJob ERROR] Gagal memuat riwayat: " + e.toString());
      }
      return [];
    },

    /**
     * Mengosongkan seluruh riwayat job.
     */
    clearHistory: function() {
      try {
        PropertiesService.getScriptProperties().deleteProperty(PROPERTY_KEY);
        console.log("[RecoveryJob] Seluruh riwayat job berhasil dihapus.");
      } catch (e) {
        console.error("[RecoveryJob ERROR] Gagal mengosongkan riwayat: " + e.toString());
      }
    }
  };
})();
