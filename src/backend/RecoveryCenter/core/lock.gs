// ============================================================
// RecoveryCenter/core/lock.gs — Lock Manager
// ============================================================

var RecoveryLockManager = (function() {
  var activeLock = null;

  return {
    /**
     * Meminta script lock eksklusif untuk menghindari balapan data (race condition).
     * @param {Object} tool - Konfigurasi tool
     * @param {number} [timeoutMs] - Waktu maksimal antrean (default 15000ms)
     * @return {boolean} true jika lock berhasil didapatkan, throw jika gagal/timeout
     */
    acquire: function(tool, timeoutMs) {
      if (!tool.requiresLock) {
        console.log("[RecoveryLock] Tool " + tool.toolId + " tidak memerlukan penguncian database. Lewati.");
        return true;
      }

      var limit = timeoutMs || 15000;
      console.log("[RecoveryLock] Meminta kunci database untuk " + tool.toolId + " (Timeout: " + limit + "ms)...");

      try {
        activeLock = LockService.getScriptLock();
        activeLock.waitLock(limit);
        console.log("[RecoveryLock] Kunci database berhasil didapatkan.");
        return true;
      } catch (e) {
        console.error("[RecoveryLock ERROR] Gagal mendapatkan kunci database: " + e.toString());
        throw new Error("Sistem sedang sibuk memproses antrean transaksi lain. Silakan coba beberapa saat lagi.");
      }
    },

    /**
     * Melepaskan kunci database. Selalu jalankan di blok finally.
     */
    release: function() {
      if (activeLock) {
        try {
          if (activeLock.hasLock()) {
            activeLock.releaseLock();
            console.log("[RecoveryLock] Kunci database telah dilepaskan.");
          }
        } catch (e) {
          console.error("[RecoveryLock ERROR] Gagal melepaskan kunci: " + e.toString());
        } finally {
          activeLock = null;
        }
      }
    }
  };
})();
