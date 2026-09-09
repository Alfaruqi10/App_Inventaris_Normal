// ============================================================
// RecoveryCenter/core/registry.gs — Recovery Tool Registry
// ============================================================

/**
 * RecoveryToolRegistry - Menyimpan registrasi seluruh recovery tools.
 * Mengikuti Open/Closed Principle: Menambah tool hanya perlu memanggil registerTool().
 */
var RecoveryToolRegistry = (function() {
  var registry = {};

  return {
    /**
     * Mendaftarkan tool baru ke dalam registry.
     * @param {Object} config - Konfigurasi tool
     */
    registerTool: function(config) {
      if (!config.toolId) {
        throw new Error("[RecoveryRegistry] Gagal registrasi: toolId wajib diisi.");
      }
      if (!config.handlerFunction) {
        throw new Error("[RecoveryRegistry] Gagal registrasi: handlerFunction untuk " + config.toolId + " wajib diisi.");
      }
      
      // Simpan konfigurasi standar
      registry[config.toolId] = {
        toolId:               config.toolId,
        title:                config.title || config.toolId,
        category:             config.category || "SYSTEM",
        destructiveAction:    !!config.destructiveAction,
        requiresOwnerPassword:!!config.requiresOwnerPassword,
        supportsPreview:      !!config.supportsPreview,
        supportsRollback:     !!config.supportsRollback,
        requiresLock:         config.requiresLock !== false, // default: true
        estimatedDuration:    config.estimatedDuration || "5s",
        handlerFunction:      config.handlerFunction, // Nama fungsi atau closure
        rollbackFunction:     config.rollbackFunction || null
      };
      
      console.log("[RecoveryRegistry] Berhasil mendaftarkan tool: " + config.toolId + " [" + config.category + "]");
    },

    /**
     * Mengambil konfigurasi tool berdasarkan ID.
     * @param {string} toolId - ID tool
     * @return {Object|null} Konfigurasi tool atau null jika tidak ditemukan
     */
    getTool: function(toolId) {
      return registry[toolId] || null;
    },

    /**
     * Mengambil daftar seluruh tool yang terdaftar.
     * @return {Array} Array konfigurasi tool
     */
    getAllTools: function() {
      return Object.keys(registry).map(function(key) {
        return registry[key];
      });
    },

    /**
     * Mengosongkan registry (biasanya untuk pengujian atau reload).
     */
    clearRegistry: function() {
      registry = {};
    }
  };
})();
