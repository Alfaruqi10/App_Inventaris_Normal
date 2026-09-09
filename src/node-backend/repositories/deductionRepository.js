/**
 * DeductionRepository Interface
 * Kontrak untuk operasi data deduksi stok (MasterBarang, Transaksi, ShopeeOrders, DeductionAudit).
 */
export class DeductionRepository {
  async getStockBySku(sku) { throw new Error("Method getStockBySku() must be implemented."); }
  async deductStock(sku, qty, orderSn, productName, variationName) { throw new Error("Method deductStock() must be implemented."); }
  async updateDeductionStatus(orderSn, itemId, modelId, status, details) { throw new Error("Method updateDeductionStatus() must be implemented."); }
  async logAudit(orderSn, action, oldStatus, newStatus, reason, note, user) { throw new Error("Method logAudit() must be implemented."); }
}
