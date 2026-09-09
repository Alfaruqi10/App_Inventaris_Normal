// ============================================================
// BusinessAnalytics/api/ba-api.js — API Connector Client
// ============================================================

const BusinessAnalyticsAPI = {
    async getSummary(params) {
        return postData({ action: "getBusinessAnalyticsSummary", ...params });
    },
    async getProductData(params) {
        return postData({ action: "getProductAnalytics", ...params });
    },
    async getSalesData(params) {
        return postData({ action: "getSalesAnalytics", ...params });
    },
    async getInventoryData(params) {
        return postData({ action: "getInventoryAnalytics", ...params });
    },
    async getCustomerData(params) {
        return postData({ action: "getCustomerAnalytics", ...params });
    },
    async getProfitData(params) {
        return postData({ action: "getProfitAnalytics", ...params });
    },
    async getAIInsights(params) {
        return postData({ action: "getAIInsights", ...params });
    },
    async getForecast(params) {
        return postData({ action: "getBusinessForecast", ...params });
    },
    async triggerCalculation() {
        return postData({ action: "calculateBusinessAnalytics" });
    }
};
