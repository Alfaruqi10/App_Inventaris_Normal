import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const indexSource = fs.readFileSync(new URL("../src/frontend/index.html", import.meta.url), "utf8");
const utilityStart = indexSource.indexOf("window.ButtonLoading =");
const utilityEnd = indexSource.indexOf("function setButtonLoading", utilityStart);
assert.ok(utilityStart >= 0 && utilityEnd > utilityStart, "global loading utility must be present");

const context = { window: {}, WeakMap, Object, String };
vm.createContext(context);
vm.runInContext(indexSource.slice(utilityStart, utilityEnd), context);

class FakeButton {
    constructor(html = '<i class="ph ph-floppy-disk"></i> Simpan') {
        this.innerHTML = html;
        this.disabled = false;
        this.dataset = {};
        this.style = { minWidth: "" };
        this.offsetWidth = 128;
        this.attributes = new Map();
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
}

const loading = context.window.ButtonLoading;
assert.equal(typeof loading.set, "function");
assert.equal(typeof loading.reset, "function");
assert.equal(typeof loading.withLoading, "function");

const button = new FakeButton();
const originalHtml = button.innerHTML;
assert.equal(loading.set(button, "Menyimpan..."), true, "first click starts loading");
assert.equal(loading.set(button, "Menyimpan..."), false, "second click is rejected");
assert.equal(button.disabled, true);
assert.equal(button.getAttribute("aria-busy"), "true");
assert.equal(button.dataset.actionLoading, "true");
assert.match(button.innerHTML, /button-spinner/);
assert.match(button.innerHTML, /Menyimpan/);
assert.equal(button.style.minWidth, "128px");
loading.reset(button);
assert.equal(button.innerHTML, originalHtml);
assert.equal(button.disabled, false);
assert.equal(button.getAttribute("aria-busy"), null);
assert.equal(button.dataset.actionLoading, undefined);
assert.equal(button.style.minWidth, "");

const successButton = new FakeButton();
const successResult = await loading.withLoading(successButton, async () => "ok", { loadingText: "Memuat..." });
assert.equal(successResult, "ok");
assert.equal(successButton.innerHTML, originalHtml);
assert.equal(successButton.disabled, false);

const errorButton = new FakeButton();
await assert.rejects(
    loading.withLoading(errorButton, async () => { throw new Error("request failed"); }, { loadingText: "Mengirim..." }),
    /request failed/
);
assert.equal(errorButton.innerHTML, originalHtml, "error restores original button");
assert.equal(errorButton.disabled, false);

const iconButton = new FakeButton('<i class="ph ph-trash"></i>');
assert.equal(loading.set(iconButton, { loadingText: "Menghapus...", iconOnly: true }), true);
assert.match(iconButton.innerHTML, /button-spinner/);
assert.doesNotMatch(iconButton.innerHTML, /Menghapus/);
loading.reset(iconButton);
assert.equal(iconButton.innerHTML, '<i class="ph ph-trash"></i>');

const originallyDisabledButton = new FakeButton();
originallyDisabledButton.disabled = true;
assert.equal(loading.set(originallyDisabledButton, "Memproses..."), true);
loading.reset(originallyDisabledButton);
assert.equal(originallyDisabledButton.disabled, true, "pre-existing disabled state is preserved");

assert.match(indexSource, /window\.ButtonLoading\s*=\s*\(function/);
assert.match(indexSource, /finally\s*\{\s*resetButton\(btn\)/);
assert.match(indexSource, /dataset\.actionLoading/);
assert.match(indexSource, /testWebhookPush\(this\)/);
assert.match(indexSource, /loadWebhookDashboard\(this\)/);
assert.match(indexSource, /BusinessAnalyticsUI\.recalculate\(this\)/);
assert.match(indexSource, /NotificationCenterUI\.refreshActiveTab\(this\)/);
const productionSource = fs.readFileSync(new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url), "utf8");
assert.match(productionSource, /async saveRecipient\(button\)/);
assert.match(productionSource, /if \(!setBusy\(button, true, "Menyimpan\.\.\."\)\) return/);
assert.match(productionSource, /async updateQueue\(queueId, nextStatus, completedQty, button\)/);
assert.match(productionSource, /async openManualNotification\(button\)/);
assert.match(productionSource, /if \(!setBusy\(button, true, "Memuat\.\.\."\)\) return/);
assert.match(indexSource, /ProductionCenterUI\.saveRecipient\(this\)/);
assert.match(indexSource, /ProductionCenterUI\.saveConfig\(this\)/);
assert.match(indexSource, /ProductionCenterUI\.openManualNotification\(this\)/);
const salesLedgerSource = fs.readFileSync(new URL("../sales-ledger.js", import.meta.url), "utf8");
assert.match(salesLedgerSource, /setButtonLoading\(btn, 'Memproses\.\.\.'/);
assert.match(salesLedgerSource, /resetButton\(btn\)/);

console.log("Global button loading: PASS (success, error, exception, double-click, icon restore, integration)");
