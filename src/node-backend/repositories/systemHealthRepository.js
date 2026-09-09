/**
 * SystemHealthRepository Interface
 * Kontrak untuk penarikan data metrik pemantauan kesehatan sistem.
 */
export class SystemHealthRepository {
  async getPendingOrdersCount() { throw new Error("Method getPendingOrdersCount() must be implemented."); }
  async getDuplicateOrdersCount() { throw new Error("Method getDuplicateOrdersCount() must be implemented."); }
  async getMissingSettlementsCount() { throw new Error("Method getMissingSettlementsCount() must be implemented."); }
  async getLedgerRowCount() { throw new Error("Method getLedgerRowCount() must be implemented."); }
  async getMappedProductsPercent() { throw new Error("Method getMappedProductsPercent() must be implemented."); }
  async getKpiStatus() { throw new Error("Method getKpiStatus() must be implemented."); }
  async getWebhookStatsToday() { throw new Error("Method getWebhookStatsToday() must be implemented."); }
}
