// SalesLedger line-level semantics. All schema mutation is explicit; reads are safe by default.
const SALES_LEDGER_LOGICAL_LINE_KEY_HEADER = "Logical Line Key";
const SALES_LEDGER_SETTLEMENT_OWNER_HEADER = "Settlement Owner";
const SALES_LEDGER_LINE_SCHEMA_HEADERS = [
  SALES_LEDGER_LOGICAL_LINE_KEY_HEADER,
  SALES_LEDGER_SETTLEMENT_OWNER_HEADER
];
const SALES_LEDGER_SETTLEMENT_FIELDS_V3 = [
  "Voucher", "Ongkir", "Biaya Admin", "Biaya Layanan", "Total Dibayar",
  "Estimasi Pendapatan", "Voucher Total", "Shopee Voucher", "Seller Voucher",
  "Shop Voucher", "Shipping Fee Buyer", "Shipping Subsidy Shopee",
  "Shipping Subsidy Seller", "Commission Fee", "Service Fee", "Campaign Fee",
  "Transaction Fee", "Adjustment", "Refund", "Other Fee", "Escrow Amount",
  "Net Income", "Payment Method", "Settlement Status", "Settlement Sync"
];

function buildSalesLedgerLogicalLineKey(row) {
  row = row || {};
  var orderSn = String(row["Order SN"] || row.order_sn || "").trim();
  var itemId = String(row["Item ID"] || row.item_id || "").trim();
  var modelId = String(row["Model ID"] || row.model_id || "").trim();
  return orderSn && itemId && modelId ? orderSn + "|" + itemId + "|" + modelId : "";
}

function isSalesLedgerSettlementOwner(value) {
  return value === true || String(value || "").trim().toUpperCase() === "TRUE";
}

function getSalesLedgerSchemaDefinition() {
  var baseHeaders = SALES_LEDGER_HEADERS.filter(function(header) {
    return SALES_LEDGER_LINE_SCHEMA_HEADERS.indexOf(header) < 0;
  });
  return {
    baseHeaders: baseHeaders,
    lineHeaders: SALES_LEDGER_LINE_SCHEMA_HEADERS.slice(),
    requiredHeaders: SALES_LEDGER_HEADERS.slice(),
    settlementFields: SALES_LEDGER_SETTLEMENT_FIELDS_V3.slice()
  };
}

function inspectSalesLedgerLineSchema(sheet) {
  if (!sheet || sheet.getLastRow() < 1) {
    return { ready: false, reason: "SHEET_OR_HEADER_MISSING", headers: [], missingHeaders: SALES_LEDGER_LINE_SCHEMA_HEADERS.slice() };
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(header) { return String(header || "").trim(); });
  var missing = SALES_LEDGER_LINE_SCHEMA_HEADERS.filter(function(header) { return headers.indexOf(header) < 0; });
  return { ready: missing.length === 0, headers: headers, missingHeaders: missing };
}

function ensureSalesLedgerLineSchema(options) {
  options = options || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SALES_LEDGER_SHEET);
  var inspection = inspectSalesLedgerLineSchema(sheet);
  if (inspection.ready || options.allowWrite !== true) {
    return { status: inspection.ready ? "READY" : "SCHEMA_MIGRATION_REQUIRED", writesExecuted: false, inspection: inspection };
  }
  if (!sheet) return { status: "SCHEMA_MIGRATION_REQUIRED", writesExecuted: false, inspection: inspection };
  sheet.getRange(1, sheet.getLastColumn() + 1, 1, inspection.missingHeaders.length).setValues([inspection.missingHeaders]);
  return { status: "MIGRATED", writesExecuted: true, inspection: inspectSalesLedgerLineSchema(sheet) };
}

function getSalesLedgerLineOperationalReadiness() {
  var schema = ensureSalesLedgerLineSchema({ allowWrite: false });
  if (schema.status !== "READY") {
    return { ready: false, reason: schema.status, schema: schema };
  }
  try {
    var rows = _slReadAllRows().rows || [];
    var settlements = getSalesLedgerSettlements({ rows: rows, strict: false });
    return {
      ready: true,
      orderCount: settlements.length,
      settlementOwnerCount: settlements.length
    };
  } catch (error) {
    return { ready: false, reason: "MIGRATION_REQUIRED", message: String(error || "") };
  }
}

function getSalesLedgerLines(options) {
  options = options || {};
  var rows = options.rows || _slReadAllRows().rows || [];
  var strict = options.strict !== false;
  var seen = {};
  return rows.filter(function(row) { return String(row["Order SN"] || "").trim(); }).map(function(row) {
    var copy = {};
    Object.keys(row).forEach(function(key) { copy[key] = row[key]; });
    copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER] = String(copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER] || "").trim() || buildSalesLedgerLogicalLineKey(copy);
    if (strict && !copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER]) throw new Error("SalesLedger logical line identity is missing.");
    if (copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER]) {
      if (seen[copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER]]) throw new Error("Duplicate SalesLedger logical line: " + copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER]);
      seen[copy[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER]] = true;
    }
    return copy;
  });
}

function getSalesLedgerOrders(options) {
  var groups = {};
  getSalesLedgerLines(options).forEach(function(line) {
    var orderSn = String(line["Order SN"] || "").trim();
    if (!groups[orderSn]) groups[orderSn] = { orderSn: orderSn, order: line, lines: [] };
    groups[orderSn].lines.push(line);
  });
  return Object.keys(groups).map(function(orderSn) { return groups[orderSn]; });
}

function getSalesLedgerSettlements(options) {
  var lines = getSalesLedgerLines(options);
  var hasOwnerHeader = lines.some(function(line) { return Object.prototype.hasOwnProperty.call(line, SALES_LEDGER_SETTLEMENT_OWNER_HEADER); });
  var groups = {};
  lines.forEach(function(line) {
    var orderSn = String(line["Order SN"] || "").trim();
    if (!groups[orderSn]) groups[orderSn] = [];
    groups[orderSn].push(line);
  });
  return Object.keys(groups).map(function(orderSn) {
    var owners = hasOwnerHeader ? groups[orderSn].filter(function(line) {
      return isSalesLedgerSettlementOwner(line[SALES_LEDGER_SETTLEMENT_OWNER_HEADER]);
    }) : groups[orderSn];
    if (owners.length !== 1) throw new Error("Settlement owner invariant failed for " + orderSn + ": " + owners.length);
    owners[0]._legacySettlementOwner = !hasOwnerHeader;
    return owners[0];
  });
}

function getSalesLedgerOrderSummary(options) {
  var settlements = {};
  getSalesLedgerSettlements(options).forEach(function(row) { settlements[String(row["Order SN"] || "").trim()] = row; });
  return getSalesLedgerOrders(options).map(function(order) {
    return { orderSn: order.orderSn, order: order.order, lines: order.lines, settlement: settlements[order.orderSn] || null };
  });
}

function getSalesLedgerLineSummary(options) {
  var lines = getSalesLedgerLines(options);
  return {
    lines: lines,
    lineCount: lines.length,
    totalQty: lines.reduce(function(sum, row) { return sum + Number(row["Qty"] || 0); }, 0),
    grossProductRevenue: lines.reduce(function(sum, row) { return sum + Number(row["Product Subtotal"] || row["Subtotal"] || 0); }, 0)
  };
}

function getSalesLedgerSettlementSummary(options) {
  var totals = {};
  SALES_LEDGER_SETTLEMENT_FIELDS_V3.forEach(function(field) { totals[field] = 0; });
  getSalesLedgerSettlements(options).forEach(function(row) {
    SALES_LEDGER_SETTLEMENT_FIELDS_V3.forEach(function(field) { totals[field] += Number(row[field] || 0); });
  });
  return totals;
}

function updateSalesLedger(options) {
  options = options || {};
  if (options.dryRun !== true && options.executeWrite === undefined) options.executeWrite = true;
  return updateSalesLedgerLineLevel(options);
}

function updateSalesLedgerLineLevel(options) {
  options = options || {};
  var ownsLock = options.lockAlreadyHeld !== true;
  var lock = ownsLock ? LockService.getScriptLock() : null;
  if (ownsLock) lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ledgerSheet = ss.getSheetByName(SALES_LEDGER_SHEET);
    var schema = ensureSalesLedgerLineSchema({ allowWrite: options.allowSchemaMigration === true });
    if (!ledgerSheet || schema.status !== "READY" && schema.status !== "MIGRATED") {
      return { status: "SCHEMA_MIGRATION_REQUIRED", writesExecuted: false, schema: schema };
    }
    var sourceSheet = ss.getSheetByName(SHOPEE_ORDERS_SHEET);
    if (!sourceSheet || sourceSheet.getLastRow() < 2) {
      return { status: "success", newCount: 0, updatedCount: 0, writesExecuted: false };
    }
    var sourceData = sourceSheet.getDataRange().getValues();
    var sourceCol = {};
    sourceData[0].forEach(function(header, index) { sourceCol[String(header || "").trim()] = index; });
    ["order_sn", "item_id", "model_id", "qty"].forEach(function(header) {
      if (sourceCol[header] === undefined) throw new Error("ShopeeOrders column missing: " + header);
    });
    var ledgerData = ledgerSheet.getDataRange().getValues();
    var ledgerCol = getSalesLedgerColMap(ledgerData[0]);
    SALES_LEDGER_LINE_SCHEMA_HEADERS.forEach(function(header) {
      if (ledgerCol[header] === undefined) throw new Error("SalesLedger schema missing: " + header);
    });

    var existingByKey = {};
    var existingOwnerByOrder = {};
    var existingOrderRows = {};
    var existingOwnerCounts = {};
    var duplicateExistingKeys = [];
    for (var existingIndex = 1; existingIndex < ledgerData.length; existingIndex++) {
      var existingRow = ledgerData[existingIndex];
      var existingObject = {};
      Object.keys(ledgerCol).forEach(function(header) { existingObject[header] = existingRow[ledgerCol[header]]; });
      var existingOrderSn = String(existingObject["Order SN"] || "").trim();
      if (existingOrderSn) {
        existingOrderRows[existingOrderSn] = (existingOrderRows[existingOrderSn] || 0) + 1;
      }
      var existingKey = String(existingObject[SALES_LEDGER_LOGICAL_LINE_KEY_HEADER] || "").trim() || buildSalesLedgerLogicalLineKey(existingObject);
      if (existingKey) {
        if (existingByKey[existingKey]) duplicateExistingKeys.push(existingKey);
        else existingByKey[existingKey] = { rowIndex: existingIndex, row: existingRow };
      }
      if (isSalesLedgerSettlementOwner(existingObject[SALES_LEDGER_SETTLEMENT_OWNER_HEADER])) {
        existingOwnerByOrder[existingOrderSn] = existingRow;
        existingOwnerCounts[existingOrderSn] = (existingOwnerCounts[existingOrderSn] || 0) + 1;
      }
    }

    if (duplicateExistingKeys.length > 0) {
      return {
        status: "INVARIANT_FAILED",
        writesExecuted: false,
        duplicateLogicalLineKeys: duplicateExistingKeys.slice(0, 10)
      };
    }

    // A header-only schema upgrade is not a data migration. Refuse writer activity
    // until every historical order has the single settlement owner required by V3.
    var legacyOrders = Object.keys(existingOrderRows).filter(function(orderSn) {
      return existingOwnerCounts[orderSn] !== 1;
    });
    if (legacyOrders.length > 0 && options.allowLegacyExpansion !== true) {
      return {
        status: "MIGRATION_REQUIRED",
        writesExecuted: false,
        legacyOrderCount: legacyOrders.length,
        sampleOrderSns: legacyOrders.slice(0, 10)
      };
    }

    var groups = {};
    for (var sourceIndex = 1; sourceIndex < sourceData.length; sourceIndex++) {
      var source = sourceData[sourceIndex];
      var orderSn = String(source[sourceCol.order_sn] || "").trim();
      var itemId = String(source[sourceCol.item_id] || "").trim();
      var modelId = String(source[sourceCol.model_id] || "").trim();
      var qty = Number(source[sourceCol.qty] || 0);
      if (!orderSn || !itemId || !modelId || !isFinite(qty) || qty <= 0) continue;
      var lineKey = orderSn + "|" + itemId + "|" + modelId;
      if (!groups[orderSn]) groups[orderSn] = {};
      if (!groups[orderSn][lineKey]) {
        groups[orderSn][lineKey] = {
          orderSn: orderSn, itemId: itemId, modelId: modelId, qty: 0,
          product: String(source[sourceCol.product_name] || ""),
          variation: String(source[sourceCol.variation_name] || ""),
          shopeeSku: String(source[sourceCol.item_sku] || ""),
          inventorySku: String(source[sourceCol.inventory_sku] || ""),
          amount: Number(source[sourceCol.amount] || 0),
          status: String(source[sourceCol.order_status] || ""),
          buyer: String(source[sourceCol.buyer_name] || ""),
          createdAt: source[sourceCol.create_time], updatedAt: source[sourceCol.update_time],
          mappingStatus: String(source[sourceCol.mapping_status] || ""),
          deductionStatus: String(source[sourceCol.deduction_status] || "")
        };
      }
      groups[orderSn][lineKey].qty += qty;
    }

    var targetOrderSet = {};
    if (Array.isArray(options.orderSns)) {
      options.orderSns.forEach(function(orderSn) { targetOrderSet[String(orderSn || "").trim()] = true; });
    }
    var now = new Date();
    var appended = [];
    var updated = 0;
    Object.keys(groups).forEach(function(orderSn) {
      if (Array.isArray(options.orderSns) && !targetOrderSet[orderSn]) return;
      var lines = Object.keys(groups[orderSn]).map(function(key) { return groups[orderSn][key]; })
        .sort(function(a, b) { return (a.itemId + "|" + a.modelId).localeCompare(b.itemId + "|" + b.modelId); });
      var ownerSnapshot = existingOwnerByOrder[orderSn] || null;
      var ownerSettlementMap = {};
      if (!ownerSnapshot && options.fetchSettlement !== false && typeof fetchPaymentEscrow === "function") {
        try {
          var orderPricing = buildSalesLedgerUniqueLinePricing(lines.map(function(line) {
            return { itemId: line.itemId, modelId: line.modelId, qty: line.qty, unitPrice: line.amount, lineSubtotal: line.amount * line.qty };
          }));
          var paymentResponse = fetchPaymentEscrow(orderSn);
          if (paymentResponse && paymentResponse.success) {
            ownerSettlementMap = _mapPaymentToLedgerCols(paymentResponse.data, orderPricing, ledgerCol, lines[0].status) || {};
            ownerSettlementMap["Settlement Sync"] = "SUCCESS";
          }
        } catch (paymentError) {
          Logger.log("[SalesLedgerLineWriter] Settlement remains blank for " + orderSn + ": " + paymentError.toString());
        }
      }
      lines.forEach(function(line, lineIndex) {
        var key = line.orderSn + "|" + line.itemId + "|" + line.modelId;
        var existing = existingByKey[key];
        var row = existing ? existing.row.slice() : new Array(ledgerData[0].length).fill("");
        var isOwner = lineIndex === 0;
        function set(header, value) { if (ledgerCol[header] !== undefined) row[ledgerCol[header]] = value; }
        set("Ledger ID", existing ? row[ledgerCol["Ledger ID"]] : "SLv3_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
        set("Order SN", line.orderSn); set("Item ID", line.itemId); set("Model ID", line.modelId);
        set("Tanggal Order", line.createdAt || row[ledgerCol["Tanggal Order"]] || "");
        set("Tanggal Update", line.updatedAt || row[ledgerCol["Tanggal Update"]] || "");
        set("Buyer Name", line.buyer || row[ledgerCol["Buyer Name"]] || "");
        set("Nama Produk", line.product); set("Variasi", line.variation);
        set("SKU Shopee", line.shopeeSku || row[ledgerCol["SKU Shopee"]] || "");
        set("SKU Inventaris", line.inventorySku || row[ledgerCol["SKU Inventaris"]] || "");
        set("Qty", line.qty); set("Harga Produk", line.amount); set("Subtotal", line.amount * line.qty);
        set("Original Price", line.amount); set("Selling Price", line.amount); set("Product Subtotal", line.amount * line.qty);
        set("Status Shopee", line.status); set("Status Ledger", _mapShopeeStatusToLedger(line.status));
        set("Deduction Status", line.deductionStatus); set("Mapping Status", line.mappingStatus);
        set("Sync Time", now); set("Last Modified", now);
        set(SALES_LEDGER_LOGICAL_LINE_KEY_HEADER, key); set(SALES_LEDGER_SETTLEMENT_OWNER_HEADER, isOwner);
        SALES_LEDGER_SETTLEMENT_FIELDS_V3.forEach(function(field) {
          if (!isOwner) set(field, "");
          else if (ownerSnapshot && ledgerCol[field] !== undefined) set(field, ownerSnapshot[ledgerCol[field]]);
          else if (ownerSettlementMap[field] !== undefined) set(field, ownerSettlementMap[field]);
        });
        if (existing) { ledgerData[existing.rowIndex] = row; updated++; }
        else appended.push(row);
      });
    });
    if (options.executeWrite !== true) {
      return { status: "DRY_RUN_ONLY", writesExecuted: false, plannedNewCount: appended.length, plannedUpdatedCount: updated };
    }
    if (updated > 0) ledgerSheet.getRange(2, 1, ledgerData.length - 1, ledgerData[0].length).setValues(ledgerData.slice(1));
    if (appended.length > 0) ledgerSheet.getRange(ledgerData.length + 1, 1, appended.length, ledgerData[0].length).setValues(appended);
    return { status: "success", writesExecuted: true, newCount: appended.length, updatedCount: updated };
  } finally {
    if (ownsLock && lock) lock.releaseLock();
  }
}
