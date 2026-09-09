# Implementation Plan: Sales Ledger (Laporan Penjualan)

## Overview

Implementasi dilakukan secara incremental dengan urutan: **Backend GAS** (schema, upsert, endpoint), kemudian **Frontend UI** (navigasi, KPI, tabel, filter, drawer, export), dan terakhir **Integrasi AI** (tools baru, context update). Setiap task backend dapat diverifikasi dari GAS Editor sebelum melanjutkan ke tahap berikutnya.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4"] },
    { "wave": 3, "tasks": ["5"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7", "8", "9", "10", "11", "12"] },
    { "wave": 6, "tasks": ["13"] },
    { "wave": 7, "tasks": ["14", "15", "16"] },
    { "wave": 8, "tasks": ["17"] }
  ]
}
```

## Tasks

- [x] 1. Setup Schema dan Fungsi Inisialisasi SalesLedger di `code.gs`
  - Tambahkan konstanta `SALES_LEDGER_SHEET = "SalesLedger"` dan array `SALES_LEDGER_HEADERS` (27 elemen) di bagian konstanta atas `code.gs`, setelah blok konstanta `SHOPEE_ORDERS_SHEET` yang sudah ada.
  - Buat fungsi `ensureSalesLedgerSheet()`: cek keberadaan sheet, jika belum ada buat dan tulis 27 header di baris pertama, jika sudah ada validasi header sesuai schema (lempar error jika tidak cocok).
  - Panggil `ensureSalesLedgerSheet()` dari dalam fungsi `ensureDatabase()` yang sudah ada.
  - _Requirements: 1.6_

  - [ ]* 1.1 Verifikasi smoke test `ensureSalesLedgerSheet()`
    - Jalankan dari GAS Editor, verifikasi sheet `SalesLedger` terbuat dengan tepat 27 header sesuai `SALES_LEDGER_HEADERS`.
    - _Requirements: 1.6_

- [x] 2. Implementasi Fungsi `updateSalesLedger()` di `code.gs`
  - [x] 2.1 Implementasi logika upsert incremental
    - Buat fungsi `updateSalesLedger()` dengan pola yang sama seperti `handleSyncShopeeOrders`: batch read ShopeeOrders sekali dengan `sheet.getDataRange().getValues()`, build index kolom, build lookup map `sn_itemId_modelId → rowIndex`, loop seluruh baris dan tentukan insert vs update.
    - Gunakan `LockService.getScriptLock().waitLock(30000)` di awal fungsi.
    - Buat helper `_mapShopeeStatusToLedger(statusShopee)` sebagai fungsi terpisah yang mengembalikan string Status Ledger sesuai tabel pemetaan di design doc.
    - INSERT: generate `Ledger ID` format `"SL_" + Date.now() + "_" + Math.random().toString(36).slice(2,6)`, hitung Subtotal dan Estimasi Pendapatan, tulis 27 kolom via `sheet.appendRow()`.
    - UPDATE: perbarui hanya kolom yang diizinkan (Status Shopee, Status Ledger, Deduction Status, Mapping Status, SKU Inventaris, semua field finansial, Sync Time, Last Modified) tanpa menyentuh kolom immutable.
    - Return `{ newCount, updatedCount }`.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8_

  - [ ]* 2.2 Tulis property test untuk `_mapShopeeStatusToLedger()`
    - **Properti 2: Konsistensi Pemetaan Status**
    - *Untuk setiap* nilai Status Shopee yang mungkin, `_mapShopeeStatusToLedger()` harus mengembalikan nilai Status Ledger yang valid dan sesuai tabel pemetaan; tidak pernah mengembalikan nilai di luar daftar yang didefinisikan.
    - **Memvalidasi: Requirement 1.4**

  - [ ]* 2.3 Tulis property test untuk formula finansial
    - **Properti 3: Kebenaran Perhitungan Finansial** dan **Properti 4: Estimasi Pendapatan Konsisten**
    - *Untuk setiap* kombinasi `(qty, hargaProduk, voucher, biayaAdmin, biayaLayanan)` dengan nilai non-negatif: `subtotal` harus = `qty * hargaProduk` dan `estimasiPendapatan` harus = `subtotal - voucher - biayaAdmin - biayaLayanan`.
    - **Memvalidasi: Requirement 1.5**

  - [ ]* 2.4 Tulis property test idempoten upsert
    - **Properti 5: Idempoten Sync**
    - *Untuk setiap* array ShopeeOrders yang diberikan, menjalankan `updateSalesLedger()` dua kali berturut-turut tanpa mengubah ShopeeOrders harus menghasilkan jumlah baris SalesLedger yang sama dan tidak ada perubahan pada field immutable.
    - **Memvalidasi: Requirement 1.2, 1.3**

  - [ ]* 2.5 Tulis property test primary key unik
    - **Properti 1: Primary Key Unik di SalesLedger**
    - *Untuk setiap* array ShopeeOrders dengan N kombinasi `(order_sn, item_id, model_id)` yang unik, setelah `updateSalesLedger()` sheet SalesLedger harus memiliki tepat N baris.
    - **Memvalidasi: Requirement 1.2**

- [x] 3. Integrasi `updateSalesLedger()` ke `handleSyncShopeeOrders()`
  - Di dalam `handleSyncShopeeOrders()`, tambahkan panggilan `updateSalesLedger()` tepat sebelum statement `return { status: "success", ... }` di akhir blok `try`.
  - Simpan hasil ke variabel lokal dan tambahkan field `newLedger` dan `updatedLedger` ke objek return.
  - Wrap panggilan dalam try-catch terpisah: jika `updateSalesLedger()` gagal, log via `logShopeeActivity()` tapi **jangan** gagalkan response sync utama.
  - _Requirements: 1.1_

- [x] 4. Checkpoint — Verifikasi Backend Ledger Core
  - Jalankan `handleSyncShopeeOrders` dari GAS Editor dan verifikasi sheet `SalesLedger` terisi dengan data yang benar. Pastikan semua tes backend lulus. Tanyakan kepada user jika ada pertanyaan sebelum melanjutkan ke task frontend.

- [x] 5. Implementasi Endpoint Read di `code.gs`
  - [x] 5.1 Implementasi `handleGetSalesLedgerPaged(params)`
    - Pola identik dengan `handleGetShopeeOrdersPaged`: batch read satu kali, build index kolom via `forEach`, single-pass filter + hitung KPI inline.
    - Parameter: `page`, `limit`, `dateFrom`, `dateTo`, `statusShopee`, `statusLedger`, `search`, `searchSku`, `searchBuyer`, `searchOrderSn`.
    - KPI dihitung pada single-pass yang sama: `totalOmzet` dari baris status Selesai, `totalPesanan` = COUNT DISTINCT `Order SN`, `totalQty` = SUM Qty, `totalRetur`, `totalDibatalkan`, `totalSelesai`, `totalPending`, `estimasiPendapatan`.
    - Sort descending berdasarkan `Tanggal Order`. Return `{ status, ledgers[], total, page, totalPages, kpi }`.
    - _Requirements: 6.1, 6.6_

  - [x] 5.2 Implementasi `handleGetSalesLedgerKPI(params)`
    - Parameter opsional: `dateFrom`, `dateTo`. Baca semua baris SalesLedger, hitung semua field KPI.
    - Return `{ status, kpi: { totalOmzet, totalPesanan, totalQty, averageOrder, totalRetur, totalDibatalkan, totalSelesai, totalPending, estimasiPendapatan } }`.
    - _Requirements: 6.2_

  - [x] 5.3 Implementasi `handleGetSalesLedgerDetail(params)`
    - Cari baris berdasarkan `params.ledgerId` di kolom `Ledger ID`.
    - Kembalikan semua 27 field ditambah `financial_breakdown` (voucher, biaya_admin, biaya_layanan sebagai nilai negatif) dan `buyer_avatar_initial`.
    - Jika tidak ditemukan: `{ status: "error", message: "Ledger tidak ditemukan." }`.
    - _Requirements: 6.3, 6.5_

  - [x] 5.4 Implementasi `handleGetSalesLedgerData(params)`
    - Baca semua baris SalesLedger, ambil 500 baris terbaru (sort descending `Tanggal Order`).
    - Return `{ status, ledgers[], summary: { totalBaris, diambil, lastSync } }`.
    - _Requirements: 6.4_

  - [x] 5.5 Daftarkan semua endpoint baru di `doGet()` dalam `code.gs`
    - Tambahkan 4 routing baru di dalam `doGet()` menggunakan pola `if (action === "...")` yang sama persis dengan endpoint lain:
      - `getSalesLedgerPaged` → `handleGetSalesLedgerPaged(e.parameter)`
      - `getSalesLedgerKPI` → `handleGetSalesLedgerKPI(e.parameter)`
      - `getSalesLedgerDetail` → `handleGetSalesLedgerDetail(e.parameter)`
      - `getSalesLedgerData` → `handleGetSalesLedgerData(e.parameter)`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.6 Tulis property test untuk filter endpoint
    - **Properti 7: Filter Tidak Menghasilkan Data di Luar Kriteria**
    - *Untuk setiap* kombinasi filter yang diterapkan, semua baris dalam `ledgers[]` yang dikembalikan harus memenuhi **semua** kondisi filter secara bersamaan (tidak ada data yang bocor dari filter).
    - **Memvalidasi: Requirement 2.2, 6.1**

  - [ ]* 5.7 Tulis property test untuk paginasi
    - **Properti 6: KPI Mencerminkan Data Sheet**
    - *Untuk setiap* dataset dan parameter `limit`, `totalPages` harus = `Math.ceil(total / limit)` dan jumlah baris di halaman manapun ≤ `limit`.
    - **Memvalidasi: Requirement 2.8, 6.1**

- [x] 6. Checkpoint — Verifikasi Semua Endpoint
  - Tes semua 4 endpoint baru via GAS URL dengan parameter berbeda. Verifikasi KPI, pagination, filter tanggal, dan error handling. Tanyakan kepada user jika ada pertanyaan sebelum melanjutkan ke task UI.

- [x] 7. Tambahkan Navigasi Sidebar dan Section di `index.html`
  - Tambahkan `<button class="nav-item" onclick="showSection('sales-ledger')" title="Laporan Penjualan">` dengan ikon SVG clipboard/receipt di sidebar `#app-sidebar`, diposisikan setelah item Shopee Orders.
  - Tambahkan `<section id="sales-ledger" class="hidden">` sebagai container utama di dalam `.app-main-inner`, setelah section Shopee Orders.
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 8. Implementasi Header dan KPI Dashboard
  - [x] 8.1 Buat HTML header halaman di dalam `#sales-ledger`
    - Header berisi: judul "Laporan Penjualan", badge `<span class="ds-badge ds-badge-blue">Realtime</span>`, tombol "Sync" (`.ds-btn.ds-btn-secondary`), dan grup tombol Export (Excel, CSV, Print).
    - _Requirements: 2.1, 2.9, 3.1, 3.2, 3.3_

  - [x] 8.2 Buat HTML 5 KPI card
    - Grid 5 kolom `.kpi-card` dengan ID: `sl-kpi-omzet`, `sl-kpi-pesanan`, `sl-kpi-qty`, `sl-kpi-avg`, `sl-kpi-retur`. Setiap card mengikuti struktur `.kpi-card` design system.
    - _Requirements: 2.1_

  - [x] 8.3 Implementasi fungsi `loadSalesLedgerKPI()`
    - Panggil endpoint `getSalesLedgerKPI` dengan filter periode aktif. Update 5 KPI card. Format nilai uang menggunakan `Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" })`.
    - _Requirements: 2.1_

- [x] 9. Implementasi Filter Panel dan Search
  - Buat filter panel `<div id="sl-filter-panel" class="ds-filter-panel">` dengan: input tanggal dari/sampai, `<select>` status Shopee (Semua + 8 nilai), `<select>` status ledger (Semua, Pending, Selesai, Dibatalkan, Retur), dan search bar universal.
  - Buat tombol toggle `.ds-filter-toggle` yang menambah/hapus class `open` pada panel di mobile.
  - Setiap perubahan filter memanggil `loadSalesLedgerTable(1)` untuk reset ke halaman pertama.
  - _Requirements: 2.2, 2.10_

- [x] 10. Implementasi Tabel Utama dan Paginasi
  - [x] 10.1 Buat HTML struktur tabel
    - Container `.ds-card` dengan toolbar (info total hasil, select limit 25/50/100), `<table class="ds-table" id="sl-table">` dengan 12 kolom header, `<tbody id="sl-tbody">`, dan `<div id="sl-pagination">`.
    - _Requirements: 2.3, 2.8_

  - [x] 10.2 Implementasi fungsi `loadSalesLedgerTable(page)`
    - Kumpulkan semua nilai filter aktif. Tampilkan 3 baris skeleton loading. Panggil `getSalesLedgerPaged`. Render baris via `_renderSalesLedgerRow()`. Handle empty state via `.ds-empty`. Update KPI dari field `kpi`. Render paginasi.
    - _Requirements: 2.2, 2.6, 2.7, 2.8_

  - [x] 10.3 Implementasi `_renderSalesLedgerRow()` dan badge helpers
    - `_slStatusLedgerBadge(status)`: mengembalikan HTML badge dengan class `ds-badge-amber` (Pending), `ds-badge-green` (Selesai), `ds-badge-red` (Dibatalkan), `ds-badge-purple` (Retur).
    - `_slDeductionBadge(status)`: mengembalikan badge sesuai mapping deduction status.
    - Tombol aksi: ikon mata yang memanggil `openSalesLedgerDetail(ledger_id)`.
    - _Requirements: 2.3, 2.5_

  - [ ]* 10.4 Tulis property test untuk badge status
    - **Properti 2: Badge Status Konsisten**
    - *Untuk setiap* nilai Status Ledger yang mungkin, `_slStatusLedgerBadge(status)` harus mengembalikan HTML yang mengandung CSS class yang tepat sesuai mapping dan tidak pernah mengembalikan string kosong.
    - **Memvalidasi: Requirement 2.5**

- [x] 11. Implementasi Detail Drawer
  - Buat elemen HTML `<div id="sl-detail-drawer">` (fixed panel kanan) dengan: header (Order SN + tombol tutup), section info pesanan (buyer, tanggal, status badges), section item (tabel produk/variasi/SKU/qty/harga), dan section finansial breakdown.
  - Buat overlay `<div id="sl-drawer-overlay" class="ds-modal-overlay hidden">`.
  - Implementasi `openSalesLedgerDetail(ledgerId)`: panggil `getSalesLedgerDetail`, isi drawer, tampilkan drawer dan overlay.
  - Implementasi `closeSalesLedgerDetail()`: sembunyikan drawer dan overlay.
  - _Requirements: 2.4_

- [x] 12. Implementasi Fitur Export
  - [x] 12.1 Tambahkan SheetJS ke `index.html`
    - Tambahkan `<script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>` di bagian `<head>` setelah script CDN yang sudah ada.
    - _Requirements: 3.1_

  - [x] 12.2 Implementasi `exportSalesLedgerExcel()`
    - Panggil `getSalesLedgerPaged` dengan `limit=9999` dan filter aktif. Konversi ke array-of-arrays dengan header bahasa Indonesia. Generate file `.xlsx` via `XLSX.utils.aoa_to_sheet()` dan `XLSX.writeFile()`.
    - _Requirements: 3.1_

  - [x] 12.3 Implementasi `exportSalesLedgerCSV()`
    - Ambil semua data sesuai filter. Implementasi `_toCsvRow(values)` yang meng-escape nilai sesuai RFC 4180 (bungkus dengan `"..."` jika mengandung koma, tanda kutip, atau newline; escape tanda kutip menjadi `""`). Buat Blob dan trigger download.
    - _Requirements: 3.2, 3.4_

  - [ ]* 12.4 Tulis property test untuk serialisasi CSV
    - **Properti 8: Round-Trip Serialisasi CSV**
    - *Untuk setiap* array nilai string arbitrer (termasuk yang mengandung koma, tanda kutip, dan newline), `_toCsvRow(values)` kemudian diparse sesuai RFC 4180 harus menghasilkan nilai yang setara dengan input asli.
    - **Memvalidasi: Requirement 3.2, 3.4**

  - [x] 12.5 Implementasi Print
    - Saat tombol Print diklik: render tabel lengkap ke `#print-area`, panggil `window.print()`.
    - _Requirements: 3.3_

- [x] 13. Checkpoint — Verifikasi UI Lengkap
  - Verifikasi seluruh komponen UI berjalan: KPI, filter, tabel, paginasi, drawer, semua export. Cek responsivitas di mobile dan desktop. Tanyakan kepada user jika ada pertanyaan sebelum melanjutkan ke integrasi AI.

- [x] 14. Integrasi AI — Tool Baru di `ai/AITools.js`
  - [x] 14.1 Implementasi `getSalesSummary()`
    - Baca dari `getData("salesLedgerData")`. Hitung: `totalOmzet` (SUM subtotal status Selesai), `totalSelesai`, `totalPending`, `totalRetur`, `totalDibatalkan`, `estimasiPendapatan` (SUM estimasi_pendapatan status Selesai), `topProducts` (5 SKU dengan subtotal terbesar).
    - Export sebagai `export function getSalesSummary()`.
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 14.2 Implementasi `topSellingProducts(topN)`
    - Baca dari `getData("salesLedgerData")`. Akumulasi subtotal dan qty per `sku_inventaris` dari baris status Selesai. Sort descending, ambil `topN`. Return `{ products: [{ rank, sku, namaProduk, totalSubtotal, totalQty }] }`.
    - Export sebagai `export function topSellingProducts(topN = 5)`.
    - _Requirements: 5.4_

  - [ ]* 14.3 Tulis property test untuk `getSalesSummary()`
    - **Properti dari Requirement 5.3**
    - *Untuk setiap* array `salesLedgerData` yang valid, `getSalesSummary()` harus mengembalikan objek yang mengandung semua field yang diperlukan: `totalOmzet`, `totalSelesai`, `totalPending`, `totalRetur`, `totalDibatalkan`, `estimasiPendapatan`, `topProducts`.
    - **Memvalidasi: Requirement 5.3**

- [x] 15. Integrasi AI — Perbarui `ai/AIContext.js`
  - [x] 15.1 Impor `getSalesSummary` dan `topSellingProducts`
    - Tambahkan kedua fungsi ke statement `import { ... } from "./AITools.js"` yang sudah ada.
    - _Requirements: 5.2_

  - [x] 15.2 Tambahkan section `penjualan` ke `buildContext()`
    - Panggil `getSalesSummary()` dan tambahkan field `context.penjualan` dengan semua sub-field yang diperlukan (totalOmzet, totalPesananSelesai, totalPesananPending, totalRetur, totalDibatalkan, estimasiPendapatan, produkTerlarisSales).
    - _Requirements: 5.3_

  - [x] 15.3 Tambahkan section ke `contextToText()`
    - Tambahkan block `--- PENJUALAN (SALES LEDGER) ---` ke dalam `contextToText()` setelah section `--- SHOPEE ---` yang sudah ada. Format nilai uang menggunakan `toLocaleString("id-ID")`.
    - _Requirements: 5.5_

  - [ ]* 15.4 Tulis property test untuk `contextToText()` dengan data penjualan
    - **Properti dari Requirement 5.5**
    - *Untuk setiap* context yang mengandung field `penjualan` dengan nilai valid, `contextToText(ctx)` harus menghasilkan string yang mengandung substring `"PENJUALAN (SALES LEDGER)"`.
    - **Memvalidasi: Requirement 5.5**

- [x] 16. Muat `window.salesLedgerData` dari Frontend
  - Di dalam handler saat section `sales-ledger` ditampilkan (fungsi `showSection` atau `initSalesLedger`), tambahkan panggilan ke fungsi `loadSalesLedgerData()`.
  - Implementasi `loadSalesLedgerData()`: panggil `GET ?action=getSalesLedgerData`, simpan `result.ledgers` ke `window.salesLedgerData`, lalu panggil `loadSalesLedgerKPI()` dan `loadSalesLedgerTable(1)`.
  - _Requirements: 5.1_

- [x] 17. Checkpoint Akhir — Verifikasi Integrasi Penuh
  - Verifikasi alur end-to-end: sync → ledger update → UI refresh → AI context. Jalankan skenario: buka halaman, cek KPI, filter, klik detail, export CSV, dan tanya AI tentang penjualan. Pastikan semua tes lulus. Tanyakan kepada user jika ada pertanyaan.

## Notes

- Task bertanda `*` bersifat opsional dan dapat dilewati untuk pengerjaan MVP yang lebih cepat.
- Urutan task harus diikuti karena terdapat dependensi antar task (lihat Task Dependency Graph).
- Semua task yang tidak bertanda `*` wajib diimplementasikan.
- Checkpoint (task 4, 6, 13, 17) memerlukan verifikasi manual sebelum melanjutkan ke fase berikutnya.
- Pola kode GAS mengikuti konvensi yang sudah ada di `code.gs` (batch read, single-pass filter, LockService).
- Pola kode frontend mengikuti konvensi yang sudah ada di `index.html` (design system classes, showSection, toast).
