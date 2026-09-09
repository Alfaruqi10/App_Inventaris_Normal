export const SALES_LEDGER_LINE_KEY_HEADER = 'Logical Line Key';
export const SALES_LEDGER_SETTLEMENT_OWNER_HEADER = 'Settlement Owner';

export const SALES_LEDGER_SETTLEMENT_FIELDS = Object.freeze([
  'Voucher', 'Ongkir', 'Biaya Admin', 'Biaya Layanan', 'Total Dibayar',
  'Estimasi Pendapatan', 'Voucher Total', 'Shopee Voucher', 'Seller Voucher',
  'Shop Voucher', 'Shipping Fee Buyer', 'Shipping Subsidy Shopee',
  'Shipping Subsidy Seller', 'Commission Fee', 'Service Fee', 'Campaign Fee',
  'Transaction Fee', 'Adjustment', 'Refund', 'Other Fee', 'Escrow Amount',
  'Net Income', 'Payment Method', 'Settlement Status', 'Settlement Sync'
]);

export const SALES_LEDGER_LINE_FIELDS = Object.freeze([
  'Item ID', 'Model ID', 'Nama Produk', 'Variasi', 'SKU Shopee',
  'SKU Inventaris', 'Qty', 'Harga Produk', 'Subtotal', 'Original Price',
  'Selling Price', 'Product Subtotal'
]);

export function buildSalesLedgerLogicalLineKey(row) {
  const orderSn = String(row?.['Order SN'] ?? row?.order_sn ?? '').trim();
  const itemId = String(row?.['Item ID'] ?? row?.item_id ?? '').trim();
  const modelId = String(row?.['Model ID'] ?? row?.model_id ?? '').trim();
  if (!orderSn || !itemId || !modelId) return '';
  return `${orderSn}|${itemId}|${modelId}`;
}

export function isSalesLedgerSettlementOwner(value) {
  return value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';
}

function hasOwnerHeader(rows) {
  return rows.some(row => Object.prototype.hasOwnProperty.call(row || {}, SALES_LEDGER_SETTLEMENT_OWNER_HEADER));
}

function cloneWithSemantics(row) {
  const logicalLineKey = String(row?.[SALES_LEDGER_LINE_KEY_HEADER] || '').trim() || buildSalesLedgerLogicalLineKey(row);
  return { ...row, [SALES_LEDGER_LINE_KEY_HEADER]: logicalLineKey };
}

export function getSalesLedgerLines(rows, options = {}) {
  const strict = options.strict !== false;
  const lines = (rows || []).map(cloneWithSemantics).filter(row => row['Order SN']);
  const seen = new Set();
  lines.forEach(row => {
    const key = row[SALES_LEDGER_LINE_KEY_HEADER];
    if (!key && strict) throw new Error('SalesLedger line identity is missing.');
    if (key && seen.has(key)) throw new Error(`Duplicate SalesLedger logical line: ${key}`);
    if (key) seen.add(key);
  });
  return lines;
}

export function getSalesLedgerOrders(rows, options = {}) {
  const groups = new Map();
  getSalesLedgerLines(rows, options).forEach(line => {
    const orderSn = String(line['Order SN'] || '').trim();
    if (!groups.has(orderSn)) groups.set(orderSn, { ...line, lines: [], orderSn });
    groups.get(orderSn).lines.push(line);
  });
  return [...groups.values()];
}

export function getSalesLedgerSettlements(rows, options = {}) {
  const strict = options.strict !== false;
  const lines = getSalesLedgerLines(rows, { strict });
  const ownerColumnExists = hasOwnerHeader(lines);
  const byOrder = new Map();
  lines.forEach(line => {
    const orderSn = String(line['Order SN'] || '').trim();
    if (!byOrder.has(orderSn)) byOrder.set(orderSn, []);
    byOrder.get(orderSn).push(line);
  });

  const settlements = [];
  byOrder.forEach((orderLines, orderSn) => {
    let owners = ownerColumnExists
      ? orderLines.filter(line => isSalesLedgerSettlementOwner(line[SALES_LEDGER_SETTLEMENT_OWNER_HEADER]))
      : orderLines;
    if (owners.length !== 1) {
      throw new Error(`Settlement owner invariant failed for ${orderSn}: ${owners.length}.`);
    }
    settlements.push({ ...owners[0], _legacySettlementOwner: !ownerColumnExists });
  });
  return settlements;
}

export function getSalesLedgerOrderSummary(rows, options = {}) {
  const orders = getSalesLedgerOrders(rows, options);
  const settlements = new Map(getSalesLedgerSettlements(rows, options).map(row => [String(row['Order SN']), row]));
  return orders.map(order => ({
    orderSn: order.orderSn,
    order: { ...order, lines: undefined },
    lines: order.lines,
    settlement: settlements.get(order.orderSn) || null
  }));
}

export function getSalesLedgerLineSummary(rows, options = {}) {
  const lines = getSalesLedgerLines(rows, options);
  return {
    lines,
    lineCount: lines.length,
    totalQty: lines.reduce((sum, row) => sum + Number(row.Qty || 0), 0),
    grossProductRevenue: lines.reduce((sum, row) => sum + Number(row['Product Subtotal'] || row.Subtotal || 0), 0)
  };
}

export function sumSalesLedgerSettlementFields(rows, fields = SALES_LEDGER_SETTLEMENT_FIELDS, options = {}) {
  const result = {};
  fields.forEach(field => { result[field] = 0; });
  getSalesLedgerSettlements(rows, options).forEach(row => {
    fields.forEach(field => { result[field] += Number(row[field] || 0); });
  });
  return result;
}
