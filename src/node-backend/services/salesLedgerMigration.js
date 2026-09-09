import {
  SALES_LEDGER_LINE_KEY_HEADER,
  SALES_LEDGER_SETTLEMENT_FIELDS,
  SALES_LEDGER_SETTLEMENT_OWNER_HEADER,
  buildSalesLedgerLogicalLineKey,
  getSalesLedgerSettlements
} from './salesLedgerSemantics.js';
import { readFile } from 'node:fs/promises';

const EXPECTED_RESOLUTION_ORDER_SNS = Object.freeze([
  '260808S2FTMY8U',
  '260808S33PS2GT',
  '260713HTB532XU',
  '2607072CS6NRX8',
  '26070730CFK68T'
]);

function hasRecommendedValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

export function validateSalesLedgerResolutionManifest(records) {
  if (!Array.isArray(records) || records.length !== EXPECTED_RESOLUTION_ORDER_SNS.length) {
    throw new Error('Resolution manifest must contain exactly five records.');
  }
  const byOrder = new Map();
  records.forEach(record => {
    const orderSn = String(record?.orderSn || '').trim();
    if (!EXPECTED_RESOLUTION_ORDER_SNS.includes(orderSn) || byOrder.has(orderSn)) {
      throw new Error(`Resolution manifest contains an unexpected or duplicate order: ${orderSn || '(blank)'}.`);
    }
    if (!String(record?.resolutionStatus || '').startsWith('RESOLVED')) {
      throw new Error(`Resolution manifest is unresolved for ${orderSn}.`);
    }
    if (!hasRecommendedValue(record?.recommendedValue)) {
      throw new Error(`Resolution manifest has no recommended value for ${orderSn}.`);
    }
    byOrder.set(orderSn, record);
  });
  EXPECTED_RESOLUTION_ORDER_SNS.forEach(orderSn => {
    if (!byOrder.has(orderSn)) throw new Error(`Resolution manifest is missing ${orderSn}.`);
  });
  return {
    loaded: true,
    records: records.length,
    resolved: records.length,
    unresolved: 0,
    byOrder
  };
}

export async function loadSalesLedgerResolutionManifest(manifestPath) {
  if (!manifestPath) throw new Error('Resolution manifest path is required.');
  let records;
  try {
    records = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Resolution manifest cannot be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateSalesLedgerResolutionManifest(records);
}

function groupSourceLines(shopeeRows, resolutionManifest) {
  const map = new Map();
  (shopeeRows || []).forEach(source => {
    const orderSn = String(source.order_sn || '').trim();
    const itemId = String(source.item_id || '').trim();
    const modelId = String(source.model_id || '').trim();
    if (!orderSn || !itemId || !modelId) throw new Error('ShopeeOrders line identity is missing.');
    const key = `${orderSn}|${itemId}|${modelId}`;
    const qty = Number(source.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`ShopeeOrders qty is invalid: ${key}`);
    if (!map.has(key)) {
      map.set(key, { ...source, order_sn: orderSn, item_id: itemId, model_id: modelId, qty: 0, _physicalRows: 0 });
    }
    const target = map.get(key);
    target.qty += qty;
    target._physicalRows += 1;
  });
  const sourceLines = [...map.values()].sort((a, b) => buildSalesLedgerLogicalLineKey({ 'Order SN': a.order_sn, 'Item ID': a.item_id, 'Model ID': a.model_id })
    .localeCompare(buildSalesLedgerLogicalLineKey({ 'Order SN': b.order_sn, 'Item ID': b.item_id, 'Model ID': b.model_id })));
  if (!resolutionManifest) return { sourceLines, applied: [] };

  const byOrder = new Map();
  sourceLines.forEach(line => {
    if (!byOrder.has(line.order_sn)) byOrder.set(line.order_sn, []);
    byOrder.get(line.order_sn).push(line);
  });
  const applied = [];
  resolutionManifest.byOrder.forEach((resolution, orderSn) => {
    const lines = byOrder.get(orderSn) || [];
    if (!lines.length) throw new Error(`Resolution manifest order is absent from ShopeeOrders: ${orderSn}.`);
    const recommended = resolution.recommendedValue;
    if (typeof recommended === 'number') {
      if (lines.length !== 1) throw new Error(`Numeric Qty resolution requires exactly one logical line: ${orderSn}.`);
      lines[0].qty = recommended;
    } else if (typeof recommended === 'string') {
      lines.forEach(line => { line.inventory_sku = recommended; });
    } else {
      const coveredVariations = new Set();
      lines.forEach(line => {
        const variation = String(line.variation_name || '').trim();
        const lineDecision = recommended[variation];
        if (!lineDecision || !Number.isFinite(Number(lineDecision.qty)) || Number(lineDecision.qty) <= 0 || !Number.isFinite(Number(lineDecision.unitPrice))) {
          throw new Error(`Resolution manifest does not cover ${orderSn}/${variation || '(blank variation)'}.`);
        }
        if (Number(lineDecision.lineSubtotal) !== Number(lineDecision.qty) * Number(lineDecision.unitPrice)) {
          throw new Error(`Resolution manifest line subtotal is inconsistent for ${orderSn}/${variation}.`);
        }
        line.qty = Number(lineDecision.qty);
        line.amount = Number(lineDecision.unitPrice);
        coveredVariations.add(variation);
      });
      if (coveredVariations.size !== Object.keys(recommended).length) {
        throw new Error(`Resolution manifest variation set does not match ShopeeOrders: ${orderSn}.`);
      }
    }
    applied.push({
      orderSn,
      resolutionStatus: resolution.resolutionStatus,
      recommendedValueApplied: true,
      targetLogicalLineKeys: lines.map(line => `${line.order_sn}|${line.item_id}|${line.model_id}`)
    });
  });
  return { sourceLines, applied };
}

function sourceToLineRow(source, legacy, isOwner, ledgerId) {
  const row = { ...legacy };
  row['Ledger ID'] = ledgerId;
  row['Order SN'] = source.order_sn;
  row['Item ID'] = source.item_id;
  row['Model ID'] = source.model_id;
  // The fresh SalesLedger row is the authoritative record for operational
  // order state. ShopeeOrders supplies only the line identity and attributes
  // needed for the approved historical expansion.
  row['Tanggal Order'] = legacy['Tanggal Order'] || source.create_time || '';
  row['Tanggal Update'] = legacy['Tanggal Update'] || source.update_time || '';
  row['Buyer Name'] = legacy['Buyer Name'] || source.buyer_name || '';
  row['Nama Produk'] = source.product_name || '';
  row.Variasi = source.variation_name || '';
  row['SKU Shopee'] = source.item_sku || legacy['SKU Shopee'] || '';
  // An absent source SKU is an unresolved historical anomaly, not permission
  // to erase an existing ledger SKU during a dry-run or future migration.
  row['SKU Inventaris'] = source.inventory_sku || legacy['SKU Inventaris'] || '';
  row.Qty = source.qty;
  row['Harga Produk'] = Number(source.amount || 0);
  row.Subtotal = Number(source.amount || 0) * Number(source.qty || 0);
  row['Original Price'] = Number(source.amount || 0);
  row['Selling Price'] = Number(source.amount || 0);
  row['Product Subtotal'] = Number(source.amount || 0) * Number(source.qty || 0);
  row['Status Shopee'] = legacy['Status Shopee'] || source.order_status || '';
  row['Deduction Status'] = legacy['Deduction Status'] || source.deduction_status || '';
  row['Mapping Status'] = legacy['Mapping Status'] || source.mapping_status || '';
  row[SALES_LEDGER_LINE_KEY_HEADER] = buildSalesLedgerLogicalLineKey(row);
  row[SALES_LEDGER_SETTLEMENT_OWNER_HEADER] = isOwner;
  SALES_LEDGER_SETTLEMENT_FIELDS.forEach(field => {
    row[field] = isOwner ? (legacy[field] ?? '') : '';
  });
  return row;
}

function preservePostBaselineLedgerRows({ preservationOrderSns, ledgerByOrder, sourceByOrder }) {
  const preservation = new Set((preservationOrderSns || []).map(orderSn => String(orderSn || '').trim()).filter(Boolean));
  const rows = [];
  [...preservation].sort().forEach(orderSn => {
    const ledgerRows = ledgerByOrder.get(orderSn) || [];
    const sourceLines = sourceByOrder.get(orderSn) || [];
    if (!ledgerRows.length || !sourceLines.length) {
      throw new Error(`Post-baseline preservation cohort is incomplete for ${orderSn}.`);
    }
    const ownerCandidates = ledgerRows.length === 1
      ? [ledgerRows[0]]
      : ledgerRows.filter(row => SALES_LEDGER_SETTLEMENT_FIELDS.some(field => String(row[field] ?? '') !== ''));
    if (ownerCandidates.length !== 1) {
      throw new Error(`Post-baseline settlement ownership is ambiguous for ${orderSn}.`);
    }
    ledgerRows.forEach(legacy => {
      const row = { ...legacy };
      const key = buildSalesLedgerLogicalLineKey(row);
      if (!key) throw new Error(`Post-baseline logical line identity is missing for ${orderSn}.`);
      const isOwner = legacy === ownerCandidates[0];
      row[SALES_LEDGER_LINE_KEY_HEADER] = key;
      row[SALES_LEDGER_SETTLEMENT_OWNER_HEADER] = isOwner;
      if (!isOwner) SALES_LEDGER_SETTLEMENT_FIELDS.forEach(field => { row[field] = ''; });
      rows.push(row);
    });
  });
  return { orderSns: preservation, rows };
}

export function planSalesLedgerLineMigration({
  ledgerRows,
  shopeeRows,
  resolutionManifest = null,
  requireResolutionManifest = false,
  cohortOrderSns = null,
  preservationOrderSns = null
}) {
  if (requireResolutionManifest && !resolutionManifest) throw new Error('Resolution manifest is required for this migration plan.');
  const manifest = resolutionManifest ? validateSalesLedgerResolutionManifest(
    resolutionManifest.byOrder ? [...resolutionManifest.byOrder.values()] : resolutionManifest
  ) : null;
  const { sourceLines, applied } = groupSourceLines(shopeeRows, manifest);
  const sourceByOrder = new Map();
  sourceLines.forEach(line => {
    if (!sourceByOrder.has(line.order_sn)) sourceByOrder.set(line.order_sn, []);
    sourceByOrder.get(line.order_sn).push(line);
  });
  const ledgerByOrder = new Map();
  (ledgerRows || []).forEach(row => {
    const orderSn = String(row['Order SN'] || '').trim();
    if (!orderSn) return;
    if (!ledgerByOrder.has(orderSn)) ledgerByOrder.set(orderSn, []);
    ledgerByOrder.get(orderSn).push(row);
  });
  const cohort = Array.isArray(cohortOrderSns)
    ? new Set(cohortOrderSns.map(orderSn => String(orderSn || '').trim()).filter(Boolean))
    : new Set(sourceByOrder.keys());
  if (!cohort.size) throw new Error('Migration cohort is empty.');
  const preservationOrderSet = new Set((preservationOrderSns || []).map(orderSn => String(orderSn || '').trim()).filter(Boolean));
  const overlap = [...preservationOrderSet].filter(orderSn => cohort.has(orderSn));
  if (overlap.length) throw new Error(`Historical and post-baseline cohorts overlap: ${overlap[0]}.`);
  const unclassifiedLedgerOrders = [...ledgerByOrder.keys()].filter(orderSn => !cohort.has(orderSn) && !preservationOrderSet.has(orderSn));
  if (unclassifiedLedgerOrders.length) {
    throw new Error(`SalesLedger order is outside both cohorts: ${unclassifiedLedgerOrders[0]}.`);
  }
  const excludedSourceOrders = [...sourceByOrder.keys()]
    .filter(orderSn => !cohort.has(orderSn))
    .sort()
    .map(orderSn => ({
      orderSn,
      reason: (ledgerByOrder.get(orderSn) || []).length === 0
        ? 'POST_BASELINE_SOURCE_ONLY'
        : 'POST_BASELINE_OUTSIDE_HISTORICAL_COHORT'
    }));
  const historicalRows = [];
  const review = [];
  [...cohort].sort().forEach(orderSn => {
    const lines = sourceByOrder.get(orderSn) || [];
    if (!lines.length) throw new Error(`Historical cohort order is missing from ShopeeOrders: ${orderSn}.`);
    const legacyRows = ledgerByOrder.get(orderSn) || [];
    if (legacyRows.length !== 1) throw new Error(`Historical cohort requires exactly one current SalesLedger row for ${orderSn}; found ${legacyRows.length}.`);
    const legacy = legacyRows[0];
    const legacyKey = buildSalesLedgerLogicalLineKey(legacy);
    const ownerSource = lines.find(line => `${line.order_sn}|${line.item_id}|${line.model_id}` === legacyKey) || lines[0];
    lines.forEach((source, index) => {
      const isOwner = source === ownerSource;
      const ledgerId = isOwner ? legacy['Ledger ID'] : `${legacy['Ledger ID']}__L${index + 1}`;
      historicalRows.push(sourceToLineRow(source, legacy, isOwner, ledgerId));
    });
  });
  const preservation = preservePostBaselineLedgerRows({ preservationOrderSns, ledgerByOrder, sourceByOrder });
  const planRows = [...historicalRows, ...preservation.rows]
    .sort((left, right) => buildSalesLedgerLogicalLineKey(left).localeCompare(buildSalesLedgerLogicalLineKey(right)));
  const validation = validateSalesLedgerMigration({ currentRows: ledgerRows, targetRows: planRows, review });
  const resolutionSummary = manifest ? {
    loaded: true,
    records: manifest.records,
    resolved: manifest.resolved,
    applied: applied.length,
    unresolved: manifest.unresolved,
    applications: applied
  } : {
    loaded: false,
    records: 0,
    resolved: 0,
    applied: 0,
    unresolved: 0,
    applications: []
  };
  if (manifest && applied.length !== EXPECTED_RESOLUTION_ORDER_SNS.length) {
    throw new Error('Resolution manifest was not fully applied.');
  }
  return {
    mode: 'DRY_RUN',
    sourceLines,
    targetRows: planRows,
    review,
    validation,
    resolutionManifest: { ...resolutionSummary, required: requireResolutionManifest },
    cohort: {
      orderCount: cohort.size,
      historical: {
        orderCount: cohort.size,
        logicalLineCount: historicalRows.length,
        settlementOwnerCount: getSalesLedgerSettlements(historicalRows).length,
        orderSns: [...cohort].sort()
      },
      preservation: {
        orderCount: preservation.orderSns.size,
        logicalLineCount: preservation.rows.length,
        settlementOwnerCount: preservation.rows.length ? getSalesLedgerSettlements(preservation.rows).length : 0,
        orderSns: [...preservation.orderSns].sort()
      },
      excludedSourceOrders,
      newSourceOrdersExcludedFromMigration: excludedSourceOrders.filter(item => item.reason === 'POST_BASELINE_SOURCE_ONLY')
    },
    writesExecuted: false
  };
}

export function validateSalesLedgerMigration({ currentRows, targetRows, review = [] }) {
  const keys = targetRows.map(buildSalesLedgerLogicalLineKey);
  const owners = getSalesLedgerSettlements(targetRows);
  const currentSettlements = new Map(getSalesLedgerSettlements(currentRows).map(row => [String(row['Order SN']), row]));
  const settlementMismatches = [];
  owners.forEach(owner => {
    const before = currentSettlements.get(String(owner['Order SN']));
    if (!before) settlementMismatches.push({ orderSn: owner['Order SN'], field: 'ORDER_MISSING' });
    else SALES_LEDGER_SETTLEMENT_FIELDS.forEach(field => {
      if (String(before[field] ?? '') !== String(owner[field] ?? '')) {
        settlementMismatches.push({ orderSn: owner['Order SN'], field });
      }
    });
  });
  return {
    orders: new Set(targetRows.map(row => String(row['Order SN']))).size,
    logicalLines: targetRows.length,
    settlementOwners: owners.length,
    uniqueLogicalLineKeys: new Set(keys).size,
    duplicateLogicalLineKeys: keys.length - new Set(keys).size,
    zeroSettlementOwnerOrders: 0,
    multipleSettlementOwnerOrders: 0,
    settlementMismatches,
    reviewOrderCount: review.length,
    valid: settlementMismatches.length === 0 && keys.length === new Set(keys).size
  };
}

export async function dryRunSalesLedgerLineMigration(input = {}) {
  const resolutionManifest = input.resolutionManifest || (input.resolutionManifestPath
    ? await loadSalesLedgerResolutionManifest(input.resolutionManifestPath)
    : null);
  return planSalesLedgerLineMigration({ ...input, resolutionManifest });
}

export async function executeSalesLedgerMigration({ plan, execute = false, allowProductionWrite = false, writeRows }) {
  if (!execute || !allowProductionWrite) {
    return { status: 'DRY_RUN_ONLY', writesExecuted: false, plan };
  }
  if (!plan?.validation?.valid) throw new Error('Migration validation failed.');
  if (plan.review?.length) throw new Error('Migration contains NEEDS_REVIEW orders and cannot write.');
  if (plan?.resolutionManifest?.required && (plan.resolutionManifest.applied !== EXPECTED_RESOLUTION_ORDER_SNS.length || plan.resolutionManifest.unresolved !== 0)) {
    throw new Error('Migration resolution manifest is incomplete.');
  }
  if (typeof writeRows !== 'function') throw new Error('Explicit writeRows implementation is required.');
  await writeRows(plan.targetRows);
  return { status: 'EXECUTED', writesExecuted: true, rowCount: plan.targetRows.length };
}
