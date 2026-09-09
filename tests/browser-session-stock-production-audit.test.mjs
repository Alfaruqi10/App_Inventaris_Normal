import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../tools/browser-session-stock-production-audit.js", import.meta.url), "utf8");
const calls = [];
const browserGlobal = {
  localStorage: { getItem: (key) => key === "inventarisUser" ? JSON.stringify({ email: "session@example.test" }) : null },
  console: { log() {}, error() {}, table() {} },
  postData: async (payload) => {
    calls.push(payload);
    if (payload.action === "getProductionConfigurations") return {
      status: "success",
      rows: [{ sku: "SKU-1", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "FAST", enabled: true }]
    };
    if (payload.action === "getStockProductionDashboard") return {
      status: "success",
      items: [{ sku: "SKU-1", stock: 2, minimumStock: 2, idealStock: 7, productionTarget: 7, productionMin: 5, productionQty: 5, priority: "MEDIUM", status: "PRODUCTION_REQUIRED", movingStat: "FAST" }],
      queue: [{ SKU: "SKU-1", Status: "PENDING", StockAtCreation: 2, MinimumStock: 2, IdealStock: 7, ProductionMin: 5, ProductionTarget: 7, RecommendedQty: 5, PlannedQty: 5, MovingStat: "FAST", Priority: "MEDIUM" }]
    };
    throw new Error("unexpected action");
  }
};
browserGlobal.window = browserGlobal;

const browserContext = { ...browserGlobal, Set, Map, Object, String, Number, Math, JSON, Array };
browserContext.window = browserContext;
vm.createContext(browserContext);
vm.runInContext(source, browserContext);
assert.equal(vm.runInContext("typeof runStockProductionSnapshotAudit", browserContext), "function");
assert.equal(vm.runInContext("typeof runPendingQueueRefreshDryRun", browserContext), "function");
assert.equal(typeof browserContext.window.runStockProductionSnapshotAudit, "function");
assert.equal(typeof browserContext.window.runPendingQueueRefreshDryRun, "function");
const result = await browserContext.runStockProductionSnapshotAudit();

assert.equal(result.status, undefined);
assert.equal(result.verdict, "SNAPSHOT_RECONCILIATION_PASS");
assert.equal(result.matrix.length, 1);
assert.equal(result.matrix[0].Overall, "PASS");
assert.equal(result.matrix[0].Action, "NO_CHANGE");
assert.equal(result.matrix[0]["Changed Fields"], "-");
assert.equal(result.summary.configMatch, 1);
assert.equal(result.summary.formulaMatch, 1);
assert.equal(result.summary.movingMatch, 1);
assert.equal(result.summary.queueMatch, 1);
assert.equal(result.summary.wouldUpdate, 0);
assert.equal(result.summary.noChange, 1);
assert.deepEqual(calls.map((call) => call.action), ["getProductionConfigurations", "getStockProductionDashboard"]);
assert.ok(calls.every((call) => call.callerEmail === "session@example.test"));

calls.length = 0;
const noChangeDetail = await browserContext.runPendingQueueRefreshDryRun();
assert.equal(noChangeDetail.wouldUpdate, 0);
assert.deepEqual(noChangeDetail.details, []);
assert.deepEqual(calls.map((call) => call.action), ["getProductionConfigurations", "getStockProductionDashboard"]);

const dryRunCalls = [];
const dryRunContext = {
  localStorage: { getItem: () => JSON.stringify({ email: "session@example.test" }) },
  console: { log() {}, error() {}, table() {} },
  postData: async (payload) => {
    dryRunCalls.push(payload);
    if (payload.action === "getProductionConfigurations") return {
      status: "success",
      rows: [
        { sku: "SKU-PENDING", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "FAST", enabled: true },
        { sku: "SKU-IN-PROGRESS", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "MIDDLE", enabled: true },
        { sku: "SKU-MISSING", minimumStock: 2, targetStock: 7, minimumProductionBatch: 5, moving: "SLOW", enabled: true }
      ]
    };
    if (payload.action === "getStockProductionDashboard") return {
      status: "success",
      items: [
        { sku: "SKU-PENDING", stock: 2, minimumStock: 2, idealStock: 7, productionTarget: 7, productionMin: 5, productionQty: 5, priority: "MEDIUM", status: "PRODUCTION_REQUIRED", movingStat: "FAST" },
        { sku: "SKU-IN-PROGRESS", stock: 2, minimumStock: 2, idealStock: 7, productionTarget: 7, productionMin: 5, productionQty: 5, priority: "MEDIUM", status: "PRODUCTION_IN_PROGRESS", movingStat: "MIDDLE" },
        { sku: "SKU-MISSING", stock: 2, minimumStock: 2, idealStock: 7, productionTarget: 7, productionMin: 5, productionQty: 5, priority: "MEDIUM", status: "PRODUCTION_REQUIRED", movingStat: "SLOW" }
      ],
      queue: [
        { SKU: "SKU-PENDING", Status: "PENDING", StockAtCreation: 2, MinimumStock: 2, IdealStock: 7, ProductionMin: 5, ProductionTarget: 7, RecommendedQty: 4, PlannedQty: 4, MovingStat: "SLOW", Priority: "MEDIUM" },
        { SKU: "SKU-IN-PROGRESS", Status: "IN_PROGRESS", StockAtCreation: 2, MinimumStock: 2, IdealStock: 7, ProductionMin: 5, ProductionTarget: 7, RecommendedQty: 5, PlannedQty: 5, MovingStat: "SLOW", Priority: "MEDIUM" }
      ]
    };
    throw new Error("unexpected action");
  }
};
dryRunContext.window = dryRunContext;
Object.assign(dryRunContext, { Set, Map, Object, String, Number, Math, JSON, Array });
vm.createContext(dryRunContext);
vm.runInContext(source, dryRunContext);
const dryRunResult = await dryRunContext.runStockProductionSnapshotAudit();
const pendingRow = dryRunResult.matrix.find((row) => row.SKU === "SKU-PENDING");
const inProgressRow = dryRunResult.matrix.find((row) => row.SKU === "SKU-IN-PROGRESS");
const missingRow = dryRunResult.matrix.find((row) => row.SKU === "SKU-MISSING");
assert.equal(pendingRow.Action, "WOULD_UPDATE");
assert.match(pendingRow["Changed Fields"], /MovingStat/);
assert.match(pendingRow["Changed Fields"], /RecommendedQty/);
assert.equal(inProgressRow.Action, "SKIP_LIFECYCLE");
assert.equal(inProgressRow.Overall, "STALE_BY_LIFECYCLE");
assert.equal(missingRow.Action, "MISSING_QUEUE");
assert.equal(dryRunResult.summary.wouldUpdate, 1);
assert.equal(dryRunResult.summary.movingChanges, 1);
assert.equal(dryRunResult.summary.productionQtyChanges, 1);
assert.equal(dryRunResult.summary.skippedLifecycle, 1);
assert.equal(dryRunResult.summary.missingPendingQueue, 1);
assert.equal(dryRunResult.verdict, "SNAPSHOT_RECONCILIATION_RUNTIME_BUG");
assert.deepEqual(dryRunCalls.map((call) => call.action), ["getProductionConfigurations", "getStockProductionDashboard"]);

dryRunCalls.length = 0;
const checkpoint = await dryRunContext.runPendingQueueRefreshDryRun();
assert.equal(checkpoint.wouldUpdate, 1);
assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.details)), [{
  SKU: "SKU-PENDING", "Queue Status": "PENDING", "Old RecommendedQty": 4, "New RecommendedQty": 5,
  "Old MovingStat": "SLOW", "New MovingStat": "FAST", "Changed Fields": "RecommendedQty, PlannedQty, MovingStat"
}]);
assert.deepEqual(dryRunCalls.map((call) => call.action), ["getProductionConfigurations", "getStockProductionDashboard"]);
console.log("Browser-session Stock/Production audit harness: PASS");
