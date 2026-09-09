// ============================================================
// NotificationCenter/TelegramDatabase.gs — DB Sheets Management
// ============================================================

const TELEGRAM_USERS_SHEET = "TelegramUsers";
const TELEGRAM_TEMPLATES_SHEET = "TelegramTemplates";
const TELEGRAM_QUEUE_SHEET = "TelegramQueue";

const TELEGRAM_USERS_HEADERS = [
  "ID", "TelegramName", "Username", "ChatID", "Role", "Active", 
  "CreatedAt", "UpdatedAt", "LastError", "Status", "LastActive", "Rules",
  "PendingNotificationSent", "ApprovedNotificationSent", "ActivatedNotificationSent", "RejectedNotificationSent", "WelcomeNotificationSent"
];

const TELEGRAM_TEMPLATES_HEADERS = ["TemplateID", "Name", "Body", "UpdatedAt"];

const TELEGRAM_QUEUE_HEADERS = [
  "QueueID", "Timestamp", "ChatID", "Username", "Text", "Status", "RetryCount", "ErrorMessage",
  "NotificationType", "EntityKey", "IdempotencyKey"
];

const TELEGRAM_HISTORY_SHEET = "TelegramNotificationHistory";
const TELEGRAM_HISTORY_HEADERS = [
  "NotificationID", "ChatID", "UserID", "Event", "OldStatus", "NewStatus", "MessageType", "MessageHash", "SentAt", "Success", "RetryCount", "Source"
];

/**
 * Pastikan seluruh tabel pendukung Telegram siap di spreadsheet.
 */
function ensureTelegramDatabase() {
  ensureDatabase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Sheet Users
  let userSheet = ss.getSheetByName(TELEGRAM_USERS_SHEET);
  if (!userSheet) {
    userSheet = ss.insertSheet(TELEGRAM_USERS_SHEET);
    userSheet.appendRow(TELEGRAM_USERS_HEADERS);
    userSheet.getRange(1, 1, 1, TELEGRAM_USERS_HEADERS.length)
      .setFontWeight("bold").setBackground("#2563EB").setFontColor("#FFFFFF");
  } else {
    // Jalankan migrasi kolom jika ada kolom baru yang belum ada
    const lastCol = userSheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = userSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      TELEGRAM_USERS_HEADERS.forEach(h => {
        if (currentHeaders.indexOf(h) === -1) {
          const nextCol = userSheet.getLastColumn() + 1;
          userSheet.getRange(1, nextCol).setValue(h)
            .setFontWeight("bold").setBackground("#2563EB").setFontColor("#FFFFFF");
        }
      });
    } else {
      userSheet.appendRow(TELEGRAM_USERS_HEADERS);
      userSheet.getRange(1, 1, 1, TELEGRAM_USERS_HEADERS.length)
        .setFontWeight("bold").setBackground("#2563EB").setFontColor("#FFFFFF");
    }
  }

  // 2. Sheet Templates
  let templateSheet = ss.getSheetByName(TELEGRAM_TEMPLATES_SHEET);
  if (!templateSheet) {
    templateSheet = ss.insertSheet(TELEGRAM_TEMPLATES_SHEET);
    templateSheet.appendRow(TELEGRAM_TEMPLATES_HEADERS);
    templateSheet.getRange(1, 1, 1, TELEGRAM_TEMPLATES_HEADERS.length)
      .setFontWeight("bold").setBackground("#059669").setFontColor("#FFFFFF");
    
    // Isi default templates
    populateDefaultTemplates(templateSheet);
  }
  ensureStockProductionTelegramTemplates(templateSheet);

  // 3. Sheet Queue & History
  let queueSheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
  if (!queueSheet) {
    queueSheet = ss.insertSheet(TELEGRAM_QUEUE_SHEET);
    queueSheet.appendRow(TELEGRAM_QUEUE_HEADERS);
    queueSheet.getRange(1, 1, 1, TELEGRAM_QUEUE_HEADERS.length)
      .setFontWeight("bold").setBackground("#D97706").setFontColor("#FFFFFF");
  } else {
    const queueHeaders = queueSheet.getRange(1, 1, 1, queueSheet.getLastColumn()).getValues()[0];
    TELEGRAM_QUEUE_HEADERS.forEach(h => {
      if (queueHeaders.indexOf(h) === -1) queueSheet.getRange(1, queueSheet.getLastColumn() + 1).setValue(h);
    });
  }

  // 4. Sheet History
  let historySheet = ss.getSheetByName(TELEGRAM_HISTORY_SHEET);
  if (!historySheet) {
    historySheet = ss.insertSheet(TELEGRAM_HISTORY_SHEET);
    historySheet.appendRow(TELEGRAM_HISTORY_HEADERS);
    historySheet.getRange(1, 1, 1, TELEGRAM_HISTORY_HEADERS.length)
      .setFontWeight("bold").setBackground("#2563EB").setFontColor("#FFFFFF");
  }
}

function ensureStockProductionTelegramTemplates(sheet) {
  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(row => { existing[String(row[0])] = true; });
  }
  const templates = [
    ["STOCK_LOW", "Stok Menipis", "<b>STOK MENIPIS</b>\nSKU: <code>{{sku}}</code>\nProduk: {{product}}\nStok: <b>{{stock}}</b>\nMinimum: {{min_stock}}", new Date()],
    ["STOCK_CRITICAL", "Stok Kritis", "<b>STOK KRITIS</b>\nSKU: <code>{{sku}}</code>\nProduk: {{product}}\nStok: <b>{{stock}}</b>\nPrioritas: {{priority}}", new Date()],
    ["PRODUCTION_REQUIRED", "Produksi Diperlukan", "<b>URGENSI STOK PRODUKSI</b>\n{{table}}\nTotal item produksi: {{total_items}}", new Date()],
    ["PRODUCTION_SUMMARY", "Ringkasan Produksi", "<b>RINGKASAN PRODUKSI {{date}}</b>\n{{note}}", new Date()],
    ["PRODUCTION_COMPLETED", "Produksi Selesai", "<b>PRODUKSI SELESAI</b>\nSKU: <code>{{sku}}</code>\nProduk: {{product}}\nSelesai: <b>{{production_qty}}</b> unit\nOperator: {{user}}", new Date()]
  ];
  templates.forEach(row => { if (!existing[row[0]]) sheet.appendRow(row); });
}

/**
 * Mengisi template bawaan default.
 */
function populateDefaultTemplates(sheet) {
  const defaults = [
    [
      "ORDER_NEW", 
      "Order Baru", 
      "📦 <b>ORDER BARU</b>\n\nPembeli: {{buyer}}\nOrder: <code>{{invoice}}</code>\n\nSilakan cek panel pesanan.",
      new Date()
    ],
    [
      "ORDER_PAID", 
      "Order Dibayar", 
      "💰 <b>ORDER DIBAYAR</b>\n\nPembeli: {{buyer}}\nOrder: <code>{{invoice}}</code>\nJumlah: Rp {{amount}}\n\nDana sudah dikonfirmasi masuk.",
      new Date()
    ],
    [
      "ORDER_READY", 
      "Perlu Dikirim", 
      "🚚 <b>PESANAN PERLU DIKIRIM</b>\n\nPembeli: {{buyer}}\nOrder: <code>{{invoice}}</code>\nKurir: {{courier}}\n\nSiapkan packing barang sekarang.",
      new Date()
    ],
    [
      "ORDER_CANCEL", 
      "Order Dibatalkan", 
      "❌ <b>PESANAN DIBATALKAN</b>\n\nPembeli: {{buyer}}\nOrder: <code>{{invoice}}</code>\nAlasan: {{reason}}\n\nStok produk otomatis dikembalikan.",
      new Date()
    ],
    [
      "STOCK_MIN", 
      "Stok Menipis", 
      "⚠️ <b>PERINGATAN STOK MENIPIS</b>\n\nSKU: <code>{{sku}}</code>\nNama: {{product}}\nSisa Stok: <b>{{stock}}</b> (Minimum: {{min_stock}})",
      new Date()
    ],
    [
      "STOCK_EMPTY", 
      "Stok Habis", 
      "🚨 <b>PERINGATAN STOK HABIS!</b>\n\nSKU: <code>{{sku}}</code>\nNama: {{product}}\n\nStok saat ini kosong. Harap segera lakukan restock.",
      new Date()
    ],
    [
      "STOCK_UNMAPPED", 
      "Mapping Produk Gagal", 
      "❌ <b>MAPPING PRODUK GAGAL</b>\n\nID Shopee: <code>{{shopee_id}}</code>\nNama Produk: {{product}}\n\nSegera petakan produk ini secara manual.",
      new Date()
    ],
    [
      "SYS_RECOVERY", 
      "Recovery Center Event", 
      "🔧 <b>RECOVERY CENTER MAINTENANCE</b>\n\nTool: {{tool}}\nStatus: <b>{{status}}</b>\nTerdampak: {{affected}} baris\nDurasi: {{duration}}\nCatatan: {{note}}",
      new Date()
    ],
    [
      "SYS_BACKUP", 
      "Database Backup", 
      "💾 <b>BACKUP DATABASE SUKSES</b>\n\nNama File: {{filename}}\nTanggal: {{date}}\nStatus: Aktif",
      new Date()
    ],
    [
      "SYS_ERROR", 
      "System Error Alert", 
      "🚨 <b>ALERT SYSTEM ERROR</b>\n\nModul: {{module}}\nPesan Error: <code>{{error}}</code>\nTanggal: {{date}}",
      new Date()
    ],
    [
      "SYS_DEDUCTION", 
      "Order Deduction Event", 
      "🔄 <b>DEDUCTION UPDATE</b>\n\nOrder SN: <code>{{order_sn}}</code>\nStatus: {{status}}\nOperator: {{user}}",
      new Date()
    ],
    [
      "AI_SUMMARY",
      "AI Daily Summary",
      "🤖 <b>RINGKASAN HARIAN AI</b>\n\nAnalisis Penjualan: {{note}}\nInsight Produk: {{product}}\n\nLaporan ini dibuat secara otomatis oleh ANSLA AI Assistant.",
      new Date()
    ],
    [
      "AI_INSIGHT",
      "AI Business Insight",
      "💡 <b>AI BUSINESS INSIGHT</b>\n\nKategori: {{module}}\nAnalisis: {{note}}\nRekomendasi: {{error}}",
      new Date()
    ],
    [
      "AI_ALERT",
      "AI Anomaly Alert",
      "🚨 <b>AI ANOMALI ALERT</b>\n\nAnomali terdeteksi pada: {{module}}\nDetail: {{note}}\nSaran tindakan: {{error}}",
      new Date()
    ]
  ];
  
  defaults.forEach(row => sheet.appendRow(row));
}
