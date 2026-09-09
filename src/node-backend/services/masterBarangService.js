export class MasterBarangService {
  /**
   * @param {MasterBarangRepository} masterBarangRepository
   */
  constructor(masterBarangRepository) {
    this.masterBarangRepo = masterBarangRepository;
  }

  /**
   * Mengambil semua produk dari sheet.
   */
  async getProducts() {
    const list = await this.masterBarangRepo.getAllProducts();
    return {
      status: "success",
      master: list
    };
  }

  /**
   * Edit produk (Hanya Admin).
   */
  async editProduct(data) {
    const callerRole = String(data.callerRole || '').trim();
    if (callerRole !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    const kode = String(data.kodeBarang || '').trim();
    const warnaLama = String(data.warnaLama !== undefined ? data.warnaLama : (data.warna || '')).trim();
    const ukuranLama = String(data.ukuranLama !== undefined ? data.ukuranLama : (data.ukuran || '')).trim();

    if (!kode) {
      return { status: "error", message: "Kode barang wajib diisi." };
    }

    const product = await this.masterBarangRepo.findByVariant(kode, warnaLama, ukuranLama);
    if (!product) {
      return { status: "error", message: "Produk tidak ditemukan." };
    }

    const updateMap = {
      "Kode Barang": String(data.kodeBaru || '').trim() || kode,
      "Nama Barang": String(data.namaBarang || '').trim(),
      "Warna":       String(data.warnaBaru || '').trim(),
      "Ukuran":      String(data.ukuranBaru || '').trim(),
      "Kategori":    String(data.kategori || '').trim()
    };

    const perubahan = [];
    const dbUpdates = {};

    // Bandingkan dan kumpulkan apa yang berubah
    if (updateMap["Kode Barang"] !== product.kode) {
      perubahan.push(`Kode Barang: ${product.kode} → ${updateMap["Kode Barang"]}`);
      dbUpdates["Kode Barang"] = updateMap["Kode Barang"];
    }

    if (updateMap["Nama Barang"] && updateMap["Nama Barang"] !== product.nama) {
      perubahan.push(`Nama Barang: ${product.nama} → ${updateMap["Nama Barang"]}`);
      dbUpdates["Nama Barang"] = updateMap["Nama Barang"];
    }

    if (updateMap["Warna"] && updateMap["Warna"] !== product.warna) {
      perubahan.push(`Warna: ${product.warna} → ${updateMap["Warna"]}`);
      dbUpdates["Warna"] = updateMap["Warna"];
    }

    if (updateMap["Ukuran"] && updateMap["Ukuran"] !== product.ukuran) {
      perubahan.push(`Ukuran: ${product.ukuran} → ${updateMap["Ukuran"]}`);
      dbUpdates["Ukuran"] = updateMap["Ukuran"];
    }

    if (updateMap["Kategori"] && updateMap["Kategori"] !== product.kategori) {
      perubahan.push(`Kategori: ${product.kategori} → ${updateMap["Kategori"]}`);
      dbUpdates["Kategori"] = updateMap["Kategori"];
    }

    if (perubahan.length > 0) {
      // Tulis perubahan ke Google Sheet
      await this.masterBarangRepo.updateProduct(product.rowIndex, dbUpdates);

      // Log transaksi ke sheet Transaksi
      await this.masterBarangRepo.logTransaction({
        jenis: "EDIT",
        kode: updateMap["Kode Barang"],
        nama: updateMap["Nama Barang"] || product.nama,
        warna: updateMap["Warna"] || warnaLama,
        ukuran: updateMap["Ukuran"] || ukuranLama,
        tahun: "",
        jumlah: 0,
        stokAkhir: product.stok,
        tujuanKeluar: "Edit Produk",
        keterangan: perubahan.join(" | "),
        petugas: data.petugas,
        petugasEmail: data.petugasEmail
      });
    }

    return {
      status: "success",
      message: perubahan.length > 0
        ? `Produk berhasil diperbarui. ${perubahan.length} field diubah.`
        : "Tidak ada perubahan."
    };
  }

  /**
   * Aktifkan / Nonaktifkan status produk (Hanya Admin).
   */
  async toggleProductStatus(data) {
    const callerRole = String(data.callerRole || '').trim();
    if (callerRole !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    const kode = String(data.kodeBarang || '').trim();
    const warna = String(data.warna || '').trim();
    const ukuran = String(data.ukuran || '').trim();
    const aktif = data.aktif !== false;

    if (!kode) {
      return { status: "error", message: "Kode barang wajib diisi." };
    }

    const product = await this.masterBarangRepo.findByVariant(kode, warna, ukuran);
    if (!product) {
      return { status: "error", message: "Produk tidak ditemukan." };
    }

    const statusVal = aktif ? "Aktif" : "Nonaktif";
    await this.masterBarangRepo.toggleProductStatus(product.rowIndex, statusVal);

    return {
      status: "success",
      message: aktif ? "Produk diaktifkan." : "Produk dinonaktifkan."
    };
  }

  /**
   * Hapus produk secara permanen (Hanya Admin).
   */
  async deleteProduct(data) {
    const callerRole = String(data.callerRole || '').trim();
    if (callerRole !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    const kode = String(data.kodeBarang || '').trim();
    const warna = String(data.warna || '').trim();
    const ukuran = String(data.ukuran || '').trim();

    if (!kode) {
      return { status: "error", message: "Kode barang wajib diisi." };
    }

    const product = await this.masterBarangRepo.findByVariant(kode, warna, ukuran);
    if (!product) {
      return { status: "error", message: "Produk tidak ditemukan." };
    }

    // Hapus dari sheet MasterBarang
    await this.masterBarangRepo.deleteProduct(product.rowIndex);

    // Log transaksi hapus ke sheet Transaksi
    await this.masterBarangRepo.logTransaction({
      jenis: "HAPUS",
      kode: kode,
      nama: product.nama,
      warna: warna,
      ukuran: ukuran,
      tahun: "",
      jumlah: 0,
      stokAkhir: product.stok,
      tujuanKeluar: "Hapus Produk",
      keterangan: `Produk dihapus permanen. Stok terakhir: ${product.stok}`,
      petugas: data.petugas,
      petugasEmail: data.petugasEmail
    });

    return {
      status: "success",
      message: "Produk berhasil dihapus."
    };
  }
}
