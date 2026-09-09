import { getSheetsClient } from "../config/google.js";

const spreadsheetId = process.env.SPREADSHEET_ID;
const webAppUrl = process.env.OLD_GAS_WEB_APP_URL;
if (!spreadsheetId || !webAppUrl) throw new Error("SPREADSHEET_ID atau OLD_GAS_WEB_APP_URL belum dikonfigurasi.");

function text(value) { return String(value ?? "").trim(); }
function rowsToObjects(values) {
  const headers = (values?.[0] || []).map(text);
  return (values || []).slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}
function pickAdmin(rows) {
  const emailKey = ["Email", "email", "User Email", "Email User"].find((key) => rows.some((row) => text(row[key])));
  const roleKey = ["Role", "Peran", "role"].find((key) => rows.some((row) => text(row[key])));
  if (!emailKey) throw new Error("Kolom email Users tidak ditemukan.");
  const candidate = rows.find((row) => /^(OWNER|ADMIN)$/i.test(text(row[roleKey])) && text(row[emailKey]));
  if (!candidate) throw new Error("Admin/Owner aktif untuk smoke test tidak ditemukan.");
  return text(candidate[emailKey]);
}
async function call(action, callerEmail) {
  const response = await fetch(webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, callerEmail, page: 1, pageSize: 100 })
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 1000) }; }
  return { httpStatus: response.status, body };
}

const sheets = getSheetsClient();
const usersResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Users!A1:ZZ" });
const callerEmail = pickAdmin(rowsToObjects(usersResponse.data.values || []));
const [configurations, dashboard] = await Promise.all([
  call("getProductionConfigurations", callerEmail),
  call("getStockProductionDashboard", callerEmail)
]);

const configs = configurations.body?.rows || [];
const items = dashboard.body?.items || [];
const samples = [
  "ANS-BAD-HTM-L", "ANS-BAD-HTM-M", "ANS-EMA-HTM-L", "ANS-AZO-HTM-S",
  "ANS-IRI-HTM-M", "ANS-NOI-HTR-XL", "ANS-NOI-HNV-XL", "ANS-IVY-HTM-XXL"
];
const configBySku = new Map(configs.map((row) => [text(row.sku), row]));
const itemBySku = new Map(items.map((row) => [text(row.sku), row]));
const sampleResults = samples.map((sku) => ({
  sku,
  configurationMoving: configBySku.get(sku)?.moving ?? null,
  evaluatorMoving: itemBySku.get(sku)?.movingStat ?? null,
  evaluatorPresent: itemBySku.has(sku),
  active: itemBySku.get(sku)?.activeProduction ?? false
}));

console.log(JSON.stringify({
  mode: "READ_ONLY",
  webAppUrl: webAppUrl.replace(/\/macros\/s\/[^/]+\//, "/macros/s/[existing]/"),
  configurations: { httpStatus: configurations.httpStatus, status: configurations.body?.status, total: configurations.body?.total ?? null },
  dashboard: { httpStatus: dashboard.httpStatus, status: dashboard.body?.status, total: dashboard.body?.total ?? null, activeItemsReturned: items.length },
  sampleResults,
  limitation: "Dashboard route returns active items only; inactive SKU evaluator rows are not exposed by the current public route."
}, null, 2));
