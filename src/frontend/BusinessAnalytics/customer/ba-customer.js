// ============================================================
// BusinessAnalytics/customer/ba-customer.js — Analitik Pelanggan
// ============================================================

const BusinessAnalyticsCustomer = (function() {
    let customerData = [];

    return {
        async init() {
            const container = document.getElementById("ba-pelanggan-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await BusinessAnalyticsAPI.getCustomerData(params);
                if (res.status === "success") {
                    customerData = res.customers || [];
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-pelanggan-container");
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
            const container = document.getElementById("ba-pelanggan-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik pelanggan: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-pelanggan-container");

            let newCustCount = 0;
            let repeatCustCount = 0;
            let totalLtv = 0;
            let totalOrders = 0;

            customerData.forEach(c => {
                const isNew = c["IsNewCustomer"] === "TRUE";
                const freq = parseInt(c["TotalOrders"]) || 0;
                const ltv = parseFloat(c["LifetimeValue"]) || 0;

                if (isNew) newCustCount++;
                if (freq > 1) repeatCustCount++;
                totalLtv += ltv;
                totalOrders += freq;
            });

            const avgOrders = customerData.length > 0 ? (totalOrders / customerData.length).toFixed(1) : "0.0";
            const avgLtv = customerData.length > 0 ? totalLtv / customerData.length : 0;

            const format = BusinessAnalyticsShared.formatCurrency;
            const formatNum = BusinessAnalyticsShared.formatNumber;

            container.innerHTML = `
                <!-- KPI Cards Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pelanggan Baru</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${newCustCount} <span class="text-xs font-normal text-gray-400">Orang</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Repeat Customer</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${repeatCustCount} <span class="text-xs font-normal text-gray-400">Orang</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rata-rata Order per Pelanggan</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${avgOrders} <span class="text-xs font-normal text-gray-400">Kali</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide font-sans">Avg. Lifetime Value (LTV)</div>
                        <div class="text-sm font-extrabold text-indigo-600 mt-1">${format(avgLtv)}</div>
                    </div>
                </div>

                <!-- Tabel Pelanggan Terbaik -->
                <div class="space-y-4">
                    <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-users-three text-indigo-600 text-base"></i> Pelanggan Terbaik</h4>
                    <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                    <th class="px-4 py-3 text-center w-12">Rank</th>
                                    <th class="px-4 py-3">Nama Pelanggan</th>
                                    <th class="px-4 py-3 text-center">Tipe</th>
                                    <th class="px-4 py-3 text-right">Total Order</th>
                                    <th class="px-4 py-3 text-right">Total Qty</th>
                                    <th class="px-4 py-3 text-right">Lifetime Value (LTV)</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100 text-gray-700">
                                ${customerData.slice(0, 15).map((c, idx) => {
                                    const isNew = c["IsNewCustomer"] === "TRUE";
                                    const typeBadge = isNew 
                                        ? `<span class="ds-badge ds-badge-indigo">Baru</span>` 
                                        : `<span class="ds-badge ds-badge-emerald">Berulang</span>`;
                                    
                                    return `
                                        <tr class="hover:bg-gray-50/50 transition-colors">
                                            <td class="px-4 py-3 text-center font-bold text-gray-400">${idx + 1}</td>
                                            <td class="px-4 py-3 font-bold text-gray-900">${c["CustomerName"] || "General Buyer"}</td>
                                            <td class="px-4 py-3 text-center">${typeBadge}</td>
                                            <td class="px-4 py-3 text-right font-semibold">${formatNum(c["TotalOrders"])}x</td>
                                            <td class="px-4 py-3 text-right font-semibold">${formatNum(c["TotalQtySpent"])}</td>
                                            <td class="px-4 py-3 text-right font-bold text-indigo-600">${format(c["LifetimeValue"])}</td>
                                        </tr>
                                    `;
                                }).join("")}
                                ${customerData.length === 0 ? `
                                    <tr>
                                        <td colspan="6" class="px-4 py-8 text-center text-gray-400">Belum ada data pelanggan tercatat.</td>
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
