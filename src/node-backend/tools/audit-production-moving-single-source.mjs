import { getSheetsClient } from "../config/google.js";

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi.");

const sampleSkus = [
  "ANS-BAD-HTM-L", "ANS-BAD-HTM-M", "ANS-BAD-HTM-S", "ANS-EMA-HTM-L",
  "ANS-AZO-HTM-L", "ANS-AZO-HTM-M", "ANS-AZO-HTM-S", "ANS-IRI-HTM-M",
  "ANS-NOI-HTR-XL", "ANS-NOI-HNV-XL", "ANS-IVY-HTM-XXL"
];

function text(value) { return String(value ?? "").trim(); }
function rowsToObjects(values) {
  const headers = (values?.[0] || []).map(text);
  return (values || []).slice(1).filter((row) => row.some((value) => text(value))).map((row, index) => ({
    _row: index + 2,
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]))
  }));
}
function normalizedMoving(value) { return text(value).toUpperCase(); }
function latest(rows) {
  return rows.slice().sort((a, b) => b._row - a._row)[0] || null;
}
function snapshot(row, fields) {
  if (!row) return null;
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? ""]));
}

const sheets = getSheetsClient();
const response = await sheets.spreadsheets.values.batchGet({
  spreadsheetId,
  ranges: [
    "ProductionConfiguration!A1:ZZ",
    "StockAlerts!A1:ZZ",
    "ProductionQueue!A1:ZZ"
  ]
});

const [configurationRows, alertRows, queueRows] = response.data.valueRanges.map((range) => rowsToObjects(range.values || []));
const configBySku = new Map(configurationRows.map((row) => [text(row.SKU), row]));
const alertBySku = new Map();
const queueBySku = new Map();
alertRows.forEach((row) => {
  const sku = text(row.SKU);
  if (!sku) return;
  const current = alertBySku.get(sku) || [];
  current.push(row);
  alertBySku.set(sku, current);
});
queueRows.forEach((row) => {
  const sku = text(row.SKU);
  if (!sku) return;
  const current = queueBySku.get(sku) || [];
  current.push(row);
  queueBySku.set(sku, current);
});

const distribution = configurationRows.reduce((counts, row) => {
  const moving = normalizedMoving(row.Moving);
  if (moving) counts[moving] = (counts[moving] || 0) + 1;
  return counts;
}, {});

const samples = sampleSkus.map((sku) => {
  const config = configBySku.get(sku) || null;
  const alert = latest(alertBySku.get(sku) || []);
  const queue = latest(queueBySku.get(sku) || []);
  const configMoving = normalizedMoving(config?.Moving);
  const alertMoving = normalizedMoving(alert?.MovingStat);
  const queueMoving = normalizedMoving(queue?.MovingStat);
  return {
    sku,
    config: snapshot(config, ["SKU", "MinimumStock", "TargetStock", "MinimumProductionBatch", "Moving", "Enabled", "UpdatedAt"]),
    latestAlert: snapshot(alert, ["AlertID", "Status", "MovingStat", "LastEvaluatedAt", "FirstDetectedAt"]),
    latestQueue: snapshot(queue, ["QueueID", "Status", "MovingStat", "CreatedAt", "UpdatedAt"]),
    comparison: {
      configMoving,
      alertMoving: alertMoving || null,
      queueMoving: queueMoving || null,
      alertMatchesConfig: !alert || alertMoving === configMoving,
      queueMatchesConfig: !queue || queueMoving === configMoving
    }
  };
});

const mismatches = samples.filter((sample) => !sample.comparison.alertMatchesConfig || !sample.comparison.queueMatchesConfig);
console.log(JSON.stringify({
  mode: "READ_ONLY",
  sheetsRead: ["ProductionConfiguration", "StockAlerts", "ProductionQueue"],
  configuration: { rows: configurationRows.length, movingDistribution: distribution },
  samples,
  mismatchCount: mismatches.length,
  mismatches
}, null, 2));
