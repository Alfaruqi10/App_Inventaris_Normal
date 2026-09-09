import { RecoveryRepository } from '../recoveryRepository.js';
import sheetsService from './sheetsService.js';
import propertiesService from '../../utils/properties.js';

import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class RecoverySheetRepository extends RecoveryRepository {
  constructor() {
    super();
    this.PROPERTY_KEY = "RECOVERY_JOB_HISTORY";
    this.SYSTEM_AUDIT_SHEET = "DeductionAudit";
    this.MAX_HISTORY = 50;
  }

  async getHistory() {
    try {
      const raw = propertiesService.getProperty(this.PROPERTY_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error("[RecoverySheetRepository ERROR] Gagal memuat riwayat:", e.message);
    }
    return [];
  }

  async saveHistory(history) {
    try {
      let limitedHistory = history;
      if (limitedHistory.length > this.MAX_HISTORY) {
        limitedHistory = limitedHistory.slice(0, this.MAX_HISTORY);
      }
      propertiesService.setProperty(this.PROPERTY_KEY, JSON.stringify(limitedHistory));
      return true;
    } catch (e) {
      console.error("[RecoverySheetRepository ERROR] Gagal menyimpan riwayat:", e.message);
      return false;
    }
  }

  async logAudit(auditData) {
    try {
      const rows = await sheetsService.readRows(this.SYSTEM_AUDIT_SHEET);
      let headers = rows[0] || [];

      if (headers.length === 0) {
        headers = [
          "Timestamp", "Order SN", "Action", "Old Status", 
          "New Status", "Reason", "Note", "User", "Ext1"
        ];
        await sheetsService.appendRow(this.SYSTEM_AUDIT_SHEET, headers);
      }

      const note = `[Recovery Center] ` +
                   `Preview: ${auditData.previewResult || "-"} | ` +
                   `Exec: ${auditData.executionResult || "-"} | ` +
                   `Success: ${auditData.successCount || 0} | ` +
                   `Failed: ${auditData.failedCount || 0} | ` +
                   `Dur: ${auditData.duration || "0.0s"} | ` +
                   `Rollback: ${auditData.rollbackStatus || "-"} | ` +
                   `Err: ${auditData.errorMessage || "-"}`;

      const newRow = [
        getJakartaTimeString(),
        auditData.jobId,                           // Order SN
        auditData.toolId,                          // Action
        auditData.status === "preview" ? "PREVIEW" : "EXECUTE", // Old Status
        auditData.status,                          // New Status
        auditData.category,                        // Reason
        note,                                      // Note
        auditData.user || "System",                // User
        ""                                         // Ext1
      ];

      await sheetsService.appendRow(this.SYSTEM_AUDIT_SHEET, newRow);
      return true;
    } catch (e) {
      console.error("[RecoverySheetRepository ERROR] Gagal menulis audit log:", e.message);
      return false;
    }
  }
}
