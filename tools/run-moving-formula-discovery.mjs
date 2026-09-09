import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";
import {
  buildLedgerContributions,
  compareRankingReference,
  createMasterIdentityBySku,
  evaluateMovingCandidate,
  parseSalesLedgerRows,
  rankSalesLedger
} from "./moving-formula-discovery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = path.join(root, ".codex-tmp");
const ledger = JSON.parse(fs.readFileSync(path.join(temp, "formula-discovery-salesledger.json"), "utf8"));
const prior = JSON.parse(fs.readFileSync(path.join(temp, "formula-discovery-results.json"), "utf8"));
const ranking = JSON.parse(fs.readFileSync(path.join(root, "reference-data", "sales-ranking-reference.json"), "utf8"));
const masterPath = process.env.MASTERBARANG_SNAPSHOT;
if (!masterPath) throw new Error("Set MASTERBARANG_SNAPSHOT to the read-only MasterBarang workbook snapshot.");

const workbook = xlsx.readFile(masterPath, { cellDates: false });
const masterSheet = workbook.Sheets.MasterBarang;
if (!masterSheet) throw new Error("MasterBarang sheet missing from supplied workbook snapshot.");
const master = xlsx.utils.sheet_to_json(masterSheet, { defval: "" });
const identities = createMasterIdentityBySku(master);
const ledgerRows = parseSalesLedgerRows(ledger);
const asOfDate = "29/08/2026";
const candidates = [];

for (const allocationMode of ["raw", "expanded"]) {
  const allocation = buildLedgerContributions(ledgerRows, identities, allocationMode);
  for (const grouping of ["sku", "product", "product_color", "product_color_size"]) {
    for (const window of ["7_calendar", "14_calendar", "30_calendar", "31_calendar", "30_business", "all_history"]) {
      for (const measure of ["qty", "order_count"]) {
        for (const statusSet of ["approved", "all"]) {
          const result = evaluateMovingCandidate({
            contributions: allocation.contributions, goldenRows: prior.golden, asOfDate,
            grouping, window, measure, statusSet
          });
          candidates.push({ allocationMode, unresolvedAllocations: allocation.unresolvedAllocations.length, ...result });
        }
      }
    }
  }
}

candidates.sort((left, right) => right.matches - left.matches || left.mismatches.length - right.mismatches.length);
const candidateSummaries = candidates.map((candidate) => ({
  allocationMode: candidate.allocationMode,
  formula: candidate.formula,
  matches: candidate.matches,
  total: candidate.total,
  counts: candidate.counts,
  mismatchSkus: candidate.mismatches.map((row) => row.sku)
}));
const thresholdSweep = [];
const exactAllocation = buildLedgerContributions(ledgerRows, identities, "expanded");
for (let fastThreshold = 1; fastThreshold <= 25; fastThreshold += 1) {
  const candidate = evaluateMovingCandidate({
    contributions: exactAllocation.contributions, goldenRows: prior.golden, asOfDate,
    grouping: "product", window: "31_calendar", measure: "qty", statusSet: "all", fastThreshold
  });
  thresholdSweep.push({ fastThreshold, matches: candidate.matches, mismatchSkus: candidate.mismatches.map((row) => row.sku) });
}
const rankingCandidates = [];
for (const allocationMode of ["raw", "expanded"]) {
  const allocation = buildLedgerContributions(ledgerRows, identities, allocationMode);
  for (const window of ["30_calendar", "31_calendar", "all_history"]) {
    for (const measure of ["qty", "order_count"]) {
      for (const statusSet of ["approved", "all"]) {
        const ranked = rankSalesLedger({ contributions: allocation.contributions, asOfDate, window, measure, statusSet });
        const comparison = compareRankingReference(ranked, ranking.records);
        const validSkus = new Set(ranking.records.filter((row) => row.ValidationStatus === "VALID").map((row) => row.SKU));
        const restricted = ranked.filter((row) => validSkus.has(row.sku)).map((row, index) => ({ ...row, calculatedRank: index + 1 }));
        const restrictedComparison = compareRankingReference(restricted, ranking.records);
        rankingCandidates.push({
          allocationMode, window, measure, statusSet, unresolvedAllocations: allocation.unresolvedAllocations.length,
          ...comparison,
          resolvedUniverseRankMatches: restrictedComparison.resolvedRankMatches,
          resolvedUniverseBothMatches: restrictedComparison.rows.filter((row) => row.quantityMatch && row.resolvedRankMatch).length
        });
      }
    }
  }
}
rankingCandidates.sort((left, right) => right.bothMatches - left.bothMatches || right.quantityMatches - left.quantityMatches || right.rankMatches - left.rankMatches);

const best = candidates[0];
const badzlinRows = ledgerRows.filter((row) => row.rawSku.split(";").map((sku) => sku.trim()).includes("ANS-BAD-HTM-L"));
const result = {
  asOfDate: "2026-08-29",
  ledgerRows: ledgerRows.length,
  masterSkus: identities.size,
  goldenRows: prior.golden.length,
  allocation: {
    raw: buildLedgerContributions(ledgerRows, identities, "raw").unresolvedAllocations,
    expanded: buildLedgerContributions(ledgerRows, identities, "expanded").unresolvedAllocations
  },
  movingCandidates: candidateSummaries,
  thresholdSweep,
  baselineCurrent: candidates.find((candidate) => candidate.allocationMode === "raw" && candidate.formula.grouping === "sku" && candidate.formula.window === "30_calendar" && candidate.formula.measure === "qty" && candidate.formula.statusSet === "approved"),
  rankingCandidates: rankingCandidates.map((candidate) => ({
    allocationMode: candidate.allocationMode, window: candidate.window, measure: candidate.measure, statusSet: candidate.statusSet,
    total: candidate.total, quantityMatches: candidate.quantityMatches, rankMatches: candidate.rankMatches, resolvedRankMatches: candidate.resolvedRankMatches,
    resolvedUniverseRankMatches: candidate.resolvedUniverseRankMatches, bothMatches: candidate.bothMatches, resolvedUniverseBothMatches: candidate.resolvedUniverseBothMatches,
    mismatchSkus: candidate.mismatches.map((row) => row.sku)
  })),
  badzlinTrace: badzlinRows.map((row) => ({ sourceIndex: row.sourceIndex, orderSn: row.orderSn, date: row.rawDate, status: row.status, qty: row.qty, sku: row.rawSku })),
  badzlinBest: best.rows.find((row) => row.sku === "ANS-BAD-HTM-L"),
  rankingBadzlin: rankingCandidates[0].rows.find((row) => row.sku === "ANS-BAD-HTM-L")
};

fs.writeFileSync(path.join(temp, "formula-discovery-v2-results.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.join(temp, "formula-discovery-v2-results.json"),
  bestMoving: result.movingCandidates[0],
  baselineMatches: result.baselineCurrent.matches,
  bestRanking: result.rankingCandidates[0],
  badzlinBest: result.badzlinBest,
  rankingBadzlin: result.rankingBadzlin
}, null, 2));
