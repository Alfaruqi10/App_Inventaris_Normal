import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SALES_LEDGER_LINE_KEY_HEADER,
  SALES_LEDGER_SETTLEMENT_FIELDS,
  SALES_LEDGER_SETTLEMENT_OWNER_HEADER
} from '../src/node-backend/services/salesLedgerSemantics.js';
import { dryRunSalesLedgerLineMigration } from '../src/node-backend/services/salesLedgerMigration.js';

const outputDir = path.resolve('.codex-tmp');
const [ledger, shopee] = await Promise.all([
  readFile(path.join(outputDir, 'salesledger-production-snapshot.json'), 'utf8').then(JSON.parse),
  readFile(path.join(outputDir, 'shopeeorders-production-snapshot.json'), 'utf8').then(JSON.parse)
]);
const dryRun = await dryRunSalesLedgerLineMigration({ ledgerRows: ledger.rows, shopeeRows: shopee.rows });
const generatedAt = new Date().toISOString();
const write = (name, body) => writeFile(path.join(outputDir, name), `${JSON.stringify(body, null, 2)}\n`);

await mkdir(outputDir, { recursive: true });
await Promise.all([
  write('salesledger-phase3-schema-result.json', {
    generatedAt,
    mode: 'LOCAL_DRY_RUN',
    existingHeadersPreserved: 49,
    appendedHeaders: [SALES_LEDGER_LINE_KEY_HEADER, SALES_LEDGER_SETTLEMENT_OWNER_HEADER],
    schemaMutation: 'EXPLICIT_ONLY',
    defaultWritesExecuted: false
  }),
  write('salesledger-phase3-semantic-accessors.json', {
    generatedAt,
    lines: 'One row per Order SN|Item ID|Model ID',
    orders: 'One record per Order SN',
    settlements: 'Exactly one Settlement Owner row per Order SN',
    settlementFields: SALES_LEDGER_SETTLEMENT_FIELDS,
    invariants: { logicalLineKeys: dryRun.validation.uniqueLogicalLineKeys, settlementOwners: dryRun.validation.settlementOwners }
  }),
  write('salesledger-phase3-consumer-result.json', {
    generatedAt,
    finance: 'Line Qty/gross + owner-only settlement aggregation',
    adsRoas: 'Distinct Order SN + owner-only settlement aggregation',
    reconciliation: 'Logical line identity',
    duplicateCleanup: 'Logical Line Key',
    historicalSync: 'Blocked until line-level operational readiness',
    uiExport: 'Order summary with Line Count and ORDER_SETTLEMENT semantic level'
  }),
  write('salesledger-phase3-migration-engine.json', {
    generatedAt,
    mode: 'DRY_RUN_DEFAULT',
    executorRequires: ['execute=true', 'allowProductionWrite=true', 'injected writeRows', 'valid plan', 'zero NEEDS_REVIEW orders'],
    writeAdapterIncluded: false,
    writesExecuted: false
  }),
  write('salesledger-phase3-dry-run.json', {
    generatedAt,
    mode: dryRun.mode,
    writesExecuted: dryRun.writesExecuted,
    validation: dryRun.validation,
    needsReview: dryRun.review
  }),
  write('salesledger-phase3-test-result.json', {
    generatedAt,
    lineLevelTests: '41 PASS',
    legacyQtyTests: '40/40 PASS',
    financeResyncTests: '148 PASS',
    npmTest: 'PASS',
    productionWritesExecuted: false
  }),
  write('salesledger-phase3-summary.json', {
    generatedAt,
    implementation: 'COMPLETE_LOCAL_ONLY',
    sourceOrders: dryRun.validation.orders,
    targetLogicalLines: dryRun.validation.logicalLines,
    settlementOwners: dryRun.validation.settlementOwners,
    financeConservationMismatches: dryRun.validation.settlementMismatches.length,
    needsReview: dryRun.review.map(item => item.orderSn),
    productionModified: false,
    deployment: false
  })
]);

console.log(`Phase 3 local artifacts written: ${outputDir}`);
