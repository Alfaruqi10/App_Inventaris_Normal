import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSheetsClient } from "../config/google.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");
const spreadsheetId = process.env.SPREADSHEET_ID;
const asOfArgument = process.argv.find((argument) => argument.startsWith("--as-of="));
const asOfDate = asOfArgument ? asOfArgument.slice("--as-of=".length) : new Date().toISOString().slice(0, 10);
const validStatuses = new Set(["PROCESSED", "READY_TO_SHIP", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"]);

if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error("--as-of harus YYYY-MM-DD.");

function rowsToObjects(values) {
  if (!values?.length) return [];
  const headers = values[0].map((header) => String(header ?? "").trim());
  return values.slice(1)
    .filter((row) => row.some((value) => value !== "" && value !== null && value !== undefined))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function text(value) {
  return String(value ?? "").trim();
}

function dateKey(value) {
  const source = text(value);
  const iso = source.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const indonesian = source.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return indonesian ? `${indonesian[3]}-${indonesian[2]}-${indonesian[1]}` : "";
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function movingFromUnits(units) {
  if (units >= 16) return "FAST";
  if (units >= 1) return "MIDDLE";
  return "SLOW";
}

const reference = JSON.parse(fs.readFileSync(path.join(projectRoot, "reference-data", "production-configuration-import-reference.json"), "utf8"));
const sheets = getSheetsClient();
const response = await sheets.spreadsheets.values.batchGet({
  spreadsheetId,
  ranges: ["ProductionConfiguration!A1:ZZ", "SalesLedger!A1:ZZ"]
});
const [configurationRows, ledgerRows] = (response.data.valueRanges || []).map((entry) => rowsToObjects(entry.values || []));
const startDate = addDays(asOfDate, -29);
const unitsBySku = new Map();

for (const row of ledgerRows) {
  const orderDate = dateKey(row["Tanggal Order"] || row.OrderDate || row["Waktu Pesanan"]);
  const status = text(row["Status Shopee"] || row.StatusShopee || row.Status).toUpperCase();
  const sku = text(row["SKU Inventaris"] || row["SKU Shopee"] || row.SKU);
  const qty = number(row.Qty ?? row.Quantity);
  if (!sku || qty === null || !orderDate || !validStatuses.has(status) || orderDate < startDate || orderDate > asOfDate) continue;
  unitsBySku.set(sku, (unitsBySku.get(sku) || 0) + qty);
}

const configurationBySku = new Map(configurationRows.map((row) => [text(row.SKU), row]));
const reportRows = reference.records.map((referenceRow) => {
  const sku = text(referenceRow.SKU);
  const configuration = configurationBySku.get(sku) || null;
  const configuredMoving = text(configuration?.Moving);
  const source = text(configuration?.MovingSource).toUpperCase() || "CALCULATED";
  const units30d = unitsBySku.get(sku) || 0;
  const calculatedMoving = movingFromUnits(units30d);
  const finalMoving = source === "MANUAL" && ["FAST", "MIDDLE", "SLOW"].includes(configuredMoving) ? configuredMoving : calculatedMoving;
  return { sku, calculatedMoving, configuredMoving, movingSource: source, finalMoving, units30d };
});

if (reportRows.some((row) => !row.sku)) throw new Error("Reference ProductionConfiguration memiliki SKU kosong.");

const summary = reportRows.reduce((accumulator, row) => {
  accumulator.bySource[row.movingSource] = (accumulator.bySource[row.movingSource] || 0) + 1;
  accumulator.byCalculated[row.calculatedMoving] = (accumulator.byCalculated[row.calculatedMoving] || 0) + 1;
  accumulator.manualOverrides += row.movingSource === "MANUAL" ? 1 : 0;
  return accumulator;
}, { rows: reportRows.length, bySource: {}, byCalculated: {}, manualOverrides: 0 });

console.log(JSON.stringify({
  mode: "READ_ONLY_DRY_RUN",
  asOfDate,
  startDate,
  configurationRows: configurationRows.length,
  summary,
  rows: reportRows
}, null, 2));
