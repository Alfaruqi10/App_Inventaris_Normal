export class DashboardService {
  /**
   * @param {DashboardRepository} dashboardRepository
   */
  constructor(dashboardRepository) {
    this.dashboardRepo = dashboardRepository;
  }

  async getOrdersKPI(dateFrom, dateTo) {
    return await this.dashboardRepo.getOrdersKPI(dateFrom, dateTo);
  }

  async getMasterAndTransactionData() {
    const master = await this.dashboardRepo.getMasterBarangData();
    const transaksi = await this.dashboardRepo.getTransaksiData();
    return { master, transaksi };
  }
}
