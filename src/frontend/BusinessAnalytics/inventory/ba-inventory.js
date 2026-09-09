// ============================================================
// BusinessAnalytics/inventory/ba-inventory.js — Analitik Persediaan
// ============================================================

const BusinessAnalyticsInventory = (function() {
    let inventoryData = [];

    return {
        async init() {
            const container = document.getElementById("ba-persediaan-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await BusinessAnalyticsAPI.getInventoryData(params);
                if (res.status === "success") {
                    inventoryData = res.inventory || [];
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-persediaan-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        ${Array(5).fill(0).map(() => `
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
            const container = document.getElementById("ba-persediaan-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat analitik persediaan: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-persediaan-container");

            let fastCount = 0, slowCount = 0, deadCount = 0, criticalCount = 0, overCount = 0;
            let totalStock = 0, totalTurnover = 0, itemWithTurnover = 0;

            inventoryData.forEach(item => {
                const cls = item["Classification"];
                const stock = parseInt(item["StockOnHand"]) || 0;
                const turn = parseFloat(item["TurnoverRate"]) || 0;

                totalStock += stock;
                if (turn > 0) {
                    totalTurnover += turn;
                    itemWithTurnover++;
                }

                if (cls === "Fast Moving") fastCount++;
                else if (cls === "Slow Moving") slowCount++;
                else if (cls === "Dead Stock") deadCount++;
                else if (cls === "Critical Stock") criticalCount++;
                else if (cls === "Overstock") overCount++;
            });

            const avgTurnover = itemWithTurnover > 0 ? (totalTurnover / itemWithTurnover).toFixed(2) : "0.00";

            container.innerHTML = `
                <!-- 1. KPI Cards Grid (Klasifikasi Persediaan) -->
                <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <div class="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-emerald-950 uppercase tracking-wide">Produk Terlaris</div>
                        <div class="text-sm font-extrabold text-emerald-800 mt-1">${fastCount} <span class="text-[10px] font-normal text-emerald-600">SKU</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Produk Lambat Terjual</div>
                        <div class="text-sm font-extrabold text-gray-700 mt-1">${slowCount} <span class="text-[10px] font-normal text-gray-400">SKU</span></div>
                    </div>
                    <div class="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-red-950 uppercase tracking-wide">Stok Kritis</div>
                        <div class="text-sm font-extrabold text-red-700 mt-1">${criticalCount} <span class="text-[10px] font-normal text-red-500">SKU</span></div>
                    </div>
                    <div class="bg-gradient-to-br from-rose-50 to-white border border-rose-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-rose-950 uppercase tracking-wide">Produk Tidak Bergerak</div>
                        <div class="text-sm font-extrabold text-rose-700 mt-1">${deadCount} <span class="text-[10px] font-normal text-rose-500">SKU</span></div>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rasio Perputaran Persediaan</div>
                        <div class="text-sm font-extrabold text-indigo-600 mt-1">${avgTurnover}x</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Prediksi Stok Habis (Out of Stock) -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4 flex flex-col h-[400px]">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-warning-circle text-rose-500 text-base"></i> Proyeksi Stok Habis</h4>
                        <div id="ba-inv-out-of-stock" class="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
                            <!-- Dinamis -->
                        </div>
                    </div>

                    <!-- Rekomendasi Restok (Restock Recommendations) -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4 flex flex-col h-[400px]">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-plus-circle text-indigo-600 text-base"></i> Rekomendasi Restok</h4>
                        <div id="ba-inv-restock" class="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
                            <!-- Dinamis -->
                        </div>
                    </div>
                </div>
            `;

            this.renderPanels();
        },

        renderPanels() {
            const outOfStockEl = document.getElementById("ba-inv-out-of-stock");
            const restockEl = document.getElementById("ba-inv-restock");

            const criticalItems = inventoryData
                .filter(item => item["Classification"] === "Critical Stock" || (parseFloat(item["StockCoverageDays"]) < 15))
                .sort((a, b) => parseFloat(a["StockCoverageDays"]) - parseFloat(b["StockCoverageDays"]));

            if (outOfStockEl) {
                if (criticalItems.length === 0) {
                    outOfStockEl.innerHTML = `<div class="text-center text-gray-400 py-12">Semua stok berada dalam ambang batas aman.</div>`;
                } else {
                    outOfStockEl.innerHTML = criticalItems.map(item => {
                        const days = parseFloat(item["StockCoverageDays"]);
                        const dayLabel = isNaN(days) ? "∞" : days.toFixed(0);
                        const progressPercent = Math.min(100, isNaN(days) ? 100 : (days / 30) * 100);
                        
                        return `
                            <div class="border-b pb-3 space-y-2">
                                <div class="flex justify-between items-start">
                                    <div>
                                        <div class="font-bold text-gray-800 text-xs">${item["ProductName"]}</div>
                                        <div class="text-[10px] text-gray-400 font-mono mt-0.5">SKU: ${item["SKU"]}</div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-extrabold text-rose-600 text-xs">${dayLabel} Hari Lagi</div>
                                        <div class="text-[9px] text-gray-400 mt-0.5">Stok: ${item["StockOnHand"]} Pcs</div>
                                    </div>
                                </div>
                                <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                    <div class="bg-rose-500 h-1.5 rounded-full" style="width: ${progressPercent}%"></div>
                                </div>
                            </div>
                        `;
                    }).join("");
                }
            }

            if (restockEl) {
                const restockItems = inventoryData
                    .filter(item => item["Classification"] === "Critical Stock" || parseFloat(item["StockCoverageDays"]) < 10)
                    .map(item => {
                        const velocity = parseFloat(item["MonthlyVelocity"]) || 0;
                        const stock = parseInt(item["StockOnHand"]) || 0;
                        const recommended = Math.max(10, Math.round(velocity * 1.5 - stock));
                        return { ...item, recommended };
                    })
                    .sort((a, b) => b.recommended - a.recommended);

                if (restockItems.length === 0) {
                    restockEl.innerHTML = `<div class="text-center text-gray-400 py-12">Tidak ada rekomendasi restok saat ini.</div>`;
                } else {
                    restockEl.innerHTML = restockItems.map(item => {
                        return `
                            <div class="flex items-center justify-between border-b pb-2.5 last:border-0 last:pb-0">
                                <div>
                                    <div class="font-bold text-gray-800 text-xs truncate max-w-[200px]">${item["ProductName"]}</div>
                                    <div class="text-[10px] text-gray-400 mt-0.5">Stok Saat Ini: ${item["StockOnHand"]} Pcs</div>
                                </div>
                                <div class="text-right flex items-center gap-3">
                                    <div class="text-right min-w-[70px]">
                                        <span class="text-[9px] text-gray-400 block">Restok Qty:</span>
                                        <span class="font-extrabold text-indigo-600 text-sm font-mono">+${item.recommended}</span>
                                    </div>
                                    <button onclick="switchTab('masuk')" class="ds-btn ds-btn-secondary px-2 py-1 text-[9px]"><i class="ph ph-plus"></i> Tambah</button>
                                </div>
                            </div>
                        `;
                    }).join("");
                }
            }
        }
    };
})();
