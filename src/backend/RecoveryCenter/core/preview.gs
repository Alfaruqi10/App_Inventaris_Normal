// ============================================================
// RecoveryCenter/core/preview.gs — Preview Engine
// ============================================================

var RecoveryPreviewEngine = (function() {
  return {
    /**
     * Menjalankan tool dalam mode simulasi (Dry Run).
     * @param {Object} tool - Konfigurasi tool dari registry
     * @param {Object} options - Parameter request
     * @param {number} startTimeMs - Timestamp awal eksekusi
     * @return {Object} RecoveryResponse dengan status 'preview'
     */
    run: function(tool, options, startTimeMs) {
      console.log("[RecoveryPreview] Memulai simulasi (Dry Run) untuk tool: " + tool.toolId);
      
      if (!tool.supportsPreview) {
        return createRecoveryResponse({
          status: "failed",
          message: "Aksi tidak mendukung simulasi (Preview). Hubungi Admin.",
          duration: formatRecoveryDuration(startTimeMs)
        });
      }

      try {
        // Buat salinan opsi dan paksa mode preview
        var previewOptions = Object.assign({}, options, { preview: true });
        
        // Panggil handler fungsi riil
        var handler = typeof tool.handlerFunction === "function" 
          ? tool.handlerFunction 
          : this.resolveHandler(tool.handlerFunction);

        if (!handler) {
          throw new Error("Handler function tidak dapat ditemukan: " + tool.handlerFunction);
        }

        var result = handler(previewOptions);
        
        return createRecoveryResponse({
          status: "preview",
          message: result.message || "Simulasi selesai. Data pratinjau berhasil dibuat.",
          affectedRows: result.affectedRows || 0,
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          duration: formatRecoveryDuration(startTimeMs),
          metadata: result.metadata || {}
        });

      } catch (e) {
        console.error("[RecoveryPreview ERROR] Gagal menjalankan simulasi: " + e.toString());
        return createRecoveryResponse({
          status: "failed",
          message: "Simulasi Gagal: " + e.toString(),
          duration: formatRecoveryDuration(startTimeMs),
          errors: [e.toString()]
        });
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
