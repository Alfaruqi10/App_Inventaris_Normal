// ============================================================
// RecoveryCenter/core/rollback.gs — Rollback Manager
// ============================================================

var RecoveryRollbackManager = (function() {
  return {
    /**
     * Menjalankan fungsi rollback jika eksekusi tool utama mengalami kegagalan.
     * @param {Object} tool - Konfigurasi tool
     * @param {Object} rollbackState - State atau snapshot data sebelum eksekusi dimulai
     * @return {Object} Status hasil rollback
     */
    rollback: function(tool, rollbackState) {
      console.log("[RecoveryRollback] Memicu alur rollback otomatis untuk: " + tool.toolId);
      
      if (!tool.supportsRollback) {
        console.warn("[RecoveryRollback] Tool " + tool.toolId + " tidak mendukung fitur rollback otomatis.");
        return { success: false, reason: "Aksi tidak mendukung rollback otomatis." };
      }

      var rollbackFn = tool.rollbackFunction;
      if (!rollbackFn) {
        console.warn("[RecoveryRollback] Fungsi rollback untuk " + tool.toolId + " belum didefinisikan.");
        return { success: false, reason: "Fungsi rollback belum didefinisikan." };
      }

      try {
        var handler = typeof rollbackFn === "function" 
          ? rollbackFn 
          : this.resolveHandler(rollbackFn);

        if (!handler) {
          throw new Error("Fungsi rollback tidak dapat di-resolve: " + rollbackFn);
        }

        // Jalankan logika rollback, berikan state awal
        var res = handler(rollbackState);
        console.log("[RecoveryRollback] Rollback selesai dengan status: " + res.status);
        
        return {
          success: res.status === "success",
          reason: res.message || "Rollback berhasil diselesaikan."
        };

      } catch (e) {
        console.error("[RecoveryRollback ERROR] Gagal menjalankan rollback: " + e.toString());
        return {
          success: false,
          reason: "Kesalahan Rollback: " + e.toString()
        };
      }
    },

    /**
     * Memetakan string nama fungsi ke object fungsi global jika handler disimpan sebagai string.
     */
    resolveHandler: function(funcName) {
      if (typeof funcName === "string" && typeof this.getGlobalScope()[funcName] === "function") {
        return this.getGlobalScope()[funcName];
      }
      return null;
    },

    /**
     * Mendapatkan scope global untuk resolusi string fungsi.
     */
    getGlobalScope: function() {
      return (function() { return this; })();
    }
  };
})();
