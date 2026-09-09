import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildImportRows,
  configurationValues,
  planProductionConfigurationImport,
  REQUIRED_HEADERS
} from "../tools/production-configuration-import.mjs";

const production = JSON.parse(fs.readFileSync(new URL("../reference-data/production-configuration-import-reference.json", import.meta.url), "utf8"));
const setup = JSON.parse(fs.readFileSync(new URL("../reference-data/production-setup-reference.json", import.meta.url), "utf8"));

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const master = production.records.map((row) => ({ "Kode Barang": row.SKU, "Nama Barang": row.ProductName, Warna: row.Color, Ukuran: row.Size }));
const resolved = buildImportRows(production.records, setup.records, master);

test("all 67 PDF records resolve by exact SKU and variant", () => {
  assert.equal(production.records.length, 67);
  assert.equal(resolved.errors.length, 0);
  assert.equal(resolved.records.filter((row) => row.validation.length).length, 0);
});

test("Badzlin L retains PDF minimum/target and Setup batch", () => {
  const row = resolved.records.find((item) => item.sku === "ANS-BAD-HTM-L");
  assert.deepEqual([row.minimumStock, row.targetStock, row.minimumProductionBatch], [2, 7, 2]);
  assert.equal(Object.hasOwn(row, "moving"), false);
});

test("empty valid live configuration produces 67 inserts using the UI enabled default", () => {
  const plan = planProductionConfigurationImport({ referenceRecords: resolved.records, existingRows: [], headers: REQUIRED_HEADERS });
  assert.equal(plan.writeAllowed, true);
  assert.equal(plan.inserts.length, 67);
  assert.equal(plan.updates.length, 0);
  assert.equal(configurationValues(plan.inserts, "2026-08-29", "CONTROLLED_IMPORT")[0][4], true);
});

test("duplicate existing SKU blocks all writes", () => {
  const plan = planProductionConfigurationImport({ referenceRecords: resolved.records.slice(0, 1), existingRows: [{ SKU: "ANS-BAD-HTM-L" }, { SKU: "ANS-BAD-HTM-L" }], headers: REQUIRED_HEADERS });
  assert.equal(plan.writeAllowed, false);
  assert.deepEqual(plan.duplicateSkus, ["ANS-BAD-HTM-L"]);
});

test("invalid or ambiguous source rows block all writes", () => {
  const invalid = [{ ...resolved.records[0], validation: ["INVALID_MINIMUM_PRODUCTION_BATCH"] }];
  const plan = planProductionConfigurationImport({ referenceRecords: invalid, existingRows: [], headers: REQUIRED_HEADERS });
  assert.equal(plan.writeAllowed, false);
  assert.equal(plan.invalidReference.length, 1);
});

console.log(`Production configuration import tests: ${passed} passed.`);
