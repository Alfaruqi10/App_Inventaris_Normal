# Requirements Document

## Introduction

Fitur Sales Ledger menyediakan pencatatan penjualan terpusat untuk toko Shopee ANSLA. Data mentah dari sheet `ShopeeOrders` diproses secara otomatis menjadi entri ledger terstruktur di sheet `SalesLedger`, yang kemudian ditampilkan di halaman Laporan Penjualan dengan KPI, filter multidimensi, ekspor data, dan integrasi AI Assistant.

Scope Phase 1 mencakup: pembuatan ledger otomatis, halaman laporan, KPI dashboard, ekspor, dan integrasi AI. Fitur HPP, margin, laba, dan akuntansi **tidak termasuk** di Phase 1.

---

## Glossary

- **Sales_Ledger**: Sheet Google Sheets bernama `SalesLedger` yang menyimpan entri penjualan terstruktur, satu baris per item per pesanan.
- **Ledger_System**: Komponen Google Apps Script yang bertanggung jawab membuat, membaca, dan memperbarui `Sales_Ledger`.
- **Laporan_UI**: Halaman `#sales-ledger` di `index.html` yang menampilkan data dari `Sales_Ledger`.
- **AI_Assistant**: Sistem asisten berbasis AI yang membaca data dari `window.salesLedgerData`.
- **Order_SN**: Nomor pesanan unik Shopee (string).
- **Item_ID**: ID item produk Shopee (string).
- **Model_ID**: ID variasi/model produk Shopee (string).
- **Primary_Key**: Kombinasi unik `Order_SN + Item_ID + Model_ID` yang mengidentifikasi satu baris di `Sales_Ledger`.
- **Status_Shopee**: Status pesanan yang dikirim langsung oleh Shopee API (`UNPAID`, `READY_TO_SHIP`, dll.).
- **Status_Ledger**: Status internal yang dipetakan dari `Status_Shopee` (`Pending`, `Selesai`, `Dibatalkan`, `Retur`).
- **Estimasi_Pendapatan**: `Subtotal - Voucher - Biaya Admin - Biaya Layanan` (belum dikurangi HPP).
- **Sync**: Proses sinkronisasi data pesanan dari Shopee API ke `ShopeeOrders`, dilanjutkan pembaruan `Sales_Ledger`.
- **KPI**: Key Performance Indicator — metrik ringkasan yang ditampilkan di atas halaman laporan.
- **Detail_Drawer**: Panel sisi kanan yang muncul saat user mengklik ikon mata di tabel untuk melihat detail satu pesanan.

---

## Requirements

### Requirement 1: Pembuatan dan Pembaruan Sales Ledger Otomatis

**User Story:** Sebagai admin, saya ingin data pesanan Shopee secara otomatis dicatat ke Sales Ledger setiap kali sync dilakukan, agar saya tidak perlu input manual dan data selalu up-to-date.

#### Acceptance Criteria

1. WHEN fungsi `handleSyncShopeeOrders` berhasil dijalankan, THE `Ledger_System` SHALL memanggil fungsi `updateSalesLedger()` secara otomatis setelah sync selesai.

2. WHEN `updateSalesLedger()` dijalankan, THE `Ledger_System` SHALL membuat baris baru di `Sales_Ledger` untuk setiap `Primary_Key` yang belum ada di sheet tersebut.

3. WHEN `updateSalesLedger()` dijalankan untuk entri yang sudah ada, THE `Ledger_System` SHALL memperbarui kolom `Status_Shopee`, `Status_Ledger`, `Deduction Status`, `Mapping Status`, `SKU Inventaris`, `Sync Time`, dan `Last Modified` tanpa mengubah `Ledger ID`, `Tanggal Order`, `Buyer Username`, atau `Buyer Name`.

4. WHEN `updateSalesLedger()` memetakan `Status_Shopee` ke `Status_Ledger`, THE `Ledger_System` SHALL menggunakan tabel pemetaan berikut: `UNPAID`, `READY_TO_SHIP`, `SHIPPED`, `TO_CONFIRM_RECEIVE` → `Pending`; `COMPLETED` → `Selesai`; `CANCELLED`, `IN_CANCEL` → `Dibatalkan`; `TO_RETURN`, `RETURNED` → `Retur`; status tidak dikenal → `Pending`.

5. WHEN `updateSalesLedger()` menulis baris baru, THE `Ledger_System` SHALL menghitung dan menyimpan: `Subtotal` = `Qty × Harga Produk` dan `Estimasi_Pendapatan` = `Subtotal - Voucher - Biaya Admin - Biaya Layanan`.

6. WHEN sheet `Sales_Ledger` belum ada, THE `Ledger_System` SHALL membuat sheet tersebut secara otomatis dengan 27 kolom header sesuai schema yang didefinisikan sebelum melakukan operasi tulis.

7. THE `Ledger_System` SHALL menggunakan `LockService.getScriptLock()` selama operasi tulis di `updateSalesLedger()` untuk mencegah race condition.

8. WHEN `updateSalesLedger()` selesai, THE `Ledger_System` SHALL mengembalikan objek `{ newCount, updatedCount }` yang mencerminkan jumlah baris yang diinsert dan diupdate.

---

### Requirement 2: Halaman Laporan Penjualan

**User Story:** Sebagai admin, saya ingin melihat laporan penjualan lengkap dengan filter dan pencarian, agar saya bisa menganalisis performa toko secara efisien.

#### Acceptance Criteria

1. WHEN user membuka halaman "Laporan Penjualan", THE `Laporan_UI` SHALL menampilkan 5 KPI card: Total Omzet (SUM Subtotal status Selesai), Total Pesanan (COUNT DISTINCT `Order_SN`), Produk Terjual (SUM Qty), Rata-rata Order (omzet dibagi pesanan selesai), dan jumlah Retur & Pembatalan.

2. WHEN user menerapkan filter periode, status Shopee, status ledger, atau memasukkan teks di kotak pencarian, THE `Laporan_UI` SHALL memperbarui tabel dan KPI hanya menampilkan data yang sesuai dengan semua kriteria filter yang diterapkan.

3. THE `Laporan_UI` SHALL menampilkan tabel dengan kolom: Order SN, Tanggal Order, Buyer, Nama Produk, Variasi, Qty, Harga, Subtotal, Status Shopee (badge berwarna), Status Ledger (badge berwarna), Deduction Status, dan kolom Aksi.

4. WHEN user mengklik ikon mata pada baris tabel, THE `Laporan_UI` SHALL menampilkan `Detail_Drawer` di sisi kanan layar berisi informasi lengkap pesanan termasuk breakdown finansial (subtotal, voucher, biaya admin, biaya layanan, `Estimasi_Pendapatan`).

5. THE `Laporan_UI` SHALL menampilkan badge berwarna untuk `Status_Ledger` dengan skema warna: `Pending` menggunakan `ds-badge-amber`, `Selesai` menggunakan `ds-badge-green`, `Dibatalkan` menggunakan `ds-badge-red`, `Retur` menggunakan `ds-badge-purple`.

6. WHILE data sedang dimuat dari server, THE `Laporan_UI` SHALL menampilkan skeleton loading (`.ds-skel`) pada area tabel untuk memberikan umpan balik visual kepada user.

7. IF tidak ada data yang sesuai dengan filter aktif, THEN THE `Laporan_UI` SHALL menampilkan empty state (`.ds-empty`) dengan pesan yang sesuai di area tabel.

8. THE `Laporan_UI` SHALL menerapkan paginasi server-side dengan opsi 25, 50, atau 100 baris per halaman, menampilkan total hasil dan navigasi halaman.

9. THE `Laporan_UI` SHALL menyediakan tombol "Sync" yang saat diklik memanggil endpoint `syncShopeeOrders` dan memperbarui tampilan setelah sync selesai.

10. THE `Laporan_UI` SHALL menyediakan filter panel yang dapat dilipat (collapse) di perangkat mobile untuk menghemat ruang layar, menggunakan pola `.ds-filter-panel` yang sudah ada di design system.

---

### Requirement 3: Ekspor Data

**User Story:** Sebagai admin, saya ingin mengekspor data laporan penjualan ke Excel, CSV, atau mencetak laporan, agar saya bisa berbagi data atau mengarsipkannya.

#### Acceptance Criteria

1. WHEN user mengklik tombol "Export Excel", THE `Laporan_UI` SHALL mengambil seluruh data sesuai filter aktif tanpa batasan halaman, mengonversinya ke format `.xlsx` menggunakan SheetJS, dan memicu unduhan otomatis dengan nama file `laporan-penjualan-YYYY-MM-DD.xlsx`.

2. WHEN user mengklik tombol "Export CSV", THE `Laporan_UI` SHALL mengambil seluruh data sesuai filter aktif, mengonversinya ke format CSV sesuai standar RFC 4180, dan memicu unduhan otomatis dengan nama file `laporan-penjualan-YYYY-MM-DD.csv`.

3. WHEN user mengklik tombol "Print", THE `Laporan_UI` SHALL merender tabel ke elemen `#print-area` kemudian memanggil `window.print()`.

4. WHERE data yang diekspor mengandung karakter koma, tanda kutip, atau newline, THE `Laporan_UI` SHALL membungkus nilai tersebut dalam tanda kutip ganda dan melakukan escaping tanda kutip ganda sesuai standar RFC 4180.

---

### Requirement 4: Navigasi Sidebar

**User Story:** Sebagai pengguna aplikasi, saya ingin mengakses halaman Laporan Penjualan dari sidebar navigasi, agar saya bisa berpindah halaman dengan cepat.

#### Acceptance Criteria

1. THE `Laporan_UI` SHALL menampilkan item navigasi "Laporan Penjualan" di sidebar `#app-sidebar` dengan ikon SVG yang sesuai, diposisikan setelah item navigasi Shopee Orders.

2. WHEN user mengklik item "Laporan Penjualan" di sidebar, THE `Laporan_UI` SHALL menampilkan section `#sales-ledger` dan menyembunyikan section aktif sebelumnya menggunakan pola `showSection()` yang sudah ada.

3. WHERE sidebar dalam kondisi collapsed, THE `Laporan_UI` SHALL tetap menampilkan ikon item "Laporan Penjualan" tanpa label teks, sesuai perilaku sidebar yang sudah ada menggunakan class `.nav-label`.

---

### Requirement 5: Integrasi AI Assistant

**User Story:** Sebagai pengguna AI Assistant, saya ingin AI dapat menjawab pertanyaan tentang performa penjualan berdasarkan data Sales Ledger, agar saya mendapat insight yang akurat.

#### Acceptance Criteria

1. WHEN user membuka halaman "Laporan Penjualan", THE `Laporan_UI` SHALL memuat data `Sales_Ledger` ke `window.salesLedgerData` (maksimal 500 baris terbaru) menggunakan endpoint `getSalesLedgerData`.

2. WHEN `AI_Assistant` membangun context sebelum mengirim pertanyaan, THE `AI_Assistant` SHALL membaca ringkasan penjualan dari `window.salesLedgerData` menggunakan fungsi `getSalesSummary()` dari `AITools.js`.

3. WHEN `AI_Assistant` membangun context, THE `AI_Assistant` SHALL menyertakan field `penjualan` yang mencakup: total omzet, total pesanan selesai, total pending, total retur, total dibatalkan, estimasi pendapatan, dan daftar produk terlaris berdasarkan subtotal.

4. THE `AI_Assistant` SHALL mengekspor fungsi `getSalesSummary()` dan `topSellingProducts()` dari `ai/AITools.js` yang membaca dari `window.salesLedgerData`.

5. WHEN `AI_Assistant` menghasilkan teks context menggunakan `contextToText()`, THE `AI_Assistant` SHALL menyertakan section bertajuk "PENJUALAN (SALES LEDGER)" dengan format yang konsisten dengan section lainnya.

---

### Requirement 6: Endpoint Backend

**User Story:** Sebagai sistem, saya membutuhkan endpoint GAS yang mendukung operasi baca `Sales_Ledger` dengan filter dan paginasi agar frontend dan AI dapat mengambil data secara efisien.

#### Acceptance Criteria

1. WHEN frontend mengirim `GET ?action=getSalesLedgerPaged` dengan parameter filter, THE `Ledger_System` SHALL mengembalikan array ledger yang sudah difilter dan dipaginasi beserta objek KPI dalam satu response.

2. WHEN frontend mengirim `GET ?action=getSalesLedgerKPI` dengan parameter periode opsional, THE `Ledger_System` SHALL mengembalikan objek KPI yang mencakup: `totalOmzet`, `totalPesanan`, `totalQty`, `averageOrder`, `totalRetur`, `totalDibatalkan`, `totalSelesai`, `totalPending`, dan `estimasiPendapatan`.

3. WHEN frontend mengirim `GET ?action=getSalesLedgerDetail&ledgerId=xxx`, THE `Ledger_System` SHALL mengembalikan semua 27 field untuk ledger tersebut beserta `financial_breakdown` dan `buyer_avatar_initial`.

4. WHEN frontend mengirim `GET ?action=getSalesLedgerData`, THE `Ledger_System` SHALL mengembalikan maksimal 500 baris terbaru dari `Sales_Ledger` diurutkan berdasarkan `Tanggal Order` descending, beserta objek `summary` yang berisi `totalBaris`, `diambil`, dan `lastSync`.

5. IF ledger dengan `ledgerId` yang diminta tidak ditemukan di `Sales_Ledger`, THEN THE `Ledger_System` SHALL mengembalikan `{ status: "error", message: "Ledger tidak ditemukan." }`.

6. WHERE parameter `dateFrom` atau `dateTo` diberikan dalam format `YYYY-MM-DD`, THE `Ledger_System` SHALL memfilter baris berdasarkan kolom `Tanggal Order` secara inklusif pada kedua batas (tanggal mulai ≤ Tanggal Order ≤ tanggal akhir).
