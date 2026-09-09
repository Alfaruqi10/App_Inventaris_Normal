import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const telegramSource = fs.readFileSync(new URL("../src/backend/NotificationCenter/telegram.gs", import.meta.url), "utf8");
const reportsSource = fs.readFileSync(new URL("../src/backend/Production/ProductionReports.gs", import.meta.url), "utf8");
const reportsAuthSource = fs.readFileSync(new URL("../src/backend/Production/ProductionReportsAuth.gs", import.meta.url), "utf8");
const productionCenterSource = fs.readFileSync(new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../src/frontend/index.html", import.meta.url), "utf8");

class MemorySheet {
  constructor(headers) { this.headers = headers.slice(); this.rows = []; }
  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return this.headers.length; }
  getDataRange() { return { getValues: () => [this.headers.slice(), ...this.rows.map(row => row.slice())] }; }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues: () => row === 1 ? [this.headers.slice(column - 1, column - 1 + columnCount)] : [this.rows[row - 2].slice(column - 1, column - 1 + columnCount)],
      setValue: value => { if (row > 1) this.rows[row - 2][column - 1] = value; },
      setValues: values => { if (row === 1) this.headers = values[0].slice(); },
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
  insertColumnsAfter(_after, count) { for (let index = 0; index < count; index += 1) this.headers.push(""); this.rows.forEach(row => { for (let index = 0; index < count; index += 1) row.push(""); }); }
  setFrozenRows() {}
}

const reportSheet = new MemorySheet([
  "ReportID", "ProductionRecipient", "TelegramChatId", "ReceivedAt", "TelegramUpdateId",
  "TelegramMessageId", "TelegramFileId", "DriveFileId", "DriveUrl", "FileName", "MimeType", "Status", "Caption",
  "VerifiedAt", "VerifiedBy", "RejectedAt", "RejectedBy", "RejectionReason"
]);
const userSheet = new MemorySheet(["Email", "Nama", "Role", "Status"]);
userSheet.appendRow(["admin@example.test", "Admin", "ADMIN", "ACTIVE"]);
userSheet.appendRow(["staff@example.test", "Staff", "STAFF", "ACTIVE"]);
const sheets = { ProductionReports: reportSheet, Users: userSheet };
const properties = new Map([["PRODUCTION_REPORTS_DRIVE_FOLDER_ID", "root-folder"]]);
const cache = new Map();
const recipients = [
  { id: "MANG-IYUS", name: "Mang Iyus", type: "KONVEKSI", telegramChatId: "111", active: true },
  { id: "ANSLA", name: "Ansla", type: "KONVEKSI", telegramChatId: "222", active: true }
];
const sent = [];
const folders = new Map();
let fileCount = 0;
let failDownload = false;
let failUpload = false;
let emptyUpload = false;
let failRootAccess = false;
let touchedSheets = [];
let lastCreateFileFolder = "";

function response(text, blob) {
  return { getContentText: () => text, getResponseCode: () => 200, getBlob: () => blob || null };
}
function makeBlob() {
  return { getContentType: () => "image/jpeg", getName() { return this.name || ""; }, setName(name) { this.name = name; } };
}
function makeFolder(id, name) {
  const folder = {
    id,
    name,
    children: [],
    getName() { return this.name; },
    getFoldersByName(childName) {
      const matches = this.children.filter(child => child.name === childName);
      let index = 0;
      return { hasNext: () => index < matches.length, next: () => matches[index++] };
    },
    createFile(blob) {
      if (failUpload) throw new Error("Drive upload failed");
      if (emptyUpload) return null;
      lastCreateFileFolder = this.name;
      fileCount += 1;
      return { getId: () => "drive-" + fileCount, getUrl: () => "https://drive.example/drive-" + fileCount, setTrashed() {} };
    }
  };
  folders.set(id, folder);
  return folder;
}
const rootFolder = makeFolder("root-folder", "Laporan produksi");
const reportsFolder = makeFolder("reports-folder", "Laporan Konveksi");
const mangIyusFolder = makeFolder("mang-iyus-folder", "Mang Iyus");
rootFolder.children.push(reportsFolder);
reportsFolder.children.push(mangIyusFolder);

const context = {
  console, Array, Date, JSON, Math, Number, Object, RegExp, String, isFinite,
  STOCK_PRODUCTION_TIMEZONE: "Asia/Jakarta",
  cleanText: value => String(value == null ? "" : value),
  USER_SHEET_NAME: "Users",
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" },
    computeDigest: (_algorithm, value) => Array.from(createHash("sha256").update(String(value)).digest()),
    getUuid: () => randomUUID(),
    formatDate: (date, _tz, format) => format === "yyyyMMdd-HHmmss" ? "20260905-143522" : "05/09/2026 14:35",
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || "", setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) }) },
  CacheService: { getScriptCache: () => ({ get: key => cache.get(key) || null, put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => { touchedSheets.push(name); return sheets[name] || null; }, insertSheet: name => { sheets[name] = new MemorySheet([]); return sheets[name]; } }) },
  DriveApp: { getFolderById: id => {
    if (failRootAccess) throw new Error("Drive permission denied");
    return folders.get(id);
  } },
  UrlFetchApp: { fetch: (url) => {
    if (failDownload && url.includes("/file/bot")) throw new Error("download failed");
    if (url.includes("/getFile")) return response(JSON.stringify({ ok: true, result: { file_path: "photos/form.jpg" } }));
    return response("", makeBlob());
  } },
  _getTelegramBotToken: () => "test-token",
  readProductionRecipients: () => ({ available: true, recipients, byId: Object.fromEntries(recipients.map(item => [item.id, item])), byName: {}, invalid: [] }),
  stockProductionResolveRecipientByTelegramChatId: (chatId, source) => {
    const match = source.recipients.find(item => String(item.telegramChatId) === String(chatId) && item.active);
    return match ? { status: "resolved", recipient: match } : { status: "recipient_not_found", recipient: null };
  },
  stockProductionTelegramCell: value => String(value == null ? "" : value),
  stockProductionTelegramFormatDate: () => "05/09/2026 14:35",
  requireStockProductionPermission: data => {
    const isAdmin = String(data?.callerEmail || "") === "admin@example.test";
    return { email: isAdmin ? "admin@example.test" : "staff@example.test", name: isAdmin ? "Admin" : "Staff", role: isAdmin ? "ADMIN" : "STAFF KONVEKSI", permissions: isAdmin ? ["manage_production_queue"] : ["view_production_queue"] };
  },
  stockProductionRolePermissions: role => ["OWNER", "ADMIN"].includes(String(role).toUpperCase()) ? ["manage_production_queue"] : [],
};
vm.createContext(context);
vm.runInContext(reportsSource, context);
vm.runInContext(reportsAuthSource, context);
vm.runInContext(telegramSource, context);
context.sendTelegramToChatId = (chatId, message, options) => { sent.push({ chatId: String(chatId), message, options }); return true; };
context.answerTelegramCallbackQuery = () => true;
const adminSessionId = context.stockProductionReportsCreateSession("admin@example.test").sessionId;
const staffSessionId = context.stockProductionReportsCreateSession("staff@example.test").sessionId;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }
function captureError(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail("Expected operation to throw");
}
function assertRootFailure(error, subStage) {
  assert.equal(error.reportStage, "RESOLVE_ROOT");
  assert.equal(error.reportSubStage, subStage);
  assert.equal(error.reportCode, "PRODUCTION_REPORTS_RESOLVE_ROOT_FAILED");
  const message = context.stockProductionReportsFailureText(error, "RESOLVE_ROOT");
  assert.match(message, /Tahap gagal: <code>RESOLVE_ROOT<\/code>/);
  assert.match(message, new RegExp("Sub-tahap: <code>" + subStage + "</code>"));
  assert.match(message, /Kode: <code>PRODUCTION_REPORTS_RESOLVE_ROOT_FAILED<\/code>/);
}

test("new Konveksi menu exposes only photo report services", () => {
  const keyboard = JSON.stringify(context.stockProductionTelegramMenuKeyboard());
  assert.match(keyboard, /Lapor Produksi Selesai/);
  assert.match(keyboard, /Riwayat Laporan/);
  assert.doesNotMatch(keyboard, /Perlu Produksi|Sedang Produksi|Cek Stok|prod:start|prod:complete/);
});

test("active recipient /start gets the report menu", () => {
  const result = context.handleTelegramWebhook({ update_id: 1, message: { chat: { id: 111 }, text: "/start", from: {} } });
  assert.equal(result.handled, true);
  assert.match(sent.at(-1).message, /KONVEKSI[\s\S]*Mang Iyus[\s\S]*Pilih layanan/);
  assert.match(JSON.stringify(sent.at(-1).options.replyMarkup), /prod:report:new/);
});

test("ordinary customer /start remains on the existing path", () => {
  let called = 0;
  context.handleTelegramStart = () => { called += 1; return { status: "success", existing: true }; };
  const result = context.handleTelegramWebhook({ update_id: 2, message: { chat: { id: 999 }, text: "/start", from: {} } });
  assert.equal(result.existing, true);
  assert.equal(called, 1);
});

test("photo is downloaded, stored in Drive, and recorded without production tables", () => {
  touchedSheets = [];
  const result = context.handleTelegramWebhook({ update_id: 100, message: { message_id: 7, chat: { id: 111 }, photo: [{ file_id: "small" }, { file_id: "large", file_size: 900 }], caption: "Emaar selesai 6 pcs" } });
  assert.equal(result.status, "success");
  assert.equal(reportSheet.rows.length, 1);
  const row = Object.fromEntries(reportSheet.headers.map((header, index) => [header, reportSheet.rows[0][index]]));
  assert.equal(row.ProductionRecipient, "MANG-IYUS");
  assert.equal(row.TelegramFileId, "large");
  assert.equal(row.Status, "MENUNGGU_VERIFIKASI");
  assert.equal(lastCreateFileFolder, "Mang Iyus");
  assert.equal(row.Caption, "Emaar selesai 6 pcs");
  assert.equal(fileCount, 1);
  assert.deepEqual(touchedSheets, ["ProductionReports", "ProductionReports"]);
});

test("ProductionReports keeps the original fields and adds verification audit fields", () => {
  assert.deepEqual(reportSheet.headers, [
    "ReportID", "ProductionRecipient", "TelegramChatId", "ReceivedAt", "TelegramUpdateId",
    "TelegramMessageId", "TelegramFileId", "DriveFileId", "DriveUrl", "FileName", "MimeType", "Status", "Caption",
    "VerifiedAt", "VerifiedBy", "RejectedAt", "RejectedBy", "RejectionReason"
  ]);
});

test("admin can list and open a report by exact ReportID", () => {
  const list = context.stockProductionReportsAdminList({ sessionId: adminSessionId, callerEmail: "admin@example.test", page: 1, pageSize: 10 });
  assert.equal(list.status, "success");
  assert.equal(list.total, 1);
  assert.equal(list.items[0].ReportID, "LP-20260905-143522-MANG-IYUS-001");
  const detail = context.stockProductionReportsAdminDetail({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: list.items[0].ReportID });
  assert.equal(detail.status, "success");
  assert.equal(detail.report.DriveFileId, "drive-1");
  assert.equal(detail.report.Status, "MENUNGGU_VERIFIKASI");
});

test("admin report recipient ALL is a wildcard while specific IDs remain exact", () => {
  const originalRows = reportSheet.rows.slice();
  reportSheet.appendRow([
    "LP-20260908-090355-MANG-IYUS-001", "MANG-IYUS", "111", new Date("2026-09-08T02:03:55Z"), "301", "31", "photo-4",
    "drive-4", "https://drive.example/drive-4", "LP-20260908-090355-MANG-IYUS-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  reportSheet.appendRow([
    "LP-20260908-090355-ANSLA-001", "ANSLA", "222", new Date("2026-09-08T02:00:00Z"), "300", "30", "photo-3",
    "drive-3", "https://drive.example/drive-3", "LP-20260908-090355-ANSLA-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  try {
    const allRecipients = context.stockProductionReportsAdminList({ sessionId: adminSessionId, status: "ALL", productionRecipient: "ALL", page: 1, pageSize: 10 });
    assert.equal(allRecipients.status, "success");
    assert.equal(allRecipients.total, 3);
    assert.deepEqual(allRecipients.items.map(item => item.ProductionRecipient).sort(), ["ANSLA", "MANG-IYUS", "MANG-IYUS"]);

    const emptyRecipient = context.stockProductionReportsAdminList({ sessionId: adminSessionId, status: "ALL", productionRecipient: "", page: 1, pageSize: 10 });
    assert.equal(emptyRecipient.total, 3);

    const mangIyus = context.stockProductionReportsAdminList({ sessionId: adminSessionId, status: "ALL", productionRecipient: "MANG-IYUS", page: 1, pageSize: 10 });
    assert.equal(mangIyus.total, 2);
    assert.deepEqual(mangIyus.items.map(item => item.ProductionRecipient), ["MANG-IYUS", "MANG-IYUS"]);

    const exactReport = context.stockProductionReportsAdminList({
      sessionId: adminSessionId,
      status: "ALL",
      productionRecipient: "ALL",
      reportId: "LP-20260908-090355-MANG-IYUS-001",
      page: 1,
      pageSize: 10
    });
    assert.equal(exactReport.total, 1);
    assert.equal(exactReport.items[0].ReportID, "LP-20260908-090355-MANG-IYUS-001");

    const mangReport = context.stockProductionReportsAdminList({
      sessionId: adminSessionId,
      status: "ALL",
      productionRecipient: "MANG-IYUS",
      reportId: "LP-20260905-143522-MANG-IYUS-001",
      page: 1,
      pageSize: 10
    });
    assert.equal(mangReport.total, 1);
  } finally {
    reportSheet.rows.length = 0;
    originalRows.forEach(row => reportSheet.rows.push(row));
  }
});

test("admin verification changes only the ProductionReports row and is idempotent", () => {
  const before = reportSheet.rows[0].slice();
  const sentBefore = sent.length;
  const result = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: before[0], targetStatus: "DIVERIFIKASI" });
  assert.equal(result.status, "success");
  assert.equal(result.currentStatus, "DIVERIFIKASI");
  assert.equal(result.notification.status, "success");
  assert.equal(sent.length, sentBefore + 1);
  assert.equal(sent.at(-1).chatId, "111");
  assert.match(sent.at(-1).message, /LAPORAN PRODUKSI DIVERIFIKASI/);
  assert.match(sent.at(-1).message, new RegExp(before[0]));
  assert.match(sent.at(-1).message, /Diverifikasi/);
  assert.equal(reportSheet.rows[0][11], "DIVERIFIKASI");
  assert.equal(reportSheet.rows[0][14], "admin@example.test");
  assert.equal(reportSheet.rows[0][15], "");
  assert.equal(reportSheet.rows[0][17], "");
  const repeated = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: before[0], targetStatus: "DIVERIFIKASI" });
  assert.equal(repeated.status, "success");
  assert.equal(repeated.idempotent, true);
  assert.equal(sent.length, sentBefore + 1);
});

test("admin rejection requires a reason and stores rejection audit fields", () => {
  const sentBefore = sent.length;
  reportSheet.appendRow([
    "LP-20260905-150000-ANSLA-001", "ANSLA", "222", new Date("2026-09-05T08:00:00Z"), "200", "20", "photo-2",
    "drive-2", "https://drive.example/drive-2", "LP-20260905-150000-ANSLA-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  const missingReason = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: "LP-20260905-150000-ANSLA-001", targetStatus: "DITOLAK", rejectionReason: "   " });
  assert.equal(missingReason.code, "rejection_reason_required");
  const result = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: "LP-20260905-150000-ANSLA-001", targetStatus: "DITOLAK", rejectionReason: "Foto formulir terpotong." });
  assert.equal(result.status, "success");
  assert.equal(result.notification.status, "success");
  assert.equal(sent.length, sentBefore + 1);
  assert.equal(sent.at(-1).chatId, "222");
  assert.match(sent.at(-1).message, /LAPORAN PRODUKSI DITOLAK/);
  assert.match(sent.at(-1).message, /LP-20260905-150000-ANSLA-001/);
  assert.match(sent.at(-1).message, /Foto formulir terpotong\./);
  assert.match(sent.at(-1).message, /Lapor Produksi Selesai/);
  const row = reportSheet.rows[1];
  assert.equal(row[11], "DITOLAK");
  assert.equal(row[16], "admin@example.test");
  assert.equal(row[17], "Foto formulir terpotong.");
  const repeated = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: row[0], targetStatus: "DITOLAK" });
  assert.equal(repeated.status, "success");
  assert.equal(repeated.idempotent, true);
  assert.equal(sent.length, sentBefore + 1);
});

test("report transition uses the shared notification service after the row update", () => {
  const originalRows = reportSheet.rows.slice();
  const originalService = context.NotificationService;
  const calls = [];
  context.NotificationService = {
    sendToRecipient: (eventType, recipient, payload) => {
      calls.push({ eventType, recipient, payload });
      return { status: "success", sent: 1, failed: 0, total: 1 };
    }
  };
  reportSheet.appendRow([
    "LP-20260905-160000-MANG-IYUS-001", "MANG-IYUS", "111", new Date("2026-09-05T09:00:00Z"), "201", "21", "photo-5",
    "drive-5", "https://drive.example/drive-5", "LP-20260905-160000-MANG-IYUS-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  try {
    const result = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, reportId: "LP-20260905-160000-MANG-IYUS-001", targetStatus: "DIVERIFIKASI" });
    assert.equal(result.status, "success");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].eventType, "PRODUCTION_REPORT_DIVERIFIKASI");
    assert.equal(calls[0].recipient.telegramChatId, "111");
    assert.match(calls[0].payload.message, /LP-20260905-160000-MANG-IYUS-001/);
    assert.match(calls[0].payload.idempotencyKey, /LP-20260905-160000-MANG-IYUS-001:DIVERIFIKASI/);
    const transitionBody = reportsSource.slice(reportsSource.indexOf("function stockProductionReportsAdminTransition"), reportsSource.indexOf("function stockProductionReportsHandlePhoto"));
    assert.ok(transitionBody.indexOf("stockProductionReportsUpdateFields") < transitionBody.indexOf("stockProductionReportsNotifyTransition"));
  } finally {
    reportSheet.rows.length = 0;
    originalRows.forEach(row => reportSheet.rows.push(row));
    context.NotificationService = originalService;
  }
});

test("failed report transition never sends a Telegram notification", () => {
  const originalRows = reportSheet.rows.slice();
  const originalUpdateFields = context.stockProductionReportsUpdateFields;
  const sentBefore = sent.length;
  reportSheet.appendRow([
    "LP-20260905-170000-MANG-IYUS-001", "MANG-IYUS", "111", new Date("2026-09-05T10:00:00Z"), "202", "22", "photo-6",
    "drive-6", "https://drive.example/drive-6", "LP-20260905-170000-MANG-IYUS-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  context.stockProductionReportsUpdateFields = () => { throw new Error("transition write failed"); };
  try {
    assert.throws(() => context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, reportId: "LP-20260905-170000-MANG-IYUS-001", targetStatus: "DIVERIFIKASI" }), /transition write failed/);
    assert.equal(sent.length, sentBefore);
  } finally {
    context.stockProductionReportsUpdateFields = originalUpdateFields;
    reportSheet.rows.length = 0;
    originalRows.forEach(row => reportSheet.rows.push(row));
  }
});

test("missing recipient Chat ID does not fail the report transition", () => {
  const originalRows = reportSheet.rows.slice();
  const sentBefore = sent.length;
  reportSheet.appendRow([
    "LP-20260905-180000-MANG-IYUS-001", "MANG-IYUS", "", new Date("2026-09-05T11:00:00Z"), "203", "23", "photo-7",
    "drive-7", "https://drive.example/drive-7", "LP-20260905-180000-MANG-IYUS-001.jpg", "image/jpeg", "MENUNGGU_VERIFIKASI", "",
    "", "", "", "", ""
  ]);
  try {
    const result = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, reportId: "LP-20260905-180000-MANG-IYUS-001", targetStatus: "DIVERIFIKASI" });
    assert.equal(result.status, "success");
    assert.equal(result.notification.status, "skipped");
    assert.equal(result.notification.reason, "invalid_chat_id");
    assert.equal(sent.length, sentBefore);
  } finally {
    reportSheet.rows.length = 0;
    originalRows.forEach(row => reportSheet.rows.push(row));
  }
});

test("admin rejects terminal cross-transition and non-admin cannot use admin routes", () => {
  const cross = context.stockProductionReportsAdminTransition({ sessionId: adminSessionId, callerEmail: "admin@example.test", reportId: "LP-20260905-143522-MANG-IYUS-001", targetStatus: "DITOLAK", rejectionReason: "Tidak sesuai." });
  assert.equal(cross.code, "invalid_report_transition");
  const denied = context.stockProductionReportsAdminList({ sessionId: staffSessionId, callerEmail: "staff@example.test" });
  assert.equal(denied.message, "Akses laporan produksi hanya untuk Owner atau Admin.");
});

test("admin report UI is wired to list, detail, and transition routes", () => {
  assert.match(indexSource, /id="production-mode-reports"/);
  assert.match(indexSource, /id="production-reports-panel"/);
  assert.match(indexSource, /id="production-report-detail-modal"/);
  assert.match(indexSource, /id="production-report-reject-modal"/);
  assert.match(productionCenterSource, /request\("getProductionReports"/);
  assert.match(productionCenterSource, /request\("getProductionReportDetail"/);
  assert.match(productionCenterSource, /request\("transitionProductionReport"/);
  assert.match(productionCenterSource, /DriveFileId/);
});

test("Drive resolver uses the configured pre-created hierarchy without auto-creating folders", () => {
  const folder = context.stockProductionReportsRecipientFolder(recipients[0]);
  assert.equal(folder.getName(), "Mang Iyus");
  assert.doesNotMatch(reportsSource, /createFolder|DriveApp\.getRootFolder/);
  assert.doesNotMatch(reportsSource, /19HDRDp0noFSLH9pDHObwxhF46td1qUs/);
});

test("Drive resolver fails closed for missing or duplicate folders", () => {
  const originalChildren = reportsFolder.children.slice();
  const originalRootChildren = rootFolder.children.slice();
  reportsFolder.children.length = 0;
  assert.throws(() => context.stockProductionReportsRecipientFolder(recipients[0]), /Mang Iyus.*tidak ditemukan|Laporan Konveksi.*tidak ditemukan/);
  reportsFolder.children.push(mangIyusFolder, makeFolder("mang-iyus-duplicate", "Mang Iyus"));
  assert.throws(() => context.stockProductionReportsRecipientFolder(recipients[0]), /duplikat/);
  reportsFolder.children.length = 0;
  reportsFolder.children.push(...originalChildren);
  rootFolder.children.push(makeFolder("reports-duplicate", "Laporan Konveksi"));
  assert.throws(() => context.stockProductionReportsRecipientFolder(recipients[0]), /duplikat/);
  rootFolder.children.length = 0;
  rootFolder.children.push(...originalRootChildren);
});

test("Drive resolver fails closed when root property is missing", () => {
  const original = properties.get("PRODUCTION_REPORTS_DRIVE_FOLDER_ID");
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", "");
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  assertRootFailure(error, "PROPERTY");
  assert.match(error.message, /belum dikonfigurasi/);
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", original);
});

test("Drive resolver exposes GET_FOLDER_BY_ID_EMPTY", () => {
  const originalId = properties.get("PRODUCTION_REPORTS_DRIVE_FOLDER_ID");
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", "missing-root");
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  assertRootFailure(error, "GET_FOLDER_BY_ID_EMPTY");
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", originalId);
});

test("Drive resolver exposes ROOT_OBJECT", () => {
  const originalId = properties.get("PRODUCTION_REPORTS_DRIVE_FOLDER_ID");
  folders.set("invalid-root", { getName: () => "Laporan produksi" });
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", "invalid-root");
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  assertRootFailure(error, "ROOT_OBJECT");
  properties.set("PRODUCTION_REPORTS_DRIVE_FOLDER_ID", originalId);
});

test("Drive resolver exposes ROOT_NAME_EXCEPTION", () => {
  const originalGetName = rootFolder.getName;
  rootFolder.getName = () => { throw new Error("Drive name unavailable"); };
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  rootFolder.getName = originalGetName;
  assertRootFailure(error, "ROOT_NAME_EXCEPTION");
});

test("Drive resolver exposes ROOT_NAME_VALIDATION", () => {
  const originalName = rootFolder.name;
  rootFolder.name = "Nama Salah";
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  rootFolder.name = originalName;
  assertRootFailure(error, "ROOT_NAME_VALIDATION");
});

test("Drive resolver exposes GET_FOLDER_BY_ID_EXCEPTION", () => {
  failRootAccess = true;
  const error = captureError(() => context.stockProductionReportsRecipientFolder(recipients[0]));
  failRootAccess = false;
  assertRootFailure(error, "GET_FOLDER_BY_ID_EXCEPTION");
  assert.match(error.message, /Drive permission denied/);
});

test("valid root is exactly the configured Laporan produksi folder", () => {
  const folder = context.stockProductionReportsRecipientFolder(recipients[0]);
  assert.equal(folder.getName(), "Mang Iyus");
  assert.equal(properties.get("PRODUCTION_REPORTS_DRIVE_FOLDER_ID"), "root-folder");
});

test("repeated Telegram update is idempotent", () => {
  const reportCount = reportSheet.rows.length;
  const result = context.handleTelegramWebhook({ update_id: 100, message: { message_id: 7, chat: { id: 111 }, photo: [{ file_id: "large", file_size: 900 }] } });
  assert.equal(result.status, "duplicate");
  assert.equal(reportSheet.rows.length, reportCount);
  assert.equal(fileCount, 1);
});

  test("old lifecycle callbacks are rejected without queue mutation", () => {
    const before = JSON.stringify(reportSheet.rows);
    ["prod:start:QUEUE-1", "prod:complete:QUEUE-1", "prod:detail:QUEUE-1", "prod:pending-product:QUEUE-1"].forEach((data, index) => {
      const result = context.handleTelegramWebhook({ callback_query: { id: "old-" + index, data, message: { chat: { id: 111 }, message_id: 8 + index } } });
      assert.equal(result.code, "telegram_production_control_disabled");
      assert.match(sent.at(-1).message, /sementara dinonaktifkan/);
    });
    assert.equal(JSON.stringify(reportSheet.rows), before);
  });

test("recipient cannot view another recipient report", () => {
  const result = context.handleTelegramWebhook({ callback_query: { id: "detail-1", data: "prod:report:detail:LP-20260905-143522-MANG-IYUS-001", message: { chat: { id: 222 }, message_id: 9 } } });
  assert.equal(result.status, "error");
  assert.match(result.message, /tidak ditemukan|tidak dapat diakses/);
});

test("Drive failure returns failure and creates no report", () => {
  const reportCount = reportSheet.rows.length;
  failDownload = true;
  const result = context.handleTelegramWebhook({ update_id: 101, message: { message_id: 10, chat: { id: 111 }, photo: [{ file_id: "fail" }] } });
  failDownload = false;
  assert.equal(result.status, "error");
  assert.equal(reportSheet.rows.length, reportCount);
  assert.equal(result.stage, "DOWNLOAD_TELEGRAM_FILE");
  assert.equal(result.code, "PRODUCTION_REPORTS_DOWNLOAD_TELEGRAM_FILE_FAILED");
  assert.match(sent.at(-1).message, /Tahap gagal: <code>DOWNLOAD_TELEGRAM_FILE<\/code>/);
});

test("structured failure response exposes only stage and safe code", () => {
  const stages = [
    "RESOLVE_RECIPIENT", "PICK_PHOTO", "CHECK_PRODUCTION_REPORT", "DOWNLOAD_TELEGRAM_FILE",
    "CREATE_BLOB", "RESOLVE_PROPERTY", "RESOLVE_ROOT", "RESOLVE_LAPORAN_KONVEKSI",
    "RESOLVE_RECIPIENT_FOLDER", "UPLOAD_DRIVE", "WRITE_PRODUCTION_REPORT",
  ];
  stages.forEach(stage => {
    const error = context.stockProductionReportsStageError(stage, new Error("secret-token https://api.telegram.org/bot123/abc 123456789"));
    const message = context.stockProductionReportsFailureText(error, stage);
    assert.match(message, new RegExp("Tahap gagal: <code>" + stage + "</code>"));
    assert.match(message, new RegExp("Kode: <code>PRODUCTION_REPORTS_" + stage + "_FAILED</code>"));
    assert.doesNotMatch(message, /secret-token|api\.telegram\.org|123456789/);
  });
});

test("upload diagnostic rejects an invalid recipient folder", () => {
  const error = captureError(() => context.stockProductionReportsUploadDriveFile({}, makeBlob(), { fileName: "LP-TEST.jpg", mimeType: "image/jpeg", fileSize: 10 }));
  assert.equal(error.reportStage, "UPLOAD_DRIVE");
  assert.equal(error.reportSubStage, "GET_RECIPIENT_FOLDER");
  assert.equal(error.reportCode, "PRODUCTION_REPORTS_UPLOAD_DRIVE_FAILED");
});

test("upload diagnostic rejects an invalid blob before createFile", () => {
  const error = captureError(() => context.stockProductionReportsUploadDriveFile(mangIyusFolder, null, { fileName: "LP-TEST.jpg", mimeType: "image/jpeg", fileSize: 0 }));
  assert.equal(error.reportStage, "UPLOAD_DRIVE");
  assert.equal(error.reportSubStage, "CREATE_FILE_CALL");
  assert.equal(error.reportCode, "PRODUCTION_REPORTS_UPLOAD_DRIVE_FAILED");
});

test("upload diagnostic preserves CREATE_FILE_EXCEPTION", () => {
  failUpload = true;
  const error = captureError(() => context.stockProductionReportsUploadDriveFile(mangIyusFolder, makeBlob(), { fileName: "LP-TEST.jpg", mimeType: "image/jpeg", fileSize: 10 }));
  failUpload = false;
  assert.equal(error.reportStage, "UPLOAD_DRIVE");
  assert.equal(error.reportSubStage, "CREATE_FILE_EXCEPTION");
  assert.equal(error.reportCode, "PRODUCTION_REPORTS_UPLOAD_DRIVE_FAILED");
});

test("upload diagnostic preserves CREATE_FILE_EMPTY", () => {
  emptyUpload = true;
  const error = captureError(() => context.stockProductionReportsUploadDriveFile(mangIyusFolder, makeBlob(), { fileName: "LP-TEST.jpg", mimeType: "image/jpeg", fileSize: 10 }));
  emptyUpload = false;
  assert.equal(error.reportStage, "UPLOAD_DRIVE");
  assert.equal(error.reportSubStage, "CREATE_FILE_EMPTY");
  assert.equal(error.reportCode, "PRODUCTION_REPORTS_UPLOAD_DRIVE_FAILED");
});

test("upload diagnostic reaches CREATE_FILE_SUCCESS", () => {
  const beforeCount = fileCount;
  const file = context.stockProductionReportsUploadDriveFile(mangIyusFolder, makeBlob(), { fileName: "LP-TEST.jpg", mimeType: "image/jpeg", fileSize: 10 });
  assert.equal(typeof file.getId, "function");
  assert.equal(lastCreateFileFolder, "Mang Iyus");
  fileCount = beforeCount;
});

test("Drive upload failure preserves the UPLOAD_DRIVE stage", () => {
  const reportCount = reportSheet.rows.length;
  failUpload = true;
  const result = context.handleTelegramWebhook({ update_id: 102, message: { message_id: 11, chat: { id: 111 }, photo: [{ file_id: "upload-fail" }] } });
  failUpload = false;
  assert.equal(result.status, "error");
  assert.equal(result.stage, "UPLOAD_DRIVE");
  assert.equal(result.subStage, "CREATE_FILE_EXCEPTION");
  assert.equal(result.code, "PRODUCTION_REPORTS_UPLOAD_DRIVE_FAILED");
  assert.match(sent.at(-1).message, /Tahap gagal: <code>UPLOAD_DRIVE<\/code>/);
  assert.match(sent.at(-1).message, /Sub-tahap: <code>CREATE_FILE_EXCEPTION<\/code>/);
  assert.equal(reportSheet.rows.length, reportCount);
  assert.equal(fileCount, 1);
});

test("webhook outer catch preserves a structured report failure", () => {
  const original = context.stockProductionReportsHandlePhoto;
  context.stockProductionReportsHandlePhoto = () => {
    throw context.stockProductionReportsStageError("RESOLVE_ROOT", new Error("name failed"), "ROOT_NAME_EXCEPTION");
  };
  const result = context.handleTelegramWebhook({ update_id: 103, message: { chat: { id: 111 }, photo: [{ file_id: "outer-fail" }] } });
  context.stockProductionReportsHandlePhoto = original;
  assert.equal(result.stage, "RESOLVE_ROOT");
  assert.equal(result.subStage, "ROOT_NAME_EXCEPTION");
  assert.equal(result.code, "PRODUCTION_REPORTS_RESOLVE_ROOT_FAILED");
  assert.match(sent.at(-1).message, /Sub-tahap: <code>ROOT_NAME_EXCEPTION<\/code>/);
});

console.log(`Telegram Production Reports: PASS (${passed} in-memory regression tests)`);
