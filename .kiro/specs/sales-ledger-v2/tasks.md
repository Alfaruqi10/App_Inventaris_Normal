# Implementation Plan: Laporan Penjualan v2 (Integrasi Payment API)

## Overview

Implementasi dilakukan secara incremental mengikuti urutan: **migrasi schema** → **Payment API** → **revisi backend SalesLedger** → **endpoint baru** → **routing** → **frontend KPI** → **tabel v2** → **drawer v2** → **tombol Finance** → **export v2**. Setiap task backend dapat diverifikasi dari GAS Editor sebelum melanjutkan ke frontend.

Tech stack: Google Apps Script (code.gs), Vanilla JS (sales-ledger.js), Tailwind CSS, Phosphor Icons SVG inline.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4", "5"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7"] },
    { "wave": 6, "tasks": ["8"] },
    { "wave": 7, "tasks": ["9", "10", "11"] },
    { "wave": 8, "tasks": ["12"] },
    { "wave": 9, "tasks": ["13", "14"] },
    { "wave": 10, "tasks": ["15"] }
  ]
}
```

## Tasks

- [x] 1. Migrasi Schema SalesLedger ke v2 di `code.gs`
  - Ganti atau perbarui konstanta `SALES_LEDGER_HEADERS` menjadi `SALES_LEDGER_HEADERS_V2` dengan 47 elemen sesuai schema di design doc (27 kolom lama + 20 kolom baru Payment API).
  - Revisi fungsi `ensureSalesLedgerSheet()`: jika sheet sudah ada dengan 27 kolom lama, tambahkan 20 kolom baru di sebelah kanan tanpa mengubah data yang ada; jika belum ada buat baru dengan 47 header; jika header tidak cocok dan tidak bisa dimigrasi lempar error ke log.
  - Update format `Ledger ID` dari `"SL_"` menjadi `"SLv2_"` untuk baris baru.
  - Panggil `ensureSalesLedgerSheet()` dari `ensureDatabase()` yang sudah ada.
  - _Requirements: Persyaratan 1.1, 1.2, 1.3, 1.5_

  - [ ]* 1.1 Smoke test `ensureSalesLedgerSheet()` pada sheet v1
    - Jalankan dari GAS Editor pada spreadsheet yang memiliki SalesLedger v1 (27 kolom). Verifikasi sheet kini memiliki 47 header dan data lama tidak berubah.
    - _Requirements: Persyaratan 1.1, 1.2_

  - [ ]* 1.2 Tulis property test: Ledger ID format konsisten
    - **Property 2: Ledger ID Format Konsisten**
    - *Untuk setiap* baris yang di-insert, Ledger ID harus dimulai `"SLv2_"` diikuti angka, diikuti `_` dan 4 karakter alfanumerik.
    - **Validates: Persyaratan 1.5**

- [x] 2. Implementasi `fetchPaymentEscrow(orderSn)` di `code.gs`
  - Buat fungsi `fetchPaymentEscrow(orderSn)` di `code.gs`.
  - Validasi status pesanan di awal: jika bukan COMPLETED atau TO_CONFIRM_RECEIVE, return langsung `{ success: false, error: "invalid_status", message: "Order belum selesai" }` tanpa HTTP call.
  - Ambil token dengan `getValidAccessToken()`, buat signature dengan `makeShopeeSignature("/api/v2/payment/get_escrow_detail", timestamp, accessToken, shopId)`.
  - Build query string: `partner_id`, `shop_id`, `timestamp`, `access_token`, `sign`, `order_sn`.
  - Fetch dengan `UrlFetchApp.fetch(url, { muteHttpExceptions: true })`.
  - Jika `json.error !== ""`: return `{ success: false, error: json.error, message: json.message }`.
  - Jika network exception: catch dan return `{ success: false, error: "network_error", message: err.toString() }`.
  - Sukses: return `{ success: true, data: json.response }`.
  - _Requirements: Persyaratan 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.1 Tulis property test: fetchPaymentEscrow menolak status tidak valid
    - **Property 3: fetchPaymentEscrow Menolak Status Tidak Valid**
    - *Untuk setiap* nilai status selain COMPLETED dan TO_CONFIRM_RECEIVE, fungsi harus return `{ success: false, error: "invalid_status" }` tanpa HTTP request.
    - **Validates: Persyaratan 2.6**

  - [ ]* 2.2 Verifikasi integrasi Payment API dengan satu order nyata
    - Jalankan `testPaymentEscrow(orderSn)` dari GAS Editor dengan order COMPLETED yang ada di ShopeeOrders. Verifikasi response mengandung `order_income.escrow_amount`.
    - _Requirements: Persyaratan 2.1, 2.2_

- [x] 3. Revisi `updateSalesLedger()` untuk Payment API di `code.gs`
  - [x] 3.1 Update logika upsert untuk schema v2
    - Revisi fungsi `updateSalesLedger()` agar menggunakan `SALES_LEDGER_HEADERS_V2` (47 kolom).
    - Saat INSERT baris baru: tulis semua 47 kolom; kolom 27–46 diisi `""` dulu.
    - Saat UPDATE baris yang ada: perbarui hanya kolom yang diizinkan (Status Shopee, Status Ledger, dll); jangan sentuh field immutable.
    - _Requirements: Persyaratan 3.1, 3.4, 3.5_

  - [x] 3.2 Integrasikan `fetchPaymentEscrow()` ke dalam loop upsert
    - Setelah menentukan INSERT atau UPDATE untuk setiap baris: jika `order_status === "COMPLETED" || order_status === "TO_CONFIRM_RECEIVE"` DAN kolom `Escrow Amount` kosong (`=== ""`), panggil `fetchPaymentEscrow(orderSn)`.
    - Jika berhasil: petakan field dari `data.order_income` ke kolom 27–46 sesuai mapping di design doc; increment `paymentFetched`.
    - Jika gagal: biarkan kolom 27–46 tetap `""`; log error dengan `Logger.log()`; increment `paymentFailed`.
    - Tambahkan `Last Sync = new Date()` dan `Last Modified = new Date()` pada setiap operasi.
    - _Requirements: Persyaratan 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Update return value `updateSalesLedger()`
    - Return `{ newCount, updatedCount, paymentFetched, paymentFailed }` (menggantikan return `{ newCount, updatedCount }` lama).
    - Update `handleSyncShopeeOrders()` untuk meneruskan field baru ini ke response: `{ ..., paymentFetched, paymentFailed }`.
    - _Requirements: Persyaratan 3.6_

  - [ ]* 3.4 Tulis property test: Payment API hanya dipanggil untuk baris eligible
    - **Property 5: Payment API Hanya Dipanggil untuk Baris Eligible**
    - *Untuk setiap* array ShopeeOrders campuran, `updateSalesLedger()` hanya boleh call `fetchPaymentEscrow()` untuk COMPLETED/TO_CONFIRM_RECEIVE tanpa Escrow Amount.
    - **Validates: Persyaratan 3.1, 3.7**

  - [ ]* 3.5 Tulis property test: primary key unik + idempoten
    - **Property 1: Primary Key Unik Setelah Upsert**
    - Menjalankan `updateSalesLedger()` dua kali dengan ShopeeOrders yang sama harus menghasilkan jumlah baris identik.
    - **Validates: Persyaratan 1.4**

  - [ ]* 3.6 Tulis property test: updateSalesLedger selalu return 4 counter
    - **Property 6: updateSalesLedger Selalu Mengembalikan Empat Counter**
    - *Untuk setiap* input ShopeeOrders, return value harus mengandung 4 field non-negatif.
    - **Validates: Persyaratan 3.6**

- [x] 4. Implementasi `handleResyncFinance()` di `code.gs`
  - Buat fungsi `handleResyncFinance(data)`.
  - Baca semua baris SalesLedger, filter: `Status Shopee` = COMPLETED atau TO_CONFIRM_RECEIVE DAN `Escrow Amount` kosong atau 0.
  - Ambil Order SN unik dari baris eligible, batasi 50 order pertama.
  - Loop setiap Order SN: panggil `fetchPaymentEscrow()`, update baris SalesLedger yang sesuai, increment counter `success` atau `failed`.
  - Jika tidak ada baris eligible: return `{ status: "success", processed: 0, message: "Semua pesanan sudah memiliki data finance." }`.
  - Return `{ status: "success", processed, success, failed, skipped }` di mana `skipped` = total eligible - yang diproses.
  - _Requirements: Persyaratan 4.1–4.6_

  - [ ]* 4.1 Tulis property test: handleResyncFinance hanya memproses baris eligible
    - **Property 7: handleResyncFinance Hanya Memproses Baris Eligible**
    - *Untuk setiap* SalesLedger campuran, `processed` harus = jumlah baris eligible (maks 50).
    - **Validates: Persyaratan 4.2, 4.3, 4.4**

- [x] 5. Implementasi `handleRefreshFinance()` di `code.gs`
  - Buat fungsi `handleRefreshFinance(data)`.
  - Validasi: jika `data.orderSns` tidak ada atau bukan array, return `{ status: "error", message: "Parameter orderSns harus berupa array." }`.
  - Batasi ke 20 order pertama dari array.
  - Loop: panggil `fetchPaymentEscrow()` per order, update baris SalesLedger yang sesuai.
  - Return `{ status: "success", processed, success, failed }`.
  - _Requirements: Persyaratan 5.1–5.5_

- [x] 6. Implementasi Endpoint Read v2 di `code.gs`
  - [x] 6.1 Implementasi `handleGetSalesLedgerPagedV2(params)`
    - Batch read SalesLedger sekali, build column index map, single-pass filter + hitung 7 KPI inline.
    - Filter: `dateFrom`, `dateTo`, `statusShopee`, `statusLedger`, `settlementStatus`, `search`.
    - Sort descending berdasarkan `Tanggal Order`. Paginasi dengan `page` dan `limit`.
    - Return `{ status, ledgers[], total, page, totalPages, kpi }` di mana `kpi` berisi 7 nilai sesuai design.
    - _Requirements: Persyaratan 7.1, 7.5, 8.1, 8.6_

  - [x] 6.2 Implementasi `handleGetSalesLedgerKPIV2(params)`
    - Parameter opsional: `dateFrom`, `dateTo`. Single-pass hitung 7 KPI.
    - Return `{ status, kpi: { totalOmzet, pendapatanBersih, totalPesanan, totalQty, voucherShopee, voucherSeller, totalFee } }`.
    - _Requirements: Persyaratan 7.1, 7.5_

  - [x] 6.3 Implementasi `handleGetSalesLedgerDetailV2(params)`
    - Cari baris berdasarkan `params.ledgerId`. Kembalikan semua 47 field + computed fields: `buyer_avatar_initial`, `has_payment_data`, dan object `sections` yang sudah dikelompokkan sesuai 7 seksi drawer.
    - Jika tidak ditemukan: `{ status: "error", message: "Ledger tidak ditemukan." }`.
    - _Requirements: Persyaratan 9.1, 9.2_

  - [ ]* 6.4 Tulis property test: kalkulasi 7 KPI konsisten dengan data mentah
    - **Property 8: Kalkulasi 7 KPI Konsisten dengan Data Mentah**
    - *Untuk setiap* dataset SalesLedger, hasil KPI harus identik dengan kalkulasi naif (iterasi satu per satu).
    - **Validates: Persyaratan 7.1, 7.5**

- [x] 7. Daftarkan Semua Endpoint Baru di `doPost` dan `doGet` di `code.gs`
  - Tambahkan di `doPost()`:
    - `if (data.action === "resyncFinance") return jsonOutput(handleResyncFinance(data));`
    - `if (data.action === "refreshFinance") return jsonOutput(handleRefreshFinance(data));`
  - Tambahkan di `doGet()`:
    - `if (action === "getSalesLedgerPagedV2") return jsonOutput(handleGetSalesLedgerPagedV2(e.parameter));`
    - `if (action === "getSalesLedgerKPIV2") return jsonOutput(handleGetSalesLedgerKPIV2(e.parameter));`
    - `if (action === "getSalesLedgerDetailV2") return jsonOutput(handleGetSalesLedgerDetailV2(e.parameter));`
  - _Requirements: Persyaratan 6.1–6.5_

- [x] 8. Checkpoint — Verifikasi Backend Lengkap
  - Jalankan `updateSalesLedger()` dari GAS Editor dan verifikasi kolom-kolom Payment API terisi untuk pesanan COMPLETED. Uji `handleResyncFinance()` dan `handleRefreshFinance()` dari GAS Editor. Test semua 3 endpoint GET baru via URL. Pastikan semua tes backend lulus. Tanyakan kepada user jika ada pertanyaan sebelum melanjutkan ke frontend.

- [x] 9. Perbarui KPI Dashboard v2 di `sales-ledger.js` dan `index.html`
  - [x] 9.1 Tambah 3 KPI card baru di HTML `index.html`
    - Di dalam section `#view-sales-ledger`, tambahkan 3 KPI card baru: `sl-kpi-pendapatan-bersih`, `sl-kpi-voucher-shopee`, `sl-kpi-voucher-seller`, `sl-kpi-total-fee` (menyesuaikan grid dari 5 menjadi 7 card dengan Tailwind responsive: `grid-cols-2 md:grid-cols-4 lg:grid-cols-7`).
    - Setiap card menggunakan class `.kpi-card` dan ikon SVG inline (bukan emoji).
    - _Requirements: Persyaratan 7.1, 7.2, 13.2_

  - [x] 9.2 Perbarui `_slUpdateKpiDom()` di `sales-ledger.js`
    - Tambahkan update untuk 4 elemen baru: `sl-kpi-pendapatan-bersih` (Escrow Amount), `sl-kpi-voucher-shopee`, `sl-kpi-voucher-seller`, `sl-kpi-total-fee`.
    - Semua nilai uang diformat dengan `_slFmtRupiah()`.
    - _Requirements: Persyaratan 7.1, 7.3_

  - [x] 9.3 Perbarui panggilan endpoint ke `getSalesLedgerKPIV2`
    - Di `loadSalesLedgerKPI()`, ganti endpoint dari `getSalesLedgerKPI` menjadi `getSalesLedgerKPIV2`.
    - _Requirements: Persyaratan 7.1_

- [x] 10. Perbarui Tabel Penjualan v2 di `sales-ledger.js` dan `index.html`
  - [x] 10.1 Tambah kolom baru di header tabel HTML
    - Tambahkan kolom: `Voucher`, `Admin Fee`, `Service Fee`, `Escrow`, `Net Income`, `Settlement` di antara kolom `Subtotal` dan kolom status di tabel `#sl-table` dalam `index.html`.
    - _Requirements: Persyaratan 8.1_

  - [x] 10.2 Tambah fungsi `_slSettlementBadge(status)` di `sales-ledger.js`
    - Map: `RELEASED` → `ds-badge-green`, `IN_ESCROW` → `ds-badge-amber`, `BUYER_DUE` → `ds-badge-red`, default → `ds-badge-gray`.
    - Selalu return string HTML non-kosong.
    - _Requirements: Persyaratan 8.4_

  - [x] 10.3 Perbarui `_slRenderTable()` dan baris tabel di `sales-ledger.js`
    - Tambahkan sel untuk kolom-kolom baru: `r['Voucher Total']`, `r['Commission Fee']`, `r['Service Fee']`, `r['Escrow Amount']`, `r['Net Income']`, dan `_slSettlementBadge(r['Settlement Status'])`.
    - Perbarui `colspan` pada empty state dan skeleton dari `12` menjadi `18`.
    - _Requirements: Persyaratan 8.1, 8.2, 8.3_

  - [x] 10.4 Perbarui endpoint tabel ke `getSalesLedgerPagedV2`
    - Di `loadSalesLedgerTable()`, ganti endpoint dari `getSalesLedgerPaged` menjadi `getSalesLedgerPagedV2`.
    - _Requirements: Persyaratan 8.6, 8.7_

  - [ ]* 10.5 Tulis property test: Settlement Status badge selalu valid
    - **Property 9: Settlement Status Badge Selalu Valid**
    - *Untuk setiap* nilai Settlement Status, `_slSettlementBadge()` harus mengembalikan HTML non-kosong mengandung class `ds-badge`.
    - **Validates: Persyaratan 8.4**

- [x] 11. Perbarui Detail Drawer v2 di `sales-ledger.js` dan `index.html`
  - [x] 11.1 Buat struktur HTML drawer v2 di `index.html`
    - Perbarui elemen `#sl-detail-drawer` agar memiliki 7 seksi yang terpisah: Informasi Pesanan, Informasi Produk, Rincian Pembayaran, Rincian Ongkir, Biaya Marketplace, Penyesuaian, dan Pendapatan.
    - Tambahkan tombol "Refresh Finance" di header drawer menggunakan ikon SVG ArrowsClockwise (Phosphor style).
    - Lebar drawer: `w-full md:max-w-[480px]`.
    - _Requirements: Persyaratan 9.1, 9.2, 9.3, 13.3_

  - [x] 11.2 Perbarui `openSalesLedgerDetail()` di `sales-ledger.js`
    - Ganti endpoint dari `getSalesLedgerDetail` menjadi `getSalesLedgerDetailV2`.
    - Render 7 seksi dari `res.detail.sections` yang sudah dikelompokkan oleh backend.
    - Jika `!res.detail.has_payment_data`: tampilkan teks "Data belum tersedia — klik Refresh Finance" pada Seksi 5, 6, dan 7.
    - Tombol Refresh Finance di header drawer memanggil `refreshFinanceSelected([currentOrderSn])`.
    - _Requirements: Persyaratan 9.2, 9.4, 9.5, 9.6, 9.7_

- [x] 12. Tambah Tombol Refresh Finance dan Resync Finance di `index.html` dan `sales-ledger.js`
  - [x] 12.1 Tambah HTML tombol di header halaman Laporan Penjualan
    - Tambahkan dua tombol di header section `#view-sales-ledger` setelah tombol Sync:
      - Tombol **Refresh Finance** dengan ID `sl-btn-refresh-finance` dan ikon SVG ArrowsClockwise.
      - Tombol **Resync Finance** dengan ID `sl-btn-resync-finance` dan ikon SVG CloudArrowDown.
    - Gunakan class `ds-btn ds-btn-secondary` untuk Resync Finance dan `ds-btn ds-btn-ghost` untuk Refresh Finance.
    - _Requirements: Persyaratan 10.1, 10.2_

  - [x] 12.2 Implementasi `resyncFinance()` di `sales-ledger.js`
    - Saat tombol diklik: nonaktifkan tombol, tampilkan loading di label tombol.
    - Panggil `POST action=resyncFinance`.
    - Tampilkan toast: `"✓ Finance diperbarui: X berhasil, Y gagal"` atau pesan error.
    - Setelah selesai: aktifkan kembali tombol, panggil `loadSalesLedgerData()` untuk refresh.
    - _Requirements: Persyaratan 10.3, 10.5, 10.6, 10.7_

  - [x] 12.3 Implementasi `refreshFinanceSelected(orderSns)` di `sales-ledger.js`
    - Terima parameter array `orderSns`.
    - Panggil `POST action=refreshFinance` dengan `{ orderSns }`.
    - Tampilkan toast hasil.
    - Setelah selesai: panggil `loadSalesLedgerData()` untuk refresh.
    - _Requirements: Persyaratan 10.4, 10.5, 10.6, 10.7_

- [x] 13. Perbarui Fungsi Export v2 di `sales-ledger.js`
  - [x] 13.1 Perbarui `exportSalesLedgerExcel()` ke schema v2
    - Ganti array `hdrs` agar menggunakan 47 kolom header schema v2.
    - Ganti endpoint dari `getSalesLedgerPaged` menjadi `getSalesLedgerPagedV2`.
    - Ganti nama file menjadi `laporan-penjualan-v2-YYYY-MM-DD.xlsx`.
    - _Requirements: Persyaratan 11.1, 11.3, 11.5_

  - [x] 13.2 Perbarui `exportSalesLedgerCSV()` ke schema v2
    - Ganti array `hdrs` agar menggunakan 47 kolom header schema v2.
    - Ganti endpoint ke `getSalesLedgerPagedV2`.
    - Ganti nama file menjadi `laporan-penjualan-v2-YYYY-MM-DD.csv`.
    - _Requirements: Persyaratan 11.2, 11.3_

  - [ ]* 13.3 Tulis property test: round-trip serialisasi CSV
    - **Property 10: Round-Trip Serialisasi CSV**
    - *Untuk setiap* array nilai string (termasuk koma, tanda kutip, newline), `_toCsvRow()` → parse RFC 4180 → hasil harus setara dengan input.
    - **Validates: Persyaratan 11.2**

- [x] 14. Perbarui Loading State dan Empty State di `sales-ledger.js`
  - Perbarui `loadSalesLedgerTable()`: skeleton colspan dari `12` → `18`; timeout 10 detik dengan pesan error "Gagal memuat data. Periksa koneksi dan coba lagi." dan tombol Coba Lagi.
  - Perbarui empty state: teks "Belum ada data penjualan. Silakan lakukan Sync Pesanan terlebih dahulu." dengan ikon SVG receipt (bukan emoji).
  - Pastikan tidak ada teks "Memuat data..." yang permanen.
  - _Requirements: Persyaratan 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 15. Checkpoint Akhir — Verifikasi Integrasi Penuh
  - Uji alur end-to-end: sync pesanan COMPLETED → `fetchPaymentEscrow()` dipanggil → SalesLedger terisi dengan data payment → KPI 7 card terbaca → tabel menampilkan kolom Escrow dan Settlement → drawer menampilkan 7 seksi lengkap → Resync Finance berjalan → Export v2 menghasilkan file dengan 47 kolom. Pastikan semua tes lulus. Tanyakan kepada user jika ada pertanyaan.

## Notes

- Task bertanda `*` bersifat opsional dan dapat dilewati untuk pengerjaan MVP yang lebih cepat.
- Urutan task wajib diikuti: backend (1–8) harus selesai sebelum frontend (9–15).
- Semua task yang tidak bertanda `*` wajib diimplementasikan.
- Checkpoint (task 8, 15) memerlukan verifikasi manual sebelum melanjutkan.
- Payment API hanya boleh dipanggil dari backend (code.gs); frontend tidak boleh memanggil Shopee API secara langsung.
- Semua ikon menggunakan SVG inline Phosphor Icons style — tidak boleh menggunakan emoji.
- Design system class yang digunakan: `ds-card`, `ds-btn`, `kpi-card`, `ds-table`, `ds-badge`, `ds-skel`, `ds-empty`.
- Property test menggunakan library **fast-check** dengan minimum 100 iterasi per test.
