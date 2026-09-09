import { FinanceRepository } from '../financeRepository.js';
import sheetsService from './sheetsService.js';

export class FinanceSheetRepository extends FinanceRepository {
  constructor() {
    super();
    this.sheetName = "SalesLedger";
  }

  /**
   * Mendapatkan seluruh baris data di SalesLedger sebagai array of objects.
   */
  async getSalesLedgers() {
    return await sheetsService.readSheetObjects(this.sheetName);
  }

  /**
   * Membaca raw matrix data (termasuk headers) untuk modifikasi baris.
   */
  async getRawSalesLedgerMatrix() {
    const raw = await sheetsService.readRows(this.sheetName);
    const headers = raw[0] || [];
    return {
      headers,
      raw,
      sheetName: this.sheetName
    };
  }

  /**
   * Memperbarui seluruh baris matrix data SalesLedger.
   */
  async updateSalesLedgerRows(rawValues) {
    if (!rawValues || rawValues.length === 0) return;

    // Hitung lebar kolom maksimum untuk memastikan rentang penulisan rapi
    const maxCols = Math.max(rawValues[0].length, ...rawValues.map(row => row.length));
    const paddedRows = rawValues.map(row => {
      const newRow = [...row];
      while (newRow.length < maxCols) {
        newRow.push("");
      }
      return newRow;
    });

    const columnToLetter = (columnNumber) => {
      let result = "";
      let current = columnNumber;
      while (current > 0) {
        const remainder = (current - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        current = Math.floor((current - 1) / 26);
      }
      return result;
    };

    const lastRowIndex = paddedRows.length;
    const range = `A1:${columnToLetter(maxCols)}${lastRowIndex}`;
    await sheetsService.updateRange(this.sheetName, range, paddedRows);
  }

  /**
   * Dedicated migration write boundary. The production controller supplies a
   * fully validated matrix and this repository writes only SalesLedger once.
   */
  async replaceSalesLedgerMatrix(rawValues) {
    await this.updateSalesLedgerRows(rawValues);
  }
}
