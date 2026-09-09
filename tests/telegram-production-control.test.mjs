import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const engineSource = fs.readFileSync(new URL("../src/backend/Production/StockProductionEngine.gs", import.meta.url), "utf8");
const telegramSource = fs.readFileSync(new URL("../src/backend/NotificationCenter/telegram.gs", import.meta.url), "utf8");
const codeSource = fs.readFileSync(new URL("../src/backend/code.gs", import.meta.url), "utf8");

class MemorySheet {
  constructor(headers) {
    this.headers = headers.slice();
    this.rows = [];
  }

  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return this.headers.length; }
  getDataRange() { return { getValues: () => [this.headers, ...this.rows.map(row => row.slice())] }; }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues: () => {
        if (row === 1) return [this.headers.slice(column - 1, column - 1 + columnCount)];
        return Array.from({ length: rowCount }, (_, offset) => (this.rows[row - 2 + offset] || []).slice(column - 1, column - 1 + columnCount));
      },
      setValue: value => {
        const target = this.rows[row - 2];
        if (!target) throw new Error("Memory sheet row does not exist");
        target[column - 1] = value;
      }
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
}

const locks = { held: false, acquisitions: 0 };
const cacheValues = new Map();
const context = {
  console, Array, Date, JSON, Math, Number, Object, RegExp, String, isFinite,
  cleanText: value => String(value == null ? "" : value),
  Utilities: {
    getUuid: () => "test-uuid",
    formatDate: date => {
      const value = new Date(date);
      return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()} ${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
    }
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => {
        if (locks.held) return false;
        locks.held = true;
        locks.acquisitions += 1;
        return true;
      },
      releaseLock: () => { locks.held = false; }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: key => cacheValues.get(key) || null,
      put: (key, value) => { cacheValues.set(key, value); },
      remove: key => { cacheValues.delete(key); }
    })
  }
};
vm.createContext(context);
vm.runInContext(engineSource, context);

const sheets = {
  queue: new MemorySheet(context.PRODUCTION_QUEUE_HEADERS),
  history: new MemorySheet(context.PRODUCTION_HISTORY_HEADERS)
};
function addQueue(values) {
  sheets.queue.appendRow(context.PRODUCTION_QUEUE_HEADERS.map(header => values[header] === undefined ? "" : values[header]));
}
function queueById(queueId) {
  return context.stockProductionReadSheetObjects(sheets.queue).find(row => row.QueueID === queueId);
}
function queueFixture(queueId, recipientId, status = "PENDING", overrides = {}) {
  return {
    QueueID: queueId, SKU: `SKU-${queueId}`, Product: `Produk ${queueId}`, Category: "Dress", Color: "Hitam", Size: "L",
    StockAtCreation: 1, MinimumStock: 2, IdealStock: 8, ProductionMin: 2, ProductionTarget: 8,
    RecommendedQty: 7, PlannedQty: 7, CompletedQty: "", MovingStat: "FAST", Priority: "HIGH", Status: status,
    CreatedAt: "2026-09-04T08:00:00.000Z", CreatedBy: "admin@example.test", StartedAt: "", StartedBy: "", CompletedAt: "", CompletedBy: "",
    CancelledAt: "", CancelledBy: "", Note: "", ActiveRequirementKey: "REQ-1", ProductionRecipient: recipientId,
    NotificationStatus: "SENT", NotificationSource: "AUTOMATIC", LastNotificationAt: "", LastNotificationError: "", UpdatedAt: "",
    ...overrides
  };
}

let recipients = [
  { id: "RECIPIENT-A", name: "Konveksi A", type: "KONVEKSI", telegramChatId: "111", active: true },
  { id: "RECIPIENT-B", name: "Konveksi B", type: "KONVEKSI", telegramChatId: "222", active: true },
  { id: "MANG-IYUS", name: "Mang Iyus", type: "KONVEKSI", telegramChatId: "444", active: true },
  { id: "LEGACY-TAILOR", name: "Penjahit Lama", type: "PENJAHIT", telegramChatId: "333", active: true }
];
function recipientReader() {
  const byId = Object.fromEntries(recipients.map(item => [item.id, item]));
  const byName = {};
  recipients.forEach(item => { (byName[item.name.toUpperCase()] ||= []).push(item); });
  return { available: true, recipients, byId, byName, invalid: [] };
}
context.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: name => name === context.PRODUCTION_QUEUE_SHEET ? sheets.queue : (name === context.PRODUCTION_HISTORY_SHEET ? sheets.history : null)
  })
};
context.ensureStockProductionDatabase = () => sheets;
context.readProductionRecipients = recipientReader;
context.requireStockProductionPermission = () => ({ email: "admin@example.test", name: "Admin", role: "ADMIN" });
context.stockProductionReportsResolveRecipient = chatId => {
  const recipient = recipients.find(item => String(item.telegramChatId) === String(chatId) && item.active);
  return recipient ? { status: "resolved", recipient } : { status: "recipient_not_found", recipient: null };
};

const sentMessages = [];
const callbackAnswers = [];
vm.runInContext(telegramSource, context);
context.sendTelegramToChatId = (chatId, message, options) => {
  sentMessages.push({ chatId: String(chatId), message, options });
  return true;
};
context.answerTelegramCallbackQuery = (id, text, showAlert) => {
  callbackAnswers.push({ id, text, showAlert: !!showAlert });
  return true;
};
context.editTelegramInlineKeyboard = () => true;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

addQueue(queueFixture("QUEUE-A-PENDING", "RECIPIENT-A"));
addQueue(queueFixture("QUEUE-A-PROGRESS", "RECIPIENT-A", "IN_PROGRESS", { StartedAt: "2026-09-04T09:00:00.000Z", StartedBy: "telegram:111" }));
addQueue(queueFixture("QUEUE-A-DONE", "RECIPIENT-A", "COMPLETED", { CompletedAt: "2026-09-04T10:00:00.000Z", CompletedBy: "telegram:111", CompletedQty: 7, ActiveRequirementKey: "" }));
addQueue(queueFixture("QUEUE-B-PENDING", "RECIPIENT-B"));
addQueue(queueFixture("QUEUE-MANG-PENDING", "MANG-IYUS"));
addQueue(queueFixture("QUEUE-MANG-DONE", "MANG-IYUS", "COMPLETED", { CompletedAt: "2026-09-04T11:00:00.000Z", CompletedBy: "telegram:444", CompletedQty: 5, ActiveRequirementKey: "" }));
addQueue(queueFixture("QUEUE-LEGACY", "LEGACY-TAILOR"));

test("active ProductionRecipient receives the Konveksi menu", () => {
  const result = context.handleTelegramProductionRecipientMenu("111");
  assert.equal(result.handled, true);
  assert.match(sentMessages.at(-1).message, /KONVEKSI/);
  assert.equal(sentMessages.at(-1).options.replyMarkup.inline_keyboard.length, 3);
});

test("Konveksi menu counters come only from canonical recipient queues", () => {
  const counts = context.stockProductionTelegramQueueCounts([
    { status: "PENDING" }, { status: "PENDING" }, { status: "COMPLETED" },
    { status: "RESOLVED" }, { status: "CANCELLED" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { pending: 2, inProgress: 0, completed: 1 });
  const scoped = context.stockProductionGetTelegramRecipientQueues({ chatId: "111" });
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionTelegramQueueCounts(scoped.queues))), { pending: 1, inProgress: 1, completed: 1 });
  assert.match(JSON.stringify(context.stockProductionTelegramMenuKeyboardForChat("111")), /Lapor Produksi Selesai/);
});

test("legacy production-control menu is no longer exposed", () => {
  const keyboard = JSON.stringify(context.stockProductionTelegramMenuKeyboard());
  assert.match(keyboard, /prod:report:new/);
  assert.match(keyboard, /prod:reports:1/);
  assert.doesNotMatch(keyboard, /prod:pending|prod:progress|prod:completed|prod:history:1|prod:stock|prod:profile/);
});

test("ordinary chat keeps the existing /start path", () => {
  let starts = 0;
  context.handleTelegramStart = () => { starts += 1; return { status: "success", existing: true }; };
  const result = context.handleTelegramWebhook({ message: { chat: { id: 999 }, text: "/start", from: {} } });
  assert.equal(result.existing, true);
  assert.equal(starts, 1);
});

test("Mang Iyus is a recipient-scoped Konveksi with canonical queue counters", () => {
  const result = context.handleTelegramWebhook({ message: { chat: { id: 444 }, text: "/start", from: {} } });
  assert.equal(result.handled, true);
  assert.match(sentMessages.at(-1).message, /Mang Iyus/);
  const queues = context.stockProductionGetTelegramRecipientQueues({ chatId: "444" });
  assert.deepEqual(JSON.parse(JSON.stringify(queues.queues.map(row => row.queueId).sort())), ["QUEUE-MANG-DONE", "QUEUE-MANG-PENDING"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionTelegramQueueCounts(queues.queues))), { pending: 1, inProgress: 0, completed: 1 });
  const profile = context.stockProductionGetTelegramRecipientProfile({ chatId: "444" });
  assert.deepEqual(JSON.parse(JSON.stringify(profile.counts)), { pending: 1, inProgress: 0, completed: 1 });
});

// The retained lifecycle tests below exercise canonical helpers with their
// historical fixture. The report-specific harness covers the deployed
// Telegram gate that rejects these callbacks.
context.stockProductionReportsResolveRecipient = () => ({ status: "recipient_not_found", recipient: null });

test("Mang Iyus cannot access queues owned by Al Faruqi or Ansla", () => {
  const historyBefore = sheets.history.rows.length;
  ["QUEUE-A-PENDING", "QUEUE-B-PENDING"].forEach(queueId => {
    const result = context.handleTelegramProductionRecipientAction({ chatId: "444", action: "START", queueId, productionQty: 6 });
    assert.equal(result.status, "error");
  });
  assert.equal(queueById("QUEUE-A-PENDING").Status, "PENDING");
  assert.equal(queueById("QUEUE-B-PENDING").Status, "PENDING");
  assert.equal(sheets.history.rows.length, historyBefore);
});

test("recipient list exposes only queues assigned to the same recipient", () => {
  const result = context.stockProductionGetTelegramRecipientQueues({ chatId: "111" });
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(JSON.stringify(result.queues.map(row => row.queueId).sort())), ["QUEUE-A-DONE", "QUEUE-A-PENDING", "QUEUE-A-PROGRESS"]);
});

test("recipient A cannot view recipient B queue through an ownership-filtered list", () => {
  const result = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "PENDING" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.queues.map(row => row.queueId))), ["QUEUE-A-PENDING"]);
});

test("pending queue exposes the individual start action", () => {
  const queue = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "PENDING" }).queues[0];
  assert.match(JSON.stringify(context.stockProductionTelegramQueueKeyboard(queue)), /prod:start:QUEUE-A-PENDING/);
});

test("start action uses the canonical transition, stores ProductionQty, and keeps stock untouched", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-A-PENDING", productionQty: 6 });
  assert.equal(result.status, "success");
  assert.equal(queueById("QUEUE-A-PENDING").Status, "IN_PROGRESS");
  assert.equal(queueById("QUEUE-A-PENDING").PlannedQty, 6);
  assert.equal(queueById("QUEUE-A-PENDING").RecommendedQty, 7);
  assert.equal(queueById("QUEUE-A-PENDING").StartedBy, "telegram:111");
  assert.equal(Object.prototype.hasOwnProperty.call(queueById("QUEUE-A-PENDING"), "Stock"), false);
  assert.equal(sheets.history.rows.length, 1);
});

test("duplicate start is idempotent and adds no history", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-A-PENDING", productionQty: 6 });
  assert.equal(result.status, "info");
  assert.equal(sheets.history.rows.length, 1);
});

test("in-progress queue exposes the individual completion action", () => {
  const queue = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "IN_PROGRESS" }).queues.find(row => row.queueId === "QUEUE-A-PROGRESS");
  assert.match(JSON.stringify(context.stockProductionTelegramQueueKeyboard(queue)), /prod:complete:QUEUE-A-PROGRESS/);
});

test("completion stores an explicit actual quantity without an inventory mutation", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "COMPLETE", queueId: "QUEUE-A-PROGRESS", completedQty: 5 });
  const row = queueById("QUEUE-A-PROGRESS");
  assert.equal(result.status, "success");
  assert.equal(row.Status, "COMPLETED");
  assert.equal(row.CompletedQty, 5);
  assert.equal(row.CompletedBy, "telegram:111");
  assert.equal(row.ActiveRequirementKey, "");
  assert.equal(sheets.history.rows.length, 2);
});

test("Telegram completion leaves ProductionConfiguration outside the control path", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleTelegramProductionRecipientAction"), engineSource.indexOf("function handleIgnoreStockAlert"));
  assert.doesNotMatch(body, /readStockProductionConfiguration|handleSaveProductionConfiguration|PRODUCTION_CONFIGURATION_SHEET/);
});

test("Telegram lifecycle control preserves the existing queue notification state", () => {
  assert.equal(queueById("QUEUE-A-PROGRESS").NotificationStatus, "SENT");
  assert.equal(queueById("QUEUE-A-PROGRESS").NotificationSource, "AUTOMATIC");
});

test("Telegram transition history uses the canonical queue action and Telegram actor", () => {
  const history = context.stockProductionReadSheetObjects(sheets.history);
  assert.equal(history[1].Action, "QUEUE_COMPLETED");
  assert.equal(history[1].UserEmail, "telegram:111");
  assert.equal(history[1].UserName, "Konveksi A");
});

test("duplicate completion is idempotent and adds no history", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "COMPLETE", queueId: "QUEUE-A-PROGRESS", completedQty: 5 });
  assert.equal(result.status, "info");
  assert.equal(sheets.history.rows.length, 2);
});

test("completed queue remains terminal", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-A-DONE", productionQty: 6 });
  assert.equal(result.status, "info");
  assert.equal(queueById("QUEUE-A-DONE").Status, "COMPLETED");
});

test("cross-recipient callback is denied without a write", () => {
  const before = sheets.history.rows.length;
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-B-PENDING", productionQty: 6 });
  assert.equal(result.status, "error");
  assert.equal(result.code, "queue_access_denied");
  assert.equal(queueById("QUEUE-B-PENDING").Status, "PENDING");
  assert.equal(sheets.history.rows.length, before);
});

test("inactive recipient is denied without a write", () => {
  const before = sheets.history.rows.length;
  recipients = recipients.map(recipient => recipient.id === "RECIPIENT-A" ? { ...recipient, active: false } : recipient);
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-B-PENDING", productionQty: 6 });
  assert.equal(result.status, "error");
  assert.equal(result.code, "recipient_inactive");
  assert.equal(sheets.history.rows.length, before);
  recipients = recipients.map(recipient => recipient.id === "RECIPIENT-A" ? { ...recipient, active: true } : recipient);
});

test("deleted or invalid queue gets a safe error", () => {
  const result = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "MISSING-QUEUE", productionQty: 6 });
  assert.equal(result.status, "error");
  assert.equal(result.code, "queue_not_found");
});

test("legacy PENJAHIT recipient remains resolvable by its configured chat ID", () => {
  const result = context.stockProductionGetTelegramRecipientQueues({ chatId: "333", status: "PENDING" });
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(JSON.stringify(result.queues.map(row => row.queueId))), ["QUEUE-LEGACY"]);
});

test("completed list is ownership scoped and presents waiting-for-stock-in text", () => {
  const result = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "COMPLETED" });
  assert.equal(result.queues.length, 2);
  assert.ok(result.queues.some(queue => queue.queueId === "QUEUE-A-DONE"));
  assert.equal(sheets.history.rows.some(row => row.QueueID === "QUEUE-A-DONE"), false);
  assert.match(context.stockProductionTelegramQueueText(result.queues[0], true), /Menunggu barang masuk/);
});

test("completed queue detail remains canonical while waiting for stock in", () => {
  const queue = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "COMPLETED" }).queues.find(item => item.queueId === "QUEUE-A-DONE");
  const detail = context.stockProductionTelegramQueueText(queue, true);
  assert.match(detail, /PRODUKSI SELESAI/);
  assert.match(detail, /Kebutuhan sistem:/);
  assert.match(detail, /Jumlah produksi:/);
  assert.match(detail, /Jumlah selesai:/);
  assert.match(detail, /Menunggu barang masuk ke gudang/);
});

test("completed queues stay isolated to their assigned recipient", () => {
  addQueue(queueFixture("QUEUE-B-DONE", "RECIPIENT-B", "COMPLETED", { CompletedQty: 4, CompletedAt: "2026-09-05T10:30:00.000Z", ActiveRequirementKey: "" }));
  const recipientA = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "COMPLETED" });
  assert.doesNotMatch(JSON.stringify(recipientA.queues), /QUEUE-B-DONE/);
});

test("detail callback cannot read another recipient queue", () => {
  const result = context.handleTelegramWebhook({ callback_query: { id: "callback-detail-denied", data: "prod:detail:QUEUE-B-PENDING", message: { message_id: 78, chat: { id: 111 } } } });
  assert.equal(result.status, "error");
  assert.match(result.message, /tidak ditemukan|tidak dapat diakses/i);
});

test("status menus return only the requested lifecycle state", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "IN_PROGRESS" }).queues.map(row => row.status))), ["IN_PROGRESS"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "COMPLETED" }).queues.map(row => row.status))), ["COMPLETED", "COMPLETED"]);
});

test("retired Telegram lifecycle callbacks are unreachable from the report-only surface", () => {
  assert.match(telegramSource, /stockProductionReportsRejectLegacyCallback\(chatId\)/);
  assert.match(telegramSource, /typeof stockProductionReportsRejectLegacyCallback === "function" && \/\^prod:\/\.test\(data\)/);
  assert.match(fs.readFileSync(new URL("../src/backend/Production/ProductionReports.gs", import.meta.url), "utf8"), /pending\(\?:-product/);
});

test("stale Telegram button cannot revert a web-completed queue", () => {
  addQueue(queueFixture("QUEUE-WEB", "RECIPIENT-A"));
  const web = context.handleUpdateProductionQueueStatus({ queueId: "QUEUE-WEB", nextStatus: "IN_PROGRESS" });
  assert.equal(web.status, "success");
  const webComplete = context.handleUpdateProductionQueueStatus({ queueId: "QUEUE-WEB", nextStatus: "COMPLETED", completedQty: 7 });
  assert.equal(webComplete.status, "success");
  const before = sheets.history.rows.length;
  const stale = context.handleTelegramProductionRecipientAction({ chatId: "111", action: "START", queueId: "QUEUE-WEB", productionQty: 6 });
  assert.equal(stale.status, "info");
  assert.equal(queueById("QUEUE-WEB").Status, "COMPLETED");
  assert.equal(sheets.history.rows.length, before);
});

test("web and Telegram share one locked canonical status writer", () => {
  assert.match(engineSource, /function stockProductionTransitionQueueStatus\(data, user, options\)/);
  assert.match(engineSource, /return stockProductionTransitionQueueStatus\(data, user\)/);
  assert.match(engineSource, /stockProductionTransitionQueueStatus\(transitionData, null/);
  assert.ok(locks.acquisitions >= 1);
});

test("details expose only operational production fields", () => {
  const queue = context.stockProductionGetTelegramRecipientQueues({ chatId: "111", status: "COMPLETED" }).queues[0];
  const message = context.stockProductionTelegramQueueText(queue, true);
  assert.match(message, /Minimum:/);
  assert.match(message, /Target:/);
  assert.doesNotMatch(message, /margin|profit|harga/i);
});

test("callback format stays compact and treats queue ID as a validated pointer", () => {
  assert.match(telegramSource, /\^prod:\(start\|complete\|detail\):\(\[A-Za-z0-9_-\]\{1,80\}\)\$/);
  assert.match(telegramSource, /handleTelegramProductionRecipientAction\(\{ chatId: chatId, queueId: session\.queueId/);
});

test("webhook route accepts callback_query updates with Telegram update deduplication", () => {
  assert.match(codeSource, /typeof data\.message !== "undefined" \|\| typeof data\.callback_query !== "undefined"/);
  assert.match(codeSource, /cacheKey = "tg_update_" \+ data\.update_id/);
});

test("Telegram production action does not invoke inventory, alert, or notification dispatchers", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleTelegramProductionRecipientAction"), engineSource.indexOf("function handleIgnoreStockAlert"));
  assert.doesNotMatch(body, /handleBarangMasuk|MasterBarang|stockProductionDispatchLifecycleBatch|stockProductionNotifyBatch|stockProductionUpdateObjectRow\(sheets\.alerts/);
});

test("pending queues are grouped by product before their variants are shown", () => {
  addQueue(queueFixture("QUEUE-A-GROUP-S", "RECIPIENT-A", "PENDING", { Product: "Emaar Dress", Color: "HTM", Size: "S" }));
  addQueue(queueFixture("QUEUE-A-GROUP-M", "RECIPIENT-A", "PENDING", { Product: "Emaar Dress", Color: "HTM", Size: "M" }));
  const before = JSON.stringify(sheets.queue.rows);
  assert.match(telegramSource, /stockProductionReportsIsLegacyCallback\(data\)/);
  assert.match(fs.readFileSync(new URL("../src/backend/Production/ProductionReports.gs", import.meta.url), "utf8"), /pending\(\?:-product/);
  assert.equal(JSON.stringify(sheets.queue.rows), before);
});

test("retired Telegram quantity input cannot write a queue", () => {
  addQueue(queueFixture("QUEUE-A-INPUT", "RECIPIENT-A"));
  const beforeQueue = JSON.stringify(queueById("QUEUE-A-INPUT"));
  const beforeHistory = JSON.stringify(sheets.history.rows);
  assert.match(fs.readFileSync(new URL("../src/backend/Production/ProductionReports.gs", import.meta.url), "utf8"), /Kontrol produksi melalui Telegram sementara dinonaktifkan/);
  assert.equal(JSON.stringify(queueById("QUEUE-A-INPUT")), beforeQueue);
  assert.equal(JSON.stringify(sheets.history.rows), beforeHistory);
});

test("retired Telegram quantity conversation has no lifecycle session", () => {
  addQueue(queueFixture("QUEUE-A-SCOPED", "RECIPIENT-A"));
  const otherChat = context.handleTelegramWebhook({ message: { chat: { id: 222 }, text: "6", from: {} } });
  assert.equal(otherChat.status, "ignored");
  assert.equal(queueById("QUEUE-A-SCOPED").Status, "PENDING");
  assert.doesNotMatch(JSON.stringify(cacheValues), /QUEUE-A-SCOPED/);
});

test("retired Telegram start confirmation cannot commit a queue", () => {
  addQueue(queueFixture("QUEUE-A-CONFIRM", "RECIPIENT-A"));
  const before = JSON.stringify(queueById("QUEUE-A-CONFIRM"));
  assert.equal(JSON.stringify(queueById("QUEUE-A-CONFIRM")), before);
  assert.match(telegramSource, /stockProductionReportsRejectLegacyCallback\(chatId\)/);
});

test("retired Telegram start does not apply planned quantity", () => {
  addQueue(queueFixture("QUEUE-A-OVER-RECOMMENDED", "RECIPIENT-A", "PENDING", { RecommendedQty: 2, PlannedQty: 2 }));
  assert.equal(queueById("QUEUE-A-OVER-RECOMMENDED").PlannedQty, 2);
  assert.equal(queueById("QUEUE-A-OVER-RECOMMENDED").Status, "PENDING");
});

test("retired Telegram completion cannot apply CompletedQty", () => {
  addQueue(queueFixture("QUEUE-A-COMPLETE-CONFIRM", "RECIPIENT-A", "IN_PROGRESS", { PlannedQty: 6, StartedAt: "2026-09-05T08:00:00.000Z", StartedBy: "telegram:111" }));
  assert.equal(queueById("QUEUE-A-COMPLETE-CONFIRM").Status, "IN_PROGRESS");
  assert.equal(queueById("QUEUE-A-COMPLETE-CONFIRM").CompletedQty, "");
});

test("retired Telegram completion does not change a queue", () => {
  addQueue(queueFixture("QUEUE-A-OVER-PLANNED", "RECIPIENT-A", "IN_PROGRESS", { RecommendedQty: 2, PlannedQty: 3, StartedAt: "2026-09-05T08:30:00.000Z", StartedBy: "telegram:111" }));
  assert.equal(queueById("QUEUE-A-OVER-PLANNED").CompletedQty, "");
  assert.equal(queueById("QUEUE-A-OVER-PLANNED").Status, "IN_PROGRESS");
});

test("production history is recipient scoped and paginated from canonical history", () => {
  for (let index = 0; index < 7; index += 1) {
    const queueId = `QUEUE-A-HISTORY-${index}`;
    addQueue(queueFixture(queueId, "RECIPIENT-A", "COMPLETED", { CompletedQty: 5, ActiveRequirementKey: "", CompletedAt: `2026-09-0${index + 1}T10:00:00.000Z` }));
    context.stockProductionWriteHistory(sheets.history, { email: "telegram:111", name: "Konveksi A" }, "QUEUE_COMPLETED", `SKU-${queueId}`, queueId, {}, queueById(queueId), "");
  }
  addQueue(queueFixture("QUEUE-B-HISTORY", "RECIPIENT-B", "COMPLETED", { CompletedQty: 7, ActiveRequirementKey: "", CompletedAt: "2026-09-05T10:00:00.000Z" }));
  context.stockProductionWriteHistory(sheets.history, { email: "telegram:222", name: "Konveksi B" }, "QUEUE_COMPLETED", "SKU-QUEUE-B-HISTORY", "QUEUE-B-HISTORY", {}, queueById("QUEUE-B-HISTORY"), "");
  const firstPage = context.stockProductionGetTelegramRecipientHistory({ chatId: "111", page: 1 });
  const secondPage = context.stockProductionGetTelegramRecipientHistory({ chatId: "111", page: 2 });
  assert.equal(firstPage.status, "success");
  assert.equal(firstPage.items.length, 6);
  assert.ok(secondPage.items.length > 0);
  assert.doesNotMatch(JSON.stringify(firstPage.items.concat(secondPage.items)), /QUEUE-B-HISTORY/);
});

test("stock view reads canonical inventory and configuration without writing queue or history", () => {
  const originalInventoryReader = context.readStockProductionInventory;
  const originalConfigurationReader = context.readStockProductionConfiguration;
  const beforeQueues = JSON.stringify(sheets.queue.rows);
  const beforeHistory = sheets.history.rows.length;
  context.readStockProductionInventory = () => ({ ok: true, items: [{ sku: "SKU-STOCK-A", product: "Emaar Dress", color: "Hitam", size: "M", stock: 1 }] });
  context.readStockProductionConfiguration = () => ({ ok: true, configs: {
    "SKU-STOCK-A": { valid: true, enabled: true, minimumStock: 2, targetStock: 7, minimumProductionBatch: 2, moving: "FAST", movingSource: "MANUAL", productionRecipient: "RECIPIENT-A" }
  } });
  try {
    const stock = context.stockProductionGetTelegramRecipientStock({ chatId: "111" });
    assert.equal(stock.status, "success");
    assert.deepEqual(JSON.parse(JSON.stringify(stock.items.map(item => item.sku))), ["SKU-STOCK-A"]);
    assert.equal(stock.items[0].status, "CRITICAL");
    assert.equal(JSON.stringify(sheets.queue.rows), beforeQueues);
    assert.equal(sheets.history.rows.length, beforeHistory);
  } finally {
    context.readStockProductionInventory = originalInventoryReader;
    context.readStockProductionConfiguration = originalConfigurationReader;
  }
});

test("profile reads only the resolved ProductionRecipient and its own queue counts", () => {
  const profile = context.stockProductionGetTelegramRecipientProfile({ chatId: "111" });
  assert.equal(profile.status, "success");
  assert.equal(profile.recipient.id, "RECIPIENT-A");
  assert.ok(profile.counts.completed > 0);
});

console.log(`Telegram Production Control: PASS (${passed} in-memory regression tests)`);
