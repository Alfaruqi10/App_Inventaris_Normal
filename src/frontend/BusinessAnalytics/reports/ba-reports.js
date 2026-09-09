// ============================================================
// BusinessAnalytics/reports/ba-reports.js — Sistem Laporan & Ekspor
// ============================================================

const BusinessAnalyticsReports = (function() {
    let reportRawData = [];

    return {
        async init() {
            const container = document.getElementById("ba-laporan-container");
            if (!container) return;

            // Render Laporan Filter & Layout
            this.renderLayout();

            // Load data awal
            await this.loadData();
        },

        renderLayout() {
            const container = document.getElementById("ba-laporan-container");
            
            // Default date range (30 hari terakhir)
            const today = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 30);

            const formatDateInput = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                return `${y}-${m}-${day}`;
            };

            container.innerHTML = `
                <!-- Filter Panel -->
                <div class="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-4 text-xs">
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="flex flex-col gap-1">
                            <label class="font-bold text-gray-500">Tanggal Mulai</label>
                            <input type="date" id="ba-rep-start-date" value="${formatDateInput(start)}" class="ds-input py-1.5 px-3">
                        </div>
                        <div class="flex flex-col gap-1">
                            <label class="font-bold text-gray-500">Tanggal Selesai</label>
                            <input type="date" id="ba-rep-end-date" value="${formatDateInput(today)}" class="ds-input py-1.5 px-3">
                        </div>
                        <div class="flex flex-col gap-1">
                            <label class="font-bold text-gray-500">Sumber Data</label>
                            <select id="ba-rep-source" class="ds-input py-1.5 px-3">
                                <option value="all">Semua Data (Shopee + Gudang)</option>
                                <option value="shopee">Data Shopee (Sales Ledger)</option>
                                <option value="gudang">Data Gudang (Transaksi Lokal)</option>
                            </select>
                        </div>
                        <div class="flex flex-col gap-1">
                            <label class="font-bold text-gray-500">Cari SKU / Produk</label>
                            <input type="text" id="ba-rep-query" placeholder="Ketik kata kunci..." class="ds-input py-1.5 px-3">
                        </div>
                    </div>

                    <div class="flex justify-end gap-2 border-t pt-3">
                        <button onclick="BusinessAnalyticsReports.loadData()" class="ds-btn ds-btn-primary px-4 py-2 text-xs flex items-center gap-1.5"><i class="ph ph-funnel"></i> Terapkan Filter</button>
                    </div>
                </div>

                <!-- Export Action Buttons & Preview Table -->
                <div class="space-y-4">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <h4 class="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5"><i class="ph ph-file-spreadsheet text-indigo-600 text-base"></i> Preview Data Laporan</h4>
                        <div class="flex gap-2">
                            <button onclick="BusinessAnalyticsReports.exportToExcel()" class="ds-btn bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs flex items-center gap-1.5"><i class="ph ph-file-xls text-base"></i> Ekspor Excel</button>
                            <button onclick="BusinessAnalyticsReports.exportToCsv()" class="ds-btn bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 text-xs flex items-center gap-1.5"><i class="ph ph-file-csv text-base"></i> Ekspor CSV</button>
                        </div>
                    </div>

                    <div class="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm max-h-96">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold sticky top-0 z-10">
                                    <th class="px-4 py-3">Tanggal</th>
                                    <th class="px-4 py-3">ID / SKU</th>
                                    <th class="px-4 py-3">Nama Item</th>
                                    <th class="px-4 py-3">Sumber / Tipe</th>
                                    <th class="px-4 py-3 text-right">Qty</th>
                                    <th class="px-4 py-3 text-right">Total Nilai</th>
                                </tr>
                            </thead>
                            <tbody id="ba-reports-table-body" class="divide-y divide-gray-100 text-gray-700">
                                <!-- Dinamis -->
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        },

        async loadData() {
            const loader = document.getElementById("ba-content-loading");
            if (loader) loader.classList.remove("hidden");

            const startDate = document.getElementById("ba-rep-start-date").value;
            const endDate = document.getElementById("ba-rep-end-date").value;
            const source = document.getElementById("ba-rep-source").value;
            const query = document.getElementById("ba-rep-query").value.toLowerCase();

            try {
                // Ambil data sales ledger dan transaksi
                const res = await postData({ action: "getData" });
                const ledgerRes = await postData({ action: "getProductAnalytics" }); // to get SKU level rows if needed, or pull from SalesLedger

                let rows = [];

                if (res.status === "success") {
                    const start = new Date(startDate + "T00:00:00");
                    const end = new Date(endDate + "T23:59:59");

                    // 1. Tambahkan Transaksi Lokal
                    if (source === "all" || source === "gudang") {
                        res.transaksi.forEach(t => {
                            const date = new Date(t["Timestamp"]);
                            if (date >= start && date <= end) {
                                rows.push({
                                    date: t["Timestamp"],
                                    id: t["Kode Barang"],
                                    name: t["Nama Barang"],
                                    source: "Gudang: " + t["Jenis Transaksi"],
                                    qty: parseInt(t["Jumlah"]) || 0,
                                    amount: 0 // Transaksi gudang tidak menyimpan amount langsung
                                });
                            }
                        });
                    }
                }

                // 2. Tambahkan Data Shopee (dari SalesLedger)
                if (source === "all" || source === "shopee") {
                    const slRes = await postData({ action: "getSalesLedgerData" });
                    if (slRes.status === "success" && slRes.ledgers) {
                        slRes.ledgers.forEach(row => {
                            const tglStr = row["Tanggal Order"];
                            if (!tglStr) return;
                            const date = new Date(tglStr);
                            if (date >= start && date <= end) {
                                const qty = parseInt(row["Qty"]) || 0;
                                // Report preview is a product-line view. Escrow is
                                // order-level and therefore must not be repeated per line.
                                const revenueVal = parseFloat(row["Product Subtotal"] || row["Subtotal"]) || (parseFloat(row["Harga Produk"]) * qty) || 0;
                                
                                rows.push({
                                    date: tglStr,
                                    id: row["SKU Inventaris"] || row["SKU Shopee"] || "-",
                                    name: row["Nama Produk"] || row["Nama SKU Shopee"] || "-",
                                    source: "Shopee: " + (row["Status Shopee"] || "Order"),
                                    qty: qty,
                                    amount: revenueVal
                                });
                            }
                        });
                    }
                }

                // Filter berdasarkan query pencarian
                if (query) {
                    rows = rows.filter(r => 
                        String(r.id).toLowerCase().includes(query) || 
                        String(r.name).toLowerCase().includes(query)
                    );
                }

                reportRawData = rows;
                this.renderTable(rows);
            } catch (e) {
                console.error("Gagal memuat preview laporan:", e);
            } finally {
                if (loader) loader.classList.add("hidden");
            }
        },

        renderTable(rows) {
            const tbody = document.getElementById("ba-reports-table-body");
            if (!tbody) return;
            tbody.innerHTML = "";

            if (rows.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-4 py-8 text-center text-gray-400">Tidak ada data untuk filter terpilih.</td>
                    </tr>
                `;
                return;
            }

            const format = BusinessAnalyticsShared.formatCurrency;

            rows.forEach(r => {
                const tr = document.createElement("tr");
                tr.className = "hover:bg-gray-50/50 transition-colors";
                tr.innerHTML = `
                    <td class="px-4 py-3">${formatDate(r.date)}</td>
                    <td class="px-4 py-3 font-bold font-mono">${r.id}</td>
                    <td class="px-4 py-3">${r.name}</td>
                    <td class="px-4 py-3"><span class="ds-badge ds-badge-indigo">${r.source}</span></td>
                    <td class="px-4 py-3 text-right font-semibold">${r.qty} Pcs</td>
                    <td class="px-4 py-3 text-right font-bold text-gray-800">${r.amount > 0 ? format(r.amount) : "-"}</td>
                `;
                tbody.appendChild(tr);
            });
        },

        exportToExcel() {
            if (reportRawData.length === 0) {
                showToast("Tidak ada data untuk diekspor.", "error");
                return;
            }

            // Siapkan header dan baris data
            const headers = ["Tanggal", "ID / SKU", "Nama Item", "Sumber / Tipe", "Qty", "Total Nilai"];
            const dataRows = reportRawData.map(r => [
                formatDate(r.date),
                r.id,
                r.name,
                r.source,
                r.qty,
                r.amount
            ]);

            // Gunakan XLSX Library (SheetJS)
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
            XLSX.utils.book_append_sheet(wb, ws, "Laporan_BI");
            
            // Trigger download Excel
            XLSX.writeFile(wb, `Laporan_Analitik_ANSLA_${formatExportDate(new Date())}.xlsx`);
            showToast("Laporan Excel berhasil diunduh.", "success");
        },

        exportToCsv() {
            if (reportRawData.length === 0) {
                showToast("Tidak ada data untuk diekspor.", "error");
                return;
            }

            const headers = ["Tanggal", "ID / SKU", "Nama Item", "Sumber / Tipe", "Qty", "Total Nilai"];
            const csvRows = [headers.join(",")];

            reportRawData.forEach(r => {
                const row = [
                    `"${formatDate(r.date)}"`,
                    `"${r.id}"`,
                    `"${r.name.replace(/"/g, '""')}"`,
                    `"${r.source}"`,
                    r.qty,
                    r.amount
                ];
                csvRows.push(row.join(","));
            });

            const csvString = csvRows.join("\n");
            const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Laporan_Analitik_ANSLA_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast("Laporan CSV berhasil diunduh.", "success");
        }
    };
})();
