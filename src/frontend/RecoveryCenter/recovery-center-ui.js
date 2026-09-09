// ============================================================
// RecoveryCenter/recovery-center-ui.js — UI & Execution Controller
// ============================================================

const RecoveryCenterUI = (function() {
    let activeTool = null;
    let registeredTools = [];
    let activeTab = "maintenance"; // maintenance, audit, history

    return {
        /**
         * Membuka Drawer Recovery Center.
         */
        async open() {
            console.log("[RecoveryCenterUI] Membuka Recovery Center...");
            document.getElementById("recovery-center-overlay").classList.remove("hidden");
            document.getElementById("recovery-center").classList.remove("translate-x-full");
            
            // Set tab aktif default
            this.switchTab("maintenance");

            // Muat data dashboard dan daftar tools secara paralel
            this.showHealthLoading();
            this.showToolsLoading();
            
            try {
                await Promise.all([
                    this.loadHealth(),
                    this.loadTools()
                ]);
            } catch (e) {
                this.showErrorModal("Gagal Memuat Data", "Terjadi kesalahan saat memuat data dari server: " + e.message);
            }
        },

        /**
         * Menutup Drawer Recovery Center.
         */
        close() {
            console.log("[RecoveryCenterUI] Menutup Recovery Center...");
            document.getElementById("recovery-center-overlay").classList.add("hidden");
            document.getElementById("recovery-center").classList.add("translate-x-full");
            this.resetWorkspace();
        },

        /**
         * Mengubah tab aktif di dalam drawer.
         */
        switchTab(tabId) {
            activeTab = tabId;
            
            // Update UI tab button active classes
            document.querySelectorAll(".rc-tab-btn").forEach(btn => {
                if (btn.dataset.tab === tabId) {
                    btn.classList.add("border-red-500", "text-red-600");
                    btn.classList.remove("border-transparent", "text-gray-500");
                } else {
                    btn.classList.remove("border-red-500", "text-red-600");
                    btn.classList.add("border-transparent", "text-gray-500");
                }
            });

            // Tampilkan panel yang sesuai
            const panels = ["rc-panel-maintenance", "rc-panel-audit", "rc-panel-history"];
            panels.forEach(p => {
                const el = document.getElementById(p);
                if (el) {
                    if (p === `rc-panel-${tabId}`) {
                        el.classList.remove("hidden");
                    } else {
                        el.classList.add("hidden");
                    }
                }
            });

            // Muat data khusus tab jika diperlukan
            if (tabId === "audit") {
                RecoveryCenterAudit.init();
            } else if (tabId === "history") {
                this.loadHistory();
            }
        },

        /**
         * Memuat data dashboard kesehatan sistem.
         */
        async loadHealth() {
            try {
                const res = await RecoveryCenterAPI.getSystemHealth();
                if (res.status !== "success") throw new Error(res.message);
                
                const h = res.health || {};
                
                // Render data ke card health
                document.getElementById("rc-card-webhook").textContent = h.webhook || "-";
                document.getElementById("rc-card-api").textContent = h.api || "-";
                document.getElementById("rc-card-last-sync").textContent = h.lastSync || "-";
                document.getElementById("rc-card-pending-orders").textContent = h.pendingOrders || "0";
                document.getElementById("rc-card-duplicate-orders").textContent = h.duplicateOrders || "0";
                document.getElementById("rc-card-missing-settlement").textContent = h.missingSettlement || "0";
                document.getElementById("rc-card-ledger-status").textContent = h.ledgerStatus || "-";
                document.getElementById("rc-card-mapping-status").textContent = h.mappingStatus || "-";
                
                // Ganti kelas warna status
                this.updateStatusBadge("rc-card-webhook", h.webhook === "Active" ? "text-green-600" : "text-red-600");
                this.updateStatusBadge("rc-card-api", h.api === "Online" ? "text-green-600" : "text-red-600");
                this.updateStatusBadge("rc-card-pending-orders", Number(h.pendingOrders) > 0 ? "text-amber-600" : "text-gray-600");
                this.updateStatusBadge("rc-card-duplicate-orders", Number(h.duplicateOrders) > 0 ? "text-red-600" : "text-green-600");

            } catch (e) {
                console.error("[RecoveryCenterUI] Gagal memuat kesehatan sistem:", e);
                showToast("Gagal memuat kesehatan sistem: " + e.message, "error");
            }
        },

        updateStatusBadge(id, colorClass) {
            const el = document.getElementById(id);
            if (el) {
                el.className = "text-sm font-semibold " + colorClass;
            }
        },

        showHealthLoading() {
            const elements = [
                "rc-card-webhook", "rc-card-api", "rc-card-last-sync", 
                "rc-card-pending-orders", "rc-card-duplicate-orders", 
                "rc-card-missing-settlement", "rc-card-ledger-status", "rc-card-mapping-status"
            ];
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = `<span class="animate-pulse text-gray-300">...</span>`;
            });
        },

        /**
         * Memuat dan mengelompokkan recovery tools secara dinamis dari registry.
         */
        async loadTools() {
            try {
                const res = await RecoveryCenterAPI.getRegistry();
                if (res.status !== "success") throw new Error(res.message);
                
                registeredTools = res.tools || [];
                
                // Kelompokkan berdasarkan kategori
                const categories = {};
                registeredTools.forEach(t => {
                    if (!categories[t.category]) {
                        categories[t.category] = [];
                    }
                    categories[t.category].push(t);
                });

                // Render ke menu list
                const container = document.getElementById("rc-tools-container");
                if (!container) return;

                if (registeredTools.length === 0) {
                    container.innerHTML = `
                        <div class="text-center py-8 text-gray-400">
                            <i class="ph ph-warning text-3xl mb-2"></i>
                            <p class="text-sm">Tidak ada perkakas pemeliharaan terdaftar.</p>
                        </div>`;
                    return;
                }

                let html = "";
                Object.keys(categories).forEach(cat => {
                    html += `
                        <div class="border border-gray-100 rounded-xl overflow-hidden bg-gray-50 mb-3">
                            <button onclick="RecoveryCenterUI.toggleCategory(this)" class="w-full px-4 py-3 flex items-center justify-between text-left font-semibold text-gray-800 text-xs uppercase tracking-wider bg-slate-50 hover:bg-slate-100 transition-colors">
                                <span>${cat} (${categories[cat].length})</span>
                                <i class="ph ph-caret-down transition-transform duration-200"></i>
                            </button>
                            <div class="rc-category-content p-2 bg-white space-y-1 hidden">`;
                    
                    categories[cat].forEach(t => {
                        html += `
                            <button onclick="RecoveryCenterUI.selectTool('${t.toolId}')" class="w-full flex items-center justify-between p-3 rounded-lg text-sm text-left text-gray-700 hover:bg-red-50 hover:text-red-700 transition-colors group">
                                <span class="font-medium">${t.title}</span>
                                <i class="ph ph-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                            </button>`;
                    });

                    html += `
                            </div>
                        </div>`;
                });

                container.innerHTML = html;

            } catch (e) {
                console.error("[RecoveryCenterUI] Gagal memuat registry tools:", e);
                showToast("Gagal memuat registry: " + e.message, "error");
            }
        },

        showToolsLoading() {
            const container = document.getElementById("rc-tools-container");
            if (container) {
                container.innerHTML = `
                    <div class="space-y-3">
                        <div class="h-10 bg-gray-100 rounded-lg animate-pulse"></div>
                        <div class="h-10 bg-gray-100 rounded-lg animate-pulse"></div>
                        <div class="h-10 bg-gray-100 rounded-lg animate-pulse"></div>
                    </div>`;
            }
        },

        toggleCategory(btn) {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector(".ph-caret-down");
            if (content.classList.contains("hidden")) {
                content.classList.remove("hidden");
                icon.style.transform = "rotate(180deg)";
            } else {
                content.classList.add("hidden");
                icon.style.transform = "rotate(0deg)";
            }
        },

        /**
         * Memuat riwayat pekerjaan pemulihan (job history) ke dalam list.
         */
        async loadHistory() {
            const container = document.getElementById("rc-history-list");
            if (!container) return;
            container.innerHTML = `<div class="text-center py-6 text-gray-400"><i class="ph ph-spinner animate-spin text-2xl"></i></div>`;

            try {
                const res = await RecoveryCenterAPI.getHistory();
                if (res.status !== "success") throw new Error(res.message);

                const history = res.history || [];
                if (history.length === 0) {
                    container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">Belum ada riwayat pemulihan.</div>`;
                    return;
                }

                let html = '<div class="space-y-3">';
                history.forEach(job => {
                    const time = formatDateTime(job.finishTime);
                    const statusClass = job.status === "success" ? "bg-green-100 text-green-800" : (job.status === "preview" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800");
                    const statusLabel = job.status.toUpperCase();

                    html += `
                        <div class="border border-gray-100 rounded-xl p-4 bg-gray-50 flex flex-col gap-2">
                            <div class="flex items-center justify-between">
                                <span class="font-mono text-xs font-semibold text-gray-600">${job.id}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">${statusLabel}</span>
                            </div>
                            <div class="text-sm font-semibold text-gray-800">${job.toolId}</div>
                            <div class="text-xs text-gray-500">
                                <div>Selesai: ${time} (${job.duration})</div>
                                <div>Affected: ${job.affectedRows} baris</div>
                            </div>
                            ${job.errors && job.errors.length > 0 ? `<div class="text-xs text-red-600 bg-red-50 p-2 rounded font-mono break-all">${job.errors.join("<br>")}</div>` : ""}
                            ${job.status === "success" && this.checkToolSupportsRollback(job.toolId) ? `
                         <button onclick="RecoveryCenterUI.triggerRollback('${job.toolId}', '${job.id}', this)" class="ds-btn ds-btn-secondary ds-btn-sm mt-2 text-red-600 hover:text-red-700 hover:bg-red-50 flex items-center justify-center gap-1.5 border border-red-200">
                                    <i class="ph ph-arrow-counter-clockwise"></i> Rollback Transaksi
                                </button>
                            ` : ""}
                        </div>`;
                });
                html += "</div>";
                container.innerHTML = html;

            } catch (e) {
                container.innerHTML = `<div class="text-center py-8 text-red-500 text-sm">Gagal memuat riwayat: ${e.message}</div>`;
            }
        },

        checkToolSupportsRollback(toolId) {
            const tool = registeredTools.find(t => t.toolId === toolId);
            return tool ? tool.supportsRollback : false;
        },

        /**
         * Memilih tool dari menu dan menampilkan panel workspace di modal khusus tool.
         */
        selectTool(toolId) {
            const tool = registeredTools.find(t => t.toolId === toolId);
            if (!tool) return;

            activeTool = tool;
            console.log("[RecoveryCenterUI] Memilih tool:", tool);

            // Buka Modal Workspace Tool
            document.getElementById("rc-workspace-title").textContent = tool.title;
            document.getElementById("rc-workspace-category").textContent = tool.category;
            document.getElementById("rc-workspace-desc").textContent = `Estimasi durasi: ~${tool.estimatedDuration}. ` + 
                (tool.destructiveAction ? "⚠️ TINDAKAN DESTRUKTIF: Memerlukan password Owner." : "Aksi pemeliharaan sistem reguler.");

            // Reset UI State panel
            document.getElementById("rc-preview-section").classList.add("hidden");
            document.getElementById("rc-validation-section").classList.add("hidden");
            document.getElementById("rc-progress-section").classList.add("hidden");
            document.getElementById("rc-result-section").classList.add("hidden");
            
            // Set tombol status
            const previewBtn = document.getElementById("rc-btn-preview");
            const executeBtn = document.getElementById("rc-btn-execute");
            
            previewBtn.classList.remove("hidden");
            executeBtn.classList.add("hidden");
            executeBtn.disabled = true;

            // Tampilkan modal workspace
            document.getElementById("rc-workspace-modal").classList.remove("hidden");
        },

        closeWorkspace() {
            document.getElementById("rc-workspace-modal").classList.add("hidden");
            this.resetWorkspace();
        },

        resetWorkspace() {
            activeTool = null;
        },

        /**
         * Menjalankan simulasi Preview/Dry-Run (Tahap 1).
         */
        async runPreview() {
            if (!activeTool) return;

            const previewBtn = document.getElementById("rc-btn-preview");
            const originalHtml = previewBtn.innerHTML;
            if (!setButtonLoading(previewBtn, "Mensimulasikan...")) return;

            try {
                // Panggil API backend executeTool dengan preview=true
                const res = await RecoveryCenterAPI.executeTool(activeTool.toolId, { preview: true });
                console.log("[RecoveryCenterUI] Hasil Preview:", res);

                if (res.status !== "preview" && res.status !== "success") {
                    throw new Error(res.message);
                }

                // Render Preview Panel
                const pSection = document.getElementById("rc-preview-section");
                pSection.classList.remove("hidden");

                document.getElementById("rc-preview-affected").textContent = res.affectedRows + " baris";
                document.getElementById("rc-preview-msg").textContent = res.message;
                document.getElementById("rc-preview-duration").textContent = res.duration;

                // Tampilkan Validation Panel (Tahap 2)
                const vSection = document.getElementById("rc-validation-section");
                vSection.classList.remove("hidden");

                const vMsg = document.getElementById("rc-validation-msg");
                const executeBtn = document.getElementById("rc-btn-execute");

                if (res.errors && res.errors.length > 0) {
                    // Ada error, tidak bisa dieksekusi
                    vMsg.className = "text-xs font-semibold text-red-600 bg-red-50 p-3 rounded-lg flex items-center gap-2";
                    vMsg.innerHTML = `<i class="ph ph-x-circle text-lg"></i> Validasi Gagal: ${res.errors[0]}`;
                    executeBtn.disabled = true;
                    executeBtn.classList.add("opacity-50", "cursor-not-allowed");
                } else if (activeTool.destructiveAction) {
                    // Butuh password Owner
                    vMsg.className = "text-xs font-semibold text-amber-600 bg-amber-50 p-3 rounded-lg flex items-center gap-2";
                    vMsg.innerHTML = `<i class="ph ph-warning text-lg"></i> Tindakan Destruktif: Password Owner wajib diinput di bawah.`;
                    executeBtn.disabled = false;
                    executeBtn.classList.remove("opacity-50", "cursor-not-allowed");
                    // Tampilkan form password Owner
                    document.getElementById("rc-owner-password-container").classList.remove("hidden");
                } else {
                    // Sukses, siap eksekusi
                    vMsg.className = "text-xs font-semibold text-green-600 bg-green-50 p-3 rounded-lg flex items-center gap-2";
                    vMsg.innerHTML = `<i class="ph ph-check-circle text-lg"></i> Validasi Sukses: Siap untuk dieksekusi.`;
                    executeBtn.disabled = false;
                    executeBtn.classList.remove("opacity-50", "cursor-not-allowed");
                    document.getElementById("rc-owner-password-container").classList.add("hidden");
                }

                // Sembunyikan tombol preview, tampilkan tombol execute
                previewBtn.classList.add("hidden");
                executeBtn.classList.remove("hidden");

            } catch (e) {
                console.error("[RecoveryCenterUI] Preview Error:", e);
                this.showErrorModal("Gagal Simulasi", "Gagal menjalankan preview untuk tool ini: " + e.message);
            } finally {
                resetButton(previewBtn, originalHtml);
            }
        },

        /**
         * Menjalankan Eksekusi Sebenarnya (Tahap 3).
         */
        async runExecute() {
            if (!activeTool) return;

            const executeBtn = document.getElementById("rc-btn-execute");
            const originalHtml = executeBtn.innerHTML;
            
            // Dapatkan password Owner jika diperlukan
            let ownerPass = "";
            if (activeTool.destructiveAction || activeTool.requiresOwnerPassword) {
                ownerPass = document.getElementById("rc-owner-password-input").value;
                if (!ownerPass) {
                    showToast("Password Owner wajib diisi untuk tindakan ini.", "error");
                    return;
                }
            }

            // Tampilkan Progress Section (Tahap 4)
            document.getElementById("rc-progress-section").classList.remove("hidden");
            const fill = document.getElementById("rc-progress-fill-ui");
            const countEl = document.getElementById("rc-progress-count-ui");
            const textEl = document.getElementById("rc-progress-text-ui");

            // Mulai animasi loading/polling progress
            if (!setButtonLoading(executeBtn, "Memproses...")) return;
            document.getElementById("rc-btn-close-workspace").disabled = true;

            fill.style.width = "10%";
            countEl.textContent = "Menghubungi server...";
            textEl.textContent = "Mengunci database sheet...";

            try {
                // Simulasikan progress bar bergerak (Polling)
                let pct = 10;
                const progressInterval = setInterval(() => {
                    if (pct < 90) {
                        pct += Math.floor(Math.random() * 15) + 5;
                        if (pct > 90) pct = 90;
                        fill.style.width = pct + "%";
                        countEl.textContent = `Memproses: ${pct}%`;
                        textEl.textContent = pct > 50 ? "Menulis perubahan database..." : "Memvalidasi data akhir...";
                    }
                }, 400);

                // Panggil API Backend Executor
                const res = await RecoveryCenterAPI.executeTool(activeTool.toolId, {
                    preview: false,
                    ownerPassword: ownerPass
                });

                clearInterval(progressInterval);
                console.log("[RecoveryCenterUI] Hasil Eksekusi:", res);

                fill.style.width = "100%";
                countEl.textContent = "Selesai 100%";

                if (res.status !== "success") {
                    throw new Error(res.message);
                }

                // Render Result Panel (Tahap 5)
                document.getElementById("rc-progress-section").classList.add("hidden");
                const rSection = document.getElementById("rc-result-section");
                rSection.classList.remove("hidden");

                const rSummary = document.getElementById("rc-result-summary");
                rSummary.className = "p-3 rounded-lg text-sm font-semibold text-green-700 bg-green-50 mb-3 border border-green-200";
                rSummary.innerHTML = `✓ ${res.message}`;

                document.getElementById("rc-result-affected").textContent = res.affectedRows + " baris";
                document.getElementById("rc-result-success").textContent = res.successCount + " sukses";
                document.getElementById("rc-result-failed").textContent = res.failedCount + " gagal";
                document.getElementById("rc-result-duration").textContent = res.duration;

                // Tampilkan log detail
                const logBox = document.getElementById("rc-result-log-box");
                logBox.textContent = `[SUCCESS] Job ID: ${res.metadata?.jobId || "N/A"}\n[INFO] Duration: ${res.duration}\n[INFO] Affected Rows: ${res.affectedRows}\n[INFO] Message: ${res.message}`;

                // Tampilkan tombol download log
                const downloadBtn = document.getElementById("rc-btn-download-log");
                downloadBtn.onclick = () => this.downloadJobLog(res);

                showToast("✅ Eksekusi pemulihan berhasil diselesaikan!", "success");

                // Sembunyikan tombol eksekusi
                executeBtn.classList.add("hidden");

                // Refresh health dashboard & list log audit secara otomatis
                await this.loadHealth();

            } catch (e) {
                console.error("[RecoveryCenterUI] Eksekusi Error:", e);
                
                // Tampilkan Result Panel dengan Status Gagal
                document.getElementById("rc-progress-section").classList.add("hidden");
                const rSection = document.getElementById("rc-result-section");
                rSection.classList.remove("hidden");

                const rSummary = document.getElementById("rc-result-summary");
                rSummary.className = "p-3 rounded-lg text-sm font-semibold text-red-700 bg-red-50 mb-3 border border-red-200 break-all";
                rSummary.innerHTML = `❌ Eksekusi Gagal: ${e.message}`;

                document.getElementById("rc-result-affected").textContent = "0 baris";
                document.getElementById("rc-result-success").textContent = "0 sukses";
                document.getElementById("rc-result-failed").textContent = "Error";
                document.getElementById("rc-result-duration").textContent = "—";

                const logBox = document.getElementById("rc-result-log-box");
                logBox.textContent = `[FAILED] Error: ${e.message}`;

                showToast("❌ Pemulihan gagal: " + e.message, "error");
            } finally {
                resetButton(executeBtn, originalHtml);
                document.getElementById("rc-btn-close-workspace").disabled = false;
            }
        },

        /**
         * Memicu alur Rollback manual untuk suatu Tool (Tahap 6).
         */
        async triggerRollback(toolId, jobId, button) {
            if (!confirm(`Apakah Anda yakin ingin membatalkan transaksi untuk Job ID ${jobId}?\nProsedur ini akan menjalankan rollback otomatis.`)) return;
            if (!setButtonLoading(button, "Memproses...")) return;

            showToast("Memicu rollback manual...");
            try {
                const res = await RecoveryCenterAPI.rollbackTool(toolId, { jobId: jobId });
                console.log("[RecoveryCenterUI] Hasil Rollback Manual:", res);

                if (res.status !== "success") throw new Error(res.message);

                showToast("✅ Rollback berhasil diselesaikan!", "success");
                this.loadHistory();
                await this.loadHealth();

            } catch (e) {
                console.error("[RecoveryCenterUI] Rollback Error:", e);
                this.showErrorModal("Gagal Rollback", "Rollback manual gagal: " + e.message);
            } finally {
                resetButton(button);
            }
        },

        downloadJobLog(res) {
            const data = `RECOVERY CENTER LOG\n===================\nStatus: ${res.status.toUpperCase()}\nMessage: ${res.message}\nAffected Rows: ${res.affectedRows}\nSuccess Count: ${res.successCount}\nFailed Count: ${res.failedCount}\nDuration: ${res.duration}\nTimestamp: ${formatDateTime(new Date())}`;
            const blob = new Blob([data], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `recovery_job_log_${formatExportDate(new Date())}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        showErrorModal(title, content) {
            document.getElementById("rc-error-title").textContent = title;
            document.getElementById("rc-error-body").textContent = content;
            document.getElementById("rc-error-modal").classList.remove("hidden");
        },

        closeErrorModal() {
            document.getElementById("rc-error-modal").classList.add("hidden");
        }
    };
})();
