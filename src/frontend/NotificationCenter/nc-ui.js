// ============================================================
// NotificationCenter/nc-ui.js — Orchestrator V2 (Non-Blocking)
// ============================================================

const NotificationCenterUI = (function() {
    let currentTab = "dashboard";

    return {
        /**
         * Inisialisasi awal saat menu Telegram diklik.
         */
        async init() {
            console.log("[NotificationCenterUI] Menginisialisasi modul V2...");
            
            // Periksa izin dasar sebelum memuat
            if (!NotificationCenterShared.hasPermission("dashboard")) {
                showToast("Akses ditolak: Anda tidak memiliki wewenang untuk modul ini.", "error");
                return;
            }

            this.switchTab("dashboard");
        },

        /**
         * Memeriksa apakah GAS_URL telah terkonfigurasi secara valid.
         */
        isConfigured() {
            const url = window.GAS_URL || "";
            return url.trim() !== "" && url.startsWith("https://");
        },

        /**
         * Mengalihkan tab sub-menu
         */
        switchTab(tabId) {
            currentTab = tabId;
            
            // Perbarui visual tombol navigasi tab
            document.querySelectorAll(".nc-nav-btn").forEach(btn => {
                if (btn.dataset.tab === tabId) {
                    btn.classList.add("bg-indigo-50", "text-indigo-600", "font-semibold");
                    btn.classList.remove("text-gray-600", "hover:bg-gray-50");
                } else {
                    btn.classList.remove("bg-indigo-50", "text-indigo-600", "font-semibold");
                    btn.classList.add("text-gray-600", "hover:bg-gray-50");
                }
            });

            // Tampilkan panel yang sesuai
            const panels = [
                "nc-panel-dashboard", "nc-panel-subscribers", "nc-panel-templates", 
                "nc-panel-broadcast", "nc-panel-queue", "nc-panel-settings"
            ];
            panels.forEach(p => {
                const el = document.getElementById(p);
                if (el) {
                    if (p === `nc-panel-${tabId}`) {
                        el.classList.remove("hidden");
                    } else {
                        el.classList.add("hidden");
                    }
                }
            });

            // Atur visibilitas banner peringatan dinamis
            const warningEl = document.getElementById("nc-gas-url-warning");
            if (warningEl) {
                if (!this.isConfigured()) {
                    warningEl.classList.remove("hidden");
                } else {
                    warningEl.classList.add("hidden");
                }
            }

            this.refreshActiveTab();
        },

        /**
         * Segarkan konten tab yang aktif saja (Lazy Load / Performance Optimization)
         */
        async refreshActiveTab(button) {
            if (button && !NotificationCenterShared.setBtnLoading(button, "Memuat...")) return;
            try {
                const configured = this.isConfigured();

            // Jika belum dikonfigurasi, muat status offline / placeholder tanpa memblokir aplikasi
                if (!configured) {
                    this.loadOfflinePlaceholder();
                    return;
                }

                switch (currentTab) {
                    case "dashboard":
                        await NotificationCenterDashboard.load();
                        break;
                    case "subscribers":
                        await NotificationCenterSubscribers.load();
                        break;
                    case "templates":
                        await NotificationCenterTemplates.load();
                        break;
                    case "broadcast":
                        this.resetBroadcastForm();
                        break;
                    case "queue":
                        await NotificationCenterQueue.init();
                        break;
                    case "settings":
                        await NotificationCenterSettings.load();
                        break;
                }
            } finally {
                if (button) NotificationCenterShared.resetBtn(button);
            }
        },

        /**
         * Memuat data placeholder ramah-pengguna saat GAS_URL tidak terkonfigurasi.
         */
        loadOfflinePlaceholder() {
            console.warn("[NotificationCenterUI] GAS_URL belum diatur. Memuat visual offline.");
            
            switch (currentTab) {
                case "dashboard":
                    // Reset metrik KPI ke offline state
                    document.getElementById("nc-bot-status").textContent = "Offline (Mati)";
                    document.getElementById("nc-bot-status").className = "text-sm font-semibold text-red-600";
                    document.getElementById("nc-bot-username").textContent = "Not Configured";
                    document.getElementById("nc-total-subs").textContent = "0";
                    document.getElementById("nc-active-subs").textContent = "0";
                    document.getElementById("nc-today-total").textContent = "0";
                    document.getElementById("nc-today-success").textContent = "0";
                    document.getElementById("nc-today-failed").textContent = "0";
                    document.getElementById("nc-today-queue").textContent = "0";
                    document.getElementById("nc-success-rate").textContent = "—";
                    document.getElementById("nc-last-error").textContent = "Konfigurasi GAS_URL diperlukan.";
                    
                    const chart = document.getElementById("nc-dashboard-chart-container");
                    if (chart) chart.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">Belum ada statistik. Silakan atur URL server.</div>`;
                    break;

                case "subscribers":
                    const subsBody = document.getElementById("nc-subs-table-body");
                    if (subsBody) {
                        subsBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">Konfigurasi GAS_URL diperlukan untuk mengelola subscribers. Silakan buka tab Settings.</td></tr>`;
                    }
                    break;

                case "templates":
                    const tplContainer = document.getElementById("nc-templates-list");
                    if (tplContainer) {
                        tplContainer.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">Konfigurasi GAS_URL diperlukan untuk menyunting template pesan.</div>`;
                    }
                    break;

                case "queue":
                    const qBody = document.getElementById("nc-queue-table-body");
                    if (qBody) {
                        qBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">Konfigurasi GAS_URL diperlukan untuk memantau log antrean.</td></tr>`;
                    }
                    break;

                case "settings":
                    // Biarkan kolom token kosong agar pengguna tetap bisa mengisi & menyimpan setelan baru
                    document.getElementById("nc-set-token").value = "";
                    document.getElementById("nc-set-username").value = "";
                    document.getElementById("nc-set-webhook").value = "URL belum dikonfigurasi";
                    document.getElementById("nc-invite-link-container").classList.add("hidden");
                    break;
            }
        },

        // ── BROADCAST CENTER ──
        resetBroadcastForm() {
            document.getElementById("nc-bc-target").value = "ALL";
            document.getElementById("nc-bc-message").value = "";
        },

        async sendBroadcast() {
            NotificationCenterShared.checkPermissionAndRun("broadcast", async () => {
                if (!this.isConfigured()) {
                    showToast("Gagal mengirim broadcast: GAS_URL belum dikonfigurasi.", "error");
                    return;
                }

                const target = document.getElementById("nc-bc-target").value;
                const message = document.getElementById("nc-bc-message").value.trim();

                if (!message) {
                    showToast("Pesan broadcast tidak boleh kosong.", "error");
                    return;
                }

                if (!confirm(`Kirim broadcast ini ke target "${target}"?`)) return;

                const btn = document.getElementById("nc-btn-send-broadcast");
                if (!NotificationCenterShared.setBtnLoading(btn, "Mengirim...")) return;

                try {
                    const res = await NotificationCenterAPI.sendBroadcast(target, message);
                    if (res.status !== "success") throw new Error(res.message);
                    
                    showToast(res.message, "success");
                    this.resetBroadcastForm();
                } catch (e) {
                    showToast("Broadcast gagal: " + e.message, "error");
                } finally {
                    NotificationCenterShared.resetBtn(btn);
                }
            });
        },

        copyInviteLink() {
            const text = document.getElementById("nc-invite-url").textContent;
            NotificationCenterShared.copyText(text, "Tautan pendaftaran bot berhasil disalin.");
        }
    };
})();
