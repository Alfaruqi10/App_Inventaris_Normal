/**
 * RecoveryRepository Interface
 * Kontrak untuk operasi data pemeliharaan (job history, audit logs).
 */
export class RecoveryRepository {
  async getHistory() { throw new Error("Method getHistory() must be implemented."); }
  async saveHistory(history) { throw new Error("Method saveHistory() must be implemented."); }
  async logAudit(auditData) { throw new Error("Method logAudit() must be implemented."); }
}
