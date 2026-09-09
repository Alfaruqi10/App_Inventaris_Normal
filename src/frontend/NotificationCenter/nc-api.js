// ============================================================
// NotificationCenter/nc-api.js — Frontend API Client
// ============================================================

const NotificationCenterAPI = {
    async getDashboardData() {
        return postData({ action: "getTelegramDashboardData" });
    },
    async getSubscribers() {
        return postData({ action: "getTelegramSubscribers" });
    },
    async approveSubscriber(id) {
        return postData({ action: "approveTelegramSubscriber", id });
    },
    async disableSubscriber(id) {
        return postData({ action: "disableTelegramSubscriber", id });
    },
    async deleteSubscriber(id) {
        return postData({ action: "deleteTelegramUser", id }); // Reuses old CRUD handler
    },
    async testSubscriber(id) {
        return postData({ action: "testTelegramSubscriberNotification", id });
    },
    async saveSubscriberRules(id, role, rules) {
        return postData({ action: "saveSubscriberRules", id, role, rules });
    },
    async getTemplates() {
        return postData({ action: "getTelegramTemplates" });
    },
    async updateTemplate(templateId, body) {
        return postData({ action: "updateTelegramTemplate", templateId, body });
    },
    async sendBroadcast(targetRole, messageText) {
        return postData({ action: "sendManualBroadcast", targetRole, messageText });
    },
    async getQueueHistory() {
        return postData({ action: "getTelegramQueueHistory" });
    },
    async getSettings() {
        return postData({ action: "getTelegramSettings" });
    },
    async saveSettings(settings) {
        return postData({ action: "saveTelegramSettings", ...settings });
    },
    async generateJoinLink() {
        return postData({ action: "generateTelegramJoinLink" }); // Reuses old join link handler
    }
};
