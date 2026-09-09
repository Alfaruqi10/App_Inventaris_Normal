import { AdsRepository } from '../adsRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class AdsSheetRepository extends AdsRepository {
  constructor() {
    super();
    this.balanceSheet = "Ads_Balance";
    this.campaignSheet = "Ads_Campaign";
    this.dailySheet = "Ads_Product_Daily";
    this.summarySheet = "Ads_Daily_Summary";
    this.reportSheet = "Ads_Report";
    this.auditLogSheet = "Ads_Audit_Log";
  }

  /**
   * Mendapatkan seluruh baris data performa harian dari sheet Ads_Report (SSOT).
   */
  async getAdsReport() {
    return await sheetsService.readSheetObjects(this.reportSheet);
  }

  /**
   * Mendapatkan seluruh baris saldo iklan dari sheet Ads_Balance.
   */
  async getAdsBalance() {
    return await sheetsService.readSheetObjects(this.balanceSheet);
  }

  /**
   * Mendapatkan seluruh baris data kampanye iklan dari sheet Ads_Campaign.
   */
  async getAdsCampaigns() {
    return await sheetsService.readSheetObjects(this.campaignSheet);
  }

  /**
   * Mengubah status kampanye iklan tertentu di sheet Ads_Campaign.
   */
  async updateAdsCampaignStatus(campaignId, newStatus) {
    const raw = await sheetsService.readRows(this.campaignSheet);
    if (raw.length <= 1) return { found: false };

    const headers = raw[0];
    const cIdCol = headers.indexOf("CampaignID");
    const statusCol = headers.indexOf("Status");
    const updatedCol = headers.indexOf("UpdatedAt");

    if (cIdCol === -1 || statusCol === -1) {
      throw new Error(`Struktur kolom pada sheet ${this.campaignSheet} tidak valid.`);
    }

    let found = false;
    let oldStatus = "";

    for (let i = 1; i < raw.length; i++) {
      if (String(raw[i][cIdCol]).trim() === String(campaignId).trim()) {
        oldStatus = String(raw[i][statusCol] || "");
        const sheetRowIndex = i + 1; // 1-indexed spreadsheet row

        // Update Status
        await sheetsService.updateCell(this.campaignSheet, sheetRowIndex, statusCol + 1, newStatus);
        
        // Update UpdatedAt jika ada
        if (updatedCol !== -1) {
          await sheetsService.updateCell(this.campaignSheet, sheetRowIndex, updatedCol + 1, getJakartaTimeString());
        }

        found = true;
        break;
      }
    }

    return { found, oldStatus };
  }

  /**
   * Mendapatkan seluruh baris data performa harian iklan dari sheet Ads_Product_Daily.
   */
  async getAdsProductDaily() {
    return await sheetsService.readSheetObjects(this.dailySheet);
  }

  /**
   * Mendapatkan seluruh baris data summary resmi harian iklan dari sheet Ads_Daily_Summary.
   */
  async getAdsDailySummary() {
    return await sheetsService.readSheetObjects(this.summarySheet);
  }

  /**
   * Mencatat aktivitas perubahan iklan ke sheet Ads_Audit_Log.
   */
  async logAdsAudit(auditLog) {
    const timestamp = getJakartaTimeString();
    const rowValues = [
      timestamp,
      auditLog.user || "User",
      auditLog.action || "",
      auditLog.campaignId || "",
      auditLog.oldValue || "",
      auditLog.newValue || "",
      auditLog.status || "SUCCESS",
      auditLog.details || ""
    ];
    await sheetsService.appendRow(this.auditLogSheet, rowValues);
  }
}
