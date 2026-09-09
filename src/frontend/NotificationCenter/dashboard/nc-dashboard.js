// ============================================================
// NotificationCenter/dashboard/nc-dashboard.js — Stats & KPIs
// ============================================================

const NotificationCenterDashboard = (function() {
    return {
        /**
         * Memuat seluruh metrik dashboard secara asinkron.
         */
        async load() {
            NotificationCenterShared.checkPermissionAndRun("dashboard", async () => {
                this.showLoading();
                try {
                    const res = await NotificationCenterAPI.getDashboardData();
                    if (res.status !== "success") throw new Error(res.message);

                    const d = res.data || {};
                    this.renderKPIs(d);
                    this.renderChart(d.chartData || []);

                } catch (e) {
                    console.error("[NotificationCenterDashboard] Gagal memuat dashboard:", e);
                    showToast("Gagal memuat dashboard: " + e.message, "error");
                    this.renderKPIs({
                        botStatus: "Error",
                        botUsername: "Connection Failed",
                        totalSubscribers: 0,
                        activeSubscribers: 0,
                        totalToday: 0,
                        successToday: 0,
                        failedToday: 0,
                        waitingCount: 0,
                        lastError: e.message
                    });
                    this.renderChart([]);
                }
            });
        },

        showLoading() {
            const ids = [
                "nc-bot-status", "nc-bot-username", "nc-total-subs", "nc-active-subs",
                "nc-today-total", "nc-today-success", "nc-today-failed", "nc-today-queue", 
                "nc-success-rate", "nc-last-error"
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = `<span class="animate-pulse text-gray-300">...</span>`;
            });
        },

        /**
         * Render metrik KPI ke panel
         */
        renderKPIs(d) {
            // Status Bot & Warna
            const statusEl = document.getElementById("nc-bot-status");
            if (statusEl) {
                statusEl.textContent = d.botStatus || "Offline";
                statusEl.className = "text-sm font-semibold " + (d.botStatus === "Online" ? "text-green-600" : "text-red-600");
            }

            document.getElementById("nc-bot-username").textContent = d.botUsername || "Not Configured";
            document.getElementById("nc-total-subs").textContent = d.totalSubscribers || 0;
            document.getElementById("nc-active-subs").textContent = d.activeSubscribers || 0;
            document.getElementById("nc-today-total").textContent = d.totalToday || 0;
            document.getElementById("nc-today-success").textContent = d.successToday || 0;
            document.getElementById("nc-today-failed").textContent = d.failedToday || 0;
            document.getElementById("nc-today-queue").textContent = d.waitingCount || 0;
            document.getElementById("nc-last-error").textContent = d.lastError || "None";

            // Hitung persentase kesuksesan
            const rate = d.totalToday > 0 ? Math.round((d.successToday / d.totalToday) * 100) : 100;
            const rateEl = document.getElementById("nc-success-rate");
            if (rateEl) {
                rateEl.textContent = rate + "%";
                rateEl.className = "text-sm font-semibold " + (rate >= 90 ? "text-green-600" : "text-amber-600");
            }
        },

        /**
         * Render simulasi chart aktivitas pengiriman sederhana (7 hari terakhir).
         */
        renderChart(chartData) {
            const container = document.getElementById("nc-dashboard-chart-container");
            if (!container) return;

            if (chartData.length === 0) {
                container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">Belum ada statistik antrean untuk 7 hari terakhir.</div>`;
                return;
            }

            let maxVal = 1;
            chartData.forEach(c => {
                if (c.success + c.failed > maxVal) maxVal = c.success + c.failed;
            });

            let html = `<div class="flex items-end justify-between gap-2 h-24 pt-4 border-b border-gray-100">`;
            chartData.forEach(c => {
                const total = c.success + c.failed;
                const pct = Math.max(10, Math.round((total / maxVal) * 100));
                html += `
                    <div class="flex-1 flex flex-col items-center gap-1 group">
                        <div class="w-full bg-slate-100 hover:bg-slate-200 rounded-t-sm transition-all relative flex flex-col justify-end" style="height: ${pct}px" title="Total: ${total} (Sukses: ${c.success}, Gagal: ${c.failed})">
                            <div class="bg-indigo-500 w-full rounded-t-sm" style="height: ${Math.round((c.success / maxVal) * 100)}%"></div>
                        </div>
                        <span class="text-[9px] text-gray-400 font-mono mt-1">${c.day}</span>
                    </div>`;
            });
            html += `</div>`;
            container.innerHTML = html;
        }
    };
})();
