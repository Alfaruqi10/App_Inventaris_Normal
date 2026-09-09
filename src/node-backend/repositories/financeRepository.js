/**
 * FinanceRepository Interface
 * Menentukan operasi data untuk modul keuangan & Sales Ledger.
 */
export class FinanceRepository {
  /**
   * Mendapatkan seluruh baris data di SalesLedger sebagai array of objects.
   * @returns {Promise<Array<object>>}
   */
  async getSalesLedgers() {
    throw new Error('Method getSalesLedgers() not implemented');
  }

  /**
   * Memperbarui seluruh baris matrix data SalesLedger.
   * @param {Array<Array<any>>} rawValues - Matrix baris data lengkap
   * @returns {Promise<void>}
   */
  async updateSalesLedgerRows(rawValues) {
    throw new Error('Method updateSalesLedgerRows() not implemented');
  }
}
