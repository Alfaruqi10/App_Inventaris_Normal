import assert from "node:assert/strict";
import {
  buildLedgerContributions,
  createMasterIdentityBySku,
  evaluateMovingCandidate,
  movingFromValue,
  parseSalesLedgerRows,
  rankSalesLedger,
  traceMovingCandidate
} from "../tools/moving-formula-discovery.mjs";

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

const master = createMasterIdentityBySku([
  { "Kode Barang": "SKU-A", "Nama Barang": "Dress A", Warna: "Hitam", Ukuran: "L" },
  { "Kode Barang": "SKU-B", "Nama Barang": "Dress A", Warna: "Hitam", Ukuran: "M" }
]);

const ledger = parseSalesLedgerRows([
  ["Order SN", "Tanggal Order", "Status Shopee", "SKU Inventaris", "Qty"],
  ["ORDER-1", "30/07/2026", "COMPLETED", "SKU-A", 15],
  ["ORDER-2", "31/07/2026", "CANCELLED", "SKU-B", 1],
  ["ORDER-3", "01/08/2026", "COMPLETED", "SKU-A; SKU-B", 2]
]);

test("classifies the baseline boundaries without coercing zero", () => {
  assert.equal(movingFromValue(0), "SLOW");
  assert.equal(movingFromValue(1), "MIDDLE");
  assert.equal(movingFromValue(16), "FAST");
});

test("expands a multi-SKU row only when SKU count equals quantity", () => {
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  assert.equal(expanded.unresolvedAllocations.length, 0);
  assert.equal(expanded.contributions.filter((row) => row.allocation === "EXPANDED_MULTI_SKU").length, 2);
  assert.deepEqual(expanded.contributions.filter((row) => row.orderSn === "ORDER-3").map((row) => [row.sku, row.allocatedQty]), [
    ["SKU-A", 1], ["SKU-B", 1]
  ]);
});

test("keeps raw direct-SKU aggregation distinct from deterministic expansion", () => {
  const raw = buildLedgerContributions(ledger, master, "raw");
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  assert.equal(raw.unresolvedAllocations.length, 1);
  assert.equal(raw.contributions.length, 2);
  assert.equal(expanded.contributions.length, 4);
});

test("uses an inclusive calendar window and distinguishes status policies", () => {
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  const golden = [{ sku: "SKU-A", product: "Dress A", color: "Hitam", size: "L", moving: "FAST" }];
  const approved = evaluateMovingCandidate({
    contributions: expanded.contributions, goldenRows: golden, asOfDate: "29/08/2026",
    grouping: "sku", window: "31_calendar", measure: "qty", statusSet: "approved"
  });
  assert.equal(approved.rows[0].value, 16);
  assert.equal(approved.rows[0].actual, "FAST");
  const all = evaluateMovingCandidate({
    contributions: expanded.contributions, goldenRows: [{ ...golden[0], sku: "SKU-B", size: "M", moving: "MIDDLE" }], asOfDate: "29/08/2026",
    grouping: "sku", window: "31_calendar", measure: "qty", statusSet: "all"
  });
  assert.equal(all.rows[0].value, 2);
});

test("excludes cancelled orders only when the policy says so", () => {
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  const golden = [{ sku: "SKU-B", product: "Dress A", color: "Hitam", size: "M", moving: "MIDDLE" }];
  const all = evaluateMovingCandidate({ contributions: expanded.contributions, goldenRows: golden, asOfDate: "29/08/2026", grouping: "sku", window: "31_calendar", measure: "qty", statusSet: "all" });
  const excluded = evaluateMovingCandidate({ contributions: expanded.contributions, goldenRows: golden, asOfDate: "29/08/2026", grouping: "sku", window: "31_calendar", measure: "qty", statusSet: "exclude_cancelled" });
  assert.equal(all.rows[0].value, 2);
  assert.equal(excluded.rows[0].value, 1);
});

test("supports 31 business-day windows without excluding the as-of date", () => {
  const asOfLedger = parseSalesLedgerRows([
    ["Order SN", "Tanggal Order", "Status Shopee", "SKU Inventaris", "Qty"],
    ["ORDER-AS-OF", "28/08/2026", "COMPLETED", "SKU-A", 16]
  ]);
  const expanded = buildLedgerContributions(asOfLedger, master, "expanded");
  const result = evaluateMovingCandidate({
    contributions: expanded.contributions,
    goldenRows: [{ sku: "SKU-A", product: "Dress A", color: "Hitam", size: "L", moving: "FAST" }],
    asOfDate: "28/08/2026", grouping: "sku", window: "31_business", measure: "qty", statusSet: "approved"
  });
  assert.equal(result.rows[0].value, 16);
});

test("candidate trace explains cancelled and included contributions", () => {
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  const trace = traceMovingCandidate({
    contributions: expanded.contributions,
    target: { sku: "SKU-B", productName: "Dress A", color: "Hitam", size: "M" },
    asOfDate: "29/08/2026", grouping: "sku", window: "31_calendar", measure: "qty", statusSet: "exclude_cancelled"
  });
  assert.equal(trace.value, 1);
  assert.ok(trace.rows.some((row) => row.status === "CANCELLED" && row.reason === "STATUS_POLICY"));
});

test("distinguishes quantity from order count for the same identity", () => {
  const expanded = buildLedgerContributions(ledger, master, "expanded");
  const qty = rankSalesLedger({ contributions: expanded.contributions, asOfDate: "29/08/2026", measure: "qty", statusSet: "approved" });
  const orders = rankSalesLedger({ contributions: expanded.contributions, asOfDate: "29/08/2026", measure: "order_count", statusSet: "approved" });
  assert.equal(qty.find((row) => row.sku === "SKU-A").salesQty, 16);
  assert.equal(orders.find((row) => row.sku === "SKU-A").salesQty, 2);
});

console.log(`Moving formula discovery tests: ${passed} passed.`);
