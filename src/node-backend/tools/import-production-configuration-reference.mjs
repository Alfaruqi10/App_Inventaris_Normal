import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSheetsClient } from "../config/google.js";
import {
  buildImportRows,
  configurationValues,
  planProductionConfigurationImport,
  rowsToObjects
} from "../../../tools/production-configuration-import.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");
const execute = process.argv.includes("--execute");
const spreadsheetId = process.env.SPREADSHEET_ID;

if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi.");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function buildReport(source, plan, verification = null) {
  return {
    mode: execute ? "CONTROLLED_EXECUTE" : "READ_ONLY_DRY_RUN",
    sourceRows: source.records.length,
    existingConfigurationRows: plan.existingRows,
    inserts: plan.inserts.length,
    updates: plan.updates.length,
    duplicateSkus: plan.duplicateSkus,
    validationErrors: plan.invalidReference.map((row) => ({ sku: row.sku, validation: row.validation })),
    writeAllowed: plan.writeAllowed,
    verification
  };
}

const source = readJson("reference-data/production-configuration-import-reference.json");
const setup = readJson("reference-data/production-setup-reference.json");
const sheets = getSheetsClient();
const [masterResponse, configurationResponse] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId, range: "MasterBarang!A1:ZZ" }),
  sheets.spreadsheets.values.get({ spreadsheetId, range: "ProductionConfiguration!A1:ZZ" })
]);
const master = rowsToObjects(masterResponse.data.values || []);
const configuration = rowsToObjects(configurationResponse.data.values || []);
const built = buildImportRows(source.records, setup.records, master.rows);
const plan = planProductionConfigurationImport({
  referenceRecords: built.records,
  existingRows: configuration.rows,
  headers: configuration.headers
});

if (built.errors.length) throw new Error(`MasterBarang duplicate SKU: ${built.errors.map((error) => error.sku).join(", ")}`);
if (!plan.writeAllowed) {
  console.log(JSON.stringify(buildReport(source, plan), null, 2));
  process.exitCode = 2;
} else if (!execute) {
  console.log(JSON.stringify(buildReport(source, plan), null, 2));
} else {
  // This approved execution is intentionally insert-only: the preflight requires an empty live sheet.
  if (plan.existingRows !== 0 || plan.inserts.length !== 67 || plan.updates.length !== 0) {
    throw new Error("Execution aborted: live ProductionConfiguration is no longer the approved empty 67-insert state.");
  }
  const executedAt = new Date().toISOString();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [{
        range: "ProductionConfiguration!A2:H68",
        values: configurationValues(plan.inserts, executedAt, "CONTROLLED_PRODUCTION_CONFIGURATION_IMPORT")
      }]
    }
  });

  const readBackResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: "ProductionConfiguration!A1:ZZ" });
  const readBack = rowsToObjects(readBackResponse.data.values || []);
  const readBackPlan = planProductionConfigurationImport({
    referenceRecords: built.records,
    existingRows: readBack.rows,
    headers: readBack.headers
  });
  const bySku = new Map(readBack.rows.map((row) => [String(row.SKU || "").trim(), row]));
  const mismatches = built.records.flatMap((record) => {
    const row = bySku.get(record.sku);
    const errors = [];
    if (!row) errors.push("MISSING_AFTER_WRITE");
    else {
      if (Number(row.MinimumStock) !== record.minimumStock) errors.push("MINIMUM_MISMATCH");
      if (Number(row.TargetStock) !== record.targetStock) errors.push("TARGET_MISMATCH");
      if (Number(row.MinimumProductionBatch) !== record.minimumProductionBatch) errors.push("BATCH_MISMATCH");
    }
    return errors.length ? [{ sku: record.sku, errors }] : [];
  });
  const verification = {
    rows: readBack.rows.length,
    uniqueSkus: new Set(readBack.rows.map((row) => String(row.SKU || "").trim())).size,
    duplicateSkus: readBackPlan.duplicateSkus,
    mismatches,
    exactVerificationPassed: readBack.rows.length === 67 && !readBackPlan.duplicateSkus.length && !mismatches.length
  };
  if (!verification.exactVerificationPassed) throw new Error(`Post-write verification failed: ${JSON.stringify(verification)}`);
  console.log(JSON.stringify(buildReport(source, plan, verification), null, 2));
}
