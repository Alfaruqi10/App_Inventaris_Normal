/**
 * AdsRepository Interface
 * Menentukan operasi data untuk Shopee Ads sheets database.
 */
export class AdsRepository {
  /**
   * Mendapatkan seluruh baris saldo iklan dari sheet Ads_Balance.
   * @returns {Promise<Array<object>>}
   */
  async getAdsBalance() {
    throw new Error('Method getAdsBalance() not implemented');
  }

  /**
   * Mendapatkan seluruh baris data kampanye iklan dari sheet Ads_Campaign.
   * @returns {Promise<Array<object>>}
   */
  async getAdsCampaigns() {
    throw new Error('Method getAdsCampaigns() not implemented');
  }

  /**
   * Mengubah status kampanye iklan tertentu di sheet Ads_Campaign.
   * @param {string} campaignId - ID Kampanye
   * @param {string} newStatus - Status baru (ONGOING/PAUSED/CLOSED/dll)
   * @returns {Promise<boolean>} True jika ditemukan & diupdate
   */
  async updateAdsCampaignStatus(campaignId, newStatus) {
    throw new Error('Method updateAdsCampaignStatus() not implemented');
  }

  /**
   * Mendapatkan seluruh baris data performa harian iklan dari sheet Ads_Product_Daily.
   * @returns {Promise<Array<object>>}
   */
  async getAdsProductDaily() {
    throw new Error('Method getAdsProductDaily() not implemented');
  }

  /**
   * Mencatat aktivitas perubahan iklan ke sheet Ads_Audit_Log.
   * @param {object} auditLog - Data audit log
   * @returns {Promise<void>}
   */
  async logAdsAudit(auditLog) {
    throw new Error('Method logAdsAudit() not implemented');
  }
}
