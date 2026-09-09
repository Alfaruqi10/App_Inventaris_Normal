// ============================================================
// BusinessAnalytics/core/ba-ui.js — UI Coordinator
// ============================================================

const BusinessAnalyticsUI = (function() {
    let currentSubTab = "ringkasan";

    return {
        async init() {
            console.log("[BusinessAnalyticsUI] Inisialisasi Analitik Bisnis...");
            
            // Set default sync status info
            const syncStatusEl = document.getElementById("ba-sync-status");
            if (syncStatusEl) syncStatusEl.textContent = "Status: Terhubung";

            // Inisialisasi Shared Date Range Picker jika belum ada
            if (!window.baDatePicker) {
                window.baDatePicker = new SharedDateRangePicker({
                    containerId: 'ba-datepicker-container',
                    storageKey: 'ansla_global_date_filter_state',
                    onChange: (dateFrom, dateTo, period, periodLabel) => {
                        BusinessAnalyticsUI.onPeriodChange();
                    }
                });
            } else {
                window.baDatePicker.syncState();
            }

            this.switchSubTab("ringkasan");
        },

        switchSubTab(tabId) {
            // Hapus active class dari seluruh top tab buttons
            document.querySelectorAll("button[id^='ba-tab-']").forEach(btn => {
                btn.className = "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition text-gray-500 hover:bg-gray-50 hover:text-gray-900";
            });
            
            // Tambahkan active class ke button terpilih
            const activeBtn = document.getElementById("ba-tab-" + tabId);
            if (activeBtn) {
                activeBtn.className = "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition bg-indigo-600 text-white shadow-sm shadow-indigo-600/20";
            }

            // Sembunyikan seluruh subviews
            document.querySelectorAll(".ba-subview").forEach(el => el.classList.add("hidden"));
            
            // Tampilkan subview terpilih
            const target = document.getElementById("ba-subview-" + tabId);
            if (target) target.classList.remove("hidden");

            currentSubTab = tabId;
            this.refreshActiveTab();
        },

        refreshActiveTab() {
            const tabId = currentSubTab;
            
            if (tabId === "ringkasan") {
                BusinessAnalyticsDashboard.init();
            } else if (tabId === "produk") {
                BusinessAnalyticsProduct.init();
            } else if (tabId === "penjualan") {
                BusinessAnalyticsSales.init();
            } else if (tabId === "persediaan") {
                BusinessAnalyticsInventory.init();
            } else if (tabId === "pelanggan") {
                BusinessAnalyticsCustomer.init();
            } else if (tabId === "keuntungan") {
                BusinessAnalyticsProfit.init();
            } else if (tabId === "promosi") {
                BusinessAnalyticsPromotion.init();
            } else if (tabId === "pengiriman") {
                BusinessAnalyticsShipping.init();
            } else if (tabId === "ai") {
                BusinessAnalyticsAI.init();
            } else if (tabId === "prediksi") {
                BusinessAnalyticsForecast.init();
            } else if (tabId === "laporan") {
                BusinessAnalyticsReports.init();
            }
        },

        getPeriodParams() {
            if (window.baDatePicker) {
                return window.baDatePicker.getDateRange();
            }
            // Fallback default
            const now = new Date();
            const start = new Date();
            start.setDate(now.getDate() - 6);
            return {
                dateFrom: start.toISOString().split('T')[0],
                dateTo: now.toISOString().split('T')[0],
                period: "7days",
                label: "7 Hari Terakhir"
            };
        },

        onPeriodChange() {
            const range = this.getPeriodParams();
            if (typeof showToast === 'function') {
                showToast(`Periode data diubah: ${range.label}`, "success");
            }
            this.refreshActiveTab();
        },

        updateHeaderInfo(lastUpdateStr) {
            const label = document.getElementById("ba-last-update-label");
            if (label && lastUpdateStr) {
                label.textContent = `Sinkron terakhir: ${lastUpdateStr}`;
            }
        },

        async recalculate(button) {
            if (button && !setButtonLoading(button, "Memproses...")) return;
            const loader = document.getElementById("ba-content-loading");
            if (loader) loader.classList.remove("hidden");
            
            const syncStatusEl = document.getElementById("ba-sync-status");
            if (syncStatusEl) syncStatusEl.textContent = "Status: Memproses";

            try {
                const res = await BusinessAnalyticsAPI.triggerCalculation();
                if (res.status === "success") {
                    showToast("Kalkulasi analitik berhasil diperbarui.", "success");
                    if (syncStatusEl) syncStatusEl.textContent = "Status: Terkini";
                    this.refreshActiveTab();
                } else {
                    showToast("Kalkulasi gagal: " + res.message, "error");
                    if (syncStatusEl) syncStatusEl.textContent = "Status: Gagal";
                }
            } catch (e) {
                showToast("Koneksi gagal: " + e.message, "error");
                if (syncStatusEl) syncStatusEl.textContent = "Status: Offline";
            } finally {
                if (loader) loader.classList.add("hidden");
                if (button) resetButton(button);
            }
        }
    };
})();
