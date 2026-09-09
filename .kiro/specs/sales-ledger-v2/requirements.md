# Requirements Document

## Introduction

Revisi Laporan Penjualan (Sales Ledger v2) bertujuan mengganti sumber data keuangan yang sebelumnya hanya berasal dari `ShopeeOrders` dengan data akurat dari endpoint `v2.payment.get_escrow_detail` Shopee Payment API. Revisi ini mencakup migrasi schema `SalesLedger`, integrasi Payment API, pembaruan tampilan UI (KPI, tabel, detail drawer), serta penambahan tombol aksi `Refresh Finance` dan `Resync Finance`.

Fitur yang **tidak** termasuk dalam revisi ini: perubahan pada alur Approval Deduction, Mapping Produk, AI Assistant, atau halaman lain di luar Laporan Penjualan.

## Glossary

- **SalesLedger**: Sheet Google Sheets yang menyimpan data penjualan terstruktur per baris pesanan.
- **Payment API**: Endpoint Shopee `v2.payment.get_escrow_detail` yang mengembalikan rincian finansial akurat sebuah pesanan.
- **Escrow Amount**: Jumlah dana bersih yang akan diterima penjual setelah semua potongan, dikembalikan oleh Payment API.
- **Net Income**: Nilai pendapatan bersih yang dihitung dari Escrow Amount dikurangi penyesuaian internal.
- **Refresh Finance**: Aksi yang mengambil ulang data Payment API untuk satu atau beberapa pesanan yang dipilih.
- **Resync Finance**: Aksi yang mencari semua pesanan COMPLETED/TO_CONFIRM_RECEIVE di SalesLedger yang belum memiliki data Payment API, lalu mengambil dan menyimpan datanya.
- **Settlement Status**: Status penyelesaian dana escrow (misalnya: `RELEASED`, `IN_ESCROW`, `BUYER_DUE`).
- **System**: Sistem Inventaris ANSLA yang terdiri dari backend Google Apps Script (`code.gs`) dan frontend (`index.html` + `sales-ledger.js`).
- **Backend**: Komponen Google Apps Script (`code.gs`) yang berjalan di Google Sheets.
- **Frontend**: Komponen antarmuka pengguna berbasis HTML/JS yang berjalan di browser.
- **Admin**: Pengguna yang memiliki akses penuh ke aplikasi, termasuk tombol Refresh Finance dan Resync Finance.
- **Drawer**: Panel detail yang muncul dari sisi kanan layar ketika Admin mengklik baris pesanan di tabel.
- **KPI Card**: Kartu ringkasan metrik utama yang ditampilkan di bagian atas halaman Laporan Penjualan.
- **Skeleton Loading**: Placeholder animasi yang menggantikan konten saat data sedang dimuat.

---

## Requirements

### Requirement 1: Migrasi Schema SalesLedger

**User Story:** Sebagai Admin, saya ingin sheet SalesLedger memiliki kolom-kolom data keuangan dari Payment API, sehingga laporan penjualan mencerminkan nilai yang akurat sesuai yang diterima dari Shopee.

#### Acceptance Criteria

1. THE System SHALL mempertahankan 27 kolom schema lama SalesLedger secara backward-compatible dan menambahkan kolom-kolom baru berikut:
   - `Original Price`, `Selling Price`, `Product Subtotal`
   - `Voucher Total`, `Shopee Voucher`, `Seller Voucher`, `Shop Voucher`
   - `Shipping Fee Buyer`, `Shipping Subsidy Shopee`, `Shipping Subsidy Seller`
   - `Commission Fee`, `Service Fee`, `Campaign Fee`, `Transaction Fee`
   - `Adjustment`, `Refund`, `Other Fee`
   - `Escrow Amount`, `Net Income`
   - `Settlement Status`
2. WHEN THE System menjalankan `ensureSalesLedgerSheet()`, THE System SHALL membuat atau memperbarui sheet `SalesLedger` agar memiliki header sesuai schema baru tanpa menghapus data yang sudah ada.
3. IF header SalesLedger tidak sesuai schema baru dan tidak dapat dimigrasi, THEN THE System SHALL mencatat error ke log dan menghentikan operasi tanpa merusak data yang ada.
4. THE System SHALL menggunakan field `Order SN` + `Item ID` + `Model ID` sebagai primary key unik untuk setiap baris SalesLedger.
5. WHEN baris baru di-insert ke SalesLedger, THE System SHALL mengisi field `Ledger ID` dengan format `"SLv2_" + Date.now() + "_" + random(4char)`.

---

### Requirement 2: Integrasi Payment API — Fungsi `fetchPaymentEscrow()`

**User Story:** Sebagai Admin, saya ingin sistem dapat mengambil data keuangan akurat dari Shopee Payment API untuk setiap pesanan yang telah selesai, sehingga data finansial di laporan mencerminkan nilai escrow yang sesungguhnya.

#### Acceptance Criteria

1. THE Backend SHALL memiliki fungsi `fetchPaymentEscrow(orderSn)` yang memanggil endpoint `v2.payment.get_escrow_detail` dengan signature HMAC-SHA256 yang valid menggunakan helper `makeShopeeSignature()` dan `getValidAccessToken()` yang sudah ada.
2. WHEN `fetchPaymentEscrow(orderSn)` berhasil, THE Backend SHALL mengembalikan objek yang mengandung field: `original_price`, `selling_price`, `product_subtotal`, `voucher_amount`, `voucher_from_shopee`, `voucher_from_seller`, `coins`, `buyer_shopee_coins`, `shipping_fee`, `buyer_paid_shipping_fee`, `shopee_shipping_rebate`, `seller_return_refund`, `commission_fee`, `service_fee`, `seller_transaction_fee`, `seller_coin_cash_back`, `escrow_amount`, `settlement_status`, `items[]`, `income_details[]`.
3. IF `fetchPaymentEscrow(orderSn)` menerima respons error dari Shopee API (`json.error !== ""`), THEN THE Backend SHALL mengembalikan objek `{ success: false, error: json.error, message: json.message }` tanpa melempar exception.
4. IF `fetchPaymentEscrow(orderSn)` gagal karena koneksi jaringan atau timeout, THEN THE Backend SHALL mengembalikan objek `{ success: false, error: "network_error", message: pesan_error }` tanpa melempar exception.
5. THE Backend SHALL memanggil `fetchPaymentEscrow()` hanya pada kondisi berikut: (a) pesanan baru dengan status COMPLETED atau TO_CONFIRM_RECEIVE ditemukan saat sync, (b) Admin mengklik tombol Refresh Finance, atau (c) Admin mengklik tombol Resync Finance. THE Backend SHALL NOT memanggil Payment API saat frontend membuka halaman Laporan Penjualan.
6. WHEN `fetchPaymentEscrow(orderSn)` dipanggil untuk order dengan status selain COMPLETED atau TO_CONFIRM_RECEIVE, THE Backend SHALL mengembalikan `{ success: false, error: "invalid_status", message: "Order belum selesai" }` tanpa memanggil Payment API.

---

### Requirement 3: Revisi `updateSalesLedger()` dengan Payment API

**User Story:** Sebagai Admin, saya ingin proses sync pesanan secara otomatis mengambil data keuangan dari Payment API untuk pesanan yang baru selesai, sehingga data laporan selalu ter-update tanpa intervensi manual tambahan.

#### Acceptance Criteria

1. WHEN `updateSalesLedger()` memproses baris dari ShopeeOrders dengan status `COMPLETED` atau `TO_CONFIRM_RECEIVE` yang belum memiliki data Escrow Amount di SalesLedger, THE Backend SHALL memanggil `fetchPaymentEscrow(orderSn)` dan menyimpan hasilnya ke kolom-kolom finansial yang sesuai.
2. WHEN `fetchPaymentEscrow()` berhasil untuk sebuah pesanan, THE Backend SHALL mengisi field `Escrow Amount`, `Net Income`, `Settlement Status`, `Commission Fee`, `Service Fee`, `Campaign Fee`, `Transaction Fee`, `Shopee Voucher`, `Seller Voucher`, `Shipping Subsidy Shopee`, `Shipping Subsidy Seller`, `Adjustment`, `Refund`, dan `Other Fee` dari data respons API.
3. IF `fetchPaymentEscrow()` gagal untuk sebuah pesanan, THEN THE Backend SHALL tetap menyimpan baris SalesLedger dengan kolom finansial Payment API dikosongkan (`""`), dan mencatat kegagalan ke log tanpa menghentikan proses sync keseluruhan.
4. THE Backend SHALL memperbarui field `Last Sync` dan `Last Modified` setiap kali baris SalesLedger diperbarui.
5. THE Backend SHALL menggunakan `LockService.getScriptLock().waitLock(30000)` untuk mencegah race condition saat operasi tulis ke SalesLedger.
6. WHEN `updateSalesLedger()` selesai dijalankan, THE Backend SHALL mengembalikan objek `{ newCount, updatedCount, paymentFetched, paymentFailed }` yang mencatat jumlah operasi masing-masing.
7. THE Backend SHALL NOT memanggil `fetchPaymentEscrow()` untuk pesanan yang sudah memiliki nilai Escrow Amount di SalesLedger, kecuali dipanggil eksplisit melalui Refresh Finance atau Resync Finance.

---

### Requirement 4: Endpoint `handleResyncFinance()`

**User Story:** Sebagai Admin, saya ingin dapat mengambil data keuangan dari Payment API untuk semua pesanan COMPLETED yang belum memiliki data finansial, sehingga data laporan historis dapat dilengkapi sekaligus.

#### Acceptance Criteria

1. THE Backend SHALL memiliki fungsi `handleResyncFinance(data)` yang dapat dipanggil melalui `doPost` dengan `action: "resyncFinance"`.
2. WHEN `handleResyncFinance()` dipanggil, THE Backend SHALL mencari semua baris di SalesLedger dengan `Status Shopee` = `COMPLETED` atau `TO_CONFIRM_RECEIVE` yang memiliki field `Escrow Amount` kosong atau nol.
3. WHEN baris kandidat ditemukan, THE Backend SHALL memanggil `fetchPaymentEscrow(orderSn)` untuk setiap Order SN unik yang ditemukan.
4. THE Backend SHALL memproses maksimal 50 Order SN per pemanggilan `handleResyncFinance()` untuk mencegah timeout Google Apps Script (batas eksekusi 6 menit).
5. WHEN `handleResyncFinance()` selesai, THE Backend SHALL mengembalikan `{ status: "success", processed: N, success: M, failed: F, skipped: S }`.
6. IF semua pesanan di SalesLedger sudah memiliki data Escrow Amount, THEN THE Backend SHALL mengembalikan `{ status: "success", processed: 0, message: "Semua pesanan sudah memiliki data finance." }`.

---

### Requirement 5: Endpoint `handleRefreshFinance()`

**User Story:** Sebagai Admin, saya ingin dapat mengambil ulang data keuangan dari Payment API untuk pesanan tertentu yang sudah dipilih, sehingga data yang mungkin berubah (misalnya setelah dispute) dapat diperbarui secara selektif.

#### Acceptance Criteria

1. THE Backend SHALL memiliki fungsi `handleRefreshFinance(data)` yang dapat dipanggil melalui `doPost` dengan `action: "refreshFinance"` dan parameter `orderSns` berupa array Order SN.
2. WHEN `handleRefreshFinance()` dipanggil dengan array `orderSns` yang valid, THE Backend SHALL memanggil `fetchPaymentEscrow()` untuk setiap Order SN dalam array tersebut dan memperbarui baris SalesLedger yang bersesuaian.
3. IF `data.orderSns` tidak disertakan atau bukan array, THEN THE Backend SHALL mengembalikan `{ status: "error", message: "Parameter orderSns harus berupa array." }`.
4. THE Backend SHALL memproses maksimal 20 Order SN per pemanggilan `handleRefreshFinance()`.
5. WHEN `handleRefreshFinance()` selesai, THE Backend SHALL mengembalikan `{ status: "success", processed: N, success: M, failed: F }`.

---

### Requirement 6: Pendaftaran Endpoint Baru di `doPost`/`doGet`

**User Story:** Sebagai Admin, saya ingin semua endpoint backend baru terdaftar dengan benar agar frontend dapat memanggil fungsi-fungsi baru tanpa error routing.

#### Acceptance Criteria

1. THE Backend SHALL mendaftarkan `action: "resyncFinance"` di `doPost()` yang memanggil `handleResyncFinance(data)`.
2. THE Backend SHALL mendaftarkan `action: "refreshFinance"` di `doPost()` yang memanggil `handleRefreshFinance(data)`.
3. THE Backend SHALL mendaftarkan `action: "getSalesLedgerPagedV2"` di `doGet()` yang memanggil `handleGetSalesLedgerPagedV2(e.parameter)`.
4. THE Backend SHALL mendaftarkan `action: "getSalesLedgerKPIV2"` di `doGet()` yang memanggil `handleGetSalesLedgerKPIV2(e.parameter)`.
5. THE Backend SHALL mendaftarkan `action: "getSalesLedgerDetailV2"` di `doGet()` yang memanggil `handleGetSalesLedgerDetailV2(e.parameter)`.

---

### Requirement 7: KPI Dashboard v2

**User Story:** Sebagai Admin, saya ingin KPI dashboard menampilkan metrik keuangan yang akurat dari data Payment API, sehingga saya dapat melihat performa penjualan secara nyata sekaligus.

#### Acceptance Criteria

1. THE Frontend SHALL menampilkan 7 KPI card berikut pada halaman Laporan Penjualan:
   - **Total Omzet**: SUM `Product Subtotal` semua pesanan `Status Shopee = COMPLETED`
   - **Pendapatan Bersih**: SUM `Escrow Amount` semua pesanan `Status Shopee = COMPLETED`
   - **Total Pesanan**: COUNT baris unik berdasarkan `Order SN`
   - **Produk Terjual**: SUM `Qty`
   - **Voucher Shopee**: SUM `Shopee Voucher`
   - **Voucher Seller**: SUM `Seller Voucher`
   - **Total Fee**: SUM (`Commission Fee` + `Service Fee` + `Campaign Fee` + `Transaction Fee`)
2. WHEN data SalesLedger sedang dimuat, THE Frontend SHALL menampilkan Skeleton Loading (`.ds-skel`) pada setiap KPI card hingga data tersedia.
3. THE Frontend SHALL memformat semua nilai KPI yang berupa uang dalam format Rupiah (`Rp X.XXX.XXX`) menggunakan `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`.
4. WHEN filter tanggal aktif, THE Frontend SHALL menampilkan nilai KPI yang hanya mencakup pesanan dalam rentang tanggal tersebut.
5. THE Backend SHALL menghitung semua 7 nilai KPI dalam single-pass pada fungsi `handleGetSalesLedgerKPIV2()` tanpa iterasi ulang.

---

### Requirement 8: Tabel Penjualan v2

**User Story:** Sebagai Admin, saya ingin tabel penjualan menampilkan kolom-kolom data finansial dari Payment API, sehingga saya dapat melihat rincian biaya dan pendapatan langsung dari daftar pesanan.

#### Acceptance Criteria

1. THE Frontend SHALL menampilkan tabel dengan kolom-kolom berikut: Order SN, Tanggal, Buyer, Produk, Variasi, Qty, Harga Produk, Subtotal, Voucher, Admin Fee, Service Fee, Escrow, Pendapatan Bersih, Status Shopee, Settlement Status, Deduction Status, dan tombol Aksi.
2. WHEN tabel sedang memuat data, THE Frontend SHALL menampilkan minimal 4 baris Skeleton Loading (`.ds-skel`) pada setiap sel tabel.
3. WHEN tidak ada data yang memenuhi filter aktif, THE Frontend SHALL menampilkan empty state dengan teks: "Belum ada data penjualan. Silakan lakukan Sync Pesanan terlebih dahulu." menggunakan class `.ds-empty`.
4. THE Frontend SHALL menampilkan kolom `Settlement Status` dengan badge berwarna: hijau untuk `RELEASED`, kuning untuk `IN_ESCROW`, merah untuk `BUYER_DUE`, dan abu-abu untuk nilai lainnya.
5. WHEN Admin mengklik baris tabel, THE Frontend SHALL membuka Detail Drawer untuk pesanan yang bersangkutan.
6. THE Frontend SHALL mendukung paginasi server-side dengan pilihan 25, 50, dan 100 baris per halaman.
7. WHEN Admin mengubah filter atau melakukan pencarian, THE Frontend SHALL mereset tampilan ke halaman pertama dan memuat ulang data tabel.

---

### Requirement 9: Detail Drawer v2

**User Story:** Sebagai Admin, saya ingin melihat detail lengkap sebuah pesanan dalam panel samping yang terorganisir seperti tampilan Shopee Seller Centre, sehingga saya mendapat gambaran menyeluruh tentang setiap transaksi.

#### Acceptance Criteria

1. THE Frontend SHALL menampilkan Detail Drawer sebagai panel yang muncul dari sisi kanan layar tanpa berpindah halaman, menggunakan animasi slide-in CSS.
2. THE Detail Drawer SHALL menampilkan 7 seksi berikut secara berurutan:
   - **Seksi 1 — Informasi Pesanan**: Order SN, Buyer, Status Shopee, Status Ledger, Tanggal Order, Tanggal Update.
   - **Seksi 2 — Informasi Produk**: Nama Produk, Variasi, SKU Inventaris, Qty, Harga Produk, Original Price, Selling Price.
   - **Seksi 3 — Rincian Pembayaran**: Product Subtotal, Voucher Shopee, Voucher Seller, Shop Voucher, Total Voucher.
   - **Seksi 4 — Rincian Ongkir**: Ongkir Pembeli, Subsidi Ongkir Shopee, Subsidi Ongkir Seller.
   - **Seksi 5 — Biaya Marketplace**: Commission Fee, Service Fee, Campaign Fee, Transaction Fee.
   - **Seksi 6 — Penyesuaian**: Adjustment, Refund, Other Fee.
   - **Seksi 7 — Pendapatan**: Escrow Amount, Net Income, Settlement Status.
3. WHEN data drawer sedang dimuat, THE Frontend SHALL menampilkan Skeleton Loading pada setiap baris dalam drawer.
4. WHEN Admin mengklik tombol tutup atau overlay di luar drawer, THE Frontend SHALL menutup drawer dan menghapus overlay.
5. THE Detail Drawer SHALL menampilkan semua nilai uang dalam format Rupiah yang konsisten dengan KPI card.
6. IF data Payment API untuk pesanan tersebut belum tersedia (Escrow Amount kosong), THE Detail Drawer SHALL menampilkan teks "Data belum tersedia — klik Refresh Finance" pada Seksi 5, 6, dan 7.
7. THE Detail Drawer SHALL menampilkan tombol "Refresh Finance" di bagian header, yang ketika diklik memanggil `handleRefreshFinance` untuk Order SN pesanan yang sedang ditampilkan.

---

### Requirement 10: Tombol Refresh Finance dan Resync Finance

**User Story:** Sebagai Admin, saya ingin tombol aksi untuk mengambil ulang data keuangan dari Payment API, sehingga saya dapat memperbarui data yang mungkin belum lengkap tanpa harus melakukan sync ulang seluruh pesanan.

#### Acceptance Criteria

1. THE Frontend SHALL menampilkan tombol **Refresh Finance** di header halaman Laporan Penjualan, menggunakan ikon SVG (bukan emoji).
2. THE Frontend SHALL menampilkan tombol **Resync Finance** di header halaman Laporan Penjualan, menggunakan ikon SVG (bukan emoji).
3. WHEN Admin mengklik tombol Resync Finance, THE Frontend SHALL memanggil `POST action=resyncFinance`, menampilkan indikator loading pada tombol, dan menampilkan toast notifikasi dengan hasil (`X pesanan berhasil diperbarui, Y gagal`) setelah selesai.
4. WHEN Admin mengklik tombol Refresh Finance di header halaman, THE Frontend SHALL meminta Admin memilih pesanan dari tabel (via checkbox atau konfirmasi) sebelum memanggil API.
5. WHEN operasi Resync Finance atau Refresh Finance berhasil, THE Frontend SHALL secara otomatis memuat ulang data tabel dan KPI.
6. WHILE operasi Resync Finance atau Refresh Finance sedang berjalan, THE Frontend SHALL menonaktifkan (`disabled`) tombol yang bersangkutan hingga operasi selesai.
7. IF operasi Refresh Finance atau Resync Finance mengembalikan error, THE Frontend SHALL menampilkan toast pesan error yang deskriptif tanpa me-reload halaman.

---

### Requirement 11: Export Data

**User Story:** Sebagai Admin, saya ingin dapat mengekspor data laporan penjualan ke Excel, CSV, atau mencetak laporan, sehingga saya dapat menggunakan data tersebut untuk keperluan rekonsiliasi atau pelaporan eksternal.

#### Acceptance Criteria

1. WHEN Admin mengklik tombol Export Excel, THE Frontend SHALL mengunduh file `.xlsx` yang berisi semua kolom schema baru SalesLedger sesuai filter yang aktif, menggunakan library SheetJS.
2. WHEN Admin mengklik tombol Export CSV, THE Frontend SHALL mengunduh file `.csv` dengan encoding UTF-8 BOM yang berisi semua kolom schema baru, menggunakan format RFC 4180.
3. THE Frontend SHALL menamai file export dengan format `laporan-penjualan-v2-YYYY-MM-DD.xlsx` dan `laporan-penjualan-v2-YYYY-MM-DD.csv`.
4. WHEN Admin mengklik tombol Print, THE Frontend SHALL merender tabel lengkap ke area cetak (`#print-area`) dan memanggil `window.print()`.
5. THE Frontend SHALL membatasi export maksimal 9.999 baris per operasi untuk mencegah timeout browser.

---

### Requirement 12: Loading State dan Empty State

**User Story:** Sebagai Admin, saya ingin halaman Laporan Penjualan menampilkan indikator loading yang jelas dan pesan empty state yang informatif, sehingga saya selalu tahu apa yang sedang terjadi tanpa terjebak loading yang tidak berujung.

#### Acceptance Criteria

1. WHEN halaman Laporan Penjualan pertama kali dibuka, THE Frontend SHALL menampilkan Skeleton Loading (`.ds-skel`) pada KPI card dan tabel selama data dimuat dari backend.
2. THE Frontend SHALL NOT menampilkan teks "Memuat data..." yang permanen; setiap loading state harus memiliki batas waktu atau kondisi selesai yang jelas.
3. WHEN permintaan data ke backend memakan waktu lebih dari 10 detik, THE Frontend SHALL menampilkan pesan error: "Gagal memuat data. Periksa koneksi dan coba lagi." dengan tombol Coba Lagi.
4. WHEN sheet SalesLedger belum memiliki data, THE Frontend SHALL menampilkan empty state dengan class `.ds-empty` berisi teks: "Belum ada data penjualan. Silakan lakukan Sync Pesanan terlebih dahulu." dan ikon SVG receipt (bukan emoji).
5. THE Frontend SHALL menggunakan ikon SVG inline (Phosphor Icons style) untuk semua ikon; THE Frontend SHALL NOT menggunakan emoji sebagai ikon.

---

### Requirement 13: Desain Responsif

**User Story:** Sebagai Admin, saya ingin halaman Laporan Penjualan dapat digunakan baik di desktop maupun perangkat mobile, sehingga saya dapat memantau laporan dari mana saja.

#### Acceptance Criteria

1. THE Frontend SHALL menampilkan tabel penjualan dalam bentuk scrollable horizontal pada layar dengan lebar kurang dari 768px.
2. THE Frontend SHALL menampilkan KPI card dalam grid 2 kolom pada layar mobile (lebar < 768px) dan 4 kolom pada layar desktop (lebar ≥ 768px).
3. THE Detail Drawer SHALL memiliki lebar 100% pada layar mobile dan maksimal 480px pada layar desktop.
4. THE Frontend SHALL menampilkan filter panel dalam keadaan tersembunyi (collapsed) secara default pada layar mobile, dengan tombol toggle untuk menampilkannya.
5. THE Frontend SHALL menggunakan class design system yang sudah ada (`ds-card`, `ds-btn`, `kpi-card`, `ds-table`, `ds-badge`, `ds-skel`, `ds-empty`) secara konsisten.
