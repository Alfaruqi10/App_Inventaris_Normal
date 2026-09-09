import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSheetsClient } from "../config/google.js";
import {
  buildCanonicalRankingDryRun,
  reconcileProductionSetupReference
} from "../../../tools/production-reference-dry-run.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");

function readReference(fileName) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "reference-data", fileName), "utf8"));
}

function rowsToObjects(values) {
  if (!values.length) return [];
  const headers = values[0].map((header) => String(header || "").trim());
  return values.slice(1)
    .filter((row) => row.some((value) => value !== "" && value !== null && value !== undefined))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function readLiveProductionConfiguration() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi.");
  const response = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: "ProductionConfiguration!A1:ZZ"
  });
  return rowsToObjects(response.data.values || []);
}

const setup = readReference("production-setup-reference.json");
const ranking = readReference("sales-ranking-reference.json");
const liveRows = await readLiveProductionConfiguration();
const setupReport = reconcileProductionSetupReference(setup.records, liveRows);
const rankingReport = buildCanonicalRankingDryRun(setup.records, ranking.records);

console.log(JSON.stringify({
  mode: "READ_ONLY_DRY_RUN",
  setup: setupReport,
  ranking: rankingReport,
  badzlin: {
    current: liveRows.find((row) => row.SKU === "ANS-BAD-HTM-L") || null,
    reference: setup.records.find((row) => row.SKU === "ANS-BAD-HTM-L") || null
  }
}, null, 2));
