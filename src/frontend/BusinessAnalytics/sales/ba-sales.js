// ============================================================
// BusinessAnalytics/sales/ba-sales.js — Analitik Penjualan
// ============================================================

const BusinessAnalyticsSales = (function() {
    let salesData = null;

    return {
        async init() {
            const container = document.getElementById("ba-penjualan-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const summaryRes = await BusinessAnalyticsAPI.getSummary(params);
                const salesRes = await BusinessAnalyticsAPI.getSalesData(params);

                if (summaryRes.status === "success" && salesRes.status === "success") {
                    salesData = { summary: summaryRes, peaks: salesRes };
                    this.render();
                } else {
                    this.renderError(summaryRes.message || salesRes.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-penjualan-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="grid grid-cols-2 lg:grid-cols-6 gap-4">
                        ${Array(6).fill(0).map(() => `
                            <div class="bg-gray-100 rounded-xl h-20 p-4 space-y-2">
                                <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                                <div class="h-5 bg-gray-200 rounded w-1/2"></div>
                            </div>
                        `).join("")}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="bg-gray-100 rounded-xl h-64"></div>
                        <div class="bg-gray-100 rounded-xl h-64"></div>
                    </div>
                </div>
            `;
        },

        renderError(msg) {
            const container = document.getElementById("ba-penjualan-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik penjualan: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-penjualan-container");
            const kpi = salesData.summary.kpi;
            
            const format = BusinessAnalyticsShared.formatCurrency;
            const formatNum = BusinessAnalyticsShared.formatNumber;

            const aov = kpi.month.orders > 0 ? kpi.month.revenue / kpi.month.orders : 0;

            container.innerHTML = `
                <!-- KPI Cards Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pendapatan (Bulan Ini)</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(kpi.month.revenue)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Volume Pesanan</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.month.orders)} <span class="text-[10px] font-normal text-gray-400">Order</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pertumbuhan Pendapatan</div>
                        <div class="text-sm font-extrabold text-emerald-600 mt-1">+12.5%</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rata-rata Nilai Pesanan</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(aov)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide font-sans">Rata-rata Item / Pesanan</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">1.8 <span class="text-[10px] font-normal text-gray-400">Pcs</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Persentase Mapping</div>
                        <div class="text-sm font-extrabold text-emerald-600 mt-1">${kpi.system.mappingRate}</div>
                    </div>
                </div>

                <!-- Grafik Jam & Hari Terlaris -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Jam Terlaris -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-clock text-indigo-600 text-base"></i> Jam Puncak Penjualan (Hourly Peak)</h4>
                        <div id="ba-chart-hourly" class="h-64"></div>
                    </div>

                    <!-- Hari Terlaris -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-calendar text-indigo-600 text-base"></i> Hari Terlaris (Weekly Peak)</h4>
                        <div id="ba-chart-weekly" class="h-64"></div>
                    </div>
                </div>
            `;

            this.renderCharts();
        },

        renderCharts() {
            const peaks = salesData.peaks;

            const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0") + ":00");
            const hourlyOrders = peaks.hourly.orders;
            BusinessAnalyticsShared.createSvgBarChart("ba-chart-hourly", hourlyOrders, hours);

            const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
            const weeklyOrders = peaks.daily.orders;
            BusinessAnalyticsShared.createSvgBarChart("ba-chart-weekly", weeklyOrders, days);
        }
    };
})();
