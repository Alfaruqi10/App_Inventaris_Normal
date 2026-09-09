// ============================================================
// NotificationCenter/settings/nc-settings.js — Setelan & Simulator
// ============================================================

const NotificationCenterSettings = (function() {
    return {
        /**
         * Memuat data konfigurasi dari backend.
         */
        async load() {
            NotificationCenterShared.checkPermissionAndRun("settings", async () => {
                this.showLoading();
                try {
                    const res = await NotificationCenterAPI.getSettings();
                    if (res.status !== "success") throw new Error(res.message);

                    const s = res.settings || {};
                    document.getElementById("nc-set-token").value = s.botToken;
                    document.getElementById("nc-set-username").value = s.botUsername;
                    document.getElementById("nc-set-webhook").value = s.webhookUrl || "Webhook belum dipasang";
                    document.getElementById("nc-set-parsemode").value = s.defaultParseMode;
                    document.getElementById("nc-set-enabled").checked = s.enabledGlobal;
                    document.getElementById("nc-set-sound").checked = s.enableSound;

                    // Invite bot link
                    const inviteContainer = document.getElementById("nc-invite-link-container");
                    if (s.botUsername) {
                        inviteContainer.classList.remove("hidden");
                        const link = `https://t.me/${s.botUsername.replace("@", "")}?start=register`;
                        document.getElementById("nc-invite-url").textContent = link;
                    } else {
                        inviteContainer.classList.add("hidden");
                    }

                } catch (e) {
                    showToast("Gagal memuat setting: " + e.message, "error");
                }
            });
        },

        showLoading() {
            document.getElementById("nc-set-token").value = "Memuat...";
            document.getElementById("nc-set-username").value = "Memuat...";
            document.getElementById("nc-set-webhook").value = "Memuat...";
        },

        /**
         * Simpan konfigurasi setting bot ke backend.
         */
        async save(button) {
            const token = document.getElementById("nc-set-token").value.trim();
            const username = document.getElementById("nc-set-username").value.trim();
            const parsemode = document.getElementById("nc-set-parsemode").value;
            const enabled = document.getElementById("nc-set-enabled").checked;
            const sound = document.getElementById("nc-set-sound").checked;

            const btn = document.getElementById("nc-btn-save-settings");
            if (!NotificationCenterShared.setBtnLoading(button || btn, "Menyimpan...")) return;

            try {
                const res = await NotificationCenterAPI.saveSettings({
                    botToken: token,
                    botUsername: username,
                    defaultParseMode: parsemode,
                    enabledGlobal: enabled,
                    enableSound: sound
                });

                if (res.status !== "success") throw new Error(res.message);
                
                showToast("Pengaturan bot disimpan & Webhook ter-registrasi.", "success");
                await this.load();

            } catch (e) {
                showToast("Gagal menyimpan setting: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button || btn);
            }
        },

        /**
         * Jalankan simulasi kirim data webhook tiruan ke webhook receiver backend.
         */
        async runWebhookSimulator(button) {
            const btn = document.getElementById("nc-btn-simulate-webhook");
            if (!NotificationCenterShared.setBtnLoading(button || btn, "Simulasi...")) return;
            
            try {
                const testPayload = {
                    action: "simulateTelegramWebhook",
                    message: {
                        chat: { id: 999999, first_name: "Simulasi", last_name: "User", username: "simulasi_bot" },
                        text: "/start"
                    }
                };

                const res = await postData(testPayload);
                if (res.status !== "success") throw new Error(res.message);
                
                showToast("Simulasi webhook dikirim sukses. Response HTTP 200 OK.", "success");
                
                // Refresh list pendaftar jika simulasi berhasil terdaftar
                if (NotificationCenterSubscribers) {
                    await NotificationCenterSubscribers.load();
                }

            } catch (e) {
                showToast("Gagal menjalankan simulasi webhook: " + e.message, "error");
            } finally {
                NotificationCenterShared.resetBtn(button || btn);
            }
        }
    };
})();
