// ============================================================
// health.gs — Recovery Center: System Health panel
// Menggabungkan status dari berbagai service (reuse diagnostic/check).
// ============================================================

/**
 * Ambil ringkasan kesehatan sistem untuk panel System Health.
 * @returns {{ status, health }}
 */
function getSystemHealth() {
  try {
    ensureDatabase();
    var props = PropertiesService.getScriptProperties();
    var health = {
      webhook: '-', api: '-',
      lastSync: props.getProperty('LAST_SYNC') || _lastFromLog('SYNC') || '-',
      lastHistoricalSync: props.getProperty('LAST_HISTORICAL_SYNC') || '-',
      lastRepair: props.getProperty('LAST_REPAIR') || '-',
      pendingOrders: '-', duplicateOrders: '-', missingSettlement: '-',
      ledgerStatus: '-', mappingStatus: '-', kpiStatus: '-'
    };

    // Webhook
    try {
      var wh = handleGetWebhookDashboard();
      health.webhook = wh.endpointOnline ? 'Active' : 'Offline';
    } catch (e) { health.webhook = 'Error'; }

    // API
    try {
      var api = apiHealthCheck();
      health.api = api.online ? 'Online' : 'Offline';
    } catch (e) { health.api = 'Error'; }

    // Pending orders
    try {
      var so = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHOPEE_ORDERS_SHEET);
      if (so && so.getLastRow() > 1) {
        var rows = so.getDataRange().getValues(); var hdr = rows[0]; var ci = {};
        hdr.forEach(function(h,i){ ci[h]=i; });
        var pend = 0;
        for (var i=1;i<rows.length;i++) {
          if (String(rows[i][ci['deduction_status']]||'PENDING').toUpperCase() === 'PENDING' &&
              APPROVAL_TRIGGER_STATUSES.indexOf(String(rows[i][ci['order_status']]||'').toUpperCase()) >= 0) pend++;
        }
        health.pendingOrders = pend;
      }
    } catch (e) { health.pendingOrders = 'Error'; }

    // Duplicate (order)
    try {
      var dup = checkDuplicateOrders();
      health.duplicateOrders = (dup.duplicateOrders||0) + (dup.duplicateLedger||0);
    } catch (e) { health.duplicateOrders = 'Error'; }

    // Missing settlement
    try {
      var ms = checkSettlement();
      health.missingSettlement = ms.missingSettlement||0;
    } catch (e) { health.missingSettlement = 'Error'; }

    // Ledger status
    try {
      var led = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SALES_LEDGER_SHEET);
      health.ledgerStatus = led && led.getLastRow() > 1 ? (led.getLastRow()-1) + ' baris' : 'Kosong';
    } catch (e) { health.ledgerStatus = 'Error'; }

    // Mapping
    try {
      var mp = checkMapping();
      health.mappingStatus = mp.percent + '%';
    } catch (e) { health.mappingStatus = 'Error'; }

    // KPI status
    try {
      var kpiSnap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('KPISnapshot');
      health.kpiStatus = kpiSnap && kpiSnap.getLastRow() > 1 ? 'Tersedia' : 'Belum dihitung';
    } catch (e) { health.kpiStatus = 'Error'; }

    return { status:'success', health: health };
  } catch (err) {
    return { status:'error', message: err.toString(), health: {} };
  }
}

function _lastFromLog(kind) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName(SHOPEE_ORDERS_LOG_SHEET);
    if (!log || log.getLastRow() < 2) return '-';
    return '-';
  } catch (e) { return '-'; }
}
