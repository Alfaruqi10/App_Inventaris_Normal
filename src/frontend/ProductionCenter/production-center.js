(function () {
    const state = { mode: "alerts", data: null, config: null, reports: null, reportPage: 1, reportDetail: null, timer: null, configTimer: null, initialized: false, eventsBound: false, manualRequestId: "", manualItems: [], manualQtyBySku: new Map(), manualSelection: new Set(), manualPreviewKey: "", testingResetPreview: null, selections: { alerts: new Set(), queue: new Set() } };

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function money(value) {
        return new Intl.NumberFormat("id-ID").format(Number(value) || 0);
    }

    function badge(value) {
        const key = String(value || "").toUpperCase();
        const labels = {
            CRITICAL: "Kritis", LOW_STOCK: "Stok Rendah", PRODUCTION_REQUIRED: "Perlu Produksi", PRODUCTION_IN_PROGRESS: "Sedang Diproduksi",
            PENDING: "Menunggu", IN_PROGRESS: "Sedang Diproduksi", COMPLETED: "Selesai", RESOLVED: "Selesai", CANCELLED: "Dibatalkan",
            MENUNGGU_VERIFIKASI: "Menunggu Verifikasi", DIVERIFIKASI: "Diverifikasi", DITOLAK: "Ditolak",
            HIGH: "Tinggi", MEDIUM: "Sedang", LOW: "Rendah", SENT: "Terkirim", NOT_SENT: "Belum Dikirim", FAILED: "Gagal"
        };
        const colors = {
            CRITICAL: "bg-red-100 text-red-700", HIGH: "bg-red-100 text-red-700",
            LOW_STOCK: "bg-amber-100 text-amber-700", PRODUCTION_REQUIRED: "bg-orange-100 text-orange-700",
            PRODUCTION_IN_PROGRESS: "bg-blue-100 text-blue-700", IN_PROGRESS: "bg-blue-100 text-blue-700",
            COMPLETED: "bg-emerald-100 text-emerald-700", RESOLVED: "bg-emerald-100 text-emerald-700",
            PENDING: "bg-amber-100 text-amber-700", CANCELLED: "bg-slate-100 text-slate-600",
            MEDIUM: "bg-amber-100 text-amber-700", LOW: "bg-slate-100 text-slate-600",
            MENUNGGU_VERIFIKASI: "bg-amber-100 text-amber-700", DIVERIFIKASI: "bg-emerald-100 text-emerald-700", DITOLAK: "bg-red-100 text-red-700"
        };
        return `<span class="inline-flex px-2 py-1 rounded text-[10px] font-bold ${colors[key] || "bg-slate-100 text-slate-600"}">${esc(labels[key] || key || "-")}</span>`;
    }

    function movingBadge(value, source) {
        const colors = { FAST: "bg-red-100 text-red-700", MIDDLE: "bg-amber-100 text-amber-700", SLOW: "bg-slate-100 text-slate-600" };
        const moving = String(value || "SLOW").toUpperCase();
        const labels = { FAST: "Cepat", MIDDLE: "Sedang", SLOW: "Lambat" };
        return `<span class="inline-flex px-2 py-1 rounded text-[10px] font-bold ${colors[moving] || colors.SLOW}" title="Urgensi produksi">${esc(labels[moving] || moving)}</span>`;
    }

    async function request(action, payload) {
        const reportActions = ["getProductionReports", "getProductionReportDetail", "transitionProductionReport"];
        const requestPayload = Object.assign({ action, callerEmail: currentUser && currentUser.email }, payload || {});
        if (reportActions.includes(action)) requestPayload.sessionId = typeof productionReportsSessionId === "string" ? productionReportsSessionId : "";
        const result = await postData(requestPayload);
        const recipientActions = ["getProductionRecipients", "saveProductionRecipient", "deleteProductionRecipient"];
        if (recipientActions.includes(action) && result?.status === "error" && result.message === "Action tidak dikenal.") {
            result.message = `Action '${action}' belum tersedia pada deployment Apps Script yang sedang digunakan. Deploy versi terbaru backend.`;
            result.code = "DEPLOYMENT_ROUTE_UNAVAILABLE";
        }
        return result;
    }

    function notify(message, type) {
        if (typeof showToast === "function") showToast(message, type || "error");
        else console.error("[ProductionCenter]", message);
    }

    function setBusy(button, busy, loadingText) {
        if (!button) return true;
        if (busy) {
            const text = loadingText || (button.id === "production-reload" ? "Memuat..." : "Memproses...");
            const iconOnly = !loadingText && button.id !== "production-reload" && button.id !== "production-manual-send";
            return setButtonLoading(button, { loadingText: text, iconOnly });
        }
        resetButton(button);
        return true;
    }

    function can(permission) {
        const permissions = state.data?.permissions || state.config?.permissions || [];
        return permissions.includes(permission);
    }

    function selectionSet(type) {
        return state.selections[type];
    }

    function syncCurrentSelection(type) {
        const selected = selectionSet(type);
        const inputs = Array.from(document.querySelectorAll(`[data-production-selection="${type}"]`));
        const visibleIds = new Set(inputs.map(input => input.dataset.productionSelectionId).filter(Boolean));
        Array.from(selected).forEach(id => { if (!visibleIds.has(id)) selected.delete(id); });
        inputs.forEach(input => { input.checked = selected.has(input.dataset.productionSelectionId); });

        const selectAll = document.getElementById(`production-${type}-select-all`);
        const summary = document.getElementById(`production-${type}-selection-summary`);
        const selectedCount = inputs.filter(input => input.checked).length;
        if (selectAll) {
            selectAll.disabled = inputs.length === 0;
            selectAll.checked = inputs.length > 0 && selectedCount === inputs.length;
            selectAll.indeterminate = selectedCount > 0 && selectedCount < inputs.length;
        }
        if (summary) summary.textContent = `${selectedCount} dipilih`;
    }

    function renderKpis(kpi) {
        const definitions = [
            ["Total SKU", kpi.totalAlerts, "ph-warning", "text-slate-700"],
            ["Stok Rendah", kpi.lowStock, "ph-arrow-down", "text-amber-600"],
            ["Kritis", kpi.critical, "ph-siren", "text-red-600"],
            ["Perlu Produksi", kpi.productionRequired, "ph-factory", "text-orange-600"],
            ["Sedang Diproduksi", kpi.inProgress, "ph-spinner-gap", "text-blue-600"],
            ["Selesai", kpi.completed, "ph-check-circle", "text-emerald-600"],
            ["Ditutup", kpi.resolved, "ph-shield-check", "text-teal-600"]
        ];
        document.getElementById("production-kpis").innerHTML = definitions.map(([label, value, icon, color]) => `
            <div class="bg-white border border-slate-200 rounded-md p-3 min-w-0">
                <div class="flex items-center justify-between gap-2"><span class="text-[10px] uppercase font-bold text-slate-500">${label}</span><i class="ph ${icon} ${color}"></i></div>
                <div class="text-xl font-bold text-slate-900 mt-1">${money(value)}</div>
            </div>`).join("");
    }

    function renderAlerts(items) {
        const body = document.getElementById("production-alerts-body");
        if (!items.length) {
            body.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400">Tidak ada pekerjaan produksi aktif.</td></tr>';
            syncCurrentSelection("alerts");
            return;
        }
        body.innerHTML = items.map(item => {
            const queueButton = can("manage_production_queue") && item.productionQty > 0 && String(item.todo).toUpperCase() === "PRODUKSI" && !item.queueId
                ? `<button class="ds-btn ds-btn-primary ds-btn-sm" data-production-action="create-queue" data-sku="${esc(item.sku)}" title="Tambahkan ke antrean produksi"><i class="ph ph-plus"></i></button>` : "";
            const ignoreButton = can("manage_production_queue")
                ? `<button class="ds-btn ds-btn-ghost ds-btn-sm" data-production-action="ignore-alert" data-sku="${esc(item.sku)}" title="Abaikan peringatan"><i class="ph ph-eye-slash"></i></button>` : "";
            return `<tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-3"><input type="checkbox" data-production-selection="alerts" data-production-selection-id="${esc(item.sku)}" onchange="ProductionCenterUI.toggleCurrentSelectionItem(this)" aria-label="Pilih ${esc(item.sku)}"></td>
                <td class="p-3"><button class="text-left" data-production-action="open-detail" data-sku="${esc(item.sku)}"><span class="font-mono font-bold text-slate-900">${esc(item.sku)}</span><span class="block text-slate-500 max-w-[240px] truncate">${esc(item.product)}</span></button></td>
                <td class="p-3 text-slate-600">${esc([item.color, item.size].filter(Boolean).join(" / ") || "-")}</td>
                <td class="p-3 text-right font-bold">${money(item.stock)}</td>
                <td class="p-3 text-right">${money(item.minimumStock)} / ${money(item.productionTarget)}</td>
                <td class="p-3 text-right font-bold text-orange-700">${money(item.productionQty)}</td>
                <td class="p-3">${movingBadge(item.movingStat)}</td><td class="p-3">${esc(item.productionRecipientName || "Belum diatur")}</td><td class="p-3">${badge(item.status)}</td><td class="p-3">${badge(item.priority)}</td>
                <td class="p-3"><div class="flex justify-end gap-1">${queueButton}${ignoreButton}</div></td>
            </tr>`;
        }).join("");
        syncCurrentSelection("alerts");
    }

    function renderQueue(rows) {
        const body = document.getElementById("production-queue-body");
        const manualButton = document.getElementById("production-manual-open");
        if (manualButton) manualButton.classList.toggle("hidden", !can("manage_production_queue"));
        const recipient = document.getElementById("production-queue-filter-recipient")?.value || "ALL";
        const statusFilter = document.getElementById("production-queue-filter-status")?.value || "ALL";
        const notificationFilter = document.getElementById("production-queue-filter-notification")?.value || "ALL";
        const search = (document.getElementById("production-queue-search")?.value || "").trim().toLowerCase();
        rows = rows.filter(row => (recipient === "ALL" || (recipient === "UNASSIGNED" ? !String(row.ProductionRecipient || "").trim() : row.ProductionRecipient === recipient)) && (statusFilter === "ALL" || String(row.Status).toUpperCase() === statusFilter) && (notificationFilter === "ALL" || String(row.NotificationStatus || "NOT_SENT").toUpperCase() === notificationFilter) && (!search || [row.SKU, row.Product, row.Color, row.Size].filter(Boolean).join(" ").toLowerCase().includes(search)));
        if (!rows.length) { body.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400">Tidak ada pekerjaan produksi aktif.</td></tr>'; syncCurrentSelection("queue"); return; }
        body.innerHTML = rows.map(row => {
            const status = String(row.Status || "").toUpperCase();
            let actions = "";
            if (can("update_production_status") && status === "PENDING") actions = `<button class="ds-btn ds-btn-primary ds-btn-sm" onclick="ProductionCenterUI.updateQueue('${esc(row.QueueID)}','IN_PROGRESS',undefined,this)"><i class="ph ph-play"></i> Mulai Produksi</button>`;
            if (can("update_production_status") && status === "IN_PROGRESS") actions = `<button class="ds-btn ds-btn-primary ds-btn-sm" onclick="ProductionCenterUI.completeQueue('${esc(row.QueueID)}',${Number(row.PlannedQty) || 0},this)"><i class="ph ph-check"></i> Tandai Selesai</button>`;
            if (can("manage_production_queue")) actions += `<button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="ProductionCenterUI.openManualNotification(this)" title="Kirim notifikasi manual"><i class="ph ph-paper-plane-tilt"></i></button>`;
            if (can("update_production_status") && (status === "PENDING" || status === "IN_PROGRESS")) actions += `<button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="ProductionCenterUI.updateQueue('${esc(row.QueueID)}','CANCELLED',undefined,this)" title="Batalkan"><i class="ph ph-x"></i></button>`;
            return `<tr class="border-t border-slate-100"><td class="p-3"><input type="checkbox" data-production-selection="queue" data-production-selection-id="${esc(row.QueueID)}" onchange="ProductionCenterUI.toggleCurrentSelectionItem(this)" aria-label="Pilih antrean ${esc(row.SKU)}"></td><td class="p-3"><b class="font-mono">${esc(row.SKU)}</b><span class="block text-slate-500">${esc(row.Product)}</span></td><td class="p-3 text-slate-600">${esc([row.Color, row.Size].filter(Boolean).join(" / ") || "-")}</td><td class="p-3 text-right">${money(row.StockAtCreation)}</td><td class="p-3 text-right">${money(row.MinimumStock)}</td><td class="p-3 text-right">${money(row.ProductionTarget || row.IdealStock)}</td><td class="p-3 text-right font-bold text-orange-700">${money(row.RecommendedQty)}</td><td class="p-3">${movingBadge(row.MovingStat)}</td><td class="p-3">${esc(row.ProductionRecipientName || row.ProductionRecipient || "Belum diatur")}</td><td class="p-3">${badge(status)}</td><td class="p-3">${badge(row.NotificationStatus || "NOT_SENT")}</td><td class="p-3"><div class="flex justify-end gap-1">${actions}</div></td></tr>`;
        }).join("");
        syncCurrentSelection("queue");
    }

    function renderHistory(rows) {
        const body = document.getElementById("production-history-body");
        if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Belum ada riwayat produksi.</td></tr>'; return; }
        body.innerHTML = rows.map(row => `<tr class="border-t border-slate-100"><td class="p-3 text-slate-500">${esc(window.formatIndonesiaDateTime(row.Timestamp))}</td><td class="p-3 font-semibold">${esc(row.Action)}</td><td class="p-3 font-mono">${esc(row.SKU)}</td><td class="p-3">${esc(row.UserName || row.UserEmail)}</td><td class="p-3 text-slate-500">${esc(row.Note || "-")}</td></tr>`).join("");
    }

    function renderReports(result) {
        const body = document.getElementById("production-reports-body");
        const rows = result?.items || [];
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400">Tidak ada laporan yang cocok.</td></tr>';
            const pagination = document.getElementById("production-reports-pagination");
            if (pagination) pagination.textContent = "";
            return;
        }
        body.innerHTML = rows.map(row => `<tr class="border-t border-slate-100 hover:bg-slate-50">
            <td class="p-3 font-mono text-[11px]">${esc(row.ReportID)}</td>
            <td class="p-3">${esc(row.ProductionRecipient || "-")}</td>
            <td class="p-3 text-slate-500">${esc(window.formatIndonesiaDateTime(row.ReceivedAt))}</td>
            <td class="p-3 text-slate-600">${esc(row.FileName || "-")}</td>
            <td class="p-3">${badge(row.Status)}</td>
            <td class="p-3 text-right"><button class="ds-btn ds-btn-secondary ds-btn-sm" onclick="ProductionCenterUI.openReportDetail('${esc(row.ReportID)}')"><i class="ph ph-eye"></i><span>Lihat</span></button></td>
        </tr>`).join("");
        const pagination = document.getElementById("production-reports-pagination");
        if (pagination) {
            pagination.innerHTML = `<span>${money(result.total || 0)} laporan · Halaman ${result.page || 1}/${result.totalPages || 1}</span><div class="flex gap-2"><button class="ds-btn ds-btn-secondary ds-btn-sm" ${result.page <= 1 ? "disabled" : ""} onclick="ProductionCenterUI.setReportPage(${(result.page || 1) - 1},this)">Sebelumnya</button><button class="ds-btn ds-btn-secondary ds-btn-sm" ${result.page >= result.totalPages ? "disabled" : ""} onclick="ProductionCenterUI.setReportPage(${(result.page || 1) + 1},this)">Berikutnya</button></div>`;
        }
    }

    function renderConfig(result) {
        const rows = result.rows || [];
        const body = document.getElementById("production-config-body");
        const addButton = document.getElementById("production-config-add");
        const recipientButton = document.getElementById("production-recipient-manage");
        const testingResetButton = document.getElementById("production-testing-reset");
        const testingStatisticsResetButton = document.getElementById("production-testing-statistics-reset");
        const pagination = document.getElementById("production-config-pagination");
        if (addButton) addButton.classList.toggle("hidden", !can("manage_stock_alert_settings"));
        if (recipientButton) recipientButton.classList.toggle("hidden", !can("manage_stock_alert_settings"));
        if (testingResetButton) testingResetButton.classList.toggle("hidden", !can("manage_stock_alert_settings"));
        if (testingStatisticsResetButton) testingStatisticsResetButton.classList.toggle("hidden", !can("manage_stock_alert_settings"));
        if (!rows.length) body.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400">Belum ada SKU yang dikonfigurasi untuk produksi.</td></tr>';
        else body.innerHTML = rows.map(row => {
            const status = row.valid ? (row.enabled ? '<span class="text-emerald-700 font-bold">VALID</span>' : '<span class="text-slate-500 font-bold">TIDAK AKTIF</span>') : `<span class="text-red-600 font-bold">${esc(row.validationError || "TIDAK VALID")}</span>`;
            const enabled = row.enabled ? '<span class="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">AKTIF</span>' : '<span class="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-600">TIDAK AKTIF</span>';
            const actions = can("manage_stock_alert_settings") ? `<button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="ProductionCenterUI.openConfigForm('${esc(row.sku)}')" title="Edit konfigurasi"><i class="ph ph-pencil-simple"></i></button><button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="ProductionCenterUI.toggleConfig('${esc(row.sku)}',this)" title="${row.enabled ? "Nonaktifkan" : "Aktifkan"}"><i class="ph ${row.enabled ? "ph-toggle-right" : "ph-toggle-left"}"></i></button><button class="ds-btn ds-btn-ghost ds-btn-sm text-red-600" onclick="ProductionCenterUI.deleteConfig('${esc(row.sku)}',this)" title="Hapus konfigurasi"><i class="ph ph-trash"></i></button>` : "<span class=\"text-slate-400\">Hanya baca</span>";
            const recipient = (result.recipients || []).find(item => item.id === row.productionRecipient);
            return `<tr class="border-t border-slate-100"><td class="p-3"><span class="font-mono font-bold">${esc(row.sku)}</span><span class="block text-slate-500">${esc(row.product || "-")}</span></td><td class="p-3 text-slate-600">${esc([row.color,row.size].filter(Boolean).join(" / ") || "-")}</td><td class="p-3 text-right font-bold">${money(row.stock)}</td><td class="p-3 text-right">${money(row.minimumStock)}</td><td class="p-3 text-right">${money(row.targetStock)}</td><td class="p-3 text-right">${money(row.minimumProductionBatch)}</td><td class="p-3">${movingBadge(row.moving, row.movingSource)}</td><td class="p-3">${esc(recipient?.name || row.productionRecipient || "Belum diatur")}</td><td class="p-3">${enabled}</td><td class="p-3">${status}</td><td class="p-3"><div class="flex justify-end gap-1">${actions}</div></td></tr>`;
        }).join("");
        if (pagination) {
            const totalPages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 25)));
            pagination.innerHTML = `<span>${money(result.total || 0)} konfigurasi · Halaman ${result.page || 1}/${totalPages}</span><div class="flex gap-2"><button class="ds-btn ds-btn-secondary ds-btn-sm" ${result.page <= 1 ? "disabled" : ""} onclick="ProductionCenterUI.setConfigPage(${(result.page || 1) - 1},this)">Sebelumnya</button><button class="ds-btn ds-btn-secondary ds-btn-sm" ${result.page >= totalPages ? "disabled" : ""} onclick="ProductionCenterUI.setConfigPage(${(result.page || 1) + 1},this)">Berikutnya</button></div>`;
        }
    }

    function renderConfigInfo(result) {
        const info = document.getElementById("production-config-info");
        if (!info) return;
        const invalid = Object.entries(result.invalidConfigurations || {});
        if (!result.configurationAvailable || invalid.length) {
            info.classList.remove("hidden");
            info.textContent = !result.configurationAvailable ? "Belum ada konfigurasi produksi. Tambahkan hanya untuk SKU yang memang perlu diproduksi." : "Konfigurasi tidak valid: " + invalid.map(([sku, message]) => `${sku} (${message})`).join(", ");
        } else info.classList.add("hidden");
    }

    function configBySku(sku) { return (state.config?.rows || []).find(row => row.sku === sku); }

    function fillConfigSkuOptions(selectedSku, editing) {
        const select = document.getElementById("production-config-sku");
        const configured = new Set((state.config?.rows || []).map(row => row.sku));
        const items = state.config?.inventory || [];
        select.innerHTML = '<option value="">Pilih SKU / varian</option>' + items.map(item => `<option value="${esc(item.sku)}" ${configured.has(item.sku) && item.sku !== selectedSku ? "disabled" : ""} ${item.sku === selectedSku ? "selected" : ""}>${esc(item.sku)} — ${esc(item.product)}${item.color || item.size ? " / " + esc([item.color,item.size].filter(Boolean).join(" ")) : ""}</option>`).join("");
        select.disabled = !!editing;
    }

    function updateRecipientFilters(data) {
        const recipients = new Map();
        (data?.recipients || []).filter(recipient => recipient.active).forEach(recipient => recipients.set(recipient.id, recipient.name));
        if (!recipients.size) {
            (data?.items || []).forEach(item => { if (item.productionRecipient) recipients.set(item.productionRecipient, item.productionRecipientName || item.productionRecipient); });
            (data?.queue || []).forEach(item => { if (item.ProductionRecipient) recipients.set(item.ProductionRecipient, item.ProductionRecipientName || item.ProductionRecipient); });
        }
        ["production-filter-recipient", "production-queue-filter-recipient"].forEach(id => {
            const select = document.getElementById(id); if (!select) return;
            const current = select.value || "ALL";
            select.innerHTML = '<option value="ALL">Semua Konveksi</option><option value="UNASSIGNED">Belum Diatur</option>' + Array.from(recipients.entries()).map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
            select.value = current === "UNASSIGNED" || recipients.has(current) ? current : "ALL";
        });
    }

    function fillRecipientOptions(selectedRecipient) {
        const select = document.getElementById("production-config-recipient");
        if (!select) return;
        const recipients = (state.config?.recipients || []).filter(recipient => recipient.active);
        select.innerHTML = '<option value="">Belum Diatur</option>' + recipients.map(recipient => `<option value="${esc(recipient.id)}" ${recipient.id === selectedRecipient ? "selected" : ""}>${esc(recipient.name)} (${esc(recipient.type)})</option>`).join("");
    }

    window.ProductionCenterUI = {
        init() { this.bindEvents(); if (!state.initialized) state.initialized = true; this.load(); },
        bindEvents() {
            if (state.eventsBound) return;
            const reloadButton = document.getElementById("production-reload");
            const alertsBody = document.getElementById("production-alerts-body");
            if (!reloadButton || !alertsBody) return;
            state.eventsBound = true;
            reloadButton.addEventListener("click", event => {
                event.preventDefault();
                this.load();
            });
            alertsBody.addEventListener("click", event => {
                const button = event.target.closest("[data-production-action]");
                if (!button || !alertsBody.contains(button)) return;
                event.preventDefault();
                const action = button.dataset.productionAction;
                if (action === "create-queue") this.createQueue(button.dataset.sku, button);
                if (action === "ignore-alert") this.ignoreAlert(button.dataset.sku, button);
                if (action === "open-detail") this.openDetail(button.dataset.sku);
            });
        },
        async load() {
            const body = document.getElementById("production-alerts-body");
            const reloadButton = document.getElementById("production-reload");
            if (!setBusy(reloadButton, true, "Memuat...")) return;
            if (body) body.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400"><i class="ph ph-spinner animate-spin text-xl"></i></td></tr>';
            try {
                const result = await request("getStockProductionDashboard", {
                    search: document.getElementById("production-search")?.value || "",
                    status: document.getElementById("production-filter-status")?.value || "ALL",
                    moving: document.getElementById("production-filter-moving")?.value || "ALL",
                    todo: document.getElementById("production-filter-todo")?.value || "ALL",
                    priority: document.getElementById("production-filter-priority")?.value || "ALL",
                    productionRecipient: document.getElementById("production-filter-recipient")?.value || "ALL",
                    pageSize: 100
                });
                const warning = document.getElementById("production-config-warning");
                if (result.status === "configuration_required") {
                    if (warning) {
                        warning.classList.remove("hidden");
                        warning.textContent = result.message + " Header yang belum tersedia: " + (result.missingHeaders || []).join(", ");
                    }
                    renderKpis({}); renderAlerts([]); renderQueue([]); renderHistory([]); return;
                }
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat data Konveksi.");
                if (warning) warning.classList.add("hidden"); state.data = result;
                updateRecipientFilters(result); renderKpis(result.kpi || {}); renderAlerts(result.items || []); renderQueue(result.queue || []); renderHistory(result.history || []);
            } catch (error) {
                const message = error.message || String(error);
                if (body) body.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-red-500">${esc(message)}</td></tr>`;
                notify(message, "error");
            } finally { setBusy(reloadButton, false); }
        },
        debounceLoad() { clearTimeout(state.timer); state.timer = setTimeout(() => this.load(), 300); },
        renderCurrentQueue() { renderQueue(state.data?.queue || []); },
        toggleCurrentSelection(control) {
            const type = control.dataset.productionSelectionAll;
            const selected = selectionSet(type);
            document.querySelectorAll(`[data-production-selection="${type}"]`).forEach(input => {
                const id = input.dataset.productionSelectionId;
                if (!id) return;
                if (control.checked) selected.add(id); else selected.delete(id);
            });
            syncCurrentSelection(type);
        },
        toggleCurrentSelectionItem(input) {
            const type = input.dataset.productionSelection;
            const id = input.dataset.productionSelectionId;
            if (!type || !id) return;
            const selected = selectionSet(type);
            if (input.checked) selected.add(id); else selected.delete(id);
            syncCurrentSelection(type);
        },
        debounceConfigLoad() { state.configPage = 1; clearTimeout(state.configTimer); state.configTimer = setTimeout(() => this.loadConfig(), 300); },
        setMode(mode) {
            state.mode = mode;
            ["alerts", "queue", "history", "config", "reports"].forEach(name => {
                document.getElementById(`production-${name}-panel`).classList.toggle("hidden", name !== mode);
                const button = document.getElementById(`production-mode-${name}`);
                if (button) button.className = name === mode ? "ds-btn ds-btn-primary ds-btn-sm" : "ds-btn ds-btn-secondary ds-btn-sm";
            });
            if (mode === "config") this.loadConfig();
            if (mode === "reports") this.loadReports();
        },
        openDetail(sku) {
            const item = (state.data?.items || []).find(row => row.sku === sku); if (!item) return;
            const labels = [["SKU", item.sku], ["Produk", item.product], ["Varian", [item.color,item.size].filter(Boolean).join(" / ")], ["Stok Saat Ini", item.stock], ["Stok Minimum", item.minimumStock], ["Target Stok", item.productionTarget], ["Produksi Minimal", item.productionMin], ["Saran Produksi", item.productionQty], ["Urgensi", item.movingStat], ["Status Produksi", item.status]];
            document.getElementById("production-detail-content").innerHTML = labels.map(([label,value]) => `<div><div class="text-[10px] uppercase font-bold text-slate-400">${esc(label)}</div><div class="font-semibold text-slate-800 break-words">${esc(value == null ? "-" : value)}</div></div>`).join("");
            const modal = document.getElementById("production-detail-modal"); modal.classList.remove("hidden"); modal.classList.add("flex");
        },
        closeDetail() { const modal = document.getElementById("production-detail-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); },
        async loadReports(button) {
            if (!can("manage_production_queue")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            if (!setBusy(button, true, "Memuat...")) return;
            const body = document.getElementById("production-reports-body");
            if (body) body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400"><i class="ph ph-spinner animate-spin text-xl"></i></td></tr>';
            try {
                const select = document.getElementById("production-reports-filter-recipient");
                const recipients = state.data?.recipients || state.config?.recipients || [];
                const currentRecipient = select?.value || "ALL";
                if (select) {
                    select.innerHTML = '<option value="ALL">Semua Konveksi</option>' + recipients.filter(row => row.active).map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("");
                    select.value = recipients.some(row => row.active && row.id === currentRecipient) ? currentRecipient : "ALL";
                }
                const result = await request("getProductionReports", {
                    status: document.getElementById("production-reports-filter-status")?.value || "MENUNGGU_VERIFIKASI",
                    productionRecipient: select?.value || "ALL",
                    reportId: document.getElementById("production-reports-search")?.value || "",
                    page: state.reportPage,
                    pageSize: 25
                });
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat laporan produksi.");
                state.reports = result; state.reportPage = result.page || 1; renderReports(result);
            } catch (error) {
                if (body) body.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">${esc(error.message || String(error))}</td></tr>`;
                showToast(error.message || String(error), "error");
            } finally { setBusy(button, false); }
        },
        setReportPage(page, button) { state.reportPage = Math.max(1, Number(page) || 1); this.loadReports(button); },
        resetReportPage() { state.reportPage = 1; this.loadReports(); },
        debounceReportLoad() { state.reportPage = 1; clearTimeout(state.timer); state.timer = setTimeout(() => this.loadReports(), 300); },
        async openReportDetail(reportId) {
            try {
                const result = await request("getProductionReportDetail", { reportId });
                if (result.status !== "success") throw new Error(result.message || "Laporan tidak ditemukan.");
                state.reportDetail = result.report;
                const report = result.report;
                const thumbnail = report.DriveFileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(report.DriveFileId)}&sz=w900` : "";
                const photo = thumbnail ? `<div class="space-y-2"><img src="${thumbnail}" alt="Preview ${esc(report.FileName || "laporan")}" class="max-h-80 max-w-full mx-auto rounded border border-slate-200 object-contain"><a href="${esc(report.DriveUrl || "#")}" target="_blank" rel="noopener" class="text-xs text-blue-700 hover:underline">Buka file di Google Drive</a></div>` : "Referensi foto tidak tersedia.";
                const detail = document.getElementById("production-report-detail-content");
                detail.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">ID Laporan</div><div class="font-mono break-all">${esc(report.ReportID)}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Konveksi</div><div>${esc(report.ProductionRecipient || "-")}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Diterima</div><div>${esc(window.formatIndonesiaDateTime(report.ReceivedAt))}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Status</div><div>${badge(report.Status)}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Telegram Message ID</div><div>${esc(report.TelegramMessageId || "-")}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Telegram Update ID</div><div>${esc(report.TelegramUpdateId || "-")}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">Nama File</div><div class="break-all">${esc(report.FileName || "-")}</div></div>
                    <div><div class="text-[10px] uppercase font-bold text-slate-400">MIME</div><div>${esc(report.MimeType || "-")}</div></div>
                </div><div class="mt-4"><div class="text-[10px] uppercase font-bold text-slate-400 mb-1">Caption</div><div class="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 rounded p-2">${esc(report.Caption || "-")}</div></div><div class="mt-4"><div class="text-[10px] uppercase font-bold text-slate-400 mb-1">Foto</div>${photo}</div><div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">${report.VerifiedAt ? `<div><div class="text-[10px] uppercase font-bold text-slate-400">Verified At</div><div>${esc(window.formatIndonesiaDateTime(report.VerifiedAt))}</div></div>` : ""}${report.VerifiedBy ? `<div><div class="text-[10px] uppercase font-bold text-slate-400">Verified By</div><div>${esc(report.VerifiedBy)}</div></div>` : ""}${report.RejectedAt ? `<div><div class="text-[10px] uppercase font-bold text-slate-400">Rejected At</div><div>${esc(window.formatIndonesiaDateTime(report.RejectedAt))}</div></div>` : ""}${report.RejectedBy ? `<div><div class="text-[10px] uppercase font-bold text-slate-400">Rejected By</div><div>${esc(report.RejectedBy)}</div></div>` : ""}${report.RejectionReason ? `<div class="md:col-span-2"><div class="text-[10px] uppercase font-bold text-slate-400">Alasan Penolakan</div><div class="whitespace-pre-wrap">${esc(report.RejectionReason)}</div></div>` : ""}</div>`;
                const actions = document.getElementById("production-report-detail-actions");
                const pending = String(report.Status || "").toUpperCase() === "MENUNGGU_VERIFIKASI";
                actions.innerHTML = pending ? `<button class="ds-btn ds-btn-primary" onclick="ProductionCenterUI.verifyReport('${esc(report.ReportID)}',this)"><i class="ph ph-check"></i><span>Verifikasi</span></button><button class="ds-btn ds-btn-secondary text-red-700" onclick="ProductionCenterUI.openRejectReport('${esc(report.ReportID)}')"><i class="ph ph-x"></i><span>Tolak / Minta Kirim Ulang</span></button>` : '<span class="text-xs text-slate-500">Laporan sudah diproses.</span>';
                const modal = document.getElementById("production-report-detail-modal"); modal.classList.remove("hidden"); modal.classList.add("flex");
            } catch (error) { showToast(error.message || String(error), "error"); }
        },
        closeReportDetail() { const modal = document.getElementById("production-report-detail-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); state.reportDetail = null; },
        async verifyReport(reportId, button) {
            if (!confirm("Verifikasi laporan ini?")) return;
            if (!setBusy(button, true, "Memverifikasi...")) return;
            try {
                const result = await request("transitionProductionReport", { reportId, targetStatus: "DIVERIFIKASI" });
                if (result.status !== "success") throw new Error(result.message || "Verifikasi laporan gagal.");
                showToast(result.idempotent ? "Laporan sudah diverifikasi." : "Laporan berhasil diverifikasi.", "success");
                this.closeReportDetail(); this.loadReports();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        openRejectReport(reportId) {
            document.getElementById("production-report-reject-id").value = reportId;
            document.getElementById("production-report-rejection-reason").value = "";
            const modal = document.getElementById("production-report-reject-modal"); modal.classList.remove("hidden"); modal.classList.add("flex");
        },
        closeRejectReport() { const modal = document.getElementById("production-report-reject-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); },
        async rejectReport(button) {
            const reason = document.getElementById("production-report-rejection-reason").value.trim();
            if (!reason) return showToast("Alasan penolakan wajib diisi.", "error");
            if (!setBusy(button, true, "Menyimpan...")) return;
            try {
                const reportId = document.getElementById("production-report-reject-id").value;
                const result = await request("transitionProductionReport", { reportId, targetStatus: "DITOLAK", rejectionReason: reason });
                if (result.status !== "success") throw new Error(result.message || "Penolakan laporan gagal.");
                this.closeRejectReport(); this.closeReportDetail(); showToast(result.idempotent ? "Laporan sudah ditolak." : "Laporan berhasil ditolak.", "success"); this.loadReports();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async loadConfig(button) {
            const body = document.getElementById("production-config-body");
            if (!setBusy(button, true, "Memuat...")) return;
            if (body) body.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400"><i class="ph ph-spinner animate-spin text-xl"></i></td></tr>';
            try {
                const result = await request("getProductionConfigurations", {
                    search: document.getElementById("production-config-search")?.value || "",
                    enabled: document.getElementById("production-config-enabled")?.value || "ALL",
                    page: state.configPage,
                    pageSize: 100
                });
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat konfigurasi produksi.");
                state.config = result; state.configPage = result.page || 1; renderConfigInfo(result); renderConfig(result);
            } catch (error) { if (body) body.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-red-500">${esc(error.message || String(error))}</td></tr>`; showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        setConfigPage(page, button) { state.configPage = Math.max(1, Number(page) || 1); this.loadConfig(button); },
        resetConfigPage(button) { state.configPage = 1; this.loadConfig(button); },
        openConfigForm(sku) {
            if (!can("manage_stock_alert_settings")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            if (!state.config) return this.loadConfig();
            const existing = sku ? configBySku(sku) : null;
            fillConfigSkuOptions(existing?.sku || "", !!existing);
            document.getElementById("production-config-mode").value = existing ? "UPDATE" : "CREATE";
            document.getElementById("production-config-modal-title").textContent = existing ? "Edit Konfigurasi Produksi" : "Tambah Konfigurasi Produksi";
            document.getElementById("production-config-minimum").value = existing?.minimumStock ?? "";
            document.getElementById("production-config-target").value = existing?.targetStock ?? "";
            document.getElementById("production-config-batch").value = existing?.minimumProductionBatch ?? "";
            document.getElementById("production-config-moving").value = existing?.moving || "";
            fillRecipientOptions(existing?.productionRecipient || "");
            document.getElementById("production-config-enabled-input").checked = existing ? !!existing.enabled : true;
            document.getElementById("production-config-notes").value = existing?.notes || "";
            this.updateConfigPreview();
            const modal = document.getElementById("production-config-modal"); modal.classList.remove("hidden"); modal.classList.add("flex");
        },
        closeConfigForm() { const modal = document.getElementById("production-config-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); },
        updateConfigPreview() {
            const sku = document.getElementById("production-config-sku").value;
            const item = (state.config?.inventory || []).find(row => row.sku === sku);
            const stock = Number(item?.stock) || 0;
            const minimum = Number(document.getElementById("production-config-minimum").value);
            const target = Number(document.getElementById("production-config-target").value);
            const batch = Number(document.getElementById("production-config-batch").value);
            const shortfall = Number.isFinite(target) ? Math.max(0, target - stock) : 0;
            const suggested = shortfall > 0 && Number.isFinite(batch) && batch > 0 ? Math.max(shortfall, batch) : 0;
            document.getElementById("production-preview-stock").textContent = money(stock);
            document.getElementById("production-preview-minimum").textContent = Number.isFinite(minimum) ? money(minimum) : "-";
            document.getElementById("production-preview-shortfall").textContent = money(shortfall);
            document.getElementById("production-preview-suggested").textContent = money(suggested);
        },
        async saveConfig(button) {
            const payload = {
                mode: document.getElementById("production-config-mode").value,
                sku: document.getElementById("production-config-sku").value,
                minimumStock: document.getElementById("production-config-minimum").value,
                targetStock: document.getElementById("production-config-target").value,
                minimumProductionBatch: document.getElementById("production-config-batch").value,
                moving: document.getElementById("production-config-moving").value,
                productionRecipient: document.getElementById("production-config-recipient")?.value || "",
                enabled: document.getElementById("production-config-enabled-input").checked,
                notes: document.getElementById("production-config-notes").value
            };
            if (!setBusy(button, true, "Menyimpan...")) return;
            try {
                const result = await request("saveProductionConfiguration", payload);
                if (result.status !== "success") throw new Error(result.message || "Gagal menyimpan konfigurasi.");
                this.closeConfigForm(); showToast("Konfigurasi produksi tersimpan.", "success"); await this.loadConfig();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async toggleConfig(sku, button) {
            const row = configBySku(sku); if (!row) return;
            if (!setBusy(button, true, "Menyimpan...")) return;
            try {
                const result = await request("saveProductionConfiguration", { mode: "UPDATE", sku, minimumStock: row.minimumStock, targetStock: row.targetStock, minimumProductionBatch: row.minimumProductionBatch, moving: row.moving, productionRecipient: row.productionRecipient || "", enabled: !row.enabled, notes: row.notes || "" });
                if (result.status !== "success") throw new Error(result.message || "Gagal mengubah status konfigurasi.");
                await this.loadConfig();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async deleteConfig(sku, button) {
            if (!confirm(`Hapus konfigurasi produksi untuk ${sku}? Queue aktif akan memblokir penghapusan.`)) return;
            if (!setBusy(button, true, "Menghapus...")) return;
            try {
                const result = await request("deleteProductionConfiguration", { sku });
                if (result.status !== "success") throw new Error(result.message || "Gagal menghapus konfigurasi.");
                showToast("Konfigurasi produksi dihapus.", "success"); await this.loadConfig();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async openRecipients(button) {
            if (!can("manage_stock_alert_settings")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            if (!setBusy(button, true, "Memuat...")) return;
            document.getElementById("production-recipient-modal").classList.remove("hidden"); document.getElementById("production-recipient-modal").classList.add("flex");
            try { await this.loadRecipients(); } finally { setBusy(button, false); }
        },
        showChatIdHelp() {
            alert("Cara mendapatkan Chat ID:\n\n1. Buka Telegram.\n2. Cari ANSLA Inventory Bot.\n3. Kirim /id atau /start.\n4. Bot akan membalas Chat ID Anda.\n5. Salin angka tersebut ke kolom ini.");
        },
        closeRecipients() { const modal = document.getElementById("production-recipient-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); },
        clearRecipientForm() {
            document.getElementById("production-recipient-mode").value = "CREATE";
            ["id", "name", "chat-id", "notes"].forEach(name => { document.getElementById(`production-recipient-${name}`).value = ""; });
            document.getElementById("production-recipient-type").value = "KONVEKSI"; document.getElementById("production-recipient-active").checked = true;
            document.getElementById("production-recipient-id").disabled = false;
        },
        async loadRecipients(button) {
            if (!setBusy(button, true, "Memuat...")) return;
            try {
                const result = await request("getProductionRecipients");
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat penerima produksi.");
                state.recipients = result.rows || [];
                const body = document.getElementById("production-recipient-body");
                body.innerHTML = state.recipients.length ? state.recipients.map(row => `<tr class="border-t border-slate-100"><td class="p-3"><b>${esc(row.name)}</b><span class="block text-slate-500">${esc(row.id)}</span></td><td class="p-3">Konveksi</td><td class="p-3">${row.active ? "Aktif" : "Tidak Aktif"}</td><td class="p-3 text-right"><button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="ProductionCenterUI.editRecipient('${esc(row.id)}')" title="Edit penerima"><i class="ph ph-pencil-simple"></i></button><button class="ds-btn ds-btn-ghost ds-btn-sm text-red-600" onclick="ProductionCenterUI.deleteRecipient('${esc(row.id)}',this)" title="Hapus penerima"><i class="ph ph-trash"></i></button></td></tr>`).join("") : '<tr><td colspan="4" class="p-6 text-center text-slate-400">Belum ada penerima produksi.</td></tr>';
                this.clearRecipientForm();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        editRecipient(id) {
            const row = (state.recipients || []).find(item => item.id === id); if (!row) return;
            document.getElementById("production-recipient-mode").value = "UPDATE";
            document.getElementById("production-recipient-id").value = row.id; document.getElementById("production-recipient-id").disabled = true;
            document.getElementById("production-recipient-name").value = row.name; document.getElementById("production-recipient-type").value = row.type;
            document.getElementById("production-recipient-chat-id").value = row.telegramChatId; document.getElementById("production-recipient-active").checked = !!row.active; document.getElementById("production-recipient-notes").value = row.notes || "";
        },
        async saveRecipient(button) {
            if (!setBusy(button, true, "Menyimpan...")) return;
            try {
                const result = await request("saveProductionRecipient", {
                    mode: document.getElementById("production-recipient-mode").value, id: document.getElementById("production-recipient-id").value,
                    recipientId: document.getElementById("production-recipient-id").value,
                    name: document.getElementById("production-recipient-name").value, type: document.getElementById("production-recipient-type").value,
                    telegramChatId: document.getElementById("production-recipient-chat-id").value, active: document.getElementById("production-recipient-active").checked,
                    chatId: document.getElementById("production-recipient-chat-id").value,
                    notes: document.getElementById("production-recipient-notes").value
                });
                if (result.status !== "success") throw new Error(result.message || "Gagal menyimpan penerima produksi.");
                showToast("Penerima produksi tersimpan.", "success"); await this.loadRecipients(); await this.loadConfig();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async deleteRecipient(id, button) {
            if (!confirm("Hapus penerima produksi ini?")) return;
            if (!setBusy(button, true, "Menghapus...")) return;
            try { const result = await request("deleteProductionRecipient", { id }); if (result.status !== "success") throw new Error(result.message || "Gagal menghapus penerima."); showToast("Penerima dihapus.", "success"); await this.loadRecipients(); await this.loadConfig(); }
            catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        openTestingReset() {
            if (!can("manage_stock_alert_settings")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            const modal = document.getElementById("production-testing-reset-warning-modal");
            modal.classList.remove("hidden"); modal.classList.add("flex");
        },
        closeTestingResetWarning() {
            const modal = document.getElementById("production-testing-reset-warning-modal");
            modal.classList.add("hidden"); modal.classList.remove("flex");
        },
        async continueTestingReset(button) {
            this.closeTestingResetWarning();
            if (!setBusy(button, true, "Memuat...")) return;
            try {
                const result = await request("previewProductionTestingReset");
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat kandidat reset testing.");
                state.testingResetPreview = result;
                this.renderTestingResetCandidates();
                const modal = document.getElementById("production-testing-reset-modal");
                modal.classList.remove("hidden"); modal.classList.add("flex");
            } catch (error) {
                showToast(error.message || String(error), "error");
            } finally {
                setBusy(button, false);
            }
        },
        openTestingStatisticsReset() {
            if (!can("manage_stock_alert_settings")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            const modal = document.getElementById("production-testing-statistics-reset-modal");
            modal.classList.remove("hidden"); modal.classList.add("flex");
        },
        closeTestingStatisticsReset() {
            const modal = document.getElementById("production-testing-statistics-reset-modal");
            modal.classList.add("hidden"); modal.classList.remove("flex");
        },
        async continueTestingStatisticsReset(button) {
            this.closeTestingStatisticsReset();
            if (!setBusy(button, true, "Mereset...")) return;
            try {
                const result = await request("resetStockProductionStatistics");
                if (!result || result.status !== "success") throw new Error(result?.message || "Reset statistik gagal.");
                showToast("Statistik testing berhasil di-reset.", "success");
                await this.load();
                return result;
            } catch (error) {
                showToast("Reset statistik gagal: " + (error.message || String(error)), "error");
            } finally {
                setBusy(button, false);
            }
        },
        closeTestingReset() {
            const modal = document.getElementById("production-testing-reset-modal");
            modal.classList.add("hidden"); modal.classList.remove("flex");
        },
        renderTestingResetCandidates() {
            const preview = state.testingResetPreview || {};
            const queueBody = document.getElementById("production-testing-reset-queue-body");
            const alertBody = document.getElementById("production-testing-reset-alert-body");
            const rows = (items, type) => items.map(item => `<tr class="border-t border-slate-100"><td class="p-2"><input type="checkbox" data-testing-reset-type="${type}" data-testing-reset-id="${esc(item.id)}" onchange="ProductionCenterUI.toggleTestingResetItem(this)"></td><td class="p-2 font-mono text-[11px]">${esc(item.id)}</td><td class="p-2"><b>${esc(item.sku)}</b><span class="block text-slate-500">${esc(item.product || "-")}</span></td><td class="p-2 text-slate-600">${esc([item.color, item.size].filter(Boolean).join(" / ") || "-")}</td><td class="p-2">${badge(item.status)}</td></tr>`).join("");
            queueBody.innerHTML = (preview.queueCandidates || []).length ? rows(preview.queueCandidates, "QUEUE") : '<tr><td colspan="5" class="p-4 text-center text-slate-400">Tidak ada Queue aktif untuk dipilih.</td></tr>';
            alertBody.innerHTML = (preview.alertCandidates || []).length ? rows(preview.alertCandidates, "ALERT") : '<tr><td colspan="5" class="p-4 text-center text-slate-400">Tidak ada Alert aktif untuk dipilih.</td></tr>';
            this.syncTestingResetSelection("QUEUE");
            this.syncTestingResetSelection("ALERT");
        },
        syncTestingResetSelection(type) {
            const inputs = Array.from(document.querySelectorAll(`[data-testing-reset-type="${type}"]`));
            const selectAll = document.getElementById(`production-testing-reset-${type.toLowerCase()}-select-all`);
            const count = document.getElementById(`production-testing-reset-${type.toLowerCase()}-count`);
            const selectedCount = inputs.filter(input => input.checked).length;
            if (selectAll) {
                selectAll.disabled = inputs.length === 0;
                selectAll.checked = inputs.length > 0 && selectedCount === inputs.length;
                selectAll.indeterminate = selectedCount > 0 && selectedCount < inputs.length;
            }
            if (count) count.textContent = String(inputs.length);
            this.updateTestingResetSummary();
        },
        toggleTestingResetSelection(control) {
            const type = control.dataset.testingResetSelectAll;
            document.querySelectorAll(`[data-testing-reset-type="${type}"]`).forEach(input => { input.checked = control.checked; });
            this.syncTestingResetSelection(type);
        },
        toggleTestingResetItem(input) {
            this.syncTestingResetSelection(input.dataset.testingResetType);
        },
        clearTestingResetSelection() {
            document.querySelectorAll("[data-testing-reset-type]").forEach(input => { input.checked = false; });
            this.syncTestingResetSelection("QUEUE");
            this.syncTestingResetSelection("ALERT");
        },
        getTestingResetSelection() {
            const selected = { queueIds: [], alertIds: [], fingerprints: {} };
            const preview = state.testingResetPreview || {};
            const byQueueId = new Map((preview.queueCandidates || []).map(item => [item.id, item]));
            const byAlertId = new Map((preview.alertCandidates || []).map(item => [item.id, item]));
            document.querySelectorAll("[data-testing-reset-type]:checked").forEach(input => {
                const type = input.dataset.testingResetType;
                const id = input.dataset.testingResetId;
                const item = type === "QUEUE" ? byQueueId.get(id) : byAlertId.get(id);
                if (!item) return;
                if (type === "QUEUE") selected.queueIds.push(id); else selected.alertIds.push(id);
                selected.fingerprints[`${type}:${id}`] = item.fingerprint;
            });
            return selected;
        },
        updateTestingResetSummary() {
            const selection = this.getTestingResetSelection();
            const summary = document.getElementById("production-testing-reset-summary");
            if (!summary) return;
            summary.textContent = `Dipilih: ${selection.queueIds.length} Queue, ${selection.alertIds.length} Alert. Hanya record yang Anda pilih akan diubah.`;
        },
        async executeTestingReset(button) {
            const selection = this.getTestingResetSelection();
            if (!selection.queueIds.length && !selection.alertIds.length) return showToast("Pilih minimal satu Queue atau Alert hasil testing.", "error");
            const confirmed = confirm(`Reset ${selection.queueIds.length} Queue dan ${selection.alertIds.length} Alert terpilih?\n\nStok, konfigurasi, transaksi, Telegram, dan history lama tidak akan diubah.`);
            if (!confirmed) return;
            if (!setBusy(button, true, "Mereset...")) return;
            try {
                const result = await request("resetProductionTestingState", Object.assign(selection, {
                    confirmation: "RESET_TESTING_PRODUCTION_STATE"
                }));
                if (result.status === "aborted") {
                    const changed = (result.results || []).filter(item => item.action === "SKIPPED_TARGET_CHANGED").map(item => `${item.type} ${item.id}`);
                    throw new Error(changed.length ? `Reset dibatalkan: target berubah (${changed.join(", ")}). Muat ulang kandidat lalu pilih kembali.` : (result.message || "Reset dibatalkan."));
                }
                if (result.status !== "success") throw new Error(result.message || "Verifikasi reset gagal.");
                const summary = result.summary || {};
                showToast(`Reset data testing berhasil: ${summary.pendingResolved || 0} Queue ditutup, ${summary.inProgressCancelled || 0} Queue dibatalkan, ${summary.alertsResolved || 0} Alert diselesaikan.`, "success");
                this.closeTestingReset();
                await this.load();
            } catch (error) {
                showToast(error.message || String(error), "error");
            } finally {
                setBusy(button, false);
            }
        },
        resetManualNotificationState() {
            state.manualItems = [];
            state.manualQtyBySku = new Map();
            state.manualSelection = new Set();
            state.manualRequestId = "";
            state.manualPreviewKey = "";
            const items = document.getElementById("production-manual-items");
            const count = document.getElementById("production-manual-selection-summary");
            const preview = document.getElementById("production-manual-preview-button");
            if (items) items.innerHTML = "";
            if (count) count.textContent = "0 dipilih";
            if (preview) preview.disabled = true;
        },
        async openManualNotification(button) {
            if (!can("manage_production_queue")) return showToast("Akses hanya untuk Owner atau Admin.", "error");
            if (!setBusy(button, true, "Memuat...")) return;
            this.resetManualNotificationState();
            try {
                if (!state.config?.recipients) await this.loadConfig();
                const result = await request("getStockProductionDashboard", {
                    search: "", status: "ALL", moving: "ALL", todo: "ALL", priority: "ALL", productionRecipient: "ALL", pageSize: 100
                });
                if (result.status !== "success") throw new Error(result.message || "Gagal memuat data produksi aktual.");
                state.manualItems = (result.items || []).filter(item => item.activeProduction !== false && Number(item.productionQty) > 0);
                state.manualQtyBySku = new Map(state.manualItems.map(item => [item.sku, String(item.productionQty)]));
                state.manualSelection = new Set();
                state.manualPreviewKey = "";
                state.manualRequestId = "MANUAL-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
                const modal = document.getElementById("production-manual-modal");
                const recipient = document.getElementById("production-manual-recipient");
                recipient.innerHTML = '<option value="">Pilih konveksi</option>' + (state.config?.recipients || []).filter(row => row.active).map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("");
                document.getElementById("production-manual-moving").value = "ALL";
                document.getElementById("production-manual-search").value = "";
                document.getElementById("production-manual-warning").textContent = "";
                document.getElementById("production-manual-preview").textContent = "Pilih produk, lalu tekan Pratinjau.";
                this.renderManualItems();
                modal.classList.remove("hidden"); modal.classList.add("flex");
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        invalidateManualPreview() { state.manualPreviewKey = ""; },
        closeManualNotification() { const modal = document.getElementById("production-manual-modal"); modal.classList.add("hidden"); modal.classList.remove("flex"); this.resetManualNotificationState(); },
        manualVisibleItems() {
            const search = (document.getElementById("production-manual-search")?.value || "").toLowerCase().trim();
            const moving = document.getElementById("production-manual-moving")?.value || "ALL";
            return state.manualItems.filter(item => {
                if (moving !== "ALL" && String(item.movingStat).toUpperCase() !== moving) return false;
                if (search && [item.sku, item.product, item.color, item.size].join(" ").toLowerCase().indexOf(search) < 0) return false;
                return true;
            });
        },
        renderManualItems() {
            const visible = this.manualVisibleItems();
            const visibleSkus = new Set(visible.map(item => item.sku));
            Array.from(state.manualSelection).forEach(sku => { if (!visibleSkus.has(sku)) state.manualSelection.delete(sku); });
            const body = document.getElementById("production-manual-items");
            body.innerHTML = visible.length ? `<table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left"><input id="production-manual-select-all" type="checkbox" onchange="ProductionCenterUI.toggleManualSelection(this)" aria-label="Pilih semua produk yang tampil"> <span class="sr-only">Pilih Semua</span></th><th class="p-2 text-left">SKU / Produk</th><th class="p-2 text-left">Varian</th><th class="p-2 text-right">Stok</th><th class="p-2 text-right">Minimum</th><th class="p-2 text-right">Target</th><th class="p-2 text-right">Produksi</th><th class="p-2 text-left">Urgensi</th></tr></thead><tbody>${visible.map(item => `<tr class="border-t border-slate-100"><td class="p-2"><input class="production-manual-item" type="checkbox" data-sku="${esc(item.sku)}" onchange="ProductionCenterUI.toggleManualSelectionItem(this)" aria-label="Pilih ${esc(item.sku)}"></td><td class="p-2"><b class="font-mono">${esc(item.sku)}</b><span class="block text-slate-500">${esc(item.product)}</span></td><td class="p-2">${esc([item.color, item.size].filter(Boolean).join(" / ") || "-")}</td><td class="p-2 text-right">${money(item.stock)}</td><td class="p-2 text-right">${money(item.minimumStock)}</td><td class="p-2 text-right">${money(item.productionTarget)}</td><td class="p-2 text-right"><input class="production-manual-qty ds-input w-20 px-2 py-1 text-right text-xs font-normal text-slate-700" type="number" min="1" step="1" value="${esc(state.manualQtyBySku.get(item.sku) ?? item.productionQty)}" data-sku="${esc(item.sku)}" oninput="ProductionCenterUI.updateManualQuantity(this)" aria-label="Jumlah produksi manual ${esc(item.sku)}"></td><td class="p-2">${movingBadge(item.movingStat)}</td></tr>`).join("")}</tbody></table>` : '<p class="p-4 text-sm text-slate-500">Tidak ada SKU produksi aktif yang cocok.</p>';
            body.querySelectorAll(".production-manual-item").forEach(input => { input.checked = state.manualSelection.has(input.dataset.sku); });
            this.syncManualSelection();
        },
        syncManualSelection() {
            const visible = this.manualVisibleItems();
            const selectedVisible = visible.filter(item => state.manualSelection.has(item.sku)).length;
            const selectAll = document.getElementById("production-manual-select-all");
            if (selectAll) { selectAll.disabled = visible.length === 0; selectAll.checked = visible.length > 0 && selectedVisible === visible.length; selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length; }
            const count = document.getElementById("production-manual-selection-summary");
            if (count) count.textContent = `${state.manualSelection.size} dipilih`;
            const preview = document.getElementById("production-manual-preview-button");
            if (preview) preview.disabled = state.manualSelection.size === 0;
            state.manualPreviewKey = "";
        },
        toggleManualSelection(control) {
            this.manualVisibleItems().forEach(item => { if (control.checked) state.manualSelection.add(item.sku); else state.manualSelection.delete(item.sku); });
            this.syncManualSelection();
            document.querySelectorAll(".production-manual-item").forEach(input => { input.checked = state.manualSelection.has(input.dataset.sku); });
        },
        toggleManualSelectionItem(input) { if (input.checked) state.manualSelection.add(input.dataset.sku); else state.manualSelection.delete(input.dataset.sku); this.syncManualSelection(); },
        manualFilterChanged() { this.renderManualItems(); },
        updateManualQuantity(input) {
            state.manualQtyBySku.set(input.dataset.sku, input.value);
            state.manualPreviewKey = "";
        },
        validateManualQuantities() {
            for (const sku of state.manualSelection) {
                const raw = String(state.manualQtyBySku.get(sku) ?? "").trim();
                const quantity = Number(raw);
                if (!/^\d+$/.test(raw) || !Number.isFinite(quantity) || quantity <= 0 || Math.floor(quantity) !== quantity) {
                    return { valid: false, message: "Jumlah produksi harus berupa bilangan bulat lebih dari 0." };
                }
            }
            return { valid: true };
        },
        manualPayload() {
            return {
                recipientId: document.getElementById("production-manual-recipient").value,
                priority: document.getElementById("production-manual-moving").value || "ALL",
                items: Array.from(state.manualSelection).sort().map(sku => ({ sku, manualProductionQty: Number(state.manualQtyBySku.get(sku)) })),
                manualRequestId: state.manualRequestId
            };
        },
        async previewManualNotification(button) {
            if (!state.manualSelection.size) return showToast("Pilih minimal satu SKU.", "error");
            const quantityValidation = this.validateManualQuantities();
            if (!quantityValidation.valid) return showToast(quantityValidation.message, "error");
            if (!setBusy(button, true, "Memuat...")) return;
            try {
                const payload = this.manualPayload();
                const result = await request("previewManualProductionNotification", payload);
                if (result.status !== "success") throw new Error(result.message || "Gagal membuat pratinjau.");
                document.getElementById("production-manual-preview").textContent = (result.messages || []).join("\n\n---\n\n");
                const warning = (result.warnings || []).length ? `Peringatan: ${result.warnings.map(row => `${row.sku} biasanya ditujukan ke ${row.configuredRecipient}`).join(", ")}` : "";
                document.getElementById("production-manual-warning").textContent = warning;
                state.manualPreviewKey = JSON.stringify(payload);
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async sendManualNotification() {
            const payload = this.manualPayload();
            if (!state.manualSelection.size) return showToast("Pilih minimal satu SKU.", "error");
            const quantityValidation = this.validateManualQuantities();
            if (!quantityValidation.valid) return showToast(quantityValidation.message, "error");
            if (!state.manualPreviewKey || state.manualPreviewKey !== JSON.stringify(payload)) return showToast("Buat pratinjau terbaru sebelum mengirim.", "error");
            const warning = document.getElementById("production-manual-warning").textContent;
            const recipient = document.getElementById("production-manual-recipient");
            const label = recipient.options[recipient.selectedIndex]?.text || "penerima terpilih";
            const confirmation = `Kirim notifikasi manual untuk ${payload.items.length} SKU ke ${label}?` + (warning ? `\n\n${warning}` : "");
            if (!confirm(confirmation)) return;
            if (warning) payload.confirmRecipientMismatch = true;
            const button = document.getElementById("production-manual-send"); if (!setBusy(button, true, "Mengirim...")) return;
            try {
                const result = await request("sendManualProductionNotification", payload);
                if (result.status === "warning") throw new Error(result.message || "Tujuan perlu dikonfirmasi.");
                if (result.status !== "success") throw new Error(result.message || "Gagal mengirim notifikasi manual.");
                showToast(`Notifikasi manual terkirim ke ${result.recipient.name}.`, "success"); this.closeManualNotification(); await this.load();
            } catch (error) { showToast(error.message || String(error), "error"); }
            finally { setBusy(button, false); }
        },
        async createQueue(sku, button) { if (!setBusy(button, true, "Memproses...")) return; try { const result = await request("createProductionQueue", { sku }); if (result.status !== "success") throw new Error(result.message); notify(result.created ? "Masuk Production Queue." : "SKU sudah ada di Production Queue.", "success"); await this.load(); } catch (e) { notify(e.message || String(e), "error"); } finally { setBusy(button, false); } },
        async ignoreAlert(sku, button) { const reason = prompt("Alasan mengabaikan alert:"); if (!reason) return; if (!setBusy(button, true, "Memproses...")) return; try { const result = await request("ignoreStockAlert", { sku, reason }); if (result.status !== "success") throw new Error(result.message); notify("Alert diabaikan.", "success"); await this.load(); } catch (e) { notify(e.message || String(e), "error"); } finally { setBusy(button, false); } },
        async updateQueue(queueId, nextStatus, completedQty, button) { const note = prompt("Catatan (opsional):") || ""; if (!setBusy(button, true, nextStatus === "IN_PROGRESS" ? "Memulai..." : nextStatus === "COMPLETED" ? "Menyelesaikan..." : "Memproses...")) return; try { const result = await request("updateProductionQueueStatus", { queueId, nextStatus, completedQty, note }); if (result.status !== "success") throw new Error(result.message); showToast("Status produksi diperbarui. Stok tidak diubah.", "success"); await this.load(); } catch (e) { showToast(e.message, "error"); } finally { setBusy(button, false); } },
        completeQueue(queueId, suggested, button) { const value = prompt("Qty produksi selesai:", String(suggested || 0)); if (value === null) return; const qty = Number(value); if (!Number.isFinite(qty) || qty < 0) return showToast("Qty selesai tidak valid.", "error"); this.updateQueue(queueId, "COMPLETED", qty, button); }
    };
})();
