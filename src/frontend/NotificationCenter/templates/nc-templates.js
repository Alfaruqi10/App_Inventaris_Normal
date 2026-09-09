// ============================================================
// NotificationCenter/templates/nc-templates.js — Msg Templates
// ============================================================

const NotificationCenterTemplates = (function() {
    return {
        /**
         * Memuat seluruh daftar template pesan.
         */
        async load() {
            NotificationCenterShared.checkPermissionAndRun("rules", async () => {
                const container = document.getElementById("nc-templates-list");
                if (!container) return;
                
                container.innerHTML = `<div class="text-center py-6 text-gray-400"><i class="ph ph-spinner animate-spin text-2xl"></i></div>`;
                
                try {
                    const res = await NotificationCenterAPI.getTemplates();
                    if (res.status !== "success") throw new Error(res.message);

                    const templates = res.templates || [];
                    this.render(templates);

                } catch (e) {
                    container.innerHTML = `<div class="text-center py-8 text-red-500 text-sm">Gagal memuat template: ${e.message}</div>`;
                }
            });
        },

        /**
         * Render daftar template
         */
        render(templates) {
            const container = document.getElementById("nc-templates-list");
            if (!container) return;

            if (templates.length === 0) {
                container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">Tidak ada template terdaftar.</div>`;
                return;
            }

            let html = '<div class="space-y-4">';
            templates.forEach(t => {
                const initialCharCount = (t.Body || "").length;

                html += `
                    <div class="border border-gray-200 rounded-xl p-4 bg-gray-50 flex flex-col gap-3">
                        <div class="flex items-center justify-between border-b pb-2">
                            <div>
                                <span class="text-xs font-bold text-indigo-600 font-mono">${t.TemplateID}</span>
                                <h5 class="text-sm font-semibold text-gray-800 mt-0.5">${t.Name}</h5>
                            </div>
                            <span class="text-[10px] text-gray-400 font-mono">Updated: ${formatDateShort(t.UpdatedAt)}</span>
                        </div>
                        <div>
                            <div class="flex justify-between items-center mb-1">
                                <label class="block text-[10px] text-gray-400 font-bold uppercase">Body Template (HTML Telegram)</label>
                                <span id="nc-tpl-count-${t.TemplateID}" class="text-[10px] text-gray-400">${initialCharCount} karakter</span>
                            </div>
                            <textarea id="nc-tpl-body-${t.TemplateID}" 
                                oninput="NotificationCenterTemplates.updateCharCounter('${t.TemplateID}')" 
                                class="w-full bg-slate-900 text-slate-200 font-mono text-xs p-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed" 
                                rows="5">${t.Body}</textarea>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="NotificationCenterTemplates.save('${t.TemplateID}',this)" class="ds-btn ds-btn-primary ds-btn-sm bg-indigo-600 hover:bg-indigo-700 text-xs flex-1 flex items-center justify-center gap-1"><i class="ph ph-floppy-disk"></i> Simpan Perubahan</button>
                            <button onclick="NotificationCenterTemplates.preview('${t.TemplateID}')" class="ds-btn ds-btn-secondary ds-btn-sm text-xs flex-1 flex items-center justify-center gap-1"><i class="ph ph-eye"></i> Tinjau Placeholder</button>
                        </div>
                    </div>`;
            });
            html += "</div>";
            container.innerHTML = html;
        },

        updateCharCounter(templateId) {
            const body = document.getElementById(`nc-tpl-body-${templateId}`)?.value || "";
            const countEl = document.getElementById(`nc-tpl-count-${templateId}`);
            if (countEl) countEl.textContent = `${body.length} karakter`;
        },

        async save(templateId, button) {
            const body = document.getElementById(`nc-tpl-body-${templateId}`).value;
            if (!NotificationCenterShared.setBtnLoading(button, "Menyimpan...")) return;
            try {
                const res = await NotificationCenterAPI.updateTemplate(templateId, body);
                if (res.status !== "success") throw new Error(res.message);
                showToast("Template berhasil diperbarui.", "success");
                await this.load();
            } catch (e) {
                showToast("Gagal menyimpan template: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button);
            }
        },

        preview(templateId) {
            const body = document.getElementById(`nc-tpl-body-${templateId}`).value;
            
            // Ganti placeholder tiruan
            let preview = body
                .replace(/{{invoice}}/g, "INV/2026/ANSLA-8871")
                .replace(/{{order_sn}}/g, "SN1783881")
                .replace(/{{customer}}/g, "Ananda S.L.")
                .replace(/{{amount}}/g, "450.000")
                .replace(/{{courier}}/g, "Shopee Express")
                .replace(/{{reason}}/g, "Permintaan pembeli")
                .replace(/{{sku}}/g, "KEMEJA-NAVY-M")
                .replace(/{{product}}/g, "Kemeja Flanel ANSLA Premium")
                .replace(/{{stock}}/g, "3")
                .replace(/{{min_stock}}/g, "5")
                .replace(/{{tool}}/g, "Repair Pending Deduction")
                .replace(/{{status}}/g, "SUCCESS")
                .replace(/{{affected}}/g, "12")
                .replace(/{{duration}}/g, "1.8s")
                .replace(/{{error}}/g, "Koneksi API dibatasi limit")
                .replace(/{{date}}/g, formatDateTime(new Date()));

            document.getElementById("nc-preview-title").textContent = "Preview Template: " + templateId;
            document.getElementById("nc-preview-body").innerHTML = preview.replace(/\n/g, "<br>");
            document.getElementById("nc-preview-modal").classList.remove("hidden");
        },

        closePreviewModal() {
            document.getElementById("nc-preview-modal").classList.add("hidden");
        }
    };
})();
