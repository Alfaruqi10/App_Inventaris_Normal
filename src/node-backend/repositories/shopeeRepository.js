/**
 * ShopeeRepository Interface
 * Kontrak untuk operasi data Shopee (ShopeeProducts, ShopeeMapping, ShopeeOrders, ShopeeLogs).
 */
export class ShopeeRepository {
  async getShopeeProducts() { throw new Error("Method getShopeeProducts() must be implemented."); }
  async getShopeeMappings() { throw new Error("Method getShopeeMappings() must be implemented."); }
  async getShopeeOrders() { throw new Error("Method getShopeeOrders() must be implemented."); }
  async getShopeeLogs() { throw new Error("Method getShopeeLogs() must be implemented."); }
  async getShopeeNotifications() { throw new Error("Method getShopeeNotifications() must be implemented."); }
  
  async saveShopeeMapping(mappingObj) { throw new Error("Method saveShopeeMapping() must be implemented."); }
  async deleteShopeeMapping(itemId, modelId) { throw new Error("Method deleteShopeeMapping() must be implemented."); }
  async updateShopeeProductMappingStatus(itemId, modelId, status) { throw new Error("Method updateShopeeProductMappingStatus() must be implemented."); }
  
  async upsertShopeeProducts(productsList) { throw new Error("Method upsertShopeeProducts() must be implemented."); }
  async upsertShopeeOrders(ordersList) { throw new Error("Method upsertShopeeOrders() must be implemented."); }
  async logShopeeActivity(type, orderSn, sku, status, message) { throw new Error("Method logShopeeActivity() must be implemented."); }
}
