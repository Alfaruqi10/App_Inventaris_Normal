import { propertiesService } from '../utils/properties.js';

export class SystemHealthService {
  /**
   * @param {SystemHealthRepository} systemHealthRepository
   */
  constructor(systemHealthRepository) {
    this.healthRepo = systemHealthRepository;
  }

  async getHealthMetrics() {
    const health = {
      webhook: 'Active', // Node.js server berjalan berarti endpoint webhook aktif
      api: 'Offline',    // Default ke offline jika Shopee API belum siap
      lastSync: propertiesService.getProperty('LAST_SYNC') || '-',
      lastHistoricalSync: propertiesService.getProperty('LAST_HISTORICAL_SYNC') || '-',
      lastRepair: propertiesService.getProperty('LAST_REPAIR') || '-',
      pendingOrders: '-',
      duplicateOrders: '-',
      missingSettlement: '-',
      ledgerStatus: '-',
      mappingStatus: '-',
      kpiStatus: '-'
    };

    // 1. Pending orders
    try {
      health.pendingOrders = await this.healthRepo.getPendingOrdersCount();
    } catch (e) {
      health.pendingOrders = 'Error';
    }

    // 2. Duplicate orders
    try {
      health.duplicateOrders = await this.healthRepo.getDuplicateOrdersCount();
    } catch (e) {
      health.duplicateOrders = 'Error';
    }

    // 3. Missing settlement
    try {
      health.missingSettlement = await this.healthRepo.getMissingSettlementsCount();
    } catch (e) {
      health.missingSettlement = 'Error';
    }

    // 4. Ledger status
    try {
      const count = await this.healthRepo.getLedgerRowCount();
      health.ledgerStatus = count > 0 ? `${count} baris` : 'Kosong';
    } catch (e) {
      health.ledgerStatus = 'Error';
    }

    // 5. Mapping status
    try {
      const pct = await this.healthRepo.getMappedProductsPercent();
      health.mappingStatus = `${pct}%`;
    } catch (e) {
      health.mappingStatus = 'Error';
    }

    // 6. KPI Status
    try {
      health.kpiStatus = await this.healthRepo.getKpiStatus();
    } catch (e) {
      health.kpiStatus = 'Error';
    }

    // 7. Shopee API status check (simple verification)
    const hasShopeeAuth = propertiesService.getProperty('shopee_access_token') && propertiesService.getProperty('shopee_shop_id');
    health.api = hasShopeeAuth ? 'Online' : 'Belum Terotorisasi';

    return health;
  }
}
