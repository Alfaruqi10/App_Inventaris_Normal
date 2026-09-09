import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const enginePath = new URL("../src/backend/Production/StockProductionEngine.gs", import.meta.url);
const engineSource = fs.readFileSync(enginePath, "utf8");
const codePath = new URL("../src/backend/code.gs", import.meta.url);
const codeSource = fs.readFileSync(codePath, "utf8");
const frontendPath = new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url);
const frontendSource = fs.readFileSync(frontendPath, "utf8");
const indexPath = new URL("../src/frontend/index.html", import.meta.url);
const indexSource = fs.readFileSync(indexPath, "utf8");
const telegramPath = new URL("../src/backend/NotificationCenter/telegram.gs", import.meta.url);
const telegramSource = fs.readFileSync(telegramPath, "utf8");
const context = { console, isFinite, JSON, Math, Number, String, Date, Object };
vm.createContext(context);
vm.runInContext(engineSource, context);

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const config = { valid: true, enabled: true, minimumStock: 2, targetStock: 7, minimumProductionBatch: 5 };
const base = { sku: "SKU-1", stock: 2, config, movingStat: "MIDDLE" };

test("safe SKU is inactive", () => {
  const result = context.classifyStockProductionItem({ ...base, stock: 3 }, "");
  assert.equal(result.activeProduction, false);
  assert.equal(result.status, "NORMAL");
});
test("stock at minimum enters active production", () => {
  const result = context.classifyStockProductionItem(base, "");
  assert.equal(result.activeProduction, true);
  assert.equal(result.status, "PRODUCTION_REQUIRED");
});
test("zero stock is critical", () => assert.equal(context.classifyStockProductionItem({ ...base, stock: 0 }, "").status, "CRITICAL"));
test("stock exactly at a zero minimum is production required, not critical", () => {
  const result = context.classifyStockProductionItem({ ...base, stock: 0, config: { ...config, minimumStock: 0, targetStock: 2 } }, "");
  assert.equal(result.status, "PRODUCTION_REQUIRED");
  assert.equal(result.productionQty, 5);
});
test("in-progress queue is not auto-resolved by status classification", () => assert.equal(context.classifyStockProductionItem(base, "IN_PROGRESS").status, "PRODUCTION_IN_PROGRESS"));
test("suggested quantity uses target shortfall", () => assert.equal(context.classifyStockProductionItem(base, "").productionQty, 5));
test("minimum batch applies when active shortfall is smaller", () => assert.equal(context.classifyStockProductionItem({ ...base, config: { ...config, targetStock: 4 }, stock: 1 }, "").productionQty, 5));
test("target shortfall applies when larger than batch", () => assert.equal(context.classifyStockProductionItem({ ...base, stock: 0 }, "").productionQty, 7));
test("suggested quantity is zero when target is reached", () => assert.equal(context.classifyStockProductionItem({ ...base, stock: 7 }, "").productionQty, 0));
test("stock above minimum has no production suggestion even below target", () => {
  const result = context.classifyStockProductionItem({ ...base, stock: 3 }, "");
  assert.equal(result.activeProduction, false);
  assert.equal(result.productionQty, 0);
});
test("Moving metadata does not change production quantity", () => {
  const quantities = ["FAST", "MIDDLE", "SLOW"].map((movingStat) =>
    context.classifyStockProductionItem({ ...base, movingStat }, "").productionQty
  );
  assert.deepEqual(quantities, [5, 5, 5]);
});
test("a missing configuration is inactive", () => assert.equal(context.classifyStockProductionItem({ ...base, config: null }, "").activeProduction, false));
test("a disabled configuration is inactive", () => assert.equal(context.classifyStockProductionItem({ ...base, config: { ...config, enabled: false } }, "").activeProduction, false));
test("invalid configuration is rejected", () => assert.equal(context.classifyStockProductionItem({ ...base, config: { ...config, valid: false, error: "Target invalid" } }, "").valid, false));
test("fast moving threshold is 16 units", () => assert.equal(context.stockProductionMovingFromUnits(16), "FAST"));
test("middle moving range is 1 through 15 units", () => { assert.equal(context.stockProductionMovingFromUnits(1), "MIDDLE"); assert.equal(context.stockProductionMovingFromUnits(15), "MIDDLE"); });
test("slow moving is zero units", () => assert.equal(context.stockProductionMovingFromUnits(0), "SLOW"));
test("manual Moving is the only runtime production source", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.getStockProductionMoving({ moving: "MIDDLE", movingSource: "CALCULATED" }))), { movingStat: "MIDDLE", movingSource: "MANUAL" });
});
test("runtime item ignores SalesLedger Moving inputs", () => {
  const item = context.stockProductionAttachRuntimeData(
    [{ sku: "SKU-MOVING", stock: 1 }],
    { configs: { "SKU-MOVING": { moving: "SLOW", movingSource: "CALCULATED" } } }
  )[0];
  assert.equal(item.movingStat, "SLOW");
  assert.equal(item.movingSource, "MANUAL");
  assert.equal(item.calculatedMovingStat, undefined);
});
test("moving map includes only valid order status", () => {
  const moving = context.stockProductionBuildMovingMapFromSalesLedger([
    { "Tanggal Order": "01/08/2026", "Status Shopee": "COMPLETED", "SKU Inventaris": "A", Qty: 10 },
    { "Tanggal Order": "02/08/2026", "Status Shopee": "SHIPPED", "SKU Inventaris": "A", Qty: 6 },
    { "Tanggal Order": "03/08/2026", "Status Shopee": "CANCELLED", "SKU Inventaris": "A", Qty: 99 },
    { "Tanggal Order": "04/08/2026", "Status Shopee": "UNPAID", "SKU Inventaris": "B", Qty: 5 }
  ], "2026-08-08");
  assert.deepEqual(JSON.parse(JSON.stringify(moving.bySku.A)), { units30d: 16, movingStat: "FAST" });
  assert.equal(moving.bySku.B, undefined);
});
test("moving map uses WIB date keys without implicit UTC grouping", () => {
  const moving = context.stockProductionBuildMovingMapFromSalesLedger([{ "Tanggal Order": "10/06/2026", "Status Shopee": "COMPLETED", "SKU Inventaris": "A", Qty: 1 }], "2026-06-10");
  assert.equal(moving.bySku.A.units30d, 1);
});
test("official production reference fixtures flow through configuration and evaluator data", () => {
  const references = [
    { sku: "ANS-BAD-HTM-L", size: "L", minimumStock: 2, targetStock: 7 },
    { sku: "ANS-BAD-HTM-M", size: "M", minimumStock: 2, targetStock: 7 },
    { sku: "ANS-BAD-HTM-S", size: "S", minimumStock: 1, targetStock: 5 },
    { sku: "ANS-BAD-HTM-XL", size: "XL", minimumStock: 3, targetStock: 9 },
    { sku: "ANS-BAD-HTM-XXL", size: "XXL", minimumStock: 3, targetStock: 9 }
  ];
  references.forEach((reference) => {
    const item = {
      sku: reference.sku, product: "Badzlin Dress", color: "Hitam", size: reference.size,
      stock: Math.max(1, reference.minimumStock - 1), movingStat: "FAST",
      config: {
        valid: true, enabled: true, minimumStock: reference.minimumStock,
        targetStock: reference.targetStock, minimumProductionBatch: 2
      }
    };
    const classification = context.classifyStockProductionItem(item, "");
    const payload = context.stockProductionBuildNotificationPayload(item, classification, classification.status, 1);
    assert.equal(classification.minimumStock, reference.minimumStock);
    assert.equal(classification.productionTarget, reference.targetStock);
    assert.equal(classification.movingStat, "FAST");
    assert.equal(payload.targetStock, reference.targetStock);
    assert.equal(payload.movingState, "FAST");
  });
});
test("pending may become in progress", () => assert.equal(context.stockProductionCanTransition("PENDING", "IN_PROGRESS"), true));
test("pending may be resolved by a safe-stock evaluation", () => assert.equal(context.stockProductionCanTransition("PENDING", "RESOLVED"), true));
test("in-progress cannot be automatically resolved", () => assert.equal(context.stockProductionCanTransition("IN_PROGRESS", "RESOLVED"), false));
test("in-progress may be completed by an operator", () => assert.equal(context.stockProductionCanTransition("IN_PROGRESS", "COMPLETED"), true));
test("completed queue is terminal", () => assert.equal(context.stockProductionCanTransition("COMPLETED", "IN_PROGRESS"), false));
test("completed queue cannot return to pending", () => assert.equal(context.stockProductionCanTransition("COMPLETED", "PENDING"), false));

function completedQueueFixture(overrides = {}) {
  return {
    QueueID: "PRD-COMPLETED-1", SKU: "SKU-COMPLETED", Color: "Hitam", Size: "L",
    Status: "COMPLETED", StockAtCreation: 1, CompletedQty: 7,
    CompletedAt: "2026-09-02T10:00:00.000Z",
    ...overrides
  };
}
function completedLifecycleItem(stock) {
  return {
    sku: "SKU-COMPLETED", product: "Produk Selesai", color: "Hitam", size: "L", stock,
    movingStat: "MIDDLE",
    config: { valid: true, enabled: true, minimumStock: 3, targetStock: 8, minimumProductionBatch: 2 }
  };
}
test("completed production waits for exact-variant Barang Masuk before it can requeue", () => {
  const item = completedLifecycleItem(1);
  const classification = context.classifyStockProductionItem(item, "");
  const queue = completedQueueFixture();
  assert.equal(context.stockProductionIsCompletedQueueWaitingStockIn(queue, item, classification, []), true);
  const result = context.evaluateStockProductionItem(item, {}, {
    queueMap: {}, alertMap: {}, completedQueueMap: { [item.sku]: queue }, transactionRows: []
  });
  assert.deepEqual(JSON.parse(JSON.stringify({
    activeProduction: result.activeProduction, shouldNotify: result.shouldNotify,
    waitingForStockIn: result.waitingForStockIn, status: result.status
  })), {
    activeProduction: false, shouldNotify: false, waitingForStockIn: true,
    status: "PRODUCTION_COMPLETED_WAITING_STOCK_IN"
  });
});
test("only post-completion exact Barang Masuk counts toward the completed quantity", () => {
  const queue = completedQueueFixture();
  const received = context.stockProductionCompletedQueueReceivedQty(queue, [
    { Timestamp: "2026-09-02T09:59:00.000Z", "Jenis Transaksi": "MASUK", "Kode Barang": "SKU-COMPLETED", Warna: "Hitam", Ukuran: "L", Jumlah: 7 },
    { Timestamp: "2026-09-02T10:01:00.000Z", "Jenis Transaksi": "MASUK", "Kode Barang": "SKU-COMPLETED", Warna: "Navy", Ukuran: "L", Jumlah: 7 },
    { Timestamp: "2026-09-02T10:02:00.000Z", "Jenis Transaksi": "KELUAR", "Kode Barang": "SKU-COMPLETED", Warna: "Hitam", Ukuran: "L", Jumlah: 7 },
    { Timestamp: "2026-09-02T10:03:00.000Z", "Jenis Transaksi": "MASUK", "Kode Barang": "SKU-COMPLETED", Warna: "Hitam", Ukuran: "L", Jumlah: 7 }
  ]);
  assert.equal(received, 7);
});
test("full Barang Masuk releases the completed lifecycle and evaluator becomes normal", () => {
  const item = completedLifecycleItem(8);
  const queue = completedQueueFixture();
  const transactionRows = [{
    Timestamp: "2026-09-02T10:01:00.000Z", "Jenis Transaksi": "MASUK", "Kode Barang": "SKU-COMPLETED",
    Warna: "Hitam", Ukuran: "L", Jumlah: 7
  }];
  const classification = context.classifyStockProductionItem(item, "");
  assert.equal(context.stockProductionIsCompletedQueueWaitingStockIn(queue, item, classification, transactionRows), false);
  const result = context.evaluateStockProductionItem(item, {}, {
    queueMap: {}, alertMap: {}, completedQueueMap: { [item.sku]: queue }, transactionRows
  });
  assert.equal(result.status, "NORMAL");
  assert.equal(result.activeProduction, false);
  assert.equal(result.shouldNotify, false);
});
test("partial Barang Masuk below minimum remains waiting and does not create a duplicate cycle", () => {
  const item = completedLifecycleItem(2);
  const queue = completedQueueFixture();
  const transactionRows = [{
    Timestamp: "2026-09-02T10:01:00.000Z", "Jenis Transaksi": "MASUK", "Kode Barang": "SKU-COMPLETED",
    Warna: "Hitam", Ukuran: "L", Jumlah: 1
  }];
  const result = context.evaluateStockProductionItem(item, {}, {
    queueMap: {}, alertMap: {}, completedQueueMap: { [item.sku]: queue }, transactionRows
  });
  assert.equal(result.status, "PRODUCTION_COMPLETED_WAITING_STOCK_IN");
  assert.equal(result.shouldNotify, false);
});
test("notification is emitted only on activation or reactivation", () => {
  assert.equal(context.stockProductionShouldNotify("", true, false, true), true);
  assert.equal(context.stockProductionShouldNotify("PRODUCTION_REQUIRED", true, false, true), false);
  assert.equal(context.stockProductionShouldNotify("RESOLVED", true, false, true), true);
  assert.equal(context.stockProductionShouldNotify("IGNORED", true, true, true), false);
});
test("active alert snapshot takes Moving from the current evaluator classification", () => {
  const record = context.stockProductionAlertRecord(
    { AlertID: "ALT-1", FirstDetectedAt: "old" },
    { sku: "SKU-SNAPSHOT", product: "Produk", category: "Dress", color: "Hitam", size: "L" },
    { stock: 1, minimumStock: 2, idealStock: 7, productionMin: 2, productionTarget: 7, productionQty: 6, movingStat: "FAST", priority: "HIGH" },
    "PRODUCTION_REQUIRED", 2, "now"
  );
  assert.equal(record.MovingStat, "FAST");
  assert.equal(record.NotificationCycle, 2);
});
test("pending queue refresh persists current Moving and production snapshot", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionUpdatePendingQueue"), engineSource.indexOf("function stockProductionResolvePendingQueue"));
  assert.match(body, /stockProductionPendingQueueChanges\(queue, classification, options && options\.allowedFields\)/);
  assert.match(body, /Status\).toUpperCase\(\) !== "PENDING"/);
  assert.match(body, /if \(!Object\.keys\(changes\)\.length\) return false/);
  assert.doesNotMatch(body, /stockProductionWriteHistory/);
});
function createPendingQueueSheet(queue) {
  const headers = [
    "QueueID", "SKU", "StockAtCreation", "MinimumStock", "IdealStock", "ProductionMin", "ProductionTarget",
    "RecommendedQty", "PlannedQty", "CompletedQty", "MovingStat", "Priority", "Status", "UpdatedAt"
  ];
  const writes = [];
  return {
    writes,
    sheet: {
      getLastColumn: () => headers.length,
      getRange: (row, column) => {
        if (row === 1) return { getValues: () => [headers] };
        return {
          setValue: (value) => writes.push({ header: headers[column - 1], value })
        };
      }
    },
    queue: { ...queue, _row: 2 }
  };
}
function pendingQueueClassification(movingStat, productionQty = 4) {
  return {
    stock: 1, minimumStock: 2, idealStock: 5, productionMin: 2, productionTarget: 5,
    productionQty, movingStat, priority: "MEDIUM", valid: true, activeProduction: true
  };
}
function pendingQueueSnapshot(status, movingStat, productionQty = 4) {
  return {
    QueueID: "PRD-TEST", SKU: "SKU-QUEUE", Status: status,
    StockAtCreation: 1, MinimumStock: 2, IdealStock: 5, ProductionMin: 2, ProductionTarget: 5,
    RecommendedQty: productionQty, PlannedQty: productionQty, MovingStat: movingStat, Priority: "MEDIUM"
  };
}
test("pending queue refresh updates Moving SLOW to evaluator MIDDLE", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("PENDING", "SLOW"));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("MIDDLE"), null, "TEST");
  assert.equal(changed, true);
  assert.deepEqual(fixture.writes.map((write) => write.header), ["MovingStat", "UpdatedAt"]);
  assert.equal(fixture.writes[0].value, "MIDDLE");
});
test("pending queue refresh updates Moving MIDDLE to evaluator FAST", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("PENDING", "MIDDLE"));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("FAST"), null, "TEST");
  assert.equal(changed, true);
  assert.equal(fixture.writes.find((write) => write.header === "MovingStat").value, "FAST");
});
test("matching pending queue snapshot is idempotent and does not write", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("PENDING", "SLOW"));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("SLOW"), null, "TEST");
  assert.equal(changed, false);
  assert.deepEqual(fixture.writes, []);
});
test("in-progress queue preserves its historical Moving snapshot", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("IN_PROGRESS", "SLOW"));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("MIDDLE"), null, "TEST");
  assert.equal(changed, false);
  assert.deepEqual(fixture.writes, []);
});
test("completed queue preserves its historical Moving snapshot", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("COMPLETED", "FAST"));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("SLOW"), null, "TEST");
  assert.equal(changed, false);
  assert.deepEqual(fixture.writes, []);
});
test("pending Moving refresh preserves the evaluator production quantity", () => {
  const fixture = createPendingQueueSheet(pendingQueueSnapshot("PENDING", "SLOW", 4));
  const changed = context.stockProductionUpdatePendingQueue({ queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("MIDDLE", 4), null, "TEST");
  assert.equal(changed, true);
  assert.equal(fixture.writes.some((write) => write.header === "RecommendedQty" || write.header === "PlannedQty"), false);
});
test("targeted refresh updates only Priority when Moving and quantity are already current", () => {
  const queue = { ...pendingQueueSnapshot("PENDING", "MIDDLE", 4), Priority: "LOW" };
  const fixture = createPendingQueueSheet(queue);
  const changed = context.stockProductionUpdatePendingQueue(
    { queue: fixture.sheet }, fixture.queue, {}, pendingQueueClassification("MIDDLE", 4), null, "TEST",
    { allowedFields: ["RecommendedQty", "PlannedQty", "MovingStat", "Priority"] }
  );
  assert.equal(changed, true);
  assert.deepEqual(fixture.writes.map((write) => write.header), ["Priority", "UpdatedAt"]);
});
test("a second targeted refresh plan becomes no-op after its stale Moving is reconciled", () => {
  const stale = pendingQueueSnapshot("PENDING", "SLOW", 4);
  const first = context.stockProductionTargetedPendingQueueDecision([stale], { sku: "SKU-QUEUE" }, pendingQueueClassification("MIDDLE", 4));
  const synchronized = { ...stale, MovingStat: "MIDDLE" };
  const second = context.stockProductionTargetedPendingQueueDecision([synchronized], { sku: "SKU-QUEUE" }, pendingQueueClassification("MIDDLE", 4));
  assert.equal(first.action, "WOULD_UPDATE");
  assert.equal(second.action, "NO_CHANGE");
});
test("targeted refresh decision updates only a stale pending snapshot", () => {
  const decision = context.stockProductionTargetedPendingQueueDecision(
    [pendingQueueSnapshot("PENDING", "SLOW", 4)],
    { sku: "SKU-QUEUE" },
    pendingQueueClassification("MIDDLE", 4)
  );
  assert.equal(decision.action, "WOULD_UPDATE");
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(decision.changes))), ["MovingStat"]);
});
test("targeted refresh decision is a no-op for a synchronized pending snapshot", () => {
  const decision = context.stockProductionTargetedPendingQueueDecision(
    [pendingQueueSnapshot("PENDING", "MIDDLE", 4)],
    { sku: "SKU-QUEUE" },
    pendingQueueClassification("MIDDLE", 4)
  );
  assert.equal(decision.action, "NO_CHANGE");
  assert.deepEqual(JSON.parse(JSON.stringify(decision.changes)), {});
});
test("targeted refresh decision skips in-progress and terminal queue snapshots", () => {
  const classification = pendingQueueClassification("MIDDLE", 4);
  const inProgress = context.stockProductionTargetedPendingQueueDecision([pendingQueueSnapshot("IN_PROGRESS", "SLOW", 4)], { sku: "SKU-QUEUE" }, classification);
  const completed = context.stockProductionTargetedPendingQueueDecision([pendingQueueSnapshot("COMPLETED", "SLOW", 4)], { sku: "SKU-QUEUE" }, classification);
  assert.equal(inProgress.action, "SKIP_LIFECYCLE");
  assert.equal(completed.action, "SKIP_LIFECYCLE");
});
test("targeted refresh decision skips a missing target and a target changed since dry-run", () => {
  const missing = context.stockProductionTargetedPendingQueueDecision([], { sku: "SKU-QUEUE" }, pendingQueueClassification("MIDDLE", 4));
  const changed = context.stockProductionTargetedPendingQueueDecision(
    [pendingQueueSnapshot("PENDING", "SLOW", 4)], { sku: "SKU-QUEUE" },
    { valid: true, activeProduction: false, productionQty: 0 }
  );
  assert.equal(missing.action, "TARGET_NOT_FOUND");
  assert.equal(changed.action, "TARGET_CHANGED");
});
test("targeted pending refresh route has no alert, history, dispatcher, or scheduler side effect", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleTargetedPendingQueueRefresh"), engineSource.indexOf("function stockProductionTestingResetFingerprint"));
  assert.match(body, /requireStockProductionPermission\(data, "manage_production_queue"\)/);
  assert.match(body, /stockProductionUpdatePendingQueue\(/);
  assert.match(body, /allowedFields: \["RecommendedQty", "PlannedQty", "MovingStat", "Priority"\]/);
  assert.match(body, /Phase 1: create a complete write plan/);
  assert.match(body, /Pre-write validation gagal; tidak ada Queue yang diubah/);
  assert.match(body, /STOCK_PRODUCTION_TARGETED_REFRESH_MAX_TARGETS/);
  assert.doesNotMatch(body, /ensureStockProductionDatabase|evaluateStockProductionItem|evaluateStockProductionForSku|evaluateAllStockProduction|stockProductionDispatchLifecycleBatch|stockProductionWriteHistory|stockProductionCreateQueueRecord|stockProductionResolvePendingQueue|NotificationService|STOCK_ALERTS_SHEET|PRODUCTION_HISTORY_SHEET/);
});
test("targeted refresh validates the whole plan before reaching its only writer", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleTargetedPendingQueueRefresh"), engineSource.indexOf("function stockProductionTestingResetFingerprint"));
  const plan = body.indexOf("Phase 1: create a complete write plan");
  const abort = body.indexOf("status: \"aborted\"");
  const write = body.indexOf("Phase 2: every target has passed validation");
  assert.ok(plan >= 0 && abort > plan && write > abort);
  assert.match(body, /unsafePlans\.length \|\| unexpectedDiff/);
});
test("targeted pending refresh route is registered before ensureDatabase", () => {
  const doPost = codeSource.slice(codeSource.indexOf("function doPost(e)"), codeSource.indexOf("function doGet(e)"));
  const route = doPost.indexOf('data.action === "targetedPendingQueueRefresh"');
  const preview = doPost.indexOf('data.action === "previewStockProductionNotificationBatch"');
  const database = doPost.indexOf("ensureDatabase();");
  assert.ok(route >= 0);
  assert.ok(preview >= 0);
  assert.ok(database >= 0);
  assert.ok(route < database);
  assert.ok(preview < database);
  assert.equal(doPost.indexOf('data.action === "testStockProductionNotification"'), -1);
});
test("non-pending queue snapshots are excluded from automatic Moving refresh", () => {
  const body = engineSource.slice(engineSource.indexOf("function evaluateStockProductionItem"), engineSource.indexOf("function stockProductionAttachRuntimeData"));
  assert.match(body, /stockProductionText\(activeQueue\.Status\)\.toUpperCase\(\) === "PENDING"/);
  assert.doesNotMatch(body, /stockProductionUpdatePendingQueue\(sheets, activeQueue, item, classification[^\n]*IN_PROGRESS/);
  const resolveBody = engineSource.slice(engineSource.indexOf("function stockProductionResolvePendingQueue"), engineSource.indexOf("function stockProductionNotifyBatch"));
  assert.doesNotMatch(resolveBody, /MovingStat|RecommendedQty|ProductionTarget/);
});
test("active queue filter preserves pending and in-progress jobs", () => {
  const rows = context.stockProductionFilterActiveQueueRows([
    { SKU: "A", Status: "PENDING" }, { SKU: "B", Status: "IN_PROGRESS" },
    { SKU: "C", Status: "RESOLVED" }, { SKU: "D", Status: "COMPLETED" }
  ]);
  assert.deepEqual(rows.map(row => row.SKU), ["A", "B"]);
});
test("Telegram formatter uses the compact mobile Production Required format", () => {
  const table = context.stockProductionBuildProductionTable([{ product: "Badzlin Dress", color: "Hitam", size: "L", minimumStock: 2, targetStock: 6, productionQty: 5, movingStat: "MIDDLE" }], "29/08/2026 11:17");
  assert.equal(table, "\uD83D\uDEA8 <b>URGENSI STOK PRODUKSI</b>\nUpdate: 29/08/2026 11:17\nBagian 1/1 \u2022 Total 1 item\n\n\uD83D\uDFE1 MIDDLE\n\n1. Badzlin Dress | HTM | L | 2 \u2192 5\n\nTotal: 1 item");
  assert.doesNotMatch(table, /SKU|Target|Status|Production Qty|Stock|<pre>/);
});
test("Telegram payload preserves evaluator metrics without formatter recalculation", () => {
  const item = {
    sku: "SKU-NOTIFICATION-1", product: "Produk Uji", color: "Hitam", size: "L", stock: 1,
    config: { valid: true, enabled: true, minimumStock: 2, targetStock: 6, minimumProductionBatch: 2 },
    movingStat: "MIDDLE"
  };
  const classification = context.classifyStockProductionItem(item, "");
  const payload = context.stockProductionBuildNotificationPayload(item, classification, classification.status, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    sku: "SKU-NOTIFICATION-1", product: "Produk Uji", color: "Hitam", size: "L", stock: 1,
    minimumStock: 2, targetStock: 6, productionTarget: 6, productionQty: 5, movingStat: "MIDDLE", movingState: "MIDDLE",
    status: "CRITICAL", priority: "MEDIUM", productionRecipient: "", notificationCycle: 1
  });
  const table = context.stockProductionBuildProductionTable([payload], "29/08/2026 09:00");
  assert.match(table, /\uD83D\uDFE1 MIDDLE\n\n1\. Produk Uji \| HTM \| L \| 2 \u2192 5/);
  assert.doesNotMatch(table, /Status|SKU-NOTIFICATION-1|Target|<pre>/);
});
function lifecycleNotificationResult(sku, options = {}) {
  const moving = options.moving || "MIDDLE";
  return {
    sku,
    activeProduction: options.activeProduction !== false,
    shouldNotify: Boolean(options.shouldNotify),
    status: options.status || "PRODUCTION_REQUIRED",
    notificationItem: options.notificationItem === false ? null : {
      sku,
      product: options.product || ("Produk " + sku),
      color: options.color || "Hitam",
      size: options.size || "L",
      minimumStock: options.minimumStock ?? 2,
      productionQty: options.productionQty ?? 5,
      movingStat: moving,
      notificationCycle: options.notificationCycle || 1
    }
  };
}
test("lifecycle snapshot keeps full active items separate from incremental trigger items", () => {
  const snapshot = context.stockProductionBuildLifecycleNotificationSnapshot([
    lifecycleNotificationResult("SKU-NEW", { shouldNotify: true, product: "Produk Baru" }),
    lifecycleNotificationResult("SKU-EXISTING", { shouldNotify: false, product: "Produk Aktif Lama", moving: "FAST" })
  ], "29/08/2026 11:17");
  assert.equal(snapshot.triggerItems.length, 1);
  assert.equal(snapshot.triggerItems[0].sku, "SKU-NEW");
  assert.equal(snapshot.triggerCount, 1);
  assert.equal(snapshot.triggerUniqueCount, 1);
  assert.equal(snapshot.eligibleCount, 2);
  assert.equal(snapshot.uniqueCount, 2);
  assert.equal(snapshot.triggerTotalItemsAcrossMessages, 1);
  assert.equal(snapshot.totalItemsAcrossMessages, 2);
  assert.match(snapshot.messages[0], /Produk Baru/);
  assert.match(snapshot.messages[0], /Produk Aktif Lama/);
  assert.match(snapshot.triggerMessages[0], /Produk Baru/);
  assert.doesNotMatch(snapshot.triggerMessages[0], /Produk Aktif Lama/);
});
test("notification snapshot deduplicates SKU plus variant and reports missing payloads", () => {
  const snapshot = context.stockProductionBuildLifecycleNotificationSnapshot([
    lifecycleNotificationResult("SKU-A", { shouldNotify: true }),
    lifecycleNotificationResult("SKU-A", { shouldNotify: false }),
    lifecycleNotificationResult("SKU-B", { notificationItem: false }),
    lifecycleNotificationResult("SKU-C", { activeProduction: false })
  ], "29/08/2026 11:17");
  assert.equal(snapshot.eligibleCount, 3);
  assert.equal(snapshot.uniqueCount, 1);
  assert.equal(snapshot.duplicateCount, 1);
  assert.equal(snapshot.missingCount, 1);
  assert.equal(snapshot.totalItemsAcrossMessages, 1);
});
test("67 eligible production items are complete, unique, and character-chunked", () => {
  const results = Array.from({ length: 67 }, (_, index) => lifecycleNotificationResult(
    "SKU-" + String(index + 1).padStart(3, "0"),
    { shouldNotify: index === 0, product: "Produk Produksi " + (index + 1) + " " + "Panjang".repeat(10), moving: index < 15 ? "FAST" : (index < 51 ? "MIDDLE" : "SLOW") }
  ));
  const snapshot = context.stockProductionBuildLifecycleNotificationSnapshot(results, "29/08/2026 13:21");
  assert.equal(snapshot.eligibleCount, 67);
  assert.equal(snapshot.uniqueCount, 67);
  assert.equal(snapshot.duplicateCount, 0);
  assert.equal(snapshot.missingCount, 0);
  assert.equal(snapshot.triggerCount, 1);
  assert.equal(snapshot.triggerUniqueCount, 1);
  assert.equal(snapshot.triggerTotalItemsAcrossMessages, 1);
  assert.ok(snapshot.messageCount > 1);
  assert.equal(snapshot.totalItemsAcrossMessages, 67);
  snapshot.messages.forEach((message, index) => {
    assert.ok(message.length <= 3500);
    assert.match(message, new RegExp("Bagian " + (index + 1) + "/" + snapshot.messageCount + " \\u2022 Total 67 item"));
  });
});
test("zero eligible production items produces no notification batch", () => {
  const snapshot = context.stockProductionBuildLifecycleNotificationSnapshot([
    lifecycleNotificationResult("SKU-SAFE", { activeProduction: false })
  ], "29/08/2026 11:17");
  assert.equal(snapshot.eligibleCount, 0);
  assert.equal(snapshot.uniqueCount, 0);
  assert.equal(snapshot.messageCount, 0);
  assert.equal(snapshot.totalItemsAcrossMessages, 0);
});
test("incremental trigger payload is deduplicated independently from the full snapshot", () => {
  const snapshot = context.stockProductionBuildLifecycleNotificationSnapshot([
    lifecycleNotificationResult("SKU-OLD-1", { shouldNotify: false }),
    lifecycleNotificationResult("SKU-NEW-1", { shouldNotify: true }),
    lifecycleNotificationResult("SKU-OLD-2", { shouldNotify: false }),
    lifecycleNotificationResult("SKU-NEW-1", { shouldNotify: true })
  ], "29/08/2026 11:17");
  assert.equal(snapshot.uniqueCount, 3);
  assert.equal(snapshot.triggerCount, 2);
  assert.equal(snapshot.triggerUniqueCount, 1);
  assert.equal(snapshot.triggerDuplicateCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.triggerItems.map(item => item.sku))), ["SKU-NEW-1"]);
  assert.equal(snapshot.triggerTotalItemsAcrossMessages, 1);
});
test("notification batch preview is read-only and uses the evaluator payload builder", () => {
  const body = engineSource.slice(engineSource.indexOf("function handlePreviewStockProductionNotificationBatch"), engineSource.indexOf("function stockProductionDispatchLifecycleBatch"));
  assert.match(body, /requireStockProductionPermission\(data, "view_stock_alerts"\)/);
  assert.match(body, /classifyStockProductionItem\(item, queue && queue\.Status\)/);
  assert.match(body, /stockProductionBuildNotificationPayload\(/);
  assert.match(body, /stockProductionBuildLifecycleNotificationSnapshot\(results, evaluatedAt\)/);
  assert.doesNotMatch(body, /ensureStockProductionDatabase|evaluateStockProductionItem|evaluateAllStockProduction|stockProductionDispatchLifecycleBatch|stockProductionNotifyBatch|stockProductionUpdateObjectRow|stockProductionAppendByHeaders|NotificationService/);
});
test("special test notification route is removed", () => {
  assert.equal(codeSource.indexOf('data.action === "testStockProductionNotification"'), -1);
  assert.doesNotMatch(engineSource, /function handleTestStockProductionNotification/);
  assert.doesNotMatch(engineSource, /function testStockProductionNotification\(\)/);
  assert.doesNotMatch(engineSource, /STOCK_PRODUCTION_TEST_NOTIFICATION_/);
  assert.doesNotMatch(engineSource, /STOCK_PRODUCTION_REAL_TELEGRAM_TEST_/);
  assert.doesNotMatch(frontendSource, /testStockProductionNotification/);
  assert.doesNotMatch(indexSource, /production-test-notification|Tes Notifikasi/);
  assert.match(codeSource, /data.action === "previewManualProductionNotification"/);
  assert.match(codeSource, /data.action === "sendManualProductionNotification"/);
});
test("manual snapshot uses current evaluator values instead of client overrides", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionBuildManualNotificationSnapshot"), engineSource.indexOf("function handlePreviewManualProductionNotification"));
  assert.match(engineSource, /function stockProductionNormalizeManualPriority/);
  assert.match(body, /classifyStockProductionItem\(runtimeItem, queueMap\[sku\] && queueMap\[sku\]\.Status\)/);
  assert.match(body, /stockProductionNeedsProduction\(classification\)/);
  assert.match(body, /manualPriority !== "ALL"/);
  assert.match(body, /classification\.movingStat/);
  assert.match(body, /minimumProductionBatch: classification\.productionMin/);
  assert.match(body, /productionQty: classification\.productionQty/);
  assert.match(body, /movingStat: classification\.movingStat/);
  assert.doesNotMatch(body, /data\.quantity|productionQty: quantity|movingState: priority/);
});
test("manual urgency accepts ALL aliases as filters and preserves item Moving", () => {
  assert.equal(context.stockProductionNormalizeManualPriority(""), "ALL");
  assert.equal(context.stockProductionNormalizeManualPriority("ALL"), "ALL");
  assert.equal(context.stockProductionNormalizeManualPriority("SEMUA"), "ALL");
  assert.equal(context.stockProductionNormalizeManualPriority(" FAST "), "FAST");
  assert.equal(context.stockProductionNormalizeManualPriority("middle"), "MIDDLE");
  assert.equal(context.stockProductionNormalizeManualPriority("SLOW"), "SLOW");
  assert.throws(() => context.stockProductionNormalizeManualPriority("Semua Urgensi"), /Prioritas manual harus/);
  assert.throws(() => context.stockProductionNormalizeManualPriority("URGENT"), /Prioritas manual harus/);
  assert.doesNotMatch(engineSource, /movingStat:\s*manualPriority/);
});
test("manual delivery audit is isolated from Queue, Alert, and History writers", () => {
  const audit = engineSource.slice(engineSource.indexOf("function stockProductionWriteManualNotificationAudit"), engineSource.indexOf("function stockProductionNotifyBatch"));
  assert.match(audit, /Source: "MANUAL"/);
  assert.match(audit, /ensureProductionNotificationLogSheet\(\)/);
  assert.doesNotMatch(audit, /PRODUCTION_QUEUE_SHEET|STOCK_ALERTS_SHEET|stockProductionUpdateObjectRow|stockProductionWriteHistory|stockProductionCreateQueueRecord/);
  const send = engineSource.slice(engineSource.indexOf("function handleSendManualProductionNotification"), engineSource.indexOf("function handleGetProductionConfigurations"));
  assert.match(send, /stockProductionWriteManualNotificationAudit/);
  assert.doesNotMatch(send, /stockProductionWriteNotificationAudit|stockProductionDispatchLifecycleBatch|stockProductionNotifyBatch|stockProductionWriteHistory|stockProductionUpdateObjectRow/);
});
test("Telegram formatter groups FAST, MIDDLE, and SLOW while preserving zero values", () => {
  const table = context.stockProductionBuildProductionTable([
    { product: "Produk Nol", color: "Putih", size: "S", minimumStock: 0, targetStock: 0, productionQty: 9, movingStat: "SLOW" },
    { product: "Produk Dua", color: "Navy", size: "M", minimumStock: 2, targetStock: 6, productionQty: 4, movingStat: "MIDDLE" },
    { product: "Produk Tiga", color: "Hitam", size: "XL", minimumStock: 3, targetStock: 8, productionQty: 5, movingStat: "FAST" }
  ], "29/08/2026 10:08");
  assert.match(table, /\u26A1 FAST\n\n1\. Produk Tiga \| HTM \| XL \| 3 \u2192 5/);
  assert.match(table, /\uD83D\uDFE1 MIDDLE\n\n2\. Produk Dua \| NVY \| M \| 2 \u2192 4/);
  assert.match(table, /\uD83D\uDC22 SLOW\n\n3\. Produk Nol \| Putih \| S \| 0 \u2192 9/);
  assert.match(table, /Bagian 1\/1 \u2022 Total 3 item/);
  assert.match(table, /Total: 3 item/);
  assert.ok(table.indexOf("\u26A1 FAST") < table.indexOf("\uD83D\uDFE1 MIDDLE"));
  assert.ok(table.indexOf("\uD83D\uDFE1 MIDDLE") < table.indexOf("\uD83D\uDC22 SLOW"));
});
test("Telegram formatter chunks 50 items by character length without splitting items", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    product: "Produk Produksi " + String(index + 1).padStart(2, "0") + " " + "Panjang".repeat(10),
    color: index % 2 ? "Navy" : "Hitam", size: index % 3 ? "L" : "XL",
    minimumStock: index % 4, targetStock: index + 6, productionQty: index + 5, movingState: index % 3 ? "MIDDLE" : "FAST"
  }));
  const messages = context.stockProductionBuildProductionMessages(items, "29/08/2026 11:17");
  const entries = context.stockProductionBuildProductionEntries(items);
  assert.ok(messages.length > 1);
  messages.forEach((message, index) => {
    assert.ok(message.length <= 3500);
    assert.match(message, new RegExp("Bagian " + (index + 1) + "/" + messages.length + " \\u2022 Total 50 item"));
  });
  entries.forEach(entry => {
    const item = entry.item;
    const containingMessage = messages.find(message => message.includes(item.product));
    assert.ok(containingMessage, "item " + entry.number + " is present");
    assert.match(containingMessage, new RegExp(entry.number + "\\. " + item.product + " \\| "));
    assert.match(containingMessage, new RegExp("\\| " + item.minimumStock + " \\u2192 " + item.productionQty));
  });
  assert.equal(messages.join("\n").match(/Total 50 item/g).length, messages.length);
  assert.ok(messages.slice(1).some(message => /LANJUTAN/.test(message)));
});
test("Telegram formatter preserves a long product name without truncating its item", () => {
  const product = "Nama Produk Produksi Sangat Panjang Yang Harus Tetap Utuh Dalam Notifikasi Telegram";
  const message = context.stockProductionBuildProductionMessages([{ product, color: "Magenta", size: "L", minimumStock: 2, targetStock: 6, productionQty: 5, movingState: "MIDDLE" }], "29/08/2026 11:17")[0];
  assert.match(message, new RegExp(product));
  assert.match(message, /1\. .* \| Magenta \| L \| 2 \u2192 5/);
});
test("Telegram formatter preserves global numbering and totals for 67 items", () => {
  const items = Array.from({ length: 67 }, (_, index) => ({
    product: "Produk Batch " + (index + 1) + " " + "Mobile".repeat(9), color: "Hitam", size: "L",
    minimumStock: index % 3, targetStock: 7, productionQty: 5, movingState: index < 25 ? "FAST" : (index < 50 ? "MIDDLE" : "SLOW")
  }));
  const messages = context.stockProductionBuildProductionMessages(items, "29/08/2026 13:21");
  assert.ok(messages.length > 1);
  assert.match(messages[0], /1\. Produk Batch 1/);
  assert.match(messages[messages.length - 1], /67\. Produk Batch 67/);
  messages.forEach((message, index) => {
    assert.ok(message.length <= 3500);
    assert.match(message, new RegExp("Bagian " + (index + 1) + "/" + messages.length + " \\u2022 Total 67 item"));
    assert.match(message, /Total bagian: \d+ item/);
  });
});
test("non-production notifications retain NotificationService template behavior", () => {
  const notificationSource = fs.readFileSync(new URL("../src/backend/NotificationCenter/NotificationService.gs", import.meta.url), "utf8");
  assert.match(notificationSource, /String\(eventType\)\.toUpperCase\(\) === "PRODUCTION_REQUIRED"/);
  assert.match(notificationSource, /else if \(!template\)/);
  assert.match(notificationSource, /messageText = this\.formatTemplate\(template\.Body, payload\)/);
});
test("manual notification is the only supported manual Telegram entry point", () => {
  assert.doesNotMatch(engineSource, /function testRealStockProductionTelegram/);
  assert.doesNotMatch(engineSource, /sendMode: "TEST_ONLY"/);
  assert.match(engineSource, /function handlePreviewManualProductionNotification/);
  assert.match(engineSource, /function handleSendManualProductionNotification/);
  assert.match(codeSource, /data\.action === "previewManualProductionNotification"/);
  assert.match(codeSource, /data\.action === "sendManualProductionNotification"/);
});
test("one routed batch notification path is retained", () => {
  const dispatcher = engineSource.slice(engineSource.indexOf("function stockProductionDispatchLifecycleBatch"), engineSource.indexOf("function stockProductionAlertRecord"));
  assert.match(dispatcher, /stockProductionBuildLifecycleNotificationSnapshot\(results, evaluatedAt\)/);
  assert.match(dispatcher, /stockProductionNotifyBatch\(snapshot\.triggerItems, dateKey, \{/);
  assert.doesNotMatch(dispatcher, /stockProductionNotifyBatch\(snapshot\.items, dateKey, \{/);
  assert.match(dispatcher, /source: "AUTOMATIC"/);
  assert.match(dispatcher, /LastNotificationType: "PRODUCTION_REQUIRED"/);
  assert.match(dispatcher, /LastNotificationAt: notifiedAt/);
});
test("routed chunking preserves one recipient lifecycle idempotency key", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionNotifyBatch"), engineSource.indexOf("function stockProductionDispatchLifecycleBatch"));
  assert.match(body, /stockProductionBuildRoutedNotificationGroups\(items\)/);
  assert.match(body, /RECIPIENT/);
  assert.match(body, /idempotencyKey: key/);
  assert.match(body, /props\.setProperty\(key/);
});
test("event and daily evaluators share the lifecycle notification dispatcher", () => {
  const perSku = engineSource.slice(engineSource.indexOf("function evaluateStockProductionForSku"), engineSource.indexOf("function evaluateAllStockProduction"));
  const allSku = engineSource.slice(engineSource.indexOf("function evaluateAllStockProduction"), engineSource.indexOf("function runStockProductionDailyCheck"));
  assert.match(perSku, /stockProductionDispatchLifecycleBatch\(\[result\], sheets, options \|\| \{\}\)/);
  assert.match(allSku, /stockProductionDispatchLifecycleBatch\(results, sheets, options\)/);
});
test("dashboard and queue lifecycle handlers never dispatch production Telegram", () => {
  const dashboard = engineSource.slice(engineSource.indexOf("function handleGetStockProductionDashboard"), engineSource.indexOf("function handleCreateProductionQueue"));
  const queueHandlers = engineSource.slice(engineSource.indexOf("function handleCreateProductionQueue"), engineSource.indexOf("function handleIgnoreStockAlert"));
  assert.doesNotMatch(dashboard, /stockProductionDispatchLifecycleBatch|NotificationService\.send/);
  assert.doesNotMatch(queueHandlers, /stockProductionDispatchLifecycleBatch|NotificationService\.send/);
});
test("safe evaluation resolves only pending queues", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionResolvePendingQueue"), engineSource.indexOf("function stockProductionNotifyBatch"));
  assert.match(body, /Status\).toUpperCase\(\) !== "PENDING"/);
  assert.match(body, /Status: "RESOLVED"/);
});
test("in-progress queue keeps its RecommendedQty snapshot", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionUpdatePendingQueue"), engineSource.indexOf("function stockProductionResolvePendingQueue"));
  assert.match(body, /Status\).toUpperCase\(\) !== "PENDING"/);
  assert.match(engineSource, /RecommendedQty: classification\.productionQty/);
  assert.match(body, /stockProductionPendingQueueChanges\(queue, classification, options && options\.allowedFields\)/);
});
test("MasterBarang remains inventory-only", () => {
  const body = engineSource.slice(engineSource.indexOf("function readStockProductionInventory"), engineSource.indexOf("function readStockProductionConfiguration"));
  assert.doesNotMatch(body, /Qty Minimal|Qty Ideal|Produksi Minim|Moving Stat|ToDo/);
  assert.doesNotMatch(engineSource, /insertColumn|deleteColumn/);
});
test("configuration has a separate schema", () => {
  assert.match(engineSource, /var PRODUCTION_CONFIGURATION_SHEET = "ProductionConfiguration"/);
  assert.match(engineSource, /"MinimumProductionBatch"/);
  assert.match(engineSource, /TargetStock harus lebih besar dari MinimumStock/);
});
test("valid production configuration input is accepted", () => {
  const result = context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, movingSource: "MANUAL", moving: "FAST", enabled: true }, [{ sku: "SKU-1" }]);
  assert.equal(result.minimumStock, 2);
  assert.equal(result.targetStock, 7);
  assert.equal(result.minimumProductionBatch, 5);
  assert.equal(result.moving, "FAST");
  assert.equal(result.movingSource, "MANUAL");
});
test("invalid minimum stock is rejected", () => assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: -1, targetStock: 7, minimumProductionBatch: 5 }, [{ sku: "SKU-1" }])));
test("invalid target stock is rejected", () => assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: 7, targetStock: 7, minimumProductionBatch: 5 }, [{ sku: "SKU-1" }])));
test("invalid minimum production batch is rejected", () => assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 0 }, [{ sku: "SKU-1" }])));
test("unknown MasterBarang SKU is rejected", () => assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "MISSING", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5 }, [{ sku: "SKU-1" }])));
test("lowercase or arbitrary manual Moving is rejected", () => {
  const baseInput = { sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, movingSource: "MANUAL" };
  assert.throws(() => context.stockProductionValidateConfigurationInput({ ...baseInput, moving: "fast" }, [{ sku: "SKU-1" }]));
  assert.throws(() => context.stockProductionValidateConfigurationInput({ ...baseInput, moving: "OTHER" }, [{ sku: "SKU-1" }]));
});
test("CALCULATED and empty Moving are rejected", () => {
  assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "CALCULATED" }, [{ sku: "SKU-1" }]));
  assert.throws(() => context.stockProductionValidateConfigurationInput({ sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "" }, [{ sku: "SKU-1" }]));
});
test("configuration routes are registered", () => {
  assert.match(codeSource, /data\.action === "getProductionConfigurations"/);
  assert.match(codeSource, /data\.action === "saveProductionConfiguration"/);
  assert.match(codeSource, /data\.action === "deleteProductionConfiguration"/);
});
test("configuration UI uses dedicated configuration actions", () => {
  assert.match(frontendSource, /getProductionConfigurations/);
  assert.match(frontendSource, /saveProductionConfiguration/);
  assert.match(frontendSource, /deleteProductionConfiguration/);
  assert.match(frontendSource, /updateConfigPreview/);
  assert.match(frontendSource, /production-config-moving/);
  assert.doesNotMatch(frontendSource, /production-config-moving-source|CALCULATED/);
  assert.doesNotMatch(indexSource, /Calculated dari SalesLedger|production-config-moving-source/);
});
test("Konveksi refresh and dynamic actions use explicit event bindings", () => {
  assert.match(frontendSource, /bindEvents\(\)/);
  assert.match(frontendSource, /reloadButton\.addEventListener\("click"/);
  assert.match(frontendSource, /alertsBody\.addEventListener\("click"/);
  assert.match(frontendSource, /data-production-action="create-queue"/);
  assert.match(indexSource, /id="production-reload" type="button"/);
  assert.doesNotMatch(indexSource, /id="production-reload"[^>]*onclick=/);
});
test("configuration writes require settings permission", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleSaveProductionConfiguration"), engineSource.indexOf("function handleDeleteProductionConfiguration"));
  assert.match(body, /manage_stock_alert_settings/);
});
test("configuration schema requires manual Moving while retaining MovingSource compatibility", () => {
  assert.match(engineSource, /"Moving", "MovingSource"/);
  assert.match(engineSource, /STOCK_PRODUCTION_REQUIRED_CONFIG_HEADERS/);
  assert.match(engineSource, /"Moving", "Enabled"/);
  assert.doesNotMatch(engineSource.slice(engineSource.indexOf("function stockProductionAttachRuntimeData"), engineSource.indexOf("function stockProductionFilter")), /stockProductionReadMovingMap|stockProductionMovingFromUnits/);
});
test("production recipient configuration is separate from MasterBarang", () => {
  assert.match(engineSource, /var PRODUCTION_RECIPIENTS_SHEET = "ProductionRecipients"/);
  assert.match(engineSource, /"ProductionRecipient"/);
  const inventoryBody = engineSource.slice(engineSource.indexOf("function readStockProductionInventory"), engineSource.indexOf("function readStockProductionConfiguration"));
  assert.doesNotMatch(inventoryBody, /Penjahit|ProductionRecipient/);
  const configBody = engineSource.slice(engineSource.indexOf("function readStockProductionConfiguration"), engineSource.indexOf("function stockProductionBuildMovingMapFromSalesLedger"));
  assert.match(configBody, /productionRecipient/);
});
test("recipient resolution requires an active recipient with a real Telegram Chat ID", () => {
  const source = {
    byId: {
      "MANG-IYUS": { id: "MANG-IYUS", name: "Mang Iyus", active: true, telegramChatId: "123" },
      "KONVEKSI-A": { id: "KONVEKSI-A", name: "Konveksi A", active: false, telegramChatId: "456" },
      "NO-CHAT": { id: "NO-CHAT", name: "Tanpa Chat", active: true, telegramChatId: "" }
    },
    byName: { "MANG IYUS": [{ id: "MANG-IYUS", name: "Mang Iyus", active: true, telegramChatId: "123" }] }, invalid: []
  };
  assert.equal(context.stockProductionResolveRecipient("MANG-IYUS", source).status, "resolved");
  assert.equal(context.stockProductionResolveRecipient("Mang Iyus", source).status, "resolved");
  assert.equal(context.stockProductionResolveRecipient("KONVEKSI-A", source).status, "recipient_inactive");
  assert.equal(context.stockProductionResolveRecipient("NO-CHAT", source).status, "recipient_missing_chat_id");
  assert.equal(context.stockProductionResolveRecipient("", source).status, "missing_assignment");
  assert.equal(context.stockProductionResolveRecipient("INVALID", { byId: { INVALID: { id: "INVALID", active: true, telegramChatId: "@user" } }, byName: {}, invalid: [] }).status, "recipient_invalid_chat_id");
});
test("recipient filters use the canonical Mang Iyus ID and preserve Belum Diatur", () => {
  const rows = [
    { sku: "SKU-MANG", productionRecipient: "MANG-IYUS" },
    { sku: "SKU-AL", productionRecipient: "AL-FARUQI" },
    { sku: "SKU-EMPTY", productionRecipient: "" }
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionFilter(rows, { productionRecipient: "MANG-IYUS" }).map(row => row.sku))), ["SKU-MANG"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.stockProductionFilter(rows, { productionRecipient: "UNASSIGNED" }).map(row => row.sku))), ["SKU-EMPTY"]);
  const dashboardBody = engineSource.slice(engineSource.indexOf("function handleGetStockProductionDashboard"), engineSource.indexOf("function handleResetStockProductionStatistics"));
  assert.match(dashboardBody, /recipients: recipients\.recipients\.map/);
  assert.match(dashboardBody, /recipientItems/);
  assert.match(dashboardBody, /recipientQueueRows/);
  assert.match(frontendSource, /recipient === "UNASSIGNED"/);
  assert.match(indexSource, /value="UNASSIGNED">Belum Diatur/);
});
test("production recipients use one Konveksi type and validate Chat ID as a string", () => {
  const legacy = context.stockProductionRecipientView({ id: "OLD", name: "Lama", type: "PENJAHIT", telegramChatId: "-1001234567890", active: true });
  assert.equal(legacy.type, "KONVEKSI");
  assert.equal(typeof legacy.telegramChatId, "string");
  assert.equal(context.stockProductionValidateRecipientInput({ id: "A", name: "A", type: "KONVEKSI", telegramChatId: "123456789", active: true }).type, "KONVEKSI");
  assert.equal(context.stockProductionValidateRecipientInput({ id: "B", name: "B", type: "KONVEKSI", telegramChatId: "-1001234567890", active: true }).telegramChatId, "-1001234567890");
  assert.throws(() => context.stockProductionValidateRecipientInput({ id: "C", name: "C", type: "KONVEKSI", telegramChatId: "@mangiyus", active: true }), /Chat ID Telegram tidak valid/);
  assert.equal(context.stockProductionValidateRecipientInput({ recipientId: "D", name: "D", type: "KONVEKSI", chatId: "987654321", active: true }).id, "D");
  assert.equal(context.stockProductionValidateRecipientInput({ recipientId: "D", name: "D", type: "KONVEKSI", chatId: "987654321", active: true }).telegramChatId, "987654321");
});
test("production recipient CRUD actions are registered once and use JSON handlers", () => {
  ["getProductionRecipients", "saveProductionRecipient", "deleteProductionRecipient"].forEach((action) => {
    assert.equal(codeSource.split(`data.action === "${action}"`).length - 1, 1);
  });
  assert.match(codeSource, /return jsonOutput\(handleGetProductionRecipients\(data\)\)/);
  assert.match(codeSource, /return jsonOutput\(handleSaveProductionRecipient\(data\)\)/);
  assert.match(codeSource, /return jsonOutput\(handleDeleteProductionRecipient\(data\)\)/);
  assert.match(frontendSource, /request\("saveProductionRecipient"/);
  assert.match(frontendSource, /recipientId:/);
  assert.match(frontendSource, /chatId:/);
});
test("automatic notification routes by configured recipient and never falls back to a default", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionBuildRoutedNotificationGroups"), engineSource.indexOf("function stockProductionNotificationIdentity"));
  assert.match(body, /stockProductionResolveRecipient\(item && item\.productionRecipient/);
  assert.match(body, /blocked\.push/);
  assert.match(body, /NotificationService\.sendToRecipient\("PRODUCTION_REQUIRED"/);
  assert.doesNotMatch(body, /NotificationService\.send\("PRODUCTION_REQUIRED"/);
  assert.match(body, /RECIPIENT/);
});
test("manual notification route is explicit, uses the shared gateway, and never invokes lifecycle evaluation", () => {
  assert.match(codeSource, /data\.action === "previewManualProductionNotification"/);
  assert.match(codeSource, /data\.action === "sendManualProductionNotification"/);
  const body = engineSource.slice(engineSource.indexOf("function handleSendManualProductionNotification"), engineSource.indexOf("function handleGetProductionConfigurations"));
  assert.match(body, /requireStockProductionPermission\(data, "manage_production_queue"\)/);
  assert.match(body, /NotificationService\.sendToRecipient\("PRODUCTION_REQUIRED"/);
  assert.match(body, /MANUAL_PRODUCTION_NOTIFICATION/);
  assert.doesNotMatch(body, /evaluateStockProductionItem|evaluateAllStockProduction|stockProductionDispatchLifecycleBatch|stockProductionNotifyBatch|stockProductionCreateQueueRecord|stockProductionWriteHistory|runDailyAnalyticsJob/);
});
test("manual notification payload preserves configured data and evaluator quantity", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionBuildManualNotificationSnapshot"), engineSource.indexOf("function handlePreviewManualProductionNotification"));
  assert.match(body, /minimumStock: classification\.minimumStock/);
  assert.match(body, /targetStock: classification\.productionTarget/);
  assert.match(body, /minimumProductionBatch: classification\.productionMin/);
  assert.match(body, /productionQty: classification\.productionQty/);
  assert.match(body, /manualProductionQty/);
  assert.match(body, /effectiveProductionQty/);
  assert.match(body, /movingState: classification\.movingStat/);
  assert.match(body, /configuredRecipient/);
  assert.doesNotMatch(body, /data\.quantity|data\.priority/);
});
test("manual quantity override is a validated effective-only value", () => {
  assert.equal(context.stockProductionNormalizeManualProductionQty("10"), 10);
  assert.equal(context.stockProductionNormalizeManualProductionQty(7), 7);
  for (const invalid of ["", "0", "-1", "1.5", "abc", "  "]) {
    assert.throws(() => context.stockProductionNormalizeManualProductionQty(invalid), /bilangan bulat lebih dari 0/);
  }
  const evaluatorItem = { product: "Produk Override", color: "Hitam", size: "M", minimumStock: 2, productionQty: 5, movingState: "FAST" };
  const automaticMessage = context.stockProductionBuildProductionMessages([evaluatorItem], "03/09/2026 13:45")[0];
  const manualItem = { ...evaluatorItem, manualProductionQty: 10, effectiveProductionQty: 10 };
  const manualMessage = context.stockProductionBuildProductionMessages([manualItem], "03/09/2026 13:45")[0];
  assert.match(automaticMessage, /2 → 5/);
  assert.match(manualMessage, /2 → 10/);
  assert.equal(evaluatorItem.productionQty, 5);
  assert.equal(manualItem.productionQty, 5);
});
test("manual notification uses the canonical automatic formatter with exact golden output", () => {
  const items = [
    { product: "Produk Fast A", color: "Hitam", size: "M", minimumStock: 2, productionQty: 5, movingState: "FAST" },
    { product: "Produk Fast B", color: "Broken White", size: "S", minimumStock: 1, productionQty: 4, movingState: "FAST" },
    { product: "Produk Middle", color: "Brick", size: "L", minimumStock: 1, productionQty: 6, movingState: "MIDDLE" },
    { product: "Produk Slow", color: "Cinnamon", size: "XL", minimumStock: 3, productionQty: 7, movingState: "SLOW" }
  ];
  const evaluatedAt = "03/09/2026 13:45";
  const automatic = context.stockProductionBuildProductionMessages(items, evaluatedAt, null, { destination: "Konveksi A" });
  const manual = context.stockProductionBuildProductionMessages(items, evaluatedAt, null, { destination: "Konveksi A" });
  assert.deepEqual(JSON.parse(JSON.stringify(manual)), JSON.parse(JSON.stringify(automatic)));
  assert.equal(manual.length, 1);
  assert.equal(manual[0], "🚨 <b>URGENSI STOK PRODUKSI</b>\nTujuan: Konveksi A\nUpdate: 03/09/2026 13:45\nBagian 1/1 • Total 4 item\n\n⚡ FAST\n\n1. Produk Fast A | HTM | M | 2 → 5\n2. Produk Fast B | BW | S | 1 → 4\n\n🟡 MIDDLE\n\n3. Produk Middle | BRK | L | 1 → 6\n\n🐢 SLOW\n\n4. Produk Slow | CIN | XL | 3 → 7\n\nTotal: 4 item");
  assert.doesNotMatch(manual[0], /PRODUKSI MANUAL|Produksi:|Catatan:/);
  assert.doesNotMatch(engineSource, /function stockProductionBuildManualProduction(?:ItemBlock|Message|Messages)/);
  const manualSnapshot = engineSource.slice(engineSource.indexOf("function stockProductionBuildManualNotificationSnapshot"), engineSource.indexOf("function handlePreviewManualProductionNotification"));
  assert.match(manualSnapshot, /stockProductionBuildProductionMessages\(snapshot\.items, snapshot\.evaluatedAt, null, \{/);
});
test("manual and automatic use identical canonical chunking", () => {
  const items = Array.from({ length: 56 }, (_, index) => ({
    product: "Produk Manual " + (index + 1) + " " + "Panjang".repeat(10),
    color: index % 2 ? "Broken White" : "Hitam", size: "L", minimumStock: index % 4,
    productionQty: index + 1, movingState: index < 18 ? "FAST" : (index < 42 ? "MIDDLE" : "SLOW")
  }));
  const evaluatedAt = "03/09/2026 13:45";
  const automatic = context.stockProductionBuildProductionMessages(items, evaluatedAt, null, { destination: "Konveksi A" });
  const manual = context.stockProductionBuildProductionMessages(items, evaluatedAt, null, { destination: "Konveksi A" });
  assert.deepEqual(JSON.parse(JSON.stringify(manual)), JSON.parse(JSON.stringify(automatic)));
  assert.equal(manual.join("\n").match(/Total 56 item/g).length, manual.length);
  assert.match(manual[0], /1\. Produk Manual 1/);
  assert.match(manual[manual.length - 1], /56\. Produk Manual 56/);
});
test("queue records separate production lifecycle from notification state", () => {
  assert.match(engineSource, /"NotificationStatus", "NotificationSource"/);
  const queueBuilder = engineSource.slice(engineSource.indexOf("function stockProductionCreateQueueRecord"), engineSource.indexOf("function stockProductionSnapshotValueChanged"));
  assert.match(queueBuilder, /NotificationStatus: "NOT_SENT"/);
  assert.match(queueBuilder, /NotificationSource: ""/);
  const notificationAudit = engineSource.slice(engineSource.indexOf("function stockProductionWriteNotificationAudit"), engineSource.indexOf("function stockProductionNotifyBatch"));
  assert.doesNotMatch(notificationAudit, /stockProductionWriteHistory|StockAtCreation|MinimumStock|RecommendedQty|Status: "IN_PROGRESS"/);
});
test("Konveksi UI exposes Indonesian routing and manual notification controls", () => {
  assert.match(indexSource, /Peringatan Stok &amp; Produksi/);
  assert.match(indexSource, /Semua Konveksi/);
  assert.match(indexSource, /Kirim Manual/);
  assert.match(frontendSource, /previewManualProductionNotification/);
  assert.match(frontendSource, /sendManualProductionNotification/);
  assert.match(frontendSource, /getProductionRecipients/);
  assert.match(indexSource, /Status Notifikasi/);
  assert.match(indexSource, /option value="KONVEKSI">Konveksi/);
  assert.doesNotMatch(indexSource, /id="production-recipient-type"[^>]*>[\s\S]*option value="PENJAHIT"/);
  assert.match(indexSource, /Cara mendapatkan Chat ID/);
  assert.match(frontendSource, /showChatIdHelp/);
  assert.match(indexSource, /Kirim Manual/);
  assert.match(indexSource, /title="Kirim notifikasi produksi secara manual"/);
  assert.match(indexSource, /h-9 shrink-0 whitespace-nowrap px-3 text-xs/);
  assert.match(indexSource, /flex flex-wrap items-center gap-2 md:flex-nowrap/);
  assert.match(indexSource, /flex min-w-0 flex-1 flex-wrap items-center gap-2 md:flex-nowrap/);
  assert.match(indexSource, /id="production-manual-open"[^>]*md:ml-auto/);
  assert.match(frontendSource, /production-manual-qty ds-input [^"]*text-xs font-normal/);
  assert.doesNotMatch(frontendSource, /production-manual-qty ds-input [^"]*font-bold/);
  assert.match(frontendSource, /openManualNotification/);
});
test("Konveksi exposes manual multi-select notification controls only", () => {
  assert.doesNotMatch(indexSource, /production-test-notification|Tes Notifikasi/);
  assert.doesNotMatch(frontendSource, /testStockProductionNotification/);
  assert.match(frontendSource, /id="production-manual-select-all"/);
  assert.match(frontendSource, /Pilih Semua/);
  assert.match(indexSource, /id="production-manual-preview-button"/);
  assert.match(frontendSource, /manualSelection/);
  assert.match(frontendSource, /manualFilterChanged/);
  assert.match(frontendSource, /toggleManualSelection/);
  assert.match(frontendSource, /state\.manualPreviewKey/);
  assert.match(frontendSource, /invalidateManualPreview/);
});
test("recipient action unavailable response explains an old Apps Script deployment", () => {
  assert.match(frontendSource, /DEPLOYMENT_ROUTE_UNAVAILABLE/);
  assert.match(frontendSource, /belum tersedia pada deployment Apps Script yang sedang digunakan/);
  assert.match(codeSource, /code: "ACTION_UNKNOWN"/);
  assert.match(codeSource, /action: data\.action \|\| ""/);
});
test("Telegram /id returns the update Chat ID while preserving /start", () => {
  assert.match(telegramSource, /handleTelegramId\(chatId, firstName, lastName, username\)/);
  assert.match(telegramSource, /Chat ID: <code>\" \+ cleanChatId \+ "<\/code>/);
  assert.match(telegramSource, /Username: " \+ displayUsername/);
  assert.match(telegramSource, /if \(text\.startsWith\("\/start"\)\)/);
  assert.match(telegramSource, /sendTelegramToChatId\(chatId, message\)/);
});
test("PDF manual Moving baseline contains all 67 exact classifications", () => {
  const reference = JSON.parse(fs.readFileSync(new URL("../reference-data/production-configuration-import-reference.json", import.meta.url), "utf8"));
  const distribution = reference.records.reduce((result, row) => {
    result[row.MovingReference] = (result[row.MovingReference] || 0) + 1;
    return result;
  }, {});
  assert.equal(reference.records.length, 67);
  assert.deepEqual(distribution, { FAST: 15, MIDDLE: 36, SLOW: 16 });
  assert.equal(reference.records.find((row) => row.SKU === "ANS-BAD-HTM-L").MovingReference, "FAST");
});
test("duplicate configuration and active queues block unsafe operations", () => {
  const saveBody = engineSource.slice(engineSource.indexOf("function handleSaveProductionConfiguration"), engineSource.indexOf("function handleDeleteProductionConfiguration"));
  const deleteBody = engineSource.slice(engineSource.indexOf("function handleDeleteProductionConfiguration"), engineSource.indexOf("function handleGetStockProductionDashboard"));
  assert.match(saveBody, /Konfigurasi untuk SKU ini sudah ada/);
  assert.match(deleteBody, /status === "PENDING" \|\| status === "IN_PROGRESS"/);
  assert.match(deleteBody, /sheet\.deleteRow\(existing\.row\)/);
});
test("dashboard only exposes active alerts but all active queue jobs", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleGetStockProductionDashboard"), engineSource.indexOf("function handleCreateProductionQueue"));
  assert.match(body, /filter\(function\(item\) \{ return item\.activeProduction; \}\)/);
  assert.match(body, /stockProductionFilterActiveQueueRows\(queueRows\)/);
});
test("completion does not mutate MasterBarang stock", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionTransitionQueueStatus"), engineSource.indexOf("function handleUpdateProductionQueueStatus"));
  assert.match(body, /stockAdjusted: false/);
  assert.doesNotMatch(body, /MASTER_SHEET_NAME|Stok Saat Ini|setValues\(/);
});
test("completion persists queue lifecycle and history without creating Barang Masuk", () => {
  const body = engineSource.slice(engineSource.indexOf("function stockProductionTransitionQueueStatus"), engineSource.indexOf("function handleUpdateProductionQueueStatus"));
  assert.match(body, /CompletedAt = now/);
  assert.match(body, /CompletedBy = authorizedUser\.email/);
  assert.match(body, /CompletedQty = completedQty/);
  assert.match(body, /ActiveRequirementKey = ""/);
  assert.match(body, /stockProductionWriteHistory\(sheets\.history, authorizedUser, "QUEUE_" \+ nextStatus/);
  assert.doesNotMatch(body, /handleBarangMasuk|buildTransactionRow|MASTER_SHEET_NAME|sendTelegramMessage|NotificationService/);
});
test("completed lifecycle guard is shared by evaluator, dashboard, snapshot, and manual queue creation", () => {
  assert.match(engineSource, /function stockProductionCompletedQueueMap\(queueRows\)/);
  assert.match(engineSource, /function stockProductionCompletedQueueReceivedQty\(queue, transactionRows\)/);
  assert.match(engineSource, /function stockProductionIsCompletedQueueWaitingStockIn\(queue, item, classification, transactionRows\)/);
  const evaluator = engineSource.slice(engineSource.indexOf("function evaluateStockProductionItem"), engineSource.indexOf("function stockProductionAttachRuntimeData"));
  const dashboard = engineSource.slice(engineSource.indexOf("function handleGetStockProductionDashboard"), engineSource.indexOf("function handleTargetedPendingQueueRefresh"));
  const createQueue = engineSource.slice(engineSource.indexOf("function handleCreateProductionQueue"), engineSource.indexOf("function handleUpdateProductionQueueStatus"));
  assert.match(evaluator, /PRODUCTION_COMPLETED_WAITING_STOCK_IN/);
  assert.match(dashboard, /waitingForStockIn/);
  assert.match(createQueue, /sedang menunggu Barang Masuk/);
});
test("only explicit configuration/recipient management routes delete rows", () => {
  const configurationDelete = engineSource.slice(engineSource.indexOf("function handleDeleteProductionConfiguration"), engineSource.indexOf("function handleGetStockProductionDashboard"));
  const recipientDelete = engineSource.slice(engineSource.indexOf("function handleDeleteProductionRecipient"), engineSource.indexOf("function stockProductionBuildManualNotificationSnapshot"));
  const withoutDeleteHandler = engineSource.replace(configurationDelete, "").replace(recipientDelete, "");
  assert.doesNotMatch(withoutDeleteHandler, /deleteRow\(/);
});
test("admin retains all production permissions", () => assert.equal(context.stockProductionRolePermissions("Admin").length, 5));
test("staff konveksi can update but not manage queue", () => {
  const permissions = context.stockProductionRolePermissions("Staff Konveksi");
  assert.equal(permissions.includes("update_production_status"), true);
  assert.equal(permissions.includes("manage_production_queue"), false);
});

function testingResetQueue(status = "PENDING", overrides = {}) {
  return {
    QueueID: "PRD-RESET-1", SKU: "SKU-RESET", Product: "Produk Test", Color: "Hitam", Size: "L",
    Status: status, CreatedAt: "2026-09-02T09:00:00.000Z", UpdatedAt: "2026-09-02T09:00:00.000Z",
    CompletedQty: 0, ActiveRequirementKey: "SKU-RESET:ACTIVE", Note: "Fixture", ...overrides
  };
}

function testingResetAlert(status = "PRODUCTION_REQUIRED", overrides = {}) {
  return {
    AlertID: "ALT-RESET-1", SKU: "SKU-RESET", Product: "Produk Test", Color: "Hitam", Size: "L",
    Status: status, FirstDetectedAt: "2026-09-02T09:00:00.000Z", LastEvaluatedAt: "2026-09-02T09:00:00.000Z",
    ProductionQty: 5, NotificationCycle: 1, ...overrides
  };
}

function testingResetFingerprints(queue, alert) {
  return {
    [`QUEUE:${queue.QueueID}`]: context.stockProductionTestingResetQueueFingerprint(queue),
    [`ALERT:${alert.AlertID}`]: context.stockProductionTestingResetAlertFingerprint(alert)
  };
}

test("testing reset plans an explicit PENDING target as RESOLVED", () => {
  const queue = testingResetQueue("PENDING");
  const alert = testingResetAlert("PRODUCTION_REQUIRED");
  const plan = context.stockProductionTestingResetBuildPlan([queue], [alert], [queue.QueueID], [], testingResetFingerprints(queue, alert));
  assert.equal(plan.blocking.length, 0);
  assert.equal(plan.results[0].action, "RESET_PENDING");
});
test("testing reset plans an explicit IN_PROGRESS target as CANCELLED", () => {
  const queue = testingResetQueue("IN_PROGRESS");
  const alert = testingResetAlert();
  const plan = context.stockProductionTestingResetBuildPlan([queue], [alert], [queue.QueueID], [], testingResetFingerprints(queue, alert));
  assert.equal(plan.results[0].action, "RESET_IN_PROGRESS");
});
test("testing reset never plans COMPLETED queue or IGNORED alert", () => {
  const completed = testingResetQueue("COMPLETED");
  const ignored = testingResetAlert("IGNORED");
  const plan = context.stockProductionTestingResetBuildPlan([completed], [ignored], [completed.QueueID], [ignored.AlertID], testingResetFingerprints(completed, ignored));
  assert.deepEqual(JSON.parse(JSON.stringify(plan.results.map(result => result.action))), ["SKIPPED_TERMINAL", "SKIPPED_TERMINAL"]);
  assert.equal(plan.blocking.length, 2);
});
test("testing reset resolves only an explicitly selected active Alert", () => {
  const queue = testingResetQueue();
  const active = testingResetAlert("CRITICAL");
  const other = testingResetAlert("PRODUCTION_REQUIRED", { AlertID: "ALT-UNSELECTED" });
  const plan = context.stockProductionTestingResetBuildPlan([queue], [active, other], [], [active.AlertID], testingResetFingerprints(queue, active));
  assert.equal(plan.results.length, 1);
  assert.equal(plan.results[0].action, "RESET_ALERT");
});
test("testing reset fingerprint change aborts before any lifecycle write", () => {
  const queue = testingResetQueue();
  const alert = testingResetAlert();
  const staleFingerprints = testingResetFingerprints(queue, alert);
  const changed = { ...queue, UpdatedAt: "2026-09-02T10:00:00.000Z" };
  const plan = context.stockProductionTestingResetBuildPlan([changed], [alert], [queue.QueueID], [], staleFingerprints);
  assert.equal(plan.results[0].action, "SKIPPED_TARGET_CHANGED");
  assert.equal(plan.blocking.length, 1);
});
test("repeated testing reset is an idempotent no-op for terminal reset targets", () => {
  const queue = testingResetQueue("RESOLVED");
  const alert = testingResetAlert("RESOLVED");
  const plan = context.stockProductionTestingResetBuildPlan([queue], [alert], [queue.QueueID], [alert.AlertID], {});
  assert.deepEqual(JSON.parse(JSON.stringify(plan.results.map(result => result.action))), ["ALREADY_RESET", "ALREADY_RESET"]);
  assert.equal(plan.blocking.length, 0);
});
test("testing reset is registered as an isolated explicit-ID route", () => {
  const doPost = codeSource.slice(codeSource.indexOf("function doPost(e)"), codeSource.indexOf("function doGet(e)"));
  const preview = doPost.indexOf('data.action === "previewProductionTestingReset"');
  const execute = doPost.indexOf('data.action === "resetProductionTestingState"');
  const database = doPost.indexOf("ensureDatabase();");
  assert.ok(preview >= 0 && execute >= 0 && preview < database && execute < database);
  const body = engineSource.slice(engineSource.indexOf("function handleResetProductionTestingState"), engineSource.indexOf("function handleCreateProductionQueue"));
  assert.match(body, /requireStockProductionPermission\(data, "manage_stock_alert_settings"\)/);
  assert.match(engineSource, /var STOCK_PRODUCTION_TESTING_RESET_CONFIRMATION = "RESET_TESTING_PRODUCTION_STATE"/);
  assert.match(body, /STOCK_PRODUCTION_TESTING_RESET_CONFIRMATION/);
  assert.match(body, /stockProductionTestingResetBuildPlan/);
  assert.match(body, /stockProductionWriteHistory\(historySource\.sheet, user, "RESET_TESTING_STATE"/);
  assert.doesNotMatch(body, /evaluateStockProductionItem|evaluateStockProductionForSku|evaluateAllStockProduction|stockProductionDispatchLifecycleBatch|stockProductionNotifyBatch|NotificationService|handleBarangMasuk|deleteRow\(/);
});
test("testing reset changes only lifecycle fields and preserves inventory/configuration safety", () => {
  const body = engineSource.slice(engineSource.indexOf("function handleResetProductionTestingState"), engineSource.indexOf("function handleCreateProductionQueue"));
  assert.match(body, /ActiveRequirementKey: ""/);
  assert.match(body, /Status: "RESOLVED", ResolvedAt: now, LastEvaluatedAt: now, ToDo: "", ProductionQty: 0/);
  assert.match(body, /masterBarangUnchanged: masterUnchanged/);
  assert.match(body, /productionConfigurationUnchanged: configurationUnchanged/);
  assert.doesNotMatch(body, /setValue\(.*Stok Saat Ini|setValue\(.*MinimumStock|setValue\(.*TargetStock/);
});
test("Konveksi UI requires manual selection before testing reset execution", () => {
  assert.match(indexSource, /id="production-testing-reset"/);
  assert.match(indexSource, /id="production-testing-reset-modal"/);
  assert.match(indexSource, /Tidak ada pilihan otomatis/);
  assert.match(frontendSource, /request\("previewProductionTestingReset"\)/);
  assert.match(frontendSource, /request\("resetProductionTestingState"/);
  assert.match(frontendSource, /confirmation: "RESET_TESTING_PRODUCTION_STATE"/);
  assert.match(frontendSource, /data-testing-reset-type/);
  assert.match(frontendSource, /can\("manage_stock_alert_settings"\)/);
});
test("Konveksi UI requires warning acknowledgement before loading reset candidates", () => {
  assert.match(indexSource, /id="production-testing-reset-warning-modal"/);
  assert.match(indexSource, /Reset Data Testing Produksi\?/);
  assert.match(indexSource, /Fitur ini digunakan untuk membersihkan state hasil pengujian Production\/Stock Alert\./);
  assert.match(indexSource, /Pastikan record yang dipilih memang merupakan hasil testing\./);
  assert.match(indexSource, /ProductionCenterUI\.continueTestingReset\(this\)/);

  const openStart = frontendSource.indexOf("openTestingReset() {");
  const openEnd = frontendSource.indexOf("closeTestingResetWarning()", openStart);
  const continueStart = frontendSource.indexOf("async continueTestingReset(button)");
  const continueEnd = frontendSource.indexOf("closeTestingReset()", continueStart);
  assert.ok(openStart >= 0 && openEnd > openStart && continueStart > openEnd && continueEnd > continueStart);
  assert.match(frontendSource.slice(openStart, openEnd), /production-testing-reset-warning-modal/);
  assert.doesNotMatch(frontendSource.slice(openStart, openEnd), /previewProductionTestingReset/);
  assert.match(frontendSource.slice(continueStart, continueEnd), /request\("previewProductionTestingReset"\)/);
});

test("statistics KPI keeps historical lifecycle rows before a baseline out of the post-reset count", () => {
  const baseline = {
    completedBaselineAt: "2026-09-03T00:00:00.000Z",
    resolvedBaselineAt: "2026-09-03T00:00:00.000Z"
  };
  const kpi = context.stockProductionStatisticsKpi([
    { Status: "COMPLETED", CompletedAt: "2026-09-02T23:59:59.000Z" },
    { Status: "COMPLETED", CompletedAt: "2026-09-03T00:00:00.001Z" },
    { Status: "COMPLETED", CompletedAt: "" },
    { Status: "PENDING", CompletedAt: "2026-09-04T00:00:00.000Z" }
  ], [
    { Status: "RESOLVED", ResolvedAt: "2026-09-02T23:59:59.000Z" },
    { Status: "RESOLVED", ResolvedAt: "2026-09-03T00:00:00.001Z" },
    { Status: "RESOLVED", ResolvedAt: "not-a-date" }
  ], baseline);
  assert.deepEqual(JSON.parse(JSON.stringify(kpi)), { completed: 1, resolved: 1 });
});

test("statistics KPI is backward-compatible without a baseline but never guesses missing lifecycle timestamps", () => {
  const kpi = context.stockProductionStatisticsKpi([
    { Status: "COMPLETED", CompletedAt: "2026-09-02T10:00:00.000Z" },
    { Status: "COMPLETED", CompletedAt: "" }
  ], [
    { Status: "RESOLVED", ResolvedAt: "02/09/2026 10:00:00" },
    { Status: "RESOLVED", ResolvedAt: "" }
  ], {});
  assert.deepEqual(JSON.parse(JSON.stringify(kpi)), { completed: 1, resolved: 1 });
});

test("a second statistics reset baseline excludes lifecycle rows completed before the second reset", () => {
  const rows = [
    { Status: "COMPLETED", CompletedAt: "2026-09-03T10:00:00.000Z" },
    { Status: "COMPLETED", CompletedAt: "2026-09-03T12:00:00.000Z" },
    { Status: "COMPLETED", CompletedAt: "2026-09-03T14:00:00.000Z" }
  ];
  assert.equal(context.stockProductionCountLifecycleSince(rows, "COMPLETED", "CompletedAt", "2026-09-03T11:00:00.000Z"), 2);
  assert.equal(context.stockProductionCountLifecycleSince(rows, "COMPLETED", "CompletedAt", "2026-09-03T13:00:00.000Z"), 1);
});

test("statistics reset route writes only the server-side baseline property after permission and lock", () => {
  const routeStart = codeSource.indexOf('data.action === "resetStockProductionStatistics"');
  const databaseStart = codeSource.indexOf("ensureDatabase();", routeStart);
  assert.ok(routeStart >= 0 && databaseStart > routeStart);
  const handlerStart = engineSource.indexOf("function handleResetStockProductionStatistics");
  const handlerEnd = engineSource.indexOf("function handleTargetedPendingQueueRefresh", handlerStart);
  const body = engineSource.slice(handlerStart, handlerEnd);
  assert.match(body, /requireStockProductionPermission\(data, "manage_stock_alert_settings"\)/);
  assert.match(body, /LockService\.getScriptLock\(\)/);
  assert.match(body, /PropertiesService\.getScriptProperties\(\)\.setProperty/);
  assert.match(body, /new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(body, /stockProductionUpdateObjectRow|stockProductionAppendByHeaders|stockProductionWriteHistory|evaluateStockProduction|handleBarangMasuk|NotificationService|stockProductionDispatchLifecycleBatch/);
});

test("statistics reset UI requires confirmation and refreshes the dashboard after the baseline route succeeds", () => {
  assert.match(indexSource, /id="production-testing-statistics-reset"/);
  assert.match(indexSource, /id="production-testing-statistics-reset-modal"/);
  assert.match(indexSource, /Data historis <b>TIDAK<\/b> akan dihapus atau diubah/);
  assert.match(indexSource, /ProductionCenterUI\.closeTestingStatisticsReset\(\)/);
  assert.match(frontendSource, /request\("resetStockProductionStatistics"\)/);
  assert.match(frontendSource, /can\("manage_stock_alert_settings"\)/);
  const openStart = frontendSource.indexOf("openTestingStatisticsReset() {");
  const openEnd = frontendSource.indexOf("closeTestingStatisticsReset()", openStart);
  const continueStart = frontendSource.indexOf("async continueTestingStatisticsReset(button)");
  const continueEnd = frontendSource.indexOf("closeTestingReset()", continueStart);
  assert.ok(openStart >= 0 && openEnd > openStart && continueStart > openEnd && continueEnd > continueStart);
  assert.doesNotMatch(frontendSource.slice(openStart, openEnd), /request\(/);
  assert.match(frontendSource.slice(continueStart, continueEnd), /request\("resetStockProductionStatistics"\)/);
  assert.match(frontendSource.slice(continueStart, continueEnd), /await this\.load\(\)/);
});

console.log(`\nStock/Production tests: ${passed}/${passed} PASS`);
