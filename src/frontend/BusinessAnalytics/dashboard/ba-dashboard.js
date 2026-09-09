// ============================================================
// BusinessAnalytics/dashboard/ba-dashboard.js — Ringkasan Bisnis
// ============================================================

const BusinessAnalyticsDashboard = (function() {
    let summaryData = null;
    let deadStockDays = 30;

    return {
        async init() {
            const container = document.getElementById("ba-ringkasan-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                params.deadDays = deadStockDays;

                const res = await BusinessAnalyticsAPI.getSummary(params);
                if (res.status === "success") {
                    summaryData = res;
                    this.render();
                    
                    // Update stempel waktu pembaruan di header global
                    if (res.lastUpdate) {
                        BusinessAnalyticsUI.updateHeaderInfo(res.lastUpdate);
                    }
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        onDeadStockDaysChange(days) {
            deadStockDays = parseInt(days) || 30;
            this.init();
        },

        renderSkeleton() {
            const container = document.getElementById("ba-ringkasan-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                        ${Array(10).fill(0).map(() => `
                            <div class="bg-gray-100 rounded-xl h-20 p-4 space-y-2">
                                <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                                <div class="h-5 bg-gray-200 rounded w-1/2"></div>
                            </div>
                        `).join("")}
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div class="h-64 bg-gray-100 rounded-xl"></div>
                        <div class="h-64 bg-gray-100 rounded-xl"></div>
                    </div>
                </div>
            `;
        },

        renderError(msg) {
            const container = document.getElementById("ba-ringkasan-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat ringkasan bisnis: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-ringkasan-container");
            const kpi = summaryData.kpi;
            
            const format = BusinessAnalyticsShared.formatCurrency;
            const formatNum = BusinessAnalyticsShared.formatNumber;

            const labelEl = document.getElementById("ba-datepicker-label");
            const periodText = labelEl ? labelEl.textContent : "7 Hari Terakhir";

            const activePeriodRev = kpi.period ? kpi.period.revenue : kpi.month.revenue;
            const activePeriodProfit = kpi.period ? kpi.period.profit : kpi.month.profit;
            const activePeriodOrders = kpi.period ? kpi.period.orders : kpi.month.orders;
            const activePeriodIsEstimasi = kpi.period ? kpi.period.isEstimasi : kpi.month.isEstimasi;
            const periodQty = kpi.period ? kpi.period.totalQty : 0;
            const aov = kpi.period ? kpi.period.averageOrderValue : 0;

            container.innerHTML = `
                <!-- SECTION: METRIK HISTORIS -->
                <div class="space-y-3">
                    <h3 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise text-indigo-600 text-base"></i> Metrik Historis</h3>
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div class="bg-indigo-50/40 border border-indigo-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-indigo-900 uppercase tracking-wide">Pendapatan (${periodText})</div>
                            <div class="text-sm font-extrabold text-indigo-700 mt-1">${format(activePeriodRev)}</div>
                        </div>
                        <div class="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-emerald-950 uppercase tracking-wide flex items-center justify-between">
                                <span>Laba Bersih (${periodText})</span>
                                ${activePeriodIsEstimasi ? `<span class="bg-amber-100 text-amber-800 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse">Estimasi</span>` : ""}
                            </div>
                            <div class="text-sm font-extrabold text-emerald-800 mt-1">${format(activePeriodProfit)}</div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rata-rata Nilai Pesanan (AOV)</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${format(aov)}</div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Produk Terjual (Qty)</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(periodQty)} <span class="text-[10px] font-normal text-gray-400">Unit</span></div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Pesanan</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(activePeriodOrders)} <span class="text-[10px] font-normal text-gray-400">Pesanan</span></div>
                        </div>
                    </div>
                </div>

                <!-- SECTION: METRIK OPERASIONAL -->
                <div class="space-y-3 mt-6">
                    <h3 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-gear text-indigo-600 text-base"></i> Metrik Operasional</h3>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Retur / Returned</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.system.returns)} <span class="text-[10px] font-normal text-gray-400">Item</span></div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pengurangan Stok (Deductions)</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.system.deductions)} <span class="text-[10px] font-normal text-gray-400">Menunggu Approval</span></div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Pembatalan (Cancels)</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.system.cancels)} <span class="text-[10px] font-normal text-gray-400">Pesanan</span></div>
                        </div>
                    </div>
                </div>

                <!-- SECTION: METRIK MASTER & KATALOG -->
                <div class="space-y-3 mt-6">
                    <h3 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-database text-indigo-600 text-base"></i> Metrik Master & Katalog</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Aktif SKU</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.catalog.active)} <span class="text-[10px] font-normal text-gray-400">Item</span></div>
                        </div>
                        <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Stok Fisik</div>
                            <div class="text-sm font-extrabold text-gray-800 mt-1">${formatNum(kpi.catalog.totalStock)} <span class="text-[10px] font-normal text-gray-400">Unit</span></div>
                        </div>
                        <div class="bg-gradient-to-br from-amber-50 to-white border border-amber-100 rounded-xl p-4 shadow-sm hover:shadow transition">
                            <div class="text-[10px] font-bold text-amber-950 uppercase tracking-wide">Stok Kritis (Low Stock)</div>
                            <div class="text-sm font-extrabold text-amber-700 mt-1">${formatNum(kpi.catalog.lowStock)} <span class="text-[10px] font-normal text-amber-500">Item</span></div>
                        </div>
                        <div class="bg-gradient-to-br from-rose-50 to-white border border-rose-100 rounded-xl p-4 shadow-sm hover:shadow transition relative">
                            <div class="text-[10px] font-bold text-rose-950 uppercase tracking-wide flex items-center justify-between">
                                <span>Produk Mati (Dead Stock)</span>
                                <select id="ba-dead-stock-days" onchange="BusinessAnalyticsDashboard.onDeadStockDaysChange(this.value)" class="bg-transparent border-none text-[9px] text-rose-700 font-bold focus:ring-0 p-0 cursor-pointer">
                                    <option value="30" ${deadStockDays === 30 ? "selected" : ""}>30 Hari</option>
                                    <option value="60" ${deadStockDays === 60 ? "selected" : ""}>60 Hari</option>
                                    <option value="90" ${deadStockDays === 90 ? "selected" : ""}>90 Hari</option>
                                </select>
                            </div>
                            <div class="text-sm font-extrabold text-rose-700 mt-1">${formatNum(kpi.catalog.dead)} <span class="text-[10px] font-normal text-rose-500">Item</span></div>
                        </div>
                    </div>
                </div>

                <!-- Grafik Visual Tren (Revenue & Orders) -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-chart-line text-indigo-600 text-base"></i> Tren Pendapatan (${periodText})</h4>
                        <div id="ba-chart-revenue-container" class="h-64"></div>
                    </div>

                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-shopping-cart text-indigo-600 text-base"></i> Tren Pesanan (${periodText})</h4>
                        <div id="ba-chart-orders-container" class="h-64"></div>
                    </div>
                </div>

                <!-- Baris Bawah: Aktivitas, AI Insight, Warning -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                    <!-- Aktivitas Hari Ini -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-activity text-indigo-600 text-base"></i> Sinkronisasi Sistem</h4>
                        <div class="space-y-3 text-xs">
                            <div class="flex items-start gap-2">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></span>
                                <div>
                                    <div class="font-bold text-gray-800">Sinkron Hari Ini</div>
                                    <div class="text-[10px] text-gray-400">${formatNum(kpi.system.syncToday)} pesanan ditarik hari ini</div>
                                </div>
                            </div>
                            <div class="flex items-start gap-2">
                                <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0"></span>
                                <div>
                                    <div class="font-bold text-gray-800">Mapping SKU Shopee</div>
                                    <div class="text-[10px] text-gray-400">${kpi.system.mappingRate} terpetakan (${kpi.system.pendingMapping} belum dipetakan)</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Wawasan AI Preview -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3 flex flex-col justify-between">
                        <div>
                            <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-sparkle text-indigo-600 text-base"></i> Wawasan AI</h4>
                            <div class="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-950 mt-2 font-sans">
                                <span class="font-bold text-[10px] text-indigo-900 block uppercase tracking-wide mb-1">Rekomendasi Restok</span>
                                Identifikasi produk terlaris dengan stok rendah. Segera jadwalkan pengadaan untuk menghindari out-of-stock.
                                <a href="#" onclick="switchTab('analytics'); BusinessAnalyticsUI.switchSubTab('ai'); return false;" class="text-[10px] font-bold text-indigo-600 block mt-2 hover:underline">Lihat Rekomendasi AI →</a>
                            </div>
                        </div>
                    </div>

                    <!-- Peringatan Sistem/Discrepancy Checker -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-warning-octagon text-indigo-600 text-base"></i> Audit Discrepancy Checker</h4>
                        <div class="text-xs text-gray-500 font-sans leading-relaxed flex flex-col gap-2">
                            <span>Sistem mencocokkan total analitik berkala dengan database transaksi raw secara berkelanjutan.</span>
                            <button onclick="BusinessAnalyticsDashboard.runDiscrepancyAudit(this)" class="ds-btn border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-1 px-2.5 rounded-lg text-[10px] font-bold transition w-max">
                                Jalankan Data Audit
                            </button>
                        </div>
                    </div>
                </div>
            `;

            this.renderCharts();
        },

        async runDiscrepancyAudit(button) {
            if (button && !setButtonLoading(button, "Mengaudit...")) return;
            showToast("Memulai audit rekonsiliasi data...", "info");
            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await postData({ action: "runDataAuditDiscrepancy", ...params });
                if (res.status === "success") {
                    showToast("Audit selesai: Data 100% konsisten (Selisih < 0.5%)", "success");
                } else if (res.status === "discrepancy") {
                    showToast("Peringatan: Terdeteksi ketidakcocokan data dengan raw sheet!", "warning");
                    console.warn("[Data Audit Discrepancy Details]:", res);
                } else {
                    showToast("Gagal menjalankan audit: " + res.message, "error");
                }
            } catch (e) {
                showToast("Kesalahan audit: " + e.message, "error");
            } finally {
                if (button) resetButton(button);
            }
        },

        renderCharts() {
            const chartData = summaryData.dailyChartData;
            if (!chartData || chartData.length === 0) {
                document.getElementById("ba-chart-revenue-container").innerHTML = `<div class="text-xs text-gray-400 text-center py-20">Tidak ada data untuk grafik.</div>`;
                document.getElementById("ba-chart-orders-container").innerHTML = `<div class="text-xs text-gray-400 text-center py-20">Tidak ada data untuk grafik.</div>`;
                return;
            }

            const dates = chartData.map(d => {
                if (d["FormattedDate"]) return d["FormattedDate"];
                const raw = String(d["Date"] || "");
                const clean = raw.includes("T") ? raw.split("T")[0] : raw;
                const parts = clean.split("-");
                if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
                return clean;
            });
            const revenues = chartData.map(d => parseFloat(d["Revenue"]) || 0);
            const orders = chartData.map(d => parseInt(d["TotalOrders"]) || 0);

            // Buat Grafik Tren Pendapatan (Area Chart)
            BusinessAnalyticsShared.createSvgAreaChart("ba-chart-revenue-container", revenues, dates);

            // Buat Grafik Tren Pesanan (Bar Chart)
            BusinessAnalyticsShared.createSvgBarChart("ba-chart-orders-container", orders, dates);
        }
    };
})();
