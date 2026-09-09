// ============================================================
// BusinessAnalytics/forecast/ba-forecast.js — Prediksi Bisnis
// ============================================================

const BusinessAnalyticsForecast = (function() {
    let forecastData = [];
    let masterMap = {};

    return {
        async init() {
            const container = document.getElementById("ba-prediksi-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const masterRes = await postData({ action: "getData" });
                if (masterRes.status === "success") {
                    masterRes.master.forEach(item => {
                        const sku = String(item["Kode Barang"] || "").trim();
                        if (sku) masterMap[sku] = item;
                    });
                }

                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await BusinessAnalyticsAPI.getForecast(params);
                if (res.status === "success") {
                    forecastData = res.forecast || [];
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-prediksi-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        ${Array(3).fill(0).map(() => `
                            <div class="bg-gray-100 rounded-xl h-20 p-4 space-y-2">
                                <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                                <div class="h-5 bg-gray-200 rounded w-1/2"></div>
                            </div>
                        `).join("")}
                    </div>
                    <div class="h-64 bg-gray-100 rounded-xl"></div>
                </div>
            `;
        },

        renderError(msg) {
            const container = document.getElementById("ba-prediksi-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat prediksi bisnis: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-prediksi-container");

            let totalSalesProj = 0;
            let totalRevProj = 0;
            let restockSkuCount = 0;

            forecastData.forEach(row => {
                totalSalesProj += parseInt(row["ForecastedSales"]) || 0;
                totalRevProj += parseFloat(row["ForecastedRevenue"]) || 0;
                const recQty = parseInt(row["RecommendedRestockQty"]) || 0;
                if (recQty > 0) restockSkuCount++;
            });

            const format = BusinessAnalyticsShared.formatCurrency;
            const formatNum = BusinessAnalyticsShared.formatNumber;

            container.innerHTML = `
                <!-- KPI Cards Proyeksi 30 Hari -->
                <div class="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Estimasi Volume Penjualan (30 Hari)</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${formatNum(totalSalesProj)} <span class="text-xs font-normal text-gray-400">Pcs</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Estimasi Pendapatan Penjualan (30 Hari)</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${format(totalRevProj)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-indigo-900 uppercase tracking-wide font-sans">Total SKU Perlu Restok</div>
                        <div class="text-sm font-extrabold text-indigo-700 mt-1">${restockSkuCount} <span class="text-xs font-normal text-indigo-500 font-sans">SKU</span></div>
                    </div>
                </div>

                <!-- Tabel Detail Ramalan Penjualan -->
                <div class="space-y-4">
                    <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-sparkle text-indigo-600 text-base"></i> Proyeksi Demand & Restok SKU</h4>
                    <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                    <th class="px-4 py-3">SKU</th>
                                    <th class="px-4 py-3">Nama Produk</th>
                                    <th class="px-4 py-3 text-right">Proyeksi Qty (30 Hari)</th>
                                    <th class="px-4 py-3 text-right">Proyeksi Pendapatan</th>
                                    <th class="px-4 py-3 text-right">Anjuran Restok</th>
                                    <th class="px-4 py-3 text-center">Akurasi (Confidence)</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100 text-gray-700">
                                ${forecastData.map(row => {
                                    const sku = row["TargetKey"];
                                    const name = masterMap[sku] ? masterMap[sku]["Nama Barang"] : sku;
                                    const recQty = parseInt(row["RecommendedRestockQty"]) || 0;
                                    
                                    const restockLabel = recQty > 0 
                                        ? `<span class="text-indigo-600 font-extrabold font-mono">+${recQty} Pcs</span>` 
                                        : `<span class="text-emerald-600 font-bold">Aman</span>`;

                                    return `
                                        <tr class="hover:bg-gray-50/50 transition-colors">
                                            <td class="px-4 py-3 font-bold text-gray-900 font-mono">${sku}</td>
                                            <td class="px-4 py-3">${name}</td>
                                            <td class="px-4 py-3 text-right font-semibold">${formatNum(row["ForecastedSales"])} Pcs</td>
                                            <td class="px-4 py-3 text-right font-semibold">${format(row["ForecastedRevenue"])}</td>
                                            <td class="px-4 py-3 text-right">${restockLabel}</td>
                                            <td class="px-4 py-3 text-center"><span class="ds-badge ds-badge-indigo">${row["ConfidenceLevel"]}</span></td>
                                        </tr>
                                    `;
                                }).join("")}
                                ${forecastData.length === 0 ? `
                                    <tr>
                                        <td colspan="6" class="px-4 py-8 text-center text-gray-400">Belum ada data proyeksi terkalkulasi.</td>
                                    </tr>
                                ` : ""}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
    };
})();
