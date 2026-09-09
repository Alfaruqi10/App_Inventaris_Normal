// ============================================================
// RecoveryCenter/recovery-center-audit.js — Audit Logs Controller
// ============================================================

const RecoveryCenterAudit = (function() {
    let allLogs = [];
    let filteredLogs = [];
    let currentPage = 1;
    const itemsPerPage = 8;
    
    let searchQuery = "";
    let statusFilter = "";
    let moduleFilter = "";

    return {
        /**
         * Inisialisasi dan pengambilan data log dari backend.
         */
        async init() {
            console.log("[RecoveryCenterAudit] Memulai inisialisasi panel log...");
            this.showLoading();
            
            try {
                const res = await postData({ action: "getDeductionAuditLogs" });
                if (res.status !== "success") throw new Error(res.message);
                
                allLogs = res.logs || [];
                console.log("[RecoveryCenterAudit] Jumlah entri log termuat:", allLogs.length);
                
                // Isi filter dropdown modul secara dinamis
                this.populateModuleFilter();

                currentPage = 1;
                this.applyFilters();

            } catch (e) {
                console.error("[RecoveryCenterAudit] Gagal memuat audit logs:", e);
                const tbody = document.getElementById("rc-audit-table-body");
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-red-500 font-medium">Gagal memuat log: ${e.message}</td></tr>`;
                }
            }
        },

        showLoading() {
            const tbody = document.getElementById("rc-audit-table-body");
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400"><i class="ph ph-spinner animate-spin text-2xl"></i><div class="text-xs mt-1">Memuat berkas audit...</div></td></tr>`;
            }
        },

        populateModuleFilter() {
            const select = document.getElementById("rc-audit-filter-module");
            if (!select) return;
            
            // Dapatkan daftar modul/kategori unik
            const modules = new Set();
            allLogs.forEach(log => {
                if (log.reason) modules.add(log.reason);
            });

            // Reset options, pertahankan option pertama
            select.innerHTML = '<option value="">Semua Kategori</option>';
            modules.forEach(mod => {
                select.innerHTML += `<option value="${mod}">${mod}</option>`;
            });

            // Kembalikan filter sebelumnya jika ada
            select.value = moduleFilter;
        },

        /**
         * Menerapkan pencarian dan filter dropdown.
         */
        applyFilters() {
            searchQuery = (document.getElementById("rc-audit-search")?.value || "").toLowerCase().trim();
            statusFilter = document.getElementById("rc-audit-filter-status")?.value || "";
            moduleFilter = document.getElementById("rc-audit-filter-module")?.value || "";

            filteredLogs = allLogs.filter(log => {
                // 1. Search Query (cocokkan pada action, orderSn, user, note)
                const textMatch = !searchQuery || 
                    String(log.action).toLowerCase().includes(searchQuery) ||
                    String(log.orderSn).toLowerCase().includes(searchQuery) ||
                    String(log.user).toLowerCase().includes(searchQuery) ||
                    String(log.note).toLowerCase().includes(searchQuery);

                // 2. Status Filter
                const statusMatch = !statusFilter || String(log.newStatus).toUpperCase() === statusFilter.toUpperCase();

                // 3. Module Filter
                const moduleMatch = !moduleFilter || String(log.reason) === moduleFilter;

                return textMatch && statusMatch && moduleMatch;
            });

            currentPage = 1;
            this.render();
        },

        /**
         * Render halaman aktif ke tabel.
         */
        render() {
            const tbody = document.getElementById("rc-audit-table-body");
            const pagLabel = document.getElementById("rc-audit-pag-label");
            const btnPrev = document.getElementById("rc-audit-btn-prev");
            const btnNext = document.getElementById("rc-audit-btn-next");

            if (!tbody) return;

            if (filteredLogs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400 text-sm">Tidak ada entri log yang cocok dengan filter.</td></tr>`;
                if (pagLabel) pagLabel.textContent = "Halaman 0 dari 0";
                if (btnPrev) btnPrev.disabled = true;
                if (btnNext) btnNext.disabled = true;
                return;
            }

            const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, filteredLogs.length);
            const pageItems = filteredLogs.slice(startIndex, endIndex);

            let html = "";
            pageItems.forEach((log, index) => {
                const globalIndex = startIndex + index;
                const date = log.timestamp ? formatDateTimeShort(log.timestamp) : "—";
                
                // Styling status badge
                let statusClass = "bg-gray-100 text-gray-800";
                if (log.newStatus === "success") statusClass = "bg-green-100 text-green-800";
                else if (log.newStatus === "failed") statusClass = "bg-red-100 text-red-800";
                else if (log.newStatus === "preview") statusClass = "bg-blue-100 text-blue-800";

                html += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${date}</td>
                        <td class="px-4 py-3 text-xs font-semibold text-gray-700 whitespace-nowrap truncate max-w-[120px]" title="${log.user}">${log.user}</td>
                        <td class="px-4 py-3 text-xs text-gray-900 font-semibold whitespace-nowrap">${log.action}</td>
                        <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${log.reason || "SYSTEM"}</td>
                        <td class="px-4 py-3 text-xs whitespace-nowrap">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">${String(log.newStatus).toUpperCase()}</span>
                        </td>
                        <td class="px-4 py-3 text-xs text-right whitespace-nowrap">
                            <button onclick="RecoveryCenterAudit.showDetail(${globalIndex})" class="text-red-600 hover:text-red-700 font-semibold">
                                Detail <i class="ph ph-arrow-square-out"></i>
                            </button>
                        </td>
                    </tr>`;
            });

            tbody.innerHTML = html;

            // Update pagination UI
            if (pagLabel) pagLabel.textContent = `Halaman ${currentPage} dari ${totalPages} (Total: ${filteredLogs.length})`;
            if (btnPrev) btnPrev.disabled = currentPage === 1;
            if (btnNext) btnNext.disabled = currentPage === totalPages;
        },

        nextPage() {
            const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                this.render();
            }
        },

        prevPage() {
            if (currentPage > 1) {
                currentPage--;
                this.render();
            }
        },

        /**
         * Menampilkan detail entri log di modal khusus.
         */
        showDetail(index) {
            const log = filteredLogs[index];
            if (!log) return;

            document.getElementById("rc-detail-jobid").textContent = log.orderSn || "N/A";
            document.getElementById("rc-detail-user").textContent = log.user;
            document.getElementById("rc-detail-timestamp").textContent = log.timestamp ? formatDateTime(log.timestamp) : "—";
            document.getElementById("rc-detail-tool").textContent = log.action;
            document.getElementById("rc-detail-category").textContent = log.reason || "SYSTEM";
            
            // Format status badge
            const badge = document.getElementById("rc-detail-status");
            badge.textContent = String(log.newStatus).toUpperCase();
            badge.className = "px-2 py-0.5 rounded text-[10px] font-bold " + 
                (log.newStatus === "success" ? "bg-green-100 text-green-800" : (log.newStatus === "preview" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"));

            // Parse detail logs dari kolom note
            const detailBody = document.getElementById("rc-detail-body");
            if (log.note) {
                // Tampilkan dengan rapi (ganti separator | dengan baris baru)
                detailBody.innerHTML = log.note.split(" | ").map(item => {
                    return `<div class="py-1.5 border-b border-gray-100 last:border-b-0 flex justify-between gap-4 text-xs font-mono text-gray-700">
                        ${item.includes(":") ? `
                            <span class="font-semibold text-gray-900">${item.split(":")[0]}:</span>
                            <span class="text-right">${item.split(":").slice(1).join(":")}</span>
                        ` : `<span>${item}</span>`}
                    </div>`;
                }).join("");
            } else {
                detailBody.innerHTML = `<div class="text-gray-400 text-xs py-4 text-center">Tidak ada detail catatan log.</div>`;
            }

            document.getElementById("rc-detail-modal").classList.remove("hidden");
        },

        closeDetail() {
            document.getElementById("rc-detail-modal").classList.add("hidden");
        }
    };
})();
