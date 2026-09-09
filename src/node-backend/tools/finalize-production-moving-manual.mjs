import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSheetsClient } from "../config/google.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");
const spreadsheetId = process.env.SPREADSHEET_ID;
const execute = process.argv.includes("--execute");
const addMovingHeader = process.argv.includes("--add-moving-header");
const sheetName = "ProductionConfiguration";
const requiredHeaders = ["SKU", "MinimumStock", "TargetStock", "MinimumProductionBatch", "Enabled", "Notes", "UpdatedAt", "UpdatedBy"];
const movingHeader = "Moving";

if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi.");

function text(value) { return String(value ?? "").trim(); }
function number(value) {
  const parsed = Number(text(value).replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function columnToA1(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
function rowsToObjects(values) {
  const headers = (values?.[0] || []).map(text);
  return {
    headers,
    rows: (values || []).slice(1).filter((row) => row.some((value) => text(value))).map((row, index) => ({
      _row: index + 2,
      ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]))
    }))
  };
}
function sourceRecords() {
  const source = JSON.parse(fs.readFileSync(path.join(projectRoot, "reference-data", "production-configuration-import-reference.json"), "utf8"));
  const rows = source.records.map((record) => ({
    sku: text(record.SKU),
    moving: text(record.MovingReference).toUpperCase()
  }));
  const distribution = rows.reduce((result, row) => {
    result[row.moving] = (result[row.moving] || 0) + 1;
    return result;
  }, {});
  const invalid = rows.filter((row) => !row.sku || !["FAST", "MIDDLE", "SLOW"].includes(row.moving));
  return { rows, distribution, invalid };
}
function buildPlan(live, source) {
  const headerSet = new Set(live.headers);
  const missingHeaders = requiredHeaders.filter((header) => !headerSet.has(header));
  const hasMovingHeader = headerSet.has(movingHeader);
  const liveBySku = new Map();
  const duplicateSkus = [];
  live.rows.forEach((row) => {
    const sku = text(row.SKU);
    if (!sku) return;
    if (liveBySku.has(sku)) duplicateSkus.push(sku);
    else liveBySku.set(sku, row);
  });
  const sourceBySku = new Map(source.rows.map((row) => [row.sku, row]));
  const missingInLive = source.rows.filter((row) => !liveBySku.has(row.sku)).map((row) => row.sku);
  const extraInLive = [...liveBySku.keys()].filter((sku) => !sourceBySku.has(sku));
  const movingUpdates = [];
  source.rows.forEach((reference) => {
    const current = liveBySku.get(reference.sku);
    if (!current) return;
    const currentMoving = hasMovingHeader ? text(current[movingHeader]).toUpperCase() : "";
    if (currentMoving !== reference.moving) movingUpdates.push({ sku: reference.sku, row: current._row, current: currentMoving, expected: reference.moving });
  });
  const sourceDistributionOk = source.rows.length === 67 && source.distribution.FAST === 15 && source.distribution.MIDDLE === 36 && source.distribution.SLOW === 16;
  const writeAllowed = !missingHeaders.length && hasMovingHeader && !source.invalid.length && sourceDistributionOk && live.rows.length === 67 && !duplicateSkus.length && !missingInLive.length && !extraInLive.length;
  return { sourceRows: source.rows.length, sourceDistribution: source.distribution, sourceInvalid: source.invalid, liveRows: live.rows.length, headers: live.headers, missingHeaders, hasMovingHeader, duplicateSkus, missingInLive, extraInLive, movingUpdates, writeAllowed };
}
function report(mode, plan, verification = null) {
  return { mode, sourceRows: plan.sourceRows, expectedDistribution: plan.sourceDistribution, liveRows: plan.liveRows, headers: plan.headers, hasMovingHeader: plan.hasMovingHeader, missingHeaders: plan.missingHeaders, duplicateSkus: plan.duplicateSkus, missingInLive: plan.missingInLive, extraInLive: plan.extraInLive, movingUpdates: plan.movingUpdates, writeAllowed: plan.writeAllowed, verification };
}

const source = sourceRecords();
const sheets = getSheetsClient();
const beforeResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:ZZ` });
const before = rowsToObjects(beforeResponse.data.values || []);
const plan = buildPlan(before, source);

if (addMovingHeader) {
  const headerWriteAllowed = !plan.missingHeaders.length && !plan.sourceInvalid.length && plan.liveRows === 67 && !plan.duplicateSkus.length && !plan.missingInLive.length && !plan.extraInLive.length;
  if (plan.hasMovingHeader || !headerWriteAllowed) {
    console.log(JSON.stringify(report("HEADER_ADD_ABORTED", plan), null, 2));
    process.exitCode = 2;
  } else {
    const headerColumn = columnToA1(before.headers.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${headerColumn}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[movingHeader]] }
    });
    const afterResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:ZZ` });
    const after = rowsToObjects(afterResponse.data.values || []);
    const afterBySku = new Map(after.rows.map((row) => [text(row.SKU), row]));
    const fieldChanges = before.rows.flatMap((row) => {
      const afterRow = afterBySku.get(text(row.SKU));
      if (!afterRow) return [{ sku: text(row.SKU), field: "ROW", before: "present", after: "missing" }];
      return before.headers.filter((header) => text(row[header]) !== text(afterRow[header])).map((header) => ({ sku: text(row.SKU), field: header, before: row[header], after: afterRow[header] }));
    });
    const afterPlan = buildPlan(after, source);
    const verification = { headerAdded: after.headers.includes(movingHeader), fieldChanges, rowsReadBack: after.rows.length, exactVerificationPassed: afterPlan.hasMovingHeader && after.rows.length === 67 && fieldChanges.length === 0 };
    if (!verification.exactVerificationPassed) throw new Error(`Header verification failed: ${JSON.stringify(verification)}`);
    console.log(JSON.stringify(report("HEADER_ADDED", afterPlan, verification), null, 2));
  }
} else if (!plan.writeAllowed || !execute) {
  console.log(JSON.stringify(report(execute ? "ABORTED" : "READ_ONLY_DRY_RUN", plan), null, 2));
  if (execute && !plan.writeAllowed) process.exitCode = 2;
} else {
  const movingColumn = before.headers.indexOf(movingHeader);
  const updates = plan.movingUpdates.map((update) => ({ range: `${sheetName}!${columnToA1(movingColumn)}${update.row}`, values: [[update.expected]] }));
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates } });
  }
  const afterResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:ZZ` });
  const after = rowsToObjects(afterResponse.data.values || []);
  const afterPlan = buildPlan(after, source);
  const afterBySku = new Map(after.rows.map((row) => [text(row.SKU), row]));
  const untouchedFields = before.headers.filter((header) => header !== movingHeader);
  const fieldChangesOutsideMoving = before.rows.flatMap((row) => {
    const afterRow = afterBySku.get(text(row.SKU));
    if (!afterRow) return [{ sku: text(row.SKU), field: "ROW", before: "present", after: "missing" }];
    return untouchedFields.filter((header) => text(row[header]) !== text(afterRow[header])).map((header) => ({ sku: text(row.SKU), field: header, before: row[header], after: afterRow[header] }));
  });
  const movingMismatches = source.rows.flatMap((reference) => {
    const row = afterBySku.get(reference.sku);
    return !row || text(row[movingHeader]).toUpperCase() !== reference.moving ? [{ sku: reference.sku, current: row ? row[movingHeader] : "", expected: reference.moving }] : [];
  });
  const verification = { rowsWritten: updates.length, rowsReadBack: after.rows.length, movingMismatches, fieldChangesOutsideMoving, exactVerificationPassed: afterPlan.writeAllowed && movingMismatches.length === 0 && fieldChangesOutsideMoving.length === 0 };
  if (!verification.exactVerificationPassed) throw new Error(`Post-write verification failed: ${JSON.stringify(verification)}`);
  console.log(JSON.stringify(report("CONTROLLED_EXECUTE", plan, verification), null, 2));
}
