import { MasterBarangRepository } from '../masterBarangRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class MasterBarangSheetRepository extends MasterBarangRepository {
  constructor() {
    super();
    this.sheetName = "MasterBarang";
    this.transactionSheetName = "Transaksi";
  }

  /**
   * Mengambil semua kolom header dari sheet MasterBarang.
   */
  async getHeaders() {
    const rows = await sheetsService.readRows(this.sheetName, 'A1:ZZ1');
    if (rows.length === 0 || rows[0].length === 0) {
      return ["Kode Barang", "Nama Barang", "Warna", "Ukuran", "Tahun Perolehan", "Stok Saat Ini", "Kategori", "Status", "Updated At"];
    }
    return rows[0];
  }

  /**
   * Mengambil semua produk dari sheet.
   */
  async getAllProducts() {
    return await sheetsService.readSheetObjects(this.sheetName);
  }

  /**
   * Mencari baris produk berdasarkan varian (Kode Barang, Warna, Ukuran).
   * Exact match, case-insensitive.
   */
  async findByVariant(kode, warna, ukuran) {
    const rows = await sheetsService.readRows(this.sheetName);
    if (rows.length <= 1) return null;

    const headers = rows[0];
    const colKode = 0; // Kolom A / Kode Barang
    const colWarna = headers.indexOf("Warna");
    const colUkuran = headers.indexOf("Ukuran");
    const colNama = headers.indexOf("Nama Barang");
    const colStok = headers.indexOf("Stok Saat Ini");
    const colKategori = headers.indexOf("Kategori");
    const colStatus = headers.indexOf("Status");

    // Normalisasi input
    const norm = v => String(v || '').trim().toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowKode = norm(row[colKode] || '');
      
      // Jika kolom Warna/Ukuran tidak ada, bandingkan hanya kode
      const matchWarna = colWarna >= 0 ? (norm(row[colWarna] || '') === norm(warna)) : true;
      const matchUkuran = colUkuran >= 0 ? (norm(row[colUkuran] || '') === norm(ukuran)) : true;

      if (rowKode === norm(kode) && matchWarna && matchUkuran) {
        return {
          rowIndex: i + 1, // 1-indexed
          kode: String(row[colKode] || ''),
          nama: colNama >= 0 ? String(row[colNama] || '') : '',
          warna: colWarna >= 0 ? String(row[colWarna] || '') : '',
          ukuran: colUkuran >= 0 ? String(row[colUkuran] || '') : '',
          stok: colStok >= 0 ? Number(row[colStok] || 0) : 0,
          kategori: colKategori >= 0 ? String(row[colKategori] || '') : '',
          status: colStatus >= 0 ? String(row[colStatus] || 'Aktif') : 'Aktif'
        };
      }
    }
    return null;
  }

  /**
   * Mengubah properti tertentu produk pada baris target.
   */
  async updateProduct(rowIndex, updates) {
    const headers = await this.getHeaders();
    
    // Pastikan header "Status" dan "Updated At" ada
    const updatedHeaders = [...headers];
    
    const updatePromises = [];

    for (const [key, value] of Object.entries(updates)) {
      let colIdx = updatedHeaders.indexOf(key);
      if (colIdx === -1) {
        // Jika kolom tidak ada, tambahkan baru di sheet
        const lastCol = updatedHeaders.length + 1;
        await sheetsService.updateCell(this.sheetName, 1, lastCol, key);
        updatedHeaders.push(key);
        colIdx = updatedHeaders.indexOf(key);
      }
      updatePromises.push(sheetsService.updateCell(this.sheetName, rowIndex, colIdx + 1, value));
    }

    // Set "Updated At" stempel waktu
    let colUpdated = updatedHeaders.indexOf("Updated At");
    if (colUpdated === -1) {
      const lastCol = updatedHeaders.length + 1;
      await sheetsService.updateCell(this.sheetName, 1, lastCol, "Updated At");
      updatedHeaders.push("Updated At");
      colUpdated = updatedHeaders.indexOf("Updated At");
    }
    updatePromises.push(sheetsService.updateCell(this.sheetName, rowIndex, colUpdated + 1, getJakartaTimeString()));

    await Promise.all(updatePromises);
    return true;
  }

  /**
   * Menyetel status produk (Aktif / Nonaktif).
   */
  async toggleProductStatus(rowIndex, statusVal) {
    const headers = await this.getHeaders();
    let colStatus = headers.indexOf("Status") + 1;
    if (colStatus === 0) {
      const lastCol = headers.length + 1;
      await sheetsService.updateCell(this.sheetName, 1, lastCol, "Status");
      colStatus = lastCol;
    }
    await sheetsService.updateCell(this.sheetName, rowIndex, colStatus, statusVal);
    return true;
  }

  /**
   * Menghapus produk dari MasterBarang.
   */
  async deleteProduct(rowIndex) {
    await sheetsService.deleteRow(this.sheetName, rowIndex);
    return true;
  }

  /**
   * Menambahkan entri log perubahan ke sheet Transaksi.
   */
  async logTransaction(t) {
    // Pastikan kolom Transaksi selaras
    const transHeaders = await sheetsService.readRows(this.transactionSheetName, 'A1:ZZ1');
    if (transHeaders.length === 0 || transHeaders[0].length === 0) {
      // Jika Transaksi kosong, buat header default
      const defaultTransHdrs = [
        "Tanggal", "Jenis Transaksi", "Kode Barang", "Nama Barang", 
        "Warna", "Ukuran", "Tahun Perolehan", "Jumlah", 
        "Stok Akhir", "Tujuan Keluar", "Keterangan", "Petugas"
      ];
      await sheetsService.appendRow(this.transactionSheetName, defaultTransHdrs);
    }

    const row = [
      getJakartaTimeString(),
      t.jenis,
      t.kode,
      t.nama,
      t.warna || "",
      t.ukuran || "",
      t.tahun || "",
      t.jumlah || 0,
      t.stokAkhir || 0,
      t.tujuanKeluar || "",
      t.keterangan || "",
      t.petugas || t.petugasEmail || "Sistem"
    ];

    await sheetsService.appendRow(this.transactionSheetName, row);
  }
}
