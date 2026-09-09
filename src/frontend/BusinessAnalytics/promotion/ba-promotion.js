// ============================================================
// BusinessAnalytics/promotion/ba-promotion.js — Analitik Promosi
// ============================================================

const BusinessAnalyticsPromotion = (function() {
    let profitData = [];

    return {
        async init() {
            const container = document.getElementById("ba-promosi-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const res = await BusinessAnalyticsAPI.getProfitData();
                if (res.status === "success") {
                    profitData = res.profit || [];
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-promosi-container");
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
            const container = document.getElementById("ba-promosi-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik promosi: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-promosi-container");

            let totalVoucher = 0;
            let totalDiscount = 0;
            let totalRevenue = 0;

            profitData.forEach(row => {
                totalVoucher += parseFloat(row["VoucherSpent"]) || 0;
                totalDiscount += parseFloat(row["DiscountSpent"]) || 0;
                totalRevenue += parseFloat(row["Revenue"]) || 0;
            });

            const totalPromoCost = totalVoucher + totalDiscount;
            const roi = totalPromoCost > 0 ? (totalRevenue / totalPromoCost).toFixed(1) : "0.0";

            const format = BusinessAnalyticsShared.formatCurrency;

            container.innerHTML = `
                <!-- KPI Cards Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pengeluaran Voucher Toko</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(totalVoucher)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide font-sans">Total Diskon Langsung</div>
                        <div class="text-sm font-extrabold text-gray-800 mt-1">${format(totalDiscount)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-indigo-900 uppercase tracking-wide">Total Biaya Promosi</div>
                        <div class="text-sm font-extrabold text-indigo-700 mt-1">${format(totalPromoCost)}</div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">ROI Promosi</div>
                        <div class="text-sm font-extrabold text-emerald-600 mt-1">${roi}x</div>
                    </div>
                </div>

                <!-- Detail Penggunaan Promosi per Bulan -->
                <div class="space-y-4">
                    <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-ticket text-indigo-600 text-base"></i> Riwayat Pengeluaran Promosi Bulanan</h4>
                    <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                    <th class="px-4 py-3">Bulan</th>
                                    <th class="px-4 py-3 text-right">Voucher Toko</th>
                                    <th class="px-4 py-3 text-right">Diskon Langsung</th>
                                    <th class="px-4 py-3 text-right">Total Biaya</th>
                                    <th class="px-4 py-3 text-right">Pendapatan yang Didorong</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100 text-gray-700">
                                ${profitData.map(row => {
                                    const v = parseFloat(row["VoucherSpent"]) || 0;
                                    const d = parseFloat(row["DiscountSpent"]) || 0;
                                    return `
                                        <tr class="hover:bg-gray-50/50 transition-colors">
                                            <td class="px-4 py-3 font-bold text-gray-900">${row["DateOrMonth"]}</td>
                                            <td class="px-4 py-3 text-right text-rose-500 font-mono">${format(v)}</td>
                                            <td class="px-4 py-3 text-right text-amber-500 font-mono">${format(d)}</td>
                                            <td class="px-4 py-3 text-right font-bold text-gray-800">${format(v + d)}</td>
                                            <td class="px-4 py-3 text-right font-extrabold text-indigo-600">${format(row["Revenue"])}</td>
                                        </tr>
                                    `;
                                }).join("")}
                                ${profitData.length === 0 ? `
                                    <tr>
                                        <td colspan="5" class="px-4 py-8 text-center text-gray-400">Belum ada data bulanan promosi tercatat.</td>
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
