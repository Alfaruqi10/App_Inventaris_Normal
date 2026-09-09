/**
 * DashboardRepository Interface
 * Kontrak untuk penarikan data transaksi order (KPI) dan sheet master/transaksi gudang.
 */
export class DashboardRepository {
  async getOrdersKPI(dateFrom, dateTo) { throw new Error("Method getOrdersKPI() must be implemented."); }
  async getMasterBarangData() { throw new Error("Method getMasterBarangData() must be implemented."); }
  async getTransaksiData() { throw new Error("Method getTransaksiData() must be implemented."); }
}
