import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { dryRunSalesLedgerLineMigration } from '../src/node-backend/services/salesLedgerMigration.js';
import {
  executeSalesLedgerProductionMigration,
  FileLeaseMigrationLock,
  sha256,
  validateSalesLedgerProductionTarget
} from '../src/node-backend/services/salesLedgerProductionMigration.js';

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

const [ledgerSnapshot, shopeeSnapshot, currentLedgerSnapshot, currentShopeeSnapshot] = await Promise.all([
  readFile('.codex-tmp/salesledger-production-snapshot.json', 'utf8').then(JSON.parse),
  readFile('.codex-tmp/shopeeorders-production-snapshot.json', 'utf8').then(JSON.parse),
  readFile('.codex-tmp/salesledger-final-premigration-snapshot.json', 'utf8').then(JSON.parse),
  readFile('.codex-tmp/shopeeorders-final-premigration-snapshot.json', 'utf8').then(JSON.parse)
]);
const resolutionManifestPath = resolve('.codex-tmp/salesledger-phase5-anomaly-resolution.json');
const cohortOrderSns = [...new Set(shopeeSnapshot.rows.map(row => String(row.order_sn || '').trim()).filter(Boolean))];
const dryRun = await dryRunSalesLedgerLineMigration({
  ledgerRows: ledgerSnapshot.rows,
  shopeeRows: shopeeSnapshot.rows,
  resolutionManifestPath,
  requireResolutionManifest: true,
  cohortOrderSns
});
const target = {
  ...dryRun,
  headers: [...ledgerSnapshot.headers, 'Logical Line Key', 'Settlement Owner']
};
const baselineRaw = [
  ledgerSnapshot.headers,
  ...ledgerSnapshot.rows.map(row => ledgerSnapshot.headers.map(header => row[header] ?? ''))
];
const currentRaw = [
  currentLedgerSnapshot.headers,
  ...currentLedgerSnapshot.rows.map(row => currentLedgerSnapshot.headers.map(header => row[header] ?? ''))
];
const historicalOrderSet = new Set(ledgerSnapshot.rows.map(row => String(row['Order SN'] || '').trim()));
const currentHistoricalRows = currentLedgerSnapshot.rows.filter(row => historicalOrderSet.has(String(row['Order SN'] || '').trim()));
const preservationRows = currentLedgerSnapshot.rows.filter(row => !historicalOrderSet.has(String(row['Order SN'] || '').trim()));
const preservationOrderSns = [...new Set(preservationRows.map(row => String(row['Order SN'] || '').trim()))];

const lockDirectory = await mkdtemp(resolve(tmpdir(), 'salesledger-migration-lock-'));
const staleLockPath = resolve(lockDirectory, 'lease.json');
await writeFile(staleLockPath, JSON.stringify({ ownerId: 'expired', expiresAt: 0 }));
const staleLock = new FileLeaseMigrationLock({ path: staleLockPath });
const staleLease = await staleLock.acquire({ timeoutMs: 100, staleAfterMs: 1000, ownerId: 'fresh' });
await staleLease.release();
ok(true, 'expired local migration lease is replaced and released safely');

const combinedDryRun = await dryRunSalesLedgerLineMigration({
  ledgerRows: currentLedgerSnapshot.rows,
  shopeeRows: currentShopeeSnapshot.rows,
  resolutionManifestPath,
  requireResolutionManifest: true,
  cohortOrderSns,
  preservationOrderSns
});
const combinedTarget = {
  ...combinedDryRun,
  headers: [...currentLedgerSnapshot.headers, 'Logical Line Key', 'Settlement Owner']
};
ok(combinedDryRun.cohort.historical.orderCount === 332 && combinedDryRun.cohort.historical.logicalLineCount === 351,
  'historical cohort remains 332 orders and 351 logical lines');
ok(combinedDryRun.cohort.preservation.orderCount === preservationOrderSns.length &&
  combinedDryRun.cohort.preservation.logicalLineCount === preservationRows.length,
  'post-baseline preservation cohort count is calculated from the current snapshot');
ok(combinedDryRun.targetRows.length === combinedDryRun.cohort.historical.logicalLineCount + combinedDryRun.cohort.preservation.logicalLineCount,
  'combined target is historical transform plus preservation rows');
ok(combinedDryRun.validation.orders === 332 + preservationOrderSns.length &&
  combinedDryRun.validation.settlementOwners === 332 + preservationOrderSns.length,
  'combined target has one settlement owner for every historical and preserved order');
ok(combinedDryRun.validation.settlementMismatches.length === 0, 'finance is conserved across both cohorts');
const freshOperationalState = clone(currentLedgerSnapshot.rows);
const freshHistorical = freshOperationalState.find(row => historicalOrderSet.has(String(row['Order SN'] || '').trim()));
freshHistorical['Tanggal Update'] = 'FRESH_OPERATIONAL_TIMESTAMP';
freshHistorical['Status Shopee'] = 'FRESH_OPERATIONAL_STATUS';
freshHistorical['Deduction Status'] = 'FRESH_DEDUCTION_STATE';
const freshStateDryRun = await dryRunSalesLedgerLineMigration({
  ledgerRows: freshOperationalState,
  shopeeRows: currentShopeeSnapshot.rows,
  resolutionManifestPath,
  requireResolutionManifest: true,
  cohortOrderSns,
  preservationOrderSns
});
const freshStateOwner = freshStateDryRun.targetRows.find(row => row['Order SN'] === freshHistorical['Order SN'] && row['Settlement Owner'] === true);
ok(freshStateOwner['Tanggal Update'] === 'FRESH_OPERATIONAL_TIMESTAMP' &&
  freshStateOwner['Status Shopee'] === 'FRESH_OPERATIONAL_STATUS' &&
  freshStateOwner['Deduction Status'] === 'FRESH_DEDUCTION_STATE',
  'historical expansion preserves fresh SalesLedger operational state instead of overwriting it from source');
for (const preserved of preservationRows) {
  const targetRow = combinedDryRun.targetRows.find(row => row['Order SN'] === preserved['Order SN']);
  ok(Boolean(targetRow) && currentLedgerSnapshot.headers.every(header => String(targetRow[header] ?? '') === String(preserved[header] ?? '')),
    `${preserved['Order SN']} preserves every existing business field`);
  ok(Boolean(targetRow?.['Logical Line Key']) && targetRow?.['Settlement Owner'] === true,
    `${preserved['Order SN']} receives valid Option C semantic fields`);
}
const combinedAgain = await dryRunSalesLedgerLineMigration({
  ledgerRows: currentLedgerSnapshot.rows,
  shopeeRows: currentShopeeSnapshot.rows,
  resolutionManifestPath,
  requireResolutionManifest: true,
  cohortOrderSns,
  preservationOrderSns
});
ok(JSON.stringify(combinedDryRun.targetRows) === JSON.stringify(combinedAgain.targetRows), 'combined target is deterministic and idempotent');
await assert.rejects(
  () => dryRunSalesLedgerLineMigration({
    ledgerRows: currentLedgerSnapshot.rows,
    shopeeRows: currentShopeeSnapshot.rows,
    resolutionManifestPath,
    requireResolutionManifest: true,
    cohortOrderSns,
    preservationOrderSns: [cohortOrderSns[0]]
  }),
  /cohorts overlap/
);
passed += 1;
const missingIdentityLedger = clone(currentLedgerSnapshot.rows);
const missingIdentityIndex = missingIdentityLedger.findIndex(row => preservationOrderSns.includes(String(row['Order SN'])));
missingIdentityLedger[missingIdentityIndex]['Item ID'] = '';
await assert.rejects(
  () => dryRunSalesLedgerLineMigration({
    ledgerRows: missingIdentityLedger,
    shopeeRows: currentShopeeSnapshot.rows,
    resolutionManifestPath,
    requireResolutionManifest: true,
    cohortOrderSns,
    preservationOrderSns
  }),
  /logical line identity is missing/
);
passed += 1;
const duplicateCrossCohort = clone(combinedTarget);
const preservedTargetIndex = duplicateCrossCohort.targetRows.findIndex(row => preservationOrderSns.includes(String(row['Order SN'])));
duplicateCrossCohort.targetRows[preservedTargetIndex]['Logical Line Key'] = duplicateCrossCohort.targetRows[0]['Logical Line Key'];
assert.throws(() => validateSalesLedgerProductionTarget(duplicateCrossCohort), error => error.code === 'TARGET_IDENTITY_INVALID');
passed += 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRepository(initialRaw = baselineRaw) {
  let raw = clone(initialRaw);
  let writes = 0;
  return {
    sheetName: 'SalesLedger',
    async getRawSalesLedgerMatrix() { return { headers: raw[0], raw: clone(raw) }; },
    async replaceSalesLedgerMatrix(nextRaw) { writes += 1; raw = clone(nextRaw); },
    get writes() { return writes; },
    get raw() { return clone(raw); }
  };
}

function createLock({ fail = false } = {}) {
  let acquired = 0;
  let released = 0;
  return {
    async acquire() {
      if (fail) throw new Error('lock unavailable');
      acquired += 1;
      return { async release() { released += 1; } };
    },
    stats: () => ({ acquired, released })
  };
}

function createArtifacts({ failBackup = false } = {}) {
  const values = [];
  return {
    async writeBackup(snapshot) {
      if (failBackup) throw new Error('backup failed');
      const backup = { hash: sha256(snapshot.raw), raw: clone(snapshot.raw) };
      values.push({ name: 'backup', value: backup });
      return backup;
    },
    async writeJson(name, value) { values.push({ name, value: clone(value) }); },
    values
  };
}

function baseInput(repository, overrides = {}) {
  const raw = baselineRaw;
  return {
    target: clone(target),
    expectedTargetFingerprint: validateSalesLedgerProductionTarget(target).fingerprint,
    expectedPreMigrationHash: sha256(raw),
    expectedCohortRows: clone(ledgerSnapshot.rows),
    execute: true,
    ledgerRepository: repository,
    lock: createLock(),
    artifactStore: createArtifacts(),
    protectedSnapshot: async () => ({ shopeeOrders: 'unchanged', masterBarang: 'unchanged', inventoryTransactions: 42 }),
    writeScope: { records: [], record(sheetName) { this.records.push(sheetName); } },
    ...overrides
  };
}

await assert.rejects(
  () => executeSalesLedgerProductionMigration({ execute: false }),
  error => error.code === 'TARGET_MISSING'
);
passed += 1;

await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(createRepository(), { expectedTargetFingerprint: 'stale-fingerprint' })),
  error => error.code === 'TARGET_FINGERPRINT_MISMATCH'
);
passed += 1;

const duplicateKeyTarget = clone(target);
duplicateKeyTarget.targetRows[1]['Logical Line Key'] = duplicateKeyTarget.targetRows[0]['Logical Line Key'];
assert.throws(() => validateSalesLedgerProductionTarget(duplicateKeyTarget), error => error.code === 'TARGET_IDENTITY_INVALID');
passed += 1;

const duplicateLedgerIdTarget = clone(target);
duplicateLedgerIdTarget.targetRows[1]['Ledger ID'] = duplicateLedgerIdTarget.targetRows[0]['Ledger ID'];
assert.throws(() => validateSalesLedgerProductionTarget(duplicateLedgerIdTarget), error => error.code === 'TARGET_IDENTITY_INVALID');
passed += 1;

const invalidOwnerTarget = clone(target);
const multiLine = invalidOwnerTarget.targetRows.findIndex(row => row['Settlement Owner'] === false);
invalidOwnerTarget.targetRows[multiLine]['Settlement Owner'] = true;
assert.throws(() => validateSalesLedgerProductionTarget(invalidOwnerTarget), error => error.code === 'TARGET_OWNER_INVALID');
passed += 1;

const unresolvedTarget = clone(target);
unresolvedTarget.resolutionManifest.unresolved = 1;
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(createRepository(), { target: unresolvedTarget })),
  error => error.code === 'RESOLUTION_MANIFEST_INVALID'
);
passed += 1;

const driftRaw = clone(baselineRaw);
driftRaw[1][ledgerSnapshot.headers.indexOf('Qty')] = 999;
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(createRepository(driftRaw), { expectedPreMigrationHash: sha256(driftRaw) })),
  error => error.code === 'HISTORICAL_COHORT_DRIFT'
);
passed += 1;

const backupRepository = createRepository();
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(backupRepository, { artifactStore: createArtifacts({ failBackup: true }) })),
  /backup failed/
);
ok(backupRepository.writes === 0, 'backup failure aborts before SalesLedger write');

const lockRepository = createRepository();
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(lockRepository, { lock: createLock({ fail: true }) })),
  /lock unavailable/
);
ok(lockRepository.writes === 0, 'lock failure aborts before SalesLedger write');

const wrongScopeRepository = createRepository();
wrongScopeRepository.sheetName = 'ShopeeOrders';
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(wrongScopeRepository)),
  error => error.code === 'WRITE_SCOPE_INVALID'
);
ok(wrongScopeRepository.writes === 0, 'unexpected write scope aborts before write');

const financeMismatchTarget = clone(target);
financeMismatchTarget.targetRows.find(row => row['Settlement Owner'] === true)['Net Income'] = '999999999';
const financeMismatchRepository = createRepository();
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(financeMismatchRepository, {
    target: financeMismatchTarget,
    expectedTargetFingerprint: validateSalesLedgerProductionTarget(financeMismatchTarget).fingerprint
  })),
  error => error.code === 'FINANCE_CONSERVATION_FAILED'
);
ok(financeMismatchRepository.writes === 1, 'finance mismatch is detected by post-write verification in the mock');

const deductionRepository = createRepository();
let protectedVersion = 0;
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(deductionRepository, {
    protectedSnapshot: async () => ({ shopeeOrders: protectedVersion++, masterBarang: 'unchanged', inventoryTransactions: 42 })
  })),
  error => error.code === 'EXTERNAL_MUTATION_DETECTED'
);
ok(deductionRepository.writes === 1, 'protected deduction snapshot changes are detected after the mock write');

const successRepository = createRepository();
const successLock = createLock();
const successArtifacts = createArtifacts();
const success = await executeSalesLedgerProductionMigration(baseInput(successRepository, {
  lock: successLock,
  artifactStore: successArtifacts
}));
ok(success.status === 'EXECUTED' && success.writesExecuted === 1, 'validated target is written once through the controlled repository boundary');
ok(successRepository.writes === 1 && success.logicalLineCount === 351 && success.settlementOwnerCount === 332,
  'successful mock execution preserves the approved historical target counts');
ok(successLock.stats().acquired === 1 && successLock.stats().released === 1, 'migration lock is acquired and released after verification');
ok(successArtifacts.values.some(entry => entry.name === 'backup') && successArtifacts.values.some(entry => entry.name === 'salesledger-production-migration-execution.json'),
  'pre-migration backup and execution artifact are recorded');

const alreadyMigrated = await executeSalesLedgerProductionMigration(baseInput(successRepository, {
  expectedPreMigrationHash: undefined,
  lock: createLock(),
  artifactStore: createArtifacts()
}));
ok(alreadyMigrated.status === 'ALREADY_MIGRATED' && alreadyMigrated.writesExecuted === 0 && alreadyMigrated.migrationAlreadyApplied,
  'a second execution recognizes the migrated target and does not write again');

const combinedRepository = createRepository(currentRaw);
const combinedResult = await executeSalesLedgerProductionMigration(baseInput(combinedRepository, {
  target: combinedTarget,
  expectedTargetFingerprint: validateSalesLedgerProductionTarget(combinedTarget).fingerprint,
  expectedPreMigrationHash: sha256(currentRaw),
  expectedCohortRows: clone(currentHistoricalRows),
  expectedPreservationRows: clone(preservationRows)
}));
ok(combinedResult.status === 'EXECUTED' && combinedResult.orderCount === 352 && combinedResult.logicalLineCount === 371,
  'controlled writer accepts the validated combined cohort target');
const missingPreservationRaw = clone(currentRaw);
missingPreservationRaw.splice(missingPreservationRaw.findIndex(row => row[0] !== 'Ledger ID' && row[currentLedgerSnapshot.headers.indexOf('Order SN')] === preservationOrderSns[0]), 1);
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(createRepository(missingPreservationRaw), {
    target: combinedTarget,
    expectedTargetFingerprint: validateSalesLedgerProductionTarget(combinedTarget).fingerprint,
    expectedPreMigrationHash: sha256(missingPreservationRaw),
    expectedCohortRows: clone(currentHistoricalRows),
    expectedPreservationRows: clone(preservationRows)
  })),
  error => error.code === 'PRESERVATION_COHORT_DRIFT'
);
passed += 1;
const mutatedPreservationRaw = clone(currentRaw);
const preserveRow = mutatedPreservationRaw.find(row => row[currentLedgerSnapshot.headers.indexOf('Order SN')] === preservationOrderSns[0]);
preserveRow[currentLedgerSnapshot.headers.indexOf('Qty')] = 99;
await assert.rejects(
  () => executeSalesLedgerProductionMigration(baseInput(createRepository(mutatedPreservationRaw), {
    target: combinedTarget,
    expectedTargetFingerprint: validateSalesLedgerProductionTarget(combinedTarget).fingerprint,
    expectedPreMigrationHash: sha256(mutatedPreservationRaw),
    expectedCohortRows: clone(currentHistoricalRows),
    expectedPreservationRows: clone(preservationRows)
  })),
  error => error.code === 'PRESERVATION_COHORT_DRIFT'
);
passed += 1;

console.log(`SalesLedger production migration writer tests: ${passed} PASS`);
