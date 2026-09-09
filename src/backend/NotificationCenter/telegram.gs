// ============================================================
// telegram.gs - Telegram Auto Registration & Multi User Notification
// ============================================================

// ── NOTIFICATION CONTEXT ──────────────────────────────────────
const NotificationContext = {
  REALTIME: "REALTIME",
  HISTORICAL_SYNC: "HISTORICAL_SYNC",
  RECOVERY: "RECOVERY",
  REPAIR: "REPAIR",
  MIGRATION: "MIGRATION",
  SYSTEM: "SYSTEM",
  REBUILD_LEDGER: "REBUILD_LEDGER",
  REFRESH_KPI: "REFRESH_KPI",
  REFRESH_SETTLEMENT: "REFRESH_SETTLEMENT",
  REFRESH_MAPPING: "REFRESH_MAPPING",
  REFRESH_ORDER_STATUS: "REFRESH_ORDER_STATUS",
  IMPORT: "IMPORT",
  BACKFILL: "BACKFILL"
};

// Global context tracker
let _currentNotificationContext = NotificationContext.REALTIME;

/**
 * Set notification context
 */
function setNotificationContext(context) {
  _currentNotificationContext = context;
  console.log("[NotificationContext] Set to: " + context);
}

/**
 * Get current notification context
 */
function getNotificationContext() {
  return _currentNotificationContext;
}

/**
 * Check if Telegram notifications are allowed in current context
 */
function canSendTelegram() {
  const allowed = [NotificationContext.REALTIME, NotificationContext.SYSTEM];
  const can = allowed.indexOf(_currentNotificationContext) >= 0;
  if (!can) {
    console.log("[NotificationRouter] Telegram SUPPRESSED in context: " + _currentNotificationContext);
  }
  return can;
}

// ── DATABASE SCHEMA (Declared globally in TelegramDatabase.gs) ─────────────────

/**
 * Ensure TelegramUsers sheet exists
 */
function ensureTelegramUsersSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(TELEGRAM_USERS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(TELEGRAM_USERS_SHEET);
      sheet.appendRow(TELEGRAM_USERS_HEADERS);
      sheet.getRange(1, 1, 1, TELEGRAM_USERS_HEADERS.length)
        .setFontWeight("bold")
        .setBackground("#4285F4")
        .setFontColor("#FFFFFF");
      console.log("[TelegramUsers] Sheet created");
    }
    return sheet;
  } catch (err) {
    console.log("[ensureTelegramUsersSheet] Error: " + err.toString());
    return null;
  }
}

// ── TELEGRAM BOT WEBHOOK HANDLER ──────────────────────────────
/**
 * Handle incoming Telegram updates (webhook)
 * Called by Telegram when user presses /start
 */
function handleTelegramWebhook(update) {
  try {
    if (!update) return { status: "ignored" };

    // Telegram callback data is an untrusted pointer only. Queue ownership and
    // status are always re-read by the production control handler.
    if (update.callback_query) return handleTelegramProductionCallback(update.callback_query);
    if (!update.message) return { status: "ignored" };
    
    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || "";
    const sender = message.from || {};
    const firstName = sender.first_name || "";
    const lastName = sender.last_name || "";
    const username = sender.username || "";
    
    console.log("[TelegramWebhook] Received from chatId=" + chatId + ", text=" + text);

    // ProductionRecipient photo reports are document uploads only. They never
    // enter the queue/lifecycle handlers below.
    if (Array.isArray(message.photo) && message.photo.length && typeof stockProductionReportsHandlePhoto === "function") {
      var photoReport = stockProductionReportsHandlePhoto(message, update.update_id);
      if (photoReport && photoReport.handled) return photoReport;
    }
    
    // /id is read directly from the Telegram update and does not use a
    // username as an address. It intentionally does not touch TelegramUsers.
    if (/^\/id(?:@[^\s]+)?(?:\s|$)/i.test(text)) {
      return handleTelegramId(chatId, firstName, lastName, username);
    }

    // An active ProductionRecipient receives the Konveksi control menu. All
    // other chats preserve the existing user/customer /start registration flow.
    if (text.startsWith("/start")) {
      var productionMenu = handleTelegramProductionRecipientMenu(chatId);
      if (productionMenu && productionMenu.handled) return productionMenu;
      return handleTelegramStart(chatId, firstName, lastName, username);
    }

    if (/^\/produksi(?:@[^\s]+)?(?:\s|$)/i.test(text)) {
      var requestedMenu = handleTelegramProductionRecipientMenu(chatId);
      if (requestedMenu && requestedMenu.handled) return requestedMenu;
      sendTelegramToChatId(chatId, "ℹ️ Menu Konveksi tidak tersedia untuk akun Telegram ini.");
      return { status: "error", message: "Production recipient tidak ditemukan." };
    }

    // Do not let an old Telegram quantity session mutate a queue after the
    // control menu has been retired. A report is submitted as a photo only.
    if (typeof stockProductionReportsResolveRecipient === "function" && stockProductionReportsResolveRecipient(chatId).status === "resolved") {
      if (typeof stockProductionTelegramClearSession === "function") stockProductionTelegramClearSession(chatId);
      return { handled: true, status: "ignored", message: "Kirim foto formulir melalui menu Lapor Produksi Selesai." };
    }
    
    return { status: "ignored" };
  } catch (err) {
    console.log("[TelegramWebhook] Error: " + err.toString());
    var failedChatId = update && update.message && update.message.chat && update.message.chat.id;
    if (err && err.reportStage && typeof stockProductionReportsFailure === "function") {
      return stockProductionReportsFailure(failedChatId, err, err.reportStage);
    }
    return { status: "error", message: err.toString() };
  }
}

function stockProductionTelegramQueueCounts(queues) {
  var counts = { pending: 0, inProgress: 0, completed: 0 };
  (queues || []).forEach(function(queue) {
    var status = String(queue && queue.status || "").toUpperCase();
    if (status === "PENDING") counts.pending += 1;
    if (status === "IN_PROGRESS") counts.inProgress += 1;
    if (status === "COMPLETED") counts.completed += 1;
  });
  return counts;
}

function stockProductionTelegramMenuKeyboard(counts) {
  return {
    inline_keyboard: [
      [{ text: "📷 Lapor Produksi Selesai", callback_data: "prod:report:new" }],
      [{ text: "📊 Riwayat Laporan", callback_data: "prod:reports:1" }],
      [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]
    ]
  };
}

function stockProductionTelegramMenuKeyboardForChat(chatId) {
  return stockProductionTelegramMenuKeyboard();
}

function stockProductionTelegramQueueKeyboard(queue) {
  var queueId = String(queue && queue.queueId || "");
  var status = String(queue && queue.status || "").toUpperCase();
  var rows = [[{ text: "📋 DETAIL PRODUKSI", callback_data: "prod:detail:" + queueId }]];
  if (status === "PENDING") rows.push([{ text: "▶️ AMBIL PRODUKSI", callback_data: "prod:start:" + queueId }]);
  if (status === "IN_PROGRESS") rows.push([{ text: "✅ SELESAI", callback_data: "prod:complete:" + queueId }]);
  rows.push([{ text: "⬅️ Kembali", callback_data: "prod:menu" }]);
  return { inline_keyboard: rows };
}

function stockProductionTelegramFormatDate(value) {
  if (!value) return "-";
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, STOCK_PRODUCTION_TIMEZONE || "Asia/Jakarta", "dd/MM/yyyy HH:mm");
}

function stockProductionTelegramQueueStatusLabel(status) {
  var normalized = String(status || "").toUpperCase();
  if (normalized === "PENDING") return "🚨 PERLU PRODUKSI";
  if (normalized === "IN_PROGRESS") return "🔵 SEDANG PRODUKSI";
  if (normalized === "COMPLETED") return "✅ SELESAI";
  return normalized || "-";
}

function stockProductionTelegramQueueText(queue, detail) {
  var status = String(queue && queue.status || "").toUpperCase();
  var detailTitle = status === "COMPLETED" ? "📦 <b>PRODUKSI SELESAI</b>" : "📋 <b>DETAIL PRODUKSI</b>";
  var lines = [detail ? detailTitle : stockProductionTelegramQueueStatusLabel(status), "", "Produk:", stockProductionTelegramCell(queue && queue.product || "-"), "", "Warna / Ukuran:", stockProductionTelegramCell(queue && queue.color || "-") + " / " + stockProductionTelegramCell(queue && queue.size || "-")];
  if (detail) lines.push("", "SKU:", stockProductionTelegramCell(queue && queue.sku || "-"), "", "Stok sekarang:", queue && queue.currentStock !== null && queue.currentStock !== undefined ? String(queue.currentStock) : "-", "", "Minimum:", queue && queue.minimumStock !== null && queue.minimumStock !== undefined ? String(queue.minimumStock) : "-", "", "Target:", queue && queue.targetStock !== null && queue.targetStock !== undefined ? String(queue.targetStock) : "-");
  lines.push("", "Kebutuhan sistem:", String(queue && queue.recommendedQty || 0) + " pcs");
  if (status === "IN_PROGRESS" || status === "COMPLETED") lines.push("", "Jumlah produksi:", String(queue && queue.productionQty || 0) + " pcs");
  if (status === "COMPLETED") lines.push("", "Jumlah selesai:", String(queue && queue.completedQty || 0) + " pcs");
  lines.push("", "Status:", stockProductionTelegramQueueStatusLabel(status));
  if (status === "IN_PROGRESS") lines.push("", "Dimulai:", stockProductionTelegramFormatDate(queue.startedAt));
  if (status === "COMPLETED") lines.push("", "Selesai:", stockProductionTelegramFormatDate(queue.completedAt), "", "📦 Menunggu barang masuk ke gudang.");
  return lines.join("\n");
}

function stockProductionTelegramQueueListText(title, queues) {
  var lines = [title, "", String((queues || []).length) + " pekerjaan"];
  (queues || []).forEach(function(queue, index) {
    lines.push("", String(index + 1) + ".", stockProductionTelegramCell(queue.product || "-"), stockProductionTelegramCell(queue.color || "-") + " / " + stockProductionTelegramCell(queue.size || "-"), "Kebutuhan: " + String(queue.recommendedQty || 0) + " pcs");
    if (queue.status === "IN_PROGRESS" || queue.status === "COMPLETED") lines.push("Produksi: " + String(queue.productionQty || 0) + " pcs");
    if (queue.status === "COMPLETED") lines.push("Selesai: " + String(queue.completedQty || 0) + " pcs");
    lines.push("Urgensi: " + stockProductionTelegramCell(queue.movingStat || "-"));
    if (queue.status === "IN_PROGRESS") lines.push("Dimulai: " + stockProductionTelegramFormatDate(queue.startedAt));
    if (queue.status === "COMPLETED") lines.push("Selesai: " + stockProductionTelegramFormatDate(queue.completedAt));
  });
  return lines.join("\n");
}

function handleTelegramProductionRecipientMenu(chatId) {
  try {
    if (typeof stockProductionReportsResolveRecipient !== "function") return { handled: false };
    var resolution = stockProductionReportsResolveRecipient(chatId);
    if (!resolution || resolution.status !== "resolved") return { handled: false };
    var message = "🏭 <b>KONVEKSI</b>\n\n" + stockProductionTelegramCell(resolution.recipient.name) + "\n\nPilih layanan:";
    var sent = sendTelegramToChatId(chatId, message, { replyMarkup: stockProductionTelegramMenuKeyboard() });
    return { status: sent ? "success" : "error", handled: true, message: sent ? "Menu Konveksi dikirim." : "Gagal mengirim menu Konveksi." };
  } catch (err) {
    console.log("[TelegramProductionMenu] Error: " + err.toString());
    return { handled: false, status: "error", message: "Menu Konveksi gagal dimuat." };
  }
}

var STOCK_PRODUCTION_TELEGRAM_SESSION_PREFIX = "stock_production_telegram_session:";
var STOCK_PRODUCTION_TELEGRAM_SESSION_TTL_SECONDS = 900;

function stockProductionTelegramSessionKey(chatId) {
  return STOCK_PRODUCTION_TELEGRAM_SESSION_PREFIX + String(chatId || "").trim();
}

function stockProductionTelegramReadSession(chatId) {
  try {
    var raw = CacheService.getScriptCache().get(stockProductionTelegramSessionKey(chatId));
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.chatId === String(chatId || "").trim() ? parsed : null;
  } catch (error) {
    return null;
  }
}

function stockProductionTelegramWriteSession(chatId, state) {
  var value = state || {};
  value.chatId = String(chatId || "").trim();
  value.updatedAt = new Date().getTime();
  CacheService.getScriptCache().put(stockProductionTelegramSessionKey(chatId), JSON.stringify(value), STOCK_PRODUCTION_TELEGRAM_SESSION_TTL_SECONDS);
  return value;
}

function stockProductionTelegramClearSession(chatId) {
  try { CacheService.getScriptCache().remove(stockProductionTelegramSessionKey(chatId)); } catch (ignoreError) {}
}

function stockProductionTelegramFindOwnedQueue(chatId, queueId, expectedStatus) {
  var result = stockProductionGetTelegramRecipientQueues({ chatId: chatId, status: expectedStatus || "" });
  if (!result || result.status !== "success") return { status: "error", message: "Akses Konveksi tidak tersedia." };
  var queue = (result.queues || []).filter(function(item) { return item.queueId === String(queueId || ""); })[0];
  if (!queue) return { status: "error", message: "Pekerjaan produksi tidak ditemukan atau tidak dapat diakses." };
  return { status: "success", queue: queue, recipient: result.recipient };
}

function stockProductionTelegramConfirmationKeyboard(action, queueId, quantity) {
  var normalized = String(action || "").toLowerCase();
  return {
    inline_keyboard: [
      [{ text: normalized === "start" ? "✅ MULAI " + quantity + " PCS" : "✅ KONFIRMASI SELESAI", callback_data: "prod:" + normalized + "-confirm:" + queueId }],
      [{ text: "✏️ Ubah Jumlah", callback_data: "prod:" + normalized + "-edit:" + queueId }, { text: "❌ Batal", callback_data: "prod:cancel" }],
      [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]
    ]
  };
}

function stockProductionTelegramBeginQuantityInput(chatId, queueId, action) {
  var normalizedAction = String(action || "").toUpperCase();
  var expectedStatus = normalizedAction === "START" ? "PENDING" : "IN_PROGRESS";
  var found = stockProductionTelegramFindOwnedQueue(chatId, queueId, expectedStatus);
  if (found.status !== "success") return found;
  stockProductionTelegramWriteSession(chatId, { queueId: found.queue.queueId, action: normalizedAction, phase: "INPUT" });
  var queue = found.queue;
  var text;
  if (normalizedAction === "START") {
    text = "📦 <b>AMBIL PRODUKSI</b>\n\n" + stockProductionTelegramCell(queue.product) + "\n" + stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size) + "\n\nKebutuhan sistem:\n" + queue.recommendedQty + " pcs\n\nBerapa pcs yang sanggup Anda produksi?\n\nKetik jumlah:";
  } else {
    text = "✅ <b>SELESAI PRODUKSI</b>\n\n" + stockProductionTelegramCell(queue.product) + "\n" + stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size) + "\n\nJumlah yang direncanakan:\n" + queue.productionQty + " pcs\n\nBerapa pcs yang benar-benar selesai diproduksi?\n\nKetik jumlah:";
  }
  var sent = sendTelegramToChatId(chatId, text, { replyMarkup: { inline_keyboard: [[{ text: "❌ Batal", callback_data: "prod:cancel" }], [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]] } });
  return { status: sent ? "success" : "error", queue: queue, message: sent ? "Menunggu input jumlah." : "Gagal meminta input jumlah." };
}

function handleTelegramProductionRecipientText(chatId, text) {
  var state = stockProductionTelegramReadSession(chatId);
  if (!state || state.phase !== "INPUT") return { handled: false };
  var quantity;
  try {
    quantity = stockProductionNormalizePositiveInteger(text, state.action === "START" ? "Jumlah produksi" : "Jumlah selesai produksi");
  } catch (error) {
    sendTelegramToChatId(chatId, "❌ " + (error.message || String(error)) + "\n\nKetik jumlah lagi.");
    return { handled: true, status: "error", message: error.message || String(error) };
  }
  var expectedStatus = state.action === "START" ? "PENDING" : "IN_PROGRESS";
  var found = stockProductionTelegramFindOwnedQueue(chatId, state.queueId, expectedStatus);
  if (found.status !== "success") {
    stockProductionTelegramClearSession(chatId);
    sendTelegramToChatId(chatId, "❌ " + found.message);
    return { handled: true, status: "error", message: found.message };
  }
  state.phase = "CONFIRM";
  state.quantity = quantity;
  stockProductionTelegramWriteSession(chatId, state);
  var queue = found.queue;
  var lines = state.action === "START"
    ? ["📋 <b>KONFIRMASI PRODUKSI</b>", "", stockProductionTelegramCell(queue.product), stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size), "", "Kebutuhan sistem: " + queue.recommendedQty + " pcs", "Sanggup produksi: " + quantity + " pcs"]
    : ["📋 <b>KONFIRMASI SELESAI</b>", "", stockProductionTelegramCell(queue.product), stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size), "", "Direncanakan: " + queue.productionQty + " pcs", "Selesai: " + quantity + " pcs", "", "Kebutuhan sistem: " + queue.recommendedQty + " pcs"];
  if (quantity < queue.recommendedQty) lines.push("", state.action === "COMPLETE" ? "⚠️ Produksi aktual masih di bawah kebutuhan sistem." : "⚠️ Jumlah produksi di bawah kebutuhan sistem.");
  var sent = sendTelegramToChatId(chatId, lines.join("\n"), { replyMarkup: stockProductionTelegramConfirmationKeyboard(state.action, queue.queueId, quantity) });
  return { handled: true, status: sent ? "success" : "error", queue: queue, quantity: quantity };
}

function stockProductionTelegramProductKeyboard(prefix, items) {
  var groups = {};
  (items || []).forEach(function(item) {
    var product = String(item.product || "-");
    if (!groups[product]) groups[product] = item;
  });
  var rows = Object.keys(groups).sort().map(function(product) {
    var item = groups[product];
    return [{ text: "👗 " + product, callback_data: prefix + ":" + (item.queueId || item.sku) }];
  });
  rows.push([{ text: "⬅️ Kembali", callback_data: "prod:menu" }]);
  return { inline_keyboard: rows };
}

function stockProductionTelegramVariantKeyboard(queues, product) {
  var rows = (queues || []).filter(function(queue) { return queue.product === product; }).map(function(queue) {
    return [{ text: stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size), callback_data: "prod:detail:" + queue.queueId }];
  });
  rows.push([{ text: "⬅️ Kembali", callback_data: "prod:pending" }]);
  return { inline_keyboard: rows };
}

function answerTelegramCallbackQuery(callbackId, text, showAlert) {
  try {
    if (!callbackId) return false;
    var url = "https://api.telegram.org/bot" + _getTelegramBotToken() + "/answerCallbackQuery";
    var payload = { callback_query_id: String(callbackId), text: String(text || ""), show_alert: showAlert === true };
    var response = UrlFetchApp.fetch(url, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
    return !!JSON.parse(response.getContentText()).ok;
  } catch (err) {
    console.log("[TelegramProductionCallback] answer failed: " + err.toString());
    return false;
  }
}

function editTelegramInlineKeyboard(chatId, messageId, replyMarkup) {
  try {
    if (!chatId || !messageId) return false;
    var url = "https://api.telegram.org/bot" + _getTelegramBotToken() + "/editMessageReplyMarkup";
    var payload = { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup };
    var response = UrlFetchApp.fetch(url, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
    return !!JSON.parse(response.getContentText()).ok;
  } catch (err) {
    console.log("[TelegramProductionCallback] keyboard edit failed: " + err.toString());
    return false;
  }
}

function handleTelegramProductionCallback(callback) {
  var chatId = callback && callback.message && callback.message.chat && callback.message.chat.id;
  var callbackId = callback && callback.id;
  var data = String(callback && callback.data || "");
  if (!chatId || !callbackId) return { status: "ignored", message: "Callback tidak lengkap." };
  answerTelegramCallbackQuery(callbackId, "Memproses...");
  try {
    if (data === "prod:menu") return handleTelegramProductionRecipientMenu(chatId);
    if (data === "prod:report:new") {
      return typeof stockProductionReportsPrompt === "function"
        ? stockProductionReportsPrompt(chatId)
        : { status: "error", message: "Laporan produksi belum tersedia." };
    }
    if (data === "prod:report:cancel") {
      if (typeof stockProductionTelegramClearSession === "function") stockProductionTelegramClearSession(chatId);
      var reportCancelled = sendTelegramToChatId(chatId, "ℹ️ Pengiriman laporan dibatalkan.", { replyMarkup: stockProductionTelegramMenuKeyboard() });
      return { status: reportCancelled ? "success" : "error", cancelled: true };
    }
    var reportHistoryMatch = /^prod:reports:(\d{1,4})$/.exec(data);
    if (reportHistoryMatch && typeof stockProductionReportsList === "function") {
      var reportHistory = stockProductionReportsList(chatId, Number(reportHistoryMatch[1]));
      if (!reportHistory || reportHistory.status !== "success") return reportHistory || { status: "error", message: "Riwayat laporan tidak tersedia." };
      var reportNavigation = [];
      if (reportHistory.page > 1) reportNavigation.push({ text: "⬅️", callback_data: "prod:reports:" + (reportHistory.page - 1) });
      reportNavigation.push({ text: reportHistory.page + " / " + reportHistory.totalPages, callback_data: "prod:reports:" + reportHistory.page });
      if (reportHistory.page < reportHistory.totalPages) reportNavigation.push({ text: "➡️", callback_data: "prod:reports:" + (reportHistory.page + 1) });
      var reportHistoryKeyboard = [reportNavigation, [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]];
      var reportHistorySent = sendTelegramToChatId(chatId, stockProductionReportsHistoryText(reportHistory), { replyMarkup: { inline_keyboard: reportHistoryKeyboard } });
      return { status: reportHistorySent ? "success" : "error", page: reportHistory.page, itemCount: reportHistory.items.length };
    }
    var reportDetailMatch = /^prod:report:detail:([A-Za-z0-9_-]{1,100})$/.exec(data);
    if (reportDetailMatch && typeof stockProductionReportsDetail === "function") {
      var reportDetail = stockProductionReportsDetail(chatId, reportDetailMatch[1]);
      if (!reportDetail || reportDetail.status !== "success") return reportDetail || { status: "error", message: "Laporan tidak tersedia." };
      var detailKeyboard = [];
      if (reportDetail.report.DriveUrl) detailKeyboard.push([{ text: "📷 Lihat Foto", url: reportDetail.report.DriveUrl }]);
      detailKeyboard.push([{ text: "⬅️ Kembali", callback_data: "prod:reports:1" }]);
      var reportDetailSent = sendTelegramToChatId(chatId, stockProductionReportsDetailText(reportDetail.report, reportDetail.recipient), { replyMarkup: { inline_keyboard: detailKeyboard } });
      return { status: reportDetailSent ? "success" : "error", reportId: reportDetail.report.ReportID };
    }
    if (data === "prod:cancel") {
      if (typeof stockProductionReportsRejectLegacyCallback === "function") return stockProductionReportsRejectLegacyCallback(chatId);
      stockProductionTelegramClearSession(chatId);
      var cancelled = sendTelegramToChatId(chatId, "ℹ️ Input produksi dibatalkan.", { replyMarkup: stockProductionTelegramMenuKeyboardForChat(chatId) });
      return { status: cancelled ? "success" : "error", cancelled: true };
    }
    if (typeof stockProductionReportsIsLegacyCallback === "function" && stockProductionReportsIsLegacyCallback(data)) {
      return stockProductionReportsRejectLegacyCallback(chatId);
    }
    // Keep every retained production-control callback unreachable while the
    // Telegram surface is report-only, including unknown/stale prod:* data.
    if (typeof stockProductionReportsRejectLegacyCallback === "function" && /^prod:/.test(data)) {
      return stockProductionReportsRejectLegacyCallback(chatId);
    }

    if (data === "prod:pending") {
      var pending = stockProductionGetTelegramRecipientQueues({ chatId: chatId, status: "PENDING" });
      if (!pending || pending.status !== "success") return { status: "error", message: "Akses Konveksi tidak tersedia." };
      var pendingText = pending.queues.length ? "🚨 <b>PERLU PRODUKSI</b>\n\nPilih produk:" : "🚨 <b>PERLU PRODUKSI</b>\n\nTidak ada pekerjaan produksi yang menunggu.";
      var pendingSent = sendTelegramToChatId(chatId, pendingText, { replyMarkup: stockProductionTelegramProductKeyboard("prod:pending-product", pending.queues) });
      return { status: pendingSent ? "success" : "error", queueCount: pending.queues.length };
    }

    var pendingProduct = /^prod:pending-product:([A-Za-z0-9_-]{1,80})$/.exec(data);
    if (pendingProduct) {
      var pendingQueues = stockProductionGetTelegramRecipientQueues({ chatId: chatId, status: "PENDING" });
      var representative = pendingQueues && pendingQueues.status === "success" && pendingQueues.queues.filter(function(queue) { return queue.queueId === pendingProduct[1]; })[0];
      if (!representative) return { status: "error", message: "Produk produksi tidak ditemukan atau tidak dapat diakses." };
      var variantsSent = sendTelegramToChatId(chatId, "👗 <b>" + stockProductionTelegramCell(representative.product).toUpperCase() + "</b>\n\nPilih varian:", { replyMarkup: stockProductionTelegramVariantKeyboard(pendingQueues.queues, representative.product) });
      return { status: variantsSent ? "success" : "error", product: representative.product };
    }

    var listActions = { "prod:progress": "IN_PROGRESS", "prod:completed": "COMPLETED" };
    if (listActions[data]) {
      var list = stockProductionGetTelegramRecipientQueues({ chatId: chatId, status: listActions[data] });
      if (!list || list.status !== "success") return { status: "error", message: "Akses Konveksi tidak tersedia." };
      var titles = { IN_PROGRESS: "🔵 <b>SEDANG PRODUKSI</b>", COMPLETED: "✅ <b>PRODUKSI SELESAI</b>" };
      var rows = list.queues.map(function(queue) {
        return stockProductionTelegramQueueKeyboard(queue).inline_keyboard.filter(function(row) { return row[0].callback_data !== "prod:menu"; });
      }).reduce(function(all, group) { return all.concat(group); }, []);
      rows.push([{ text: "⬅️ Kembali", callback_data: "prod:menu" }]);
      var listSent = sendTelegramToChatId(chatId, stockProductionTelegramQueueListText(titles[listActions[data]], list.queues), { replyMarkup: { inline_keyboard: rows } });
      return { status: listSent ? "success" : "error", queueCount: list.queues.length };
    }

    if (data === "prod:stock") {
      var stock = stockProductionGetTelegramRecipientStock({ chatId: chatId });
      if (!stock || stock.status !== "success") return { status: "error", message: stock && stock.message || "Data stok tidak tersedia." };
      var stockText = stock.items.length ? "📦 <b>CEK STOK</b>\n\nPilih produk:" : "📦 <b>CEK STOK</b>\n\nBelum ada SKU yang ditugaskan kepada Konveksi ini.";
      var stockSent = sendTelegramToChatId(chatId, stockText, { replyMarkup: stockProductionTelegramProductKeyboard("prod:stock-product", stock.items) });
      return { status: stockSent ? "success" : "error", itemCount: stock.items.length };
    }

    var stockProduct = /^prod:stock-product:([A-Za-z0-9_-]{1,80})$/.exec(data);
    if (stockProduct) {
      var stockList = stockProductionGetTelegramRecipientStock({ chatId: chatId });
      var selectedStock = stockList && stockList.status === "success" && stockList.items.filter(function(item) { return item.sku === stockProduct[1]; })[0];
      if (!selectedStock) return { status: "error", message: "Produk stok tidak ditemukan atau tidak dapat diakses." };
      var statusLabels = { NORMAL: "🟢 AMAN", LOW_STOCK: "🟠 STOK RENDAH", CRITICAL: "🔴 KRITIS", PRODUCTION_REQUIRED: "🟡 PERLU PRODUKSI", PRODUCTION_IN_PROGRESS: "🔵 SEDANG DIPRODUKSI" };
      var productRows = stockList.items.filter(function(item) { return item.product === selectedStock.product; });
      var stockLines = ["👗 <b>" + stockProductionTelegramCell(selectedStock.product).toUpperCase() + "</b>"];
      productRows.forEach(function(item) {
        stockLines.push("", stockProductionTelegramCell(item.color) + " / " + stockProductionTelegramCell(item.size), "Stok: " + item.stock + " pcs", "Status: " + (statusLabels[item.status] || stockProductionTelegramCell(item.status)));
      });
      var productStockSent = sendTelegramToChatId(chatId, stockLines.join("\n"), { replyMarkup: { inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "prod:stock" }], [{ text: "🏭 Menu Konveksi", callback_data: "prod:menu" }]] } });
      return { status: productStockSent ? "success" : "error", product: selectedStock.product };
    }

    var historyMatch = /^prod:history:(\d{1,4})$/.exec(data);
    if (historyMatch) {
      var history = stockProductionGetTelegramRecipientHistory({ chatId: chatId, page: Number(historyMatch[1]) });
      if (!history || history.status !== "success") return { status: "error", message: "Riwayat produksi tidak tersedia." };
      var historyLines = ["📊 <b>HISTORI PRODUKSI</b>"];
      if (!history.items.length) historyLines.push("", "Belum ada produksi selesai.");
      history.items.forEach(function(item, index) {
        var queue = item.queue;
        historyLines.push("", String((history.page - 1) * 6 + index + 1) + ".", stockProductionTelegramCell(queue.product), stockProductionTelegramCell(queue.color) + " / " + stockProductionTelegramCell(queue.size), "Produksi: " + queue.productionQty + " pcs", "Selesai: " + queue.completedQty + " pcs", "Status: COMPLETED", stockProductionTelegramFormatDate(item.timestamp));
      });
      var navigation = [];
      if (history.page > 1) navigation.push({ text: "⬅️", callback_data: "prod:history:" + (history.page - 1) });
      navigation.push({ text: history.page + " / " + history.totalPages, callback_data: "prod:history:" + history.page });
      if (history.page < history.totalPages) navigation.push({ text: "➡️", callback_data: "prod:history:" + (history.page + 1) });
      var historySent = sendTelegramToChatId(chatId, historyLines.join("\n"), { replyMarkup: { inline_keyboard: [navigation, [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]] } });
      return { status: historySent ? "success" : "error", page: history.page };
    }

    if (data === "prod:profile") {
      var profile = stockProductionGetTelegramRecipientProfile({ chatId: chatId });
      if (!profile || profile.status !== "success") return { status: "error", message: "Profil Konveksi tidak tersedia." };
      var rawChatId = String(profile.recipient.telegramChatId || "");
      var maskedChatId = rawChatId.length > 4 ? rawChatId.slice(0, -4).replace(/./g, "•") + rawChatId.slice(-4) : rawChatId;
      var profileText = "👤 <b>PROFIL KONVEKSI</b>\n\nNama:\n" + stockProductionTelegramCell(profile.recipient.name) + "\n\nStatus:\n🟢 AKTIF\n\nSedang Produksi:\n" + profile.counts.inProgress + "\n\nPerlu Produksi:\n" + profile.counts.pending + "\n\nSelesai:\n" + profile.counts.completed + "\n\nChat ID:\n" + stockProductionTelegramCell(maskedChatId);
      var profileSent = sendTelegramToChatId(chatId, profileText, { replyMarkup: { inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "prod:menu" }]] } });
      return { status: profileSent ? "success" : "error" };
    }

    var editMatch = /^prod:(start|complete)-edit:([A-Za-z0-9_-]{1,80})$/.exec(data);
    if (editMatch) return stockProductionTelegramBeginQuantityInput(chatId, editMatch[2], editMatch[1].toUpperCase());

    var confirmMatch = /^prod:(start|complete)-confirm:([A-Za-z0-9_-]{1,80})$/.exec(data);
    if (confirmMatch) {
      var session = stockProductionTelegramReadSession(chatId);
      var expectedAction = confirmMatch[1].toUpperCase();
      if (!session || session.phase !== "CONFIRM" || session.action !== expectedAction || session.queueId !== confirmMatch[2]) {
        return { status: "error", message: "Konfirmasi sudah kedaluwarsa. Masukkan jumlah lagi." };
      }
      var transition = handleTelegramProductionRecipientAction({ chatId: chatId, queueId: session.queueId, action: expectedAction, productionQty: expectedAction === "START" ? session.quantity : undefined, completedQty: expectedAction === "COMPLETE" ? session.quantity : undefined });
      if (transition.status === "success") {
        stockProductionTelegramClearSession(chatId);
        var updatedQueue = stockProductionTelegramQueueView(transition.queue);
        var successText = expectedAction === "START" ? "🔵 <b>PRODUKSI DIMULAI</b>" : "✅ <b>PRODUKSI SELESAI</b>";
        var confirmedSent = sendTelegramToChatId(chatId, successText + "\n\n" + stockProductionTelegramQueueText(updatedQueue, false), { replyMarkup: stockProductionTelegramQueueKeyboard(updatedQueue) });
        editTelegramInlineKeyboard(chatId, callback.message && callback.message.message_id, stockProductionTelegramQueueKeyboard(updatedQueue));
        return { status: confirmedSent ? "success" : "error", queueId: session.queueId, currentStatus: transition.currentStatus };
      }
      if (transition.status === "info") stockProductionTelegramClearSession(chatId);
      return transition;
    }

    var match = /^prod:(start|complete|detail):([A-Za-z0-9_-]{1,80})$/.exec(data);
    if (!match) {
      answerTelegramCallbackQuery(callbackId, "Aksi tidak dikenali.", true);
      return { status: "error", message: "Aksi produksi tidak dikenali." };
    }
    var action = match[1];
    var queueId = match[2];
    if (action === "detail") {
      var detail = stockProductionTelegramFindOwnedQueue(chatId, queueId, "");
      if (detail.status !== "success") return detail;
      var detailSent = sendTelegramToChatId(chatId, stockProductionTelegramQueueText(detail.queue, true), { replyMarkup: stockProductionTelegramQueueKeyboard(detail.queue) });
      return { status: detailSent ? "success" : "error", queueId: queueId };
    }
    return stockProductionTelegramBeginQuantityInput(chatId, queueId, action.toUpperCase());
  } catch (err) {
    console.log("[TelegramProductionCallback] Error: " + err.toString());
    answerTelegramCallbackQuery(callbackId, "Gagal memproses aksi produksi.", true);
    return { status: "error", message: "Gagal memproses aksi produksi." };
  }
}

/**
 * Return the numeric Chat ID so an admin can configure a production recipient.
 */
function handleTelegramId(chatId, firstName, lastName, username) {
  const displayName = cleanText(firstName + " " + lastName).trim() || "-";
  const displayUsername = cleanText(username).trim() ? "@" + cleanText(username).trim().replace(/^@+/, "") : "-";
  const cleanChatId = String(chatId).trim();
  const message = "🤖 <b>INFO TELEGRAM</b>\n\n" +
    "Nama: " + displayName + "\n" +
    "Username: " + displayUsername + "\n" +
    "Chat ID: <code>" + cleanChatId + "</code>\n\n" +
    "Salin Chat ID di atas dan berikan kepada Admin.";
  const sent = sendTelegramToChatId(chatId, message);
  return { status: sent ? "success" : "error", chatId: cleanChatId, message: "Chat ID sent" };
}

/**
 * Handle /start command - Auto register user
 */
function handleTelegramStart(chatId, firstName, lastName, username) {
  try {
    // Sanitize inputs
    const telegramName = cleanText(firstName + " " + lastName).trim();
    const cleanUsername = cleanText(username).trim();
    const cleanChatId = String(chatId).trim();
    
    if (!cleanChatId || cleanChatId === "" || cleanChatId === "0") {
      sendTelegramToChatId(chatId, "❌ Chat ID tidak valid.");
      return { status: "error", message: "Invalid Chat ID" };
    }

    // Memory cache cooldown to prevent manual spamming
    const cache = CacheService.getScriptCache();
    const cooldownKey = "tg_cooldown_" + cleanChatId;
    if (cache.get(cooldownKey)) {
      console.log("[TelegramStart] Memory cooldown active for user: " + cleanChatId);
      return { status: "ignored", message: "Cooldown active" };
    }
    cache.put(cooldownKey, "active", 10); // 10 seconds cooldown

    // Hanya jalankan ensureTelegramDatabase() sekali per jam (migrasi kolom tidak perlu setiap request)
    const dbCacheKey = "tg_db_ensured";
    if (!cache.get(dbCacheKey)) {
      ensureTelegramDatabase();
      cache.put(dbCacheKey, "1", 3600); // 1 jam
    }
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_USERS_SHEET);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    // Check if user already exists by ChatID
    let existingRow = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colIdx["ChatID"]]) === cleanChatId) {
        existingRow = i + 1;
        break;
      }
    }
    
    const now = new Date();
    
    if (existingRow) {
      const lastUpdate = data[existingRow - 1][colIdx["UpdatedAt"]];
      const timeDiff = lastUpdate ? (now - new Date(lastUpdate)) / 1000 : 9999;
      
      if (timeDiff < 10) { // Cooldown 10s
        console.log("[TelegramStart] Cooldown active for user: " + cleanChatId + " (" + timeDiff + "s)");
        return { status: "ignored", message: "Cooldown active" };
      }
      
      let needUpdate = false;
      if (String(data[existingRow - 1][colIdx["TelegramName"]]).trim() !== telegramName) {
        sheet.getRange(existingRow, colIdx["TelegramName"] + 1).setValue(telegramName);
        needUpdate = true;
      }
      if (String(data[existingRow - 1][colIdx["Username"]]).trim() !== cleanUsername) {
        sheet.getRange(existingRow, colIdx["Username"] + 1).setValue(cleanUsername);
        needUpdate = true;
      }
      if (needUpdate) {
        sheet.getRange(existingRow, colIdx["UpdatedAt"] + 1).setValue(now);
      }
      
      // User sudah terdaftar — TIDAK mengirim pesan status.
      // Notifikasi hanya dikirim oleh NotificationEngine saat terjadi PERUBAHAN status.
      // Ini mencegah spam "Akun Anda sudah aktif" yang dikirim berulang-ulang.
      const currentStatus = String(data[existingRow - 1][colIdx["Status"]] || "PENDING").toUpperCase();
      console.log("[TelegramStart] Existing user " + cleanChatId + " status: " + currentStatus + ". Tidak mengirim pesan (state-polling disabled).");
      
      return { status: "success", message: "User exists, status: " + currentStatus, chatId: cleanChatId };
    } else {
      // Insert new user dengan status PENDING
      const newId = "TU_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
      
      const newRow = new Array(headers.length);
      newRow[colIdx["ID"]] = newId;
      newRow[colIdx["TelegramName"]] = telegramName;
      newRow[colIdx["Username"]] = cleanUsername;
      newRow[colIdx["ChatID"]] = cleanChatId;
      newRow[colIdx["Role"]] = "Staff"; // Default role
      newRow[colIdx["Active"]] = false; // Harus disetujui dahulu
      newRow[colIdx["CreatedAt"]] = now;
      newRow[colIdx["UpdatedAt"]] = now;
      newRow[colIdx["LastError"]] = "";
      newRow[colIdx["Status"]] = "PENDING";
      newRow[colIdx["LastActive"]] = now;
      newRow[colIdx["Rules"]] = "[]"; // Tidak ada rule bawaan sampai disetujui
      
      // Set new notification flags
      if (colIdx["PendingNotificationSent"] !== undefined) newRow[colIdx["PendingNotificationSent"]] = false;
      if (colIdx["ApprovedNotificationSent"] !== undefined) newRow[colIdx["ApprovedNotificationSent"]] = false;
      if (colIdx["ActivatedNotificationSent"] !== undefined) newRow[colIdx["ActivatedNotificationSent"]] = false;
      if (colIdx["RejectedNotificationSent"] !== undefined) newRow[colIdx["RejectedNotificationSent"]] = false;
      if (colIdx["WelcomeNotificationSent"] !== undefined) newRow[colIdx["WelcomeNotificationSent"]] = false;
      
      sheet.appendRow(newRow);
      SpreadsheetApp.flush();
      
      // Kirim notifikasi pendaftaran melalui State Transition Engine
      TelegramNotificationEngine.handleStateTransition(newId, "REGISTERED", "PENDING", cleanChatId, telegramName, "WEBHOOK");
      
      console.log("[TelegramStart] Registered new pending user: " + telegramName + " (" + cleanChatId + ")");
      return { status: "success", message: "User registered pending approval", chatId: cleanChatId };
    }
  } catch (err) {
    console.log("[TelegramStart] Error: " + err.toString());
    sendTelegramToChatId(chatId, "❌ Gagal menghubungkan akun: " + err.toString());
    return { status: "error", message: err.toString() };
  }
}

// ── TELEGRAM USERS CRUD ───────────────────────────────────────
/**
 * Get all Telegram users
 */
function getTelegramUsers() {
  try {
    ensureDatabase();
    const sheet = ensureTelegramUsersSheet();
    if (!sheet) return []; // Return empty array if sheet creation failed
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    const headers = data[0];
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const user = {};
      headers.forEach((h, idx) => {
        user[h] = data[i][idx];
      });
      users.push(user);
    }
    return users;
  } catch (err) {
    console.log("[getTelegramUsers] Error: " + err.toString());
    return [];
  }
}

/**
 * Update Telegram user
 */
function updateTelegramUser(data) {
  try {
    const { id, telegramName, username, chatId, role, active } = data;
    if (!id) return { status: "error", message: "ID required" };
    
    ensureDatabase();
    const sheet = ensureTelegramUsersSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["ID"]]) === String(id)) {
        const rowNum = i + 1;
        if (telegramName !== undefined) sheet.getRange(rowNum, colIdx["TelegramName"] + 1).setValue(telegramName);
        if (username !== undefined) sheet.getRange(rowNum, colIdx["Username"] + 1).setValue(username);
        if (chatId !== undefined) sheet.getRange(rowNum, colIdx["ChatID"] + 1).setValue(chatId);
        if (role !== undefined) sheet.getRange(rowNum, colIdx["Role"] + 1).setValue(role);
        if (active !== undefined) sheet.getRange(rowNum, colIdx["Active"] + 1).setValue(active);
        sheet.getRange(rowNum, colIdx["UpdatedAt"] + 1).setValue(new Date());
        
        return { status: "success", message: "User updated" };
      }
    }
    return { status: "error", message: "User not found" };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

/**
 * Delete Telegram user
 */
function deleteTelegramUser(data) {
  try {
    const { id } = data;
    if (!id) return { status: "error", message: "ID required" };
    
    ensureDatabase();
    const sheet = ensureTelegramUsersSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["ID"]]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { status: "success", message: "User deleted" };
      }
    }
    return { status: "error", message: "User not found" };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

// ── BROADCAST SYSTEM ──────────────────────────────────────────
/**
 * Broadcast message to all active Telegram users
 */
function broadcastTelegram(message) {
  if (!canSendTelegram()) {
    console.log("[broadcastTelegram] SUPPRESSED by context: " + getNotificationContext());
    return { status: "suppressed", sent: 0, failed: 0 };
  }
  
  try {
    const users = getTelegramUsers();
    const activeUsers = users.filter(u => u.Active === true && u.ChatID);
    
    // Add main owner chat ID from PropertiesService (if function exists)
    try {
      if (typeof _getTelegramChatId === 'function') {
        const ownerChatId = _getTelegramChatId();
        if (ownerChatId) {
          activeUsers.push({ ChatID: ownerChatId, isOwner: true });
        }
      }
    } catch (e) {
      console.log("[broadcastTelegram] Could not get owner ChatId: " + e.toString());
    }
    
    // Remove duplicates by ChatID
    const uniqueChatIds = {};
    activeUsers.forEach(u => {
      uniqueChatIds[String(u.ChatID)] = u;
    });
    
    let sent = 0, failed = 0;
    
    Object.keys(uniqueChatIds).forEach(chatId => {
      try {
        const success = sendTelegramToChatId(chatId, message);
        if (success) {
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.log("[broadcastTelegram] Failed to send to " + chatId + ": " + err.toString());
        failed++;
        // Update LastError
        updateUserLastError(chatId, err.toString());
      }
    });
    
    console.log("[broadcastTelegram] Sent: " + sent + ", Failed: " + failed);
    return { status: "success", sent: sent, failed: failed };
  } catch (err) {
    console.log("[broadcastTelegram] Error: " + err.toString());
    return { status: "error", message: err.toString(), sent: 0, failed: 0 };
  }
}

/**
 * Send Telegram message to specific chat ID
 */
function sendTelegramToChatId(chatId, message, sendOptions) {
  try {
    const url = "https://api.telegram.org/bot" + _getTelegramBotToken() + "/sendMessage";
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML"
    };
    if (sendOptions && sendOptions.replyMarkup) payload.reply_markup = sendOptions.replyMarkup;
    
    const requestOptions = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const res = UrlFetchApp.fetch(url, requestOptions);
    const json = JSON.parse(res.getContentText());
    
    if (!json.ok) {
      // Handle 403 Forbidden (bot blocked by user)
      if (json.error_code === 403) {
        console.log("[sendTelegramToChatId] Bot blocked by user: " + chatId);
        disableUserByChatId(chatId, "Bot blocked by user");
      }
      return false;
    }
    
    return true;
  } catch (err) {
    console.log("[sendTelegramToChatId] Error: " + err.toString());
    return false;
  }
}

/**
 * Update user's LastError field
 */
function updateUserLastError(chatId, error) {
  try {
    const sheet = ensureTelegramUsersSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colIdx["ChatID"]]) === String(chatId)) {
        sheet.getRange(i + 1, colIdx["LastError"] + 1).setValue(error);
        sheet.getRange(i + 1, colIdx["UpdatedAt"] + 1).setValue(new Date());
        break;
      }
    }
  } catch (err) {
    console.log("[updateUserLastError] Error: " + err.toString());
  }
}

/**
 * Disable user by ChatID (when bot is blocked)
 */
function disableUserByChatId(chatId, reason) {
  try {
    const sheet = ensureTelegramUsersSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colIdx["ChatID"]]) === String(chatId)) {
        sheet.getRange(i + 1, colIdx["Active"] + 1).setValue(false);
        sheet.getRange(i + 1, colIdx["LastError"] + 1).setValue(reason);
        sheet.getRange(i + 1, colIdx["UpdatedAt"] + 1).setValue(new Date());
        console.log("[disableUserByChatId] Disabled user: " + chatId + " - " + reason);
        break;
      }
    }
  } catch (err) {
    console.log("[disableUserByChatId] Error: " + err.toString());
  }
}

// ── NOTIFICATION ROUTER ───────────────────────────────────────
/**
 * Return a safe scalar for order notification presentation.
 * Order data can be incomplete on older syncs, so never render nullish
 * sentinels or object coercion into Telegram text.
 */
function orderNotificationSafeText(value, fallback) {
  if (value === null || value === undefined || typeof value === "object") return fallback;
  const text = String(value).trim();
  if (!text || /^(undefined|null|n\/a)$/i.test(text) || text === "[object Object]") return fallback;
  return text;
}

/**
 * Resolve the buyer identity from fields already present in the order payload.
 * recipient_address.name is the buyer's display name; buyer_username remains
 * the canonical optional username and is never used as a delivery address.
 */
function getOrderNotificationBuyer(order) {
  const source = order || {};
  const address = source.recipient_address && typeof source.recipient_address === "object"
    ? source.recipient_address
    : {};
  const username = orderNotificationSafeText(
    source.buyer_username || source.buyerUsername || source.username,
    ""
  ).replace(/^@+/, "");
  const name = orderNotificationSafeText(
    address.name || source.buyer_name || source.buyerName || source.customer_name || source.customerName || username,
    "-"
  );
  return { name: name, username: username };
}

function formatOrderNotificationBuyer(name, username) {
  const safeName = orderNotificationSafeText(name, "-");
  const safeUsername = orderNotificationSafeText(username, "").replace(/^@+/, "");
  return safeName + (safeUsername ? " (@" + safeUsername + ")" : "");
}

/**
 * Canonical Telegram formatter for every order lifecycle event.
 * Callers may differ in how they select an order, but the rendered structure
 * stays identical and only explicitly supplied extra fields are included.
 */
function buildOrderLifecycleNotificationMessage(options) {
  const data = options || {};
  const lines = [
    orderNotificationSafeText(data.icon, "📦") + " <b>" + orderNotificationSafeText(data.title, "ORDER") + "</b>",
    "",
    "Pembeli:",
    formatOrderNotificationBuyer(data.buyerName, data.buyerUsername),
    "",
    "Order:",
    orderNotificationSafeText(data.orderSn, "-"),
    "",
    "Produk:",
    orderNotificationSafeText(data.productName, "-"),
    "",
    "Variasi:",
    orderNotificationSafeText(data.variationName, "-"),
    "",
    "Qty:",
    orderNotificationSafeText(data.qty, "0")
  ];

  if (data.includeStock) {
    lines.push("", "Sisa Stok:", orderNotificationSafeText(data.stock, "N/A"));
  }
  if (data.extraFields && Array.isArray(data.extraFields)) {
    data.extraFields.forEach(function(field) {
      if (!field || field.length < 2) return;
      lines.push("", orderNotificationSafeText(field[0], "Info") + ":", orderNotificationSafeText(field[1], "-"));
    });
  }
  lines.push("", "Status:", orderNotificationSafeText(data.status, "-"));
  return lines.join("\n");
}

/**
 * Centralized notification gateway
 * All notifications should go through this
 */
function notify(options) {
  const { type, context, payload, message } = options;
  
  // Set context if provided
  if (context) {
    setNotificationContext(context);
  }
  
  // Check if Telegram is allowed
  if (!canSendTelegram()) {
    console.log("[notify] Notification SUPPRESSED: type=" + type + ", context=" + getNotificationContext());
    return { status: "suppressed", reason: "context_not_allowed" };
  }
  
  // Build message if not provided
  let msg = message;
  if (!msg && payload) {
    msg = buildNotificationMessage(type, payload);
  }
  
  if (!msg) {
    console.log("[notify] No message to send");
    return { status: "error", message: "No message content" };
  }
  
  // Broadcast to all users
  return broadcastTelegram(msg);
}

/**
 * Build notification message based on type and payload
 */
function buildNotificationMessage(type, payload) {
  payload = payload || {};
  switch (type) {
    case "ORDER_NEW":
      return buildOrderLifecycleNotificationMessage({
        icon: "📦",
        title: "ORDER BARU",
        buyerName: payload.buyerName || payload.buyer_name || payload.customer,
        buyerUsername: payload.buyerUsername || payload.buyer_username,
        orderSn: payload.orderSn || payload.order_sn,
        productName: payload.productName || payload.product,
        variationName: payload.variationName || payload.variation_name,
        qty: payload.qty,
        includeStock: payload.includeStock === true || payload.remainingStock !== undefined || payload.stock !== undefined,
        stock: payload.remainingStock !== undefined ? payload.remainingStock : payload.stock,
        status: payload.status
      });
    
    case "ORDER_STATUS":
      return buildOrderLifecycleNotificationMessage({
        icon: "🔄",
        title: "UPDATE STATUS ORDER",
        buyerName: payload.buyerName || payload.buyer_name || payload.customer,
        buyerUsername: payload.buyerUsername || payload.buyer_username,
        orderSn: payload.orderSn || payload.order_sn,
        productName: payload.productName || payload.product,
        variationName: payload.variationName || payload.variation_name,
        qty: payload.qty,
        status: payload.newStatus || payload.status,
        extraFields: payload.oldStatus !== undefined ? [["Status Lama", payload.oldStatus]] : []
      });
    
    case "BARANG_MASUK":
      return "📥 <b>BARANG MASUK</b>\n\n" +
        "SKU: " + (payload.sku || "-") + "\n" +
        "Nama: " + (payload.nama || "-") + "\n" +
        "Qty: " + (payload.qty || 0) + "\n" +
        "Stok Baru: " + (payload.stokBaru || 0);
    
    case "BARANG_KELUAR":
      return "📤 <b>BARANG KELUAR</b>\n\n" +
        "SKU: " + (payload.sku || "-") + "\n" +
        "Nama: " + (payload.nama || "-") + "\n" +
        "Qty: " + (payload.qty || 0) + "\n" +
        "Stok Baru: " + (payload.stokBaru || 0);
    
    case "STOK_MENIPIS":
      return "⚠️ <b>STOK MENIPIS</b>\n\n" +
        "SKU: " + (payload.sku || "-") + "\n" +
        "Nama: " + (payload.nama || "-") + "\n" +
        "Stok: " + (payload.stok || 0) + "\n" +
        "Min Stok: " + (payload.minStok || 0);
    
    default:
      return String(payload);
  }
}

// ── GENERATE JOIN LINK ────────────────────────────────────────
/**
 * Generate Telegram bot join link
 */
function generateTelegramJoinLink() {
  try {
    const botToken = _getTelegramBotToken();
    if (!botToken) {
      return { status: "error", message: "Telegram Bot Token belum dikonfigurasi" };
    }
    
    // Extract bot username from token (format: 123456:ABC-DEF...)
    // We need to get bot info via API
    const url = "https://api.telegram.org/bot" + botToken + "/getMe";
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    
    if (!json.ok) {
      return { status: "error", message: "Gagal mendapatkan info bot: " + (json.description || "Unknown error") };
    }
    
    const botUsername = json.result.username;
    const joinLink = "https://t.me/" + botUsername + "?start=register";
    
    return { 
      status: "success", 
      link: joinLink,
      botUsername: botUsername
    };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

// ── BACKEND HANDLERS ──────────────────────────────────────────
function handleGetTelegramUsers(data) {
  try {
    const users = getTelegramUsers();
    return { status: "success", users: users };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

function handleUpdateTelegramUser(data) {
  return updateTelegramUser(data);
}

function handleDeleteTelegramUser(data) {
  return deleteTelegramUser(data);
}

function handleGenerateTelegramJoinLink(data) {
  return generateTelegramJoinLink();
}

function handleBroadcastTelegram(data) {
  const { message } = data;
  if (!message) return { status: "error", message: "Message required" };
  return broadcastTelegram(message);
}
