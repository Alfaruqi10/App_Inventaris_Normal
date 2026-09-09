import assert from "node:assert/strict";
import fs from "node:fs";

const setupPath = new URL("../reference-data/production-setup-reference.json", import.meta.url);
const rankingPath = new URL("../reference-data/sales-ranking-reference.json", import.meta.url);
const setup = JSON.parse(fs.readFileSync(setupPath, "utf8"));
const ranking = JSON.parse(fs.readFileSync(rankingPath, "utf8"));

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

function statusCount(records, status) {
  return records.filter((record) => record.ValidationStatus === status).length;
}

test("setup staging has the audited validation counts", () => {
  assert.equal(setup.dataset, "ProductionSetupReference");
  assert.equal(setup.records.length, 169);
  assert.equal(statusCount(setup.records, "VALID"), 75);
  assert.equal(statusCount(setup.records, "REVIEW_REQUIRED"), 94);
  assert.equal(statusCount(setup.records, "UNRESOLVED"), 0);
});

test("only complete classified setup records are valid", () => {
  setup.records.filter((record) => record.ValidationStatus === "VALID").forEach((record) => {
    assert.match(record.SKU, /^ANS-/);
    assert.ok(["FAST", "MIDDLE", "SLOW"].includes(record.Moving));
    assert.equal(Number.isFinite(record.MinimumStock), true);
    assert.equal(Number.isFinite(record.IdealStock), true);
    assert.equal(Number.isFinite(record.ProductionMinimum), true);
  });
});

test("XXL extraction defects retain their raw source identity", () => {
  const defects = setup.records.filter((record) => record.IdentityResolution === "VERIFIED_XXL_EXTRACTION_DEFECT");
  assert.deepEqual(defects.map((record) => [record.SourceSKURaw, record.SKU]).sort(), [
    ["ANS-POB-AZO-HTM-XX", "ANS-POB-AZO-HTM-XXL"],
    ["ANS-POB-EMA-HTM-XX", "ANS-POB-EMA-HTM-XXL"]
  ]);
  defects.forEach((record) => assert.match(record.ValidationReason, /omitted the final L/));
});

test("Badzlin L is the audited setup and ranking reference", () => {
  const setupBadzlin = setup.records.find((record) => record.SKU === "ANS-BAD-HTM-L");
  const rankingBadzlin = ranking.records.find((record) => record.SKU === "ANS-BAD-HTM-L");
  assert.deepEqual(
    [setupBadzlin.Moving, setupBadzlin.MinimumStock, setupBadzlin.IdealStock, setupBadzlin.ProductionMinimum],
    ["FAST", 4, 8, 2]
  );
  assert.deepEqual([rankingBadzlin.Rank, rankingBadzlin.SalesQty], [14, 5]);
});

test("ranking staging preserves the five unresolved identities", () => {
  assert.equal(ranking.dataset, "SalesRankingReference");
  assert.equal(ranking.records.length, 69);
  assert.equal(statusCount(ranking.records, "VALID"), 64);
  assert.equal(statusCount(ranking.records, "UNRESOLVED"), 5);
  assert.deepEqual(
    ranking.records
      .filter((record) => record.ValidationStatus === "UNRESOLVED")
      .map((record) => [record.ProductName.toLowerCase(), record.Color.toLowerCase(), record.Size.toLowerCase(), record.SKU]),
    [
      ["dysha kaftan", "hitam", "standar lengan s/m", ""],
      ["azoa dress", "hitam", "custom", ""],
      ["dysha kaftan", "hitam", "standar lengan l/xl", ""],
      ["irish stripes kaftan", "hitam", "all size", ""],
      ["dysha kaftan", "broken white", "custom", ""]
    ]
  );
});

test("staging files retain source metadata without becoming runtime inputs", () => {
  assert.match(setup.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(ranking.source.sha256, /^[a-f0-9]{64}$/);
  const runtimeSources = [
    "src/backend/Production/StockProductionEngine.gs",
    "src/backend/code.gs"
  ].map((path) => fs.readFileSync(path, "utf8"));
  runtimeSources.forEach((source) => assert.equal(source.includes("reference-data/"), false));
});

console.log(`Production reference normalization tests: ${passed} passed.`);
