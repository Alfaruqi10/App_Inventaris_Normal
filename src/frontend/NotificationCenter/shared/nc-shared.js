// ============================================================
// NotificationCenter/shared/nc-shared.js — Shared UI Helpers & Security
// ============================================================

const NotificationCenterShared = (function() {
    // Dynamic Permission Matrix Configuration
    const ROLE_PERMISSIONS = {
        "Owner":   ["dashboard", "subscribers", "rules", "broadcast", "queue", "history", "webhook", "settings", "recovery", "ai_assistant", "shopee", "stock", "laporan"],
        "Admin":   ["dashboard", "subscribers", "rules", "broadcast", "queue", "history", "webhook", "settings", "recovery", "shopee", "stock", "laporan"],
        "Operator":["dashboard", "queue", "history", "shopee", "stock"],
        "Packing": ["queue", "stock"],
        "Gudang":  ["queue", "stock"],
        "Finance": ["dashboard", "laporan"],
        "CS":      ["dashboard", "broadcast", "queue"]
    };

    return {
        /**
         * Memeriksa wewenang pengguna aktif secara dinamis (tanpa hardcode).
         * @param {string} permission - ID izin/akses
         * @returns {boolean} True jika diizinkan
         */
        hasPermission(permission) {
            let role = currentUser?.role || "Staff";
            if (role) {
                role = role.trim();
                role = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
            }
            const allowed = ROLE_PERMISSIONS[role] || ["queue"]; // default fallback
            return allowed.includes(permission);
        },

        /**
         * Menguji perizinan sebelum melakukan aksi UI.
         */
        checkPermissionAndRun(permission, actionFn) {
            if (this.hasPermission(permission)) {
                return actionFn();
            } else {
                showToast(`Akses ditolak: Peran Anda (${currentUser?.role || "Staff"}) tidak memiliki izin untuk fitur ini.`, "error");
                return null;
            }
        },

        /**
         * Pembungkus loading tombol.
         */
        setBtnLoading(btn, text = "Memproses...") {
            return setButtonLoading(btn, text);
        },

        /**
         * Mengembalikan keadaan tombol semula.
         */
        resetBtn(btn) {
            resetButton(btn);
        },

        /**
         * Format waktu lokalisasi Indonesia.
         */
        formatDateTime(dateStr) {
            if (!dateStr) return "—";
            try {
                return formatDateTimeShort(dateStr);
            } catch (e) {
                return dateStr;
            }
        },

        /**
         * Salin teks ke papan klip.
         */
        copyText(text, successMsg = "Teks disalin ke clipboard.") {
            navigator.clipboard.writeText(text).then(() => {
                showToast(successMsg, "success");
            }).catch(err => {
                showToast("Gagal menyalin teks.", "error");
            });
        }
    };
})();
