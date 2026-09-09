import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url), "utf8");
const dom = new JSDOM(`<!doctype html><body>
  <button id="production-reload"></button><div id="production-kpis"></div><div id="production-config-warning"></div><div id="production-config-info"></div><tbody id="production-config-body"></tbody>
  <input id="production-search"><select id="production-filter-status"><option value="ALL">ALL</option></select><select id="production-filter-moving"><option value="ALL">ALL</option></select><select id="production-filter-todo"><option value="ALL">ALL</option></select><select id="production-filter-priority"><option value="ALL">ALL</option></select><select id="production-filter-recipient"><option value="ALL">ALL</option></select>
  <input id="production-alerts-select-all" type="checkbox" data-production-selection-all="alerts"><span id="production-alerts-selection-summary"></span><table><tbody id="production-alerts-body"></tbody></table>
  <button id="production-manual-open"></button><div id="production-manual-modal" class="hidden"></div><select id="production-manual-recipient"></select><select id="production-manual-moving"><option value="ALL">Semua Urgensi</option><option value="FAST">Cepat</option><option value="MIDDLE">Sedang</option><option value="SLOW">Lambat</option></select><input id="production-manual-search"><span id="production-manual-selection-summary"></span><div id="production-manual-items"></div><p id="production-manual-warning"></p><pre id="production-manual-preview"></pre><button id="production-manual-preview-button"></button><button id="production-manual-send"></button>
  <input id="production-queue-search"><select id="production-queue-filter-recipient"><option value="ALL">ALL</option></select><select id="production-queue-filter-status"><option value="ALL">ALL</option><option value="PENDING">PENDING</option></select><select id="production-queue-filter-notification"><option value="ALL">ALL</option></select><input id="production-queue-select-all" type="checkbox" data-production-selection-all="queue"><span id="production-queue-selection-summary"></span><table><tbody id="production-queue-body"></tbody></table><table><tbody id="production-history-body"></tbody></table>
  <div id="production-testing-reset-warning-modal" class="hidden"></div><div id="production-testing-reset-modal" class="hidden"></div>
  <input id="production-testing-reset-queue-select-all" type="checkbox" data-testing-reset-select-all="QUEUE"><span id="production-testing-reset-queue-count"></span><table><tbody id="production-testing-reset-queue-body"></tbody></table>
  <input id="production-testing-reset-alert-select-all" type="checkbox" data-testing-reset-select-all="ALERT"><span id="production-testing-reset-alert-count"></span><table><tbody id="production-testing-reset-alert-body"></tbody></table><span id="production-testing-reset-summary"></span>
</body>`, { runScripts: "outside-only" });

const calls = [];
const payloads = [];
function manualItem(moving, index) {
  return {
    sku: `${moving}-${String(index).padStart(2, "0")}`,
    product: `Produk ${moving} ${index}`,
    color: "Hitam", size: "L", stock: 1, minimumStock: 2,
    productionTarget: 6, productionQty: 5, movingStat: moving, activeProduction: true
  };
}
const manualItems = [
  ...Array.from({ length: 10 }, (_, index) => manualItem("FAST", index + 1)),
  ...Array.from({ length: 32 }, (_, index) => manualItem("MIDDLE", index + 1)),
  ...Array.from({ length: 14 }, (_, index) => manualItem("SLOW", index + 1))
];
const dashboard = {
  status: "success",
  permissions: ["manage_production_queue"],
  kpi: {},
  recipients: [
    { id: "AL-FARUQI", name: "Al Faruqi", type: "KONVEKSI", active: true },
    { id: "ANSLA", name: "Ansla", type: "KONVEKSI", active: true },
    { id: "MANG-IYUS", name: "Mang Iyus", type: "KONVEKSI", active: true }
  ],
  items: [
    { sku: "ALERT-1", product: "Produk 1", stock: 1, minimumStock: 2, productionTarget: 5, productionQty: 4, movingStat: "FAST", status: "CRITICAL", priority: "HIGH", activeProduction: false },
    { sku: "ALERT-2", product: "Produk 2", stock: 2, minimumStock: 3, productionTarget: 6, productionQty: 4, movingStat: "MIDDLE", status: "PRODUCTION_REQUIRED", priority: "MEDIUM", activeProduction: false },
    ...manualItems
  ],
  queue: [
    { QueueID: "QUEUE-1", SKU: "QUEUE-SKU-1", Product: "Produk Queue 1", Status: "PENDING", NotificationStatus: "NOT_SENT" },
    { QueueID: "QUEUE-2", SKU: "QUEUE-SKU-2", Product: "Produk Queue 2", Status: "IN_PROGRESS", NotificationStatus: "SENT" },
    { QueueID: "QUEUE-MANG", SKU: "QUEUE-MANG-1", Product: "Produk Mang Iyus", ProductionRecipient: "MANG-IYUS", ProductionRecipientName: "Mang Iyus", Status: "PENDING", NotificationStatus: "NOT_SENT" }
  ],
  history: []
};

Object.assign(dom.window, {
  currentUser: { email: "admin@example.test" },
  setButtonLoading: () => true,
  resetButton: () => {},
  showToast: () => {},
  postData: async payload => {
    calls.push(payload.action);
    payloads.push(payload);
    if (payload.action === "getStockProductionDashboard") return dashboard;
    if (payload.action === "getProductionConfigurations") return {
      status: "success", permissions: ["manage_production_queue"], configurationAvailable: true,
      rows: [], total: 0, page: 1, pageSize: 100, inventory: [], invalidConfigurations: [],
      recipients: [
        { id: "AL-FARUQI", name: "Al Faruqi", type: "KONVEKSI", active: true },
        { id: "ANSLA", name: "Ansla", type: "KONVEKSI", active: true },
        { id: "MANG-IYUS", name: "Mang Iyus", type: "KONVEKSI", active: true }
      ]
    };
    if (payload.action === "previewManualProductionNotification") return {
      status: "success", messages: ["preview"], warnings: [], itemCount: payload.items.length
    };
    if (payload.action === "previewProductionTestingReset") {
      return {
        status: "success",
        queueCandidates: [
          { id: "QUEUE-1", sku: "QUEUE-SKU-1", product: "Produk Queue 1", status: "PENDING", fingerprint: "queue-1" },
          { id: "QUEUE-2", sku: "QUEUE-SKU-2", product: "Produk Queue 2", status: "IN_PROGRESS", fingerprint: "queue-2" }
        ],
        alertCandidates: [
          { id: "ALERT-ID-1", sku: "ALERT-1", product: "Produk 1", status: "CRITICAL", fingerprint: "alert-1" },
          { id: "ALERT-ID-2", sku: "ALERT-2", product: "Produk 2", status: "PRODUCTION_REQUIRED", fingerprint: "alert-2" }
        ]
      };
    }
    throw new Error(`Unexpected action: ${payload.action}`);
  }
});

vm.runInContext(source, dom.getInternalVMContext());
const ui = dom.window.ProductionCenterUI;
const document = dom.window.document;

await ui.load();

["Al Faruqi", "Ansla", "Mang Iyus", "Belum Diatur"].forEach(label => {
  assert.ok(Array.from(document.getElementById("production-filter-recipient").options).some(option => option.textContent === label), `alerts filter includes ${label}`);
  assert.ok(Array.from(document.getElementById("production-queue-filter-recipient").options).some(option => option.textContent === label), `queue filter includes ${label}`);
});

await ui.openManualNotification();
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "manual modal starts with no selected SKU");
assert.equal(document.getElementById("production-manual-preview-button").disabled, true, "preview is disabled with no selection");
assert.equal(document.querySelectorAll(".production-manual-item").length, 56, "manual table contains all available runtime items without selecting them");
assert.equal(document.querySelectorAll(".production-manual-item:checked").length, 0, "every manual row starts unchecked");
assert.equal(document.querySelectorAll(".production-manual-qty").length, 56, "every manual row has an editable quantity");
assert.equal(document.querySelector(".production-manual-qty").value, "5", "manual quantity starts from evaluator productionQty");
assert.equal(document.getElementById("production-manual-select-all").checked, false, "manual select-all starts unchecked");
assert.equal(document.getElementById("production-manual-select-all").indeterminate, false, "manual select-all starts determinate");
const initialQty = document.querySelector(".production-manual-qty");
initialQty.value = "10";
ui.updateManualQuantity(initialQty);
const beforeNoSelectionPreview = calls.length;
await ui.previewManualNotification(document.getElementById("production-manual-preview-button"));
assert.equal(calls.length, beforeNoSelectionPreview, "empty preview does not call backend");

document.getElementById("production-manual-moving").value = "FAST";
ui.manualFilterChanged();
assert.equal(document.querySelectorAll(".production-manual-item").length, 10, "FAST filter only shows FAST items");
assert.equal(ui.manualPayload().priority, "FAST", "FAST filter uses the canonical backend value");
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "Moving filter never auto-selects FAST items");
assert.equal(document.querySelectorAll(".production-manual-item:checked").length, 0);

document.getElementById("production-manual-moving").value = "MIDDLE";
ui.manualFilterChanged();
assert.equal(document.querySelectorAll(".production-manual-item").length, 32, "MIDDLE filter only shows MIDDLE items");
assert.equal(ui.manualPayload().priority, "MIDDLE", "MIDDLE filter uses the canonical backend value");
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "Moving filter never auto-selects MIDDLE items");
document.getElementById("production-manual-moving").value = "SLOW";
ui.manualFilterChanged();
assert.equal(document.querySelectorAll(".production-manual-item").length, 14, "SLOW filter only shows SLOW items");
assert.equal(ui.manualPayload().priority, "SLOW", "SLOW filter uses the canonical backend value");
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "Moving filter never auto-selects SLOW items");

document.getElementById("production-manual-moving").value = "ALL";
document.getElementById("production-manual-search").value = "FAST-02";
ui.manualFilterChanged();
assert.equal(document.querySelectorAll(".production-manual-item").length, 1, "search changes visible rows only");
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "search never auto-selects its result");
assert.equal(ui.manualPayload().priority, "ALL", "ALL is sent as normalized filter value");

document.getElementById("production-manual-search").value = "";
document.getElementById("production-manual-moving").value = "FAST";
ui.manualFilterChanged();
let manualSelectAll = document.getElementById("production-manual-select-all");
manualSelectAll.checked = true;
ui.toggleManualSelection(manualSelectAll);
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "10 dipilih", "select all selects only the 10 visible FAST rows");
let manualRows = document.querySelectorAll(".production-manual-item");
manualRows[0].checked = false;
ui.toggleManualSelectionItem(manualRows[0]);
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "9 dipilih", "unchecking one item updates the selected count");
assert.equal(document.getElementById("production-manual-select-all").indeterminate, true, "partial visible selection is indeterminate");

document.getElementById("production-manual-moving").value = "MIDDLE";
ui.manualFilterChanged();
assert.equal(document.querySelectorAll(".production-manual-item").length, 32);
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "changing filters never selects newly visible rows");

ui.closeManualNotification();
await ui.openManualNotification();
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "0 dipilih", "closing and reopening resets manual selection");
assert.equal(document.querySelectorAll(".production-manual-item:checked").length, 0, "closing and reopening clears checked rows");
assert.equal(document.querySelector(".production-manual-qty").value, "5", "closing and reopening resets manual quantity to evaluator value");
assert.ok(Array.from(document.getElementById("production-manual-recipient").options).some(option => option.value === "MANG-IYUS"), "manual notification uses the canonical Mang Iyus recipient");
document.getElementById("production-manual-recipient").value = "MANG-IYUS";
manualRows = document.querySelectorAll(".production-manual-item");
manualRows[0].checked = true;
ui.toggleManualSelectionItem(manualRows[0]);
const invalidQty = document.querySelector(".production-manual-qty");
invalidQty.value = "1.5";
ui.updateManualQuantity(invalidQty);
assert.equal(ui.validateManualQuantities().valid, false, "decimal manual quantity is rejected before preview");
invalidQty.value = "5";
ui.updateManualQuantity(invalidQty);
manualRows[0].checked = false;
ui.toggleManualSelectionItem(manualRows[0]);
for (let index = 0; index < 3; index += 1) {
  manualRows[index].checked = true;
  ui.toggleManualSelectionItem(manualRows[index]);
}
const selectedQuantities = document.querySelectorAll(".production-manual-qty");
selectedQuantities[0].value = "10";
ui.updateManualQuantity(selectedQuantities[0]);
assert.equal(document.getElementById("production-manual-selection-summary").textContent, "3 dipilih", "manual preview selection is exact");
const beforePreview = calls.length;
await ui.previewManualNotification(document.getElementById("production-manual-preview-button"));
const manualPreviewPayload = payloads.filter(payload => payload.action === "previewManualProductionNotification").at(-1);
assert.equal(manualPreviewPayload.items.length, 3, "preview sends exactly selected SKU count");
assert.equal(manualPreviewPayload.items[0].manualProductionQty, 10, "preview sends the selected SKU override");
assert.ok(manualPreviewPayload.items.every(item => Number.isInteger(item.manualProductionQty) && item.manualProductionQty > 0), "preview sends valid integer quantities");
assert.equal(manualPreviewPayload.priority, "ALL");
assert.equal(calls.length, beforePreview + 1);

const alertAll = document.getElementById("production-alerts-select-all");
assert.equal(alertAll.disabled, false);
assert.equal(document.querySelectorAll('[data-production-selection="alerts"]').length, 58);
alertAll.checked = true;
ui.toggleCurrentSelection(alertAll);
assert.equal(document.querySelectorAll('[data-production-selection="alerts"]:checked').length, 58, "select all alert only selects current result");
assert.equal(document.getElementById("production-alerts-selection-summary").textContent, "58 dipilih");
const firstAlert = document.querySelector('[data-production-selection="alerts"]');
firstAlert.checked = false;
ui.toggleCurrentSelectionItem(firstAlert);
assert.equal(alertAll.indeterminate, true, "partial alert selection is indeterminate");
alertAll.checked = false;
ui.toggleCurrentSelection(alertAll);
assert.equal(document.querySelectorAll('[data-production-selection="alerts"]:checked').length, 0, "alert select all clears current result");

const queueAll = document.getElementById("production-queue-select-all");
queueAll.checked = true;
ui.toggleCurrentSelection(queueAll);
assert.equal(document.querySelectorAll('[data-production-selection="queue"]:checked').length, 3, "queue select all only selects current result");
const firstQueue = document.querySelector('[data-production-selection="queue"]');
firstQueue.checked = false;
ui.toggleCurrentSelectionItem(firstQueue);
assert.equal(queueAll.indeterminate, true, "partial queue selection is indeterminate");
document.getElementById("production-queue-search").value = "QUEUE-SKU-1";
ui.renderCurrentQueue();
assert.equal(document.querySelectorAll('[data-production-selection="queue"]').length, 1, "queue search filters SKU locally");
document.getElementById("production-queue-search").value = "";
document.getElementById("production-queue-filter-recipient").value = "MANG-IYUS";
ui.renderCurrentQueue();
assert.equal(document.querySelectorAll('[data-production-selection="queue"]').length, 1, "Mang Iyus queue filter only shows Mang Iyus work");
assert.match(document.getElementById("production-queue-body").textContent, /Produk Mang Iyus/);
document.getElementById("production-queue-filter-recipient").value = "ALL";
document.getElementById("production-queue-filter-status").value = "PENDING";
ui.renderCurrentQueue();
assert.equal(document.querySelectorAll('[data-production-selection="queue"]').length, 2, "queue filter changes the visible selection result");
assert.equal(document.querySelectorAll('[data-production-selection="queue"]:checked').length, 0, "hidden queue selection is cleared on filter change");

await ui.continueTestingReset({});
const resetQueueAll = document.getElementById("production-testing-reset-queue-select-all");
const resetAlertAll = document.getElementById("production-testing-reset-alert-select-all");
assert.equal(document.querySelectorAll('[data-testing-reset-type]:checked').length, 0, "reset opens without automatic selection");
resetQueueAll.checked = true;
ui.toggleTestingResetSelection(resetQueueAll);
assert.deepEqual(JSON.parse(JSON.stringify(ui.getTestingResetSelection().queueIds)), ["QUEUE-1", "QUEUE-2"], "reset queue selection uses QueueID");
resetQueueAll.checked = false;
ui.toggleTestingResetSelection(resetQueueAll);
assert.equal(ui.getTestingResetSelection().queueIds.length, 0, "reset queue selection clears");
const firstResetQueue = document.querySelector('[data-testing-reset-type="QUEUE"]');
firstResetQueue.checked = true;
ui.toggleTestingResetItem(firstResetQueue);
assert.equal(resetQueueAll.indeterminate, true, "partial reset queue selection is indeterminate");
resetAlertAll.checked = true;
ui.toggleTestingResetSelection(resetAlertAll);
assert.deepEqual(JSON.parse(JSON.stringify(ui.getTestingResetSelection().alertIds)), ["ALERT-ID-1", "ALERT-ID-2"], "reset alert selection uses AlertID");
ui.clearTestingResetSelection();
assert.equal(document.querySelectorAll('[data-testing-reset-type]:checked').length, 0, "reset clear removes every explicit selection");
assert.equal(resetQueueAll.indeterminate, false);
assert.equal(resetAlertAll.indeterminate, false);

assert.deepEqual(calls, [
  "getStockProductionDashboard", "getProductionConfigurations", "getStockProductionDashboard",
  "getStockProductionDashboard", "previewManualProductionNotification", "previewProductionTestingReset"
], "selection controls only trigger dashboard/config/preview reads");
assert.equal(calls.some(action => [
  "sendManualProductionNotification", "createProductionQueue", "updateProductionQueueStatus",
  "saveProductionConfiguration", "deleteProductionConfiguration"
].includes(action)), false, "selection controls do not trigger mutation actions");
console.log("Production selection UI: PASS (manual Moving filters, zero-default selection, exact preview, alerts, queue, reset)");
