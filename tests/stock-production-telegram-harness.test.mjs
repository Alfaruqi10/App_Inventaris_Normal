import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const enginePath = new URL("../src/backend/Production/StockProductionEngine.gs", import.meta.url);
const engineSource = fs.readFileSync(enginePath, "utf8");

class MemorySheet {
  constructor(headers) {
    this.headers = headers;
    this.rows = [];
  }

  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return this.headers.length; }
  getDataRange() { return { getValues: () => [this.headers, ...this.rows] }; }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues: () => {
        if (row === 1) return [this.headers.slice(column - 1, column - 1 + columnCount)];
        return Array.from({ length: rowCount }, (_, rowOffset) => {
          const values = this.rows[row - 2 + rowOffset] || [];
          return values.slice(column - 1, column - 1 + columnCount);
        });
      },
      setValue: (value) => {
        const target = this.rows[row - 2];
        if (!target) throw new Error("Memory sheet row does not exist");
        target[column - 1] = value;
      }
    };
  }

  appendRow(values) { this.rows.push([...values]); }
}

const properties = new Map();
const notificationCalls = [];
const context = {
  console,
  isFinite,
  JSON,
  Math,
  Number,
  String,
  Date,
  Object,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value)
    })
  },
  Utilities: {
    getUuid: () => "test-uuid",
    formatDate: (_date, _timezone, pattern) => pattern === "yyyy-MM-dd" ? "2026-08-29" : "29/08/2026 09:00"
  },
  NotificationService: {
    send: (eventType, payload) => {
      notificationCalls.push({ eventType, payload });
      return { status: "success", sent: 0, failed: 0 };
    },
    sendToRecipient: (eventType, recipient, payload) => {
      notificationCalls.push({ eventType, recipient, payload });
      return { status: "success", sent: 1, failed: 0 };
    }
  }
};

vm.createContext(context);
vm.runInContext(engineSource, context);

// Automatic routing now requires an explicitly configured production recipient.
// Keep this harness entirely in-memory: no Sheet/App Script APIs or audit writes.
context.readProductionRecipients = () => ({
  available: true,
  recipients: [{
    id: "RECIPIENT-TEST",
    name: "Konveksi Test",
    type: "KONVEKSI",
    telegramChatId: "123456789",
    active: true
  }],
  byId: {
    "RECIPIENT-TEST": {
      id: "RECIPIENT-TEST",
      name: "Konveksi Test",
      type: "KONVEKSI",
      telegramChatId: "123456789",
      active: true
    }
  },
  byName: { "konveksi test": [{ id: "RECIPIENT-TEST", name: "Konveksi Test", type: "KONVEKSI", telegramChatId: "123456789", active: true }] },
  invalid: []
});
context.stockProductionWriteNotificationAudit = () => {};

const sheets = {
  alerts: new MemorySheet(context.STOCK_ALERT_HEADERS),
  queue: new MemorySheet(context.PRODUCTION_QUEUE_HEADERS),
  history: new MemorySheet(context.PRODUCTION_HISTORY_HEADERS)
};
const badzlin = {
  sku: "ANS-BAD-HTM-L",
  product: "Badzlin Dress",
  category: "Dress",
  color: "Hitam",
  size: "L",
  stock: 1,
  movingStat: "MIDDLE",
  config: {
    valid: true,
    enabled: true,
    minimumStock: 2,
    targetStock: 6,
    minimumProductionBatch: 2,
    productionRecipient: "RECIPIENT-TEST"
  }
};

const evaluation = context.evaluateStockProductionItem(badzlin, sheets, {
  notify: true,
  source: "TELEGRAM_PAYLOAD_TEST",
  user: { email: "test@example.invalid", name: "Test", role: "OWNER" },
  queueMap: {},
  alertMap: {}
});

assert.equal(evaluation.shouldNotify, true);
assert.deepEqual(JSON.parse(JSON.stringify(evaluation.notificationItem)), {
  sku: "ANS-BAD-HTM-L",
  product: "Badzlin Dress",
  color: "Hitam",
  size: "L",
  stock: 1,
  minimumStock: 2,
  targetStock: 6,
  productionTarget: 6,
  productionQty: 5,
  movingStat: "MIDDLE",
  movingState: "MIDDLE",
  status: "CRITICAL",
  priority: "MEDIUM",
  productionRecipient: "RECIPIENT-TEST",
  notificationCycle: 1
});

const dispatch = context.stockProductionDispatchLifecycleBatch([evaluation], sheets, { notify: true });
assert.equal(dispatch.status, "success");
assert.equal(notificationCalls.length, 1);
assert.equal(notificationCalls[0].eventType, "PRODUCTION_REQUIRED");
assert.equal(notificationCalls[0].recipient.id, "RECIPIENT-TEST");

const payload = notificationCalls[0].payload;
assert.match(payload.message, /\uD83D\uDFE1 MIDDLE\n\n1\. Badzlin Dress \| HTM \| L \| 2 \u2192 5/);
assert.doesNotMatch(payload.message, /Target|Status|ANS-BAD-HTM-L|<pre>/);
assert.match(payload.message, /Total: 1 item/);
assert.equal(payload.entityKey, "ANS-BAD-HTM-L");
assert.match(payload.idempotencyKey, /^STOCK_PRODUCTION_BATCH:2026-08-29:ANS-BAD-HTM-L@1:RECIPIENT:RECIPIENT-TEST$/);

const duplicateDispatch = context.stockProductionDispatchLifecycleBatch([evaluation], sheets, { notify: true });
assert.equal(duplicateDispatch.status, "suppressed");
assert.equal(duplicateDispatch.reason, "lifecycle_duplicate");
assert.equal(notificationCalls.length, 1);

// Automatic lifecycle notifications publish only the new trigger items;
// full snapshots remain available to preview/manual/test-only flows.
properties.clear();
notificationCalls.length = 0;
const newLifecycle = {
  ...evaluation,
  sku: "ANS-NEW-HTM-L",
  shouldNotify: true,
  notificationItem: { ...evaluation.notificationItem, sku: "ANS-NEW-HTM-L", product: "Produk Baru" }
};
const existingActive = {
  ...evaluation,
  sku: "ANS-EXISTING-HTM-L",
  shouldNotify: false,
  notificationItem: { ...evaluation.notificationItem, sku: "ANS-EXISTING-HTM-L", product: "Produk Aktif Lama", movingStat: "FAST", movingState: "FAST" }
};
const fullSnapshotDispatch = context.stockProductionDispatchLifecycleBatch([newLifecycle, existingActive], sheets, { notify: true });
assert.equal(fullSnapshotDispatch.status, "success");
assert.equal(notificationCalls.length, 1);
assert.equal(notificationCalls[0].payload.totalItems, 1);
assert.match(notificationCalls[0].payload.message, /Produk Baru/);
assert.doesNotMatch(notificationCalls[0].payload.message, /Produk Aktif Lama/);
assert.match(notificationCalls[0].payload.message, /Total: 1 item/);

properties.clear();
notificationCalls.length = 0;
const noNewTriggerDispatch = context.stockProductionDispatchLifecycleBatch([
  { ...existingActive, shouldNotify: false }
], sheets, { notify: true });
assert.equal(noNewTriggerDispatch.status, "suppressed");
assert.equal(notificationCalls.length, 0);

function automaticResult(sku, shouldNotify, recipientId = "RECIPIENT-TEST", moving = "MIDDLE") {
  return {
    sku,
    activeProduction: true,
    shouldNotify,
    status: "PRODUCTION_REQUIRED",
    notificationItem: {
      ...evaluation.notificationItem,
      sku,
      product: "Produk " + sku,
      movingStat: moving,
      movingState: moving,
      productionRecipient: recipientId
    }
  };
}

properties.clear();
notificationCalls.length = 0;
const dayTwo = Array.from({ length: 60 }, (_, index) => automaticResult(
  "DAY2-" + String(index + 1).padStart(2, "0"), index >= 55
));
const dayTwoDispatch = context.stockProductionDispatchLifecycleBatch(dayTwo, sheets, { notify: true });
assert.equal(dayTwoDispatch.status, "success");
assert.equal(notificationCalls.length, 1);
assert.equal(notificationCalls[0].payload.totalItems, 5);
assert.equal(notificationCalls[0].payload.entityKey.split(",").length, 5);
assert.doesNotMatch(notificationCalls[0].payload.message, /DAY2-01/);
assert.match(notificationCalls[0].payload.message, /DAY2-60/);

properties.clear();
notificationCalls.length = 0;
const dayThree = Array.from({ length: 67 }, (_, index) => automaticResult(
  "DAY3-" + String(index + 1).padStart(2, "0"), index >= 60
));
const dayThreeDispatch = context.stockProductionDispatchLifecycleBatch(dayThree, sheets, { notify: true });
assert.equal(dayThreeDispatch.status, "success");
assert.equal(notificationCalls.length, 1);
assert.equal(notificationCalls[0].payload.totalItems, 7);
assert.equal(notificationCalls[0].payload.entityKey.split(",").length, 7);
assert.doesNotMatch(notificationCalls[0].payload.message, /DAY3-01/);
assert.match(notificationCalls[0].payload.message, /DAY3-67/);

const originalRecipients = context.readProductionRecipients;
context.readProductionRecipients = () => ({
  available: true,
  recipients: [
    { id: "RECIPIENT-A", name: "Konveksi A", type: "KONVEKSI", telegramChatId: "111", active: true },
    { id: "RECIPIENT-B", name: "Konveksi B", type: "KONVEKSI", telegramChatId: "222", active: true }
  ],
  byId: {
    "RECIPIENT-A": { id: "RECIPIENT-A", name: "Konveksi A", type: "KONVEKSI", telegramChatId: "111", active: true },
    "RECIPIENT-B": { id: "RECIPIENT-B", name: "Konveksi B", type: "KONVEKSI", telegramChatId: "222", active: true }
  },
  byName: {},
  invalid: []
});
properties.clear();
notificationCalls.length = 0;
const routedTriggerItems = [
  automaticResult("ROUTE-A-1", true, "RECIPIENT-A"),
  automaticResult("ROUTE-A-2", true, "RECIPIENT-A"),
  automaticResult("ROUTE-B-1", true, "RECIPIENT-B"),
  automaticResult("ROUTE-MISSING-1", true, ""),
  automaticResult("ROUTE-MISSING-2", true, "")
];
const routedDispatch = context.stockProductionDispatchLifecycleBatch(routedTriggerItems, sheets, { notify: true });
assert.equal(routedDispatch.status, "success");
assert.equal(notificationCalls.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(routedDispatch.sentSkus)), ["ROUTE-A-1", "ROUTE-A-2", "ROUTE-B-1"]);
assert.equal(routedDispatch.blocked.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(routedDispatch.blocked.map(item => item.sku))), ["ROUTE-MISSING-1", "ROUTE-MISSING-2"]);
assert.equal(notificationCalls.find(call => call.recipient.id === "RECIPIENT-A").payload.entityKey, "ROUTE-A-1,ROUTE-A-2");
assert.equal(notificationCalls.find(call => call.recipient.id === "RECIPIENT-B").payload.entityKey, "ROUTE-B-1");
context.readProductionRecipients = originalRecipients;

console.log("Stock/Production Telegram harness: PASS (in-memory only)");
console.log(JSON.stringify({
  sku: evaluation.notificationItem.sku,
  stock: evaluation.notificationItem.stock,
  minimumStock: evaluation.notificationItem.minimumStock,
  targetStock: evaluation.notificationItem.targetStock,
  productionQty: evaluation.notificationItem.productionQty,
  movingState: evaluation.notificationItem.movingState,
  status: evaluation.notificationItem.status
}));
