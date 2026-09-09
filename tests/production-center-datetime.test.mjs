import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const indexSource = fs.readFileSync(new URL("../src/frontend/index.html", import.meta.url), "utf8");
const formatterStart = indexSource.indexOf("window.DateFormatter = (function() {");
const formatterEnd = indexSource.indexOf("})();", formatterStart) + 5;
assert.ok(formatterStart >= 0 && formatterEnd > formatterStart, "central DateFormatter block is present");

const context = { window: {}, Date, Intl, Number, String, Object, Array, Math, RegExp };
vm.createContext(context);
vm.runInContext(`${indexSource.slice(formatterStart, formatterEnd)}\nwindow.formatIndonesiaDateTime = window.DateFormatter.formatIndonesiaDateTime;`, context);
const formatIndonesiaDateTime = context.window.formatIndonesiaDateTime;

assert.equal(formatIndonesiaDateTime("2026-09-08T03:11:07.075Z"), "08 Sep 2026, 10:11 WIB");
assert.equal(formatIndonesiaDateTime("2026-09-07T17:39:43.889Z"), "08 Sep 2026, 00:39 WIB");
assert.equal(formatIndonesiaDateTime("2026-09-07T07:13:35.289Z"), "07 Sep 2026, 14:13 WIB");
for (const value of [null, undefined, "", "not-a-timestamp"]) {
  const output = formatIndonesiaDateTime(value);
  assert.equal(output, "—", `invalid value ${String(value)} uses safe UI fallback`);
  assert.ok(!["undefined", "null", "Invalid Date", "NaN"].some(token => output.includes(token)));
}

const productionCenterSource = fs.readFileSync(new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url), "utf8");
assert.equal((productionCenterSource.match(/window\.formatIndonesiaDateTime\(/g) || []).length, 5, "all displayed Production Center timestamps use the centralized helper");
assert.ok(productionCenterSource.includes("window.formatIndonesiaDateTime(row.Timestamp)"), "history timestamp is formatted for display");
assert.ok(productionCenterSource.includes("window.formatIndonesiaDateTime(row.ReceivedAt)"), "report list timestamp is formatted for display");
assert.ok(productionCenterSource.includes("window.formatIndonesiaDateTime(report.ReceivedAt)"), "report detail received timestamp is formatted for display");
assert.ok(productionCenterSource.includes("window.formatIndonesiaDateTime(report.VerifiedAt)"), "verified timestamp is formatted for display");
assert.ok(productionCenterSource.includes("window.formatIndonesiaDateTime(report.RejectedAt)"), "rejected timestamp is formatted for display");

console.log("Production Center WIB date/time tests: PASS (3 UTC conversions + 4 safe fallbacks + 5 render assertions)");
