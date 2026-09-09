import { getSheetsClient } from '../../config/google.js';
import NodeCache from 'node-cache';

// Caching lokal untuk mempercepat pembacaan data berulang (TTL: 5 detik)
const sheetCache = new NodeCache({ stdTTL: 5, checkperiod: 1 });

/**
 * Konversi indeks kolom (1-indexed) menjadi huruf kolom Excel/Google Sheets (contoh: 1 -> A, 27 -> AA).
 */
export function getColumnLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    let modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

class SheetsService {
  constructor() {
    this.spreadsheetId = process.env.SPREADSHEET_ID;
  }

  getSpreadsheetId() {
    if (!this.spreadsheetId) {
      this.spreadsheetId = process.env.SPREADSHEET_ID;
    }
    return this.spreadsheetId;
  }

  /**
   * Membaca baris dari sheet tertentu (menggunakan cache lokal).
   * @param {string} sheetName - Nama Sheet
   * @param {string} [rangeStr='A1:ZZ'] - Range sel pembacaan
   * @returns {Promise<Array<Array<any>>>} Matrix baris data
   */
  async readRows(sheetName, rangeStr = 'A1:ZZ') {
    const spreadsheetId = this.getSpreadsheetId();
    if (!spreadsheetId || spreadsheetId === 'YOUR_GOOGLE_SPREADSHEET_ID_HERE') {
      throw new Error("Spreadsheet ID belum dikonfigurasi di file .env");
    }

    const cacheKey = `${sheetName}_${rangeStr}`;
    const cachedData = sheetCache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    try {
      const sheets = getSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!${rangeStr}`,
      });

      const values = response.data.values || [];
      sheetCache.set(cacheKey, values);
      return values;
    } catch (error) {
      if (error.message && error.message.includes('Unable to parse range')) {
        console.warn(`[SheetsService WARNING] Sheet '${sheetName}' tidak ditemukan atau kosong. Mengembalikan [] sesuai perilaku GAS.`);
        return [];
      }
      console.error(`[SheetsService] Failed to read rows from ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Membaca data sheet dan memetakannya menjadi Array of Objects menggunakan baris 1 sebagai header.
   * @param {string} sheetName - Nama Sheet
   * @returns {Promise<Array<object>>} List data objek baris
   */
  async readSheetObjects(sheetName) {
    const rows = await this.readRows(sheetName);
    if (rows.length === 0) return [];
    
    const headers = rows[0];
    const objects = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      headers.forEach((header, index) => {
        if (header) {
          obj[header] = row[index] !== undefined ? row[index] : "";
        }
      });
      objects.push(obj);
    }
    return objects;
  }

  /**
   * Menambahkan satu baris data ke sheet (idempoten).
   * @param {string} sheetName - Nama Sheet
   * @param {Array<any>} rowValues - Nilai kolom baris baru
   */
  async appendRow(sheetName, rowValues) {
    const spreadsheetId = this.getSpreadsheetId();
    try {
      const sheets = getSheetsClient();
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowValues],
        },
      });
      // Flush cache untuk sheet ini karena data telah berubah
      this.clearCache(sheetName);
    } catch (error) {
      console.error(`[SheetsService] Failed to append row to ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Mengubah nilai sel tunggal (1-indexed).
   * @param {string} sheetName - Nama Sheet
   * @param {number} row - Baris ke (1-indexed)
   * @param {number} col - Kolom ke (1-indexed)
   * @param {any} value - Nilai baru
   */
  async updateCell(sheetName, row, col, value) {
    const colLetter = getColumnLetter(col);
    const range = `${colLetter}${row}`;
    await this.updateRange(sheetName, range, [[value]]);
  }

  /**
   * Mengubah nilai pada rentang range tertentu.
   * @param {string} sheetName - Nama Sheet
   * @param {string} rangeStr - Range target (contoh: 'A2:C2', 'B5')
   * @param {Array<Array<any>>} values - Matrix nilai baru
   */
  async updateRange(sheetName, rangeStr, values) {
    const spreadsheetId = this.getSpreadsheetId();
    try {
      const sheets = getSheetsClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${rangeStr}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
      this.clearCache(sheetName);
    } catch (error) {
      console.error(`[SheetsService] Failed to update range ${rangeStr} in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Menghapus baris tertentu (1-indexed).
   * @param {string} sheetName - Nama Sheet
   * @param {number} rowIndex - Baris ke (1-indexed)
   */
  async deleteRow(sheetName, rowIndex) {
    const spreadsheetId = this.getSpreadsheetId();
    try {
      const sheets = getSheetsClient();
      
      // 1. Dapatkan sheet ID dari sheetName
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) throw new Error(`Sheet '${sheetName}' tidak ditemukan.`);
      const sheetId = sheet.properties.sheetId;

      // 2. Kirim request batchUpdate deleteDimension
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIndex - 1, // 0-indexed
                  endIndex: rowIndex // exclusive
                }
              }
            }
          ]
        }
      });

      this.clearCache(sheetName);
    } catch (error) {
      console.error(`[SheetsService] Failed to delete row ${rowIndex} in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Membersihkan cache memori jangka pendek sheet tertentu.
   */
  clearCache(sheetName) {
    const keys = sheetCache.keys();
    keys.forEach(key => {
      if (key.startsWith(sheetName)) {
        sheetCache.del(key);
      }
    });
  }
}

export const sheetsService = new SheetsService();
export default sheetsService;
