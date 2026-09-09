// ============================================================
// Production/StockProductionEngine.gs
// Konveksi production planning. MasterBarang is inventory-only.
// ============================================================

var STOCK_ALERTS_SHEET = "StockAlerts";
var PRODUCTION_CONFIGURATION_SHEET = "ProductionConfiguration";
var PRODUCTION_QUEUE_SHEET = "ProductionQueue";
var PRODUCTION_HISTORY_SHEET = "ProductionHistory";
var PRODUCTION_RECIPIENTS_SHEET = "ProductionRecipients";
var PRODUCTION_NOTIFICATION_LOG_SHEET = "ProductionNotificationLog";
var STOCK_PRODUCTION_TIMEZONE = "Asia/Jakarta";
var STOCK_PRODUCTION_TELEGRAM_MAX_MESSAGE_LENGTH = 3500;
var STOCK_PRODUCTION_TARGETED_REFRESH_MAX_TARGETS = 29;
var STOCK_PRODUCTION_TESTING_RESET_CONFIRMATION = "RESET_TESTING_PRODUCTION_STATE";
var STOCK_PRODUCTION_STATISTICS_BASELINE_KEY = "STOCK_PRODUCTION_STATISTICS_BASELINE";
var STOCK_PRODUCTION_VALID_ORDER_STATUSES = [
  "PROCESSED", "READY_TO_SHIP", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"
];

// MasterBarang remains an inventory master. Do not add production fields here.
var STOCK_PRODUCTION_MASTER_HEADERS = [
  "Kode Barang", "Nama Barang", "Kategori", "Warna", "Ukuran", "Stok Saat Ini"
];
var STOCK_PRODUCTION_CONFIG_HEADERS = [
  "SKU", "MinimumStock", "TargetStock", "MinimumProductionBatch", "Moving", "MovingSource", "ProductionRecipient", "Enabled", "Notes", "UpdatedAt", "UpdatedBy"
];
// Moving is a required manual production parameter. MovingSource is retained
// only so existing sheets remain readable during the transition.
var STOCK_PRODUCTION_REQUIRED_CONFIG_HEADERS = [
  "SKU", "MinimumStock", "TargetStock", "MinimumProductionBatch", "Moving", "Enabled", "Notes", "UpdatedAt", "UpdatedBy"
];

// Existing sheets retain their headers. IdealStock and ProductionMin are the
// persisted names for TargetStock and MinimumProductionBatch respectively.
var STOCK_ALERT_HEADERS = [
  "AlertID", "SKU", "Product", "Category", "Color", "Size", "Stock",
  "MinimumStock", "IdealStock", "ProductionMin", "ProductionTarget",
  "ProductionQty", "MovingStat", "ToDo", "Status", "Priority",
  "FirstDetectedAt", "LastEvaluatedAt", "ResolvedAt", "IgnoredAt",
  "IgnoredBy", "IgnoreReason", "NotificationCycle", "LastNotificationType",
  "LastNotificationAt"
];
var PRODUCTION_QUEUE_HEADERS = [
  "QueueID", "SKU", "Product", "Category", "Color", "Size", "StockAtCreation",
  "MinimumStock", "IdealStock", "ProductionMin", "ProductionTarget",
  "RecommendedQty", "PlannedQty", "CompletedQty", "MovingStat", "Priority",
  "Status", "CreatedAt", "CreatedBy", "StartedAt", "StartedBy",
  "CompletedAt", "CompletedBy", "CancelledAt", "CancelledBy", "Note",
  "ActiveRequirementKey", "ProductionRecipient", "NotificationStatus", "NotificationSource",
  "LastNotificationAt", "LastNotificationError", "UpdatedAt"
];
var PRODUCTION_HISTORY_HEADERS = [
  "Timestamp", "UserEmail", "UserName", "Action", "SKU", "QueueID",
  "Before", "After", "Note"
];
var PRODUCTION_RECIPIENT_HEADERS = [
  "RecipientID", "Name", "Type", "TelegramChatId", "Active", "Notes", "UpdatedAt", "UpdatedBy"
];
var PRODUCTION_NOTIFICATION_LOG_HEADERS = [
  "Timestamp", "NotificationID", "Source", "RecipientID", "RecipientName", "TelegramChatId",
  "SKUs", "Priority", "Status", "MessageCount", "MessagePreview", "ErrorMessage", "CreatedBy"
];

function stockProductionText(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function stockProductionNumber(value) {
  if (typeof value === "number") return isFinite(value) ? value : null;
  var normalized = stockProductionText(value).replace(/\s/g, "").replace(/,/g, ".");
  if (!normalized) return null;
  var parsed = Number(normalized);
  return isFinite(parsed) ? parsed : null;
}

function stockProductionIsEnabled(value) {
  var normalized = stockProductionText(value).toUpperCase();
  return value === true || normalized === "TRUE" || normalized === "1" || normalized === "YES" || normalized === "YA" || normalized === "ACTIVE" || normalized === "AKTIF";
}

function stockProductionNormalizeMoving(value) {
  var moving = stockProductionText(value).toUpperCase();
  if (moving === "FAST") return "FAST";
  if (moving === "MIDDLE" || moving === "MEDIUM") return "MIDDLE";
  if (moving === "SLOW") return "SLOW";
  return "SLOW";
}

function stockProductionIsValidMoving(value) {
  return value === "FAST" || value === "MIDDLE" || value === "SLOW";
}

function stockProductionNormalizeMovingSource(value) {
  var source = stockProductionText(value).toUpperCase();
  return source || "MANUAL";
}

// Production Moving is manual-only. SalesLedger analytics never participates
// in production classification; invalid configuration is handled on read.
function getStockProductionMoving(config) {
  return {
    movingStat: config && stockProductionIsValidMoving(config.moving) ? config.moving : "SLOW",
    movingSource: "MANUAL"
  };
}

function stockProductionMovingFromUnits(units) {
  var quantity = stockProductionNumber(units) || 0;
  if (quantity >= 16) return "FAST";
  if (quantity >= 1) return "MIDDLE";
  return "SLOW";
}

function stockProductionPriority(moving) {
  if (moving === "FAST") return "HIGH";
  if (moving === "MIDDLE") return "MEDIUM";
  return "LOW";
}

function stockProductionHeaderMap(headers) {
  var map = {};
  (headers || []).forEach(function(header, index) { map[stockProductionText(header)] = index; });
  return map;
}

function stockProductionRowsToObjects(values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(stockProductionText);
  return values.slice(1).map(function(row, index) {
    var obj = { _row: index + 2 };
    headers.forEach(function(header, col) { obj[header] = row[col]; });
    return obj;
  });
}

function stockProductionDateKey(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, STOCK_PRODUCTION_TIMEZONE, "yyyy-MM-dd");
  }
  var text = stockProductionText(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + "-" + match[2] + "-" + match[3];
  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return match[3] + "-" + match[2] + "-" + match[1];
  return "";
}

// Statistics baselines are metadata only. They never mutate lifecycle rows;
// missing lifecycle timestamps are intentionally excluded after a baseline.
function stockProductionParseLifecycleDate(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? null : value;
  }
  var text = stockProductionText(value);
  if (!text) return null;
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function stockProductionReadStatisticsBaseline() {
  var empty = { completedBaselineAt: "", resolvedBaselineAt: "", updatedAt: "", updatedBy: "" };
  if (typeof PropertiesService === "undefined" || !PropertiesService.getScriptProperties) return empty;
  var raw = PropertiesService.getScriptProperties().getProperty(STOCK_PRODUCTION_STATISTICS_BASELINE_KEY);
  if (!raw) return empty;
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      completedBaselineAt: stockProductionParseLifecycleDate(parsed.completedBaselineAt) ? stockProductionText(parsed.completedBaselineAt) : "",
      resolvedBaselineAt: stockProductionParseLifecycleDate(parsed.resolvedBaselineAt) ? stockProductionText(parsed.resolvedBaselineAt) : "",
      updatedAt: stockProductionParseLifecycleDate(parsed.updatedAt) ? stockProductionText(parsed.updatedAt) : "",
      updatedBy: stockProductionText(parsed.updatedBy)
    };
  } catch (error) {
    return empty;
  }
}

function stockProductionCountLifecycleSince(rows, status, timestampField, baselineValue) {
  var baseline = stockProductionParseLifecycleDate(baselineValue);
  var expectedStatus = stockProductionText(status).toUpperCase();
  return (rows || []).filter(function(row) {
    if (stockProductionText(row && row.Status).toUpperCase() !== expectedStatus) return false;
    var lifecycleDate = stockProductionParseLifecycleDate(row && row[timestampField]);
    if (!lifecycleDate) return false;
    return !baseline || lifecycleDate.getTime() > baseline.getTime();
  }).length;
}

function stockProductionStatisticsKpi(queueRows, alertRows, baseline) {
  baseline = baseline || {};
  return {
    completed: stockProductionCountLifecycleSince(queueRows, "COMPLETED", "CompletedAt", baseline.completedBaselineAt),
    resolved: stockProductionCountLifecycleSince(alertRows, "RESOLVED", "ResolvedAt", baseline.resolvedBaselineAt)
  };
}

function stockProductionAddDays(dateKey, days) {
  var match = stockProductionText(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.getUTCFullYear() + "-" + ("0" + (date.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + date.getUTCDate()).slice(-2);
}

function stockProductionReadSheetObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return stockProductionRowsToObjects(sheet.getDataRange().getValues());
}

function ensureStockProductionSheet(ss, name, headers, options) {
  options = options || {};
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionText);
    var missing = headers.filter(function(header) { return existing.indexOf(header) < 0; });
    if (missing.length && options.appendMissingHeaders !== false) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function ensureStockProductionDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    configuration: ensureStockProductionSheet(ss, PRODUCTION_CONFIGURATION_SHEET, STOCK_PRODUCTION_CONFIG_HEADERS, { appendMissingHeaders: false }),
    alerts: ensureStockProductionSheet(ss, STOCK_ALERTS_SHEET, STOCK_ALERT_HEADERS),
    queue: ensureStockProductionSheet(ss, PRODUCTION_QUEUE_SHEET, PRODUCTION_QUEUE_HEADERS),
    history: ensureStockProductionSheet(ss, PRODUCTION_HISTORY_SHEET, PRODUCTION_HISTORY_HEADERS)
  };
}

function ensureProductionRecipientsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ensureStockProductionSheet(ss, PRODUCTION_RECIPIENTS_SHEET, PRODUCTION_RECIPIENT_HEADERS);
}

function ensureProductionNotificationLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ensureStockProductionSheet(ss, PRODUCTION_NOTIFICATION_LOG_SHEET, PRODUCTION_NOTIFICATION_LOG_HEADERS);
}

function readStockProductionInventory() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MASTER_SHEET_NAME || "MasterBarang");
  if (!sheet || sheet.getLastRow() < 1) {
    return { ok: false, error: "MasterBarang tidak tersedia.", missingHeaders: STOCK_PRODUCTION_MASTER_HEADERS.slice(), items: [] };
  }
  var values = sheet.getDataRange().getValues();
  var map = stockProductionHeaderMap(values[0].map(stockProductionText));
  var missing = STOCK_PRODUCTION_MASTER_HEADERS.filter(function(header) { return map[header] === undefined; });
  if (missing.length) return { ok: false, error: "Header MasterBarang tidak lengkap.", missingHeaders: missing, items: [] };

  var items = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var sku = stockProductionText(row[map["Kode Barang"]]);
    if (!sku) continue;
    items.push({
      row: i + 1, sku: sku,
      product: stockProductionText(row[map["Nama Barang"]]),
      category: stockProductionText(row[map["Kategori"]]),
      color: stockProductionText(row[map["Warna"]]),
      size: stockProductionText(row[map["Ukuran"]]),
      stock: row[map["Stok Saat Ini"]]
    });
  }
  return { ok: true, missingHeaders: [], items: items };
}

function readStockProductionConfiguration(inventoryItems) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_CONFIGURATION_SHEET);
  if (!sheet || sheet.getLastRow() < 1) {
    return { ok: true, available: false, configs: {}, invalidSkus: {}, error: "ProductionConfiguration belum tersedia." };
  }
  var values = sheet.getDataRange().getValues();
  var map = stockProductionHeaderMap(values[0].map(stockProductionText));
  var missing = STOCK_PRODUCTION_REQUIRED_CONFIG_HEADERS.filter(function(header) { return map[header] === undefined; });
  if (missing.length) return { ok: false, available: true, configs: {}, invalidSkus: {}, error: "Header ProductionConfiguration tidak lengkap.", missingHeaders: missing };

  var knownSku = {};
  (inventoryItems || []).forEach(function(item) { knownSku[item.sku] = true; });
  var configs = {};
  var invalidSkus = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var sku = stockProductionText(row[map.SKU]);
    if (!sku) continue;
    if (!knownSku[sku]) { invalidSkus[sku] = "SKU tidak ditemukan di MasterBarang."; continue; }
    if (configs[sku]) {
      invalidSkus[sku] = "SKU memiliki lebih dari satu konfigurasi.";
      configs[sku].valid = false;
      configs[sku].error = invalidSkus[sku];
      continue;
    }
    var minimum = stockProductionNumber(row[map.MinimumStock]);
    var target = stockProductionNumber(row[map.TargetStock]);
    var batch = stockProductionNumber(row[map.MinimumProductionBatch]);
    var enabled = stockProductionIsEnabled(row[map.Enabled]);
    var moving = stockProductionText(row[map.Moving]);
    var movingSource = map.MovingSource === undefined ? "MANUAL" : stockProductionNormalizeMovingSource(row[map.MovingSource]);
    // ProductionRecipient is canonical. Penjahit/Konveksi aliases keep older
    // spreadsheets readable without moving production data into MasterBarang.
    var recipientColumn = map.ProductionRecipient !== undefined ? map.ProductionRecipient : (map.Penjahit !== undefined ? map.Penjahit : map.Konveksi);
    var error = "";
    if (minimum === null || minimum < 0) error = "MinimumStock harus angka >= 0.";
    else if (target === null || target <= minimum) error = "TargetStock harus lebih besar dari MinimumStock.";
    else if (batch === null || batch <= 0) error = "MinimumProductionBatch harus lebih besar dari 0.";
    else if (!stockProductionIsValidMoving(moving)) error = "Moving harus FAST, MIDDLE, atau SLOW.";
    configs[sku] = {
      row: i + 1, sku: sku, minimumStock: minimum, targetStock: target,
      minimumProductionBatch: batch, enabled: enabled,
      moving: moving, movingSource: movingSource,
      productionRecipient: recipientColumn === undefined ? "" : stockProductionText(row[recipientColumn]),
      notes: stockProductionText(row[map.Notes]), valid: !error, error: error
    };
    if (error) invalidSkus[sku] = error;
  }
  return { ok: true, available: true, configs: configs, invalidSkus: invalidSkus };
}

// This reader intentionally does not call any ensure helper. Dashboard and
// evaluation paths must remain read-only when recipient configuration is absent.
function readProductionRecipients() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_RECIPIENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return { available: false, recipients: [], byId: {}, byName: {}, invalid: [] };
  var values = sheet.getDataRange().getValues();
  var map = stockProductionHeaderMap(values[0].map(stockProductionText));
  var missing = ["RecipientID", "Name", "Type", "TelegramChatId", "Active"].filter(function(header) { return map[header] === undefined; });
  if (missing.length) return { available: true, recipients: [], byId: {}, byName: {}, invalid: [{ error: "Header ProductionRecipients tidak lengkap: " + missing.join(", ") }] };
  var recipients = [];
  var byId = {};
  var byName = {};
  var invalid = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = stockProductionText(row[map.RecipientID]);
    var name = stockProductionText(row[map.Name]);
    if (!id && !name) continue;
    var recipient = {
      row: i + 1,
      id: id,
      name: name,
      type: stockProductionText(row[map.Type]).toUpperCase() || "KONVEKSI",
      telegramChatId: stockProductionText(row[map.TelegramChatId]),
      active: stockProductionIsEnabled(row[map.Active]),
      notes: map.Notes === undefined ? "" : stockProductionText(row[map.Notes])
    };
    if (!id || !name) invalid.push({ row: recipient.row, error: "RecipientID dan Nama wajib diisi." });
    else if (byId[id]) invalid.push({ row: recipient.row, error: "RecipientID duplikat: " + id });
    else {
      byId[id] = recipient;
      var nameKey = name.toUpperCase();
      if (!byName[nameKey]) byName[nameKey] = [];
      byName[nameKey].push(recipient);
    }
    recipients.push(recipient);
  }
  return { available: true, recipients: recipients, byId: byId, byName: byName, invalid: invalid };
}

function stockProductionResolveRecipient(reference, recipients) {
  var key = stockProductionText(reference);
  if (!key) return { status: "missing_assignment", recipient: null };
  var source = recipients || readProductionRecipients();
  var recipient = source.byId[key] || null;
  if (!recipient) {
    var candidates = source.byName[key.toUpperCase()] || [];
    if (candidates.length === 1) recipient = candidates[0];
    else if (candidates.length > 1) return { status: "ambiguous_assignment", recipient: null };
  }
  if (!recipient) return { status: "recipient_not_found", recipient: null };
  if (!recipient.active) return { status: "recipient_inactive", recipient: recipient };
  if (!recipient.telegramChatId) return { status: "recipient_missing_chat_id", recipient: recipient };
  if (!/^-?\d+$/.test(stockProductionText(recipient.telegramChatId))) return { status: "recipient_invalid_chat_id", recipient: recipient };
  return { status: "resolved", recipient: recipient };
}

// Telegram is only an interface for ProductionQueue. A chat ID is accepted
// only when it maps to one active production recipient; names/usernames are
// never used as an authority signal.
function stockProductionResolveRecipientByTelegramChatId(chatId, recipients) {
  var normalizedChatId = stockProductionText(chatId);
  if (!/^-?\d+$/.test(normalizedChatId)) return { status: "invalid_chat_id", recipient: null };
  var source = recipients || readProductionRecipients();
  if (!source.available) return { status: "recipient_configuration_unavailable", recipient: null };
  var matches = (source.recipients || []).filter(function(recipient) {
    return stockProductionText(recipient.telegramChatId) === normalizedChatId;
  });
  if (!matches.length) return { status: "recipient_not_found", recipient: null };
  var active = matches.filter(function(recipient) { return recipient.active; });
  if (!active.length) return { status: "recipient_inactive", recipient: matches[0] };
  if (active.length > 1) return { status: "recipient_ambiguous", recipient: null };
  return { status: "resolved", recipient: active[0] };
}

function stockProductionQueueBelongsToRecipient(queue, recipient, recipients) {
  if (!queue || !recipient) return false;
  var assignment = stockProductionResolveRecipient(queue.ProductionRecipient, recipients);
  return assignment.status === "resolved" && assignment.recipient.id === recipient.id;
}

function stockProductionTelegramRecipientActor(recipient) {
  return {
    email: "telegram:" + stockProductionText(recipient && recipient.telegramChatId),
    name: stockProductionText(recipient && recipient.name) || "Konveksi",
    role: "KONVEKSI"
  };
}

function stockProductionRecipientLabel(reference, recipients) {
  var source = recipients || readProductionRecipients();
  var resolution = stockProductionResolveRecipient(reference, source);
  if (resolution.recipient) return resolution.recipient.name;
  return stockProductionText(reference);
}

// Legacy analytics helper retained for reporting compatibility. Stock
// Production runtime no longer calls this helper to determine Moving.
function stockProductionBuildMovingMapFromSalesLedger(ledgerRows, asOfDate) {
  var endKey = stockProductionDateKey(asOfDate || new Date());
  var startKey = stockProductionAddDays(endKey, -29);
  var unitsBySku = {};
  (ledgerRows || []).forEach(function(row) {
    var dateKey = stockProductionDateKey(row["Tanggal Order"] || row.OrderDate || row["Waktu Pesanan"]);
    var status = stockProductionText(row["Status Shopee"] || row.StatusShopee || row.Status).toUpperCase();
    var sku = stockProductionText(row["SKU Inventaris"] || row["SKU Shopee"] || row.SKU);
    var qty = stockProductionNumber(row.Qty || row.Quantity);
    if (!sku || qty === null || !dateKey || !status || STOCK_PRODUCTION_VALID_ORDER_STATUSES.indexOf(status) < 0) return;
    if (dateKey < startKey || dateKey > endKey) return;
    unitsBySku[sku] = (unitsBySku[sku] || 0) + qty;
  });
  var moving = {};
  Object.keys(unitsBySku).forEach(function(sku) {
    moving[sku] = { units30d: unitsBySku[sku], movingStat: stockProductionMovingFromUnits(unitsBySku[sku]) };
  });
  return { startDate: startKey, endDate: endKey, bySku: moving };
}

function stockProductionReadMovingMap(asOfDate) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("SalesLedger");
  return stockProductionBuildMovingMapFromSalesLedger(stockProductionReadSheetObjects(sheet), asOfDate || new Date());
}

function classifyStockProductionItem(item, queueStatus) {
  var stock = stockProductionNumber(item.stock);
  var config = item.config;
  if (stock === null) return { valid: false, missing: ["Stok Saat Ini"], status: "CONFIG_INVALID", activeProduction: false };
  if (!config) return { valid: true, configured: false, activeProduction: false, status: "NORMAL", stock: stock, productionQty: 0, todo: "" };
  if (!config.valid) return { valid: false, configured: true, missing: [config.error], status: "CONFIG_INVALID", activeProduction: false };
  var minimum = config.minimumStock;
  var target = config.targetStock;
  var batch = config.minimumProductionBatch;
  var shortfall = Math.max(0, target - stock);
  // Production quantity is only meaningful after the stock threshold fires.
  // Being below TargetStock alone must not create a production suggestion.
  var triggerActive = config.enabled && stock <= minimum;
  var suggested = triggerActive && shortfall > 0 ? Math.max(shortfall, batch) : 0;
  var active = triggerActive && suggested > 0;
  var normalizedQueueStatus = stockProductionText(queueStatus).toUpperCase();
  var status = !active ? "NORMAL" : (normalizedQueueStatus === "IN_PROGRESS" ? "PRODUCTION_IN_PROGRESS" : (stock < minimum ? "CRITICAL" : "PRODUCTION_REQUIRED"));
  return {
    valid: true, configured: true, enabled: config.enabled, stock: stock,
    minimumStock: minimum, idealStock: target, productionMin: batch,
    productionTarget: target, productionQty: suggested,
    movingStat: stockProductionNormalizeMoving(item.movingStat), todo: active ? "PRODUKSI" : "",
    priority: stockProductionPriority(stockProductionNormalizeMoving(item.movingStat)),
    shortfall: shortfall, status: status, activeProduction: active, productionRequired: active
  };
}

function stockProductionCanTransition(fromStatus, toStatus) {
  var from = stockProductionText(fromStatus).toUpperCase() || "PENDING";
  var to = stockProductionText(toStatus).toUpperCase();
  var allowed = { PENDING: ["IN_PROGRESS", "CANCELLED", "RESOLVED"], IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [], RESOLVED: [] };
  return !!allowed[from] && allowed[from].indexOf(to) >= 0;
}

function stockProductionNeedsProduction(classification) {
  return !!(classification && classification.valid && classification.activeProduction && classification.productionQty > 0);
}

function stockProductionIsActiveAlertStatus(status) {
  var normalized = stockProductionText(status).toUpperCase();
  return normalized === "CRITICAL" || normalized === "PRODUCTION_REQUIRED" || normalized === "PRODUCTION_IN_PROGRESS";
}

function stockProductionShouldNotify(previousStatus, activeProduction, ignored, notificationsEnabled) {
  return !!(activeProduction && !ignored && notificationsEnabled !== false && !stockProductionIsActiveAlertStatus(previousStatus));
}

function stockProductionTelegramCell(value) {
  var displayed = value === null || value === undefined || value === "" ? "-" : value;
  return stockProductionText(displayed).replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stockProductionShortColor(value) {
  var source = stockProductionText(value);
  var mappings = {
    "HITAM": "HTM", "BROKEN WHITE": "BW", "CINNAMON": "CIN", "BRICK": "BRK",
    "GREEN EMERALD": "GEM", "DARK TOSCA": "DTC", "DENIM TUA": "DNT", "MAROON": "MRN",
    "NAVY": "NVY", "TERRACOTTA": "TRC", "MILK TEA": "MLT", "MUSTARD": "MUS",
    "HIJAU": "HIJ", "LAVENDER": "LAV", "DEEP MAUVE": "DMV", "BITTER CHOCOLATE": "BCH",
    "TIFFANY TWILL": "TFT"
  };
  var key = source.toUpperCase();
  return Object.prototype.hasOwnProperty.call(mappings, key) ? mappings[key] : stockProductionTelegramCell(source);
}

function stockProductionBuildProductionEntries(items) {
  var groups = { FAST: [], MIDDLE: [], SLOW: [] };
  (items || []).forEach(function(item) {
    var moving = stockProductionText(item.movingState || item.movingStat).toUpperCase();
    if (!groups[moving]) moving = "SLOW";
    groups[moving].push({ item: item, moving: moving });
  });
  var entries = [];
  ["FAST", "MIDDLE", "SLOW"].forEach(function(moving) {
    groups[moving].forEach(function(entry) {
      entry.number = entries.length + 1;
      entry.continuesFromPrevious = entries.length > 0 && entries[entries.length - 1].moving === moving;
      entries.push(entry);
    });
  });
  return entries;
}

function stockProductionMovingSectionTitle(moving, isContinuation) {
  var titles = { FAST: "\u26A1 FAST", MIDDLE: "\uD83D\uDFE1 MIDDLE", SLOW: "\uD83D\uDC22 SLOW" };
  return (titles[moving] || titles.SLOW) + (isContinuation ? " \u2014 LANJUTAN" : "");
}

function stockProductionBuildProductionItemLine(entry) {
  var item = entry.item;
  var productionQty = item.effectiveProductionQty == null ? item.productionQty : item.effectiveProductionQty;
  return entry.number + ". " + stockProductionTelegramCell(item.product) + " | " +
    stockProductionShortColor(item.color) + " | " + stockProductionTelegramCell(item.size) + " | " +
    stockProductionTelegramCell(item.minimumStock) + " \u2192 " + stockProductionTelegramCell(productionQty);
}

function stockProductionBuildProductionMessage(entries, evaluatedAt, partNumber, totalParts, totalItems, options) {
  options = options || {};
  var sections = [];
  var section = null;
  (entries || []).forEach(function(entry, index) {
    if (!section || section.moving !== entry.moving) {
      section = {
        moving: entry.moving,
        title: stockProductionMovingSectionTitle(entry.moving, index === 0 && entry.continuesFromPrevious),
        lines: []
      };
      sections.push(section);
    }
    section.lines.push(stockProductionBuildProductionItemLine(entry));
  });
  var body = sections.map(function(group) { return group.title + "\n\n" + group.lines.join("\n"); }).join("\n\n");
  var totalLabel = totalParts > 1 ? "Total bagian: " + (entries || []).length + " item" : "Total: " + totalItems + " item";
  var lines = [options.title || "\uD83D\uDEA8 <b>URGENSI STOK PRODUKSI</b>"];
  if (options.destination) lines.push("Tujuan: " + stockProductionTelegramCell(options.destination));
  lines.push("Update: " + stockProductionText(evaluatedAt || ""));
  lines.push("Bagian " + partNumber + "/" + totalParts + " \u2022 Total " + totalItems + " item", "", body);
  if (options.note) lines.push("", "Catatan: " + stockProductionTelegramCell(options.note));
  lines.push("", totalLabel);
  return lines.join("\n");
}

// Chunk by complete item blocks, never by a fixed number of SKUs. The preview
// uses the widest possible part label so final messages remain within the limit.
function stockProductionBuildProductionMessages(items, evaluatedAt, maxLength, options) {
  var rows = stockProductionBuildProductionEntries(items);
  var limit = Number(maxLength) || STOCK_PRODUCTION_TELEGRAM_MAX_MESSAGE_LENGTH;
  var totalItems = rows.length;
  if (!totalItems) return [];
  var chunks = [];
  var current = [];
  rows.forEach(function(entry) {
    var candidate = current.concat([entry]);
    var preview = stockProductionBuildProductionMessage(candidate, evaluatedAt, totalItems, totalItems, totalItems, options);
    if (preview.length <= limit) {
      current = candidate;
      return;
    }
    if (!current.length) {
      throw new Error("Satu item produksi melebihi batas pesan Telegram " + limit + " karakter.");
    }
    chunks.push(current);
    current = [entry];
    if (stockProductionBuildProductionMessage(current, evaluatedAt, totalItems, totalItems, totalItems, options).length > limit) {
      throw new Error("Satu item produksi melebihi batas pesan Telegram " + limit + " karakter.");
    }
  });
  if (current.length) chunks.push(current);
  return chunks.map(function(chunk, index) {
    var message = stockProductionBuildProductionMessage(chunk, evaluatedAt, index + 1, chunks.length, totalItems, options);
    if (message.length > limit) throw new Error("Chunk Telegram melebihi batas pesan " + limit + " karakter.");
    return message;
  });
}

function stockProductionBuildProductionTable(items, evaluatedAt) {
  var messages = stockProductionBuildProductionMessages(items, evaluatedAt);
  if (messages.length !== 1) throw new Error("Batch produksi memerlukan beberapa pesan Telegram; gunakan stockProductionBuildProductionMessages.");
  return messages[0] || "";
}

// Keep Telegram's values tied to the exact classification produced by the
// evaluator. The formatter must never infer stock-production metrics again.
function stockProductionBuildNotificationPayload(item, classification, status, cycle) {
  return {
    sku: item.sku,
    product: item.product,
    color: item.color,
    size: item.size,
    stock: classification.stock,
    minimumStock: classification.minimumStock,
    targetStock: classification.productionTarget,
    productionTarget: classification.productionTarget,
    productionQty: classification.productionQty,
    movingStat: classification.movingStat,
    movingState: classification.movingStat,
    status: status,
    priority: classification.priority,
    productionRecipient: item.productionRecipient || item.config && item.config.productionRecipient || "",
    notificationCycle: cycle
  };
}

function stockProductionBuildBatchNotificationKey(items, dateKey) {
  var identity = (items || []).map(function(item) { return stockProductionText(item.sku || item.SKU) + "@" + String(item.notificationCycle || item.NotificationCycle || 1); }).sort().join(",");
  return ["STOCK_PRODUCTION_BATCH", dateKey, identity].join(":");
}

function stockProductionFindUser(email) {
  var cleanEmail = stockProductionText(email).toLowerCase();
  if (!cleanEmail) throw new Error("Sesi pengguna tidak tersedia.");
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USER_SHEET_NAME || "Users");
  if (!sheet || sheet.getLastRow() < 2) throw new Error("Data pengguna tidak tersedia.");
  var users = stockProductionReadSheetObjects(sheet);
  for (var i = 0; i < users.length; i++) {
    var rowEmail = stockProductionText(users[i].Email || users[i].email).toLowerCase();
    if (rowEmail !== cleanEmail) continue;
    var status = stockProductionText(users[i].Status || "ACTIVE").toUpperCase();
    if (status && status !== "ACTIVE" && status !== "AKTIF") throw new Error("Akun pengguna tidak aktif.");
    return { email: rowEmail, name: stockProductionText(users[i].Nama || users[i].Name || users[i].Username || rowEmail), role: stockProductionText(users[i].Role || "Staff") };
  }
  throw new Error("Pengguna tidak ditemukan.");
}

function stockProductionRolePermissions(role) {
  var normalized = stockProductionText(role).toUpperCase();
  var all = ["view_stock_alerts", "view_production_queue", "manage_production_queue", "update_production_status", "manage_stock_alert_settings"];
  if (normalized === "OWNER" || normalized === "ADMIN") return all;
  if (normalized === "STAFF KONVEKSI" || normalized === "KONVEKSI") return ["view_stock_alerts", "view_production_queue", "update_production_status"];
  return [];
}

function requireStockProductionPermission(data, permission) {
  var user = stockProductionFindUser((data || {}).callerEmail);
  var permissions = stockProductionRolePermissions(user.role);
  if (permissions.indexOf(permission) < 0) throw new Error("Akses ditolak untuk fitur Konveksi.");
  user.permissions = permissions;
  return user;
}

function stockProductionQueueMap(queueRows) {
  var map = {};
  (queueRows || []).forEach(function(row) {
    var status = stockProductionText(row.Status).toUpperCase();
    if (status === "PENDING" || status === "IN_PROGRESS") map[stockProductionText(row.SKU)] = row;
  });
  return map;
}

// Completed work stays terminal. Until its completed quantity is recorded as
// exact-variant Barang Masuk, a low stock value must not open the same
// production requirement again.
function stockProductionCompletedQueueMap(queueRows) {
  var map = {};
  (queueRows || []).forEach(function(row) {
    if (stockProductionText(row.Status).toUpperCase() === "COMPLETED") {
      map[stockProductionText(row.SKU)] = row;
    }
  });
  return map;
}

function stockProductionIsIncomingTransaction(row) {
  var type = stockProductionText(row && row["Jenis Transaksi"]).toUpperCase();
  return type === "MASUK" || type === "BARANG MASUK";
}

function stockProductionCompletedQueueReceivedQty(queue, transactionRows) {
  if (!queue || stockProductionText(queue.Status).toUpperCase() !== "COMPLETED") return 0;
  var completedAt = new Date(queue.CompletedAt);
  if (isNaN(completedAt.getTime())) return 0;
  var sku = stockProductionText(queue.SKU);
  var color = stockProductionText(queue.Color);
  var size = stockProductionText(queue.Size);
  return (transactionRows || []).reduce(function(total, row) {
    if (!stockProductionIsIncomingTransaction(row)) return total;
    if (stockProductionText(row["Kode Barang"]) !== sku) return total;
    if (stockProductionText(row.Warna) !== color || stockProductionText(row.Ukuran) !== size) return total;
    var timestamp = new Date(row.Timestamp);
    if (isNaN(timestamp.getTime()) || timestamp.getTime() <= completedAt.getTime()) return total;
    return total + (stockProductionNumber(row.Jumlah) || 0);
  }, 0);
}

function stockProductionIsCompletedQueueWaitingStockIn(queue, item, classification, transactionRows) {
  if (!stockProductionNeedsProduction(classification)) return false;
  if (!queue || stockProductionText(queue.Status).toUpperCase() !== "COMPLETED") return false;
  var completedQty = stockProductionNumber(queue.CompletedQty);
  if (completedQty === null || completedQty <= 0) return false;
  return stockProductionCompletedQueueReceivedQty(queue, transactionRows) < completedQty;
}

function stockProductionAlertMap(alertRows) {
  var map = {};
  (alertRows || []).forEach(function(row) { map[stockProductionText(row.SKU)] = row; });
  return map;
}

function stockProductionAppendByHeaders(sheet, headers, object) {
  var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionText);
  sheet.appendRow(currentHeaders.map(function(header) { return object[header] === undefined ? "" : object[header]; }));
}

function stockProductionUpdateObjectRow(sheet, rowNumber, changes) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionText);
  Object.keys(changes).forEach(function(header) {
    var index = headers.indexOf(header);
    if (index >= 0) sheet.getRange(rowNumber, index + 1).setValue(changes[header]);
  });
}

function stockProductionWriteHistory(sheet, user, action, sku, queueId, before, after, note) {
  stockProductionAppendByHeaders(sheet, PRODUCTION_HISTORY_HEADERS, {
    Timestamp: new Date(), UserEmail: user && user.email || "system", UserName: user && user.name || "System",
    Action: action, SKU: sku, QueueID: queueId || "", Before: JSON.stringify(before || {}), After: JSON.stringify(after || {}), Note: note || ""
  });
}

function stockProductionCreateQueueRecord(sheets, item, classification, user, note) {
  var active = stockProductionQueueMap(stockProductionReadSheetObjects(sheets.queue));
  if (active[item.sku]) return { created: false, row: active[item.sku] };
  var now = new Date();
  var queueId = "PRD-" + Utilities.getUuid();
  var record = {
    QueueID: queueId, SKU: item.sku, Product: item.product, Category: item.category, Color: item.color, Size: item.size,
    StockAtCreation: classification.stock, MinimumStock: classification.minimumStock, IdealStock: classification.idealStock,
    ProductionMin: classification.productionMin, ProductionTarget: classification.productionTarget, RecommendedQty: classification.productionQty,
    PlannedQty: classification.productionQty, CompletedQty: 0, MovingStat: classification.movingStat, Priority: classification.priority,
    Status: "PENDING", ProductionRecipient: item.config && item.config.productionRecipient || "",
    NotificationStatus: "NOT_SENT", NotificationSource: "", LastNotificationAt: "", LastNotificationError: "",
    CreatedAt: now, CreatedBy: user && user.email || "system", Note: note || "",
    ActiveRequirementKey: item.sku + ":ACTIVE", UpdatedAt: now
  };
  stockProductionAppendByHeaders(sheets.queue, PRODUCTION_QUEUE_HEADERS, record);
  stockProductionWriteHistory(sheets.history, user, "QUEUE_CREATED", item.sku, queueId, {}, record, note);
  return { created: true, row: record };
}

function stockProductionSnapshotValueChanged(currentValue, nextValue) {
  var currentNumber = stockProductionNumber(currentValue);
  var nextNumber = stockProductionNumber(nextValue);
  if (currentNumber !== null && nextNumber !== null) return currentNumber !== nextNumber;
  return stockProductionText(currentValue) !== stockProductionText(nextValue);
}

function stockProductionPendingQueueChanges(queue, classification, allowedFields) {
  var desired = {
    StockAtCreation: classification.stock,
    MinimumStock: classification.minimumStock,
    IdealStock: classification.idealStock,
    ProductionMin: classification.productionMin,
    ProductionTarget: classification.productionTarget,
    RecommendedQty: classification.productionQty,
    PlannedQty: classification.productionQty,
    MovingStat: classification.movingStat,
    Priority: classification.priority
  };
  var changes = {};
  var fields = Array.isArray(allowedFields) && allowedFields.length ? allowedFields : Object.keys(desired);
  fields.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(desired, field)) return;
    if (stockProductionSnapshotValueChanged(queue[field], desired[field])) changes[field] = desired[field];
  });
  return changes;
}

function stockProductionUpdatePendingQueue(sheets, queue, item, classification, user, note, options) {
  if (!queue || stockProductionText(queue.Status).toUpperCase() !== "PENDING") return false;
  var changes = stockProductionPendingQueueChanges(queue, classification, options && options.allowedFields);
  if (!Object.keys(changes).length) return false;
  // Snapshot reconciliation is not a lifecycle event and must not rewrite ProductionHistory.
  changes.UpdatedAt = new Date();
  stockProductionUpdateObjectRow(sheets.queue, queue._row, changes);
  return true;
}

// This is deliberately a pure decision helper. The targeted Web App route
// uses it to prove that only a currently-PENDING queue remains eligible before
// it calls the existing diff-only queue writer.
function stockProductionTargetedPendingQueueDecision(queueRows, item, classification) {
  var rows = queueRows || [];
  var pending = rows.filter(function(row) { return stockProductionText(row.Status).toUpperCase() === "PENDING"; });
  if (!pending.length) {
    if (!rows.length) return { action: "TARGET_NOT_FOUND", changes: {} };
    return { action: "SKIP_LIFECYCLE", status: stockProductionText(rows[0].Status).toUpperCase(), changes: {} };
  }
  if (pending.length !== 1) return { action: "AMBIGUOUS_PENDING_QUEUE", changes: {} };
  if (!item || !classification || !classification.valid || !stockProductionNeedsProduction(classification)) {
    return { action: "TARGET_CHANGED", changes: {} };
  }
  var changes = stockProductionPendingQueueChanges(pending[0], classification, [
    "RecommendedQty", "PlannedQty", "MovingStat", "Priority"
  ]);
  return { action: Object.keys(changes).length ? "WOULD_UPDATE" : "NO_CHANGE", queue: pending[0], changes: changes };
}

function stockProductionResolvePendingQueue(sheets, activeQueue, user, note) {
  if (!activeQueue || stockProductionText(activeQueue.Status).toUpperCase() !== "PENDING") return false;
  var changes = { Status: "RESOLVED", ActiveRequirementKey: "", UpdatedAt: new Date(), Note: stockProductionText(note || activeQueue.Note || "Stok sudah aman.") };
  stockProductionUpdateObjectRow(sheets.queue, activeQueue._row, changes);
  stockProductionWriteHistory(sheets.history, user, "QUEUE_RESOLVED", activeQueue.SKU, activeQueue.QueueID, activeQueue, changes, changes.Note);
  return true;
}

function stockProductionBuildRoutedNotificationGroups(items) {
  var recipients = readProductionRecipients();
  var groups = {};
  var blocked = [];
  (items || []).forEach(function(item) {
    var resolved = stockProductionResolveRecipient(item && item.productionRecipient, recipients);
    if (resolved.status !== "resolved") {
      blocked.push({ sku: item && item.sku || "", reason: resolved.status, productionRecipient: item && item.productionRecipient || "" });
      return;
    }
    var recipient = resolved.recipient;
    if (!groups[recipient.id]) groups[recipient.id] = { recipient: recipient, items: [] };
    groups[recipient.id].items.push(item);
  });
  return { groups: Object.keys(groups).map(function(id) { return groups[id]; }), blocked: blocked, recipientErrors: recipients.invalid || [] };
}

function stockProductionWriteNotificationAudit(sheets, items, recipient, source, result, messages, user) {
  if (!sheets) return;
  var now = new Date();
  var sent = result && result.status === "success";
  var notificationStatus = sent ? "SENT" : "FAILED";
  var queueRows = sheets.queue ? stockProductionReadSheetObjects(sheets.queue) : [];
  var bySku = {};
  queueRows.forEach(function(row) { bySku[stockProductionText(row.SKU)] = row; });
  (items || []).forEach(function(item) {
    var queue = bySku[stockProductionText(item.sku)];
    if (!queue) return;
    stockProductionUpdateObjectRow(sheets.queue, queue._row, {
      ProductionRecipient: recipient.id,
      NotificationStatus: notificationStatus,
      NotificationSource: source,
      LastNotificationAt: now,
      LastNotificationError: sent ? "" : stockProductionText(result && result.message || "Pengiriman Telegram gagal.")
    });
  });
  var log = ensureProductionNotificationLogSheet();
  stockProductionAppendByHeaders(log, PRODUCTION_NOTIFICATION_LOG_HEADERS, {
    Timestamp: now, NotificationID: "PRD-NOTIF-" + Utilities.getUuid(), Source: source,
    RecipientID: recipient.id, RecipientName: recipient.name, TelegramChatId: recipient.telegramChatId,
    SKUs: (items || []).map(function(item) { return item.sku; }).join(","),
    Priority: (items || []).map(function(item) { return item.movingStat || item.movingState; }).filter(Boolean).join(","),
    Status: notificationStatus, MessageCount: (messages || []).length,
    MessagePreview: stockProductionText((messages || [])[0]).slice(0, 500),
    ErrorMessage: sent ? "" : stockProductionText(result && result.message || "Pengiriman Telegram gagal."),
    CreatedBy: user && user.email || "system"
  });
}

// Manual delivery is communication-only. Keep its audit log, but do not use
// the automatic audit helper because that helper intentionally updates Queue
// notification fields for lifecycle notifications.
function stockProductionWriteManualNotificationAudit(items, recipient, result, messages, user) {
  var sent = result && result.status === "success";
  var now = new Date();
  var log = ensureProductionNotificationLogSheet();
  stockProductionAppendByHeaders(log, PRODUCTION_NOTIFICATION_LOG_HEADERS, {
    Timestamp: now, NotificationID: "PRD-MANUAL-NOTIF-" + Utilities.getUuid(), Source: "MANUAL",
    RecipientID: recipient.id, RecipientName: recipient.name, TelegramChatId: recipient.telegramChatId,
    SKUs: (items || []).map(function(item) { return item.sku; }).join(","),
    Priority: (items || []).map(function(item) { return item.movingStat || item.movingState; }).filter(Boolean).join(","),
    Status: sent ? "SENT" : "FAILED", MessageCount: (messages || []).length,
    MessagePreview: stockProductionText((messages || [])[0]).slice(0, 500),
    ErrorMessage: sent ? "" : stockProductionText(result && result.message || "Pengiriman Telegram gagal."),
    CreatedBy: user && user.email || "system"
  });
}

// Automatic production notification keeps the existing lifecycle trigger and
// idempotency behaviour, but routes each batch only to its configured external
// production recipient. Items without a valid assignment are blocked, never
// broadcast to a default internal subscriber.
function stockProductionNotifyBatch(items, dateKey, options) {
  options = options || {};
  if (!items || !items.length || typeof NotificationService === "undefined") return { status: "suppressed", reason: "no_new_active_items", sentSkus: [] };
  var updatedAt = options.evaluatedAt || Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE, "dd/MM/yyyy HH:mm");
  var routed = stockProductionBuildRoutedNotificationGroups(items);
  var props = PropertiesService.getScriptProperties();
  var results = [];
  var sentSkus = [];
  routed.groups.forEach(function(group) {
    var key = stockProductionBuildBatchNotificationKey(group.items, dateKey) + ":RECIPIENT:" + group.recipient.id;
    if (props.getProperty(key)) {
      results.push({ recipientId: group.recipient.id, status: "suppressed", reason: "lifecycle_duplicate", chunks: 0 });
      return;
    }
    var messages = stockProductionBuildProductionMessages(group.items, updatedAt, null, { destination: group.recipient.name });
    var deliveries = [];
    var failed = false;
    for (var index = 0; index < messages.length; index += 1) {
      var message = messages[index];
      var delivery = NotificationService.sendToRecipient("PRODUCTION_REQUIRED", group.recipient, {
        table: message, message: message, totalItems: group.items.length, date: updatedAt,
        entityKey: group.items.map(function(item) { return item.sku; }).sort().join(","),
        // A chunk is part of one recipient-specific lifecycle batch.
        idempotencyKey: key, note: "Total item produksi: " + group.items.length
      });
      deliveries.push(delivery);
      if (!delivery || delivery.status === "error") { failed = true; break; }
    }
    var result = { recipientId: group.recipient.id, recipientName: group.recipient.name, status: failed ? "error" : "success", chunks: messages.length, results: deliveries };
    results.push(result);
    stockProductionWriteNotificationAudit(options.sheets, group.items, group.recipient, options.source || "AUTOMATIC", failed ? deliveries[deliveries.length - 1] : { status: "success" }, messages, options.user);
    if (failed) return;
    props.setProperty(key, new Date().toISOString());
    sentSkus = sentSkus.concat(group.items.map(function(item) { return item.sku; }));
  });
  var succeeded = results.filter(function(result) { return result.status === "success"; });
  var allDuplicates = results.length && results.every(function(result) {
    return result.status === "suppressed" && result.reason === "lifecycle_duplicate";
  });
  return {
    status: succeeded.length ? "success" : "suppressed",
    reason: allDuplicates ? "lifecycle_duplicate" : "",
    chunks: results.reduce(function(total, result) { return total + (result.chunks || 0); }, 0),
    results: results, blocked: routed.blocked, recipientErrors: routed.recipientErrors,
    sentSkus: sentSkus
  };
}

function stockProductionNotificationIdentity(item) {
  return [item && (item.sku || item.SKU), item && (item.color || item.Color), item && (item.size || item.Size)]
    .map(stockProductionText).join("\u001F");
}

// Build one atomic notification snapshot from the evaluator output. Lifecycle
// activation decides *whether* a Telegram batch is sent; `items` is the full,
// deduplicated active snapshot while `triggerItems` is the incremental payload
// for the automatic notification path.
function stockProductionBuildLifecycleNotificationSnapshot(results, evaluatedAt) {
  var triggerRows = [];
  var eligibleRows = [];
  var missing = [];
  (results || []).forEach(function(row) {
    if (!row) return;
    if (row.shouldNotify) triggerRows.push(row);
    if (!row.activeProduction || stockProductionText(row.status).toUpperCase() === "IGNORED") return;
    if (!row.notificationItem) {
      missing.push(row);
      return;
    }
    eligibleRows.push(row);
  });
  var seen = {};
  var uniqueRows = [];
  var duplicates = [];
  eligibleRows.forEach(function(row) {
    var identity = stockProductionNotificationIdentity(row.notificationItem);
    if (!stockProductionText(row.notificationItem.sku) || seen[identity]) {
      duplicates.push(row);
      return;
    }
    seen[identity] = true;
    uniqueRows.push(row);
  });
  var items = uniqueRows.map(function(row) { return row.notificationItem; });
  var messages = items.length ? stockProductionBuildProductionMessages(items, evaluatedAt) : [];
  var seenTriggerItems = {};
  var triggerItems = [];
  var uniqueTriggerRows = [];
  var triggerDuplicates = [];
  var triggerMissingCount = 0;
  triggerRows.forEach(function(row) {
    if (!row.notificationItem) {
      triggerMissingCount += 1;
      return;
    }
    var identity = stockProductionNotificationIdentity(row.notificationItem);
    if (!stockProductionText(row.notificationItem.sku) || seenTriggerItems[identity]) {
      triggerDuplicates.push(row);
      return;
    }
    seenTriggerItems[identity] = true;
    uniqueTriggerRows.push(row);
    triggerItems.push(row.notificationItem);
  });
  var triggerMessages = triggerItems.length ? stockProductionBuildProductionMessages(triggerItems, evaluatedAt) : [];
  var batchSizes = messages.map(function(message) {
    return (message.match(/(?:^|\n)\d+\. /g) || []).length;
  });
  var totalItemsAcrossMessages = batchSizes.reduce(function(total, count) { return total + count; }, 0);
  var triggerBatchSizes = triggerMessages.map(function(message) {
    return (message.match(/(?:^|\n)\d+\. /g) || []).length;
  });
  var triggerTotalItemsAcrossMessages = triggerBatchSizes.reduce(function(total, count) { return total + count; }, 0);
  return {
    triggerItems: triggerItems,
    triggerRows: uniqueTriggerRows,
    triggerCount: triggerRows.length,
    triggerUniqueCount: triggerItems.length,
    triggerDuplicateCount: triggerDuplicates.length,
    triggerMissingCount: triggerMissingCount,
    triggerMessages: triggerMessages,
    triggerBatchSizes: triggerBatchSizes,
    triggerTotalItemsAcrossMessages: triggerTotalItemsAcrossMessages,
    rows: uniqueRows,
    items: items,
    messages: messages,
    eligibleCount: eligibleRows.length + missing.length,
    uniqueCount: items.length,
    duplicateCount: duplicates.length,
    missingCount: missing.length,
    messageCount: messages.length,
    batchSizes: batchSizes,
    totalItemsAcrossMessages: totalItemsAcrossMessages
  };
}

// Read-only preflight for support/audit. It uses the same runtime evaluator
// payload as the dispatcher, but never creates lifecycle records or sends.
function handlePreviewStockProductionNotificationBatch(data) {
  var user = requireStockProductionPermission(data, "view_stock_alerts");
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders || [] };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [] };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queueRows = stockProductionReadSheetObjects(ss.getSheetByName(PRODUCTION_QUEUE_SHEET));
  var queueMap = stockProductionQueueMap(queueRows);
  var completedQueueMap = stockProductionCompletedQueueMap(queueRows);
  var transactionRows = stockProductionReadSheetObjects(ss.getSheetByName("Transaksi"));
  var alertMap = stockProductionAlertMap(stockProductionReadSheetObjects(ss.getSheetByName(STOCK_ALERTS_SHEET)));
  var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
  var results = runtimeItems.map(function(item) {
    var queue = queueMap[item.sku];
    var classification = classifyStockProductionItem(item, queue && queue.Status);
    if (stockProductionIsCompletedQueueWaitingStockIn(completedQueueMap[item.sku], item, classification, transactionRows)) {
      return { sku: item.sku, activeProduction: false, shouldNotify: false, status: "PRODUCTION_COMPLETED_WAITING_STOCK_IN" };
    }
    if (!stockProductionNeedsProduction(classification)) return { sku: item.sku, activeProduction: false, shouldNotify: false, status: classification.status };
    var alert = alertMap[item.sku];
    var ignored = alert && stockProductionText(alert.Status).toUpperCase() === "IGNORED";
    var cycle = Number(alert && alert.NotificationCycle) || 1;
    return {
      sku: item.sku,
      activeProduction: true,
      shouldNotify: false,
      status: ignored ? "IGNORED" : classification.status,
      notificationItem: stockProductionBuildNotificationPayload(item, classification, ignored ? "IGNORED" : classification.status, cycle)
    };
  });
  var evaluatedAt = Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE, "dd/MM/yyyy HH:mm");
  var snapshot = stockProductionBuildLifecycleNotificationSnapshot(results, evaluatedAt);
  return {
    status: "success",
    permissions: user.permissions,
    eligibleCount: snapshot.eligibleCount,
    uniqueCount: snapshot.uniqueCount,
    batchedCount: snapshot.totalItemsAcrossMessages,
    messageCount: snapshot.messageCount,
    totalItemsAcrossMessages: snapshot.totalItemsAcrossMessages,
    duplicateCount: snapshot.duplicateCount,
    missingCount: snapshot.missingCount,
    batchSizes: snapshot.batchSizes,
    messages: snapshot.messages
  };
}

// Both event-driven and scheduled evaluation use this one dispatcher. The
// dashboard and queue-status handlers never call it, so viewing or progressing
// a job cannot produce a Telegram notification.
function stockProductionDispatchLifecycleBatch(results, sheets, options) {
  options = options || {};
  if (options.notify === false) return null;
  var evaluatedAt = Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE, "dd/MM/yyyy HH:mm");
  var snapshot = stockProductionBuildLifecycleNotificationSnapshot(results, evaluatedAt);
  if (!snapshot.triggerItems.length) {
    if (snapshot.triggerCount) return { status: "error", reason: "invalid_notification_snapshot", diagnostic: snapshot };
    return { status: "suppressed", reason: "no_new_active_items", diagnostic: snapshot };
  }
  if (snapshot.triggerMissingCount || snapshot.triggerTotalItemsAcrossMessages !== snapshot.triggerUniqueCount) {
    return { status: "error", reason: "invalid_notification_snapshot", diagnostic: snapshot };
  }
  var dateKey = Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE, "yyyy-MM-dd");
  var notification = stockProductionNotifyBatch(snapshot.triggerItems, dateKey, {
    evaluatedAt: evaluatedAt, sheets: sheets, user: options.user, source: "AUTOMATIC"
  });
  if (notification && notification.status === "success") {
    var notifiedAt = new Date();
    snapshot.triggerRows.forEach(function(item) {
      if (!item.alertRow || notification.sentSkus.indexOf(item.sku) < 0) return;
      stockProductionUpdateObjectRow(sheets.alerts, item.alertRow, {
        LastNotificationType: "PRODUCTION_REQUIRED",
        LastNotificationAt: notifiedAt
      });
    });
  }
  return notification;
}

function stockProductionAlertRecord(existing, item, classification, status, cycle, now) {
  return {
    AlertID: existing && existing.AlertID || "ALT-" + Utilities.getUuid(), SKU: item.sku, Product: item.product,
    Category: item.category, Color: item.color, Size: item.size, Stock: classification.stock,
    MinimumStock: classification.minimumStock, IdealStock: classification.idealStock, ProductionMin: classification.productionMin,
    ProductionTarget: classification.productionTarget, ProductionQty: classification.productionQty, MovingStat: classification.movingStat,
    ToDo: "PRODUKSI", Status: status, Priority: classification.priority, FirstDetectedAt: existing && existing.FirstDetectedAt || now,
    LastEvaluatedAt: now, ResolvedAt: "", IgnoredAt: existing && existing.IgnoredAt || "", IgnoredBy: existing && existing.IgnoredBy || "",
    IgnoreReason: existing && existing.IgnoreReason || "", NotificationCycle: cycle,
    LastNotificationType: existing && existing.LastNotificationType || "", LastNotificationAt: existing && existing.LastNotificationAt || ""
  };
}

function evaluateStockProductionItem(item, sheets, options) {
  options = options || {};
  var queueMap = options.queueMap || stockProductionQueueMap(stockProductionReadSheetObjects(sheets.queue));
  var alertMap = options.alertMap || stockProductionAlertMap(stockProductionReadSheetObjects(sheets.alerts));
  var activeQueue = queueMap[item.sku];
  var completedQueue = (options.completedQueueMap || {})[item.sku];
  var existing = alertMap[item.sku];
  var classification = classifyStockProductionItem(item, activeQueue && activeQueue.Status);
  if (!classification.valid) return { sku: item.sku, classification: classification, changed: false, activeProduction: false };
  if (stockProductionIsCompletedQueueWaitingStockIn(completedQueue, item, classification, options.transactionRows || [])) {
    return {
      sku: item.sku, classification: classification, changed: false, activeProduction: false,
      status: "PRODUCTION_COMPLETED_WAITING_STOCK_IN", shouldNotify: false, waitingForStockIn: true
    };
  }
  var activeProduction = stockProductionNeedsProduction(classification);
  var previousStatus = existing ? stockProductionText(existing.Status).toUpperCase() : "";
  var ignored = previousStatus === "IGNORED";
  var now = new Date();

  // A safe SKU has no active alert or pending work. Existing IN_PROGRESS work
  // deliberately remains open for an operator to finish or cancel.
  if (!activeProduction) {
    var resolvedAlert = false;
    if (existing && stockProductionIsActiveAlertStatus(previousStatus)) {
      var alertChanges = { Status: "RESOLVED", ResolvedAt: now, LastEvaluatedAt: now, ToDo: "", ProductionQty: 0 };
      stockProductionUpdateObjectRow(sheets.alerts, existing._row, alertChanges);
      stockProductionWriteHistory(sheets.history, options.user, "ALERT_RESOLVED", item.sku, "", existing, alertChanges, options.source || "AUTO_EVALUATION");
      resolvedAlert = true;
    }
    var resolvedQueue = stockProductionResolvePendingQueue(sheets, activeQueue, options.user, options.source || "AUTO_EVALUATION");
    return { sku: item.sku, classification: classification, changed: resolvedAlert || resolvedQueue, activeProduction: false, status: "NORMAL", shouldNotify: false };
  }

  var lifecycleStarted = !existing || previousStatus === "RESOLVED";
  var cycle = existing ? Number(existing.NotificationCycle) || 1 : 1;
  if (existing && previousStatus === "RESOLVED") cycle += 1;
  var persistedStatus = ignored ? "IGNORED" : classification.status;
  var record = stockProductionAlertRecord(existing, item, classification, persistedStatus, cycle, now);
  var alertRow = existing && existing._row;
  if (existing) stockProductionUpdateObjectRow(sheets.alerts, alertRow, record);
  else {
    stockProductionAppendByHeaders(sheets.alerts, STOCK_ALERT_HEADERS, record);
    alertRow = sheets.alerts.getLastRow();
  }

  var queueResult = null;
  if (!ignored && !activeQueue) queueResult = stockProductionCreateQueueRecord(sheets, item, classification, options.user, options.source || "AUTO_EVALUATION");
  else if (!ignored && stockProductionText(activeQueue.Status).toUpperCase() === "PENDING") stockProductionUpdatePendingQueue(sheets, activeQueue, item, classification, options.user, options.source || "AUTO_EVALUATION");

  var notificationItem = stockProductionBuildNotificationPayload(item, classification, persistedStatus, cycle);

  return {
    sku: item.sku, product: item.product, color: item.color, size: item.size, classification: classification,
    queue: queueResult, alertRow: alertRow, notificationItem: notificationItem, activeProduction: true, notificationCycle: cycle,
    shouldNotify: lifecycleStarted && !ignored && options.notify !== false, changed: lifecycleStarted, status: persistedStatus
  };
}

function stockProductionAttachRuntimeData(inventoryItems, configuration) {
  return (inventoryItems || []).map(function(item) {
    item.config = configuration.configs[item.sku] || null;
    var resolvedMoving = getStockProductionMoving(item.config);
    item.movingStat = resolvedMoving.movingStat;
    item.movingSource = resolvedMoving.movingSource;
    item.productionRecipient = item.config && item.config.productionRecipient || "";
    return item;
  });
}

function evaluateStockProductionForSku(sku, options) {
  try {
    var inventory = readStockProductionInventory();
    if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders };
    var configuration = readStockProductionConfiguration(inventory.items);
    if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [] };
    var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
    var item = runtimeItems.filter(function(row) { return row.sku === stockProductionText(sku); })[0];
    if (!item) return { status: "not_found", sku: sku };
    var sheets = ensureStockProductionDatabase();
    var evaluationOptions = options || {};
    var queueRows = stockProductionReadSheetObjects(sheets.queue);
    evaluationOptions.queueMap = stockProductionQueueMap(queueRows);
    evaluationOptions.completedQueueMap = stockProductionCompletedQueueMap(queueRows);
    evaluationOptions.transactionRows = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi"));
    var result = evaluateStockProductionItem(item, sheets, evaluationOptions);
    var notification = stockProductionDispatchLifecycleBatch([result], sheets, options || {});
    return { status: "success", result: result, notification: notification };
  } catch (error) {
    Logger.log("[StockProduction] SKU evaluation failed: " + error);
    return { status: "error", message: String(error) };
  }
}

function evaluateAllStockProduction(options) {
  options = options || {};
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [] };
  var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
  var sheets = ensureStockProductionDatabase();
  var queueRows = stockProductionReadSheetObjects(sheets.queue);
  var queueMap = stockProductionQueueMap(queueRows);
  var completedQueueMap = stockProductionCompletedQueueMap(queueRows);
  var alertMap = stockProductionAlertMap(stockProductionReadSheetObjects(sheets.alerts));
  var transactionRows = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi"));
  var results = runtimeItems.map(function(item) {
    return evaluateStockProductionItem(item, sheets, {
      user: options.user, notify: options.notify, source: options.source,
      queueMap: queueMap, completedQueueMap: completedQueueMap, alertMap: alertMap, transactionRows: transactionRows
    });
  });
  var notification = stockProductionDispatchLifecycleBatch(results, sheets, options);
  var notified = results.filter(function(row) { return row.shouldNotify; }).length;
  return { status: "success", evaluated: results.length, active: results.filter(function(row) { return row.activeProduction; }).length, notified: notified, notification: notification, results: results };
}

function runStockProductionDailyCheck() {
  return evaluateAllStockProduction({ notify: true, source: "DAILY_SCHEDULER", user: { email: "system", name: "System" } });
}

function stockProductionMatchesRecipient(recipient, filter) {
  var requested = stockProductionText(filter);
  var assigned = stockProductionText(recipient);
  if (!requested || requested === "ALL") return true;
  if (requested === "UNASSIGNED") return !assigned;
  return assigned === requested;
}

function stockProductionFilter(items, data) {
  var search = stockProductionText(data.search).toLowerCase();
  var status = stockProductionText(data.status).toUpperCase();
  var moving = stockProductionText(data.moving).toUpperCase();
  var todo = stockProductionText(data.todo).toUpperCase();
  var priority = stockProductionText(data.priority).toUpperCase();
  var recipient = stockProductionText(data.productionRecipient);
  return (items || []).filter(function(item) {
    if (search && [item.sku, item.product, item.color, item.size].join(" ").toLowerCase().indexOf(search) < 0) return false;
    if (status && status !== "ALL" && item.status !== status) return false;
    if (moving && moving !== "ALL" && item.movingStat !== moving) return false;
    if (todo && todo !== "ALL" && stockProductionText(item.todo).toUpperCase() !== todo) return false;
    if (priority && priority !== "ALL" && item.priority !== priority) return false;
    if (!stockProductionMatchesRecipient(item.productionRecipient, recipient)) return false;
    return true;
  });
}

function stockProductionFilterActiveQueueRows(queueRows) {
  return (queueRows || []).filter(function(row) {
    var status = stockProductionText(row.Status).toUpperCase();
    return status === "PENDING" || status === "IN_PROGRESS";
  });
}

function ensureProductionConfigurationSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCTION_CONFIGURATION_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCTION_CONFIGURATION_SHEET);
    sheet.getRange(1, 1, 1, STOCK_PRODUCTION_CONFIG_HEADERS.length).setValues([STOCK_PRODUCTION_CONFIG_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, STOCK_PRODUCTION_CONFIG_HEADERS.length).setValues([STOCK_PRODUCTION_CONFIG_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionText);
  var missingRequired = STOCK_PRODUCTION_REQUIRED_CONFIG_HEADERS.filter(function(header) { return existing.indexOf(header) < 0; });
  if (missingRequired.length) throw new Error("Header ProductionConfiguration tidak lengkap: " + missingRequired.join(", "));
  var missingOptional = STOCK_PRODUCTION_CONFIG_HEADERS.filter(function(header) { return existing.indexOf(header) < 0; });
  if (missingOptional.length) sheet.getRange(1, existing.length + 1, 1, missingOptional.length).setValues([missingOptional]);
  return sheet;
}

function stockProductionConfigurationView(config, item) {
  var resolvedMoving = getStockProductionMoving(config);
  return {
    sku: config.sku,
    product: item && item.product || "",
    category: item && item.category || "",
    color: item && item.color || "",
    size: item && item.size || "",
    stock: item && stockProductionNumber(item.stock),
    minimumStock: config.minimumStock,
    targetStock: config.targetStock,
    minimumProductionBatch: config.minimumProductionBatch,
    moving: resolvedMoving.movingStat,
    movingSource: resolvedMoving.movingSource,
    configuredMoving: config.moving || "",
    productionRecipient: config.productionRecipient || "",
    enabled: config.enabled,
    notes: config.notes,
    valid: config.valid,
    validationError: config.error || ""
  };
}

function stockProductionFilterConfigurationRows(rows, data) {
  var search = stockProductionText((data || {}).search).toLowerCase();
  var enabled = stockProductionText((data || {}).enabled).toUpperCase();
  return (rows || []).filter(function(row) {
    if (search && [row.sku, row.product, row.color, row.size].join(" ").toLowerCase().indexOf(search) < 0) return false;
    if (enabled === "TRUE" && !row.enabled) return false;
    if (enabled === "FALSE" && row.enabled) return false;
    return true;
  });
}

function stockProductionRecipientView(recipient) {
  // PENJAHIT is a legacy value; production routing has one external type.
  var rawType = stockProductionText(recipient.type || recipient.Type).toUpperCase();
  return {
    id: recipient.id || recipient.RecipientID || "", name: recipient.name || recipient.Name || "", type: rawType === "PENJAHIT" || rawType === "KONVEKSI" ? "KONVEKSI" : rawType,
    telegramChatId: recipient.telegramChatId || recipient.TelegramChatId || "", active: recipient.active === true || stockProductionIsEnabled(recipient.Active), notes: recipient.notes || recipient.Notes || ""
  };
}

function handleGetProductionRecipients(data) {
  requireStockProductionPermission(data, "manage_stock_alert_settings");
  var recipients = readProductionRecipients();
  var rows = recipients.recipients.map(stockProductionRecipientView);
  return {
    status: "success", message: "Daftar penerima produksi berhasil dimuat.", available: recipients.available,
    rows: rows, data: rows, invalidRecipients: recipients.invalid
  };
}

function stockProductionValidateRecipientInput(data) {
  var id = stockProductionText((data || {}).recipientId || (data || {}).id);
  var name = stockProductionText((data || {}).name);
  var type = stockProductionText((data || {}).type).toUpperCase();
  var chatId = stockProductionText((data || {}).chatId || (data || {}).telegramChatId);
  if (!id) throw new Error("ID penerima wajib diisi.");
  if (!name) throw new Error("Nama penjahit/konveksi wajib diisi.");
  // Accept the old value on update, but persist one canonical type for new data.
  if (type !== "PENJAHIT" && type !== "KONVEKSI") throw new Error("Tipe penerima harus Konveksi.");
  var active = stockProductionIsEnabled((data || {}).active);
  if (chatId && !/^-?\d+$/.test(chatId)) throw new Error("Chat ID Telegram tidak valid. Gunakan angka Chat ID yang diberikan oleh bot.");
  if (active && !chatId) throw new Error("Chat ID Telegram wajib diisi untuk penerima aktif.");
  return { id: id, name: name, type: "KONVEKSI", telegramChatId: chatId, active: active, notes: stockProductionText((data || {}).notes) };
}

function handleSaveProductionRecipient(data) {
  var user = requireStockProductionPermission(data, "manage_stock_alert_settings");
  var input = stockProductionValidateRecipientInput(data);
  var existing = readProductionRecipients();
  if ((existing.byId[input.id] || null) && stockProductionText((data || {}).mode).toUpperCase() === "CREATE") return { status: "error", message: "ID penerima sudah digunakan." };
  if (existing.invalid.length) return { status: "error", message: "Konfigurasi penerima tidak valid. Perbaiki data lama terlebih dahulu." };
  var sheet = ensureProductionRecipientsSheet();
  var record = {
    RecipientID: input.id, Name: input.name, Type: input.type, TelegramChatId: input.telegramChatId,
    Active: input.active, Notes: input.notes, UpdatedAt: new Date(), UpdatedBy: user.email
  };
  if (existing.byId[input.id]) stockProductionUpdateObjectRow(sheet, existing.byId[input.id].row, record);
  else stockProductionAppendByHeaders(sheet, PRODUCTION_RECIPIENT_HEADERS, record);
  var savedRecipient = stockProductionRecipientView(record);
  return {
    status: "success",
    message: existing.byId[input.id] ? "Penerima produksi berhasil diperbarui." : "Penerima produksi berhasil disimpan.",
    mode: existing.byId[input.id] ? "updated" : "created",
    recipient: savedRecipient,
    data: savedRecipient
  };
}

function handleDeleteProductionRecipient(data) {
  requireStockProductionPermission(data, "manage_stock_alert_settings");
  var id = stockProductionText((data || {}).recipientId || (data || {}).id);
  var recipients = readProductionRecipients();
  var recipient = recipients.byId[id];
  if (!recipient) return { status: "error", message: "Penerima produksi tidak ditemukan." };
  var inventory = readStockProductionInventory();
  var config = inventory.ok ? readStockProductionConfiguration(inventory.items) : null;
  var usedBy = config && config.ok ? Object.keys(config.configs).filter(function(sku) { return stockProductionText(config.configs[sku].productionRecipient) === id; }) : [];
  if (usedBy.length) return { status: "error", message: "Penerima masih digunakan oleh " + usedBy.length + " konfigurasi SKU." };
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_RECIPIENTS_SHEET).deleteRow(recipient.row);
  return { status: "success", id: id };
}

function stockProductionNormalizeManualPriority(value) {
  var priority = stockProductionText(value).toUpperCase().trim();
  if (!priority || priority === "ALL" || priority === "SEMUA") return "ALL";
  if (["FAST", "MIDDLE", "SLOW"].indexOf(priority) >= 0) return priority;
  throw new Error("Prioritas manual harus SEMUA, CEPAT, SEDANG, atau LAMBAT.");
}

function stockProductionNormalizePositiveInteger(value, label) {
  var text = stockProductionText(value).trim();
  var fieldLabel = stockProductionText(label) || "Jumlah produksi";
  if (!/^\d+$/.test(text)) throw new Error(fieldLabel + " harus berupa bilangan bulat lebih dari 0.");
  var quantity = Number(text);
  if (!isFinite(quantity) || quantity <= 0 || Math.floor(quantity) !== quantity) {
    throw new Error(fieldLabel + " harus berupa bilangan bulat lebih dari 0.");
  }
  return quantity;
}

function stockProductionNormalizeManualProductionQty(value) {
  return stockProductionNormalizePositiveInteger(value, "Jumlah produksi manual");
}

function stockProductionBuildManualNotificationSnapshot(data) {
  var manualPriority = stockProductionNormalizeManualPriority((data || {}).priority);
  var recipientSource = readProductionRecipients();
  var recipientResolution = stockProductionResolveRecipient((data || {}).recipientId, recipientSource);
  if (recipientResolution.status !== "resolved") throw new Error("Penerima tidak aktif atau Chat ID Telegram belum tersedia.");
  var inventory = readStockProductionInventory();
  if (!inventory.ok) throw new Error(inventory.error);
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) throw new Error(configuration.error);
  var inputs = Array.isArray((data || {}).items) ? data.items : [];
  if (!inputs.length) throw new Error("Pilih minimal satu SKU.");
  var inventoryBySku = {};
  inventory.items.forEach(function(item) { inventoryBySku[item.sku] = item; });
  var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
  var runtimeBySku = {};
  runtimeItems.forEach(function(item) { runtimeBySku[item.sku] = item; });
  var queueRows = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_QUEUE_SHEET));
  var queueMap = stockProductionQueueMap(queueRows);
  var completedQueueMap = stockProductionCompletedQueueMap(queueRows);
  var transactionRows = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi"));
  var seen = {};
  var warnings = [];
  var items = inputs.map(function(raw) {
    var sku = stockProductionText(raw && raw.sku);
    if (!sku || seen[sku]) throw new Error("SKU manual harus unik dan tidak boleh kosong.");
    seen[sku] = true;
    var item = inventoryBySku[sku];
    var config = configuration.configs[sku];
    if (!item || !config || !config.valid) throw new Error("SKU manual tidak memiliki konfigurasi produksi valid: " + sku);
    var runtimeItem = runtimeBySku[sku];
    var classification = classifyStockProductionItem(runtimeItem, queueMap[sku] && queueMap[sku].Status);
    if (!classification.valid || !stockProductionNeedsProduction(classification)) throw new Error("SKU manual tidak sedang memenuhi kebutuhan produksi aktif: " + sku + ".");
    if (manualPriority !== "ALL" && stockProductionText(classification.movingStat).toUpperCase() !== manualPriority) {
      throw new Error("SKU manual tidak sesuai filter urgensi " + manualPriority + ": " + sku + ".");
    }
    if (stockProductionIsCompletedQueueWaitingStockIn(completedQueueMap[sku], runtimeItem, classification, transactionRows)) throw new Error("SKU manual masih menunggu Barang Masuk setelah produksi selesai: " + sku + ".");
    var hasManualProductionQty = raw && Object.prototype.hasOwnProperty.call(raw, "manualProductionQty");
    var manualProductionQty = hasManualProductionQty ? stockProductionNormalizeManualProductionQty(raw.manualProductionQty) : null;
    var effectiveProductionQty = manualProductionQty == null ? classification.productionQty : manualProductionQty;
    var assignment = stockProductionResolveRecipient(config.productionRecipient, recipientSource);
    if (assignment.status === "resolved" && assignment.recipient.id !== recipientResolution.recipient.id) warnings.push({ sku: sku, configuredRecipient: assignment.recipient.name });
    else if (assignment.status !== "resolved") warnings.push({ sku: sku, configuredRecipient: "Belum memiliki penjahit/konveksi aktif" });
    return {
      sku: sku, product: item.product, color: item.color, size: item.size, stock: classification.stock,
      minimumStock: classification.minimumStock, targetStock: classification.productionTarget,
      minimumProductionBatch: classification.productionMin, productionQty: classification.productionQty,
      manualProductionQty: manualProductionQty, effectiveProductionQty: effectiveProductionQty,
      movingStat: classification.movingStat, movingState: classification.movingStat, status: classification.status,
      productionRecipient: recipientResolution.recipient.id
    };
  });
  var evaluatedAt = Utilities.formatDate(new Date(), STOCK_PRODUCTION_TIMEZONE, "dd/MM/yyyy HH:mm");
  var snapshot = {
    recipient: recipientResolution.recipient, priority: manualPriority, items: items, warnings: warnings, evaluatedAt: evaluatedAt,
    messages: []
  };
  snapshot.messages = stockProductionBuildProductionMessages(snapshot.items, snapshot.evaluatedAt, null, {
    destination: snapshot.recipient.name
  });
  return snapshot;
}

function handlePreviewManualProductionNotification(data) {
  requireStockProductionPermission(data, "manage_production_queue");
  var snapshot = stockProductionBuildManualNotificationSnapshot(data);
  return { status: "success", recipient: stockProductionRecipientView(snapshot.recipient), warnings: snapshot.warnings, messages: snapshot.messages, itemCount: snapshot.items.length };
}

function handleSendManualProductionNotification(data) {
  var user = requireStockProductionPermission(data, "manage_production_queue");
  var requestId = stockProductionText((data || {}).manualRequestId);
  if (!requestId) return { status: "error", message: "ID pengiriman manual wajib tersedia." };
  var snapshot = stockProductionBuildManualNotificationSnapshot(data);
  if (snapshot.warnings.length && (data || {}).confirmRecipientMismatch !== true) {
    return { status: "warning", message: "Tujuan berbeda dari penjahit/konveksi SKU.", warnings: snapshot.warnings, messages: snapshot.messages };
  }
  var key = ["MANUAL_PRODUCTION_NOTIFICATION", snapshot.recipient.id, requestId].join(":");
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return { status: "suppressed", reason: "manual_request_duplicate" };
  var deliveries = [];
  for (var i = 0; i < snapshot.messages.length; i++) {
    var result = NotificationService.sendToRecipient("PRODUCTION_REQUIRED", snapshot.recipient, {
      message: snapshot.messages[i], table: snapshot.messages[i], entityKey: snapshot.items.map(function(item) { return item.sku; }).join(","), idempotencyKey: key
    });
    deliveries.push(result);
    if (!result || result.status === "error") {
      stockProductionWriteManualNotificationAudit(snapshot.items, snapshot.recipient, result || { status: "error" }, snapshot.messages, user);
      return { status: "error", message: result && result.message || "Gagal mengirim notifikasi manual.", results: deliveries };
    }
  }
  props.setProperty(key, new Date().toISOString());
  stockProductionWriteManualNotificationAudit(snapshot.items, snapshot.recipient, { status: "success" }, snapshot.messages, user);
  return { status: "success", recipient: stockProductionRecipientView(snapshot.recipient), itemCount: snapshot.items.length, messageCount: snapshot.messages.length, results: deliveries };
}

function handleGetProductionConfigurations(data) {
  var user = requireStockProductionPermission(data, "view_stock_alerts");
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders, permissions: user.permissions };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [], permissions: user.permissions };
  var itemBySku = {};
  inventory.items.forEach(function(item) { itemBySku[item.sku] = item; });
  var rows = Object.keys(configuration.configs).sort().map(function(sku) {
    return stockProductionConfigurationView(configuration.configs[sku], itemBySku[sku]);
  });
  var filtered = stockProductionFilterConfigurationRows(rows, data);
  var page = Math.max(1, Number((data || {}).page) || 1);
  var pageSize = Math.min(100, Math.max(10, Number((data || {}).pageSize) || 25));
  var start = (page - 1) * pageSize;
  var recipients = readProductionRecipients();
  return {
    status: "success", permissions: user.permissions, configurationAvailable: configuration.available,
    rows: filtered.slice(start, start + pageSize), total: filtered.length, page: page, pageSize: pageSize,
    inventory: inventory.items.map(function(item) { return { sku: item.sku, product: item.product, color: item.color, size: item.size, stock: stockProductionNumber(item.stock) }; }),
    invalidConfigurations: configuration.invalidSkus,
    recipients: recipients.recipients.map(function(recipient) {
      return { id: recipient.id, name: recipient.name, type: recipient.type, active: recipient.active };
    })
  };
}

function stockProductionValidateConfigurationInput(data, inventoryItems) {
  var sku = stockProductionText((data || {}).sku);
  var item = (inventoryItems || []).filter(function(row) { return row.sku === sku; })[0];
  var minimum = stockProductionNumber((data || {}).minimumStock);
  var target = stockProductionNumber((data || {}).targetStock);
  var batch = stockProductionNumber((data || {}).minimumProductionBatch);
  var moving = stockProductionText((data || {}).moving);
  if (!item) throw new Error("SKU tidak ditemukan di MasterBarang.");
  if (minimum === null || minimum < 0) throw new Error("Minimum Stock harus berupa angka >= 0.");
  if (target === null || target <= minimum) throw new Error("Target Stock harus lebih besar dari Minimum Stock.");
  if (batch === null || batch <= 0) throw new Error("Minimum Production Batch harus lebih besar dari 0.");
  if (!stockProductionIsValidMoving(moving)) throw new Error("Moving harus FAST, MIDDLE, atau SLOW.");
  return {
    sku: sku, item: item, minimumStock: minimum, targetStock: target,
    minimumProductionBatch: batch, moving: moving,
    movingSource: "MANUAL", productionRecipient: stockProductionText((data || {}).productionRecipient),
    enabled: stockProductionIsEnabled((data || {}).enabled), notes: stockProductionText((data || {}).notes)
  };
}

function handleSaveProductionConfiguration(data) {
  var user = requireStockProductionPermission(data, "manage_stock_alert_settings");
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders };
  var input = stockProductionValidateConfigurationInput(data, inventory.items);
  var existingConfiguration = readStockProductionConfiguration(inventory.items);
  if (!existingConfiguration.ok) return { status: "configuration_required", message: existingConfiguration.error, missingHeaders: existingConfiguration.missingHeaders || [] };
  var existing = existingConfiguration.configs[input.sku];
  if (stockProductionText((data || {}).mode).toUpperCase() === "CREATE" && existing) return { status: "error", message: "Konfigurasi untuk SKU ini sudah ada." };
  if (existing && !existing.valid) return { status: "error", message: "Konfigurasi SKU ini duplikat atau tidak valid. Perbaiki data lama terlebih dahulu." };
  if (input.productionRecipient) {
    var resolvedRecipient = stockProductionResolveRecipient(input.productionRecipient, readProductionRecipients());
    if (resolvedRecipient.status !== "resolved") return { status: "error", message: "Penjahit/konveksi harus berupa penerima aktif dengan Chat ID Telegram." };
    input.productionRecipient = resolvedRecipient.recipient.id;
  }
  var sheet = ensureProductionConfigurationSheet();
  var now = new Date();
  var record = {
    SKU: input.sku, MinimumStock: input.minimumStock, TargetStock: input.targetStock,
    MinimumProductionBatch: input.minimumProductionBatch, Moving: input.moving,
    MovingSource: input.movingSource, ProductionRecipient: input.productionRecipient, Enabled: input.enabled,
    Notes: input.notes, UpdatedAt: now, UpdatedBy: user.email
  };
  if (existing) stockProductionUpdateObjectRow(sheet, existing.row, record);
  else stockProductionAppendByHeaders(sheet, STOCK_PRODUCTION_CONFIG_HEADERS, record);
  return { status: "success", mode: existing ? "updated" : "created", configuration: stockProductionConfigurationView({ sku: input.sku, minimumStock: input.minimumStock, targetStock: input.targetStock, minimumProductionBatch: input.minimumProductionBatch, moving: input.moving, movingSource: input.movingSource, productionRecipient: input.productionRecipient, enabled: input.enabled, notes: input.notes, valid: true }, input.item) };
}

function handleDeleteProductionConfiguration(data) {
  var user = requireStockProductionPermission(data, "manage_stock_alert_settings");
  var sku = stockProductionText((data || {}).sku);
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [] };
  var existing = configuration.configs[sku];
  if (!existing) return { status: "error", message: "Konfigurasi SKU tidak ditemukan." };
  var queueSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_QUEUE_SHEET);
  var activeQueue = stockProductionReadSheetObjects(queueSheet).filter(function(row) {
    var status = stockProductionText(row.Status).toUpperCase();
    return stockProductionText(row.SKU) === sku && (status === "PENDING" || status === "IN_PROGRESS");
  })[0];
  if (activeQueue) return { status: "error", message: "Konfigurasi tidak dapat dihapus selama Production Queue masih " + stockProductionText(activeQueue.Status) + "." };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_CONFIGURATION_SHEET);
  if (!sheet) return { status: "error", message: "ProductionConfiguration belum tersedia." };
  sheet.deleteRow(existing.row);
  return { status: "success", sku: sku, deletedBy: user.email };
}

function handleGetStockProductionDashboard(data) {
  var user = requireStockProductionPermission(data, "view_stock_alerts");
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders, permissions: user.permissions };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [], permissions: user.permissions };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queueRows = stockProductionReadSheetObjects(ss.getSheetByName(PRODUCTION_QUEUE_SHEET));
  var queueMap = stockProductionQueueMap(queueRows);
  var completedQueueMap = stockProductionCompletedQueueMap(queueRows);
  var transactionRows = stockProductionReadSheetObjects(ss.getSheetByName("Transaksi"));
  var alertRows = stockProductionReadSheetObjects(ss.getSheetByName(STOCK_ALERTS_SHEET));
  var persistedAlerts = stockProductionAlertMap(alertRows);
  var recipients = readProductionRecipients();
  var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
  var items = runtimeItems.map(function(item) {
    var queue = queueMap[item.sku];
    var c = classifyStockProductionItem(item, queue && queue.Status);
    var waitingForStockIn = stockProductionIsCompletedQueueWaitingStockIn(completedQueueMap[item.sku], item, c, transactionRows);
    var persisted = persistedAlerts[item.sku];
    var ignored = persisted && stockProductionText(persisted.Status).toUpperCase() === "IGNORED";
    return {
      sku: item.sku, product: item.product, category: item.category, color: item.color, size: item.size, stock: c.stock,
      minimumStock: c.minimumStock, idealStock: c.idealStock, productionMin: c.productionMin, productionTarget: c.productionTarget,
      productionQty: c.productionQty, movingStat: c.movingStat, todo: c.todo, priority: c.priority,
      productionRecipient: item.productionRecipient,
      productionRecipientName: stockProductionRecipientLabel(item.productionRecipient, recipients),
      status: waitingForStockIn ? "PRODUCTION_COMPLETED_WAITING_STOCK_IN" : (ignored && c.activeProduction ? "IGNORED" : c.status),
      activeProduction: waitingForStockIn ? false : c.activeProduction,
      queueId: queue && queue.QueueID || "", queueStatus: queue && queue.Status || ""
    };
  }).filter(function(item) { return item.activeProduction; });
  var filtered = stockProductionFilter(items, data || {});
  var recipientFilter = stockProductionText((data || {}).productionRecipient);
  var recipientItems = items.filter(function(item) { return stockProductionMatchesRecipient(item.productionRecipient, recipientFilter); });
  var recipientQueueRows = queueRows.filter(function(queue) { return stockProductionMatchesRecipient(queue.ProductionRecipient, recipientFilter); });
  var recipientBySku = {};
  runtimeItems.forEach(function(item) { recipientBySku[item.sku] = item.productionRecipient; });
  var recipientAlertRows = alertRows.filter(function(alert) { return stockProductionMatchesRecipient(recipientBySku[stockProductionText(alert.SKU)], recipientFilter); });
  var page = Math.max(1, Number(data.page) || 1);
  var pageSize = Math.min(100, Math.max(10, Number(data.pageSize) || 25));
  var start = (page - 1) * pageSize;
  var kpi = { totalAlerts: recipientItems.length, lowStock: 0, critical: 0, productionRequired: 0, inProgress: 0, completed: 0, resolved: 0 };
  recipientItems.forEach(function(item) { if (item.status === "CRITICAL") kpi.critical += 1; if (item.status === "PRODUCTION_REQUIRED") kpi.productionRequired += 1; if (item.status === "PRODUCTION_IN_PROGRESS") kpi.inProgress += 1; });
  var statisticsBaseline = stockProductionReadStatisticsBaseline();
  var statisticsKpi = stockProductionStatisticsKpi(recipientQueueRows, recipientAlertRows, statisticsBaseline);
  kpi.completed = statisticsKpi.completed;
  kpi.resolved = statisticsKpi.resolved;
  var queueById = {};
  queueRows.forEach(function(queue) { queueById[stockProductionText(queue.QueueID)] = queue; });
  return {
    status: "success", permissions: user.permissions, kpi: kpi, items: filtered.slice(start, start + pageSize), total: filtered.length,
    page: page, pageSize: pageSize,
    queue: stockProductionFilterActiveQueueRows(queueRows).sort(function(a, b) { return new Date(b.UpdatedAt || b.CreatedAt) - new Date(a.UpdatedAt || a.CreatedAt); }).slice(0, 100).map(function(row) {
      row.ProductionRecipientName = stockProductionRecipientLabel(row.ProductionRecipient, recipients);
      return row;
    }),
    history: stockProductionReadSheetObjects(ss.getSheetByName(PRODUCTION_HISTORY_SHEET)).filter(function(entry) {
      var queue = queueById[stockProductionText(entry.QueueID)];
      return !queue || stockProductionMatchesRecipient(queue.ProductionRecipient, recipientFilter);
    }).sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); }).slice(0, 100),
    recipients: recipients.recipients.map(function(recipient) {
      return { id: recipient.id, name: recipient.name, type: recipient.type, active: recipient.active };
    }),
    configurationAvailable: configuration.available, invalidConfigurations: configuration.invalidSkus,
    statisticsBaseline: statisticsBaseline
  };
}

function handleResetStockProductionStatistics(data) {
  var user = requireStockProductionPermission(data, "manage_stock_alert_settings");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: "error", message: "Reset statistik sedang diproses. Coba lagi." };
  try {
    var baselineAt = new Date().toISOString();
    var baseline = {
      completedBaselineAt: baselineAt,
      resolvedBaselineAt: baselineAt,
      updatedAt: baselineAt,
      updatedBy: user.email
    };
    PropertiesService.getScriptProperties().setProperty(STOCK_PRODUCTION_STATISTICS_BASELINE_KEY, JSON.stringify(baseline));
    return {
      status: "success",
      baselineAt: baselineAt,
      updatedBy: user.email,
      statisticsBaseline: baseline
    };
  } finally {
    lock.releaseLock();
  }
}

// Isolated corrective route for a pre-validated list of stale PENDING queue
// snapshots. It never evaluates lifecycle state, alerts, notifications, or
// history; it only reuses the existing PENDING diff writer for eligible rows.
function handleTargetedPendingQueueRefresh(data) {
  var user = requireStockProductionPermission(data, "manage_production_queue");
  var rawTargets = data && data.targetSkus;
  if (!Array.isArray(rawTargets) || !rawTargets.length) {
    return { status: "error", message: "targetSkus wajib berupa daftar SKU non-kosong." };
  }
  var targetSkus = rawTargets.map(stockProductionText).filter(Boolean);
  var uniqueTargets = {};
  targetSkus.forEach(function(sku) { uniqueTargets[sku] = true; });
  if (targetSkus.length !== rawTargets.length || Object.keys(uniqueTargets).length !== targetSkus.length) {
    return { status: "error", message: "targetSkus wajib unik dan tidak boleh kosong." };
  }
  if (targetSkus.length > STOCK_PRODUCTION_TARGETED_REFRESH_MAX_TARGETS) {
    return { status: "error", message: "Jumlah target melebihi batas refresh terkontrol.", maxTargets: STOCK_PRODUCTION_TARGETED_REFRESH_MAX_TARGETS };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: "error", message: "Refresh Queue sedang diproses. Coba lagi." };
  try {
    var inventory = readStockProductionInventory();
    if (!inventory.ok) return { status: "configuration_required", message: inventory.error, missingHeaders: inventory.missingHeaders || [] };
    var configuration = readStockProductionConfiguration(inventory.items);
    if (!configuration.ok) return { status: "configuration_required", message: configuration.error, missingHeaders: configuration.missingHeaders || [] };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var queueSheet = ss.getSheetByName(PRODUCTION_QUEUE_SHEET);
    if (!queueSheet) return { status: "error", message: "ProductionQueue tidak tersedia." };
    var queueHeaders = queueSheet.getRange(1, 1, 1, queueSheet.getLastColumn()).getValues()[0].map(stockProductionText);
    var requiredQueueHeaders = ["QueueID", "SKU", "Status", "RecommendedQty", "PlannedQty", "MovingStat", "Priority", "UpdatedAt"];
    var missingQueueHeaders = requiredQueueHeaders.filter(function(header) { return queueHeaders.indexOf(header) < 0; });
    if (missingQueueHeaders.length) {
      return { status: "error", message: "Header ProductionQueue tidak lengkap.", missingHeaders: missingQueueHeaders };
    }
    var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
    var itemBySku = {};
    runtimeItems.forEach(function(item) { itemBySku[item.sku] = item; });
    var queueRowsBySku = {};
    stockProductionReadSheetObjects(queueSheet).forEach(function(queue) {
      var sku = stockProductionText(queue.SKU);
      if (!queueRowsBySku[sku]) queueRowsBySku[sku] = [];
      queueRowsBySku[sku].push(queue);
    });

    // Phase 1: create a complete write plan. No writer is reachable here.
    var results = targetSkus.map(function(sku) {
      var item = itemBySku[sku];
      var rows = queueRowsBySku[sku] || [];
      var pendingQueue = rows.filter(function(row) { return stockProductionText(row.Status).toUpperCase() === "PENDING"; })[0];
      var classification = item ? classifyStockProductionItem(item, pendingQueue && pendingQueue.Status) : null;
      var decision = stockProductionTargetedPendingQueueDecision(rows, item, classification);
      var sourceQueue = decision.queue || rows[0] || null;
      var result = {
        sku: sku,
        action: decision.action,
        queueId: sourceQueue && sourceQueue.QueueID || "",
        queueStatus: sourceQueue && sourceQueue.Status || decision.status || "",
        changedFields: Object.keys(decision.changes || {}),
        queue: decision.queue || null,
        item: item || null,
        classification: classification || null
      };
      return result;
    });
    var unsafePlans = results.filter(function(result) {
      return result.action !== "WOULD_UPDATE" && result.action !== "NO_CHANGE";
    });
    var unexpectedDiff = results.some(function(result) {
      return result.changedFields.some(function(field) {
        return ["RecommendedQty", "PlannedQty", "MovingStat", "Priority"].indexOf(field) < 0;
      });
    });
    var summary = { requested: targetSkus.length, updated: 0, noChange: 0, targetChanged: 0, skippedLifecycle: 0, targetNotFound: 0, ambiguous: 0 };
    results.forEach(function(result) {
      if (result.action === "NO_CHANGE") summary.noChange += 1;
      else if (result.action === "TARGET_CHANGED") summary.targetChanged += 1;
      else if (result.action === "SKIP_LIFECYCLE") summary.skippedLifecycle += 1;
      else if (result.action === "TARGET_NOT_FOUND") summary.targetNotFound += 1;
      else if (result.action === "AMBIGUOUS_PENDING_QUEUE") summary.ambiguous += 1;
    });
    if (unsafePlans.length || unexpectedDiff) {
      return {
        status: "aborted",
        message: "Pre-write validation gagal; tidak ada Queue yang diubah.",
        summary: summary,
        results: results.map(function(result) {
          return { sku: result.sku, action: result.action, queueId: result.queueId, queueStatus: result.queueStatus, changedFields: result.changedFields };
        })
      };
    }

    // Phase 2: every target has passed validation. Only the existing PENDING
    // diff writer is allowed to mutate the already-read Queue sheet.
    results.forEach(function(result) {
      if (result.action !== "WOULD_UPDATE") return;
      var updated = stockProductionUpdatePendingQueue(
        { queue: queueSheet }, result.queue, result.item, result.classification, user, "TARGETED_PENDING_QUEUE_REFRESH",
        { allowedFields: ["RecommendedQty", "PlannedQty", "MovingStat", "Priority"] }
      );
      if (updated) {
        result.action = "UPDATED";
        summary.updated += 1;
      } else {
        // ScriptLock prevents concurrent route writes; reaching this branch
        // means the live target changed unexpectedly, so never retry blindly.
        result.action = "TARGET_CHANGED";
        summary.targetChanged += 1;
      }
    });
    return {
      status: "success",
      summary: summary,
      results: results.map(function(result) {
        return { sku: result.sku, action: result.action, queueId: result.queueId, queueStatus: result.queueStatus, changedFields: result.changedFields };
      })
    };
  } finally {
    lock.releaseLock();
  }
}

// Reset testing is deliberately explicit. Queue and Alert rows have no
// authoritative TEST marker, so these helpers never infer that a row is test
// data: the administrator must select immutable row IDs from a dry-run.
function stockProductionTestingResetFingerprint(parts) {
  var value = (parts || []).map(function(part) { return stockProductionText(part); }).join("\u001f");
  var hash = 2166136261;
  for (var index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function stockProductionTestingResetQueueFingerprint(queue) {
  return stockProductionTestingResetFingerprint([
    "QUEUE", queue && queue.QueueID, queue && queue.Status, queue && queue.SKU,
    queue && queue.Product, queue && queue.Color, queue && queue.Size,
    queue && queue.CreatedAt, queue && queue.UpdatedAt, queue && queue.CompletedQty,
    queue && queue.ActiveRequirementKey
  ]);
}

function stockProductionTestingResetAlertFingerprint(alert) {
  return stockProductionTestingResetFingerprint([
    "ALERT", alert && alert.AlertID, alert && alert.Status, alert && alert.SKU,
    alert && alert.Product, alert && alert.Color, alert && alert.Size,
    alert && alert.FirstDetectedAt, alert && alert.LastEvaluatedAt,
    alert && alert.ProductionQty, alert && alert.NotificationCycle
  ]);
}

function stockProductionTestingResetIdList(values, label) {
  if (!Array.isArray(values)) return { ok: false, error: label + " wajib berupa daftar." };
  var ids = values.map(stockProductionText).filter(Boolean);
  var unique = {};
  ids.forEach(function(id) { unique[id] = true; });
  if (ids.length !== values.length || Object.keys(unique).length !== ids.length) {
    return { ok: false, error: label + " wajib unik dan tidak boleh kosong." };
  }
  return { ok: true, ids: ids };
}

function stockProductionTestingResetReadExistingSheet(name, requiredHeaders) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return { ok: false, error: name + " tidak tersedia." };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionText);
  var missing = (requiredHeaders || []).filter(function(header) { return headers.indexOf(header) < 0; });
  if (missing.length) return { ok: false, error: "Header " + name + " tidak lengkap.", missingHeaders: missing };
  return { ok: true, sheet: sheet, rows: stockProductionReadSheetObjects(sheet) };
}

function stockProductionTestingResetQueueCandidate(queue) {
  return {
    id: stockProductionText(queue.QueueID), sku: stockProductionText(queue.SKU), product: stockProductionText(queue.Product),
    color: stockProductionText(queue.Color), size: stockProductionText(queue.Size), status: stockProductionText(queue.Status).toUpperCase(),
    createdAt: queue.CreatedAt || "", createdBy: stockProductionText(queue.CreatedBy), completedQty: queue.CompletedQty,
    productionRecipient: stockProductionText(queue.ProductionRecipient), fingerprint: stockProductionTestingResetQueueFingerprint(queue)
  };
}

function stockProductionTestingResetAlertCandidate(alert) {
  return {
    id: stockProductionText(alert.AlertID), sku: stockProductionText(alert.SKU), product: stockProductionText(alert.Product),
    color: stockProductionText(alert.Color), size: stockProductionText(alert.Size), status: stockProductionText(alert.Status).toUpperCase(),
    firstDetectedAt: alert.FirstDetectedAt || "", createdBy: stockProductionText(alert.CreatedBy), productionQty: alert.ProductionQty,
    fingerprint: stockProductionTestingResetAlertFingerprint(alert)
  };
}

function stockProductionTestingResetBuildPlan(queueRows, alertRows, queueIds, alertIds, fingerprints) {
  var queueById = {};
  var alertById = {};
  (queueRows || []).forEach(function(row) { if (stockProductionText(row.QueueID)) queueById[stockProductionText(row.QueueID)] = row; });
  (alertRows || []).forEach(function(row) { if (stockProductionText(row.AlertID)) alertById[stockProductionText(row.AlertID)] = row; });
  var expected = fingerprints || {};
  var results = [];

  function addQueue(id) {
    var row = queueById[id];
    if (!row) return results.push({ type: "QUEUE", id: id, action: "TARGET_NOT_FOUND", blocking: true });
    var status = stockProductionText(row.Status).toUpperCase();
    if (status === "RESOLVED" || status === "CANCELLED") return results.push({ type: "QUEUE", id: id, row: row, action: "ALREADY_RESET", blocking: false });
    var fingerprint = stockProductionTestingResetQueueFingerprint(row);
    if (!expected["QUEUE:" + id] || expected["QUEUE:" + id] !== fingerprint) {
      return results.push({ type: "QUEUE", id: id, row: row, action: "SKIPPED_TARGET_CHANGED", blocking: true, fingerprint: fingerprint });
    }
    if (status === "PENDING") return results.push({ type: "QUEUE", id: id, row: row, action: "RESET_PENDING", blocking: false, fingerprint: fingerprint });
    if (status === "IN_PROGRESS") return results.push({ type: "QUEUE", id: id, row: row, action: "RESET_IN_PROGRESS", blocking: false, fingerprint: fingerprint });
    results.push({ type: "QUEUE", id: id, row: row, action: "SKIPPED_TERMINAL", blocking: true, fingerprint: fingerprint });
  }

  function addAlert(id) {
    var row = alertById[id];
    if (!row) return results.push({ type: "ALERT", id: id, action: "TARGET_NOT_FOUND", blocking: true });
    var status = stockProductionText(row.Status).toUpperCase();
    if (status === "RESOLVED") return results.push({ type: "ALERT", id: id, row: row, action: "ALREADY_RESET", blocking: false });
    var fingerprint = stockProductionTestingResetAlertFingerprint(row);
    if (!expected["ALERT:" + id] || expected["ALERT:" + id] !== fingerprint) {
      return results.push({ type: "ALERT", id: id, row: row, action: "SKIPPED_TARGET_CHANGED", blocking: true, fingerprint: fingerprint });
    }
    if (stockProductionIsActiveAlertStatus(status)) return results.push({ type: "ALERT", id: id, row: row, action: "RESET_ALERT", blocking: false, fingerprint: fingerprint });
    results.push({ type: "ALERT", id: id, row: row, action: "SKIPPED_TERMINAL", blocking: true, fingerprint: fingerprint });
  }

  (queueIds || []).forEach(addQueue);
  (alertIds || []).forEach(addAlert);
  return { results: results, blocking: results.filter(function(result) { return result.blocking; }) };
}

function stockProductionTestingResetSheetFingerprint(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return "";
  var values = sheet.getDataRange().getValues().map(function(row) {
    return row.map(function(value) {
      return Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value) ? value.toISOString() : stockProductionText(value);
    });
  });
  return stockProductionTestingResetFingerprint([JSON.stringify(values)]);
}

function handlePreviewProductionTestingReset(data) {
  requireStockProductionPermission(data, "manage_stock_alert_settings");
  var queueSource = stockProductionTestingResetReadExistingSheet(PRODUCTION_QUEUE_SHEET, ["QueueID", "SKU", "Status"]);
  var alertSource = stockProductionTestingResetReadExistingSheet(STOCK_ALERTS_SHEET, ["AlertID", "SKU", "Status"]);
  if (!queueSource.ok || !alertSource.ok) {
    return { status: "error", message: !queueSource.ok ? queueSource.error : alertSource.error, missingHeaders: !queueSource.ok ? queueSource.missingHeaders || [] : alertSource.missingHeaders || [] };
  }
  return {
    status: "success", confirmation: STOCK_PRODUCTION_TESTING_RESET_CONFIRMATION,
    queueCandidates: queueSource.rows.filter(function(row) {
      var status = stockProductionText(row.Status).toUpperCase();
      return status === "PENDING" || status === "IN_PROGRESS";
    }).map(stockProductionTestingResetQueueCandidate),
    alertCandidates: alertSource.rows.filter(function(row) {
      return stockProductionIsActiveAlertStatus(stockProductionText(row.Status).toUpperCase());
    }).map(stockProductionTestingResetAlertCandidate)
  };
}

function handleResetProductionTestingState(data) {
  var user = requireStockProductionPermission(data, "manage_stock_alert_settings");
  if (stockProductionText((data || {}).confirmation) !== STOCK_PRODUCTION_TESTING_RESET_CONFIRMATION) {
    return { status: "error", message: "Konfirmasi reset testing tidak valid." };
  }
  var queueIdsResult = stockProductionTestingResetIdList((data || {}).queueIds || [], "QueueID");
  var alertIdsResult = stockProductionTestingResetIdList((data || {}).alertIds || [], "AlertID");
  if (!queueIdsResult.ok || !alertIdsResult.ok) return { status: "error", message: !queueIdsResult.ok ? queueIdsResult.error : alertIdsResult.error };
  if (!queueIdsResult.ids.length && !alertIdsResult.ids.length) return { status: "error", message: "Pilih minimal satu Queue atau Alert untuk reset." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: "error", message: "Reset testing sedang diproses. Coba lagi." };
  try {
    var queueSource = stockProductionTestingResetReadExistingSheet(PRODUCTION_QUEUE_SHEET, ["QueueID", "SKU", "Status", "ActiveRequirementKey", "UpdatedAt", "Note"]);
    var alertSource = stockProductionTestingResetReadExistingSheet(STOCK_ALERTS_SHEET, ["AlertID", "SKU", "Status", "ResolvedAt", "LastEvaluatedAt", "ToDo", "ProductionQty"]);
    var historySource = stockProductionTestingResetReadExistingSheet(PRODUCTION_HISTORY_SHEET, PRODUCTION_HISTORY_HEADERS);
    if (!queueSource.ok || !alertSource.ok || !historySource.ok) {
      return { status: "error", message: !queueSource.ok ? queueSource.error : (!alertSource.ok ? alertSource.error : historySource.error) };
    }
    var plan = stockProductionTestingResetBuildPlan(queueSource.rows, alertSource.rows, queueIdsResult.ids, alertIdsResult.ids, (data || {}).fingerprints || {});
    if (plan.blocking.length) {
      return {
        status: "aborted", message: "Preflight reset gagal; tidak ada data yang diubah.",
        results: plan.results.map(function(result) { return { type: result.type, id: result.id, action: result.action }; })
      };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterBefore = stockProductionTestingResetSheetFingerprint(ss.getSheetByName(MASTER_SHEET_NAME || "MasterBarang"));
    var configurationBefore = stockProductionTestingResetSheetFingerprint(ss.getSheetByName(PRODUCTION_CONFIGURATION_SHEET));
    var now = new Date();
    var changed = [];
    plan.results.forEach(function(result) {
      if (result.action === "ALREADY_RESET") return;
      var before = result.row;
      var changes;
      if (result.action === "RESET_PENDING" || result.action === "RESET_IN_PROGRESS") {
        changes = {
          Status: result.action === "RESET_PENDING" ? "RESOLVED" : "CANCELLED",
          ActiveRequirementKey: "", UpdatedAt: now,
          Note: stockProductionText(before.Note) ? stockProductionText(before.Note) + "\nTESTING_RESET" : "TESTING_RESET"
        };
        stockProductionUpdateObjectRow(queueSource.sheet, before._row, changes);
        stockProductionWriteHistory(historySource.sheet, user, "RESET_TESTING_STATE", before.SKU, before.QueueID, before, changes, "TESTING_RESET Queue " + stockProductionText(before.Status).toUpperCase() + " -> " + changes.Status);
      } else if (result.action === "RESET_ALERT") {
        changes = { Status: "RESOLVED", ResolvedAt: now, LastEvaluatedAt: now, ToDo: "", ProductionQty: 0 };
        stockProductionUpdateObjectRow(alertSource.sheet, before._row, changes);
        stockProductionWriteHistory(historySource.sheet, user, "RESET_TESTING_STATE", before.SKU, "", before, changes, "TESTING_RESET Alert " + stockProductionText(before.Status).toUpperCase() + " -> RESOLVED");
      }
      changed.push({ type: result.type, id: result.id, action: result.action, before: before, changes: changes });
    });
    if (changed.length) {
      stockProductionWriteHistory(historySource.sheet, user, "RESET_TESTING_STATE", "", "", {}, {
        queueCount: changed.filter(function(row) { return row.type === "QUEUE"; }).length,
        alertCount: changed.filter(function(row) { return row.type === "ALERT"; }).length
      }, "TESTING_RESET summary; QueueIDs=" + queueIdsResult.ids.join(",") + "; AlertIDs=" + alertIdsResult.ids.join(","));
    }

    var queueAfter = stockProductionTestingResetReadExistingSheet(PRODUCTION_QUEUE_SHEET, ["QueueID", "Status"]);
    var alertAfter = stockProductionTestingResetReadExistingSheet(STOCK_ALERTS_SHEET, ["AlertID", "Status"]);
    var queueStatusById = {};
    var alertStatusById = {};
    (queueAfter.rows || []).forEach(function(row) { queueStatusById[stockProductionText(row.QueueID)] = stockProductionText(row.Status).toUpperCase(); });
    (alertAfter.rows || []).forEach(function(row) { alertStatusById[stockProductionText(row.AlertID)] = stockProductionText(row.Status).toUpperCase(); });
    var verificationFailures = changed.filter(function(result) {
      var expectedStatus = result.action === "RESET_PENDING" ? "RESOLVED" : (result.action === "RESET_IN_PROGRESS" ? "CANCELLED" : "RESOLVED");
      return result.type === "QUEUE" ? queueStatusById[result.id] !== expectedStatus : alertStatusById[result.id] !== expectedStatus;
    }).map(function(result) { return { type: result.type, id: result.id, action: result.action }; });
    var masterUnchanged = masterBefore === stockProductionTestingResetSheetFingerprint(ss.getSheetByName(MASTER_SHEET_NAME || "MasterBarang"));
    var configurationUnchanged = configurationBefore === stockProductionTestingResetSheetFingerprint(ss.getSheetByName(PRODUCTION_CONFIGURATION_SHEET));
    if (!masterUnchanged || !configurationUnchanged) verificationFailures.push({ type: "SAFETY", id: "", action: "UNEXPECTED_NON_LIFECYCLE_CHANGE" });
    var summary = {
      pendingResolved: changed.filter(function(row) { return row.action === "RESET_PENDING"; }).length,
      inProgressCancelled: changed.filter(function(row) { return row.action === "RESET_IN_PROGRESS"; }).length,
      alertsResolved: changed.filter(function(row) { return row.action === "RESET_ALERT"; }).length,
      alreadyReset: plan.results.filter(function(row) { return row.action === "ALREADY_RESET"; }).length
    };
    return {
      status: verificationFailures.length ? "RESET_COMPLETED_WITH_VERIFICATION_FAILURE" : "success",
      summary: summary, results: plan.results.map(function(result) { return { type: result.type, id: result.id, action: result.action }; }),
      verificationFailures: verificationFailures, masterBarangUnchanged: masterUnchanged, productionConfigurationUnchanged: configurationUnchanged,
      telegramSent: false, evaluatorExecuted: false, schedulerExecuted: false
    };
  } finally {
    lock.releaseLock();
  }
}

function handleCreateProductionQueue(data) {
  var user = requireStockProductionPermission(data, "manage_production_queue");
  var inventory = readStockProductionInventory();
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!inventory.ok || !configuration.ok) return { status: "configuration_required", message: !inventory.ok ? inventory.error : configuration.error };
  var runtimeItems = stockProductionAttachRuntimeData(inventory.items, configuration);
  var item = runtimeItems.filter(function(row) { return row.sku === stockProductionText(data.sku); })[0];
  if (!item) return { status: "error", message: "SKU tidak ditemukan." };
  var c = classifyStockProductionItem(item, "");
  if (!c.valid || !c.productionRequired) return { status: "error", message: "SKU belum memenuhi aturan Production Required." };
  var sheets = ensureStockProductionDatabase();
  var queueRows = stockProductionReadSheetObjects(sheets.queue);
  var completedQueue = stockProductionCompletedQueueMap(queueRows)[item.sku];
  var transactionRows = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi"));
  if (stockProductionIsCompletedQueueWaitingStockIn(completedQueue, item, c, transactionRows)) {
    return { status: "error", message: "Produksi SKU ini sudah selesai dan sedang menunggu Barang Masuk." };
  }
  var result = stockProductionCreateQueueRecord(sheets, item, c, user, stockProductionText(data.note));
  return { status: "success", created: result.created, queue: result.row };
}

// The only queue status writer used by both Web Admin and Telegram recipient
// controls. The optional authorizer is evaluated after the queue is re-read
// inside the ScriptLock, so callback data can never authorize a stale row.
function stockProductionTransitionQueueStatus(data, user, options) {
  options = options || {};
  var queueId = stockProductionText((data || {}).queueId);
  var nextStatus = stockProductionText((data || {}).nextStatus).toUpperCase();
  if (!queueId || !nextStatus) return { status: "error", message: "Queue dan status tujuan wajib tersedia." };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: "error", message: "Perubahan status sedang diproses. Coba lagi." };
  try {
    var sheets = ensureStockProductionDatabase();
    var target = stockProductionReadSheetObjects(sheets.queue).filter(function(row) { return stockProductionText(row.QueueID) === queueId; })[0];
    if (!target) return { status: "error", code: "queue_not_found", message: "Production Queue tidak ditemukan." };
    var authorizedUser = user;
    if (typeof options.authorizeQueue === "function") {
      var authorization = options.authorizeQueue(target);
      if (!authorization || authorization.status !== "success") {
        return {
          status: "error",
          code: authorization && authorization.code || "queue_access_denied",
          message: authorization && authorization.message || "Anda tidak memiliki akses ke pekerjaan produksi ini.",
          queueId: queueId,
          currentStatus: stockProductionText(target.Status).toUpperCase()
        };
      }
      authorizedUser = authorization.user || authorizedUser;
    }
    if (!authorizedUser || !stockProductionText(authorizedUser.email)) return { status: "error", code: "actor_required", message: "Identitas pelaksana tidak valid." };
    var currentStatus = stockProductionText(target.Status).toUpperCase();
    if (!stockProductionCanTransition(currentStatus, nextStatus)) {
      return {
        status: "error", code: "invalid_transition", queueId: queueId, currentStatus: currentStatus, requestedStatus: nextStatus,
        message: "Transisi status tidak valid: " + currentStatus + " ke " + nextStatus
      };
    }
    var transitionData = data || {};
    var hasPlannedQty = Object.prototype.hasOwnProperty.call(transitionData, "plannedQty");
    var plannedQty = hasPlannedQty ? stockProductionNumber(transitionData.plannedQty) : null;
    if (nextStatus === "IN_PROGRESS" && hasPlannedQty && (plannedQty === null || plannedQty <= 0 || Math.floor(plannedQty) !== plannedQty)) {
      return { status: "error", code: "invalid_planned_qty", message: "Jumlah produksi wajib berupa bilangan bulat lebih dari 0.", queueId: queueId, currentStatus: currentStatus };
    }
    var completedQty = stockProductionNumber(transitionData.completedQty);
    if (nextStatus === "COMPLETED" && completedQty === null && typeof options.defaultCompletedQty === "function") {
      completedQty = stockProductionNumber(options.defaultCompletedQty(target));
    }
    if (nextStatus === "COMPLETED" && (completedQty === null || completedQty < 0)) {
      return { status: "error", code: "invalid_completed_qty", message: "Completed Qty wajib berupa angka non-negatif.", queueId: queueId, currentStatus: currentStatus };
    }
    var now = new Date();
    var changes = { Status: nextStatus, UpdatedAt: now, Note: stockProductionText((data || {}).note) || target.Note || "" };
    if (nextStatus === "IN_PROGRESS") {
      changes.StartedAt = now;
      changes.StartedBy = authorizedUser.email;
      if (hasPlannedQty) changes.PlannedQty = plannedQty;
    }
    if (nextStatus === "COMPLETED") { changes.CompletedAt = now; changes.CompletedBy = authorizedUser.email; changes.CompletedQty = completedQty; changes.ActiveRequirementKey = ""; }
    if (nextStatus === "CANCELLED") { changes.CancelledAt = now; changes.CancelledBy = authorizedUser.email; changes.ActiveRequirementKey = ""; }
    stockProductionUpdateObjectRow(sheets.queue, target._row, changes);
    stockProductionWriteHistory(sheets.history, authorizedUser, "QUEUE_" + nextStatus, target.SKU, queueId, target, changes, changes.Note);
    var updated = {};
    Object.keys(target).forEach(function(key) { updated[key] = target[key]; });
    Object.keys(changes).forEach(function(key) { updated[key] = changes[key]; });
    return {
      status: "success", queueId: queueId, previousStatus: currentStatus, currentStatus: nextStatus,
      stockAdjusted: false, queue: updated
    };
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateProductionQueueStatus(data) {
  var user = requireStockProductionPermission(data, "update_production_status");
  return stockProductionTransitionQueueStatus(data, user);
}

function stockProductionTelegramQueueView(queue, currentStock) {
  var completedQty = stockProductionNumber(queue && queue.CompletedQty);
  var recommendedQty = stockProductionNumber(queue && (queue.RecommendedQty !== undefined ? queue.RecommendedQty : queue.PlannedQty));
  var plannedQty = stockProductionNumber(queue && queue.PlannedQty);
  return {
    queueId: stockProductionText(queue && queue.QueueID), sku: stockProductionText(queue && queue.SKU),
    product: stockProductionText(queue && queue.Product), color: stockProductionText(queue && queue.Color), size: stockProductionText(queue && queue.Size),
    recommendedQty: recommendedQty === null ? 0 : recommendedQty,
    productionQty: plannedQty === null ? (recommendedQty === null ? 0 : recommendedQty) : plannedQty,
    completedQty: completedQty === null ? null : completedQty,
    currentStock: currentStock === undefined ? null : stockProductionNumber(currentStock),
    minimumStock: stockProductionNumber(queue && queue.MinimumStock),
    targetStock: stockProductionNumber(queue && (queue.ProductionTarget !== undefined ? queue.ProductionTarget : queue.IdealStock)),
    movingStat: stockProductionNormalizeMoving(queue && queue.MovingStat), status: stockProductionText(queue && queue.Status).toUpperCase(),
    startedAt: queue && queue.StartedAt || "", completedAt: queue && queue.CompletedAt || ""
  };
}

function stockProductionGetTelegramRecipientQueues(data) {
  var source = readProductionRecipients();
  var resolution = stockProductionResolveRecipientByTelegramChatId((data || {}).chatId, source);
  if (resolution.status !== "resolved") return { status: "error", code: resolution.status, message: "Akses menu Konveksi tidak tersedia untuk akun Telegram ini." };
  var requestedStatus = stockProductionText((data || {}).status).toUpperCase();
  var allowed = ["PENDING", "IN_PROGRESS", "COMPLETED"];
  if (requestedStatus && allowed.indexOf(requestedStatus) < 0) return { status: "error", code: "invalid_status", message: "Status produksi tidak valid." };
  var stockBySku = {};
  try {
    var inventory = readStockProductionInventory();
    if (inventory && inventory.ok) (inventory.items || []).forEach(function(item) { stockBySku[item.sku] = item.stock; });
  } catch (ignoreInventoryError) {}
  var queues = stockProductionReadSheetObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_QUEUE_SHEET))
    .filter(function(queue) {
      return stockProductionQueueBelongsToRecipient(queue, resolution.recipient, source) && (!requestedStatus || stockProductionText(queue.Status).toUpperCase() === requestedStatus);
    })
    .map(function(queue) { return stockProductionTelegramQueueView(queue, stockBySku[stockProductionText(queue.SKU)]); });
  if (requestedStatus === "COMPLETED") {
    queues.sort(function(left, right) {
      var leftDate = left.completedAt;
      var rightDate = right.completedAt;
      return new Date(rightDate || 0).getTime() - new Date(leftDate || 0).getTime();
    });
  }
  return { status: "success", recipient: resolution.recipient, queues: queues };
}

function stockProductionGetTelegramRecipientHistory(data) {
  var source = readProductionRecipients();
  var resolution = stockProductionResolveRecipientByTelegramChatId((data || {}).chatId, source);
  if (resolution.status !== "resolved") return { status: "error", code: resolution.status, message: "Akses menu Konveksi tidak tersedia untuk akun Telegram ini." };
  var requestedPage = Number((data || {}).page) || 1;
  var page = Math.max(1, Math.floor(requestedPage));
  var pageSize = 6;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queues = stockProductionReadSheetObjects(ss.getSheetByName(PRODUCTION_QUEUE_SHEET));
  var queueById = {};
  queues.forEach(function(queue) { queueById[stockProductionText(queue.QueueID)] = queue; });
  var rows = stockProductionReadSheetObjects(ss.getSheetByName(PRODUCTION_HISTORY_SHEET)).filter(function(entry) {
    var queue = queueById[stockProductionText(entry.QueueID)];
    return stockProductionText(entry.Action).toUpperCase() === "QUEUE_COMPLETED" && stockProductionQueueBelongsToRecipient(queue, resolution.recipient, source);
  }).sort(function(left, right) {
    return new Date(right.Timestamp || 0).getTime() - new Date(left.Timestamp || 0).getTime();
  });
  var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, totalPages);
  var items = rows.slice((page - 1) * pageSize, page * pageSize).map(function(entry) {
    var queue = queueById[stockProductionText(entry.QueueID)];
    return { queue: stockProductionTelegramQueueView(queue), timestamp: entry.Timestamp || "" };
  });
  return { status: "success", recipient: resolution.recipient, items: items, page: page, totalPages: totalPages, total: rows.length };
}

function stockProductionGetTelegramRecipientStock(data) {
  var source = readProductionRecipients();
  var resolution = stockProductionResolveRecipientByTelegramChatId((data || {}).chatId, source);
  if (resolution.status !== "resolved") return { status: "error", code: resolution.status, message: "Akses menu Konveksi tidak tersedia untuk akun Telegram ini." };
  var inventory = readStockProductionInventory();
  if (!inventory.ok) return { status: "error", code: "inventory_unavailable", message: inventory.error || "Data stok tidak tersedia." };
  var configuration = readStockProductionConfiguration(inventory.items);
  if (!configuration.ok) return { status: "error", code: "configuration_unavailable", message: configuration.error || "Konfigurasi produksi tidak tersedia." };
  var items = stockProductionAttachRuntimeData(inventory.items, configuration).filter(function(item) {
    var assignment = stockProductionResolveRecipient(item.productionRecipient, source);
    return assignment.status === "resolved" && assignment.recipient.id === resolution.recipient.id;
  }).map(function(item) {
    var classification = classifyStockProductionItem(item, "");
    return {
      sku: item.sku, product: item.product, color: item.color, size: item.size, stock: item.stock,
      minimumStock: classification.minimumStock, targetStock: classification.productionTarget,
      status: classification.status, movingStat: classification.movingStat
    };
  });
  return { status: "success", recipient: resolution.recipient, items: items };
}

function stockProductionGetTelegramRecipientProfile(data) {
  var list = stockProductionGetTelegramRecipientQueues({ chatId: (data || {}).chatId });
  if (list.status !== "success") return list;
  var counts = { pending: 0, inProgress: 0, completed: 0 };
  (list.queues || []).forEach(function(queue) {
    if (queue.status === "PENDING") counts.pending += 1;
    if (queue.status === "IN_PROGRESS") counts.inProgress += 1;
    if (queue.status === "COMPLETED") counts.completed += 1;
  });
  return { status: "success", recipient: list.recipient, counts: counts };
}

// Telegram actions use queue IDs only as untrusted pointers. The queue,
// recipient assignment, current state, completion quantity and audit actor are
// re-read under the same lock as Web Admin's status transition.
function handleTelegramProductionRecipientAction(data) {
  var action = stockProductionText((data || {}).action).toUpperCase();
  var nextStatus = action === "START" ? "IN_PROGRESS" : (action === "COMPLETE" ? "COMPLETED" : "");
  if (!nextStatus) return { status: "error", code: "invalid_action", message: "Aksi produksi tidak dikenali." };
  var chatId = stockProductionText((data || {}).chatId);
  var quantity;
  try {
    quantity = stockProductionNormalizePositiveInteger(action === "START" ? (data || {}).productionQty : (data || {}).completedQty, action === "START" ? "Jumlah produksi" : "Jumlah selesai produksi");
  } catch (quantityError) {
    return { status: "error", code: action === "START" ? "invalid_production_qty" : "invalid_completed_qty", message: quantityError.message || String(quantityError) };
  }
  var transitionData = { queueId: stockProductionText((data || {}).queueId), nextStatus: nextStatus };
  if (action === "START") transitionData.plannedQty = quantity;
  else transitionData.completedQty = quantity;
  var result = stockProductionTransitionQueueStatus(transitionData, null, {
    authorizeQueue: function(target) {
      var source = readProductionRecipients();
      var resolution = stockProductionResolveRecipientByTelegramChatId(chatId, source);
      if (resolution.status !== "resolved") return { status: "error", code: resolution.status, message: "Akses Konveksi tidak valid atau sudah tidak aktif." };
      if (!stockProductionQueueBelongsToRecipient(target, resolution.recipient, source)) {
        return { status: "error", code: "queue_access_denied", message: "Anda tidak memiliki akses ke pekerjaan produksi ini." };
      }
      return { status: "success", user: stockProductionTelegramRecipientActor(resolution.recipient) };
    }
  });
  if (result.status !== "error" || result.code !== "invalid_transition") return result;
  if (action === "START" && result.currentStatus === "IN_PROGRESS") {
    result.status = "info";
    result.message = "Produksi ini sudah dimulai sebelumnya.";
  } else if (result.currentStatus === "COMPLETED") {
    result.status = "info";
    result.message = "Pekerjaan ini sudah selesai dan menunggu barang masuk.";
  }
  return result;
}

function handleIgnoreStockAlert(data) {
  var user = requireStockProductionPermission(data, "manage_production_queue");
  var sku = stockProductionText(data.sku);
  var reason = stockProductionText(data.reason);
  if (!reason) return { status: "error", message: "Alasan ignore wajib diisi." };
  var sheets = ensureStockProductionDatabase();
  var alert = stockProductionAlertMap(stockProductionReadSheetObjects(sheets.alerts))[sku];
  if (!alert) return { status: "error", message: "Alert tidak ditemukan." };
  var changes = { Status: "IGNORED", IgnoredAt: new Date(), IgnoredBy: user.email, IgnoreReason: reason, LastEvaluatedAt: new Date() };
  stockProductionUpdateObjectRow(sheets.alerts, alert._row, changes);
  stockProductionWriteHistory(sheets.history, user, "ALERT_IGNORED", sku, "", alert, changes, reason);
  return { status: "success", sku: sku };
}
