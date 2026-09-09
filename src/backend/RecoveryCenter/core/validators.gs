// ============================================================
// RecoveryCenter/core/validators.gs — Permission & Password Validator
// ============================================================

var RecoveryPermissionValidator = (function() {
  
  // Hash placeholder atau konfigurasi password Owner.
  // Implementasi riil enkripsi/verifikasi diletakkan di sini nanti.
  var OWNER_PASSWORD_HASH = "OWNER_SECRET_KEY_PLACEHOLDER"; 

  return {
    /**
     * Memvalidasi apakah role user saat ini memiliki izin menjalankan tool.
     * @param {Object} tool - Konfigurasi tool dari registry
     * @param {Object} options - Parameter request (termasuk user auth dan password)
     * @return {Object} { valid: boolean, message: string }
     */
    validate: function(tool, options) {
      console.log("[RecoveryValidator] Memvalidasi izin untuk tool: " + tool.toolId);
      
      var auth = options.auth || {};
      var userRole = String(auth.role || "").toUpperCase();
      var userEmail = auth.userEmail || "Unknown User";

      // 1. Validasi Role Dasar
      if (userRole !== "ADMIN" && userRole !== "OWNER") {
        return {
          valid: false,
          message: "Akses Ditolak: Anda tidak memiliki wewenang untuk mengakses konsol pemeliharaan."
        };
      }

      // 2. Validasi Kebutuhan Password Owner
      if (tool.requiresOwnerPassword || tool.destructiveAction) {
        if (userRole !== "OWNER") {
          return {
            valid: false,
            message: "Akses Ditolak: Aksi ini bersifat destruktif dan memerlukan hak akses Owner."
          };
        }

        // Verifikasi password Owner (Struktur Dasar)
        var inputPassword = options.ownerPassword || "";
        if (!inputPassword) {
          return {
            valid: false,
            message: "Verifikasi Gagal: Password Owner diperlukan untuk melanjutkan tindakan destruktif ini."
          };
        }

        if (!this.verifyOwnerPassword(inputPassword)) {
          return {
            valid: false,
            message: "Verifikasi Gagal: Password Owner yang dimasukkan salah."
          };
        }
      }

      return { valid: true, message: "Validasi berhasil." };
    },

    /**
     * Struktur placeholder untuk verifikasi password Owner.
     * @param {string} password - Password mentah dari input
     * @return {boolean} true jika cocok, false jika tidak
     */
    verifyOwnerPassword: function(password) {
      // TODO: Hubungkan dengan mekanisme penyimpanan credential yang aman di Google Properties Service.
      // Untuk framework core ini, kita izinkan password placeholder atau password tertentu untuk pengujian.
      var storedPassword = PropertiesService.getScriptProperties().getProperty("OWNER_RECOVERY_PASSWORD") || "adminansla123";
      return password === storedPassword;
    }
  };
})();
