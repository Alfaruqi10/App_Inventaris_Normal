import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SALES_LEDGER_LINE_KEY_HEADER,
  SALES_LEDGER_SETTLEMENT_FIELDS,
  SALES_LEDGER_SETTLEMENT_OWNER_HEADER,
  getSalesLedgerSettlements
} from './salesLedgerSemantics.js';

const EXPECTED_BASE_HEADERS = 49;
const EXPECTED_TARGET_HEADERS = 51;
const EXPECTED_HISTORICAL_ORDERS = 332;
const EXPECTED_LOGICAL_LINES = 351;
const EXPECTED_RESOLUTIONS = 5;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value === undefined ? null : value;
}

export function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizeHeaders(headers) {
  return (headers || []).map(header => String(header ?? '').trim());
}

function normalizeMatrix(matrix) {
  const headers = normalizeHeaders(matrix?.headers || matrix?.raw?.[0]);
  const raw = matrix?.raw || [headers, ...(matrix?.rows || [])];
  const rows = raw.slice(1).filter(row => Array.isArray(row) && row.some(value => String(value ?? '') !== ''))
    .map(row => headers.map((_, index) => row[index] ?? ''));
  return { headers, rows, raw: [headers, ...rows] };
}

function matrixToObjects(matrix) {
  return matrix.rows.map(row => matrix.headers.reduce((result, header, index) => {
    result[header] = row[index] ?? '';
    return result;
  }, {}));
}

function targetToMatrix(target) {
  const headers = normalizeHeaders(target?.headers);
  const rows = (target?.targetRows || []).map(targetRow => headers.map(header => targetRow?.[header] ?? ''));
  return { headers, rows, raw: [headers, ...rows] };
}

function unique(values) {
  return new Set(values.filter(Boolean));
}

function isOwner(value) {
  return value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';
}

function invariantError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function compareRows(expectedRows, currentRows, headers) {
  const indexByOrder = rows => new Map(rows.map(row => [String(row['Order SN'] ?? '').trim(), row]));
  const expected = indexByOrder(expectedRows);
  const current = indexByOrder(currentRows);
  const mismatches = [];

  for (const [orderSn, expectedRow] of expected) {
    const currentRow = current.get(orderSn);
    if (!currentRow) {
      mismatches.push({ orderSn, field: 'ORDER_MISSING' });
      continue;
    }
    for (const header of headers) {
      if (String(expectedRow[header] ?? '') !== String(currentRow[header] ?? '')) {
        mismatches.push({ orderSn, field: header });
      }
    }
  }
  return mismatches;
}

function assertManifest(target) {
  const manifest = target?.resolutionManifest;
  if (!manifest?.loaded || manifest.records !== EXPECTED_RESOLUTIONS || manifest.resolved !== EXPECTED_RESOLUTIONS ||
      manifest.applied !== EXPECTED_RESOLUTIONS || manifest.unresolved !== 0) {
    throw invariantError('RESOLUTION_MANIFEST_INVALID', 'Approved Phase 5 manifest is not fully resolved and applied.');
  }
}

function targetCohorts(target) {
  const historical = target?.cohort?.historical || {
    orderCount: EXPECTED_HISTORICAL_ORDERS,
    logicalLineCount: EXPECTED_LOGICAL_LINES,
    settlementOwnerCount: EXPECTED_HISTORICAL_ORDERS,
    orderSns: []
  };
  const preservation = target?.cohort?.preservation || {
    orderCount: 0,
    logicalLineCount: 0,
    settlementOwnerCount: 0,
    orderSns: []
  };
  return { historical, preservation };
}

export function validateSalesLedgerProductionTarget(target) {
  if (!target) throw invariantError('TARGET_MISSING', 'Validated production migration target is required.');
  assertManifest(target);
  const matrix = targetToMatrix(target);
  if (matrix.headers.length !== EXPECTED_TARGET_HEADERS) {
    throw invariantError('TARGET_SCHEMA_INVALID', `Target must have ${EXPECTED_TARGET_HEADERS} headers.`);
  }
  if (matrix.headers[EXPECTED_BASE_HEADERS] !== SALES_LEDGER_LINE_KEY_HEADER ||
      matrix.headers[EXPECTED_BASE_HEADERS + 1] !== SALES_LEDGER_SETTLEMENT_OWNER_HEADER) {
    throw invariantError('TARGET_SCHEMA_INVALID', 'Target semantic headers must be append-only at columns 50 and 51.');
  }
  const cohorts = targetCohorts(target);
  if (cohorts.historical.orderCount !== EXPECTED_HISTORICAL_ORDERS ||
      cohorts.historical.logicalLineCount !== EXPECTED_LOGICAL_LINES ||
      cohorts.historical.settlementOwnerCount !== EXPECTED_HISTORICAL_ORDERS) {
    throw invariantError('TARGET_HISTORICAL_COHORT_INVALID', 'Target historical cohort must remain 332 orders, 351 lines, and 332 owners.');
  }
  const expectedLines = Number(cohorts.historical.logicalLineCount) + Number(cohorts.preservation.logicalLineCount || 0);
  const expectedOrders = Number(cohorts.historical.orderCount) + Number(cohorts.preservation.orderCount || 0);
  const expectedOwners = Number(cohorts.historical.settlementOwnerCount) + Number(cohorts.preservation.settlementOwnerCount || 0);
  if (matrix.rows.length !== expectedLines) {
    throw invariantError('TARGET_LINE_COUNT_INVALID', `Target must contain ${expectedLines} logical lines.`);
  }
  const rows = matrixToObjects(matrix);
  const orderSns = unique(rows.map(row => String(row['Order SN'] ?? '').trim()));
  const keys = rows.map(row => String(row[SALES_LEDGER_LINE_KEY_HEADER] ?? '').trim());
  const ledgerIds = rows.map(row => String(row['Ledger ID'] ?? '').trim());
  if (orderSns.size !== expectedOrders || keys.some(key => !key) || unique(keys).size !== keys.length ||
      ledgerIds.some(id => !id) || unique(ledgerIds).size !== ledgerIds.length) {
    throw invariantError('TARGET_IDENTITY_INVALID', 'Target has invalid order, logical-line, or Ledger ID identity.');
  }
  try {
    const settlements = getSalesLedgerSettlements(rows);
    if (settlements.length !== expectedOwners) {
      throw invariantError('TARGET_OWNER_INVALID', 'Target settlement owner count is invalid.');
    }
  } catch (error) {
    if (error.code) throw error;
    throw invariantError('TARGET_OWNER_INVALID', error.message);
  }
  for (const row of rows) {
    if (!isOwner(row[SALES_LEDGER_SETTLEMENT_OWNER_HEADER]) &&
        SALES_LEDGER_SETTLEMENT_FIELDS.some(field => String(row[field] ?? '') !== '')) {
      throw invariantError('TARGET_SETTLEMENT_DUPLICATION', 'Non-owner target row contains a protected settlement field.');
    }
  }
  return { matrix, rows, cohorts, fingerprint: sha256(matrix.raw) };
}

export class FileLeaseMigrationLock {
  constructor({ path, now = () => Date.now() } = {}) {
    this.path = path;
    this.now = now;
  }

  async acquire({ timeoutMs = 30000, staleAfterMs = 120000, ownerId = randomUUID() } = {}) {
    if (!this.path) throw invariantError('LOCK_CONFIGURATION_INVALID', 'Migration lock path is required.');
    const deadline = this.now() + timeoutMs;
    while (this.now() <= deadline) {
      try {
        const handle = await open(this.path, 'wx');
        const lockPath = this.path;
        const lease = { ownerId, acquiredAt: this.now(), expiresAt: this.now() + staleAfterMs };
        await handle.writeFile(JSON.stringify(lease));
        await handle.close();
        return {
          ownerId,
          async release() {
            try {
              const current = JSON.parse(await readFile(lockPath, 'utf8'));
              if (current.ownerId === ownerId) await unlink(lockPath);
            } catch (error) {
              if (error?.code !== 'ENOENT') throw error;
            }
          }
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const existing = JSON.parse(await readFile(this.path, 'utf8'));
          if (Number(existing.expiresAt || 0) <= this.now()) await unlink(this.path);
        } catch (readError) {
          if (readError?.code !== 'ENOENT') throw readError;
        }
      }
    }
    throw invariantError('LOCK_UNAVAILABLE', 'SalesLedger migration lock could not be acquired before timeout.');
  }
}

export class LocalMigrationArtifactStore {
  constructor({ directory }) {
    this.directory = directory;
  }

  async writeJson(name, value) {
    const path = resolve(this.directory, name);
    const tempPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
    await rename(tempPath, path);
    return path;
  }

  async writeBackup(snapshot) {
    const hash = sha256(snapshot.raw);
    const value = {
      capturedAt: new Date().toISOString(),
      headers: snapshot.headers,
      rows: snapshot.rows,
      rowCount: snapshot.rows.length,
      orderCount: unique(matrixToObjects(snapshot).map(row => String(row['Order SN'] ?? '').trim())).size,
      hash
    };
    await this.writeJson('salesledger-production-pre-migration-backup.json', value);
    const roundTrip = JSON.parse(await readFile(resolve(this.directory, 'salesledger-production-pre-migration-backup.json'), 'utf8'));
    if (roundTrip.hash !== hash || roundTrip.rowCount !== value.rowCount ||
        JSON.stringify(roundTrip.headers) !== JSON.stringify(value.headers) ||
        sha256([roundTrip.headers, ...roundTrip.rows]) !== hash) {
      throw invariantError('BACKUP_INVALID', 'Pre-migration backup validation failed.');
    }
    return value;
  }
}

function assertCurrentBaseline(current, expectedCohortRows, expectedPreservationRows = []) {
  if (current.headers.length !== EXPECTED_BASE_HEADERS) {
    if (current.headers.length === EXPECTED_TARGET_HEADERS) return { alreadyMigrated: true };
    throw invariantError('CURRENT_SCHEMA_INVALID', `Current SalesLedger must have ${EXPECTED_BASE_HEADERS} headers before migration.`);
  }
  const currentRows = matrixToObjects(current);
  const baselineRows = expectedCohortRows || [];
  const baselineOrders = unique(baselineRows.map(row => String(row['Order SN'] ?? '').trim()));
  if (baselineOrders.size !== EXPECTED_HISTORICAL_ORDERS) {
    throw invariantError('COHORT_BASELINE_INVALID', 'Expected historical cohort must contain 332 orders.');
  }
  const preservationOrders = unique(expectedPreservationRows.map(row => String(row['Order SN'] ?? '').trim()));
  const overlap = [...preservationOrders].filter(orderSn => baselineOrders.has(orderSn));
  if (overlap.length) {
    throw invariantError('COHORT_OVERLAP', 'Historical and preservation cohorts overlap.', { orderSn: overlap[0] });
  }
  const currentOrderRows = currentRows.filter(row => String(row['Order SN'] ?? '').trim());
  const unexpectedRows = currentOrderRows.filter(row => !baselineOrders.has(String(row['Order SN'] ?? '').trim()) && !preservationOrders.has(String(row['Order SN'] ?? '').trim()));
  if (unexpectedRows.length > 0) {
    throw invariantError('POST_BASELINE_LEDGER_ROWS_PRESENT', 'SalesLedger contains post-baseline rows outside the approved historical migration cohort.', {
      count: unexpectedRows.length,
      sampleOrderSns: unexpectedRows.slice(0, 10).map(row => row['Order SN'])
    });
  }
  const drift = compareRows(baselineRows, currentRows, current.headers);
  if (drift.length > 0) {
    throw invariantError('HISTORICAL_COHORT_DRIFT', 'Historical SalesLedger cohort changed after the approved dry-run.', { drift: drift.slice(0, 25) });
  }
  const preservationDrift = compareRows(expectedPreservationRows, currentRows, current.headers);
  if (preservationDrift.length > 0) {
    throw invariantError('PRESERVATION_COHORT_DRIFT', 'Post-baseline SalesLedger rows changed after the approved target was built.', { drift: preservationDrift.slice(0, 25) });
  }
  return { alreadyMigrated: false, currentRows };
}

function assertPostWrite(postMatrix, targetValidation, backup) {
  if (sha256(postMatrix.raw) !== targetValidation.fingerprint) {
    throw invariantError('POST_WRITE_TARGET_MISMATCH', 'Post-write SalesLedger does not match the approved target fingerprint.');
  }
  const postRows = matrixToObjects(postMatrix);
  const backupRows = matrixToObjects(backup);
  const backupByOrder = new Map(backupRows.map(row => [String(row['Order SN'] ?? '').trim(), row]));
  const ownerRows = getSalesLedgerSettlements(postRows);
  const financeMismatches = [];
  for (const owner of ownerRows) {
    const before = backupByOrder.get(String(owner['Order SN'] ?? '').trim());
    for (const field of SALES_LEDGER_SETTLEMENT_FIELDS) {
      if (String(before?.[field] ?? '') !== String(owner[field] ?? '')) {
        financeMismatches.push({ orderSn: owner['Order SN'], field });
      }
    }
  }
  if (financeMismatches.length) {
    throw invariantError('FINANCE_CONSERVATION_FAILED', 'Post-write settlement values are not conserved.', { financeMismatches });
  }
  return { rows: postRows, financeMismatches };
}

function assertExternalSnapshots(before, after) {
  if (sha256(before) !== sha256(after)) {
    throw invariantError('EXTERNAL_MUTATION_DETECTED', 'A protected non-SalesLedger snapshot changed during migration.');
  }
}

export async function executeSalesLedgerProductionMigration({
  target,
  expectedPreMigrationHash,
  expectedTargetFingerprint,
  expectedCohortRows,
  expectedPreservationRows = [],
  execute = false,
  ledgerRepository,
  lock,
  artifactStore,
  protectedSnapshot,
  writeScope,
  now = () => new Date().toISOString()
} = {}) {
  const targetValidation = validateSalesLedgerProductionTarget(target);
  if (execute && !expectedTargetFingerprint) {
    throw invariantError('TARGET_FINGERPRINT_REQUIRED', 'Production execution requires an approved target fingerprint.');
  }
  if (expectedTargetFingerprint && expectedTargetFingerprint !== targetValidation.fingerprint) {
    throw invariantError('TARGET_FINGERPRINT_MISMATCH', 'Approved target fingerprint does not match the supplied target.');
  }
  if (!execute) return { status: 'DRY_RUN_ONLY', writesExecuted: 0, targetFingerprint: targetValidation.fingerprint };
  if (!ledgerRepository?.getRawSalesLedgerMatrix || !ledgerRepository?.replaceSalesLedgerMatrix) {
    throw invariantError('LEDGER_WRITER_UNAVAILABLE', 'Dedicated SalesLedger repository reader and controlled replace writer are required.');
  }
  if (!lock?.acquire || !artifactStore?.writeBackup || !protectedSnapshot) {
    throw invariantError('EXECUTION_DEPENDENCY_MISSING', 'Production execution requires lock, backup store, and protected snapshots.');
  }
  if (ledgerRepository.sheetName !== 'SalesLedger') {
    throw invariantError('WRITE_SCOPE_INVALID', 'Production migration writer is restricted to SalesLedger.');
  }
  if (writeScope?.records?.some(sheetName => sheetName !== 'SalesLedger')) {
    throw invariantError('NON_SALESLEDGER_WRITE_DETECTED', 'Production migration attempted a non-SalesLedger write.');
  }

  const lease = await lock.acquire();
  let writeStarted = false;
  try {
    const current = normalizeMatrix(await ledgerRepository.getRawSalesLedgerMatrix());
    if (current.headers.length === EXPECTED_BASE_HEADERS && current.headers.some((header, index) => header !== targetValidation.matrix.headers[index])) {
      throw invariantError('HEADER_DRIFT', 'The first 49 SalesLedger headers do not exactly match the approved target.');
    }
    const state = assertCurrentBaseline(current, expectedCohortRows, expectedPreservationRows);
    if (state.alreadyMigrated) {
      if (sha256(current.raw) !== targetValidation.fingerprint) {
        throw invariantError('MIGRATION_STATE_AMBIGUOUS', 'SalesLedger has a migrated-width schema but does not match the approved target.');
      }
      return { status: 'ALREADY_MIGRATED', writesExecuted: 0, migrationAlreadyApplied: true };
    }
    if (expectedPreMigrationHash && sha256(current.raw) !== expectedPreMigrationHash) {
      throw invariantError('PRE_MIGRATION_HASH_MISMATCH', 'Fresh SalesLedger snapshot does not match the expected pre-migration hash.');
    }
    if (!expectedPreMigrationHash) {
      throw invariantError('PRE_MIGRATION_HASH_REQUIRED', 'Legacy SalesLedger execution requires an expected pre-migration hash.');
    }
    const backup = await artifactStore.writeBackup(current);
    const protectedBefore = await protectedSnapshot();

    const immediatelyBeforeWrite = normalizeMatrix(await ledgerRepository.getRawSalesLedgerMatrix());
    if (sha256(immediatelyBeforeWrite.raw) !== sha256(current.raw)) {
      throw invariantError('PRE_WRITE_DRIFT', 'SalesLedger changed after preflight and before the controlled write.');
    }
    writeScope?.record?.('SalesLedger');
    writeStarted = true;
    await ledgerRepository.replaceSalesLedgerMatrix(targetValidation.matrix.raw);
    const post = normalizeMatrix(await ledgerRepository.getRawSalesLedgerMatrix());
    const postVerification = assertPostWrite(post, targetValidation, current);
    const protectedAfter = await protectedSnapshot();
    assertExternalSnapshots(protectedBefore, protectedAfter);
    if (writeScope?.records?.some(sheetName => sheetName !== 'SalesLedger')) {
      throw invariantError('NON_SALESLEDGER_WRITE_DETECTED', 'Production migration attempted a non-SalesLedger write.');
    }
    const result = {
      status: 'EXECUTED',
      writesExecuted: 1,
      migrationAlreadyApplied: false,
      executedAt: now(),
      preMigrationHash: sha256(current.raw),
      postMigrationHash: sha256(post.raw),
      targetFingerprint: targetValidation.fingerprint,
      backupHash: backup.hash,
      orderCount: targetValidation.cohorts.historical.orderCount + targetValidation.cohorts.preservation.orderCount,
      logicalLineCount: targetValidation.cohorts.historical.logicalLineCount + targetValidation.cohorts.preservation.logicalLineCount,
      settlementOwnerCount: postVerification.rows.filter(row => isOwner(row[SALES_LEDGER_SETTLEMENT_OWNER_HEADER])).length,
      financeMismatches: postVerification.financeMismatches
    };
    await artifactStore.writeJson?.('salesledger-production-migration-execution.json', result);
    return result;
  } catch (error) {
    if (writeStarted) {
      await artifactStore.writeJson?.('salesledger-production-migration-failure.json', {
        status: 'FAILED_POST_WRITE_OR_WRITE',
        code: error.code || 'UNKNOWN',
        message: error.message,
        at: now()
      });
    }
    throw error;
  } finally {
    await lease.release();
  }
}
