import fs from "node:fs";
import path from "node:path";
import {
  buildLedgerContributions,
  createMasterIdentityBySku,
  evaluateMovingCandidate,
  parseSalesLedgerRows,
  traceMovingCandidate
} from "./moving-formula-discovery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ledgerMatrix = JSON.parse(fs.readFileSync(path.join(root, ".codex-tmp", "formula-discovery-salesledger.json"), "utf8"));
const setup = JSON.parse(fs.readFileSync(path.join(root, "reference-data", "production-setup-reference.json"), "utf8"));
const production = JSON.parse(fs.readFileSync(path.join(root, "reference-data", "production-configuration-import-reference.json"), "utf8"));
const asOfDate = "29/08/2026";

const golden = production.records.map((row) => ({
  sku: row.SKU,
  product: row.ProductName,
  color: row.Color,
  size: row.Size,
  moving: row.MovingReference
}));
const identities = createMasterIdentityBySku(setup.records.map((row) => ({
  "Kode Barang": row.SKU,
  "Nama Barang": row.ProductName,
  Warna: row.Color,
  Ukuran: row.Size
})));
const ledgerRows = parseSalesLedgerRows(ledgerMatrix);
const contributions = buildLedgerContributions(ledgerRows, identities, "expanded");
const groupings = ["sku", "product", "product_color"];
const windows = ["7_calendar", "14_calendar", "30_calendar", "31_calendar", "30_business", "31_business"];
const measures = ["qty", "order_count"];
const statusSets = ["all", "approved", "exclude_cancelled", "existing_production_statuses"];
const candidates = [];

for (const grouping of groupings) {
  for (const window of windows) {
    for (const measure of measures) {
      for (const statusSet of statusSets) {
        for (let fastThreshold = 9; fastThreshold <= 16; fastThreshold += 1) {
          const result = evaluateMovingCandidate({ contributions: contributions.contributions, goldenRows: golden, asOfDate, grouping, window, measure, statusSet, fastThreshold });
          candidates.push({
            grouping, window, measure, statusSet, fastThreshold,
            fastMatched: result.counts.FAST.matched,
            middleMatched: result.counts.MIDDLE.matched,
            slowMatched: result.counts.SLOW.matched,
            matches: result.matches,
            mismatches: result.mismatches.map((row) => row.sku),
            rows: result.rows
          });
        }
      }
    }
  }
}

const order = { product: 0, product_color: 1, sku: 2 };
candidates.sort((left, right) => right.matches - left.matches || order[left.grouping] - order[right.grouping] || left.fastThreshold - right.fastThreshold);
const exact = candidates.filter((candidate) => candidate.matches === golden.length);
const best = candidates[0];
const badzlinSkus = golden.filter((row) => row.product === "Badzlin Dress").map((row) => row.sku);
const badzlinTarget = golden.find((row) => row.sku === "ANS-BAD-HTM-L");
const badzlinScenarios = [
  { grouping: "product", window: "31_calendar", measure: "qty", statusSet: "all", fastThreshold: 16 },
  { grouping: "product", window: "31_calendar", measure: "qty", statusSet: "exclude_cancelled", fastThreshold: 16 },
  { grouping: "product", window: "31_calendar", measure: "qty", statusSet: "existing_production_statuses", fastThreshold: 16 },
  { grouping: "product", window: "30_calendar", measure: "qty", statusSet: "all", fastThreshold: 16 },
  { grouping: "product", window: "30_calendar", measure: "qty", statusSet: "existing_production_statuses", fastThreshold: 9 }
];
const badzlinTraces = badzlinScenarios.map((formula) => ({ formula, ...traceMovingCandidate({ contributions: contributions.contributions, target: badzlinTarget, asOfDate, ...formula }) }));
const exactByThreshold = Object.fromEntries(Array.from({ length: 8 }, (_, index) => index + 9).map((threshold) => [threshold, exact.filter((candidate) => candidate.fastThreshold === threshold).length]));
const matrix = candidates.map(({ rows, mismatches, ...candidate }) => candidate);
const matrixPath = path.join(root, ".codex-tmp", "moving-formula-v2-sensitivity-matrix.json");
fs.writeFileSync(matrixPath, `${JSON.stringify({ asOfDate, matrix }, null, 2)}\n`);

const sensitivity = badzlinScenarios.map((formula) => {
  const result = candidates.find((candidate) => Object.entries(formula).every(([key, value]) => candidate[key] === value));
  return { ...formula, matches: result?.matches ?? null, badzlin: result?.rows.find((row) => row.sku === "ANS-BAD-HTM-L") ?? null };
});

console.log(JSON.stringify({
  mode: "READ_ONLY_IN_MEMORY_SENSITIVITY",
  snapshot: { asOfDate, ledgerRows: ledgerRows.length, goldenRows: golden.length, unresolvedAllocations: contributions.unresolvedAllocations.length },
  best: { ...best, rows: undefined },
  exactCandidateCount: exact.length,
  exactByThreshold,
  exactCandidateDimensions: {
    grouping: [...new Set(exact.map((candidate) => candidate.grouping))],
    window: [...new Set(exact.map((candidate) => candidate.window))],
    measure: [...new Set(exact.map((candidate) => candidate.measure))],
    statusSet: [...new Set(exact.map((candidate) => candidate.statusSet))]
  },
  matrixPath,
  topCandidates: matrix.slice(0, 20),
  sensitivity,
  badzlin: { familySkus: badzlinSkus, traces: badzlinTraces }
}, null, 2));
