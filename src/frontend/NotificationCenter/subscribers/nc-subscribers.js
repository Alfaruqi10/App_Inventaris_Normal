// ============================================================
// NotificationCenter/subscribers/nc-subscribers.js — Sub Manager
// ============================================================

const NotificationCenterSubscribers = (function() {
    let activeSubscribers = [];
    let editingUser = null;

    return {
        /**
         * Memuat data pelanggan aktif dari backend.
         */
        async load() {
            NotificationCenterShared.checkPermissionAndRun("subscribers", async () => {
                const tbody = document.getElementById("nc-subs-table-body");
                if (!tbody) return;
                
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-gray-400"><i class="ph ph-spinner animate-spin text-2xl"></i></td></tr>`;
                
                try {
                    const res = await NotificationCenterAPI.getSubscribers();
                    if (res.status !== "success") throw new Error(res.message);

                    activeSubscribers = res.subscribers || [];
                    this.render(activeSubscribers);

                } catch (e) {
                    console.error("[NotificationCenterSubscribers] Gagal memuat pelanggan:", e);
                    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500 text-sm">Gagal memuat: ${e.message}</td></tr>`;
                }
            });
        },

        /**
         * Render baris tabel subscribers.
         */
        render(list) {
            const tbody = document.getElementById("nc-subs-table-body");
            if (!tbody) return;

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">Belum ada pelanggan terdaftar.</td></tr>`;
                return;
            }

            let html = "";
            list.forEach(sub => {
                const regDate = formatDate(sub.CreatedAt);
                
                let statusClass = "bg-gray-100 text-gray-800";
                if (String(sub.Status).toUpperCase() === "ACTIVE") statusClass = "bg-green-100 text-green-800";
                else if (String(sub.Status).toUpperCase() === "PENDING") statusClass = "bg-amber-100 text-amber-800 animate-pulse";
                else if (String(sub.Status).toUpperCase() === "DISABLED") statusClass = "bg-red-100 text-red-800";

                // Hitung Rules Count
                let rulesCount = 0;
                try {
                    if (sub.Rules) rulesCount = JSON.parse(sub.Rules).length;
                } catch(e) {}

                html += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3 text-xs font-semibold text-gray-900">${sub.TelegramName || "N/A"}</td>
                        <td class="px-4 py-3 text-xs font-mono text-gray-600">@${sub.Username || "N/A"}</td>
                        <td class="px-4 py-3 text-xs font-mono text-gray-500">${sub.ChatID}</td>
                        <td class="px-4 py-3 text-xs font-semibold"><span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">${sub.Role}</span></td>
                        <td class="px-4 py-3 text-xs">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">${sub.Status || "PENDING"}</span>
                        </td>
                        <td class="px-4 py-3 text-xs text-gray-500">${regDate} <span class="text-[10px] text-gray-400">(${rulesCount} Rules)</span></td>
                        <td class="px-4 py-3 text-xs text-right whitespace-nowrap space-x-1.5">
                            ${String(sub.Status).toUpperCase() === "PENDING" ? `
                                <button onclick="NotificationCenterSubscribers.approve('${sub.ID}',this)" class="text-green-600 hover:text-green-700 font-semibold text-xs">Setujui</button>
                            ` : ""}
                            ${String(sub.Status).toUpperCase() === "ACTIVE" ? `
                                <button onclick="NotificationCenterSubscribers.disable('${sub.ID}',this)" class="text-amber-600 hover:text-amber-700 font-semibold text-xs">Nonaktifkan</button>
                            ` : ""}
                            <button onclick="NotificationCenterSubscribers.editRules('${sub.ID}')" class="text-indigo-600 hover:text-indigo-700 font-semibold text-xs">Rules</button>
                            <button onclick="NotificationCenterSubscribers.testNotif('${sub.ID}',this)" class="text-blue-600 hover:text-blue-700 font-semibold text-xs">Test</button>
                            <button onclick="NotificationCenterSubscribers.deleteSub('${sub.ID}',this)" class="text-red-600 hover:text-red-700 font-semibold text-xs">Hapus</button>
                        </td>
                    </tr>`;
            });
            tbody.innerHTML = html;
        },

        async approve(id, button) {
            if (!confirm("Setujui pendaftaran pelanggan ini?")) return;
            if (!NotificationCenterShared.setBtnLoading(button, "Menyetujui...")) return;
            try {
                const res = await NotificationCenterAPI.approveSubscriber(id);
                if (res.status !== "success") throw new Error(res.message);
                showToast("Pelanggan disetujui.", "success");
                await this.load();
            } catch (e) {
                showToast("Gagal menyetujui: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        async disable(id, button) {
            if (!confirm("Nonaktifkan pelanggan ini?")) return;
            if (!NotificationCenterShared.setBtnLoading(button, "Menonaktifkan...")) return;
            try {
                const res = await NotificationCenterAPI.disableSubscriber(id);
                if (res.status !== "success") throw new Error(res.message);
                showToast("Pelanggan dinonaktifkan.", "success");
                await this.load();
            } catch (e) {
                showToast("Gagal menonaktifkan: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        async deleteSub(id, button) {
            if (!confirm("Hapus pelanggan ini secara permanen dari database?")) return;
            if (!NotificationCenterShared.setBtnLoading(button, "Menghapus...")) return;
            try {
                const res = await NotificationCenterAPI.deleteSubscriber(id);
                if (res.status !== "success") throw new Error(res.message);
                showToast("Pelanggan dihapus.", "success");
                await this.load();
            } catch (e) {
                showToast("Gagal menghapus: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        async testNotif(id, button) {
            if (!NotificationCenterShared.setBtnLoading(button, "Mengirim...")) return;
            showToast("Mengirim notifikasi tes...");
            try {
                const res = await NotificationCenterAPI.testSubscriber(id);
                if (res.status !== "success") throw new Error(res.message);
                showToast(res.message, "success");
            } catch (e) {
                showToast("Gagal mengirim notifikasi tes: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        /**
         * Buka modal setelan Event Rules.
         */
        editRules(id) {
            const sub = activeSubscribers.find(u => u.ID === id);
            if (!sub) return;

            editingUser = sub;
            document.getElementById("nc-rules-sub-name").textContent = sub.TelegramName + " (@" + (sub.Username || "N/A") + ")";
            document.getElementById("nc-rules-role-select").value = sub.Role || "Staff";
            
            // Tampilkan info subscriber di header
            document.getElementById("nc-rules-sub-role").textContent = sub.Role || "Staff";
            document.getElementById("nc-rules-sub-status").textContent = sub.Status || "ACTIVE";
            document.getElementById("nc-rules-sub-chatid").textContent = sub.ChatID || "—";

            let rules = [];
            try {
                if (sub.Rules) rules = JSON.parse(sub.Rules);
            } catch (e) {
                if (typeof sub.Rules === "string" && sub.Rules.trim() !== "") {
                    rules = sub.Rules.split(",").map(r => r.trim());
                }
            }

            // Jika belum punya permission sama sekali, isi dengan default sesuai role
            if (rules.length === 0) {
                const role = sub.Role || "Staff";
                rules = this.getDefaultRulesForRole(role);
            }

            // Atur checkbox
            document.querySelectorAll(".nc-rule-chk").forEach(chk => {
                chk.checked = rules.includes(chk.value);
            });

            this.updateRulesCount();
            document.getElementById("nc-rules-modal").classList.remove("hidden");
        },

        closeRulesModal() {
            document.getElementById("nc-rules-modal").classList.add("hidden");
            editingUser = null;
        },

        /**
         * Update hitungan jumlah permission aktif di modal header
         */
        updateRulesCount() {
            const chks = document.querySelectorAll(".nc-rule-chk");
            let checkedCount = 0;
            chks.forEach(chk => {
                if (chk.checked) checkedCount++;
            });
            document.getElementById("nc-rules-sub-count").textContent = `${checkedCount} / ${chks.length}`;
        },

        /**
         * Aksi tombol "Pilih Semua"
         */
        selectAllRules() {
            document.querySelectorAll(".nc-rule-chk").forEach(chk => {
                chk.checked = true;
            });
            this.updateRulesCount();
        },

        /**
         * Aksi tombol "Hapus Semua"
         */
        clearAllRules() {
            document.querySelectorAll(".nc-rule-chk").forEach(chk => {
                chk.checked = false;
            });
            this.updateRulesCount();
        },

        /**
         * Dipanggil ketika dropdown Role diubah
         */
        onRoleChange() {
            this.resetToDefaultRole();
        },

        /**
         * Mengembalikan default rules berdasarkan role
         */
        getDefaultRulesForRole(role) {
            const defaults = {
                "Owner": [
                    "sync_produk", "sync_pesanan", "historical_sync", "settlement_sync", "mapping_produk", "approve_deduction", "skip_deduction", "recovery_center", "repair_pending", "historical_cleanup",
                    "dashboard", "produk", "barang_masuk", "barang_keluar", "barcode", "riwayat", "laporan_penjualan", "users",
                    "telegram_dashboard", "telegram_subscribers", "telegram_templates", "telegram_broadcast", "telegram_queue", "telegram_settings",
                    "maintenance_recovery", "maintenance_audit", "maintenance_jobs", "maintenance_rollback", "maintenance_execute",
                    "ai_assistant", "ai_summary", "ai_insight", "ai_alert",
                    "view_stock_alerts", "view_production_queue", "manage_production_queue", "update_production_status", "manage_stock_alert_settings",
                    "notify_stock_low", "notify_stock_critical", "notify_production_required", "notify_production_completed", "notify_production_summary"
                ],
                "Admin": [
                    "sync_produk", "sync_pesanan", "historical_sync", "settlement_sync", "mapping_produk", "approve_deduction", "skip_deduction", "recovery_center", "repair_pending",
                    "dashboard", "produk", "barang_masuk", "barang_keluar", "barcode", "riwayat", "laporan_penjualan",
                    "telegram_dashboard", "telegram_subscribers", "telegram_templates", "telegram_broadcast", "telegram_queue",
                    "maintenance_recovery", "maintenance_audit", "maintenance_jobs",
                    "ai_assistant", "ai_summary", "ai_insight", "ai_alert",
                    "view_stock_alerts", "view_production_queue", "manage_production_queue", "update_production_status", "manage_stock_alert_settings",
                    "notify_stock_low", "notify_stock_critical", "notify_production_required", "notify_production_completed", "notify_production_summary"
                ],
                "Staff Konveksi": [
                    "view_stock_alerts", "view_production_queue", "update_production_status",
                    "notify_stock_low", "notify_stock_critical", "notify_production_required", "notify_production_completed", "notify_production_summary"
                ],
                "Gudang": [
                    "produk", "barang_masuk", "barang_keluar", "barcode", "riwayat"
                ],
                "Packing": [
                    "barang_masuk", "barang_keluar", "barcode", "riwayat"
                ],
                "CS": [
                    "dashboard", "telegram_dashboard", "telegram_broadcast", "telegram_queue"
                ],
                "Staff": [
                    "dashboard", "produk", "riwayat", "laporan_penjualan"
                ]
            };
            return defaults[role] || defaults["Staff"];
        },

        /**
         * Aksi tombol "Reset Default Role"
         */
        resetToDefaultRole() {
            const role = document.getElementById("nc-rules-role-select").value;
            const defaultRules = this.getDefaultRulesForRole(role);
            
            document.querySelectorAll(".nc-rule-chk").forEach(chk => {
                chk.checked = defaultRules.includes(chk.value);
            });
            this.updateRulesCount();
        },

        /**
         * Simpan aturan & wewenang (Role) baru ke backend.
         */
        async saveRules() {
            if (!editingUser) return;

            const role = document.getElementById("nc-rules-role-select").value;
            const selectedRules = [];
            document.querySelectorAll(".nc-rule-chk").forEach(chk => {
                if (chk.checked) selectedRules.push(chk.value);
            });

            const btn = document.getElementById("nc-btn-save-rules");
            if (!NotificationCenterShared.setBtnLoading(btn, "Menyimpan...")) return;

            try {
                const res = await NotificationCenterAPI.saveSubscriberRules(editingUser.ID, role, selectedRules);
                if (res.status !== "success") throw new Error(res.message);

                showToast("Permission berhasil diperbarui.", "success");
                this.closeRulesModal();
                await this.load();

            } catch (e) {
                showToast("Gagal menyimpan rules: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(btn);
            }
        }
    };
})();
