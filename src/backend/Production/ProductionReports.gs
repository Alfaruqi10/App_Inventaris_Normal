// ============================================================
// Production/ProductionReports.gs
// Photo-only completion reports from ProductionRecipients.
// Reports are documents awaiting verification, not production lifecycle data.
// ============================================================

var PRODUCTION_REPORTS_SHEET = "ProductionReports";
var PRODUCTION_REPORTS_ROOT_FOLDER_PROPERTY = "PRODUCTION_REPORTS_DRIVE_FOLDER_ID";
var PRODUCTION_REPORTS_IDEMPOTENCY_PREFIX = "production_report_update:";
var PRODUCTION_REPORTS_HEADERS = [
  "ReportID", "ProductionRecipient", "TelegramChatId", "ReceivedAt", "TelegramUpdateId",
  "TelegramMessageId", "TelegramFileId", "DriveFileId", "DriveUrl", "FileName", "MimeType",
  "Status", "Caption", "VerifiedAt", "VerifiedBy", "RejectedAt", "RejectedBy", "RejectionReason"
];
var PRODUCTION_REPORTS_STATUSES = ["MENUNGGU_VERIFIKASI", "DIVERIFIKASI", "DITOLAK"];
var PRODUCTION_REPORTS_PAGE_SIZE = 6;

function stockProductionReportsSafeError(error) {
  var message = error && error.message ? error.message : String(error || "Unknown error");
  return message.replace(/https?:\/\/[^\s]+/gi, "[url-redacted]").replace(/\b\d{6,}\b/g, "[number-redacted]");
}

function stockProductionReportsLogStage(stage, error) {
  var message = "REPORT_UPLOAD_STAGE=" + stage;
  var cause = error && error.reportCause ? error.reportCause : error;
  if (error && error.reportSubStage) message += " SUB_STAGE=" + error.reportSubStage;
  if (error && error.reportCode) message += " CODE=" + error.reportCode;
  if (cause) message += " ERROR=" + stockProductionReportsSafeError(cause);
  console.log(message);
}

function stockProductionReportsStageError(stage, cause, subStage) {
  var code = "PRODUCTION_REPORTS_" + stage + "_FAILED";
  var detail = cause ? stockProductionReportsSafeError(cause) : "Operation gagal.";
  var error = new Error(code + ": " + detail);
  error.reportStage = stage;
  error.reportSubStage = subStage || "";
  error.reportCode = code;
  error.reportCause = cause;
  return error;
}

function stockProductionReportsWithStage(error, fallbackStage, fallbackSubStage) {
  if (error && error.reportStage && error.reportCode) return error;
  return stockProductionReportsStageError(fallbackStage, error, fallbackSubStage);
}

function stockProductionReportsFailureText(error, fallbackStage) {
  var failure = stockProductionReportsWithStage(error, fallbackStage);
  var subStage = failure.reportSubStage ? "Sub-tahap: <code>" + failure.reportSubStage + "</code>\n" : "";
  return "❌ <b>LAPORAN BELUM TERSIMPAN</b>\n\n" +
    "Tahap gagal: <code>" + failure.reportStage + "</code>\n" +
    subStage +
    "Kode: <code>" + failure.reportCode + "</code>\n\n" +
    "Foto berhasil diterima, tetapi sistem\nbelum berhasil menyimpan laporan.\n\n" +
    "Silakan kirim ulang setelah perbaikan.";
}

function stockProductionReportsFailure(chatId, error, fallbackStage) {
  var failure = stockProductionReportsWithStage(error, fallbackStage);
  stockProductionReportsLogStage(failure.reportStage, failure);
  sendTelegramToChatId(chatId, stockProductionReportsFailureText(failure, fallbackStage));
  return { handled: true, status: "error", stage: failure.reportStage, subStage: failure.reportSubStage || "", code: failure.reportCode, message: failure.reportCode };
}

function stockProductionReportsRunStage(stage, operation) {
  stockProductionReportsLogStage(stage);
  try {
    return operation();
  } catch (error) {
    throw stockProductionReportsWithStage(error, stage);
  }
}

function stockProductionReportsLogRootDiagnostic(operation, details) {
  var safeDetails = details || {};
  console.log("REPORT_UPLOAD_ROOT_DIAGNOSTIC=" + operation + " " + JSON.stringify(safeDetails));
}

function stockProductionReportsLogDriveDiagnostic(operation, details) {
  var safeDetails = details || {};
  console.log("REPORT_UPLOAD_DRIVE_DIAGNOSTIC=" + operation + " " + JSON.stringify(safeDetails));
}

function stockProductionReportsUploadDriveFile(folder, blob, metadata) {
  var stage = "UPLOAD_DRIVE";
  var details = metadata || {};
  stockProductionReportsLogStage(stage);

  var folderName = "";
  try {
    if (folder && typeof folder.getName === "function") folderName = stockProductionReportsText(folder.getName());
  } catch (error) {
    stockProductionReportsLogDriveDiagnostic("GET_RECIPIENT_FOLDER", { valid: false, error: stockProductionReportsSafeError(error) });
    throw stockProductionReportsStageError(stage, error, "GET_RECIPIENT_FOLDER");
  }
  var folderValid = !!folder && typeof folder.createFile === "function";
  stockProductionReportsLogDriveDiagnostic("GET_RECIPIENT_FOLDER", { valid: folderValid, name: folderName });
  if (!folderValid) {
    throw stockProductionReportsStageError(stage, new Error("Folder recipient bukan folder Drive yang valid."), "GET_RECIPIENT_FOLDER");
  }

  var blobValid = !!blob && typeof blob.getContentType === "function";
  stockProductionReportsLogDriveDiagnostic("CREATE_FILE_CALL", {
    blobAvailable: !!blob,
    blobValid: blobValid,
    contentType: stockProductionReportsText(details.mimeType),
    declaredSize: Number(details.fileSize) || 0,
    name: stockProductionReportsText(details.fileName)
  });
  if (!blobValid) {
    throw stockProductionReportsStageError(stage, new Error("Blob foto tidak valid."), "CREATE_FILE_CALL");
  }

  var file;
  try {
    file = folder.createFile(blob);
  } catch (error) {
    stockProductionReportsLogDriveDiagnostic("CREATE_FILE_EXCEPTION", { error: stockProductionReportsSafeError(error) });
    throw stockProductionReportsStageError(stage, error, "CREATE_FILE_EXCEPTION");
  }
  var fileValid = !!file && typeof file.getId === "function" && typeof file.getUrl === "function";
  if (!fileValid) {
    stockProductionReportsLogDriveDiagnostic("CREATE_FILE_EMPTY", { returned: !!file, valid: false });
    throw stockProductionReportsStageError(stage, new Error("Drive tidak mengembalikan file yang valid."), "CREATE_FILE_EMPTY");
  }
  stockProductionReportsLogDriveDiagnostic("CREATE_FILE_SUCCESS", { created: true, valid: true });
  return file;
}

function stockProductionReportsText(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function stockProductionReportsSlug(value) {
  var slug = stockProductionReportsText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "RECIPIENT";
}

function stockProductionReportsResolveRecipient(chatId) {
  if (typeof readProductionRecipients !== "function" || typeof stockProductionResolveRecipientByTelegramChatId !== "function") {
    return { status: "recipient_configuration_unavailable", recipient: null };
  }
  var source = readProductionRecipients();
  return stockProductionResolveRecipientByTelegramChatId(chatId, source);
}

function stockProductionReportsReadSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(PRODUCTION_REPORTS_SHEET);
}

function stockProductionReportsEnsureSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCTION_REPORTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCTION_REPORTS_SHEET);
    sheet.getRange(1, 1, 1, PRODUCTION_REPORTS_HEADERS.length).setValues([PRODUCTION_REPORTS_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, PRODUCTION_REPORTS_HEADERS.length).setValues([PRODUCTION_REPORTS_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionReportsText);
  var missing = PRODUCTION_REPORTS_HEADERS.filter(function(header) { return headers.indexOf(header) < 0; });
  if (missing.length) {
    if (typeof sheet.insertColumnsAfter !== "function") throw new Error("Header ProductionReports tidak lengkap: " + missing.join(", "));
    sheet.insertColumnsAfter(sheet.getLastColumn(), missing.length);
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function stockProductionReportsRows(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(stockProductionReportsText);
  return values.slice(1).map(function(row, index) {
    var result = { _row: index + 2 };
    headers.forEach(function(header, column) { result[header] = row[column]; });
    return result;
  });
}

function stockProductionReportsApi(method, payload) {
  var token = typeof _getTelegramBotToken === "function" ? _getTelegramBotToken() : "";
  if (!token) throw new Error("Telegram bot token belum dikonfigurasi.");
  var url = "https://api.telegram.org/bot" + token + "/" + method;
  var response = UrlFetchApp.fetch(url, {
    method: "POST", contentType: "application/json", payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  var body = JSON.parse(response.getContentText() || "{}");
  if (!body.ok) throw new Error(body.description || "Telegram API gagal: " + method);
  return body.result;
}

function stockProductionReportsPickPhoto(message) {
  var photos = Array.isArray(message && message.photo) ? message.photo : [];
  if (!photos.length) return null;
  return photos.slice().sort(function(left, right) {
    var leftSize = Number(left.file_size) || 0;
    var rightSize = Number(right.file_size) || 0;
    if (leftSize !== rightSize) return rightSize - leftSize;
    return (Number(right.width) || 0) * (Number(right.height) || 0) - (Number(left.width) || 0) * (Number(left.height) || 0);
  })[0];
}

function stockProductionReportsExtension(filePath, mimeType) {
  var match = stockProductionReportsText(filePath).match(/\.([a-z0-9]{2,5})$/i);
  if (match) return match[1].toLowerCase();
  var mime = stockProductionReportsText(mimeType).toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function stockProductionReportsFindUniqueFolder(parent, name, description) {
  if (!parent || typeof parent.getFoldersByName !== "function") throw new Error("Folder laporan tidak dapat dibaca.");
  var folders = parent.getFoldersByName(name);
  var found = null;
  var count = 0;
  while (folders.hasNext()) {
    found = folders.next();
    count += 1;
    if (count > 1) throw new Error((description || "Folder laporan") + ' memiliki folder duplikat "' + name + '".');
  }
  if (!found) throw new Error((description || "Folder laporan") + ' "' + name + '" tidak ditemukan.');
  return found;
}

function stockProductionReportsRecipientFolder(recipient) {
  stockProductionReportsLogStage("RESOLVE_ROOT");
  var rootId;
  try {
    rootId = PropertiesService.getScriptProperties().getProperty(PRODUCTION_REPORTS_ROOT_FOLDER_PROPERTY);
  } catch (error) {
    stockProductionReportsLogRootDiagnostic("PROPERTY", { available: false, idLength: 0, error: stockProductionReportsSafeError(error) });
    throw stockProductionReportsStageError("RESOLVE_ROOT", error, "PROPERTY");
  }
  stockProductionReportsLogRootDiagnostic("PROPERTY", { available: !!rootId, idLength: stockProductionReportsText(rootId).length });
  if (!rootId) throw stockProductionReportsStageError("RESOLVE_ROOT", new Error("Folder laporan produksi belum dikonfigurasi."), "PROPERTY");

  var root;
  try {
    root = DriveApp.getFolderById(rootId);
  } catch (error) {
    stockProductionReportsLogRootDiagnostic("GET_FOLDER_BY_ID_EXCEPTION", { error: stockProductionReportsSafeError(error) });
    throw stockProductionReportsStageError("RESOLVE_ROOT", error, "GET_FOLDER_BY_ID_EXCEPTION");
  }
  if (!root) {
    stockProductionReportsLogRootDiagnostic("GET_FOLDER_BY_ID_EMPTY", { found: false });
    throw stockProductionReportsStageError("RESOLVE_ROOT", new Error("Root folder laporan produksi tidak ditemukan."), "GET_FOLDER_BY_ID_EMPTY");
  }

  var hasFolderMethods = typeof root.getName === "function" && typeof root.getFoldersByName === "function";
  var rootName = "";
  if (!hasFolderMethods) {
    stockProductionReportsLogRootDiagnostic("ROOT_OBJECT", { type: "Invalid", hasFolderMethods: false, name: rootName });
    throw stockProductionReportsStageError("RESOLVE_ROOT", new Error("Root laporan produksi bukan folder Drive yang valid."), "ROOT_OBJECT");
  }
  try {
    rootName = stockProductionReportsText(root.getName());
  } catch (error) {
    stockProductionReportsLogRootDiagnostic("ROOT_NAME_EXCEPTION", { error: stockProductionReportsSafeError(error) });
    throw stockProductionReportsStageError("RESOLVE_ROOT", error, "ROOT_NAME_EXCEPTION");
  }
  stockProductionReportsLogRootDiagnostic("ROOT_OBJECT", { type: "Folder", hasFolderMethods: true, name: rootName });
  var nameValid = rootName === "Laporan produksi";
  stockProductionReportsLogRootDiagnostic("ROOT_NAME_VALIDATION", { valid: nameValid, name: rootName });
  if (!nameValid) {
    throw stockProductionReportsStageError("RESOLVE_ROOT", new Error('Root folder laporan harus bernama "Laporan produksi".'), "ROOT_NAME_VALIDATION");
  }

  var reports = stockProductionReportsRunStage("RESOLVE_LAPORAN_KONVEKSI", function() {
    return stockProductionReportsFindUniqueFolder(root, "Laporan Konveksi", "Root folder laporan produksi");
  });
  return stockProductionReportsRunStage("RESOLVE_RECIPIENT_FOLDER", function() {
    var recipientName = stockProductionReportsText(recipient && recipient.name) || "Konveksi";
    return stockProductionReportsFindUniqueFolder(reports, recipientName, "Folder Laporan Konveksi");
  });
}

function stockProductionReportsExistingDuplicate(rows, updateId, chatId, messageId) {
  var updateKey = stockProductionReportsText(updateId);
  var chatKey = stockProductionReportsText(chatId);
  var messageKey = stockProductionReportsText(messageId);
  return (rows || []).filter(function(row) {
    return (updateKey && stockProductionReportsText(row.TelegramUpdateId) === updateKey) ||
      (chatKey && messageKey && stockProductionReportsText(row.TelegramChatId) === chatKey && stockProductionReportsText(row.TelegramMessageId) === messageKey);
  })[0] || null;
}

function stockProductionReportsNextId(rows, stamp, recipientSlug) {
  var prefix = "LP-" + stamp + "-" + recipientSlug + "-";
  var max = 0;
  (rows || []).forEach(function(row) {
    var match = stockProductionReportsText(row.ReportID).match(new RegExp("^" + prefix + "(\\d+)$"));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return prefix + String(max + 1).padStart(3, "0");
}

function stockProductionReportsDetailText(report, recipient) {
  var received = typeof stockProductionTelegramFormatDate === "function" ? stockProductionTelegramFormatDate(report.ReceivedAt) : stockProductionReportsText(report.ReceivedAt);
  var status = stockProductionReportsStatusLabel(report.Status);
  return "📄 <b>DETAIL LAPORAN</b>\n\nID:\n" + stockProductionReportsText(report.ReportID) +
    "\n\nKonveksi:\n" + stockProductionReportsText(recipient && recipient.name) +
    "\n\nDiterima:\n" + received + "\n\nStatus:\n" + status + "\n\nFoto:\n📷 Lihat Foto";
}

function stockProductionReportsHistoryText(result) {
  var lines = ["📊 <b>RIWAYAT LAPORAN</b>"];
  if (!result.items.length) lines.push("", "Belum ada laporan produksi.");
  result.items.forEach(function(report, index) {
    var received = typeof stockProductionTelegramFormatDate === "function" ? stockProductionTelegramFormatDate(report.ReceivedAt) : stockProductionReportsText(report.ReceivedAt);
    var status = stockProductionReportsStatusLabel(report.Status);
    lines.push("", String((result.page - 1) * PRODUCTION_REPORTS_PAGE_SIZE + index + 1) + ".", stockProductionReportsText(report.ReportID), received, status);
  });
  return lines.join("\n");
}

function stockProductionReportsKeyboard() {
  return { inline_keyboard: [
    [{ text: "📷 Lapor Produksi Selesai", callback_data: "prod:report:new" }],
    [{ text: "📊 Riwayat Laporan", callback_data: "prod:reports:1" }],
    [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]
  ] };
}

function stockProductionReportsMenuKeyboard() {
  return stockProductionReportsKeyboard();
}

function stockProductionReportsPrompt(chatId) {
  var resolution = stockProductionReportsResolveRecipient(chatId);
  if (!resolution || resolution.status !== "resolved") return { handled: false, status: "ignored" };
  if (typeof stockProductionTelegramWriteSession === "function") stockProductionTelegramWriteSession(chatId, { action: "REPORT_PHOTO", phase: "REPORT_PHOTO" });
  var text = "📷 <b>LAPOR PRODUKSI SELESAI</b>\n\nSilakan kirim foto formulir produksi\nyang sudah diisi.\n\nPastikan seluruh tulisan pada formulir\nterlihat jelas dan tidak terpotong.\n\nFoto akan disimpan sebagai arsip\nlaporan produksi Anda.\n\n📸 Kirim foto formulir sekarang.";
  var sent = sendTelegramToChatId(chatId, text, { replyMarkup: { inline_keyboard: [[{ text: "❌ Batal", callback_data: "prod:report:cancel" }], [{ text: "⬅️ Kembali", callback_data: "prod:menu" }]] } });
  return { handled: true, status: sent ? "success" : "error", message: sent ? "Menunggu foto laporan." : "Gagal meminta foto laporan." };
}

function stockProductionReportsList(chatId, page) {
  var resolution = stockProductionReportsResolveRecipient(chatId);
  if (!resolution || resolution.status !== "resolved") return { status: "error", message: "Akses laporan Konveksi tidak tersedia." };
  var rows = stockProductionReportsRows(stockProductionReportsReadSheet()).filter(function(row) {
    return stockProductionReportsText(row.ProductionRecipient) === resolution.recipient.id;
  }).sort(function(left, right) { return new Date(right.ReceivedAt || 0).getTime() - new Date(left.ReceivedAt || 0).getTime(); });
  var requestedPage = Math.max(1, Math.floor(Number(page) || 1));
  var totalPages = Math.max(1, Math.ceil(rows.length / PRODUCTION_REPORTS_PAGE_SIZE));
  var actualPage = Math.min(requestedPage, totalPages);
  return { status: "success", recipient: resolution.recipient, items: rows.slice((actualPage - 1) * PRODUCTION_REPORTS_PAGE_SIZE, actualPage * PRODUCTION_REPORTS_PAGE_SIZE), page: actualPage, totalPages: totalPages, total: rows.length };
}

function stockProductionReportsDetail(chatId, reportId) {
  var resolution = stockProductionReportsResolveRecipient(chatId);
  if (!resolution || resolution.status !== "resolved") return { status: "error", message: "Akses laporan Konveksi tidak tersedia." };
  var report = stockProductionReportsRows(stockProductionReportsReadSheet()).filter(function(row) {
    return stockProductionReportsText(row.ReportID) === stockProductionReportsText(reportId) && stockProductionReportsText(row.ProductionRecipient) === resolution.recipient.id;
  })[0];
  if (!report) return { status: "error", message: "Laporan tidak ditemukan atau tidak dapat diakses." };
  return { status: "success", recipient: resolution.recipient, report: report };
}

function stockProductionReportsStatusLabel(status) {
  var key = stockProductionReportsText(status).toUpperCase();
  if (key === "DIVERIFIKASI") return "✅ Diverifikasi";
  if (key === "DITOLAK") return "❌ Ditolak / Minta Kirim Ulang";
  return "🕐 Menunggu verifikasi";
}

function stockProductionReportsRequireAdmin(data) {
  if (typeof resolveProductionReportsAdminActor !== "function") throw new Error("Authorization laporan produksi belum tersedia.");
  return resolveProductionReportsAdminActor((data || {}).sessionId, data || {});
}

function stockProductionReportsAdminAuthorization(data) {
  try {
    return { user: stockProductionReportsRequireAdmin(data) };
  } catch (error) {
    return {
      error: {
        status: "error",
        code: error && error.code ? error.code : "permission_denied",
        message: stockProductionReportsSafeError(error)
      }
    };
  }
}

function stockProductionReportsAdminRows() {
  var sheet = stockProductionReportsReadSheet();
  return { sheet: sheet, rows: stockProductionReportsRows(sheet) };
}

function stockProductionReportsAdminList(data) {
  var authorization = stockProductionReportsAdminAuthorization(data);
  if (authorization.error) return authorization.error;
  var user = authorization.user;
  var input = data || {};
  var statusFilter = stockProductionReportsText(input.status).toUpperCase() || "MENUNGGU_VERIFIKASI";
  var recipientFilter = stockProductionReportsText(input.productionRecipient);
  if (recipientFilter.toUpperCase() === "ALL") recipientFilter = "";
  var reportIdSearch = stockProductionReportsText(input.reportId || input.search);
  if (statusFilter !== "ALL" && PRODUCTION_REPORTS_STATUSES.indexOf(statusFilter) < 0) {
    return { status: "error", code: "invalid_report_status", message: "Status laporan tidak valid." };
  }
  var source = stockProductionReportsAdminRows();
  var rows = source.rows.filter(function(row) {
    var status = stockProductionReportsText(row.Status).toUpperCase();
    if (PRODUCTION_REPORTS_STATUSES.indexOf(status) < 0) return false;
    if (statusFilter !== "ALL" && status !== statusFilter) return false;
    if (recipientFilter && stockProductionReportsText(row.ProductionRecipient) !== recipientFilter) return false;
    if (reportIdSearch && stockProductionReportsText(row.ReportID) !== reportIdSearch) return false;
    return true;
  }).sort(function(left, right) {
    return new Date(right.ReceivedAt || 0).getTime() - new Date(left.ReceivedAt || 0).getTime();
  });
  var pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 25)));
  var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  var page = Math.min(totalPages, Math.max(1, Math.floor(Number(input.page) || 1)));
  var items = rows.slice((page - 1) * pageSize, page * pageSize).map(function(row) {
    return {
      ReportID: row.ReportID, ProductionRecipient: row.ProductionRecipient, ReceivedAt: row.ReceivedAt,
      FileName: row.FileName, Status: row.Status
    };
  });
  return { status: "success", permissions: user.permissions || [], items: items, page: page, pageSize: pageSize, totalPages: totalPages, total: rows.length };
}

function stockProductionReportsAdminDetail(data) {
  var authorization = stockProductionReportsAdminAuthorization(data);
  if (authorization.error) return authorization.error;
  var reportId = stockProductionReportsText((data || {}).reportId || (data || {}).ReportID);
  if (!reportId) return { status: "error", code: "report_id_required", message: "ID laporan wajib diisi." };
  var source = stockProductionReportsAdminRows();
  var report = source.rows.filter(function(row) { return stockProductionReportsText(row.ReportID) === reportId; })[0];
  if (!report) return { status: "error", code: "report_not_found", message: "Laporan tidak ditemukan." };
  return { status: "success", report: report };
}

function stockProductionReportsUpdateFields(sheet, rowNumber, changes) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionReportsText);
  Object.keys(changes || {}).forEach(function(header) {
    var column = headers.indexOf(header);
    if (column < 0) throw new Error("Kolom ProductionReports tidak tersedia: " + header);
    sheet.getRange(rowNumber, column + 1).setValue(changes[header]);
  });
}

function stockProductionReportsEscapeTelegramHtml(value) {
  return stockProductionReportsText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function stockProductionReportsTransitionMessage(report, targetStatus) {
  var reportId = stockProductionReportsEscapeTelegramHtml(report && report.ReportID);
  if (targetStatus === "DIVERIFIKASI") {
    return "✅ <b>LAPORAN PRODUKSI DIVERIFIKASI</b>\n\n" +
      "Laporan produksi Anda telah diverifikasi oleh Admin.\n\n" +
      "ID Laporan:\n<code>" + reportId + "</code>\n\n" +
      "Status:\n🟢 Diverifikasi\n\n" +
      "Terima kasih.";
  }
  var reason = stockProductionReportsEscapeTelegramHtml(report && report.RejectionReason) || "-";
  return "❌ <b>LAPORAN PRODUKSI DITOLAK</b>\n\n" +
    "Laporan produksi Anda belum dapat diverifikasi.\n\n" +
    "ID Laporan:\n<code>" + reportId + "</code>\n\n" +
    "Status:\n🔴 Ditolak\n\n" +
    "Alasan:\n" + reason + "\n\n" +
    "Silakan kirim foto laporan produksi kembali melalui menu:\n📷 Lapor Produksi Selesai";
}

function stockProductionReportsNotifyTransition(report, targetStatus) {
  var chatId = stockProductionReportsText(report && report.TelegramChatId);
  if (!/^-?\d+$/.test(chatId)) {
    console.log("[ProductionReports] Transition notification skipped: invalid recipient Chat ID.");
    return { status: "skipped", reason: "invalid_chat_id", sent: 0 };
  }

  var message = stockProductionReportsTransitionMessage(report, targetStatus);
  var recipient = {
    id: stockProductionReportsText(report && report.ProductionRecipient),
    name: "Konveksi",
    telegramChatId: chatId
  };
  var result;
  try {
    if (typeof NotificationService !== "undefined" && NotificationService && typeof NotificationService.sendToRecipient === "function") {
      result = NotificationService.sendToRecipient("PRODUCTION_REPORT_" + targetStatus, recipient, {
        message: message,
        entityKey: stockProductionReportsText(report && report.ReportID),
        idempotencyKey: "PRODUCTION_REPORT_STATUS:" + stockProductionReportsText(report && report.ReportID) + ":" + targetStatus
      });
    } else if (typeof sendTelegramToChatId === "function") {
      result = sendTelegramToChatId(chatId, message);
      result = result ? { status: "success", sent: 1, failed: 0, total: 1 } : { status: "error", sent: 0, failed: 1, total: 1 };
    } else {
      result = { status: "error", reason: "telegram_gateway_unavailable", sent: 0 };
    }
  } catch (error) {
    result = { status: "error", reason: "telegram_gateway_failed", sent: 0 };
    console.log("[ProductionReports] Transition notification failed: " + stockProductionReportsSafeError(error));
  }
  var status = result && result.status ? result.status : (result ? "success" : "error");
  console.log("[ProductionReports] Transition notification status=" + status + " target=" + targetStatus);
  return result;
}

function stockProductionReportsAdminTransition(data) {
  var authorization = stockProductionReportsAdminAuthorization(data);
  if (authorization.error) return authorization.error;
  var user = authorization.user;
  var input = data || {};
  var reportId = stockProductionReportsText(input.reportId || input.ReportID);
  var targetStatus = stockProductionReportsText(input.targetStatus || input.status).toUpperCase();
  if (!reportId) return { status: "error", code: "report_id_required", message: "ID laporan wajib diisi." };
  if (targetStatus !== "DIVERIFIKASI" && targetStatus !== "DITOLAK") return { status: "error", code: "invalid_report_transition", message: "Status tujuan laporan tidak valid." };
  var sheet = stockProductionReportsReadSheet();
  if (!sheet) return { status: "error", code: "report_not_found", message: "Laporan tidak ditemukan." };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: "error", code: "report_lock_timeout", message: "Laporan sedang diproses. Silakan coba lagi." };
  var transitionResult = null;
  try {
    sheet = stockProductionReportsEnsureSheet();
    var report = stockProductionReportsRows(sheet).filter(function(row) { return stockProductionReportsText(row.ReportID) === reportId; })[0];
    if (!report) return { status: "error", code: "report_not_found", message: "Laporan tidak ditemukan." };
    var currentStatus = stockProductionReportsText(report.Status).toUpperCase();
    if (currentStatus === targetStatus) return { status: "success", idempotent: true, report: report, previousStatus: currentStatus, currentStatus: currentStatus };
    if (currentStatus !== "MENUNGGU_VERIFIKASI") {
      return { status: "error", code: "invalid_report_transition", reportId: reportId, previousStatus: currentStatus, currentStatus: currentStatus, requestedStatus: targetStatus, message: "Laporan sudah diproses dan tidak dapat diubah lagi." };
    }
    var reason = stockProductionReportsText(input.rejectionReason || input.reason);
    if (targetStatus === "DITOLAK" && !reason) return { status: "error", code: "rejection_reason_required", message: "Alasan penolakan wajib diisi." };
    var now = new Date();
    var changes = { Status: targetStatus };
    if (targetStatus === "DIVERIFIKASI") {
      changes.VerifiedAt = now;
      changes.VerifiedBy = user.email;
    } else {
      changes.RejectedAt = now;
      changes.RejectedBy = user.email;
      changes.RejectionReason = reason;
    }
    stockProductionReportsUpdateFields(sheet, report._row, changes);
    Object.keys(changes).forEach(function(key) { report[key] = changes[key]; });
    transitionResult = { status: "success", idempotent: false, report: report, previousStatus: currentStatus, currentStatus: targetStatus };
  } finally {
    lock.releaseLock();
  }
  if (transitionResult && !transitionResult.idempotent) {
    transitionResult.notification = stockProductionReportsNotifyTransition(transitionResult.report, targetStatus);
  }
  return transitionResult;
}

function stockProductionReportsHandlePhoto(message, updateId) {
  var chatId = message && message.chat && message.chat.id;
  var stage = "RESOLVE_RECIPIENT";
  var resolution;
  try {
    resolution = stockProductionReportsRunStage(stage, function() { return stockProductionReportsResolveRecipient(chatId); });
  } catch (error) {
    return stockProductionReportsFailure(chatId, error, stage);
  }
  if (!resolution || resolution.status !== "resolved") return { handled: false, status: "ignored" };
  stage = "PICK_PHOTO";
  var photo;
  try {
    photo = stockProductionReportsRunStage(stage, function() { return stockProductionReportsPickPhoto(message); });
  } catch (error) {
    return stockProductionReportsFailure(chatId, error, stage);
  }
  if (!photo || !photo.file_id) return { handled: true, status: "error", message: "Foto laporan tidak valid." };
  var messageId = message && message.message_id;
  var lock = null;
  var file = null;
  var locked = false;
  try {
    stage = "CHECK_PRODUCTION_REPORT";
    locked = stockProductionReportsRunStage(stage, function() {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) throw new Error("Laporan sedang diproses. Silakan tunggu sebentar.");
      return true;
    });
    var sheet = stockProductionReportsRunStage(stage, function() { return stockProductionReportsEnsureSheet(); });
    var existing = stockProductionReportsRunStage(stage, function() {
      return stockProductionReportsExistingDuplicate(stockProductionReportsRows(sheet), updateId, chatId, messageId);
    });
    if (existing) {
      if (typeof stockProductionTelegramClearSession === "function") stockProductionTelegramClearSession(chatId);
      return { handled: true, status: "duplicate", reportId: existing.ReportID };
    }
    var updateKey = stockProductionReportsText(updateId);
    if (updateKey && PropertiesService.getScriptProperties().getProperty(PRODUCTION_REPORTS_IDEMPOTENCY_PREFIX + updateKey)) {
      return { handled: true, status: "duplicate" };
    }
  } catch (error) {
    return stockProductionReportsFailure(chatId, error, stage);
  } finally {
    if (locked) lock.releaseLock();
  }

  try {
    stage = "DOWNLOAD_TELEGRAM_FILE";
    var downloadResult = stockProductionReportsRunStage(stage, function() {
      var telegramFile = stockProductionReportsApi("getFile", { file_id: photo.file_id });
      var filePath = telegramFile && telegramFile.file_path;
      if (!filePath) throw new Error("Telegram tidak mengembalikan lokasi foto.");
      var downloaded = UrlFetchApp.fetch("https://api.telegram.org/file/bot" + _getTelegramBotToken() + "/" + filePath, { method: "GET", muteHttpExceptions: true });
      if (downloaded.getResponseCode && downloaded.getResponseCode() >= 300) throw new Error("Foto gagal diunduh dari Telegram.");
      return { filePath: filePath, downloaded: downloaded };
    });
    var filePath = downloadResult.filePath;
    var downloaded = downloadResult.downloaded;
    stage = "CREATE_BLOB";
    var blobResult = stockProductionReportsRunStage(stage, function() {
      var value = downloaded.getBlob();
      return { blob: value, mimeType: stockProductionReportsText(value.getContentType && value.getContentType()) || "image/jpeg" };
    });
    var blob = blobResult.blob;
    var mimeType = blobResult.mimeType;
    var stamp = Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE || "Asia/Jakarta", "yyyyMMdd-HHmmss");
    var recipientSlug = stockProductionReportsSlug(resolution.recipient.name);
    var extension = stockProductionReportsExtension(filePath, mimeType);
    stage = "RESOLVE_PROPERTY";
    var folder = stockProductionReportsRecipientFolder(resolution.recipient);
    var lockForCommit = null;
    var commitLocked = false;
    try {
      stage = "CHECK_PRODUCTION_REPORT";
      commitLocked = stockProductionReportsRunStage(stage, function() {
        lockForCommit = LockService.getScriptLock();
        if (!lockForCommit.tryLock(5000)) throw new Error("Laporan sedang diproses. Silakan tunggu sebentar.");
        return true;
      });
      var sheetForCommit = stockProductionReportsRunStage(stage, function() { return stockProductionReportsEnsureSheet(); });
      var duplicate = stockProductionReportsRunStage(stage, function() {
        return stockProductionReportsExistingDuplicate(stockProductionReportsRows(sheetForCommit), updateId, chatId, messageId);
      });
      if (duplicate) return { handled: true, status: "duplicate", reportId: duplicate.ReportID };
      var rows = stockProductionReportsRows(sheetForCommit);
      var reportId = stockProductionReportsNextId(rows, stamp, recipientSlug);
      var fileName = reportId + "." + extension;
      blob.setName(fileName);
      stage = "UPLOAD_DRIVE";
      file = stockProductionReportsUploadDriveFile(folder, blob, { fileName: fileName, mimeType: mimeType, fileSize: photo.file_size });
      var report = {
        ReportID: reportId, ProductionRecipient: resolution.recipient.id, TelegramChatId: String(chatId), ReceivedAt: new Date(),
        TelegramUpdateId: stockProductionReportsText(updateId), TelegramMessageId: stockProductionReportsText(messageId), TelegramFileId: photo.file_id,
        DriveFileId: file.getId(), DriveUrl: file.getUrl(), FileName: fileName, MimeType: mimeType,
        Status: "MENUNGGU_VERIFIKASI", Caption: stockProductionReportsText(message && message.caption)
      };
      stage = "WRITE_PRODUCTION_REPORT";
      stockProductionReportsRunStage(stage, function() {
        sheetForCommit.appendRow(PRODUCTION_REPORTS_HEADERS.map(function(header) { return report[header] === undefined ? "" : report[header]; }));
        if (updateId !== undefined && updateId !== null && stockProductionReportsText(updateId)) PropertiesService.getScriptProperties().setProperty(PRODUCTION_REPORTS_IDEMPOTENCY_PREFIX + stockProductionReportsText(updateId), reportId);
        if (typeof stockProductionTelegramClearSession === "function") stockProductionTelegramClearSession(chatId);
      });
    } finally {
      if (commitLocked) lockForCommit.releaseLock();
    }
    stage = "SUCCESS";
    stockProductionReportsLogStage(stage);
    var confirmation = "✅ <b>LAPORAN BERHASIL DITERIMA</b>\n\nLaporan produksi Anda sudah tersimpan.\n\nID Laporan:\n" + report.ReportID + "\n\nStatus:\n🕐 Menunggu verifikasi\n\nTerima kasih.";
    sendTelegramToChatId(chatId, confirmation, { replyMarkup: stockProductionReportsKeyboard() });
    return { handled: true, status: "success", reportId: report.ReportID, fileId: report.DriveFileId };
  } catch (error) {
    if (file) { try { file.setTrashed(true); } catch (ignoreTrashError) {} }
    return stockProductionReportsFailure(chatId, error, stage);
  }
}

function stockProductionReportsIsLegacyCallback(data) {
  return /^prod:(?:pending(?:-product:[A-Za-z0-9_-]{1,80})?|progress|completed|history(?::\d+)?|stock(?:-product:[A-Za-z0-9_-]{1,80})?|profile|start(?:-(?:confirm|edit))?:[A-Za-z0-9_-]{1,80}|complete(?:-(?:confirm|edit))?:[A-Za-z0-9_-]{1,80}|detail:[A-Za-z0-9_-]{1,80})$/.test(stockProductionReportsText(data));
}

function stockProductionReportsRejectLegacyCallback(chatId) {
  var message = "ℹ️ Kontrol produksi melalui Telegram sementara dinonaktifkan.\n\nSilakan gunakan Web/Admin untuk mengelola lifecycle produksi.";
  var sent = sendTelegramToChatId(chatId, message, { replyMarkup: stockProductionReportsKeyboard() });
  if (typeof stockProductionTelegramClearSession === "function") stockProductionTelegramClearSession(chatId);
  return { status: sent ? "disabled" : "error", code: "telegram_production_control_disabled", message: message };
}
