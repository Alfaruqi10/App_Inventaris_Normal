const APPROVED_STATUSES = new Set([
  "PROCESSED",
  "READY_TO_SHIP",
  "SHIPPED",
  "TO_CONFIRM_RECEIVE",
  "COMPLETED"
]);
const CANCELLED_STATUSES = new Set(["CANCELLED", "IN_CANCEL"]);

const MOVING_ORDER = { FAST: 0, MIDDLE: 1, SLOW: 2 };

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWibDate(value) {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function isoDate(value) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compareIdentity(left, right) {
  return ["productName", "color", "size", "sku"]
    .map((key) => text(left[key]).localeCompare(text(right[key])))
    .find(Boolean) || 0;
}

export function movingFromValue(value, fastThreshold = 16) {
  if (value >= fastThreshold) return "FAST";
  if (value >= 1) return "MIDDLE";
  return "SLOW";
}

export function createMasterIdentityBySku(masterRows) {
  const identities = new Map();
  for (const row of masterRows || []) {
    const sku = text(row["Kode Barang"] || row.SKU);
    if (!sku) continue;
    identities.set(sku, {
      sku,
      productName: text(row["Nama Barang"] || row.ProductName),
      color: text(row.Warna || row.Color),
      size: text(row.Ukuran || row.Size)
    });
  }
  return identities;
}

export function parseSalesLedgerRows(matrix) {
  const [headers = [], ...records] = matrix || [];
  return records.map((values, sourceIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      sourceIndex: sourceIndex + 2,
      orderSn: text(row["Order SN"]),
      date: parseWibDate(row["Tanggal Order"]),
      rawDate: text(row["Tanggal Order"]),
      status: text(row["Status Shopee"]),
      rawSku: text(row["SKU Inventaris"]),
      qty: number(row.Qty),
      row
    };
  }).filter((row) => row.orderSn && row.date && row.rawSku && row.qty > 0);
}

export function buildLedgerContributions(ledgerRows, identityBySku, allocationMode = "expanded") {
  const contributions = [];
  const unresolvedAllocations = [];
  for (const row of ledgerRows || []) {
    const skus = row.rawSku.split(";").map(text).filter(Boolean);
    if (allocationMode === "raw") {
      const identity = identityBySku.get(row.rawSku);
      if (!identity) {
        if (skus.length > 1) unresolvedAllocations.push({ sourceIndex: row.sourceIndex, orderSn: row.orderSn, reason: "MULTI_SKU_DIRECT_LOOKUP_MISS", rawSku: row.rawSku });
        continue;
      }
      contributions.push({ ...row, ...identity, allocatedQty: row.qty, allocation: "RAW_DIRECT" });
      continue;
    }

    if (skus.length === 1) {
      const identity = identityBySku.get(skus[0]);
      if (!identity) {
        unresolvedAllocations.push({ sourceIndex: row.sourceIndex, orderSn: row.orderSn, reason: "UNKNOWN_SKU", rawSku: row.rawSku });
        continue;
      }
      contributions.push({ ...row, ...identity, allocatedQty: row.qty, allocation: "SINGLE_SKU" });
      continue;
    }

    if (skus.length !== row.qty) {
      unresolvedAllocations.push({ sourceIndex: row.sourceIndex, orderSn: row.orderSn, reason: "MULTI_SKU_QTY_MISMATCH", rawSku: row.rawSku, qty: row.qty });
      continue;
    }
    const identities = skus.map((sku) => identityBySku.get(sku));
    if (identities.some((identity) => !identity)) {
      unresolvedAllocations.push({ sourceIndex: row.sourceIndex, orderSn: row.orderSn, reason: "MULTI_SKU_UNKNOWN_IDENTITY", rawSku: row.rawSku });
      continue;
    }
    identities.forEach((identity) => contributions.push({ ...row, ...identity, allocatedQty: 1, allocation: "EXPANDED_MULTI_SKU" }));
  }
  return { contributions, unresolvedAllocations };
}

function groupKey(contribution, grouping) {
  if (grouping === "sku" || grouping === "product_color_size") return contribution.sku;
  if (grouping === "product_color") return `${contribution.productName}\u0000${contribution.color}`;
  if (grouping === "product" || grouping === "parent_product") return contribution.productName;
  throw new Error(`Unknown grouping: ${grouping}`);
}

function inWindow(date, asOfDate, window) {
  if (window === "all_history") return date <= asOfDate;
  const business = String(window).match(/^(\d+)_business$/);
  if (business) {
    let remaining = Number(business[1]);
    let cursor = asOfDate;
    while (cursor >= addDays(asOfDate, -60)) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        if (date.getTime() === cursor.getTime()) return true;
        remaining -= 1;
        if (remaining === 0) return false;
      }
      cursor = addDays(cursor, -1);
    }
    return false;
  }
  const calendarDays = Number(String(window).replace("_calendar", ""));
  if (!Number.isFinite(calendarDays)) throw new Error(`Unknown window: ${window}`);
  const start = addDays(asOfDate, -(calendarDays - 1));
  return date >= start && date <= asOfDate;
}

function matchesStatus(contribution, statusSet) {
  if (statusSet === "all") return true;
  if (statusSet === "exclude_cancelled") return !CANCELLED_STATUSES.has(contribution.status);
  if (statusSet === "approved" || statusSet === "existing_production_statuses") return APPROVED_STATUSES.has(contribution.status);
  throw new Error(`Unknown status set: ${statusSet}`);
}

export function evaluateMovingCandidate({ contributions, goldenRows, asOfDate, grouping, window, measure, statusSet = "approved", fastThreshold = 16 }) {
  const asOf = typeof asOfDate === "string" ? parseWibDate(asOfDate) : asOfDate;
  const values = new Map();
  const seenOrders = new Map();
  for (const contribution of contributions || []) {
    if (!matchesStatus(contribution, statusSet) || !inWindow(contribution.date, asOf, window)) continue;
    const key = groupKey(contribution, grouping);
    if (measure === "qty") values.set(key, (values.get(key) || 0) + contribution.allocatedQty);
    else if (measure === "order_count") {
      const orderKey = `${key}\u0000${contribution.orderSn}`;
      if (!seenOrders.has(orderKey)) {
        values.set(key, (values.get(key) || 0) + 1);
        seenOrders.set(orderKey, true);
      }
    } else throw new Error(`Unknown measure: ${measure}`);
  }

  const rows = (goldenRows || []).map((golden) => {
    const lookup = groupKey({ sku: golden.sku, productName: golden.product, color: golden.color, size: golden.size }, grouping);
    const value = values.get(lookup) || 0;
    const actual = movingFromValue(value, fastThreshold);
    return { sku: golden.sku, expected: golden.moving, actual, value, match: actual === golden.moving };
  });
  const counts = { FAST: { matched: 0, total: 0 }, MIDDLE: { matched: 0, total: 0 }, SLOW: { matched: 0, total: 0 } };
  rows.forEach((row) => {
    counts[row.expected].total += 1;
    if (row.match) counts[row.expected].matched += 1;
  });
  return {
    formula: { grouping, window, measure, statusSet, fastThreshold, asOfDate: isoDate(asOf) },
    rows,
    mismatches: rows.filter((row) => !row.match),
    matches: rows.filter((row) => row.match).length,
    total: rows.length,
    counts
  };
}

export function traceMovingCandidate({ contributions, target, asOfDate, grouping, window, measure, statusSet = "approved", fastThreshold = 16 }) {
  const asOf = typeof asOfDate === "string" ? parseWibDate(asOfDate) : asOfDate;
  const identity = {
    sku: target && target.sku,
    productName: target && (target.productName || target.product),
    color: target && target.color,
    size: target && target.size
  };
  const key = groupKey(identity, grouping);
  const seenOrders = new Set();
  let value = 0;
  const rows = (contributions || []).filter((contribution) => groupKey(contribution, grouping) === key).map((contribution) => {
    const statusIncluded = matchesStatus(contribution, statusSet);
    const timeIncluded = inWindow(contribution.date, asOf, window);
    let included = statusIncluded && timeIncluded;
    let reason = included ? "INCLUDED" : (!statusIncluded ? "STATUS_POLICY" : "OUTSIDE_WINDOW");
    if (included && measure === "order_count") {
      const orderKey = `${key}\u0000${contribution.orderSn}`;
      if (seenOrders.has(orderKey)) {
        included = false;
        reason = "DUPLICATE_ORDER_FOR_GROUP";
      } else {
        seenOrders.add(orderKey);
      }
    }
    if (included) value += measure === "qty" ? contribution.allocatedQty : 1;
    return {
      sku: contribution.sku, product: contribution.productName, color: contribution.color, size: contribution.size,
      date: contribution.rawDate, status: contribution.status, qty: contribution.allocatedQty, included, reason
    };
  });
  return { rows, value, moving: movingFromValue(value, fastThreshold) };
}

export function rankSalesLedger({ contributions, asOfDate, window = "all_history", measure = "qty", statusSet = "approved" }) {
  const asOf = typeof asOfDate === "string" ? parseWibDate(asOfDate) : asOfDate;
  const totals = new Map();
  const orderSeen = new Set();
  for (const contribution of contributions || []) {
    if (!matchesStatus(contribution, statusSet) || !inWindow(contribution.date, asOf, window)) continue;
    const current = totals.get(contribution.sku) || { ...contribution, salesQty: 0 };
    if (measure === "qty") current.salesQty += contribution.allocatedQty;
    else {
      const key = `${contribution.sku}\u0000${contribution.orderSn}`;
      if (!orderSeen.has(key)) {
        current.salesQty += 1;
        orderSeen.add(key);
      }
    }
    totals.set(contribution.sku, current);
  }
  return [...totals.values()]
    .sort((left, right) => right.salesQty - left.salesQty || compareIdentity(left, right))
    .map((entry, index) => ({ ...entry, calculatedRank: index + 1 }));
}

export function compareRankingReference(rankedRows, rankingRecords) {
  const actualBySku = new Map((rankedRows || []).map((row) => [row.sku, row]));
  const unresolvedRanks = (rankingRecords || [])
    .filter((row) => text(row.ValidationStatus) === "UNRESOLVED")
    .map((row) => number(row.Rank));
  const valid = (rankingRecords || []).filter((row) => text(row.ValidationStatus) === "VALID");
  const rows = valid.map((reference) => {
    const actual = actualBySku.get(text(reference.SKU));
    const expectedRank = number(reference.Rank);
    const expectedResolvedRank = expectedRank - unresolvedRanks.filter((rank) => rank < expectedRank).length;
    return {
      sku: text(reference.SKU),
      expectedRank,
      expectedResolvedRank,
      expectedSalesQty: number(reference.SalesQty),
      actualRank: actual?.calculatedRank ?? null,
      actualSalesQty: actual?.salesQty ?? 0,
      quantityMatch: actual?.salesQty === number(reference.SalesQty),
      rankMatch: actual?.calculatedRank === expectedRank,
      resolvedRankMatch: actual?.calculatedRank === expectedResolvedRank
    };
  });
  return {
    total: rows.length,
    quantityMatches: rows.filter((row) => row.quantityMatch).length,
    rankMatches: rows.filter((row) => row.rankMatch).length,
    resolvedRankMatches: rows.filter((row) => row.resolvedRankMatch).length,
    bothMatches: rows.filter((row) => row.quantityMatch && row.rankMatch).length,
    rows,
    mismatches: rows.filter((row) => !row.quantityMatch || !row.rankMatch)
  };
}

export { APPROVED_STATUSES, CANCELLED_STATUSES, MOVING_ORDER, parseWibDate };
