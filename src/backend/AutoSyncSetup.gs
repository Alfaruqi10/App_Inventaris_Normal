/**
 * ==========================================
 * AUTOMATIC SYNC SETUP SCRIPT
 * ==========================================
 * 
 * Jalankan fungsi ini SEKALI dari GAS Editor setelah deployment
 * untuk mengaktifkan automatic synchronization system.
 * 
 * Script ini akan:
 * 1. Setup webhook queue processor (every 1 minute)
 * 2. Setup reconciliation worker (every 10 minutes)
 * 3. Verify auto-sync trigger (every 5 minutes)
 * 4. Display summary of active triggers
 */

function setupAutomaticSyncSystem() {
  Logger.log("==========================================");
  Logger.log("AUTOMATIC SYNC SETUP");
  Logger.log("==========================================\n");
  
  var results = [];
  
  try {
    // 1. Setup Webhook Queue Processor
    Logger.log("1. Setting up Webhook Queue Processor...");
    var webhookResult = setupWebhookQueueTrigger();
    results.push("✅ Webhook Queue: " + webhookResult);
    Logger.log("   ✅ " + webhookResult + "\n");
  } catch (e) {
    results.push("❌ Webhook Queue: " + e.toString());
    Logger.log("   ❌ ERROR: " + e.toString() + "\n");
  }
  
  try {
    // 2. Setup Reconciliation Worker
    Logger.log("2. Setting up Reconciliation Worker...");
    var reconcileResult = setupReconciliationTrigger();
    results.push("✅ Reconciliation: " + reconcileResult);
    Logger.log("   ✅ " + reconcileResult + "\n");
  } catch (e) {
    results.push("❌ Reconciliation: " + e.toString());
    Logger.log("   ❌ ERROR: " + e.toString() + "\n");
  }
  
  try {
    // 3. Verify Auto-Sync Trigger (should already exist)
    Logger.log("3. Verifying Auto-Sync Trigger...");
    var triggers = ScriptApp.getProjectTriggers();
    var autoSyncExists = triggers.some(function(t) {
      return t.getHandlerFunction() === "autoSyncShopeeOrders";
    });
    
    if (autoSyncExists) {
      results.push("✅ Auto-Sync: Already active");
      Logger.log("   ✅ Auto-Sync trigger already active\n");
    } else {
      Logger.log("   ⚠️ Auto-Sync trigger not found. Setting up...");
      var autoSyncResult = setupAutoSyncTrigger();
      results.push("✅ Auto-Sync: " + autoSyncResult);
      Logger.log("   ✅ " + autoSyncResult + "\n");
    }
  } catch (e) {
    results.push("❌ Auto-Sync: " + e.toString());
    Logger.log("   ❌ ERROR: " + e.toString() + "\n");
  }
  
  // 4. Display Summary
  Logger.log("==========================================");
  Logger.log("SETUP SUMMARY");
  Logger.log("==========================================\n");
  
  results.forEach(function(r) {
    Logger.log(r);
  });
  
  Logger.log("\n==========================================");
  Logger.log("ACTIVE TRIGGERS");
  Logger.log("==========================================\n");
  
  displayActiveTriggers();
  
  Logger.log("\n==========================================");
  Logger.log("SETUP COMPLETED");
  Logger.log("==========================================");
  Logger.log("\n✅ Automatic synchronization system is now active!");
  Logger.log("\nWhat happens now:");
  Logger.log("  • New orders from Shopee webhook → auto-synced in 1-2 minutes");
  Logger.log("  • Finance for COMPLETED orders → auto-fetched");
  Logger.log("  • Missing/failed orders → auto-reconciled every 10 minutes");
  Logger.log("  • Fallback sync → runs every 5 minutes");
  Logger.log("\nUser action required:");
  Logger.log("  • NONE for normal operation");
  Logger.log("  • Manual 'Sync' and 'Resync Finance' buttons remain as emergency fallback");
  
  return {
    status: "success",
    results: results
  };
}

/**
 * Display all active time-driven triggers
 */
function displayActiveTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var timeTriggers = triggers.filter(function(t) {
    return t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK;
  });
  
  if (timeTriggers.length === 0) {
    Logger.log("⚠️ No time-driven triggers found!");
    return;
  }
  
  Logger.log("Found " + timeTriggers.length + " time-driven trigger(s):\n");
  
  timeTriggers.forEach(function(t, index) {
    var handler = t.getHandlerFunction();
    var triggerType = "Unknown";
    
    // Determine trigger type
    try {
      var eventType = t.getEventType();
      if (eventType === ScriptApp.EventType.CLOCK) {
        triggerType = "Time-based";
      }
    } catch (e) {
      triggerType = "Time-based";
    }
    
    Logger.log((index + 1) + ". Function: " + handler);
    Logger.log("   Type: " + triggerType);
    Logger.log("   ID: " + t.getUniqueId().substring(0, 20) + "...");
    
    // Identify trigger purpose
    if (handler === "processQueuedWebhookOrders") {
      Logger.log("   Purpose: Webhook Queue Processor (every 1 minute)");
      Logger.log("   Role: Process Shopee webhooks → update SalesLedger + finance");
    } else if (handler === "reconcileFinanceAutomatically") {
      Logger.log("   Purpose: Reconciliation Worker (every 10 minutes)");
      Logger.log("   Role: Verify & retry failed/missing finance sync");
    } else if (handler === "autoSyncShopeeOrders") {
      Logger.log("   Purpose: Auto-Sync Fallback (every 5 minutes)");
      Logger.log("   Role: Catch missed orders + full sync");
    } else {
      Logger.log("   Purpose: Other");
    }
    Logger.log("");
  });
}

/**
 * Verify system health after setup
 */
function verifyAutomaticSyncSystem() {
  Logger.log("==========================================");
  Logger.log("AUTOMATIC SYNC SYSTEM VERIFICATION");
  Logger.log("==========================================\n");
  
  var checks = [];
  
  // Check 1: Triggers
  Logger.log("1. Checking Time-Driven Triggers...");
  var triggers = ScriptApp.getProjectTriggers();
  var hasWebhookQueue = triggers.some(function(t) { return t.getHandlerFunction() === "processQueuedWebhookOrders"; });
  var hasReconcile = triggers.some(function(t) { return t.getHandlerFunction() === "reconcileFinanceAutomatically"; });
  var hasAutoSync = triggers.some(function(t) { return t.getHandlerFunction() === "autoSyncShopeeOrders"; });
  
  checks.push({
    name: "Webhook Queue Processor",
    status: hasWebhookQueue ? "✅ ACTIVE" : "❌ MISSING",
    pass: hasWebhookQueue
  });
  
  checks.push({
    name: "Reconciliation Worker",
    status: hasReconcile ? "✅ ACTIVE" : "❌ MISSING",
    pass: hasReconcile
  });
  
  checks.push({
    name: "Auto-Sync Fallback",
    status: hasAutoSync ? "✅ ACTIVE" : "❌ MISSING",
    pass: hasAutoSync
  });
  
  Logger.log("   Webhook Queue Processor: " + (hasWebhookQueue ? "✅ ACTIVE" : "❌ MISSING"));
  Logger.log("   Reconciliation Worker: " + (hasReconcile ? "✅ ACTIVE" : "❌ MISSING"));
  Logger.log("   Auto-Sync Fallback: " + (hasAutoSync ? "✅ ACTIVE" : "❌ MISSING"));
  Logger.log("");
  
  // Check 2: Shopee Tokens
  Logger.log("2. Checking Shopee API Tokens...");
  try {
    var tokens = getShopeeTokens();
    var hasToken = !!(tokens.accessToken && tokens.shopId);
    checks.push({
      name: "Shopee API Authentication",
      status: hasToken ? "✅ CONFIGURED" : "❌ NOT CONFIGURED",
      pass: hasToken
    });
    Logger.log("   Access Token: " + (tokens.accessToken ? "✅ EXISTS" : "❌ MISSING"));
    Logger.log("   Shop ID: " + (tokens.shopId ? "✅ " + tokens.shopId : "❌ MISSING"));
    if (tokens.expireAt) {
      var expireDate = new Date(tokens.expireAt * 1000);
      var isExpired = expireDate < new Date();
      Logger.log("   Expires: " + expireDate.toISOString() + (isExpired ? " ⚠️ EXPIRED" : " ✅ VALID"));
    }
  } catch (e) {
    checks.push({
      name: "Shopee API Authentication",
      status: "❌ ERROR: " + e.toString(),
      pass: false
    });
    Logger.log("   ❌ ERROR: " + e.toString());
  }
  Logger.log("");
  
  // Check 3: Database Sheets
  Logger.log("3. Checking Database Sheets...");
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var requiredSheets = [
      "ShopeeOrders",
      "SalesLedger",
      "ShopeeLogs"
    ];
    
    var allSheetsExist = true;
    requiredSheets.forEach(function(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      var exists = !!sheet;
      Logger.log("   " + sheetName + ": " + (exists ? "✅ EXISTS" : "❌ MISSING"));
      if (!exists) allSheetsExist = false;
    });
    
    checks.push({
      name: "Database Sheets",
      status: allSheetsExist ? "✅ ALL PRESENT" : "⚠️ SOME MISSING",
      pass: allSheetsExist
    });
  } catch (e) {
    checks.push({
      name: "Database Sheets",
      status: "❌ ERROR: " + e.toString(),
      pass: false
    });
    Logger.log("   ❌ ERROR: " + e.toString());
  }
  Logger.log("");
  
  // Check 4: Functions Exist
  Logger.log("4. Checking Required Functions...");
  var requiredFunctions = [
    "processQueuedWebhookOrders",
    "reconcileFinanceAutomatically",
    "updateSalesLedger",
    "autoSyncShopeeOrders"
  ];
  
  var allFunctionsExist = true;
  requiredFunctions.forEach(function(funcName) {
    var exists = typeof this[funcName] === "function";
    Logger.log("   " + funcName + ": " + (exists ? "✅ DEFINED" : "❌ MISSING"));
    if (!exists) allFunctionsExist = false;
  });
  
  checks.push({
    name: "Required Functions",
    status: allFunctionsExist ? "✅ ALL DEFINED" : "❌ SOME MISSING",
    pass: allFunctionsExist
  });
  Logger.log("");
  
  // Summary
  Logger.log("==========================================");
  Logger.log("VERIFICATION SUMMARY");
  Logger.log("==========================================\n");
  
  var allPass = checks.every(function(c) { return c.pass; });
  
  checks.forEach(function(c) {
    Logger.log(c.name + ": " + c.status);
  });
  
  Logger.log("\n==========================================");
  if (allPass) {
    Logger.log("✅ ALL CHECKS PASSED");
    Logger.log("==========================================");
    Logger.log("\nSystem is ready for automatic synchronization!");
  } else {
    Logger.log("⚠️ SOME CHECKS FAILED");
    Logger.log("==========================================");
    Logger.log("\nPlease resolve the issues above before using automatic sync.");
  }
  
  return {
    status: allPass ? "success" : "warning",
    checks: checks,
    allPass: allPass
  };
}

/**
 * Remove all automatic sync triggers (rollback)
 */
function removeAutomaticSyncSystem() {
  if (!confirm("This will DISABLE automatic synchronization.\n\nUser will need to manually click 'Sync' and 'Resync Finance' buttons.\n\nContinue?")) {
    Logger.log("❌ Rollback cancelled by user.");
    return { status: "cancelled" };
  }
  
  Logger.log("==========================================");
  Logger.log("REMOVING AUTOMATIC SYNC SYSTEM");
  Logger.log("==========================================\n");
  
  var removed = {
    webhookQueue: 0,
    reconciliation: 0,
    autoSync: 0
  };
  
  var triggers = ScriptApp.getProjectTriggers();
  
  triggers.forEach(function(t) {
    var handler = t.getHandlerFunction();
    
    if (handler === "processQueuedWebhookOrders") {
      ScriptApp.deleteTrigger(t);
      removed.webhookQueue++;
      Logger.log("✅ Removed: processQueuedWebhookOrders");
    } else if (handler === "reconcileFinanceAutomatically") {
      ScriptApp.deleteTrigger(t);
      removed.reconciliation++;
      Logger.log("✅ Removed: reconcileFinanceAutomatically");
    } else if (handler === "autoSyncShopeeOrders") {
      ScriptApp.deleteTrigger(t);
      removed.autoSync++;
      Logger.log("✅ Removed: autoSyncShopeeOrders");
    }
  });
  
  Logger.log("\n==========================================");
  Logger.log("REMOVAL SUMMARY");
  Logger.log("==========================================\n");
  Logger.log("Webhook Queue Processor: " + removed.webhookQueue + " trigger(s) removed");
  Logger.log("Reconciliation Worker: " + removed.reconciliation + " trigger(s) removed");
  Logger.log("Auto-Sync Fallback: " + removed.autoSync + " trigger(s) removed");
  
  var total = removed.webhookQueue + removed.reconciliation + removed.autoSync;
  
  Logger.log("\n✅ Total: " + total + " trigger(s) removed");
  Logger.log("\n⚠️ Automatic synchronization is now DISABLED.");
  Logger.log("User must manually use 'Sync' and 'Resync Finance' buttons.");
  
  return {
    status: "success",
    removed: removed,
    total: total
  };
}

/**
 * Test webhook queue manually (simulate webhook processing)
 */
function testWebhookQueueManually() {
  Logger.log("==========================================");
  Logger.log("TESTING WEBHOOK QUEUE PROCESSOR");
  Logger.log("==========================================\n");
  
  try {
    Logger.log("Checking webhook queue...");
    var props = PropertiesService.getScriptProperties();
    var queueRaw = props.getProperty("webhook_queue") || "[]";
    var queue = JSON.parse(queueRaw);
    
    Logger.log("Current queue size: " + queue.length);
    
    if (queue.length === 0) {
      Logger.log("\n⚠️ Queue is empty. No orders to process.");
      Logger.log("\nTo test with real order:");
      Logger.log("1. Add order_sn to queue manually:");
      Logger.log("   PropertiesService.getScriptProperties().setProperty('webhook_queue', '[\"ORDER_SN_HERE\"]');");
      Logger.log("2. Run this test again");
      return { status: "empty", queue: [] };
    }
    
    Logger.log("Orders in queue: " + queue.join(", "));
    Logger.log("\nProcessing queue...\n");
    
    processQueuedWebhookOrders();
    
    Logger.log("\n✅ Queue processing completed!");
    Logger.log("Check ShopeeLogs sheet for details.");
    
    return { status: "success", processed: queue.length };
    
  } catch (e) {
    Logger.log("\n❌ ERROR: " + e.toString());
    return { status: "error", message: e.toString() };
  }
}

/**
 * Test reconciliation worker manually
 */
function testReconciliationWorkerManually() {
  Logger.log("==========================================");
  Logger.log("TESTING RECONCILIATION WORKER");
  Logger.log("==========================================\n");
  
  try {
    var result = runReconciliationManually();
    
    Logger.log("\n==========================================");
    Logger.log("RECONCILIATION TEST RESULT");
    Logger.log("==========================================\n");
    Logger.log("Status: " + result.status);
    Logger.log("Candidates found: " + (result.candidates || 0));
    Logger.log("Orders processed: " + (result.processed || 0));
    Logger.log("Orders verified: " + (result.verified || 0));
    Logger.log("Finance fetched: " + (result.financeFetched || 0));
    
    if (result.status === "success") {
      Logger.log("\n✅ Reconciliation test completed successfully!");
    } else {
      Logger.log("\n❌ Reconciliation test failed: " + result.message);
    }
    
    return result;
    
  } catch (e) {
    Logger.log("\n❌ ERROR: " + e.toString());
    return { status: "error", message: e.toString() };
  }
}
