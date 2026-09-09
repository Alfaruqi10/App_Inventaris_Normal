// ==========================================
// RECONCILIATION WORKER
// Automatic Finance Sync & Order Verification
// Interval: 5-15 menit
// ==========================================

/**
 * Reconciliation Worker — dipanggil via time-based trigger setiap 10 menit.
 * 
 * Tugas:
 * 1. Cek order yang butuh finance verification (COMPLETED tapi belum ada escrow)
 * 2. Cek order yang update_time berubah (potensi return/refund)
 * 3. Retry order yang gagal sync sebelumnya
 * 4. Update SalesLedger untuk order-order tersebut
 * 
 * TIDAK memproses semua order — hanya kandidat yang perlu verification.
 */
function reconcileFinanceAutomatically() {
  try {
    Logger.log("[ReconcileFinance] Starting automatic reconciliation...");
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var slSheet = ss.getSheetByName("SalesLedger");
    var soSheet = ss.getSheetByName("ShopeeOrders");
    
    if (!slSheet || !soSheet || slSheet.getLastRow() < 2) {
      Logger.log("[ReconcileFinance] No data to reconcile.");
      return { status: "success", message: "No data", processed: 0 };
    }
    
    // Baca SalesLedger
    var slData = slSheet.getDataRange().getValues();
    var slHeaders = slData[0];
    var slCol = {};
    slHeaders.forEach(function(h, i) { slCol[h] = i; });
    var ownerCol = slCol["Settlement Owner"];
    
    // Kandidat order yang perlu dicek:
    // 1. Status Shopee = COMPLETED tapi Escrow Amount kosong/0
    // 2. Settlement Sync = FAILED
    // 3. Status Shopee = COMPLETED dan Sync Time > 1 jam yang lalu (re-check return)
    
    var candidates = [];
    var now = new Date();
    var oneHourAgo = new Date(now.getTime() - 3600000); // 1 jam yang lalu
    
    for (var i = 1; i < slData.length; i++) {
      var row = slData[i];
      var orderSn = String(row[slCol["Order SN"]] || "").trim();
      var statusShopee = String(row[slCol["Status Shopee"]] || "");
      var statusLedger = String(row[slCol["Status Ledger"]] || "");
      var escrowAmount = row[slCol["Escrow Amount"]];
      var settlementSync = String(row[slCol["Settlement Sync"]] || "");
      var syncTime = row[slCol["Sync Time"]];
      
      if (!orderSn) continue;
      if (ownerCol !== undefined && !isSalesLedgerSettlementOwner(row[ownerCol])) continue;
      
      // Kriteria 1: COMPLETED tapi belum ada finance
      var needsFinance = (statusShopee === "COMPLETED" || statusShopee === "TO_CONFIRM_RECEIVE") 
                         && (escrowAmount === "" || escrowAmount === null || escrowAmount === undefined);
      
      // Kriteria 2: Settlement Sync FAILED
      var failedSync = settlementSync === "FAILED";
      
      // Kriteria 3: COMPLETED dan sudah > 1 jam (re-check return)
      var needsRecheck = false;
      if (statusShopee === "COMPLETED" && statusLedger !== "Retur" && syncTime) {
        var syncDate = syncTime instanceof Date ? syncTime : new Date(syncTime);
        needsRecheck = syncDate < oneHourAgo;
      }
      
      if (needsFinance || failedSync || needsRecheck) {
        candidates.push({
          orderSn: orderSn,
          reason: needsFinance ? "missing_finance" : (failedSync ? "failed_sync" : "recheck_return")
        });
      }
    }
    
    // Batasi per execution untuk menghindari timeout
    var MAX_PER_RUN = 20;
    var toProcess = candidates.slice(0, MAX_PER_RUN);
    
    Logger.log("[ReconcileFinance] Found " + candidates.length + " candidates, processing " + toProcess.length);
    
    if (toProcess.length === 0) {
      return { status: "success", message: "No candidates", processed: 0 };
    }
    
    // Ambil order detail dari Shopee API untuk verification
    var orderSns = toProcess.map(function(c) { return c.orderSn; });
    var verifiedOrders = [];
    
    // Batch fetch (max 50 per request)
    for (var b = 0; b < orderSns.length; b += 50) {
      var batch = orderSns.slice(b, b + 50);
      try {
        var detailRes = shopeeGet("/api/v2/order/get_order_detail", {
          order_sn_list: batch.join(","),
          response_optional_fields: "item_list,total_amount,order_status,update_time"
        });
        
        if (detailRes && detailRes.response && detailRes.response.order_list) {
          detailRes.response.order_list.forEach(function(ord) {
            verifiedOrders.push(ord.order_sn);
          });
        }
      } catch (apiErr) {
        Logger.log("[ReconcileFinance] Error fetching batch: " + apiErr.toString());
      }
    }
    
    Logger.log("[ReconcileFinance] Verified " + verifiedOrders.length + " orders from API");
    
    // Trigger updateSalesLedger untuk order-order ini
    // updateSalesLedger sudah handle idempotent dan conditional finance fetch
    try {
      // Reconciliation hanya boleh menyentuh order yang berhasil diverifikasi pada run ini.
      // Jangan pernah memicu rewrite global dari ShopeeOrders yang mungkin masih stale.
      var ledgerResult = updateSalesLedger({
        orderSns: verifiedOrders,
        preserveOrderContent: true
      });
      Logger.log("[ReconcileFinance] ✅ updateSalesLedger completed: new=" + (ledgerResult.newCount || 0) 
                 + " upd=" + (ledgerResult.updatedCount || 0) 
                 + " finance=" + (ledgerResult.paymentFetched || 0));
      
      logShopeeActivity("RECONCILE_FINANCE", "", "", "SUCCESS", 
                        "Candidates: " + candidates.length 
                        + " | Processed: " + toProcess.length 
                        + " | Finance fetched: " + (ledgerResult.paymentFetched || 0));
      
      return { 
        status: "success", 
        message: "Reconciliation completed", 
        candidates: candidates.length,
        processed: toProcess.length,
        verified: verifiedOrders.length,
        financeFetched: ledgerResult.paymentFetched || 0
      };
      
    } catch (ledgerErr) {
      Logger.log("[ReconcileFinance] ❌ updateSalesLedger error: " + ledgerErr.toString());
      logShopeeActivity("RECONCILE_FINANCE", "", "", "FAILED", ledgerErr.toString());
      return { status: "error", message: ledgerErr.toString() };
    }
    
  } catch (err) {
    Logger.log("[ReconcileFinance] ❌ Error: " + err.toString());
    logShopeeActivity("RECONCILE_FINANCE", "", "", "FAILED", err.toString());
    return { status: "error", message: err.toString() };
  }
}

/**
 * Setup reconciliation trigger — jalankan sekali dari GAS Editor.
 * Trigger setiap 10 menit untuk balance antara responsiveness dan API quota.
 */
function setupReconciliationTrigger() {
  // Hapus trigger lama dulu
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === "reconcileFinanceAutomatically") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Buat trigger baru setiap 10 menit
  ScriptApp.newTrigger("reconcileFinanceAutomatically")
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log("✅ Reconciliation trigger aktif (setiap 10 menit).");
  return "Trigger aktif: reconcileFinanceAutomatically setiap 10 menit.";
}

/**
 * Hapus reconciliation trigger.
 */
function removeReconciliationTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === "reconcileFinanceAutomatically") {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log("Reconciliation trigger dihapus: " + removed);
  return removed;
}

/**
 * Manual runner — untuk testing dari GAS Editor.
 */
function runReconciliationManually() {
  var result = reconcileFinanceAutomatically();
  Logger.log("=== RECONCILIATION RESULT ===");
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
