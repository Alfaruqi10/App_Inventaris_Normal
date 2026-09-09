// ============================================================
// RecoveryCenter/recovery-center-api.js — API Client
// ============================================================

const RecoveryCenterAPI = {
    /**
     * Mengambil daftar tools dari registry backend.
     */
    async getRegistry() {
        console.log("[RecoveryCenterAPI] Mengambil registry...");
        return postData({ action: "getRecoveryRegistry" });
    },

    /**
     * Mengeksekusi tool (preview atau eksekusi riil).
     * @param {string} toolId 
     * @param {Object} options 
     */
    async executeTool(toolId, options = {}) {
        console.log("[RecoveryCenterAPI] Eksekusi tool:", toolId, "dengan opsi:", options);
        return postData({ 
            action: "executeRecoveryTool", 
            toolId: toolId, 
            options: Object.assign({}, options, {
                auth: {
                    userEmail: currentUser?.email || "Admin",
                    role: currentUser?.role || "Admin"
                }
            })
        });
    },

    /**
     * Mengambil riwayat pekerjaan pemulihan (job history).
     */
    async getHistory() {
        console.log("[RecoveryCenterAPI] Mengambil riwayat pekerjaan...");
        return postData({ action: "getRecoveryJobHistory" });
    },

    /**
     * Mengambil data kesehatan sistem terintegrasi.
     */
    async getSystemHealth() {
        console.log("[RecoveryCenterAPI] Mengambil kesehatan sistem...");
        return postData({ action: "getRecoverySystemHealth" });
    },

    /**
     * Memicu proses rollback manual untuk tool tertentu.
     * @param {string} toolId 
     * @param {Object} rollbackState 
     */
    async rollbackTool(toolId, rollbackState = {}) {
        console.log("[RecoveryCenterAPI] Memicu rollback manual untuk:", toolId);
        return postData({ 
            action: "rollbackRecoveryTool", 
            toolId: toolId, 
            rollbackState: rollbackState 
        });
    }
};
