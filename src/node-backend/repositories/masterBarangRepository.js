/**
 * MasterBarangRepository Interface
 * Kontrak untuk operasi data produk/barang (MasterBarang).
 */
export class MasterBarangRepository {
  async getAllProducts() { throw new Error("Method getAllProducts() must be implemented."); }
  async findByVariant(kode, warna, ukuran) { throw new Error("Method findByVariant() must be implemented."); }
  async updateProduct(rowIndex, updates) { throw new Error("Method updateProduct() must be implemented."); }
  async toggleProductStatus(rowIndex, status) { throw new Error("Method toggleProductStatus() must be implemented."); }
  async deleteProduct(rowIndex) { throw new Error("Method deleteProduct() must be implemented."); }
  async logTransaction(transactionData) { throw new Error("Method logTransaction() must be implemented."); }
}
