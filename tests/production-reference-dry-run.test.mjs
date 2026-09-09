import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCanonicalRankingDryRun,
  reconcileProductionSetupReference
} from "../tools/production-reference-dry-run.mjs";

const setup = JSON.parse(fs.readFileSync(new URL("../reference-data/production-setup-reference.json", import.meta.url), "utf8"));
const ranking = JSON.parse(fs.readFileSync(new URL("../reference-data/sales-ranking-reference.json", import.meta.url), "utf8"));

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

test("exact SKU matching compares canonical values by SKU", () => {
  const report = reconcileProductionSetupReference(setup.records, [{
    SKU: "ANS-BAD-HTM-L", MinimumStock: 4, TargetStock: 8, MinimumProductionBatch: 2, Enabled: true
  }]);
  assert.equal(report.changesRequired.length, 1);
  assert.equal(report.changesRequired[0].sku, "ANS-BAD-HTM-L");
  assert.deepEqual(report.changesRequired[0].differences.map((entry) => entry.field), ["Moving", "SKUStat", "Period"]);
});

test("only VALID setup rows are canonical", () => {
  const report = reconcileProductionSetupReference(setup.records, []);
  assert.equal(report.validReferenceRows, 75);
  assert.equal(report.reviewRequiredRows, 94);
  assert.equal(report.missingInLive.length, 75);
});

test("Badzlin L keeps its audited canonical values", () => {
  const report = reconcileProductionSetupReference(setup.records, [{
    SKU: "ANS-BAD-HTM-L", MinimumStock: 2, TargetStock: 6, MinimumProductionBatch: 2, Enabled: true
  }]);
  const diff = report.changesRequired.find((row) => row.sku === "ANS-BAD-HTM-L").differences;
  assert.deepEqual(diff.filter((entry) => ["MinimumStock", "TargetStock", "MinimumProductionBatch"].includes(entry.field)), [
    { field: "MinimumStock", current: 2, reference: 4 },
    { field: "TargetStock", current: 6, reference: 8 }
  ]);
});

test("missing and extra live configurations remain distinct", () => {
  const report = reconcileProductionSetupReference(setup.records, [{
    SKU: "SKU-EXTRA", MinimumStock: 1, TargetStock: 3, MinimumProductionBatch: 1, Enabled: true
  }]);
  assert.equal(report.missingInLive.length, 75);
  assert.deepEqual(report.extraInLive.map((row) => row.sku), ["SKU-EXTRA"]);
});

test("field-level differences include only numeric canonical mismatches plus schema gaps", () => {
  const report = reconcileProductionSetupReference(setup.records, [{
    SKU: "ANS-BAD-HTM-L", MinimumStock: 3, TargetStock: 7, MinimumProductionBatch: 1, Enabled: false
  }]);
  const fields = report.changesRequired[0].differences.map((entry) => entry.field);
  assert.deepEqual(fields, ["MinimumStock", "TargetStock", "MinimumProductionBatch", "Moving", "SKUStat", "Period"]);
});

test("ranking excludes unresolved identities and joins only canonical setup rules", () => {
  const report = buildCanonicalRankingDryRun(setup.records, ranking.records);
  assert.equal(report.validRankingRows, 64);
  assert.equal(report.unresolvedRankingRows, 5);
  assert.equal(report.unresolvedExcluded.length, 5);
  assert.equal(report.missingCanonicalSetup.length, 15);
  assert.equal(report.ranked.length, 49);
});

test("ranking sorts FAST then MIDDLE then SLOW by sales quantity", () => {
  const report = buildCanonicalRankingDryRun([
    { SKU: "FAST-A", ValidationStatus: "VALID", Moving: "FAST" },
    { SKU: "FAST-B", ValidationStatus: "VALID", Moving: "FAST" },
    { SKU: "MIDDLE", ValidationStatus: "VALID", Moving: "MIDDLE" },
    { SKU: "SLOW", ValidationStatus: "VALID", Moving: "SLOW" }
  ], [
    { SKU: "SLOW", ProductName: "Zulu", Color: "Hitam", Size: "L", SalesQty: 99, Rank: 1, ValidationStatus: "VALID" },
    { SKU: "FAST-A", ProductName: "Beta", Color: "Hitam", Size: "L", SalesQty: 5, Rank: 2, ValidationStatus: "VALID" },
    { SKU: "MIDDLE", ProductName: "Gamma", Color: "Hitam", Size: "L", SalesQty: 9, Rank: 3, ValidationStatus: "VALID" },
    { SKU: "FAST-B", ProductName: "Alpha", Color: "Hitam", Size: "L", SalesQty: 5, Rank: 4, ValidationStatus: "VALID" },
    { SKU: "UNRESOLVED", ProductName: "Ignored", Color: "Hitam", Size: "L", SalesQty: 100, Rank: 5, ValidationStatus: "UNRESOLVED" }
  ]);
  assert.deepEqual(report.ranked.map((row) => row.sku), ["FAST-B", "FAST-A", "MIDDLE", "SLOW"]);
  assert.equal(report.unresolvedExcluded.length, 1);
});

console.log(`Production reference dry-run tests: ${passed} passed.`);
