import { getSheetsClient } from "../config/google.js";

const spreadsheetId = process.env.SPREADSHEET_ID;
const webAppUrl = process.env.OLD_GAS_WEB_APP_URL;
if (!spreadsheetId || !webAppUrl) throw new Error("SPREADSHEET_ID atau OLD_GAS_WEB_APP_URL belum dikonfigurasi.");

function text(value) { return String(value ?? "").trim(); }
function rowsToObjects(values) {
  const headers = (values?.[0] || []).map(text);
  return (values || []).slice(1).filter((row) => row.some((value) => text(value))).map((row, index) => ({
    _row: index + 2,
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]))
  }));
}
function latestBySku(rows) {
  const result = new Map();
  rows.forEach((row) => {
    const sku = text(row.SKU);
    if (!sku || !result.has(sku) || row._row > result.get(sku)._row) result.set(sku, row);
  });
  return result;
}
function movingCounts(rows, field) {
  return rows.reduce((counts, row) => {
    const value = text(row[field]).toUpperCase();
    if (["FAST", "MIDDLE", "SLOW"].includes(value)) counts[value] += 1;
    return counts;
  }, { FAST: 0, MIDDLE: 0, SLOW: 0 });
}
async function call(action, callerEmail) {
  const response = await fetch(webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, callerEmail, page: 1, pageSize: 100 })
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { status: "invalid_json" }; }
  return { httpStatus: response.status, body };
}

const sheets = getSheetsClient();
const response = await sheets.spreadsheets.values.batchGet({
  spreadsheetId,
  ranges: ["ProductionConfiguration!A1:ZZ", "MasterBarang!A1:ZZ", "StockAlerts!A1:ZZ", "ProductionQueue!A1:ZZ", "TelegramQueue!A1:ZZ"]
});
const [configRows, masterRows, alertRows, queueRows, telegramRows] = response.data.valueRanges.map((range) => rowsToObjects(range.values || []));
const configs = latestBySku(configRows);
const masterBySku = new Map(masterRows.map((row) => [text(row["Kode Barang"]), row]));
const alerts = latestBySku(alertRows);
const queues = latestBySku(queueRows);
const emailResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Users!A1:ZZ" });
const users = rowsToObjects(emailResponse.data.values || []);
const emailKey = ["Email", "email", "User Email", "Email User"].find((key) => users.some((row) => text(row[key])));
const roleKey = ["Role", "Peran", "role"].find((key) => users.some((row) => text(row[key])));
const admin = users.find((row) => /^(OWNER|ADMIN)$/i.test(text(row[roleKey])) && text(row[emailKey]));
if (!admin) throw new Error("Admin/Owner tidak ditemukan.");
const runtime = await call("getStockProductionDashboard", text(admin[emailKey]));
const runtimeItems = runtime.body?.items || [];
const runtimeBySku = new Map(runtimeItems.map((row) => [text(row.sku), row]));

const matrix = [...configs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sku, config]) => {
  const evaluator = runtimeBySku.get(sku);
  const alert = alerts.get(sku);
  const queue = queues.get(sku);
  const configMoving = text(config.Moving).toUpperCase() || null;
  const evaluatorMoving = evaluator ? text(evaluator.movingStat).toUpperCase() : null;
  const alertMoving = alert ? text(alert.MovingStat).toUpperCase() || null : null;
  const queueMoving = queue ? text(queue.MovingStat).toUpperCase() || null : null;
  const evaluatorResult = evaluator ? (evaluatorMoving === configMoving ? "PASS" : "FAIL") : "NOT_EXPOSED_INACTIVE";
  const alertResult = alert ? (alertMoving === configMoving ? "MATCH" : "STALE_MISMATCH") : "NO_SNAPSHOT";
  const queueResult = queue ? (queueMoving === configMoving ? "MATCH" : "STALE_MISMATCH") : "NO_SNAPSHOT";
  return {
    sku,
    product: text(masterBySku.get(sku)?.["Nama Barang"] || config.Product || config.ProductName || ""),
    config: configMoving,
    evaluator: evaluatorMoving,
    alert: alertMoving,
    queue: queueMoving,
    telegram: "NOT_AVAILABLE_PER_SKU",
    result: evaluatorResult === "FAIL" || alertResult === "STALE_MISMATCH" || queueResult === "STALE_MISMATCH" ? "FAIL_OR_STALE" : evaluatorResult,
    evaluatorResult,
    alertResult,
    queueResult,
    alertStatus: text(alert?.Status) || null,
    queueStatus: text(queue?.Status) || null
  };
});

const telegramMovingCounts = telegramRows.reduce((counts, row) => {
  const payload = Object.values(row).map(text).join(" ").toUpperCase();
  ["FAST", "MIDDLE", "SLOW"].forEach((moving) => { if (payload.includes(moving)) counts[moving] += 1; });
  return counts;
}, { FAST: 0, MIDDLE: 0, SLOW: 0 });
const summary = {
  totalSku: matrix.length,
  configEvaluator: { pass: matrix.filter((row) => row.evaluatorResult === "PASS").length, fail: matrix.filter((row) => row.evaluatorResult === "FAIL").length, notExposedInactive: matrix.filter((row) => row.evaluatorResult === "NOT_EXPOSED_INACTIVE").length },
  configAlert: { match: matrix.filter((row) => row.alertResult === "MATCH").length, staleMismatch: matrix.filter((row) => row.alertResult === "STALE_MISMATCH").length, noSnapshot: matrix.filter((row) => row.alertResult === "NO_SNAPSHOT").length },
  configQueue: { match: matrix.filter((row) => row.queueResult === "MATCH").length, staleMismatch: matrix.filter((row) => row.queueResult === "STALE_MISMATCH").length, noSnapshot: matrix.filter((row) => row.queueResult === "NO_SNAPSHOT").length },
  evaluatorMismatches: matrix.filter((row) => row.evaluatorResult === "FAIL").map((row) => row.sku),
  alertStale: matrix.filter((row) => row.alertResult === "STALE_MISMATCH").map((row) => row.sku),
  queueStale: matrix.filter((row) => row.queueResult === "STALE_MISMATCH").map((row) => row.sku),
  inactiveNotExposed: matrix.filter((row) => row.evaluatorResult === "NOT_EXPOSED_INACTIVE").map((row) => row.sku)
};
if (process.argv.includes("--compact")) {
  console.log(matrix.map((row) => [row.sku, row.product, row.config, row.evaluator || "NOT_EXPOSED_INACTIVE", row.alert || "-", row.queue || "-", row.telegram, row.result].join(" | ")).join("\n"));
} else console.log(JSON.stringify({
  mode: "READ_ONLY",
  configuration: { total: configRows.length, counts: movingCounts(configRows, "Moving") },
  evaluatorRoute: { httpStatus: runtime.httpStatus, status: runtime.body?.status, activeItemsReturned: runtimeItems.length, total: runtime.body?.total ?? null, counts: movingCounts(runtimeItems, "movingStat") },
  persistedAlert: { total: alertRows.length, counts: movingCounts(alertRows, "MovingStat") },
  persistedQueue: { total: queueRows.length, counts: movingCounts(queueRows, "MovingStat") },
  telegram: { rows: telegramRows.length, movingTokenCounts: telegramMovingCounts, perSkuMapping: "UNAVAILABLE because formatter payload does not include SKU" },
  summary,
  matrix
}, null, 2));
