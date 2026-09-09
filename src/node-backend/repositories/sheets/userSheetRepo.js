import { UserRepository } from '../userRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class UserSheetRepository extends UserRepository {
  constructor() {
    super();
    this.sheetName = "Users";
  }

  /**
   * Mengambil semua kolom header dari sheet Users.
   */
  async getHeaders() {
    const rows = await sheetsService.readRows(this.sheetName, 'A1:ZZ1');
    if (rows.length === 0 || rows[0].length === 0) {
      // Default fallback headers jika kosong
      return ["Email", "Nama", "Password", "Created At", "Role", "Aktif"];
    }
    return rows[0];
  }

  /**
   * Mencari baris pengguna berdasarkan email.
   * Mengembalikan objek user dan baris indeksnya (1-indexed).
   */
  async findByEmail(email) {
    const emailLower = String(email).trim().toLowerCase();
    const rows = await sheetsService.readRows(this.sheetName);
    if (rows.length <= 1) return null;

    const headers = rows[0];
    const colEmail = headers.indexOf("Email");
    const colNama = headers.indexOf("Nama");
    const colPass = headers.indexOf("Password");
    const colCreated = headers.indexOf("Created At");
    const colRole = headers.indexOf("Role");
    const colAktif = headers.indexOf("Aktif");

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowEmail = String(row[colEmail] || '').trim().toLowerCase();

      if (rowEmail === emailLower) {
        return {
          rowIndex: i + 1, // 1-indexed
          email: rowEmail,
          nama: String(row[colNama] || ''),
          password: String(row[colPass] || ''),
          createdAt: row[colCreated] || '',
          role: colRole >= 0 ? String(row[colRole] || 'Kasir') : 'Kasir',
          aktif: colAktif >= 0 ? String(row[colAktif] || 'ya') : 'ya'
        };
      }
    }
    return null;
  }

  /**
   * Membuat user baru.
   */
  async createUser(userObj) {
    const headers = await this.getHeaders();
    
    // Pastikan header Role dan Aktif ada
    const updatedHeaders = [...headers];
    let colRole = updatedHeaders.indexOf("Role");
    if (colRole === -1) {
      await sheetsService.updateCell(this.sheetName, 1, updatedHeaders.length + 1, "Role");
      updatedHeaders.push("Role");
      colRole = updatedHeaders.indexOf("Role");
    }
    
    let colAktif = updatedHeaders.indexOf("Aktif");
    if (colAktif === -1) {
      await sheetsService.updateCell(this.sheetName, 1, updatedHeaders.length + 1, "Aktif");
      updatedHeaders.push("Aktif");
      colAktif = updatedHeaders.indexOf("Aktif");
    }

    // Bangun baris berdasarkan urutan header
    const newRow = new Array(updatedHeaders.length).fill("");
    newRow[updatedHeaders.indexOf("Email")] = userObj.email;
    newRow[updatedHeaders.indexOf("Nama")] = userObj.nama;
    newRow[updatedHeaders.indexOf("Password")] = userObj.password;
    newRow[updatedHeaders.indexOf("Created At")] = userObj.createdAt || getJakartaTimeString();
    newRow[colRole] = userObj.role || "Kasir";
    newRow[colAktif] = "ya"; // default aktif saat registrasi

    await sheetsService.appendRow(this.sheetName, newRow);
    return userObj;
  }

  /**
   * Memperbarui data nama/role pengguna.
   */
  async updateUser(email, updates) {
    const user = await this.findByEmail(email);
    if (!user) return false;

    const headers = await this.getHeaders();
    
    if (updates.nama !== undefined) {
      const colNama = headers.indexOf("Nama") + 1;
      if (colNama > 0) {
        await sheetsService.updateCell(this.sheetName, user.rowIndex, colNama, updates.nama);
      }
    }

    if (updates.role !== undefined) {
      let colRole = headers.indexOf("Role") + 1;
      if (colRole === 0) {
        // Jika kolom tidak ada, buat baru
        const lastCol = headers.length + 1;
        await sheetsService.updateCell(this.sheetName, 1, lastCol, "Role");
        colRole = lastCol;
      }
      await sheetsService.updateCell(this.sheetName, user.rowIndex, colRole, updates.role);
    }

    return true;
  }

  /**
   * Memperbarui sandi pengguna.
   */
  async updatePassword(email, newHashedPassword) {
    const user = await this.findByEmail(email);
    if (!user) return false;

    const headers = await this.getHeaders();
    const colPass = headers.indexOf("Password") + 1;
    if (colPass > 0) {
      await sheetsService.updateCell(this.sheetName, user.rowIndex, colPass, newHashedPassword);
      return true;
    }
    return false;
  }

  /**
   * Mengaktifkan / Menghapus status aktif pengguna.
   */
  async setUserStatus(email, aktifState) {
    const user = await this.findByEmail(email);
    if (!user) return false;

    const headers = await this.getHeaders();
    let colAktif = headers.indexOf("Aktif") + 1;
    if (colAktif === 0) {
      // Jika kolom tidak ada, buat baru
      const lastCol = headers.length + 1;
      await sheetsService.updateCell(this.sheetName, 1, lastCol, "Aktif");
      colAktif = lastCol;
    }

    await sheetsService.updateCell(this.sheetName, user.rowIndex, colAktif, aktifState ? "ya" : "tidak");
    return true;
  }

  /**
   * Mendapatkan semua pengguna.
   */
  async getAllUsers() {
    const rows = await sheetsService.readRows(this.sheetName);
    if (rows.length <= 1) return [];

    const headers = rows[0];
    const colEmail = headers.indexOf("Email");
    const colNama = headers.indexOf("Nama");
    const colCreated = headers.indexOf("Created At");
    const colRole = headers.indexOf("Role");
    const colAktif = headers.indexOf("Aktif");

    const list = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[colEmail]) continue;
      
      list.push({
        email: String(row[colEmail] || '').trim(),
        nama: String(row[colNama] || '').trim(),
        role: colRole >= 0 ? String(row[colRole] || 'Kasir').trim() : 'Kasir',
        createdAt: row[colCreated] || '',
        aktif: colAktif >= 0 ? String(row[colAktif] || 'ya').trim().toLowerCase() !== 'tidak' : true
      });
    }
    return list;
  }
}
