// ============================================================
// BusinessAnalytics/product/ba-product.js — Product Intelligence Center
// ============================================================

const BusinessAnalyticsProduct = (function() {
    let rawProductData = [];
    let rawSkuData = [];
    let masterMap = {};
    let kpis = {};
    let problems = [];
    let heatmap = [];

    // UI state
    let filteredData = [];
    let currentPage = 1;
    let pageSize = 50;
    let sortField = "Revenue";
    let sortAsc = false;

    // Add CSS styles for Right Drawer and Heatmap dynamically
    const injectStyles = () => {
        if (document.getElementById("ba-product-styles")) return;
        const style = document.createElement("style");
        style.id = "ba-product-styles";
        style.textContent = `
            .ba-drawer-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(2px);
                z-index: 1000;
                opacity: 0;
                pointer-events: none;
                transition: opacity 250ms ease;
            }
            .ba-drawer-overlay.open {
                opacity: 1;
                pointer-events: auto;
            }
            .ba-drawer {
                position: fixed;
                top: 0; right: -540px;
                width: 500px; max-width: 90vw;
                height: 100vh;
                background: var(--c-surface);
                border-left: 1px solid var(--c-border);
                box-shadow: var(--shadow-lg);
                z-index: 1001;
                transition: right 300ms cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .ba-drawer.open {
                right: 0;
            }
            .ba-drawer-header {
                padding: 1.25rem;
                border-bottom: 1px solid var(--c-border-soft);
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-shrink: 0;
            }
            .ba-drawer-body {
                padding: 1.25rem;
                overflow-y: auto;
                flex-1: 1;
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
            }
            .heatmap-grid {
                display: grid;
                grid-template-columns: repeat(24, 1fr);
                gap: 2px;
            }
            .heatmap-cell {
                aspect-ratio: 1;
                border-radius: 2px;
                cursor: pointer;
                transition: transform 100ms ease;
            }
            .heatmap-cell:hover {
                transform: scale(1.2);
                z-index: 10;
                box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            }
            .th-sortable {
                cursor: pointer;
                user-select: none;
                position: relative;
            }
            .th-sortable:hover {
                background: var(--c-border-soft) !important;
            }
            .th-sortable::after {
                content: " ↕";
                opacity: 0.3;
                font-size: 0.85em;
            }
            .th-sortable.asc::after {
                content: " ↑";
                opacity: 1;
                color: var(--c-primary);
            }
            .th-sortable.desc::after {
                content: " ↓";
                opacity: 1;
                color: var(--c-primary);
            }

            /* Responsive Product KPI Grid */
            .ba-kpi-grid {
                display: grid;
                gap: .75rem;
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .ba-kpi-grid .kpi-card {
                container-type: inline-size;
                padding: .9rem 1rem;
                min-width: 0;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                height: 100%;
            }
            .ba-kpi-grid .kpi-label {
                display: block;
                min-height: 2rem;
                line-height: 1.25;
            }
            .ba-kpi-grid .kpi-value {
                font-size: clamp(1.1rem, 11cqw, 1.8rem);
                letter-spacing: -0.02em;
                white-space: nowrap;
                overflow: visible;
                display: block;
                margin-top: auto;
            }
            @media (min-width: 640px) {
                .ba-kpi-grid {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                }
            }
            @media (min-width: 1024px) {
                .ba-kpi-grid {
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                }
            }
            @media (min-width: 1600px) {
                .ba-kpi-grid {
                    grid-template-columns: repeat(6, minmax(0, 1fr));
                }
            }
        `;
        document.head.appendChild(style);
    };

    return {
        async init() {
            const container = document.getElementById("ba-produk-container");
            if (!container) return;

            injectStyles();
            this.renderSkeleton();

            try {
                // Fetch Master Barang lookup for images
                const masterRes = await postData({ action: "getData" });
                if (masterRes.status === "success") {
                    masterRes.master.forEach(item => {
                        const sku = String(item["Kode Barang"] || "").trim();
                        if (sku) masterMap[sku] = item;
                    });
                }

                const params = BusinessAnalyticsUI.getPeriodParams();
                const res = await BusinessAnalyticsAPI.getProductData(params);
                if (res.status === "success") {
                    rawProductData = res.products || [];
                    rawSkuData = res.skus || [];
                    kpis = res.kpis || {};
                    problems = res.problems || [];
                    heatmap = res.heatmap || [];
                    
                    currentPage = 1;
                    this.render();
                } else {
                    this.renderError(res.message);
                }
            } catch (e) {
                this.renderError(e.message);
            }
        },

        renderSkeleton() {
            const container = document.getElementById("ba-produk-container");
            container.innerHTML = `
                <div class="animate-pulse space-y-6">
                    <div class="h-12 bg-gray-100 rounded-xl w-full"></div>
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div class="h-20 bg-gray-100 rounded-xl"></div>
                        <div class="h-20 bg-gray-100 rounded-xl"></div>
                        <div class="h-20 bg-gray-100 rounded-xl"></div>
                        <div class="h-20 bg-gray-100 rounded-xl"></div>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div class="lg:col-span-2 h-96 bg-gray-100 rounded-xl"></div>
                        <div class="h-96 bg-gray-100 rounded-xl"></div>
                    </div>
                </div>
            `;
        },

        renderError(msg) {
            const container = document.getElementById("ba-produk-container");
            container.innerHTML = `
                <div class="p-6 text-center bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    Gagal memuat Product Intelligence Center: ${msg}
                </div>
            `;
        },

        render() {
            const container = document.getElementById("ba-produk-container");
            const categories = [...new Set(rawProductData.map(p => p["Category"] || "Umum"))];
            
            // Render basic layout structure
            container.innerHTML = `
                <!-- Drawer DOM elements (overlay + panel) -->
                <div id="ba-prod-drawer-overlay" class="ba-drawer-overlay" onclick="BusinessAnalyticsProduct.closeDrawer()"></div>
                <div id="ba-prod-drawer" class="ba-drawer"></div>

                <!-- Redesigned Top Action Bar & Filters -->
                <div class="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-5">
                    <div>
                        <h3 class="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                            <i class="ph ph-cpu text-indigo-600 text-lg"></i> Product Intelligence Center
                        </h3>
                        <p class="text-[10px] text-gray-400 mt-0.5">Analisis performa produk, persediaan, prediksi stok, dan insight kecerdasan bisnis</p>
                    </div>
                    <!-- Export Actions -->
                    <div class="flex items-center gap-2">
                        <button onclick="BusinessAnalyticsProduct.exportExcel()" class="ds-btn ds-btn-secondary ds-btn-sm">
                            <i class="ph ph-file-xls text-emerald-600 text-sm"></i> Excel
                        </button>
                        <button onclick="BusinessAnalyticsProduct.exportCSV()" class="ds-btn ds-btn-secondary ds-btn-sm">
                            <i class="ph ph-file-csv text-blue-600 text-sm"></i> CSV
                        </button>
                        <button onclick="BusinessAnalyticsProduct.exportPDF()" class="ds-btn ds-btn-secondary ds-btn-sm">
                            <i class="ph ph-file-pdf text-rose-600 text-sm"></i> PDF
                        </button>
                    </div>
                </div>

                <!-- Filters -->
                <div class="bg-gray-50 border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-4 items-center text-xs mb-6 shadow-sm">
                    <div class="flex flex-col gap-1 w-full sm:w-auto">
                        <label class="font-bold text-gray-500">Kategori</label>
                        <select id="ba-prod-filter-cat" onchange="BusinessAnalyticsProduct.filterData()" class="ds-input py-1.5 px-3 w-full sm:w-44">
                            <option value="">Semua Kategori</option>
                            <option value="Daily">Daily</option>
                            <option value="Semi Formal">Semi Formal</option>
                            <option value="Haji Umroh">Haji Umroh</option>
                            <option value="Catalog">Catalog</option>
                            <option value="Non Catalog">Non Catalog</option>
                            ${categories.filter(c => !["Daily", "Semi Formal", "Haji Umroh", "Catalog", "Non Catalog"].includes(c)).map(c => `<option value="${c}">${c}</option>`).join("")}
                        </select>
                    </div>
                    
                    <div class="flex flex-col gap-1 w-full sm:w-auto">
                        <label class="font-bold text-gray-500">Status Ketersediaan</label>
                        <select id="ba-prod-filter-status" onchange="BusinessAnalyticsProduct.filterData()" class="ds-input py-1.5 px-3 w-full sm:w-44">
                            <option value="">Semua Status</option>
                            <option value="Aktif">Aktif</option>
                            <option value="Nonaktif">Nonaktif</option>
                            <option value="Habis">Habis</option>
                            <option value="Stok Menipis">Stok Menipis</option>
                            <option value="Tidak Bergerak">Tidak Bergerak</option>
                        </select>
                    </div>

                    <div class="flex flex-col gap-1 w-full sm:w-auto sm:ml-auto">
                        <label class="font-bold text-gray-500">Cari Produk</label>
                        <input type="text" id="ba-prod-search" oninput="BusinessAnalyticsProduct.filterData()" placeholder="Nama / SKU / ID Shopee..." class="ds-input py-1.5 px-3 w-full sm:w-56">
                    </div>
                </div>

                <!-- 12 KPI Metrics Grid -->
                <div class="ba-kpi-grid mb-6">
                    <!-- Row 1 -->
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Aktif</span>
                        <span class="kpi-value text-gray-800" id="kpi-active-products">-</span>
                        <span class="kpi-sub">Di Master Barang</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Terjual</span>
                        <span class="kpi-value text-gray-800" id="kpi-sold-products">-</span>
                        <span class="kpi-sub">Unik (Ada Qty)</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Pendapatan Produk</span>
                        <span class="kpi-value text-emerald-600" id="kpi-total-revenue">-</span>
                        <span class="kpi-sub">Total Pemasukan</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Laba Bersih</span>
                        <span class="kpi-value text-blue-600" id="kpi-total-profit">-</span>
                        <span class="kpi-sub">Revenue - HPP</span>
                    </div>

                    <!-- Row 2 -->
                    <div class="kpi-card">
                        <span class="kpi-label">Rata-rata CTR</span>
                        <span class="kpi-value text-purple-600" id="kpi-avg-ctr">-</span>
                        <span class="kpi-sub">Rasio Klik/Lihat</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Rata-rata Konversi</span>
                        <span class="kpi-value text-indigo-600" id="kpi-avg-conversion">-</span>
                        <span class="kpi-sub">Rasio Order/Klik</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Total Dilihat</span>
                        <span class="kpi-value text-gray-800" id="kpi-total-views">-</span>
                        <span class="kpi-sub">Views Penjualan</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Total Diklik</span>
                        <span class="kpi-value text-gray-800" id="kpi-total-clicks">-</span>
                        <span class="kpi-sub">Clicks Penjualan</span>
                    </div>

                    <!-- Row 3 -->
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Tidak Bergerak</span>
                        <span class="kpi-value text-red-600" id="kpi-dead-products">-</span>
                        <span class="kpi-sub">Stok Mandek 30 Hari</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Stok Menipis</span>
                        <span class="kpi-value text-amber-600" id="kpi-low-stock-products">-</span>
                        <span class="kpi-sub">Stok <= 5 Pcs</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Baru</span>
                        <span class="kpi-value text-teal-600" id="kpi-new-products">-</span>
                        <span class="kpi-sub">Ditambahkan Periode Ini</span>
                    </div>
                    <div class="kpi-card">
                        <span class="kpi-label">Produk Direstock</span>
                        <span class="kpi-value text-green-600" id="kpi-restocked-products">-</span>
                        <span class="kpi-sub">Barang Masuk Periode Ini</span>
                    </div>
                </div>

                <!-- Main Layout Body -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <!-- Left: Performance Table -->
                    <div class="lg:col-span-2 space-y-4">
                        <div class="flex justify-between items-center">
                            <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                                <i class="ph ph-presentation-chart text-indigo-600 text-base"></i> Peringkat Performa Produk
                            </h4>
                            <span class="text-[10px] text-gray-400 font-semibold" id="ba-prod-count-label"></span>
                        </div>
                        
                        <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
                            <table class="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                        <th class="px-4 py-3 text-center w-12">Rank</th>
                                        <th class="px-4 py-3 w-12">Foto</th>
                                        <th class="px-4 py-3 th-sortable" id="th-ProductName" onclick="BusinessAnalyticsProduct.sort('ProductName')">Produk</th>
                                        <th class="px-4 py-3 th-sortable" id="th-SKU" onclick="BusinessAnalyticsProduct.sort('SKU')">SKU</th>
                                        <th class="px-4 py-3">Kategori</th>
                                        <th class="px-4 py-3">Status</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Views" onclick="BusinessAnalyticsProduct.sort('Views')">Dilihat</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Clicks" onclick="BusinessAnalyticsProduct.sort('Clicks')">Klik</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-CTR" onclick="BusinessAnalyticsProduct.sort('CTR')">CTR</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Conversion" onclick="BusinessAnalyticsProduct.sort('Conversion')">Konv</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Qty" onclick="BusinessAnalyticsProduct.sort('Qty')">Qty</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Revenue" onclick="BusinessAnalyticsProduct.sort('Revenue')">Omzet</th>
                                        <th class="px-4 py-3 text-right th-sortable" id="th-Profit" onclick="BusinessAnalyticsProduct.sort('Profit')">Laba</th>
                                        <th class="px-4 py-3 text-center th-sortable" id="th-Trend" onclick="BusinessAnalyticsProduct.sort('Trend')">Tren</th>
                                        <th class="px-4 py-3 text-center th-sortable" id="th-PerformanceScore" onclick="BusinessAnalyticsProduct.sort('PerformanceScore')">Skor</th>
                                    </tr>
                                </thead>
                                <tbody id="ba-product-table-body" class="divide-y divide-gray-100 text-gray-700">
                                    <!-- Dynamic Rows -->
                                </tbody>
                            </table>
                        </div>
                        
                        <!-- Table Pagination Controls -->
                        <div class="flex justify-between items-center text-xs text-gray-500 px-1">
                            <div class="flex items-center gap-2">
                                <span>Tampilkan:</span>
                                <select id="ba-page-size" onchange="BusinessAnalyticsProduct.changePageSize(this.value)" class="ds-input py-1 px-2 w-16">
                                    <option value="50">50</option>
                                    <option value="100">100</option>
                                    <option value="200">200</option>
                                </select>
                            </div>
                            <div class="flex items-center gap-2" id="ba-pagination-buttons">
                                <!-- Dynamic Buttons -->
                            </div>
                        </div>
                    </div>

                    <!-- Right: Widget Insight Cards -->
                    <div class="space-y-4">
                        <div class="flex justify-between items-center">
                            <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                                <i class="ph ph-crown text-indigo-600 text-base"></i> Ringkasan Peringkat
                            </h4>
                        </div>
                        <!-- Top 5 lists -->
                        <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-4">
                            <!-- Header Tabs for widget lists -->
                            <div class="flex border-b border-gray-100 pb-2 gap-3 text-[10px] font-bold text-gray-400">
                                <button onclick="BusinessAnalyticsProduct.switchWidgetTab('revenue')" id="btn-tab-rev" class="text-indigo-600 border-b-2 border-indigo-600 pb-1">Top Omzet</button>
                                <button onclick="BusinessAnalyticsProduct.switchWidgetTab('profit')" id="btn-tab-prof" class="pb-1">Top Laba</button>
                                <button onclick="BusinessAnalyticsProduct.switchWidgetTab('growth')" id="btn-tab-growth" class="pb-1">Top Pertumbuhan</button>
                            </div>
                            <div id="ba-widget-lists-container" class="space-y-3">
                                <!-- Dynamic Widget Lists -->
                            </div>
                        </div>

                        <!-- Widget: Dead Stock -->
                        <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                            <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                                <i class="ph ph-archive text-rose-500 text-base"></i> Produk Tidak Bergerak
                            </h4>
                            <div id="ba-widget-deadstock" class="space-y-3 max-h-48 overflow-y-auto pr-1 text-xs">
                                <!-- Dynamic -->
                            </div>
                        </div>

                        <!-- Widget: Low Stock -->
                        <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                            <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                                <i class="ph ph-warning-octagon text-amber-500 text-base"></i> Hampir Habis (Low Stock)
                            </h4>
                            <div id="ba-widget-lowstock" class="space-y-3 max-h-48 overflow-y-auto pr-1 text-xs">
                                <!-- Dynamic -->
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Bottom Section: Troubleshooting & Heatmap Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                    <!-- Left: Troubleshooting List -->
                    <div class="lg:col-span-2 bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                            <i class="ph ph-wrench text-rose-500 text-base"></i> Troubleshooting Produk & Masalah
                        </h4>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold">
                                        <th class="px-3 py-2">Produk</th>
                                        <th class="px-3 py-2">Masalah</th>
                                        <th class="px-3 py-2">Rekomendasi</th>
                                        <th class="px-3 py-2 text-center w-20">Prioritas</th>
                                    </tr>
                                </thead>
                                <tbody id="ba-product-trouble-body" class="divide-y divide-gray-100 text-gray-700">
                                    <!-- Dynamic -->
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Right: Transaction Heatmap -->
                    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-3">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                            <i class="ph ph-fire text-orange-500 text-base"></i> Heatmap Waktu Pembelian (Senin - Minggu)
                        </h4>
                        <div class="space-y-2">
                            <div class="heatmap-grid" id="ba-heatmap-container">
                                <!-- Dynamic cells -->
                            </div>
                            <div class="flex justify-between items-center text-[9px] text-gray-400 pt-2 border-t border-gray-50">
                                <span>Jam: 00</span>
                                <span>12</span>
                                <span>23</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Load KPI text
            const fmt = BusinessAnalyticsShared.formatCurrency;
            const fmtNum = BusinessAnalyticsShared.formatNumber;
            const fmtPct = BusinessAnalyticsShared.formatPercent;

            document.getElementById("kpi-active-products").textContent = fmtNum(kpis.activeProducts || 0);
            document.getElementById("kpi-sold-products").textContent = fmtNum(kpis.soldProducts || 0);
            document.getElementById("kpi-total-revenue").textContent = fmt(kpis.totalRevenue || 0);
            document.getElementById("kpi-total-profit").textContent = fmt(kpis.totalProfit || 0);

            document.getElementById("kpi-avg-ctr").textContent = fmtPct(kpis.avgCTR || 0);
            document.getElementById("kpi-avg-conversion").textContent = fmtPct(kpis.avgConversion || 0);
            document.getElementById("kpi-total-views").textContent = fmtNum(kpis.totalViews || 0);
            document.getElementById("kpi-total-clicks").textContent = fmtNum(kpis.totalClicks || 0);

            document.getElementById("kpi-dead-products").textContent = fmtNum(kpis.deadProducts || 0);
            document.getElementById("kpi-low-stock-products").textContent = fmtNum(kpis.lowStockProducts || 0);
            document.getElementById("kpi-new-products").textContent = fmtNum(kpis.newProducts || 0);
            document.getElementById("kpi-restocked-products").textContent = fmtNum(kpis.restockedProducts || 0);

            this.filterData();
            this.renderHeatmap();
        },

        filterData() {
            const cat = document.getElementById("ba-prod-filter-cat").value;
            const status = document.getElementById("ba-prod-filter-status").value;
            const search = document.getElementById("ba-prod-search").value.toLowerCase();

            filteredData = [...rawProductData];

            if (cat) {
                filteredData = filteredData.filter(p => p.Category === cat);
            }

            if (status) {
                filteredData = filteredData.filter(p => p.Status === status);
            }

            if (search) {
                filteredData = filteredData.filter(p => 
                    p.ProductName.toLowerCase().includes(search) || 
                    p.SKU.toLowerCase().includes(search) ||
                    (p.Details && p.Details.ShopeeID.toLowerCase().includes(search))
                );
            }

            currentPage = 1;
            this.sortData();
            this.renderWidgets();
            this.renderProblems();
        },

        sort(field) {
            if (sortField === field) {
                sortAsc = !sortAsc;
            } else {
                sortField = field;
                sortAsc = false;
            }
            this.sortData();
        },

        sortData() {
            filteredData.sort((a, b) => {
                let valA = a[sortField];
                let valB = b[sortField];

                // Nested properties resolution
                if (sortField === "ShopeeID") {
                    valA = a.Details ? a.Details.ShopeeID : "";
                    valB = b.Details ? b.Details.ShopeeID : "";
                }

                // If numeric string or number
                if (!isNaN(parseFloat(valA)) && isFinite(valA)) {
                    return sortAsc ? valA - valB : valB - valA;
                }

                // If string comparisons
                const strA = String(valA).toLowerCase();
                const strB = String(valB).toLowerCase();
                if (strA < strB) return sortAsc ? -1 : 1;
                if (strA > strB) return sortAsc ? 1 : -1;
                return 0;
            });

            this.renderTable();
        },

        renderTable() {
            const tbody = document.getElementById("ba-product-table-body");
            if (!tbody) return;
            tbody.innerHTML = "";

            // Update header class triggers for sorting arrows
            const headers = ["ProductName", "SKU", "Views", "Clicks", "CTR", "Conversion", "Qty", "Revenue", "Profit", "Trend", "PerformanceScore"];
            headers.forEach(h => {
                const el = document.getElementById("th-" + h);
                if (el) {
                    el.className = "px-4 py-3 th-sortable " + (sortField === h ? (sortAsc ? "asc" : "desc") : "");
                }
            });

            const countLabel = document.getElementById("ba-prod-count-label");
            if (countLabel) {
                countLabel.textContent = `Menampilkan ${filteredData.length} dari ${rawProductData.length} Produk`;
            }

            if (filteredData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="15" class="px-4 py-12 text-center text-gray-400">Tidak ada produk yang cocok dengan filter.</td>
                    </tr>
                `;
                document.getElementById("ba-pagination-buttons").innerHTML = "";
                return;
            }

            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, filteredData.length);
            const pageData = filteredData.slice(startIndex, endIndex);

            const fmt = BusinessAnalyticsShared.formatCurrency;
            const fmtNum = BusinessAnalyticsShared.formatNumber;
            const fmtPct = BusinessAnalyticsShared.formatPercent;

            pageData.forEach((p, idx) => {
                const tr = document.createElement("tr");
                tr.className = "hover:bg-gray-50/50 cursor-pointer transition-colors";
                tr.onclick = () => BusinessAnalyticsProduct.openDrawer(p.ProductName);

                // Look up master image
                let imgUrl = "icons/logo-ansla.png";
                if (masterMap[p.SKU] && masterMap[p.SKU]["Gambar"]) {
                    imgUrl = masterMap[p.SKU]["Gambar"];
                }

                const rank = startIndex + idx + 1;

                // Status Badge Color
                let statusBadgeClass = "ds-badge-blue";
                if (p.Status === "Habis") statusBadgeClass = "ds-badge-red";
                else if (p.Status === "Stok Menipis") statusBadgeClass = "ds-badge-amber";
                else if (p.Status === "Tidak Bergerak") statusBadgeClass = "ds-badge-purple";
                else if (p.Status === "Nonaktif") statusBadgeClass = "ds-badge-gray";

                // Trend icon
                let trendIcon = '<i class="ph ph-arrow-right text-gray-400" title="Stabil"></i>';
                if (p.Trend === "Naik") trendIcon = '<i class="ph ph-arrow-up-right text-emerald-500 font-bold" title="Naik"></i>';
                else if (p.Trend === "Turun") trendIcon = '<i class="ph ph-arrow-down-right text-red-500 font-bold" title="Turun"></i>';

                // Performance Score Badge Color
                let scoreBadgeClass = "bg-rose-50 text-rose-700 border border-rose-100";
                if (p.PerformanceScore >= 95) scoreBadgeClass = "bg-green-50 text-green-700 border border-green-200";
                else if (p.PerformanceScore >= 85) scoreBadgeClass = "bg-blue-50 text-blue-700 border border-blue-200";
                else if (p.PerformanceScore >= 70) scoreBadgeClass = "bg-indigo-50 text-indigo-700 border border-indigo-200";
                else if (p.PerformanceScore >= 55) scoreBadgeClass = "bg-amber-50 text-amber-700 border border-amber-200";

                tr.innerHTML = `
                    <td class="px-4 py-3 text-center font-bold text-gray-400">${rank}</td>
                    <td class="px-4 py-3">
                        <img src="${imgUrl}" alt="" class="w-8 h-8 rounded-lg object-cover border border-gray-100 flex-shrink-0" onerror="this.src='icons/logo-ansla.png'">
                    </td>
                    <td class="px-4 py-3 font-semibold text-gray-900 leading-snug max-w-xs truncate" title="${p.ProductName}">${p.ProductName}</td>
                    <td class="px-4 py-3 font-mono text-[10px] font-semibold">${p.SKU}</td>
                    <td class="px-4 py-3 text-gray-500 text-[10px]">${p.Category}</td>
                    <td class="px-4 py-3"><span class="ds-badge ${statusBadgeClass} text-[10px]">${p.Status}</span></td>
                    <td class="px-4 py-3 text-right text-gray-500">${fmtNum(p.Views)}</td>
                    <td class="px-4 py-3 text-right text-gray-500">${fmtNum(p.Clicks)}</td>
                    <td class="px-4 py-3 text-right font-medium">${fmtPct(p.CTR)}</td>
                    <td class="px-4 py-3 text-right font-medium">${fmtPct(p.Conversion)}</td>
                    <td class="px-4 py-3 text-right font-bold text-gray-800">${fmtNum(p.Qty)}</td>
                    <td class="px-4 py-3 text-right font-extrabold text-gray-800">${fmt(p.Revenue)}</td>
                    <td class="px-4 py-3 text-right font-bold text-emerald-600">${fmt(p.Profit)}</td>
                    <td class="px-4 py-3 text-center">${trendIcon}</td>
                    <td class="px-4 py-3 text-center">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${scoreBadgeClass}" title="${p.PerformanceCategory}">${p.PerformanceScore}</span>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            this.renderPagination();
        },

        renderPagination() {
            const pageCount = Math.ceil(filteredData.length / pageSize);
            const container = document.getElementById("ba-pagination-buttons");
            if (!container) return;
            container.innerHTML = "";

            if (pageCount <= 1) return;

            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - 2);
            let endPage = Math.min(pageCount, startPage + maxVisible - 1);
            if (endPage - startPage + 1 < maxVisible) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }

            // Prev button
            const prevBtn = document.createElement("button");
            prevBtn.className = "ds-page-btn";
            prevBtn.disabled = currentPage === 1;
            prevBtn.innerHTML = '<i class="ph ph-caret-left"></i>';
            prevBtn.onclick = () => { currentPage--; BusinessAnalyticsProduct.renderTable(); };
            container.appendChild(prevBtn);

            for (let i = startPage; i <= endPage; i++) {
                const btn = document.createElement("button");
                btn.className = `ds-page-btn ${currentPage === i ? "active" : ""}`;
                btn.textContent = i;
                btn.onclick = () => { currentPage = i; BusinessAnalyticsProduct.renderTable(); };
                container.appendChild(btn);
            }

            // Next button
            const nextBtn = document.createElement("button");
            nextBtn.className = "ds-page-btn";
            nextBtn.disabled = currentPage === pageCount;
            nextBtn.innerHTML = '<i class="ph ph-caret-right"></i>';
            nextBtn.onclick = () => { currentPage++; BusinessAnalyticsProduct.renderTable(); };
            container.appendChild(nextBtn);
        },

        changePageSize(size) {
            pageSize = parseInt(size);
            currentPage = 1;
            this.renderTable();
        },

        switchWidgetTab(tabName) {
            const btnRev = document.getElementById("btn-tab-rev");
            const btnProf = document.getElementById("btn-tab-prof");
            const btnGrowth = document.getElementById("btn-tab-growth");

            btnRev.className = "pb-1";
            btnProf.className = "pb-1";
            btnGrowth.className = "pb-1";

            const btn = tabName === "revenue" ? btnRev : (tabName === "profit" ? btnProf : btnGrowth);
            btn.className = "text-indigo-600 border-b-2 border-indigo-600 pb-1";

            this.renderWidgetLists(tabName);
        },

        renderWidgets() {
            this.switchWidgetTab("revenue");

            // Low Stock list
            const lowEl = document.getElementById("ba-widget-lowstock");
            if (lowEl) {
                const lowItems = rawProductData.filter(p => p.Status === "Stok Menipis" || p.Status === "Habis").slice(0, 5);
                if (lowItems.length === 0) {
                    lowEl.innerHTML = `<div class="text-xs text-gray-400 text-center py-4">Semua stok aman.</div>`;
                } else {
                    lowEl.innerHTML = lowItems.map(p => `
                        <div class="flex items-center justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                            <div class="min-w-0 flex-1 pr-2">
                                <div class="font-bold text-gray-800 truncate cursor-pointer" onclick="BusinessAnalyticsProduct.openDrawer('${p.ProductName}')">${p.ProductName}</div>
                                <div class="text-[9px] text-gray-400 mt-0.5">SKU: ${p.SKU}</div>
                            </div>
                            <span class="ds-badge ${p.StockBreakdown.Warehouse === 0 ? "ds-badge-red" : "ds-badge-amber"} font-mono">${p.StockBreakdown.Warehouse} Pcs</span>
                        </div>
                    `).join("");
                }
            }

            // Dead Stock list
            const deadEl = document.getElementById("ba-widget-deadstock");
            if (deadEl) {
                const deadItems = rawProductData.filter(p => p.Status === "Tidak Bergerak" && p.StockBreakdown.Warehouse > 0).slice(0, 5);
                if (deadItems.length === 0) {
                    deadEl.innerHTML = `<div class="text-xs text-emerald-600 text-center py-4">Semua stok terjual aktif.</div>`;
                } else {
                    deadEl.innerHTML = deadItems.map(p => `
                        <div class="flex items-center justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                            <div class="min-w-0 flex-1 pr-2">
                                <div class="font-bold text-gray-800 truncate cursor-pointer" onclick="BusinessAnalyticsProduct.openDrawer('${p.ProductName}')">${p.ProductName}</div>
                                <div class="text-[9px] text-gray-400 mt-0.5">Stok: ${p.StockBreakdown.Warehouse} Pcs • Nilai: ${BusinessAnalyticsShared.formatCurrency(p.StockBreakdown.Warehouse * p.Details.Price)}</div>
                            </div>
                            <span class="text-[9px] text-gray-400">Tidak laku</span>
                        </div>
                    `).join("");
                }
            }
        },

        renderWidgetLists(tabName) {
            const container = document.getElementById("ba-widget-lists-container");
            if (!container) return;

            const fmt = BusinessAnalyticsShared.formatCurrency;
            const fmtNum = BusinessAnalyticsShared.formatNumber;

            let items = [];
            if (tabName === "revenue") {
                items = [...rawProductData].sort((a,b) => b.Revenue - a.Revenue).slice(0, 5);
            } else if (tabName === "profit") {
                items = [...rawProductData].sort((a,b) => b.Profit - a.Profit).slice(0, 5);
            } else {
                // Growth (based on Performance Score)
                items = [...rawProductData].sort((a,b) => b.PerformanceScore - a.PerformanceScore).slice(0, 5);
            }

            if (items.length === 0) {
                container.innerHTML = `<div class="text-xs text-gray-400 text-center py-4">Tidak ada data.</div>`;
                return;
            }

            container.innerHTML = items.map((p, idx) => {
                const colors = ["bg-amber-100 text-amber-800", "bg-slate-200 text-slate-700", "bg-amber-600 text-white", "bg-gray-100 text-gray-600", "bg-gray-100 text-gray-600"];
                const rankBadge = `<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${colors[idx]} flex-shrink-0">${idx + 1}</span>`;
                
                let valueText = fmt(p.Revenue);
                if (tabName === "profit") valueText = fmt(p.Profit);
                else if (tabName === "growth") valueText = `Skor: ${p.PerformanceScore}`;

                return `
                    <div class="flex items-center gap-2 pb-2 border-b border-gray-50 last:border-0 last:pb-0 text-xs">
                        ${rankBadge}
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-gray-800 truncate cursor-pointer" onclick="BusinessAnalyticsProduct.openDrawer('${p.ProductName}')">${p.ProductName}</div>
                            <div class="text-[9px] text-gray-400 mt-0.5">${p.Category} • ${fmtNum(p.Qty)} Pcs terjual</div>
                        </div>
                        <div class="text-right font-extrabold text-gray-900 flex-shrink-0 ml-2">${valueText}</div>
                    </div>
                `;
            }).join("");
        },

        renderProblems() {
            const tbody = document.getElementById("ba-product-trouble-body");
            if (!tbody) return;
            tbody.innerHTML = "";

            if (problems.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" class="px-3 py-6 text-center text-gray-400">Tidak ada produk bermasalah yang terdeteksi.</td>
                    </tr>
                `;
                return;
            }

            problems.forEach(p => {
                const tr = document.createElement("tr");
                tr.className = "hover:bg-gray-50/50";

                let badgeColor = "bg-rose-50 text-rose-700";
                if (p.Priority === "Medium") badgeColor = "bg-amber-50 text-amber-700";
                else if (p.Priority === "High") badgeColor = "bg-orange-50 text-orange-700";

                tr.innerHTML = `
                    <td class="px-3 py-2 font-semibold text-gray-800 truncate max-w-[180px] cursor-pointer" onclick="BusinessAnalyticsProduct.openDrawer('${p.Product}')">${p.Product}</td>
                    <td class="px-3 py-2 text-rose-600 font-medium">${p.Problem}</td>
                    <td class="px-3 py-2 text-gray-500">${p.Recommendation}</td>
                    <td class="px-3 py-2 text-center">
                        <span class="px-2 py-0.5 rounded text-[9px] font-extrabold ${badgeColor}">${p.Priority}</span>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        },

        renderHeatmap() {
            const container = document.getElementById("ba-heatmap-container");
            if (!container) return;
            container.innerHTML = "";

            if (heatmap.length === 0) {
                container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs col-span-24">Tidak ada data.</div>`;
                return;
            }

            const daysName = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
            
            // Render cells
            // Loop through 7 days
            for (let day = 0; day < 7; day++) {
                const dayLabel = document.createElement("div");
                dayLabel.className = "text-[9px] font-bold text-gray-400 flex items-center pr-2 col-span-2 border-r border-gray-100";
                dayLabel.textContent = daysName[day];
                container.appendChild(dayLabel);

                for (let hour = 0; hour < 24; hour++) {
                    const count = heatmap[day][hour] || 0;
                    const cell = document.createElement("div");
                    
                    // Determine shading based on transaction counts
                    let opacity = 0.05;
                    if (count > 0) opacity = Math.min(1.0, 0.15 + (count * 0.15));
                    
                    cell.className = "heatmap-cell";
                    cell.style.backgroundColor = `rgba(79, 70, 229, ${opacity})`;
                    cell.title = `${daysName[day]} Jam ${hour.toString().padStart(2,"0")}:00: ${count} Transaksi`;

                    container.appendChild(cell);
                }
            }
        },

        openDrawer(productName) {
            const p = rawProductData.find(item => item.ProductName === productName);
            if (!p) return;

            const overlay = document.getElementById("ba-prod-drawer-overlay");
            const drawer = document.getElementById("ba-prod-drawer");

            const fmt = BusinessAnalyticsShared.formatCurrency;
            const fmtNum = BusinessAnalyticsShared.formatNumber;
            const fmtPct = BusinessAnalyticsShared.formatPercent;

            let imgUrl = "icons/logo-ansla.png";
            if (masterMap[p.SKU] && masterMap[p.SKU]["Gambar"]) {
                imgUrl = masterMap[p.SKU]["Gambar"];
            }

            // Fill drawer content
            drawer.innerHTML = `
                <div class="ba-drawer-header">
                    <div>
                        <h4 class="font-bold text-gray-900 text-xs">Product Intelligence Drawer</h4>
                        <p class="text-[9px] text-gray-400 mt-0.5">Analisis instan terperinci</p>
                    </div>
                    <button onclick="BusinessAnalyticsProduct.closeDrawer()" class="ds-btn ds-btn-ghost ds-btn-icon">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="ba-drawer-body">
                    <!-- Basic info header -->
                    <div class="flex gap-4 items-start pb-4 border-b border-gray-100">
                        <img src="${imgUrl}" alt="" class="w-20 h-20 rounded-xl object-cover border border-gray-100" onerror="this.src='icons/logo-ansla.png'">
                        <div class="min-w-0 flex-1">
                            <h3 class="font-extrabold text-sm text-gray-900 leading-snug break-words">${p.ProductName}</h3>
                            <div class="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-500 font-medium">
                                <div>SKU: <span class="font-mono font-bold text-gray-800">${p.SKU}</span></div>
                                <div>Kategori: <span class="text-indigo-600 font-bold">${p.Category}</span></div>
                                <div>Brand: <span class="font-bold text-gray-800">${p.Details.Brand}</span></div>
                                <div>Shopee ID: <span class="font-mono font-bold text-gray-800">${p.Details.ShopeeID}</span></div>
                                <div>Barcode: <span class="font-mono font-bold text-gray-800">${p.Details.Barcode}</span></div>
                                <div>Status: <span class="font-bold text-indigo-500">${p.Status}</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Pricing & Margin Info -->
                    <div class="bg-gray-50 border border-gray-100 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div>
                            <div class="text-[9px] text-gray-400 uppercase font-bold">Harga Jual</div>
                            <div class="font-extrabold text-xs text-gray-800 mt-0.5">${fmt(p.Details.Price)}</div>
                        </div>
                        <div>
                            <div class="text-[9px] text-gray-400 uppercase font-bold">Harga Modal</div>
                            <div class="font-extrabold text-xs text-gray-800 mt-0.5">${fmt(p.Details.Modal)}</div>
                        </div>
                        <div>
                            <div class="text-[9px] text-gray-400 uppercase font-bold">Margin %</div>
                            <div class="font-extrabold text-xs text-emerald-600 mt-0.5">${fmtPct(p.Margin)}</div>
                        </div>
                        <div>
                            <div class="text-[9px] text-gray-400 uppercase font-bold">Laba / Pcs</div>
                            <div class="font-extrabold text-xs text-blue-600 mt-0.5">${fmt(p.Details.Price - p.Details.Modal)}</div>
                        </div>
                    </div>

                    <!-- Stock Breakdown -->
                    <div class="space-y-2">
                        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Perincian Stok</h5>
                        <div class="grid grid-cols-4 gap-2 text-center text-xs">
                            <div class="bg-blue-50/50 border border-blue-100/50 rounded-xl p-2.5">
                                <div class="text-[9px] text-blue-600 font-bold">Gudang</div>
                                <div class="font-extrabold text-sm text-blue-800 mt-1">${p.StockBreakdown.Warehouse}</div>
                            </div>
                            <div class="bg-teal-50/50 border border-teal-100/50 rounded-xl p-2.5">
                                <div class="text-[9px] text-teal-600 font-bold">Shopee</div>
                                <div class="font-extrabold text-sm text-teal-800 mt-1">${p.StockBreakdown.Shopee}</div>
                            </div>
                            <div class="bg-purple-50/50 border border-purple-100/50 rounded-xl p-2.5">
                                <div class="text-[9px] text-purple-600 font-bold">Reserved</div>
                                <div class="font-extrabold text-sm text-purple-800 mt-1">${p.StockBreakdown.Reserved}</div>
                            </div>
                            <div class="bg-green-50/50 border border-green-100/50 rounded-xl p-2.5">
                                <div class="text-[9px] text-green-600 font-bold">Available</div>
                                <div class="font-extrabold text-sm text-green-800 mt-1">${p.StockBreakdown.Available}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 12 Detail KPI Grid -->
                    <div class="space-y-2">
                        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Metrik Performa 15 Hari</h5>
                        <div class="grid grid-cols-3 gap-3 text-center text-xs">
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">Dilihat</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtNum(p.Views)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">Klik</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtNum(p.Clicks)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">CTR</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtPct(p.CTR)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">Conversion</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtPct(p.Conversion)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">Order</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtNum(p.Sold)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl">
                                <div class="text-[9px] text-gray-400">Qty Terjual</div>
                                <div class="font-extrabold text-gray-800 mt-0.5">${fmtNum(p.Qty)}</div>
                            </div>
                            <div class="border border-gray-100 p-2 rounded-xl col-span-3 grid grid-cols-3 divide-x divide-gray-100 bg-gray-50/50 py-2">
                                <div>
                                    <div class="text-[9px] text-gray-400">Revenue</div>
                                    <div class="font-extrabold text-gray-800 mt-0.5">${fmt(p.Revenue)}</div>
                                </div>
                                <div>
                                    <div class="text-[9px] text-gray-400">Laba</div>
                                    <div class="font-extrabold text-emerald-600 mt-0.5">${fmt(p.Profit)}</div>
                                </div>
                                <div>
                                    <div class="text-[9px] text-gray-400">Skor</div>
                                    <div class="font-extrabold text-indigo-600 mt-0.5">${p.PerformanceScore}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- AI Business Intelligence Insights -->
                    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
                        <h5 class="text-[10px] font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                            <i class="ph ph-sparkle-fill"></i> AI Intelligence Insight
                        </h5>
                        <ul class="list-disc list-inside text-[11px] text-indigo-900 space-y-1">
                            ${p.AIInsight.map(insight => `<li>${insight}</li>`).join("")}
                        </ul>
                    </div>

                    <!-- Forecasting & Predictions -->
                    <div class="space-y-2">
                        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Perkiraan Stok & Forecast</h5>
                        <div class="border border-gray-100 rounded-2xl p-3 space-y-2.5 text-xs text-gray-600">
                            <div class="flex justify-between">
                                <span>Prediksi Stok Habis:</span>
                                <span class="font-bold text-red-600">${p.Forecast.StockOutDays < 999 ? `${p.Forecast.StockOutDays} Hari lagi` : "Aman"}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Rekomendasi Reorder:</span>
                                <span class="font-bold text-gray-800">${p.Forecast.ReorderDate}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Estimasi Penjualan (30 Hari):</span>
                                <span class="font-bold text-gray-800">${p.Forecast.EstSales30Days} Pcs</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Prediksi Omzet (30 Hari):</span>
                                <span class="font-bold text-emerald-600">${fmt(p.Forecast.OmzetForecast)}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Prediksi Laba (30 Hari):</span>
                                <span class="font-bold text-blue-600">${fmt(p.Forecast.ProfitForecast)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Charts container (Pure SVG Renderers) -->
                    <div class="space-y-6">
                        <div class="space-y-1">
                            <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Grafik Pendapatan (Area Chart)</h5>
                            <div id="drawer-chart-revenue" class="h-36 border border-gray-50 rounded-xl p-2 bg-white"></div>
                        </div>
                        <div class="space-y-1">
                            <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Grafik Order Penjualan (Bar Chart)</h5>
                            <div id="drawer-chart-sales" class="h-36 border border-gray-50 rounded-xl p-2 bg-white"></div>
                        </div>
                        <div class="space-y-1">
                            <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Grafik Perubahan Stok (Line Chart)</h5>
                            <div id="drawer-chart-stock" class="h-36 border border-gray-50 rounded-xl p-2 bg-white"></div>
                        </div>
                    </div>

                    <!-- Timeline Histori Produk -->
                    <div class="space-y-3">
                        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Timeline Histori Sistem</h5>
                        <div class="relative pl-4 border-l-2 border-indigo-100 text-xs space-y-4">
                            <div class="relative">
                                <span class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-600 border-2 border-white"></span>
                                <div class="font-bold text-gray-800">Restock Terakhir Terdeteksi</div>
                                <div class="text-[9px] text-gray-400">Pembaruan transaksi restock diselesaikan</div>
                            </div>
                            <div class="relative">
                                <span class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white"></span>
                                <div class="font-bold text-gray-800">Penjualan Pertama Selesai</div>
                                <div class="text-[9px] text-gray-400">Pesanan pertama berhasil disinkronisasi dan lunas</div>
                            </div>
                            <div class="relative">
                                <span class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white"></span>
                                <div class="font-bold text-gray-800">Mapping Shopee Selesai</div>
                                <div class="text-[9px] text-gray-400">Mapping variasi produk ke SKU terverifikasi</div>
                            </div>
                            <div class="relative">
                                <span class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-gray-400 border-2 border-white"></span>
                                <div class="font-bold text-gray-800">Produk Master Dibuat</div>
                                <div class="text-[9px] text-gray-400">Barcode dan identitas SKU didaftarkan ke gudang</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Open overlay & drawer
            overlay.classList.add("open");
            drawer.classList.add("open");

            // Extract daily data points from DailySales
            const dailyData = p.DailySales || {};
            const sortedDates = Object.keys(dailyData).sort();
            
            // Fill default dates if empty
            const chartDates = sortedDates.length > 0 ? sortedDates : ["01 Jul", "05 Jul", "10 Jul", "15 Jul"];
            const chartRevenues = sortedDates.length > 0 ? sortedDates.map(d => dailyData[d].revenue || 0) : [0, 0, 0, 0];
            const chartQtys = sortedDates.length > 0 ? sortedDates.map(d => dailyData[d].qty || 0) : [0, 0, 0, 0];

            // Render SVG Charts in drawer
            setTimeout(() => {
                BusinessAnalyticsShared.createSvgAreaChart("drawer-chart-revenue", chartRevenues, chartDates);
                BusinessAnalyticsShared.createSvgBarChart("drawer-chart-sales", chartQtys, chartDates);

                // Deterministic stock path (decrementing as items sell)
                let initialStock = p.StockBreakdown.Available + p.Qty;
                const stockHistory = [];
                chartDates.forEach(d => {
                    const sold = dailyData[d] ? dailyData[d].qty || 0 : 0;
                    initialStock -= sold;
                    stockHistory.push(initialStock);
                });
                if (stockHistory.length === 0) stockHistory.push(p.StockBreakdown.Available);
                BusinessAnalyticsShared.createSvgLineChart("drawer-chart-stock", stockHistory, chartDates);
            }, 100);
        },

        closeDrawer() {
            const overlay = document.getElementById("ba-prod-drawer-overlay");
            const drawer = document.getElementById("ba-prod-drawer");
            if (overlay) overlay.classList.remove("open");
            if (drawer) drawer.classList.remove("open");
        },

        exportExcel() {
            const dataToExport = filteredData.map((p, idx) => ({
                "Peringkat": idx + 1,
                "Nama Produk": p.ProductName,
                "SKU Utama": p.SKU,
                "Kategori": p.Category,
                "Status": p.Status,
                "Dilihat": p.Views,
                "Klik": p.Clicks,
                "CTR %": p.CTR,
                "Konversi %": p.Conversion,
                "Terjual (Order)": p.Sold,
                "Qty Terjual": p.Qty,
                "Pendapatan": p.Revenue,
                "Laba Bersih": p.Profit,
                "Margin %": p.Margin,
                "Tren": p.Trend,
                "Skor Performa": p.PerformanceScore
            }));
            const ws = XLSX.utils.json_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Product Intelligence");
            XLSX.writeFile(wb, `Product_Intelligence_Report_${formatExportDate(new Date())}.xlsx`);
        },

        exportCSV() {
            let csv = "Rank,Nama Produk,SKU,Kategori,Status,Dilihat,Klik,CTR %,Konversi %,Terjual,Qty,Pendapatan,Laba,Margin %,Skor\n";
            filteredData.forEach((p, idx) => {
                const name = p.ProductName.replace(/"/g, '""');
                csv += `${idx + 1},"${name}","${p.SKU}","${p.Category}","${p.Status}",${p.Views},${p.Clicks},${p.CTR},${p.Conversion},${p.Sold},${p.Qty},${p.Revenue},${p.Profit},${p.Margin},${p.PerformanceScore}\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.setAttribute("download", `Product_Intelligence_Report_${formatExportDate(new Date())}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        exportPDF() {
            const printWindow = window.open("", "_blank");
            let html = `
                <html>
                <head>
                    <title>Product Intelligence Report</title>
                    <style>
                        body { font-family: sans-serif; padding: 20px; color: #333; }
                        h2 { margin-bottom: 5px; }
                        p { font-size: 12px; color: #666; margin-top: 0; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10px; }
                        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
                        th { background-color: #f2f2f2; font-weight: bold; }
                        tr:nth-child(even) { background-color: #f9f9f9; }
                    </style>
                </head>
                <body>
                    <h2>Product Intelligence Report</h2>
                    <p>Dicetak pada: ${formatDateTime(new Date())}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Nama Produk</th>
                                <th>SKU</th>
                                <th>Kategori</th>
                                <th>Status</th>
                                <th>Terjual</th>
                                <th>Pendapatan</th>
                                <th>Laba</th>
                                <th>Skor</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            filteredData.forEach((p, idx) => {
                html += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>${p.ProductName}</td>
                        <td>${p.SKU}</td>
                        <td>${p.Category}</td>
                        <td>${p.Status}</td>
                        <td>${p.Qty} Pcs</td>
                        <td>${BusinessAnalyticsShared.formatCurrency(p.Revenue)}</td>
                        <td>${BusinessAnalyticsShared.formatCurrency(p.Profit)}</td>
                        <td>${p.PerformanceScore} (${p.PerformanceCategory})</td>
                    </tr>
                `;
            });
            html += `
                        </tbody>
                    </table>
                    <script>
                        window.onload = function() { window.print(); window.close(); }
                    </script>
                </body>
                </html>
            `;
            printWindow.document.write(html);
            printWindow.document.close();
        }
    };
})();
