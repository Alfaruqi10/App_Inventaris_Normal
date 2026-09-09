import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "src/backend/ShopeeAds/core/AdsEngine.gs");
const databasePath = path.join(root, "src/backend/ShopeeAds/core/AdsDatabase.gs");
const backendPath = path.join(root, "src/backend/code.gs");
const analyticsApiPath = path.join(root, "src/backend/BusinessAnalytics/api/AnalyticsAPI.gs");
const engineSource = fs.readFileSync(enginePath, "utf8");
const databaseSource = fs.readFileSync(databasePath, "utf8");
const backendSource = fs.readFileSync(backendPath, "utf8");
const analyticsApiSource = fs.readFileSync(analyticsApiPath, "utf8");

const context = vm.createContext({
  console,
  Logger: { log() {} },
  FEATURE_FLAGS: undefined,
  parseAdsDateToISO(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  },
  normalizeDateToISO(value) {
    return String(value || "").trim();
  }
});
vm.runInContext(databaseSource, context, { filename: databasePath });
vm.runInContext(engineSource, context, { filename: enginePath });

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const baseRow = () => [
  "2026-08-01", "479360465", "Campaign", "Individual", "289104821", "Product",
  "ongoing", 100, 10, "10.00%", 10000, 0, 0, 0, "0.00", 1000, "0.00%", 100000
];

function incomingFromApi(rawSales) {
  const parsed = context.parseAdsCampaignSales(rawSales);
  const row = baseRow();
  row[11] = parsed.available ? parsed.value : 0;
  if (!parsed.available) row._preserveSales = true;
  return row;
}

function merge(oldSales, rawSales) {
  const existing = baseRow();
  existing[11] = oldSales;
  return context.prepareAdsDailyRowForUpsert(existing, incomingFromApi(rawSales));
}

test("explicit API zero overwrites old Sales", () => {
  const result = merge(150000, 0);
  assert.equal(result.row[11], 0);
  assert.equal(result.salesPreserved, false);
});

test("positive API Sales is preserved exactly", () => {
  assert.equal(merge(0, 145485).row[11], 145485);
});

test("missing broad_gmv preserves old Sales", () => {
  const result = merge(145485, undefined);
  assert.equal(result.row[11], 145485);
  assert.equal(result.salesPreserved, true);
});

test("null broad_gmv preserves old Sales", () => {
  assert.equal(merge(145485, null).row[11], 145485);
});

test("invalid broad_gmv preserves old Sales", () => {
  assert.equal(merge(145485, "INVALID").row[11], 145485);
});

test("negative API Sales follows the API value", () => {
  assert.equal(merge(145485, -250).row[11], -250);
});

test("new row with unavailable Sales is not written as zero", () => {
  const result = context.prepareAdsDailyRowForUpsert(null, incomingFromApi(undefined));
  assert.equal(result.shouldWrite, false);
});

test("Ads_Report passes through Ads_Product_Daily Sales", () => {
  const start = engineSource.indexOf("function rebuildAdsReport(");
  const end = engineSource.indexOf("// FIX-B:", start);
  const rebuildSource = engineSource.slice(start, end);
  assert.match(rebuildSource, /var sales = cleanNumericValue\(perf\.sales\)/);
  assert.doesNotMatch(rebuildSource, /normalizeAdsSalesToHundred\(perf\.sales\)/);
  assert.equal(Number(145485), 145485);
});

test("official GMS fields map to Automatic Orders, SoldQty, Sales, and Spend", () => {
  const parsed = context.parseAdsGmsCampaignPerformance({
    httpStatus: 200,
    body: {
      error: "",
      response: {
        campaign_id: 987654321,
        report: { broad_order: 14, broad_order_amount: 16, broad_gmv: 5765250, expense: 475139 }
      }
    }
  }, "08-08-2026");
  assert.equal(parsed.apiStatus, "API_SUCCESS");
  assert.equal(parsed.campaignId, "987654321");
  assert.equal(parsed.orders.value, 14);
  assert.equal(parsed.soldQty.value, 16);
  assert.equal(parsed.sales.value, 5765250);
  assert.equal(parsed.spend.value, 475139);
});

test("explicit GMS zero remains available zero", () => {
  const zero = context.parseAdsGmsMetric(0);
  assert.equal(zero.available, true);
  assert.equal(zero.value, 0);
  assert.equal(zero.classification, "EXPLICIT_ZERO");
});

test("missing, null, and invalid GMS fields remain unavailable", () => {
  [undefined, null, "", "INVALID"].forEach(value => {
    const parsed = context.parseAdsGmsMetric(value);
    assert.equal(parsed.available, false);
    assert.equal(parsed.value, null);
  });
});

test("GMS API errors never produce fake Automatic metrics", () => {
  const parsed = context.parseAdsGmsCampaignPerformance({
    httpStatus: 403,
    body: { error: "ads_error_not_whitelisted_for_product_gms", message: "Not whitelisted" }
  }, "08-08-2026");
  assert.equal(parsed.apiStatus, "API_ERROR");
  assert.equal(parsed.orders.available, false);
  assert.equal(parsed.soldQty.available, false);
  assert.equal(parsed.sales.available, false);
  assert.equal(parsed.spend.available, false);
});

test("Automatic report GMS branch uses official attribution and no shop-total residual", () => {
  const start = engineSource.indexOf("function rebuildAdsReport(");
  const end = engineSource.indexOf("// FIX-B:", start);
  const rebuildSource = engineSource.slice(start, end);
  assert.match(rebuildSource, /gmsPerf && gmsPerf\.orders\.available/);
  assert.match(rebuildSource, /gmsPerf && gmsPerf\.soldQty\.available/);
  assert.match(rebuildSource, /gmsPerf && gmsPerf\.sales\.available/);
  assert.match(rebuildSource, /gmsPerf && gmsPerf\.spend\.available/);
  const gmsBranchStart = rebuildSource.indexOf("// Official GMS attribution");
  const gmsBranch = rebuildSource.slice(gmsBranchStart);
  assert.ok(gmsBranchStart > 0);
  assert.doesNotMatch(gmsBranch, /calculateAdsAutomaticSalesResidual|st\.sales\s*-\s*sumIndSales|st\.orders\s*-\s*sumIndOrders|st\.soldQty\s*-\s*sumIndSoldQty/);
  assert.match(rebuildSource, /if \(c\.jenisIklan === "Otomatis"\) return/);
});

test("GMS campaign fetch discovers campaign ID and never hardcodes identifiers", () => {
  const source = functionBody(engineSource, "fetchAdsGmsCampaignPerformance", "fetchAdsGmsDailyPerformanceMap");
  assert.match(source, /get_gms_campaign_performance/);
  assert.match(source, /start_date:\s*dateStr/);
  assert.match(source, /end_date:\s*dateStr/);
  assert.doesNotMatch(source, /campaign_id\s*:/);
  assert.doesNotMatch(source, /477341094|CampaignID\s*=\s*1|CampaignID\s*=\s*"auto"/);
});

test("legacy shifted layout is detected without a ShopID special case", () => {
  const shifted = [
    "2026-08-01", "123456789", "479360465", "Individual", "Product Name", "0",
    "0", "0", "0", "0.00%", "0", "5.70%", "0", "0.00", "0", "0.00%",
    "2026-08-01", "Shopee Ads API"
  ];
  const result = context.validateAdsDailyRow(shifted);
  assert.equal(result.valid, false);
  assert.equal(result.failedRule, "RULE_LEGACY_LAYOUT_SHIFT");
  const purgeStart = engineSource.indexOf("function purgeInvalidAdsProductDailyRows()");
  const purgeEnd = engineSource.indexOf("// PHASE 1:", purgeStart);
  assert.match(engineSource.slice(purgeStart, purgeEnd), /validateAdsDailyRow\(row\)/);
});

test("invalid short CampaignID is rejected", () => {
  const row = incomingFromApi(1000);
  row[1] = "123";
  const result = context.validateAdsDailyRow(row);
  assert.equal(result.valid, false);
  assert.equal(result.failedRule, "RULE_INVALID_CAMPAIGN_ID");
});

test("valid existing Ads row remains accepted", () => {
  const result = context.validateAdsDailyRow(incomingFromApi(145485));
  assert.equal(result.valid, true);
  assert.equal(result.normalizedRow[11], 145485);
});

test("Ads sheet schemas remain unchanged", () => {
  assert.equal(context.ADS_PRODUCT_DAILY_HEADERS.length, 18);
  assert.equal(context.ADS_REPORT_HEADERS.length, 18);
  assert.equal(context.ADS_CAMPAIGN_HEADERS.length, 12);
  assert.deepEqual(
    Array.from(context.ADS_PRODUCT_DAILY_HEADERS),
    Array.from(context.ADS_REPORT_HEADERS)
  );
});

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("Phase 2 coverage preview has a read-only call graph", () => {
  const source = functionBody(
    engineSource,
    "previewAdsDataRepairPhase2",
    "previewAdsHistoricalReconstruction"
  );
  const prohibited = [
    "setValues", "appendRow", "deleteRow", "deleteRows", "clearContent", "clearContents",
    "clear", "insertRow", "insertRows", "syncAdsHistoricalRange",
    "purgeInvalidAdsProductDailyRows", "rebuildAdsReport", "executeAdsDataRepairPhase1",
    "ensureAdsDatabase"
  ];
  prohibited.forEach((name) => assert.doesNotMatch(source, new RegExp(`\\b${name}\\s*\\(`)));
  assert.match(source, /previewAdsDataRepairPhase1\(\)/);
  assert.match(source, /apiStatus:\s*"NOT_CHECKED"/);
});

test("historical reconstruction preview is API-only and read-only", () => {
  const source = functionBody(
    engineSource,
    "previewAdsHistoricalReconstruction",
    "backupAdsSheetsWithTimestamp"
  );
  const prohibited = [
    "setValues", "appendRow", "deleteRow", "deleteRows", "clearContent", "clearContents",
    "clear", "insertRow", "insertRows", "syncAdsHistoricalRange",
    "purgeInvalidAdsProductDailyRows", "rebuildAdsReport", "executeAdsDataRepairPhase1",
    "ensureAdsDatabase", "writeAdsSheetRowsIdempotent", "upsertAdsProductDailyIdempotent"
  ];
  prohibited.forEach((name) => assert.doesNotMatch(source, new RegExp(`\\b${name}\\s*\\(`)));
  assert.match(source, /shopeeGet\("\/api\/v2\/ads\/get_product_campaign_daily_performance"/);
  assert.match(source, /parseAdsCampaignSales\(metric && metric\.broad_gmv\)/);
  assert.doesNotMatch(source, /get_all_cpc_ads_daily_performance/);
  assert.doesNotMatch(source, /Shop Total|sumIndSales|remainder/i);
});

test("GAS connectivity probe returns before every mutating or external operation", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase2ConnectivityProbe")', doPostStart);
  const probeEnd = backendSource.indexOf("// Read-only, fixed-scope Shopee probe", probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.notEqual(doPostStart, -1);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /doPostReached:\s*true/);
  assert.match(probeSource, /layer:\s*"GAS_WEB_APP"/);
  assert.doesNotMatch(
    probeSource,
    /SpreadsheetApp|PropertiesService|CacheService|UrlFetchApp|shopeeGet|ensureDatabase|setValues|appendRow|deleteRow|clearContent/
  );
});

test("Phase 2D Shopee probe is fixed-scope, read-only, and precedes database initialization", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase2ShopeeAdsProbe")', doPostStart);
  const probeEnd = backendSource.indexOf("// ── Telegram Webhook", probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /shopeeGet\(probePath/);
  assert.match(probeSource, /get_product_campaign_daily_performance/);
  assert.match(probeSource, /probeCampaignId = "479360465"/);
  assert.match(probeSource, /probeDate = "07-07-2026"/);
  assert.doesNotMatch(
    probeSource,
    /SpreadsheetApp|ensureDatabase|syncAds|rebuildAdsReport|setValues|appendRow|deleteRow|clearContent/
  );
  assert.doesNotMatch(probeSource, /data\.path|data\.query|access_token|partner_key|signature/i);
});

test("Phase 3B batch probe is bounded, endpoint-locked, and read-only", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase3bAdsBatchProbe")', doPostStart);
  const probeEnd = backendSource.indexOf("// ── Telegram Webhook", probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /get_product_campaign_daily_performance/);
  assert.match(probeSource, /campaignIds\.length > 20/);
  assert.match(probeSource, /rangeDays > 15/);
  assert.match(probeSource, /shopeeGet\(batchPath/);
  assert.doesNotMatch(
    probeSource,
    /SpreadsheetApp|ensureDatabase|syncAds|rebuildAdsReport|setValues|appendRow|deleteRow|clearContent/
  );
  assert.doesNotMatch(probeSource, /data\.path|data\.query|access_token|partner_key|signature/i);
});

test("sales sync audit route is read-only and uses WIB business boundaries", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const routeStart = backendSource.indexOf('if (data.action === "phaseNextSalesSyncAudit20260610")', doPostStart);
  const databaseSetup = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(routeStart > doPostStart && routeStart < databaseSetup);
  assert.match(backendSource, /function _phaseNextShopeeGetReadOnly\(path, queryParams\)/);
  assert.match(backendSource, /function _phaseNextBusinessDayBounds\(dateStr\)/);
  assert.match(backendSource, /time_range_field: "create_time"/);
  assert.match(backendSource, /response_optional_fields: "item_list,total_amount,order_status,buyer_username,payment_method"/);
  assert.doesNotMatch(
    backendSource.slice(backendSource.indexOf("function _phaseNextShopeeGetReadOnly"), backendSource.indexOf("function _phaseNextBusinessDayBounds")),
    /getValidAccessToken|saveShopeeTokens|setProperty\(/
  );
  assert.match(analyticsApiSource, /function formatBusinessDateStr\(val\)/);
  assert.match(analyticsApiSource, /Utilities\.formatDate\(val, "Asia\/Jakarta", "yyyy-MM-dd"\)/);
  assert.match(analyticsApiSource, /handleGetBusinessAnalyticsSummary\(\s*\{ dateFrom, dateTo \},\s*\{ skipRefresh: true \}/s);
});

test("Phase 14 GMS POST helper reuses signed Shopee credentials without logging secrets", () => {
  const source = functionBody(backendSource, "shopeePost", "handleCheckShopeeAuth");
  assert.match(source, /getValidAccessToken\(\)/);
  assert.match(source, /getShopeeTokens\(\)/);
  assert.match(source, /makeShopeeSignature\(path, timestamp, accessToken, tokens\.shopId\)/);
  assert.match(source, /method:\s*"post"/);
  assert.match(source, /contentType:\s*"application\/json"/);
  assert.match(source, /payload:\s*JSON\.stringify\(requestBody \|\| \{\}\)/);
  assert.doesNotMatch(source, /Logger\.log|console\.log/);
});

test("Phase 14 campaign probe is fixed-scope, POST-only, and precedes database initialization", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase14GmsCampaignProbe")', doPostStart);
  const probeEnd = backendSource.indexOf('if (data.action === "phase14GmsItemProbe")', probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /get_gms_campaign_performance/);
  assert.match(probeSource, /probeDate = "08-08-2026"/);
  assert.match(
    probeSource,
    /shopeePost\(gmsPath,\s*\{\s*start_date:\s*probeDate,\s*end_date:\s*probeDate\s*\}\)/
  );
  assert.doesNotMatch(
    probeSource,
    /SpreadsheetApp|ensureDatabase|syncAds|rebuildAdsReport|setValues|appendRow|deleteRow|clearContent/
  );
  assert.doesNotMatch(probeSource, /data\.path|data\.body|access_token|partner_key|signature/i);
});

test("Phase 14 item probe requires returned campaign ID and exposes only documented metrics", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase14GmsItemProbe")', doPostStart);
  const probeEnd = backendSource.indexOf("// ── Telegram Webhook", probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /get_gms_item_performance/);
  assert.match(probeSource, /INVALID_GMS_CAMPAIGN_ID/);
  assert.match(probeSource, /broad_order:/);
  assert.match(probeSource, /broad_order_amount:/);
  assert.match(probeSource, /broad_gmv:/);
  assert.match(probeSource, /expense:/);
  assert.doesNotMatch(
    probeSource,
    /SpreadsheetApp|ensureDatabase|syncAds|rebuildAdsReport|setValues|appendRow|deleteRow|clearContent/
  );
  assert.doesNotMatch(probeSource, /data\.path|data\.body|access_token|partner_key|signature/i);
});

test("Phase 15 historical GMS preview is read-only and classifies unavailable source", () => {
  const source = functionBody(
    engineSource,
    "previewAdsGmsHistoricalCoverage",
    "adsGmsRepairReportDate_"
  );
  assert.match(source, /fetchAdsGmsDailyPerformanceMap/);
  assert.match(source, /API_MATCH_EXISTING/);
  assert.match(source, /API_DIFF_EXISTING/);
  assert.match(source, /API_ZERO/);
  assert.match(source, /API_UNAVAILABLE/);
  assert.match(source, /API_ERROR/);
  assert.doesNotMatch(
    source,
    /setValues|appendRow|deleteRow|deleteRows|clearContent|clearContents|insertRow|syncAdsHistoricalRange|rebuildAdsReport|ensureAdsDatabase|writeAdsSheetRowsIdempotent|upsertAds/
  );
});

test("Phase 15 preview route is bounded and precedes database initialization", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const probeStart = backendSource.indexOf('if (data.action === "phase15GmsHistoricalPreview")', doPostStart);
  const probeEnd = backendSource.indexOf("// ── Telegram Webhook", probeStart);
  const ensureDatabaseStart = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(probeStart > doPostStart);
  assert.ok(probeEnd > probeStart);
  assert.ok(probeStart < ensureDatabaseStart);

  const probeSource = backendSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /rangeDays > 10/);
  assert.match(probeSource, /new Date\(2026, 5, 1\)/);
  assert.match(probeSource, /new Date\(2026, 7, 25\)/);
  assert.match(probeSource, /previewAdsGmsHistoricalCoverage/);
  assert.doesNotMatch(
    probeSource,
    /ensureDatabase|syncAds|rebuildAdsReport|setValues|appendRow|deleteRow|clearContent|purge/
  );
});

test("Phase 15 implementation keeps Ads schemas and avoids verified sample hardcoding", () => {
  assert.equal(context.ADS_PRODUCT_DAILY_HEADERS.length, 18);
  assert.equal(context.ADS_REPORT_HEADERS.length, 18);
  assert.equal(context.ADS_CAMPAIGN_HEADERS.length, 12);
  assert.doesNotMatch(engineSource, /477341094/);
  assert.match(engineSource, /ADS_GMS_AUTOMATIC_INTEGRATION_ENABLED\s*=\s*false/);
});

test("Phase 17 repair validates all GMS dates before targeted Automatic metric writes", () => {
  const start = engineSource.indexOf("function executeAdsGmsControlledHistoricalRepair(");
  const end = engineSource.indexOf("function syncAdsHistoricalRange(", start);
  assert.ok(start >= 0 && end > start);
  const source = engineSource.slice(start, end);

  assert.match(source, /startDateStr = "01-06-2026"/);
  assert.match(source, /endDateStr = "25-08-2026"/);
  assert.match(source, /fetchAdsGmsDailyPerformanceMap\(startDateStr, endDateStr, \{ maxDays: expectedDates\.length \}/);
  assert.match(source, /expectedDates\.length !== 86/);
  assert.match(source, /if \(validationErrors\.length > 0\) return baseResult/);
  assert.match(source, /adsGmsRepairIsAutomaticRow_\(row, ADS_REPORT_HEADERS\)/);
  assert.match(source, /getRange\(change\.rowNumber, reportMetricIndexes\[definition\.key\] \+ 1\)/);
  assert.match(source, /setValue\(change\.new\[definition\.key\]\)/);
  assert.doesNotMatch(source, /writeAdsSheetRowsIdempotent|upsertAdsDailyRowsIdempotent|rebuildAdsReport|ensureAdsDatabase/);
  assert.doesNotMatch(source, /calculateAdsAutomaticSalesResidual|sumIndSales|sumIndOrders|sumIndSoldQty|Shop Total|residual/i);
  assert.match(source, /adsReportModified/);
  assert.match(source, /individualIntegrity/);
  assert.match(source, /adsCampaignIntegrity/);
  assert.match(source, /adsProductDailyIntegrity/);
});

test("Phase 17 router exposes only the controlled repair action before database initialization", () => {
  const doPostStart = backendSource.indexOf("function doPost(e)");
  const routeStart = backendSource.indexOf('if (data.action === "phase17ExecuteGmsHistoricalRepair")', doPostStart);
  const databaseSetup = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(routeStart > doPostStart && routeStart < databaseSetup);
  const routeEnd = backendSource.indexOf("// ── Telegram Webhook", routeStart);
  const routeSource = backendSource.slice(routeStart, routeEnd);
  assert.match(routeSource, /executeAdsGmsControlledHistoricalRepair\(\)/);
  assert.doesNotMatch(routeSource, /data\.startDate|data\.endDate|data\.campaign|syncAdsHistoricalRange|rebuildAdsReport/);
});

test("Phase 17 rollback is exact, conflict-safe, and targeted to Automatic metric cells", () => {
  const start = engineSource.indexOf("function executeAdsGmsPhase17Rollback(");
  const end = engineSource.indexOf("function syncAdsHistoricalRange(", start);
  assert.ok(start >= 0 && end > start);
  const source = engineSource.slice(start, end);
  assert.match(source, /rollbackPlan/);
  assert.match(source, /backupRows/);
  assert.match(source, /plan\.length !== 67/);
  assert.match(source, /cellCount !== 142/);
  assert.match(source, /conflicts\.length/);
  assert.match(source, /current value conflicts found/i);
  assert.match(source, /setValue\(change\.old\[key\]\)/);
  assert.doesNotMatch(source, /fetchAdsGms|fetchAdsGmsDailyPerformanceMap|rebuildAdsReport|syncAdsHistoricalRange/);
  assert.doesNotMatch(source, /setValues\(|appendRow\(|clearContent\(|deleteRow\(/);

  const doPostStart = backendSource.indexOf("function doPost(e)");
  const routeStart = backendSource.indexOf('if (data.action === "phase17RollbackGmsHistoricalRepair")', doPostStart);
  const databaseSetup = backendSource.indexOf("ensureDatabase();", doPostStart);
  assert.ok(routeStart > doPostStart && routeStart < databaseSetup);
  const routeSource = backendSource.slice(routeStart, databaseSetup);
  assert.match(routeSource, /executeAdsGmsPhase17Rollback\(data\)/);
});

console.log(`Ads Sales integrity tests: ${passed}/${passed} PASS`);
