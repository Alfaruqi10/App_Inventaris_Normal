// ============================================================
// BusinessAnalytics/profit/ba-profit.js — Analitik Keuntungan
// ============================================================

const BusinessAnalyticsProfit = (function() {
    let profitData = [];
    let productProfitData = [];

    return {
        async init() {
            const container = document.getElementById("ba-keuntungan-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const profitRes = await BusinessAnalyticsAPI.getProfitData(params);
                const prodRes = await BusinessAnalyticsAPI.getProductData(params);
                
                if (profitRes.status === "success" && prodRes.status === "success") {
                    profitData = profitRes.profit || [];
                    productProfitData = prodRes.products || [];
                    this.render();
                } else {
                    this.renderError(profitRes.message || prodRes.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-keuntungan-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        ${Array(4).fill(0).map(() => `
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
            const container = document.getElementById("ba-keuntungan-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik keuntungan: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-keuntungan-container");

            let totalRevenue = 0, totalCogs = 0, totalFees = 0, totalNet = 0;
            profitData.forEach(row => {
                totalRevenue += parseFloat(row["Revenue"]) || 0;
                totalCogs += parseFloat(row["COGS"]) || 0;
                totalFees += (parseFloat(row["ShopeeFee"]) || 0) + (parseFloat(row["ServiceFee"]) || 0);
                totalNet += parseFloat(row["NetProfit"]) || 0;
            });

            const avgMargin = totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0;

            const format = BusinessAnalyticsShared.formatCurrency;
            const formatPct = BusinessAnalyticsShared.formatPercent;

            container.innerHTML = `
                <!-- KPI Cards Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Pendapatan</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(totalRevenue)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide font-sans">Total HPP / Modal</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(totalCogs)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-emerald-950 uppercase tracking-wide">Total Laba Bersih</div>
                        <div class="text-sm font-extrabold text-emerald-800 mt-1">${format(totalNet)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rata-rata Margin Keuntungan</div>
                        <div class="text-sm font-extrabold text-indigo-600 mt-1">${formatPct(avgMargin)}</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <!-- Tabel Rincian Keuntungan Bulanan -->
                    <div class="lg:col-span-2 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-calendar text-indigo-600 text-base"></i> Profitabilitas Bulanan</h4>
                        <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
                            <table class="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                        <th class="px-4 py-3">Bulan</th>
                                        <th class="px-4 py-3 text-right">Pendapatan</th>
                                        <th class="px-4 py-3 text-right">HPP / Modal</th>
                                        <th class="px-4 py-3 text-right">Biaya Komisi Shopee</th>
                                        <th class="px-4 py-3 text-right">Laba Bersih</th>
                                        <th class="px-4 py-3 text-right">Margin</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100 text-gray-700">
                                    ${profitData.map(row => {
                                        const fees = (parseFloat(row["ShopeeFee"]) || 0) + (parseFloat(row["ServiceFee"]) || 0);
                                        const marginVal = parseFloat(row["MarginPercent"]) || 0;
                                        return `
                                            <tr class="hover:bg-gray-50/50 transition-colors">
                                                <td class="px-4 py-3 font-bold text-gray-900">${row["DateOrMonth"]}</td>
                                                <td class="px-4 py-3 text-right font-semibold">${format(row["Revenue"])}</td>
                                                <td class="px-4 py-3 text-right text-gray-500">${format(row["COGS"])}</td>
                                                <td class="px-4 py-3 text-right text-red-500 font-mono">${format(fees)}</td>
                                                <td class="px-4 py-3 text-right font-bold text-emerald-600">${format(row["NetProfit"])}</td>
                                                <td class="px-4 py-3 text-right font-bold text-indigo-600">${marginVal.toFixed(1)}%</td>
                                            </tr>
                                        `;
                                    }).join("")}
                                    ${profitData.length === 0 ? `
                                        <tr>
                                            <td colspan="6" class="px-4 py-8 text-center text-gray-400">Belum ada data bulanan tercatat.</td>
                                        </tr>
                                    ` : ""}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Side Panel -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3 h-[320px] overflow-hidden flex flex-col">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-trend-up text-indigo-600 text-base"></i> Margin Keuntungan per Produk</h4>
                        <div class="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
                            ${productProfitData.slice(0, 5).map(p => {
                                const rev = parseFloat(p["Revenue"]) || 0;
                                const profit = parseFloat(p["Profit"]) || 0;
                                const margin = rev > 0 ? (profit / rev) * 100 : 0;
                                return `
                                    <div class="border-b pb-2 last:border-0 last:pb-0">
                                        <div class="font-bold text-gray-800 truncate">${p["ProductName"]}</div>
                                        <div class="flex justify-between items-center mt-1 text-[10px]">
                                            <span class="text-gray-400">Laba: ${format(profit)}</span>
                                            <span class="font-bold text-indigo-600 font-mono">${margin.toFixed(1)}% Margin</span>
                                        </div>
                                    </div>
                                `;
                            }).join("")}
                            ${productProfitData.length === 0 ? `<div class="text-gray-400 text-center py-8">Tidak ada data.</div>` : ""}
                        </div>
                    </div>
                </div>
            `;
        }
    };
})();
