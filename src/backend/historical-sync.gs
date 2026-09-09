// ============================================================
// historical-sync.gs - Recovery Center: Historical Sync
// Orchestration layer. TIDAK membuat business logic baru,
// hanya memanggil handler/service yang sudah ada di code.gs.
// ============================================================

/**
 * Preview Historical Sync.
 * Menghitung estimasi jumlah data yang akan diproses pada periode terpilih
 * tanpa mengubah apa pun.
 *
 * @param {Object} data - { dateFrom, dateTo, orders, ledger, settlement, kpi }
 * @returns {{ status, message, orders, ledger, settlement, estimatedTime, period }}
 */
function getHistoricalPreview(data) {
  try {
    var from = String(data.dateFrom || '');
    var to   = String(data.dateTo   || '');
    if (!from || !to) return { status: 'error', message: 'Tanggal Awal & Tanggal Akhir wajib diisi.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var soSheet = ss.getSheetByName(SHOPEE_ORDERS_SHEET);

    // Hitung order dalam periode (berdasarkan create_time)
    var orderCount = 0;
    if (soSheet && soSheet.getLastRow() > 1) {
      var rows = soSheet.getDataRange().getValues();
      var hdr  = rows[0];
      var ci   = {}; hdr.forEach(function(h, i) { ci[h] = i; });
      var fromMs = new Date(from + 'T00:00:00').getTime();
      var toMs   = new Date(to   + 'T23:59:59').getTime();
      var sourceOrders = {};
      for (var i = 1; i < rows.length; i++) {
        var ct = rows[i][ci['create_time']];
        var d  = (ct instanceof Date) ? ct.getTime() : (Number(ct) > 1000000000 ? Number(ct) * 1000 : 0);
        if (d >= fromMs && d <= toMs) sourceOrders[String(rows[i][ci['order_sn']] || '').trim()] = true;
      }
      orderCount = Object.keys(sourceOrders).filter(function(orderSn) { return orderSn; }).length;
    }

    // Ledger & settlement dalam periode (berdasarkan Tanggal Order)
    var ledgerCount = 0, settlementCount = 0;
    var slSheet = ss.getSheetByName(SALES_LEDGER_SHEET);
    if (slSheet && slSheet.getLastRow() > 1) {
      var lr = slSheet.getDataRange().getValues();
      var lh = lr[0]; var lc = {}; lh.forEach(function(h, i) { lc[h] = i; });
      var ledgerObjects = [];
      for (var j = 1; j < lr.length; j++) {
        var object = {};
        Object.keys(lc).forEach(function(header) { object[header] = lr[j][lc[header]]; });
        var to2 = object['Tanggal Order'];
        var dj  = (to2 instanceof Date) ? to2.getTime() : 0;
        if (dj >= fromMs && dj <= toMs) ledgerObjects.push(object);
      }
      var ledgerOrders = getSalesLedgerOrders({ rows: ledgerObjects, strict: false });
      var settlements = getSalesLedgerSettlements({ rows: ledgerObjects, strict: false });
      ledgerCount = ledgerOrders.length;
      settlementCount = settlements.filter(function(row) {
        var st = String(row['Settlement Status'] || '').toUpperCase();
        return st && st !== 'NONE';
      }).length;
    }

    var est = (orderCount + ledgerCount) * 0.4; // estimasi kasar 0.4 detik/row
    return {
      status: 'success',
      message: 'Preview siap. Periode ' + from + ' s.d ' + to + '.',
      orders:     data.orders     ? orderCount     : 0,
      ledger:     data.ledger     ? ledgerCount    : 0,
      settlement: data.settlement ? settlementCount : 0,
      kpi:        data.kpi        ? 1 : 0,
      estimatedTime: est > 60 ? Math.ceil(est / 60) + ' menit' : Math.ceil(est) + ' detik',
      period: from + ' -> ' + to
    };
  } catch (err) {
    return { status: 'error', message: err.toString() };
  }
}

/**
 * Jalankan Historical Sync untuk periode terpilih.
 * Idempoten: memanggil fetchAndUpsertShopeeOrders (INSERT/UPDATE by Order SN)
 * lalu updateSalesLedger, resyncFinance, recalc KPI, refresh dashboard.
 *
 * @param {Object} data - { dateFrom, dateTo, orders, ledger, settlement, kpi }
 * @returns {summary JSON}
 */
function runHistoricalSync(data) {
  var start = new Date();
  var t0 = start.getTime();
  var summary = {
    status: 'success',
    message: '',
    processed: 0, updated: 0, inserted: 0,
    ledgerUpdated: 0, settlementUpdated: 0,
    duplicateFixed: 0, duration: '', errors: [], warnings: []
  };

  try {
    var readiness = getSalesLedgerLineOperationalReadiness();
    if (!readiness.ready) {
      summary.status = 'error';
      summary.message = 'Historical Sync memerlukan schema dan migrasi SalesLedger line-level yang lengkap.';
      summary.errors.push(readiness.reason || 'MIGRATION_REQUIRED');
      return summary;
    }
    ensureDatabase();
    
    // Set notification context to HISTORICAL_SYNC
    setNotificationContext(NotificationContext.HISTORICAL_SYNC);
    console.log("[HISTORICAL_SYNC] Notification context set to HISTORICAL_SYNC - Telegram notifications DISABLED");
    
    var from = String(data.dateFrom || '');
    var to   = String(data.dateTo   || '');
    if (!from || !to) { summary.status = 'error'; summary.message = 'Tanggal wajib diisi.'; return summary; }

    // 1. Ambil data Shopee sesuai rentang tanggal user
    // SHOPEE API LIMIT: maksimal 15 hari per request (time_to - time_from)
    // Dengan margin ±1 hari, max rentang core = 13 hari agar total <= 15 hari
    var syncRes = null;
    if (data.orders) {
      var fromDt = new Date(from + 'T00:00:00');
      var toDt   = new Date(to   + 'T23:59:59');
      var timeFrom = Math.floor(fromDt.getTime() / 1000);
      var timeTo   = Math.floor(toDt.getTime()   / 1000);
      
      var totalDays = Math.ceil((timeTo - timeFrom) / 86400);
      var maxDaysPerBatch = 13;
      var batches = [];
      
      console.log("=".repeat(60));
      console.log("[HISTORICAL_SYNC] PARAMETER USER:");
      console.log("=".repeat(60));
      console.log("  dateFrom (UI): " + from);
      console.log("  dateTo (UI): " + to);
      console.log("  Total hari: " + totalDays);
      console.log("");
      
      if (totalDays <= maxDaysPerBatch) {
        batches.push({ 
          from: timeFrom - (24 * 3600), 
          to: timeTo + (24 * 3600),
          label: "1/1"
        });
        console.log("  Rentang <= 13 hari. Single batch dengan margin ±1 hari.");
      } else {
        var currentFrom = timeFrom;
        var batchNum = 0;
        var totalBatches = Math.ceil(totalDays / maxDaysPerBatch);
        while (currentFrom < timeTo) {
          batchNum++;
          var currentTo = Math.min(currentFrom + (maxDaysPerBatch * 86400) - 1, timeTo);
          batches.push({
            from: currentFrom - (24 * 3600),
            to: currentTo + (24 * 3600),
            label: batchNum + "/" + totalBatches
          });
          currentFrom = currentTo + 1;
        }
        console.log("  Rentang > 13 hari. Dibagi menjadi " + batches.length + " batch (max 13 hari/batch + margin).");
      }
      console.log("=".repeat(60));
      console.log("");
      
      var totalInserted = 0, totalUpdated = 0, totalApiOrders = 0, totalPages = 0;
      var globalOldest = null, globalNewest = null;
      
      for (var b = 0; b < batches.length; b++) {
        var batch = batches[b];
        console.log("=".repeat(60));
        console.log("[HISTORICAL_SYNC] BATCH " + batch.label);
        console.log("=".repeat(60));
        console.log("  time_from: " + batch.from + " (" + new Date(batch.from*1000).toISOString() + ")");
        console.log("  time_to: " + batch.to + " (" + new Date(batch.to*1000).toISOString() + ")");
        console.log("");
        
        var batchRes = fetchAndUpsertShopeeOrders(batch.from, batch.to, { 
          verbose: true, 
          label: "BATCH_" + batch.label 
        });
        
        if (batchRes) {
          totalInserted += (batchRes.newCount || 0);
          totalUpdated += (batchRes.updateCount || 0);
          totalApiOrders += (batchRes.apiOrderCount || 0);
          totalPages += (batchRes.pages || 0);
          
          if (batchRes.oldest && (!globalOldest || batchRes.oldest < globalOldest)) {
            globalOldest = batchRes.oldest;
          }
          if (batchRes.newest && (!globalNewest || batchRes.newest > globalNewest)) {
            globalNewest = batchRes.newest;
          }
          
          console.log("[HISTORICAL_SYNC] Batch " + batch.label + " selesai:");
          console.log("  API Orders: " + batchRes.apiOrderCount);
          console.log("  Inserted: " + batchRes.newCount);
          console.log("  Updated: " + batchRes.updateCount);
          console.log("");
        }
      }
      
      syncRes = {
        newCount: totalInserted,
        updateCount: totalUpdated,
        apiOrderCount: totalApiOrders,
        pages: totalPages,
        oldest: globalOldest,
        newest: globalNewest,
        batches: batches.length
      };
      
      summary.processed += totalInserted + totalUpdated;
      summary.inserted  += totalInserted;
      summary.updated   += totalUpdated;
    }

    // 2. Update Sales Ledger (idempoten by Order SN)
    if (data.ledger) {
      try {
        var led = updateSalesLedger();
        summary.ledgerUpdated = (led.newCount || 0) + (led.updatedCount || 0);
      } catch (e) { summary.errors.push('Sales Ledger: ' + e.toString()); }
    }

    // 3. Update Settlement (Payment API) untuk COMPLETED tanpa escrow
    if (data.settlement) {
      try {
        var rf = handleResyncFinance({});
        summary.settlementUpdated = (rf.success || 0);
        if (rf.failed > 0) summary.warnings.push('Settlement gagal: ' + rf.failed);
      } catch (e) { summary.errors.push('Settlement: ' + e.toString()); }
    }

    // 4. Hitung ulang KPI
    if (data.kpi) {
      try {
        recalculateKPI_V2();
      } catch (e) { summary.errors.push('KPI: ' + e.toString()); }
    }

    // 5. Refresh Dashboard (cache timestamp)
    try { refreshDashboardCache(); } catch (e) { summary.warnings.push('Dashboard: ' + e.toString()); }

    // 6. Cleanup duplikat (pastikan idempoten)
    try {
      var dup = cleanupDuplicateSalesLedger();
      summary.duplicateFixed = (dup.removed || 0);
    } catch (e) { summary.warnings.push('Dedup: ' + e.toString()); }

    PropertiesService.getScriptProperties().setProperty('LAST_HISTORICAL_SYNC', new Date().toISOString());
    PropertiesService.getScriptProperties().setProperty('LAST_REPAIR', new Date().toISOString());
    PropertiesService.getScriptProperties().deleteProperty('LAST_ANALYTICS_BUILD');

    summary.duration = ((new Date().getTime() - t0) / 1000).toFixed(1) + 's';
    summary.pages = syncRes ? (syncRes.pages || 0) : 0;
    summary.apiOrderCount = syncRes ? (syncRes.apiOrderCount || 0) : 0;
    summary.batches = syncRes ? (syncRes.batches || 1) : 1;
    summary.oldest = syncRes ? (syncRes.oldest || '-') : '-';
    summary.newest = syncRes ? (syncRes.newest || '-') : '-';
    summary.message = 'Historical Sync selesai. Periode ' + from + '->' + to + '. ' +
      (summary.batches > 1 ? summary.batches + ' batch, ' : '') +
      summary.apiOrderCount + ' order API, ' +
      summary.processed + ' diproses (' + summary.inserted + ' baru, ' + summary.updated + ' update), ' +
      summary.ledgerUpdated + ' ledger diperbarui, ' +
      summary.settlementUpdated + ' settlement diperbarui.';

    console.log("=".repeat(60));
    console.log("[HISTORICAL_SYNC] RINGKASAN AKHIR:");
    console.log("=".repeat(60));
    console.log("  Periode: " + from + " -> " + to);
    console.log("  Batches: " + summary.batches);
    console.log("  API Order Count: " + summary.apiOrderCount);
    console.log("  Pages: " + summary.pages);
    console.log("  Inserted: " + summary.inserted);
    console.log("  Updated: " + summary.updated);
    console.log("  Total Processed: " + summary.processed);
    console.log("  Ledger Updated: " + summary.ledgerUpdated);
    console.log("  Settlement Updated: " + summary.settlementUpdated);
    console.log("  Duplicate Fixed: " + summary.duplicateFixed);
    console.log("  Oldest Order: " + summary.oldest);
    console.log("  Newest Order: " + summary.newest);
    console.log("  Duration: " + summary.duration);
    console.log("  Errors: " + (summary.errors.length > 0 ? summary.errors.join(", ") : "none"));
    console.log("  Warnings: " + (summary.warnings.length > 0 ? summary.warnings.join(", ") : "none"));
    console.log("=".repeat(60));

    logShopeeActivity('HISTORICAL_SYNC', from + '->' + to, '', 'SUCCESS',
      'batches=' + summary.batches + ' pages=' + summary.pages + ' apiOrders=' + summary.apiOrderCount +
      ' oldest=' + summary.oldest + ' newest=' + summary.newest + ' | ' + summary.message);
    
    // Restore notification context to REALTIME
    setNotificationContext(NotificationContext.REALTIME);
    console.log("[HISTORICAL_SYNC] Notification context restored to REALTIME");
    
    return summary;
  } catch (err) {
    summary.status = 'error';
    summary.message = err.toString();
    summary.duration = ((new Date().getTime() - t0) / 1000).toFixed(1) + 's';
    logShopeeActivity('HISTORICAL_SYNC', from + '->' + to, '', 'FAILED', err.toString());
    
    // Restore notification context to REALTIME even on error
    setNotificationContext(NotificationContext.REALTIME);
    console.log("[HISTORICAL_SYNC] Notification context restored to REALTIME (after error)");
    
    return summary;
  }
}
