// ============================================================
// BusinessAnalytics/ai/ba-ai.js — Wawasan AI
// ============================================================

const BusinessAnalyticsAI = (function() {
    let aiInsights = [];

    return {
        async init() {
            const container = document.getElementById("ba-ai-container");
            if (!container) return;

            // Tampilkan skeleton loader
            this.renderSkeleton();

            try {
                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await BusinessAnalyticsAPI.getAIInsights(params);
                if (res.status === "success") {
                    aiInsights = res.insights || [];
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-ai-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-4">
                    ${Array(3).fill(0).map(() => `
                        <div class="bg-gray-100 rounded-xl h-36 p-5 space-y-3">
                            <div class="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div class="h-3 bg-gray-200 rounded w-3/4"></div>
                            <div class="h-3 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    `).join("")}
                </div>
            `;
        },

        renderError(msg) {
            const container = document.getElementById("ba-ai-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat wawasan AI: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-ai-container");

            if (aiInsights.length === 0) {
                container.innerHTML = `
                    <div class="p-8 text-center text-gray-400 text-xs bg-gray-50 border border-dashed rounded-xl">
                        <i class="ph ph-sparkle text-lg mb-1 block text-gray-300"></i>
                        Belum ada wawasan AI terbuat. Silakan jalankan kalkulasi analitik terlebih dahulu.
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="space-y-4">
                    <div class="flex justify-between items-center border-b pb-3 mb-2">
                        <span class="text-xs font-semibold text-gray-400">Total Analisis: ${aiInsights.length} Isu Terdeteksi</span>
                    </div>

                    <div class="space-y-4">
                        ${aiInsights.map(insight => {
                            const prio = String(insight["Priority"]).toLowerCase();
                            let badgeClass = "ds-badge ds-badge-indigo";
                            let iconClass = "ph ph-info";
                            let borderClass = "border-indigo-100 bg-gradient-to-br from-indigo-50/30 to-white";
                            let prioLabel = "Prioritas Rendah";
                            
                            if (prio === "high") {
                                badgeClass = "ds-badge ds-badge-red";
                                iconClass = "ph ph-warning-circle text-rose-500";
                                borderClass = "border-red-100 bg-gradient-to-br from-red-50/20 to-white";
                                prioLabel = "Prioritas Tinggi";
                            } else if (prio === "medium") {
                                badgeClass = "ds-badge ds-badge-orange";
                                iconClass = "ph ph-warning-octagon text-amber-500";
                                borderClass = "border-amber-100 bg-gradient-to-br from-amber-50/20 to-white";
                                prioLabel = "Prioritas Sedang";
                            }

                            return `
                                <div class="border rounded-2xl p-5 shadow-sm space-y-3.5 transition hover:shadow-md ${borderClass}">
                                    <div class="flex justify-between items-start">
                                        <div class="space-y-1">
                                            <span class="ds-badge ds-badge-indigo text-[9px] font-bold uppercase tracking-wider">${insight["Category"]}</span>
                                            <h4 class="font-extrabold text-gray-900 text-xs sm:text-sm flex items-center gap-1.5"><i class="${iconClass}"></i> ${insight["Title"]}</h4>
                                        </div>
                                        <span class="${badgeClass} uppercase font-bold text-[9px] tracking-wider">${prioLabel}</span>
                                    </div>
                                    
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-sans text-gray-700 leading-relaxed border-t pt-3">
                                        <div>
                                            <span class="font-bold text-gray-900 block mb-1">Analisa Masalah:</span>
                                            <p>${insight["Analysis"]}</p>
                                        </div>
                                        <div>
                                            <span class="font-bold text-gray-900 block mb-1">Kemungkinan Alasan:</span>
                                            <p class="text-gray-500">${insight["Reason"]}</p>
                                        </div>
                                        <div class="bg-indigo-50/40 rounded-xl p-3 border border-indigo-100/50">
                                            <span class="font-bold text-indigo-950 block mb-1">Rekomendasi Aksi:</span>
                                            <p class="text-indigo-900 font-medium">${insight["Recommendation"]}</p>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>
            `;
        }
    };
})();
