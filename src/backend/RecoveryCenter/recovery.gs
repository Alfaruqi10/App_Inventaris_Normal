// ============================================================
// recovery.gs — Recovery Center: Repair & Maintenance
// Orchestration layer. Reuse service yang sudah ada di code.gs.
// ============================================================

/**
 * Repair Missing Orders — cari order di ShopeeOrders yang tidak ada di
 * SalesLedger, lalu jalankan updateSalesLedger untuk mengisi (idempoten).
 */
function repairMissingOrders() {
  var t0 = new Date().getTime();
  try {
    ensureDatabase();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var so = ss.getSheetByName(SHOPEE_ORDERS_SHEET);
    var sl = ss.getSheetByName(SALES_LEDGER_SHEET);
    if (!so || so.getLastRow() < 2) return { status:'success', message:'ShopeeOrders kosong.', fixed:0, duration:_dur(t0) };

    // Set Order SN yang sudah ada di ledger
    var ledgerSN = {};
    if (sl && sl.getLastRow() > 1) {
      var lr = sl.getDataRange().getValues();
      var lh = lr[0]; var lc = {}; lh.forEach(function(h,i){ lc[h]=i; });
      for (var i=1;i<lr.length;i++) ledgerSN[String(lr[i][lc['Order SN']]||'').trim()] = true;
    }
    var rows = so.getDataRange().getValues();
    var hdr = rows[0]; var ci = {}; hdr.forEach(function(h,i){ ci[h]=i; });
    var missing = 0;
    for (var j=1;j<rows.length;j++) {
      var sn = String(rows[j][ci['order_sn']]||'').trim();
      if (sn && !ledgerSN[sn]) missing++;
    }

    // Jalankan updateSalesLedger untuk mengisi yang kurang
    var led = updateSalesLedger();

    PropertiesService.getScriptProperties().setProperty('LAST_REPAIR', new Date().toISOString());
    return {
      status:'success',
      message: missing + ' order hilang ditemukan. SalesLedger diperbarui (' +
              (led.newCount||0) + ' baru, ' + (led.updatedCount||0) + ' update).',
      fixed: missing, duration: _dur(t0),
      processed: (led.newCount||0)+(led.updatedCount||0)
    };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

/**
 * Repair Missing Settlement — cari row SalesLedger COMPLETED/TO_CONFIRM_RECEIVE
 * tanpa Escrow Amount, lalu jalankan handleResyncFinance.
 */
function repairMissingSettlement() {
  var t0 = new Date().getTime();
  try {
    ensureDatabase();
    var rf = handleResyncFinance({ limit: 1000 });
    var fixed = (rf.success || 0);
    _markRepair();
    return {
      status: 'success',
      message: fixed + ' settlement diperbarui' + (rf.failed>0 ? (', ' + rf.failed + ' gagal') : '') + '.',
      fixed: fixed, duration: _dur(t0),
      processed: (rf.processed||0)
    };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

/** — reset sheet lalu isi ulang dari ShopeeOrders (idempoten).
 * Menggunakan resetSalesLedger() + updateSalesLedger() (reuse).
 */
function rebuildSalesLedger() {
  var t0 = new Date().getTime();
  return {
    status: 'error',
    message: 'Legacy rebuildSalesLedger dinonaktifkan untuk schema line-level. Gunakan migration dry-run dan writer semantic.',
    inserted: 0, updated: 0, duration: _dur(t0), writesExecuted: false
  };
  /* Legacy order-level rebuild intentionally unreachable until replaced by the line-level migration executor.
  try {
    ensureDatabase();
    
    // Set notification context to REBUILD_LEDGER
    setNotificationContext(NotificationContext.REBUILD_LEDGER);
    console.log("[rebuildSalesLedger] Notification context set to REBUILD_LEDGER - Telegram DISABLED");
    
    // ── BACKUP: Simpan Payment API data (kolom 27–46) sebelum reset ──
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var slSheet = ss.getSheetByName(SALES_LEDGER_SHEET);
    var paymentBackup = {};  // orderSn → { col27: val, col28: val, ... }
    var backupCount = 0;
    
    if (slSheet && slSheet.getLastRow() > 1) {
      var oldData = slSheet.getDataRange().getValues();
      var oldHeaders = oldData[0];
      var oldCol = {};
      oldHeaders.forEach(function(h, i) { oldCol[h] = i; });
      var snIdx = oldCol["Order SN"];
      
      if (snIdx !== undefined) {
        for (var i = 1; i < oldData.length; i++) {
          var sn = String(oldData[i][snIdx] || "").trim();
          if (!sn) continue;
          
          // Backup kolom 27–46 (Payment API: Original Price → Settlement Status)
          var hasPaymentData = false;
          var payData = {};
          for (var c = 27; c < oldData[i].length && c < SALES_LEDGER_HEADERS.length; c++) {
            var val = oldData[i][c];
            if (val !== "" && val !== null && val !== undefined && val !== 0) {
              payData[c] = val;
              hasPaymentData = true;
            }
          }
          
          if (hasPaymentData) {
            paymentBackup[sn] = payData;
            backupCount++;
          }
        }
      }
      console.log("[rebuildSalesLedger] Payment backup: " + backupCount + " order memiliki data payment.");
    }
    
    // ── RESET + REBUILD ──
    resetSalesLedger();
    var led = updateSalesLedger();
    
    // ── RESTORE: Kembalikan Payment API data ke baris yang sesuai ──
    var restoredCount = 0;
    if (backupCount > 0) {
      slSheet = ss.getSheetByName(SALES_LEDGER_SHEET);
      if (slSheet && slSheet.getLastRow() > 1) {
        var newData = slSheet.getDataRange().getValues();
        var newHeaders = newData[0];
        var newCol = {};
        newHeaders.forEach(function(h, i) { newCol[h] = i; });
        var newSnIdx = newCol["Order SN"];
        var dataChanged = false;
        
        for (var ri = 1; ri < newData.length; ri++) {
          var orderSn = String(newData[ri][newSnIdx] || "").trim();
          if (orderSn && paymentBackup[orderSn]) {
            var backup = paymentBackup[orderSn];
            for (var colIdx in backup) {
              var ci = parseInt(colIdx);
              // Pastikan kolom ada di baris
              while (newData[ri].length <= ci) newData[ri].push("");
              newData[ri][ci] = backup[colIdx];
            }
            restoredCount++;
            dataChanged = true;
          }
        }
        
        if (dataChanged) {
          // Pad semua baris ke lebar yang sama
          var maxCols = Math.max(SALES_LEDGER_HEADERS.length, slSheet.getLastColumn());
          for (var pi = 0; pi < newData.length; pi++) {
            while (newData[pi].length < maxCols) newData[pi].push("");
          }
          slSheet.getRange(1, 1, newData.length, maxCols).setValues(newData);
          console.log("[rebuildSalesLedger] Payment data restored: " + restoredCount + " / " + backupCount + " order.");
        }
      }
    }
    
    _markRepair();
    
    // Restore notification context
    setNotificationContext(NotificationContext.REALTIME);
    
    return {
      status:'success',
      message:'Sales Ledger di-rebuild. ' + (led.newCount||0) + ' baris dibuat. ' +
              restoredCount + '/' + backupCount + ' payment data dipulihkan.',
      inserted: (led.newCount||0), updated: (led.updatedCount||0),
      paymentRestored: restoredCount, paymentBackedUp: backupCount,
      duration: _dur(t0)
    };
  } catch (err) {
    // Restore notification context on error
    setNotificationContext(NotificationContext.REALTIME);
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  } */
}

/**
 * Recalculate KPI — hitung ulang KPI v2 dari SalesLedger (reuse _slCalcKPIV2).
 */
function recalculateKPI_V2() {
  var t0 = new Date().getTime();
  try {
    ensureDatabase();
    
    // Set notification context to REFRESH_KPI
    setNotificationContext(NotificationContext.REFRESH_KPI);
    console.log("[recalculateKPI_V2] Notification context set to REFRESH_KPI - Telegram DISABLED");
    
    var all = _slReadAllRows();
    var kpi = _slCalcKPIV2(all.rows);
    // Simpan snapshot KPI ke sheet agar dashboard cepat ambil
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var snap = ss.getSheetByName('KPISnapshot');
    if (!snap) { snap = ss.insertSheet('KPISnapshot'); snap.appendRow(['key','value','updated_at']); }
    else if (snap.getLastRow() < 1) snap.appendRow(['key','value','updated_at']);
    _writeKpiSnapshot(snap, kpi);
    _markRepair();
    
    // Restore notification context
    setNotificationContext(NotificationContext.REALTIME);
    
    return {
      status:'success',
      message:'KPI dihitung ulang. Total Pesanan=' + (kpi.totalPesanan||0) +
             ', Unit=' + (kpi.totalQty||0) + ', Omzet=' + (kpi.totalOmzet||0),
      duration: _dur(t0), kpi: kpi
    };
  } catch (err) {
    // Restore notification context on error
    setNotificationContext(NotificationContext.REALTIME);
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

/**
 * Refresh Cache — hapus CacheService script cache & tulis timestamp refresh.
 */
function refreshCache() {
  var t0 = new Date().getTime();
  try {
    CacheService.getScriptCache().removeAll();
    PropertiesService.getScriptProperties().setProperty('LAST_CACHE_REFRESH', new Date().toISOString());
    return { status:'success', message:'Cache dibersihkan.', duration: _dur(t0) };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

/**
 * Refresh Dashboard — set timestamp agar dashboard reload data.
 */
function refreshDashboardCache() {
  var t0 = new Date().getTime();
  try {
    PropertiesService.getScriptProperties().setProperty('LAST_DASHBOARD_REFRESH', new Date().toISOString());
    return { status:'success', message:'Dashboard refresh dijadwalkan.', duration: _dur(t0) };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

/**
 * Re-index Database — pastikan seluruh sheet punya header benar (reuse ensure*).
 * Tidak menghapus data, hanya memastikan struktur konsisten.
 */
function reindexDatabase() {
  var t0 = new Date().getTime();
  var logs = [];
  try {
    ensureDatabase();
    ensureSalesLedgerSheet();
    ensureDebugLogsSheet();
    logs.push('Schema sheet divalidasi.');
    return { status:'success', message:'Database di-re-index. ' + logs.join(' '), duration: _dur(t0), steps: logs };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}

// ── Helpers lokal (kecil, tidak duplikasi logic inti) ──
function _dur(t0) { return ((new Date().getTime() - t0) / 1000).toFixed(1) + 's'; }
function _markRepair() { try { PropertiesService.getScriptProperties().setProperty('LAST_REPAIR', new Date().toISOString()); } catch(e){} }

function _writeKpiSnapshot(sheet, kpi) {
  var map = {
    totalOmzet: kpi.totalOmzet, pendapatanBersih: kpi.pendapatanBersih,
    totalPesanan: kpi.totalPesanan, totalQty: kpi.totalQty,
    voucherShopee: kpi.voucherShopee, voucherSeller: kpi.voucherSeller, totalFee: kpi.totalFee
  };
  var now = new Date().toISOString();
  var data = sheet.getDataRange().getValues();
  var keys = Object.keys(map);
  keys.forEach(function(k) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]||'') === k) {
        sheet.getRange(i+1, 2).setValue(map[k]);
        sheet.getRange(i+1, 3).setValue(now);
        found = true; break;
      }
    }
    if (!found) sheet.appendRow([k, map[k], now]);
  });
}
