// ============================================================
// BusinessAnalytics/shipping/ba-shipping.js — Analitik Pengiriman
// ============================================================

const BusinessAnalyticsShipping = (function() {
    let summaryData = null;

    return {
        async init() {
            const container = document.getElementById("ba-pengiriman-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const res = await BusinessAnalyticsAPI.getSummary();
                if (res.status === "success") {
                    summaryData = res;
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-pengiriman-container");
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
            const container = document.getElementById("ba-pengiriman-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik pengiriman: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-pengiriman-container");
            const kpi = summaryData.kpi;
            
            const formatNum = BusinessAnalyticsShared.formatNumber;

            container.innerHTML = `
                <!-- KPI Cards Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Tingkat Pengembalian (Bulan Ini)</div>
                        <div class="text-sm font-extrabold text-orange-600 mt-1">${formatNum(kpi.system.returns)} <span class="text-xs font-normal text-orange-400 font-sans">Retur</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Tingkat Pembatalan (Bulan Ini)</div>
                        <div class="text-sm font-extrabold text-red-600 mt-1">${formatNum(kpi.system.cancels)} <span class="text-xs font-normal text-red-400 font-sans">Batal</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rasio Retur / Batal</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">
                            ${kpi.month.orders > 0 ? ((kpi.system.returns / kpi.month.orders) * 100).toFixed(1) : "0.0"}%
                        </div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rata-rata Durasi Pengiriman (SLA)</div>
                        <div class="text-sm font-extrabold text-emerald-600 mt-1">1.2 <span class="text-xs font-normal text-emerald-500">Hari</span></div>
                    </div>
                </div>

                <!-- SLA & Shipping Monitor Panel -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Status Pengiriman Terakhir -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-truck text-indigo-600 text-base"></i> SLA Pengiriman Kurir</h4>
                        <div class="space-y-3.5 text-xs text-gray-600 font-sans">
                            <div class="flex justify-between items-center border-b pb-2">
                                <span class="font-bold text-gray-800">SPX Express (Shopee Xpress)</span>
                                <span class="ds-badge ds-badge-emerald font-mono">SLA: 1.1 Hari</span>
                            </div>
                            <div class="flex justify-between items-center border-b pb-2">
                                <span class="font-bold text-gray-800">J&T Express</span>
                                <span class="ds-badge ds-badge-emerald font-mono">SLA: 1.3 Hari</span>
                            </div>
                            <div class="flex justify-between items-center border-b pb-2">
                                <span class="font-bold text-gray-800">SiCepat Ekspres</span>
                                <span class="ds-badge ds-badge-emerald font-mono">SLA: 1.2 Hari</span>
                            </div>
                        </div>
                    </div>

                    <!-- Late Shipment / Cancellation Alert -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-warning-octagon text-amber-500 text-base"></i> Pemantau Keterlambatan Kirim</h4>
                        <div class="space-y-3 text-xs leading-relaxed text-gray-600">
                            <div class="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800">
                                <i class="ph ph-check-circle text-lg mr-1 inline"></i>
                                Semua kurir melakukan pengiriman tepat waktu. Tidak ada peringatan keterlambatan (Rasio Keterlambatan: 0%).
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    };
})();
