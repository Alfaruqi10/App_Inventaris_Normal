import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SALES_LEDGER_SETTLEMENT_FIELDS,
  buildSalesLedgerLogicalLineKey,
  getSalesLedgerLineSummary,
  getSalesLedgerOrderSummary,
  getSalesLedgerSettlements
} from '../src/node-backend/services/salesLedgerSemantics.js';
import {
  dryRunSalesLedgerLineMigration,
  executeSalesLedgerMigration
} from '../src/node-backend/services/salesLedgerMigration.js';
import { FinanceService } from '../src/node-backend/services/financeService.js';

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

const [ledgerSnapshot, shopeeSnapshot, gasSemantics, gasSource, adsSource, financeService, analyticsEngine, recoveryInit, aiTools, analyticsReport, salesLedgerFrontend] = await Promise.all([
  readFile('.codex-tmp/salesledger-production-snapshot.json', 'utf8').then(JSON.parse),
  readFile('.codex-tmp/shopeeorders-production-snapshot.json', 'utf8').then(JSON.parse),
  readFile('src/backend/SalesLedgerSemantics.gs', 'utf8'),
  readFile('src/backend/code.gs', 'utf8'),
  readFile('src/backend/ShopeeAds/api/AdsAPI.gs', 'utf8'),
  readFile('src/node-backend/services/financeService.js', 'utf8'),
  readFile('src/backend/BusinessAnalytics/core/AnalyticsEngine.gs', 'utf8'),
  readFile('src/backend/RecoveryCenter/init.gs', 'utf8'),
  readFile('src/frontend/ai/AITools.js', 'utf8'),
  readFile('src/frontend/BusinessAnalytics/reports/ba-reports.js', 'utf8'),
  readFile('sales-ledger.js', 'utf8')
]);
const resolutionManifestPath = resolve('.codex-tmp/salesledger-phase5-anomaly-resolution.json');
const historicalCohort = [...new Set(shopeeSnapshot.rows.map(row => String(row.order_sn || '').trim()).filter(Boolean))];

const semanticRows = [
  {
    'Ledger ID': 'SL-1', 'Order SN': 'ORDER-1', 'Item ID': 'ITEM-A', 'Model ID': 'MODEL-A',
    Qty: 2, 'Product Subtotal': 200, 'Escrow Amount': 120, 'Net Income': 120,
    'Settlement Owner': true
  },
  {
    'Ledger ID': 'SL-2', 'Order SN': 'ORDER-1', 'Item ID': 'ITEM-B', 'Model ID': 'MODEL-B',
    Qty: 3, 'Product Subtotal': 300, 'Escrow Amount': '', 'Net Income': '',
    'Settlement Owner': false
  }
];

ok(buildSalesLedgerLogicalLineKey(semanticRows[0]) === 'ORDER-1|ITEM-A|MODEL-A', 'logical key is canonical');
ok(getSalesLedgerLineSummary(semanticRows).lineCount === 2, 'two lines remain two logical lines');
ok(getSalesLedgerLineSummary(semanticRows).totalQty === 5, 'Qty is summed from logical lines');
ok(getSalesLedgerSettlements(semanticRows).length === 1, 'one settlement owner per order');
ok(getSalesLedgerSettlements(semanticRows)[0]['Escrow Amount'] === 120, 'settlement accessor returns owner finance only');
ok(getSalesLedgerOrderSummary(semanticRows)[0].lines.length === 2, 'order summary groups lines');
assert.throws(() => getSalesLedgerSettlements([{ ...semanticRows[0], 'Settlement Owner': false }]), /Settlement owner invariant/);
passed += 1;
assert.throws(() => getSalesLedgerSettlements([{ ...semanticRows[0] }, { ...semanticRows[1], 'Settlement Owner': true }]), /Settlement owner invariant/);
passed += 1;

const dryRun = await dryRunSalesLedgerLineMigration({
  ledgerRows: ledgerSnapshot.rows,
  shopeeRows: shopeeSnapshot.rows,
  resolutionManifestPath,
  requireResolutionManifest: true,
  cohortOrderSns: historicalCohort
});
ok(dryRun.writesExecuted === false, 'dry-run executes zero writes');
ok(dryRun.validation.orders === 332, 'dry-run preserves 332 orders');
ok(dryRun.validation.logicalLines === 351, 'dry-run builds 351 logical lines');
ok(dryRun.validation.settlementOwners === 332, 'dry-run builds 332 settlement owners');
ok(dryRun.validation.uniqueLogicalLineKeys === 351, 'logical keys are unique');
ok(dryRun.validation.duplicateLogicalLineKeys === 0, 'duplicate logical keys are zero');
ok(dryRun.validation.settlementMismatches.length === 0, 'all settlement fields conserve per order');
ok(dryRun.review.length === 0, 'approved historical resolutions remove NEEDS_REVIEW');
ok(dryRun.resolutionManifest.loaded === true && dryRun.resolutionManifest.records === 5, 'resolution manifest is loaded with five records');
ok(dryRun.resolutionManifest.resolved === 5 && dryRun.resolutionManifest.applied === 5 && dryRun.resolutionManifest.unresolved === 0,
  'all five resolution manifest records are applied');
['260808S2FTMY8U', '260808S33PS2GT', '260713HTB532XU', '2607072CS6NRX8', '26070730CFK68T']
  .forEach(orderSn => ok(dryRun.resolutionManifest.applications.some(item => item.orderSn === orderSn && item.recommendedValueApplied), `${orderSn} manifest decision is applied`));
ok(dryRun.targetRows.every(row => row['Settlement Owner'] === true || SALES_LEDGER_SETTLEMENT_FIELDS.every(field => row[field] === '')),
  'non-owner lines have blank settlement fields');

const resolvedQtyA = dryRun.targetRows.find(row => row['Order SN'] === '260808S2FTMY8U');
const resolvedQtyB = dryRun.targetRows.find(row => row['Order SN'] === '260808S33PS2GT');
const resolvedSku = dryRun.targetRows.find(row => row['Order SN'] === '260713HTB532XU');
ok(resolvedQtyA?.Qty === 11 && resolvedQtyA?.Subtotal === 1600500, '260808S2FTMY8U applies Qty 11 resolution');
ok(resolvedQtyB?.Qty === 11 && resolvedQtyB?.Subtotal === 1600500, '260808S33PS2GT applies Qty 11 resolution');
ok(resolvedSku?.['SKU Inventaris'] === 'ANS-BWS-DYS-ALS', '260713HTB532XU applies canonical SKU resolution');
['2607072CS6NRX8', '26070730CFK68T'].forEach(orderSn => {
  const lines = dryRun.targetRows.filter(row => row['Order SN'] === orderSn);
  const byVariation = Object.fromEntries(lines.map(row => [row.Variasi, row]));
  ok(byVariation['Hitam,XXL']?.Qty === 2 && byVariation['Hitam,XXL']?.Subtotal === 750500, `${orderSn} applies Hitam,XXL resolution`);
  ok(byVariation['Hitam,M']?.Qty === 1 && byVariation['Hitam,M']?.Subtotal === 375250, `${orderSn} applies Hitam,M resolution`);
});

const paymentMethodRows = [
  ['Ledger ID', 'Order SN', 'Payment Method', 'Settlement Owner'],
  ['OWNER', 'PM-ORDER', '', 'TRUE'],
  ['CHILD', 'PM-ORDER', '', 'FALSE']
];
const paymentMethodService = new FinanceService(null, null);
ok(paymentMethodService._applyPaymentMethodMap(paymentMethodRows, paymentMethodRows[0], { 'PM-ORDER': 'SHOPEE_PAY' }) === 1,
  'Payment Method backfill writes exactly one settlement owner row');
ok(paymentMethodRows[1][2] === 'SHOPEE_PAY' && paymentMethodRows[2][2] === '',
  'Payment Method remains blank on non-owner lines');

const fixtureFinanceService = new FinanceService({ getSalesLedgers: async () => dryRun.targetRows }, null);
const orderView = await fixtureFinanceService.getSalesLedgerPagedV2({ page: 1, limit: 500 });
ok(orderView.status === 'success' && orderView.total === 332, 'order list remains one record per Order SN');
const fourLineOrder = orderView.ledgers.find(row => row['Order SN'] === '260711CDB5CFM8');
ok(fourLineOrder?.['Line Count'] === 4, '260711CDB5CFM8 exposes four logical lines in order view');
ok(fourLineOrder?.lines.reduce((sum, row) => sum + Number(row.Qty || 0), 0) === 4, '260711CDB5CFM8 preserves Qty 4');
ok(fourLineOrder?.lines.filter(row => row['Settlement Owner'] === true).length === 1, '260711CDB5CFM8 has exactly one settlement owner');
ok(fourLineOrder?.lines.reduce((sum, row) => sum + Number(row['Product Subtotal'] || 0), 0) === 1555200,
  '260711CDB5CFM8 line subtotals preserve 1555200');
ok(JSON.stringify(fourLineOrder?.lines.map(row => Number(row['Product Subtotal'] || 0)).sort((a, b) => a - b)) === JSON.stringify([330650, 375250, 422750, 426550]),
  '260711CDB5CFM8 preserves all four individual line subtotals');
const fourLineDetail = await fixtureFinanceService.getSalesLedgerDetailV2({ ledgerId: fourLineOrder?.['Ledger ID'] });
ok(fourLineDetail.status === 'success' && fourLineDetail.detail.lines.length === 4, 'detail returns all logical lines for a multi-line order');
ok(fourLineDetail.detail.lines.every(row => row['Item ID'] && row['Model ID'] && row['SKU Inventaris'] !== undefined),
  'detail lines retain Item ID, Model ID, and SKU attributes');

const executeResult = await executeSalesLedgerMigration({ plan: dryRun, execute: false });
ok(executeResult.status === 'DRY_RUN_ONLY' && executeResult.writesExecuted === false, 'execution requires explicit write flag');
await assert.rejects(
  () => executeSalesLedgerMigration({
    plan: { ...dryRun, resolutionManifest: { ...dryRun.resolutionManifest, applied: 4 } },
    execute: true,
    allowProductionWrite: true,
    writeRows: async () => {}
  }),
  /resolution manifest is incomplete/
);
passed += 1;
await assert.rejects(
  () => dryRunSalesLedgerLineMigration({
    ledgerRows: ledgerSnapshot.rows,
    shopeeRows: shopeeSnapshot.rows,
    resolutionManifest: [],
    requireResolutionManifest: true,
    cohortOrderSns: historicalCohort
  }),
  /exactly five records/
);
passed += 1;

ok(gasSource.includes('"Logical Line Key"') && gasSource.includes('"Settlement Owner"'), 'legacy headers are extended append-only');
ok(gasSemantics.includes('function ensureSalesLedgerLineSchema(options)'), 'schema migration is explicit');
ok(gasSemantics.includes('writesExecuted: false'), 'schema inspection is read-only by default');
ok(gasSemantics.includes('function getSalesLedgerLines(options)'), 'GAS line accessor exists');
ok(gasSemantics.includes('function getSalesLedgerOrders(options)'), 'GAS order accessor exists');
ok(gasSemantics.includes('function getSalesLedgerSettlements(options)'), 'GAS settlement accessor exists');
ok(gasSemantics.includes('"Payment Method", "Settlement Status"'), 'GAS settlement semantics classify Payment Method as owner-only');
ok(gasSemantics.includes('function updateSalesLedgerLineLevel(options)'), 'GAS line-level writer exists');
ok(gasSemantics.includes('if (options.executeWrite !== true)'), 'GAS dry-run writer path is explicit');
ok(gasSemantics.includes('status: "MIGRATION_REQUIRED"') && gasSemantics.includes('duplicateExistingKeys'), 'GAS writer fails closed for unmigrated or duplicate line data');
ok(gasSource.includes('function updateSalesLedgerLegacyOrderLevel(options)'), 'legacy order-level writer is retained only as an isolated legacy function');
ok(gasSource.includes('function cleanupDuplicateSalesLedger()') && gasSource.includes('Logical Line Key'), 'duplicate cleanup uses logical identity');
ok(adsSource.includes('getSalesLedgerSettlements') && adsSource.includes('Object.keys(ledgerOrderSet).length'), 'Ads/ROAS uses settlement owners and distinct orders');
ok(financeService.includes('getSalesLedgerOrderSummary') && financeService.includes('getSalesLedgerLineSummary'), 'FinanceService uses semantic accessors');
ok(analyticsEngine.includes('getSalesLedgerLines({ rows: ledger || [], strict: false })') && analyticsEngine.includes('const prop = isLogicalLine ? 1') && analyticsEngine.includes('const totalVoucherShopee = isLogicalLine ? 0'), 'Business Analytics keeps product metrics line-level without settlement allocation');
ok(recoveryInit.includes('getSalesLedgerLines({ rows: ledger, strict: false })') && recoveryInit.includes('product analytics intentionally does not allocate settlement'), 'Recovery analytics verification uses logical lines');
ok(aiTools.includes('const selesaiOrders = new Set()') && aiTools.includes('isSettlementOwner'), 'AI summary keeps orders distinct and settlement owner-aware');
ok(analyticsReport.includes('Escrow is') && analyticsReport.includes('must not be repeated per line'), 'Analytics report preview does not duplicate escrow per line');
ok(salesLedgerFrontend.includes('function _slExportLogicalLines(orders)') && salesLedgerFrontend.includes("'Settlement Owner'"),
  'export emits logical lines with explicit settlement ownership');
ok(salesLedgerFrontend.includes("section('Rincian Logical Line'") && salesLedgerFrontend.includes("Item ID: "),
  'detail UI renders line-level identity and pricing fields');

console.log(`SalesLedger line-level tests: ${passed} PASS`);
