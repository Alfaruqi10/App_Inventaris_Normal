// ============================================================
// NotificationCenter/nc-queue.js — Queue & History Controller
// ============================================================

const NotificationCenterQueue = (function() {
    let allQueue = [];
    let filteredQueue = [];
    let currentPage = 1;
    const itemsPerPage = 10;
    
    let searchQuery = "";
    let statusFilter = "";

    return {
        /**
         * Mengambil riwayat queue dari backend.
         */
        async init() {
            console.log("[NotificationCenterQueue] Memulai inisialisasi antrean...");
            this.showLoading();

            try {
                const res = await NotificationCenterAPI.getQueueHistory();
                if (res.status !== "success") throw new Error(res.message);

                allQueue = res.queue || [];
                console.log("[NotificationCenterQueue] Jumlah antrean termuat:", allQueue.length);

                currentPage = 1;
                this.applyFilters();

            } catch (e) {
                console.error("[NotificationCenterQueue] Gagal memuat queue:", e);
                const tbody = document.getElementById("nc-queue-table-body");
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500 font-medium">Gagal memuat log: ${e.message}</td></tr>`;
                }
            }
        },

        showLoading() {
            const tbody = document.getElementById("nc-queue-table-body");
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400"><i class="ph ph-spinner animate-spin text-2xl"></i><div class="text-[10px] mt-1">Memuat berkas antrean...</div></td></tr>`;
            }
        },

        /**
         * Menerapkan pencarian dan filter status dropdown.
         */
        applyFilters() {
            searchQuery = (document.getElementById("nc-queue-search")?.value || "").toLowerCase().trim();
            statusFilter = document.getElementById("nc-queue-filter-status")?.value || "";

            filteredQueue = allQueue.filter(q => {
                const textMatch = !searchQuery || 
                    String(q.Username).toLowerCase().includes(searchQuery) ||
                    String(q.ChatID).toLowerCase().includes(searchQuery) ||
                    String(q.Text).toLowerCase().includes(searchQuery);

                const statusMatch = !statusFilter || String(q.Status).toUpperCase() === statusFilter.toUpperCase();

                return textMatch && statusMatch;
            });

            currentPage = 1;
            this.render();
        },

        /**
         * Render baris tabel antrean.
         */
        render() {
            const tbody = document.getElementById("nc-queue-table-body");
            const pagLabel = document.getElementById("nc-queue-pag-label");
            const btnPrev = document.getElementById("nc-queue-btn-prev");
            const btnNext = document.getElementById("nc-queue-btn-next");

            if (!tbody) return;

            if (filteredQueue.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">Tidak ada pesan dalam antrean.</td></tr>`;
                if (pagLabel) pagLabel.textContent = "Halaman 0 dari 0";
                if (btnPrev) btnPrev.disabled = true;
                if (btnNext) btnNext.disabled = true;
                return;
            }

            const totalPages = Math.ceil(filteredQueue.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, filteredQueue.length);
            const pageItems = filteredQueue.slice(startIndex, endIndex);

            let html = "";
            pageItems.forEach((q, index) => {
                const globalIndex = startIndex + index;
                const time = q.Timestamp ? formatDateTimeShort(q.Timestamp) : "—";
                
                // Badge status
                let badgeClass = "bg-gray-100 text-gray-800";
                if (q.Status === "SUCCESS") badgeClass = "bg-green-100 text-green-800";
                else if (q.Status === "FAILED") badgeClass = "bg-red-100 text-red-800";
                else if (q.Status === "WAITING") badgeClass = "bg-blue-100 text-blue-800 animate-pulse";
                else if (q.Status === "RETRY") badgeClass = "bg-amber-100 text-amber-800 animate-pulse";

                html += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${time}</td>
                        <td class="px-4 py-3 text-xs font-semibold text-gray-800 whitespace-nowrap">@${q.Username || "N/A"}</td>
                        <td class="px-4 py-3 text-xs font-mono text-gray-500">${q.ChatID}</td>
                        <td class="px-4 py-3 text-xs text-gray-900 truncate max-w-[200px]" title="${q.Text}">${q.Text}</td>
                        <td class="px-4 py-3 text-xs">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}">${q.Status}</span>
                        </td>
                        <td class="px-4 py-3 text-xs text-center font-mono">${q.RetryCount}</td>
                        <td class="px-4 py-3 text-xs text-right whitespace-nowrap">
                            <button onclick="NotificationCenterQueue.showDetail(${globalIndex})" class="text-indigo-600 hover:text-indigo-700 font-semibold mr-2">Detail</button>
                            ${q.Status === "FAILED" || q.Status === "RETRY" ? `
                                <button onclick="NotificationCenterQueue.retryMessage('${q.QueueID}',this)" class="text-green-600 hover:text-green-700 font-semibold">Retry</button>
                            ` : ""}
                        </td>
                    </tr>`;
            });

            tbody.innerHTML = html;

            if (pagLabel) pagLabel.textContent = `Halaman ${currentPage} dari ${totalPages} (Total: ${filteredQueue.length})`;
            if (btnPrev) btnPrev.disabled = currentPage === 1;
            if (btnNext) btnNext.disabled = currentPage === totalPages;
        },

        nextPage() {
            const totalPages = Math.ceil(filteredQueue.length / itemsPerPage);
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
         * Kirim ulang pesan gagal (Retry).
         */
        async retryMessage(queueId, button) {
            if (!NotificationCenterShared.setBtnLoading(button, "Mengirim...")) return;
            showToast("Mengirim ulang pesan antrean...");
            try {
                // Gunakan executor manual dispatch antrean via backend
                const res = await postData({ action: "executeRecoveryTool", toolId: "test_repair_pending", options: { queueId: queueId } }); // or direct handler
                
                // Let's call standard retry endpoint if we write one, or reuse executor.
                // Wait! In GAS, direct postData to getTelegramQueueHistory or dispatch is easy:
                // We can add a simple retry endpoint or just trigger a manual retry via:
                const retryRes = await postData({ action: "executeRecoveryTool", toolId: "test_repair_pending", options: { action: "retryTelegramMessage", queueId: queueId } });
                
                showToast("Pesan di-dispatch ulang ke Telegram API.", "success");
                await this.init();
            } catch (e) {
                showToast("Gagal retry: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        /**
         * Menampilkan detail isi pesan antrean di modal.
         */
        showDetail(index) {
            const q = filteredQueue[index];
            if (!q) return;

            document.getElementById("nc-q-id").textContent = q.QueueID;
            document.getElementById("nc-q-time").textContent = q.Timestamp ? formatDateTime(q.Timestamp) : "—";
            document.getElementById("nc-q-user").textContent = "@" + q.Username;
            document.getElementById("nc-q-chatid").textContent = q.ChatID;
            document.getElementById("nc-q-status").textContent = q.Status;
            document.getElementById("nc-q-retry").textContent = q.RetryCount;
            document.getElementById("nc-q-err").textContent = q.ErrorMessage || "None";
            
            // Format HTML content
            document.getElementById("nc-q-text").innerHTML = q.Text.replace(/\n/g, "<br>");

            document.getElementById("nc-queue-modal").classList.remove("hidden");
        },

        closeDetailModal() {
            document.getElementById("nc-queue-modal").classList.add("hidden");
        }
    };
})();
