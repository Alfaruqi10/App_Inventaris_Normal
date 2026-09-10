# 📦 ANSLA Inventory Management System

> **Sistem Manajemen Inventaris Modern** dengan Integrasi Shopee, AI Assistant, dan Telegram Notifications

[![Status](https://img.shields.io/badge/status-production--ready-brightgreen)]()
[![Version](https://img.shields.io/badge/version-1.0.0-blue)]()
[![License](https://img.shields.io/badge/license-proprietary-red)]()

---

## 🌟 Highlights

- ✅ **Full-Stack Inventory Management** — Barang Masuk, Keluar, Stok Real-time
- ✅ **Shopee Integration** — Sync Produk, Pesanan, Payment API v2
- ✅ **AI Assistant** — Google Gemini 2.0 dengan context awareness
- ✅ **Telegram Notifications** — Real-time alerts dengan anti-spam
- ✅ **Progressive Web App** — Install di mobile, offline-capable
- ✅ **Modern UI/UX** — Tailwind CSS + custom design system
- ✅ **Sales Ledger v2** — 47-column schema dengan data finansial akurat

---

## 📊 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Google Apps Script (5,534 LOC) |
| **Frontend** | Vanilla JavaScript + HTML5 (7,388 LOC) |
| **Database** | Google Sheets |
| **UI Framework** | Tailwind CSS + Custom Design System |
| **AI Engine** | Google Gemini 2.0 Flash (536 LOC) |
| **Integrations** | Shopee Open API v2, Telegram Bot API |
| **PWA** | Service Worker, Web Manifest |

**Total Codebase:** 16,578 lines

---

## 🚀 Quick Start

### Prerequisites

- ✅ Google Account dengan akses Google Sheets
- ✅ Shopee Partner Account (untuk integrasi Shopee)
- ✅ Telegram Bot Token (opsional, untuk notifikasi)
- ✅ Google Gemini API Key (opsional, untuk AI Assistant)

### 1. Setup Backend (Google Sheets + Apps Script)

```bash
1. Copy Spreadsheet Template
   - Buka spreadsheet kosong di Google Sheets
   - Buat sheets: MasterBarang, Transaksi, Users, ShopeeProducts, 
     ShopeeOrders, SalesLedger, TelegramLogs

2. Deploy Google Apps Script
   - Extensions → Apps Script
   - Copy code dari code.gs
   - Deploy → New deployment → Web app
   - Execute as: Me
   - Who has access: Anyone
   - Copy deployment URL (ini adalah GAS_URL)

3. Configure Script Properties (SECURITY: jangan simpan secrets di source code)
   - Project Settings → Script Properties
   - Add properties berikut:
     ```
     TELEGRAM_BOT_TOKEN    = 8432793527:AAGgI9Nb-... (token asli dari BotFather)
     TELEGRAM_CHAT_ID      = 5223645564              (chat ID tujuan notifikasi)
     SHOPEE_PARTNER_KEY    = shpk4f5277697a4...      (key dari Shopee Partner Console)
     BACKUP_FOLDER_ID      = abc123def456            (ID folder Google Drive untuk backup)
     ```

4. **Verifikasi Setup Secrets**
   - Jalankan `verifySecrets()` dari GAS Editor
   - Cek log: semua status harus ✅
   - Atau dari frontend setelah login: Buka halaman Telegram → cek status secrets

5. **Setup Backup Trigger (SEKALI setelah deploy)**
   - GAS Editor → Triggers (⏰ icon, kiri sidebar)
   - Add Trigger
   - Function: `dailyBackup`
   - Event source: Time-driven
   - Type: Day timer
   - Time: 3:00 AM – 4:00 AM
   - Failure notification: Immediately
   - Simpan

   > Backup akan otomatis berjalan setiap jam 3 pagi. Backup lama (>30 hari) akan dihapus otomatis.
   > Untuk backup manual: POST `{ action: "runBackup" }` atau jalankan `dailyBackup()` dari GAS Editor.
```

### 2. Setup Frontend

```bash
# Option A: Deploy ke Netlify/Vercel
1. Push repo ke GitHub
2. Connect ke Netlify/Vercel
3. Deploy (automatic)

# Option B: Local Development
1. Open index.html di browser
2. Set GAS_URL via Settings panel
3. Login dengan credentials

# Default Admin:
# Email: admin@ansla.com
# Password: (create via Register)
```

### 3. Configure Shopee Integration

```bash
1. Dapatkan OAuth URL
   - Jalankan getShopeeAuthUrl() dari Apps Script Editor
   - Buka URL di browser
   - Authorize app

2. Exchange Code
   - Copy code & shop_id dari redirect URL
   - Jalankan exchangeShopeeCode(code, shopId)
   - Token tersimpan otomatis di PropertiesService

3. Setup Webhook (opsional)
   - Shopee Partner Console → Settings → Webhook
   - URL: your_gas_url
   - Events: ORDER_UPDATED
```

---

## 📚 Features

### 🏪 Core Inventory Management

- **Barang Masuk**
  - Barcode scanning (QR/1D)
  - Auto-lookup produk existing
  - Preview real-time dengan foto
  - Kategori: Katalog / Non-Katalog
  
- **Barang Keluar**
  - Validasi stok otomatis
  - Tujuan: Toko Offline / Online
  - Tracking riwayat per produk

- **Master Produk**
  - SKU generator
  - Variant management (warna, ukuran)
  - Status monitoring (Aman/Menipis/Habis)
  - Photo upload support

- **Riwayat Transaksi**
  - Complete audit trail
  - Filter by date, type, user
  - Export to Excel/CSV

### 🛒 Shopee Integration

- **Product Sync**
  - One-click sync dari Seller Centre
  - Auto-mapping dengan fuzzy matching
  - Batch operations (map/unmap)

- **Order Management**
  - Auto-sync pesanan (COMPLETED, TO_CONFIRM_RECEIVE)
  - Webhook real-time notifications
  - Deduction approval workflow
  - Return/refund handling

- **Payment API v2** ⭐ NEW
  - Accurate escrow data
  - Fee breakdown (commission, service, campaign, transaction)
  - Voucher tracking (Shopee vs Seller)
  - Settlement status monitoring

### 📊 Sales Ledger v2

- **7 KPI Cards**
  - Total Omzet
  - Pendapatan Bersih (Net Income)
  - Total Pesanan
  - Produk Terjual
  - Voucher Shopee
  - Voucher Seller
  - Total Fee

- **Advanced Table**
  - 47-column schema dengan data Payment API
  - Server-side pagination (25/50/100 rows)
  - Multi-filter (date, status, settlement)
  - Real-time search

- **Detail Drawer** (7 Sections)
  1. Informasi Pesanan
  2. Informasi Produk
  3. Rincian Pembayaran
  4. Rincian Ongkir
  5. Biaya Marketplace
  6. Penyesuaian
  7. Pendapatan

- **Finance Operations**
  - **Refresh Finance** — Update data pesanan tertentu
  - **Resync Finance** — Batch update 50 pesanan sekaligus
  - Export to Excel/CSV with full schema

### 🤖 AI Assistant

- **Powered by Google Gemini 2.0 Flash**
  - Context-aware (knows current page)
  - Natural language queries
  - Tool calling support
  - Conversation memory

- **Features**
  - Drag-and-drop widget
  - Chat history
  - Health monitoring
  - Permission system

- **Use Cases**
  - "Berapa stok Isia Dress Maroon size M?"
  - "Tampilkan 5 produk terlaris bulan ini"
  - "Buatkan laporan penjualan minggu lalu"

### 🔔 Telegram Notifications

- **Smart Alerts**
  - Stok menipis (1x per hari per SKU)
  - Pesanan baru
  - Deduction approval needed
  - Error alerts
  - Backup status

- **Dashboard**
  - Bot status monitoring
  - Success/fail rate
  - Recent logs (last 10)
  - Test notification button

### 📱 Progressive Web App

- **Installable**
  - Add to Home Screen (iOS/Android)
  - Native app experience

- **Offline Support**
  - Service Worker caching
  - Sync queue when back online

- **Features**
  - iOS Safari optimized
  - Android Chrome optimized
  - Responsive design (mobile-first)

---

## 🎨 Design System

### Components

- **Cards** — `.ds-card`, `.kpi-card`
- **Buttons** — `.ds-btn`, `.ds-btn-primary`, `.ds-btn-ghost`
- **Badges** — `.ds-badge`, `.ds-badge-green`, `.ds-badge-amber`
- **Tables** — `.ds-table` with responsive wrapper
- **Loading** — `.ds-skel` skeleton loader
- **Empty State** — `.ds-empty` with SVG icons

### Layout

- **Sidebar** — Enterprise layout dengan collapse
- **Header** — Fixed top with breadcrumb & actions
- **Main** — Scrollable content area
- **Drawer** — Right-side detail panel

### Icons

- **Phosphor Icons** (SVG inline, no emoji)
- Consistent sizing (16px, 18px, 24px)

---

## 📂 Project Structure

```
D:\Projek Web\App_Inventaris_Normal\
├── code.gs                    # Backend (Google Apps Script) - 5,534 lines
├── index.html                 # Frontend (HTML + inline JS) - 7,388 lines
├── sales-ledger.js           # Sales Ledger module - 686 lines
├── sw.js                     # Service Worker - 71 lines
├── manifest.json             # PWA manifest
├── package.json              # Dependencies (@google/genai)
│
├── ai/                       # AI Assistant modules (12 files)
│   ├── AIService.js          # Main AI service - 536 lines
│   ├── AIContext.js          # Context management - 515 lines
│   ├── AITools.js            # Tool definitions - 403 lines
│   ├── AIRouter.js           # Request routing - 227 lines
│   └── ...                   # AICache, AIConfig, AIHealth, etc.
│
├── icons/                    # PWA icons (9 sizes)
│   └── logo-ansla.png        # Brand logo
│
├── .kiro/specs/              # Project specifications
│   ├── sales-ledger/
│   └── sales-ledger-v2/      # Latest spec (tasks, requirements, design)
│
└── docs/                     # Documentation
    ├── ANALISIS_PROYEK.md    # This analysis (17 KB)
    └── REKOMENDASI_PRIORITAS.md  # Action plan (17 KB)
```

---

## 🔒 Security Notes

### ✅ Status setelah Security Fix (7 Juli 2026)

**Yang sudah diperbaiki:**
1. ✅ **Hardcoded secrets sudah dipindahkan ke PropertiesService**
   - `TELEGRAM_BOT_TOKEN` → `_getTelegramBotToken()` (via Script Properties)
   - `TELEGRAM_CHAT_ID` → `_getTelegramChatId()` (via Script Properties)
   - `SHOPEE_PARTNER_KEY` → `_getShopeePartnerKey()` (via Script Properties)
   - Cache layer (CacheService + PropertiesService) untuk performance

2. ✅ **Automated backup** sudah ditambahkan:
   - Fungsi `dailyBackup()` — backup harian ke Google Drive
   - Fungsi `_cleanupOldBackups()` — hapus backup >30 hari
   - Fungsi `verifySecrets()` — cek status semua secrets
   - Trigger time-based (jam 3 pagi)

3. ⏳ **Yang belum (rencana next):**
   - 🔴 Password hashing per-user salt (masih pakai static salt)
   - 🔴 Unit tests
   - 🟡 Error tracking (Sentry)

**Cek status secrets dari frontend:**
- Buka halaman Telegram → akan tampil status koneksi bot
- Atau jalankan `verifySecrets()` dari GAS Editor

**Setup Properties (wajib setelah deploy baru):**
```
GAS Editor → Project Settings → Script Properties:
  TELEGRAM_BOT_TOKEN    = token_dari_botfather
  TELEGRAM_CHAT_ID      = chat_id_tujuan
  SHOPEE_PARTNER_KEY    = key_dari_shopee_console
  BACKUP_FOLDER_ID      = id_folder_drive_untuk_backup
```

---

## 🧪 Testing

### Current Status
- ❌ **Unit Tests:** None
- ❌ **Integration Tests:** None
- ✅ **Manual Testing:** Extensive

### Recommended Setup
```bash
# Install testing framework
npm install --save-dev jest @types/google-apps-script

# Run tests
npm test

# Coverage report
npm run coverage
```

Target: **50% coverage** for critical functions (auth, payment, validation)

---

## 📈 Performance

### Current Metrics
- ✅ Initial page load: ~2-3s
- ✅ API response time: ~1-2s (p95)
- ⚠️ Large table render: ~5-10s (1000+ rows)
- ⚠️ Excel export: ~20-30s (10K rows)

### Optimization Opportunities
1. Implement IndexedDB caching (5 min TTL for KPI)
2. Virtual scrolling for tables >1000 rows
3. Web Worker for Excel export
4. Lazy loading for images

---

## 🚨 Known Limitations

1. **Database:** Google Sheets (max 5M cells)
   - For >10K products, consider migration to Firestore/Supabase

2. **Execution Time:** GAS has 6-minute limit
   - Batch operations capped at 50 orders (resyncFinance)

3. **Concurrent Users:** Not optimized for >10 simultaneous users
   - Add queue system if needed

4. **Offline Mode:** Limited (read-only cached data)
   - Full offline CRUD requires IndexedDB + sync queue

---

## 🔧 Troubleshooting

### Common Issues

**1. "GAS_URL belum dikonfigurasi"**
```javascript
// Solution: Set GAS_URL via Settings panel
// Or in browser console:
localStorage.setItem('GAS_URL', 'https://script.google.com/macros/s/.../exec');
```

**2. "Shopee API error: error_auth"**
```javascript
// Solution: Token expired, refresh manually
// Run from Apps Script Editor:
refreshShopeeAccessToken();
```

**3. "Telegram notification failed"**
```javascript
// Check TelegramLogs sheet for error details
// Verify bot token & chat ID in PropertiesService
```

**4. "Payment API returns empty data"**
```javascript
// Order must be COMPLETED or TO_CONFIRM_RECEIVE
// Check if app has Payment API permission in Shopee Partner Console
```

---

## 📄 Documentation

- [📊 **ANALISIS_PROYEK.md**](./ANALISIS_PROYEK.md) — Detailed project analysis (17 KB)
- [🎯 **REKOMENDASI_PRIORITAS.md**](./REKOMENDASI_PRIORITAS.md) — Action plan & priorities (17 KB)
- [📐 **Design Spec**](./.kiro/specs/sales-ledger-v2/design.md) — Architecture & components
- [📋 **Requirements**](./.kiro/specs/sales-ledger-v2/requirements.md) — Feature requirements
- [✅ **Tasks**](./.kiro/specs/sales-ledger-v2/tasks.md) — Implementation checklist

---

## 🤝 Contributing

This is a proprietary project. For internal development:

1. Create feature branch from `main`
2. Follow existing code style
3. Add tests for new features
4. Update documentation
5. Submit for review

---

## 📜 License

**Proprietary** — ANSLA © 2026  
All rights reserved.

---

## 🙏 Acknowledgments

- **Shopee Open API** — E-commerce integration
- **Google Gemini** — AI capabilities
- **Telegram Bot API** — Notifications
- **Tailwind CSS** — Styling framework
- **Phosphor Icons** — Icon library

---

## 📞 Support

For issues, questions, or feature requests:
- 📧 Email: alfaruqi752@gmail.com
- 📱 Telegram: @alfaruqiw
- 📝 GitHub Issues: (if applicable)

---

**Built with ❤️ by ANSLA Development Team**

_Last updated: July 7, 2026_
