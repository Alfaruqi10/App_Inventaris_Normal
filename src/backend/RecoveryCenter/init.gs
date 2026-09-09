// ============================================================
// RecoveryCenter/init.gs — Inisialisasi & Pengujian Framework
// ============================================================

/**
 * Inisialisasi awal modul Recovery Center saat project dibuka.
 * Di sini kita mendaftarkan placeholder tools awal untuk pengujian.
 */
function initRecoveryCenterFramework() {
  console.log("[RecoveryCenterInit] Memulai registrasi core tools...");

  // 1. Tool Uji Coba: Repair Pending Deduction
  RecoveryToolRegistry.registerTool({
    toolId: "test_repair_pending",
    title: "Repair Pending Deduction (Test)",
    category: "DEDUCTION",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: true,
    requiresLock: true,
    estimatedDuration: "3s",
    handlerFunction: "testHandlerRepairPending",
    rollbackFunction: "testRollbackRepairPending"
  });

  // 2. Tool Uji Coba: Historical Cleanup (Destruktif, perlu Owner Password)
  RecoveryToolRegistry.registerTool({
    toolId: "test_historical_cleanup",
    title: "Historical Cleanup (Test Destruktif)",
    category: "HISTORICAL",
    destructiveAction: true,
    requiresOwnerPassword: true,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "10s",
    handlerFunction: "testHandlerHistoricalCleanup"
  });

  // 3. Rebuild Analytics
  RecoveryToolRegistry.registerTool({
    toolId: "rebuild_analytics",
    title: "Rebuild All Analytics Cache",
    category: "MAINTENANCE",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "15s",
    handlerFunction: "handleRcRebuildAnalytics"
  });

  // 4. Rebuild Analytics Product
  RecoveryToolRegistry.registerTool({
    toolId: "rebuild_analytics_product",
    title: "Rebuild Analytics Product Cache",
    category: "MAINTENANCE",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "10s",
    handlerFunction: "handleRcRebuildAnalyticsProduct"
  });

  // 5. Rebuild Analytics SKU
  RecoveryToolRegistry.registerTool({
    toolId: "rebuild_analytics_sku",
    title: "Rebuild Analytics SKU Cache",
    category: "MAINTENANCE",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "10s",
    handlerFunction: "handleRcRebuildAnalyticsSKU"
  });

  // 6. Rebuild Analytics Daily
  RecoveryToolRegistry.registerTool({
    toolId: "rebuild_analytics_daily",
    title: "Rebuild Analytics Daily Cache",
    category: "MAINTENANCE",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "5s",
    handlerFunction: "handleRcRebuildAnalyticsDaily"
  });

  // 7. Verify Analytics
  RecoveryToolRegistry.registerTool({
    toolId: "verify_analytics",
    title: "Verify Analytics Consistency",
    category: "AUDIT",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: false,
    estimatedDuration: "5s",
    handlerFunction: "handleRcVerifyAnalytics"
  });

  // 8. Repair Analytics
  RecoveryToolRegistry.registerTool({
    toolId: "repair_analytics",
    title: "Repair Analytics Cache Sheets",
    category: "MAINTENANCE",
    destructiveAction: false,
    requiresOwnerPassword: false,
    supportsPreview: true,
    supportsRollback: false,
    requiresLock: true,
    estimatedDuration: "15s",
    handlerFunction: "handleRcRepairAnalytics"
  });

  console.log("[RecoveryCenterInit] Inisialisasi selesai. " + RecoveryToolRegistry.getAllTools().length + " tool terdaftar.");
}

// ── HANDLER & ROLLBACK PLACEHOLDERS UNTUK TESTING ──

/**
 * Handler simulasi untuk Repair Pending Deduction.
 */
function testHandlerRepairPending(options) {
  console.log("[TestHandler] Menjalankan testHandlerRepairPending...", options);
  
  if (options.preview) {
    // Mode simulasi (preview)
    return {
      status: "success",
      message: "Preview Sukses: Menemukan 5 pesanan berstatus PENDING yang siap diubah menjadi WAITING_APPROVAL.",
      affectedRows: 5,
      successCount: 5,
      failedCount: 0,
      metadata: { simulatedOrderSns: ["SN001", "SN002", "SN003", "SN004", "SN005"] }
    };
  }

  // Mode eksekusi riil
  // Contoh jika disengaja melempar error untuk menguji rollback:
  if (options.simulateError) {
    throw new Error("Koneksi spreadsheet terputus di tengah jalan.");
  }

  return {
    status: "success",
    message: "Eksekusi Sukses: Berhasil memperbarui status 5 pesanan menjadi WAITING_APPROVAL.",
    affectedRows: 5,
    successCount: 5,
    failedCount: 0
  };
}

/**
 * Rollback simulasi untuk Repair Pending Deduction.
 */
function testRollbackRepairPending(state) {
  console.log("[TestHandler] Menjalankan testRollbackRepairPending...", state);
  return {
    status: "success",
    message: "Rollback Sukses: Status 5 pesanan dikembalikan ke PENDING."
  };
}

/**
 * Handler simulasi untuk Historical Cleanup.
 */
function testHandlerHistoricalCleanup(options) {
  console.log("[TestHandler] Menjalankan testHandlerHistoricalCleanup...", options);
  
  if (options.preview) {
    return {
      status: "success",
      message: "Preview Sukses: Menemukan 120 baris riwayat transaksi tahun lalu yang siap dihapus permanen.",
      affectedRows: 120,
      successCount: 120,
      failedCount: 0
    };
  }

  return {
    status: "success",
    message: "Eksekusi Sukses: Berhasil menghapus secara permanen 120 baris riwayat lama.",
    affectedRows: 120,
    successCount: 120,
    failedCount: 0
  };
}

// ── RUNNER TES MANDIRI (Bisa Dijalankan dari GAS Editor) ──

/**
 * Jalankan fungsi ini dari editor Apps Script untuk memvalidasi
 * seluruh siklus hidup (lifecycle) eksekusi framework core.
 */
function runRecoveryFrameworkDiagnosticTests() {
  console.log("=========================================");
  console.log("MEMULAI DIAGNOSTIK RECOVERY CENTER FRAMEWORK");
  console.log("=========================================");

  // Reset & Inisialisasi ulang registry
  RecoveryToolRegistry.clearRegistry();
  initRecoveryCenterFramework();

  var authAdmin = { role: "Admin", userEmail: "admin@ansla.com" };
  var authOwner = { role: "Owner", userEmail: "owner@ansla.com" };

  // --- TES 1: Eksekusi Tool non-eksisten ---
  console.log("\n--- TEST 1: Eksekusi tool tidak dikenal ---");
  var res1 = executeRecoveryTool("unknown_tool", { auth: authAdmin });
  console.log("Hasil:", JSON.stringify(res1));

  // --- TES 2: Simulasi Preview ---
  console.log("\n--- TEST 2: Simulasi Preview (Test Repair Pending) ---");
  var res2 = executeRecoveryTool("test_repair_pending", {
    preview: true,
    auth: authAdmin
  });
  console.log("Hasil:", JSON.stringify(res2));

  // --- TES 3: Eksekusi Sukses Riil ---
  console.log("\n--- TEST 3: Eksekusi Riil Sukses ---");
  var res3 = executeRecoveryTool("test_repair_pending", {
    preview: false,
    auth: authAdmin
  });
  console.log("Hasil:", JSON.stringify(res3));

  // --- TES 4: Uji Coba Transaksi Gagal + Rollback ---
  console.log("\n--- TEST 4: Uji Coba Eksekusi Gagal + Rollback Otomatis ---");
  var res4 = executeRecoveryTool("test_repair_pending", {
    preview: false,
    auth: authAdmin,
    simulateError: true
  });
  console.log("Hasil:", JSON.stringify(res4));

  // --- TES 5: Uji Coba Proteksi Destruktif (Izin Ditolak) ---
  console.log("\n--- TEST 5: Proteksi Destruktif (Admin tidak diizinkan) ---");
  var res5 = executeRecoveryTool("test_historical_cleanup", {
    preview: false,
    auth: authAdmin
  });
  console.log("Hasil:", JSON.stringify(res5));

  // --- TES 6: Uji Coba Proteksi Destruktif dengan Password Salah ---
  console.log("\n--- TEST 6: Proteksi Destruktif (Owner Password Salah) ---");
  var res6 = executeRecoveryTool("test_historical_cleanup", {
    preview: false,
    auth: authOwner,
    ownerPassword: "wrongpassword"
  });
  console.log("Hasil:", JSON.stringify(res6));

  // --- TES 7: Uji Coba Proteksi Destruktif Sukses ---
  console.log("\n--- TEST 7: Proteksi Destruktif (Owner Password Benar) ---");
  // Set password pengujian ke PropertiesService
  PropertiesService.getScriptProperties().setProperty("OWNER_RECOVERY_PASSWORD", "secret123");
  var res7 = executeRecoveryTool("test_historical_cleanup", {
    preview: false,
    auth: authOwner,
    ownerPassword: "secret123"
  });
  console.log("Hasil:", JSON.stringify(res7));

  console.log("\n=========================================");
  console.log("TES DIAGNOSTIK SELESAI");
  console.log("=========================================");
}

// ── RECOVERY CENTER HANDLERS FOR BUSINESS ANALYTICS ──────────────────

function handleRcRebuildAnalytics(options) {
  const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
  const master = readSheetObjects(MASTER_SHEET_NAME) || [];
  
  if (options.preview) {
    return {
      status: "success",
      message: `Preview: Ready to rebuild all 8 analytics sheets processing ${ledger.length} ledger rows and ${master.length} master products.`,
      affectedRows: ledger.length,
      successCount: ledger.length,
      failedCount: 0
    };
  }

  const res = rebuildAnalytics();
  return {
    status: "success",
    message: "Eksekusi Sukses: " + res.message,
    affectedRows: ledger.length,
    successCount: ledger.length,
    failedCount: 0
  };
}

function handleRcRebuildAnalyticsProduct(options) {
  const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
  const master = readSheetObjects(MASTER_SHEET_NAME) || [];
  
  if (options.preview) {
    return {
      status: "success",
      message: `Preview: Ready to recalculate product performance cache for ${master.length} products.`,
      affectedRows: master.length,
      successCount: master.length,
      failedCount: 0
    };
  }

  // Filter ledger after limit
  const filteredLedger = ledger.filter(row => {
    const dStr = formatDateStr(row["Tanggal Order"]);
    if (!dStr) return false;
    const d = new Date(dStr + "T00:00:00Z");
    return d >= MIN_DATE_LIMIT;
  });

  const masterMap = {};
  master.forEach(item => {
    const sku = cleanText(item["Kode Barang"]);
    if (sku) {
      masterMap[sku] = {
        name: cleanText(item["Nama Barang"]),
        cogs: parseFloat(item["Harga Beli"]) || 0,
        stock: parseInt(item["Stok Saat Ini"]) || 0,
        category: cleanText(item["Keterangan"]) || "Umum",
        warna: cleanText(item["Warna"]) || "",
        ukuran: cleanText(item["Ukuran"]) || "",
        photo: cleanText(item["Photo URL"]) || ""
      };
    }
  });

  calculateProductAnalytics(filteredLedger, masterMap, ledger);
  return {
    status: "success",
    message: "Eksekusi Sukses: Cache Analytics_Product dan Analytics_SKU berhasil diperbarui.",
    affectedRows: master.length,
    successCount: master.length,
    failedCount: 0
  };
}

function handleRcRebuildAnalyticsSKU(options) {
  return handleRcRebuildAnalyticsProduct(options);
}

function handleRcRebuildAnalyticsDaily(options) {
  const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
  const master = readSheetObjects(MASTER_SHEET_NAME) || [];
  
  if (options.preview) {
    return {
      status: "success",
      message: `Preview: Ready to recalculate daily summary cache for ${ledger.length} ledger rows.`,
      affectedRows: ledger.length,
      successCount: ledger.length,
      failedCount: 0
    };
  }

  // Filter ledger after limit
  const filteredLedger = ledger.filter(row => {
    const dStr = formatDateStr(row["Tanggal Order"]);
    if (!dStr) return false;
    const d = new Date(dStr + "T00:00:00Z");
    return d >= MIN_DATE_LIMIT;
  });

  const masterMap = {};
  master.forEach(item => {
    const sku = cleanText(item["Kode Barang"]);
    if (sku) {
      masterMap[sku] = {
        name: cleanText(item["Nama Barang"]),
        cogs: parseFloat(item["Harga Beli"]) || 0,
        stock: parseInt(item["Stok Saat Ini"]) || 0,
        category: cleanText(item["Keterangan"]) || "Umum"
      };
    }
  });

  calculateDashboardAnalytics(filteredLedger, masterMap);
  return {
    status: "success",
    message: "Eksekusi Sukses: Cache Analytics_Daily berhasil diperbarui.",
    affectedRows: ledger.length,
    successCount: ledger.length,
    failedCount: 0
  };
}

function handleRcVerifyAnalytics(options) {
  const ledger = readSheetObjects(SALES_LEDGER_SHEET) || [];
  const products = readSheetObjects(ANALYTICS_PRODUCT_SHEET) || [];
  const skus = readSheetObjects(ANALYTICS_SKU_SHEET) || [];

  const parseOrderDate = function(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      return new Date((val - 25569) * 86400 * 1000);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const shopeeOrders = readSheetObjects(SHOPEE_ORDERS_SHEET) || [];
  const soMap = {};
  shopeeOrders.forEach(row => {
    const sn = String(row.order_sn || "").trim();
    if (!sn) return;
    if (!soMap[sn]) soMap[sn] = [];
    soMap[sn].push({
      qty: Number(row.qty || 0),
      amount: Number(row.amount || 0)
    });
  });

  let ledgerQty = 0;
  let ledgerRevenue = 0;

  getSalesLedgerLines({ rows: ledger, strict: false }).forEach(row => {
    const orderDate = parseOrderDate(row["Tanggal Order"]);
    if (!orderDate || orderDate < MIN_DATE_LIMIT) return;

    const status = String(row["Status Shopee"] || "").toUpperCase();
    const isValidOrder = ["COMPLETED", "SHIPPED", "TO_CONFIRM_RECEIVE", "READY_TO_SHIP", "PROCESSED"].includes(status);
    if (!isValidOrder) return;

    // Verification uses canonical logical lines. Settlement values are excluded
    // here because product analytics intentionally does not allocate settlement.
    ledgerQty += parseInt(row["Qty"]) || 0;
    ledgerRevenue += parseFloat(row["Product Subtotal"] || row["Subtotal"]) || (parseFloat(row["Harga Produk"]) * (parseInt(row["Qty"]) || 0)) || 0;
  });

  const productQty = products.reduce((sum, p) => sum + (parseInt(p.TotalQty) || 0), 0);
  const productRevenue = products.reduce((sum, p) => sum + (parseFloat(p.Revenue) || 0), 0);
  const skuQty = skus.reduce((sum, s) => sum + (parseInt(s.TotalQty) || 0), 0);
  const skuRevenue = skus.reduce((sum, s) => sum + (parseFloat(s.Revenue) || 0), 0);

  const diffQty = Math.abs(ledgerQty - productQty);
  const diffRev = Math.abs(ledgerRevenue - productRevenue);
  const diffSkuQty = Math.abs(ledgerQty - skuQty);
  const diffSkuRev = Math.abs(ledgerRevenue - skuRevenue);

  const passed = diffQty === 0 && diffRev <= 1.0;

  const resultMsg = `Ledger Qty: ${ledgerQty}, Product Qty: ${productQty}, SKU Qty: ${skuQty}. ` +
                    `Ledger Rev: Rp ${Math.round(ledgerRevenue).toLocaleString('id-ID')}, ` +
                    `Prod Rev: Rp ${Math.round(productRevenue).toLocaleString('id-ID')}, ` +
                    `SKU Rev: Rp ${Math.round(skuRevenue).toLocaleString('id-ID')}.`;

  if (options.preview) {
    return {
      status: passed ? "success" : "warning",
      message: `Preview Verifikasi: ${passed ? 'DATA KONSISTEN.' : 'ADA DISKREPANSI.'} ${resultMsg}`,
      affectedRows: products.length,
      successCount: passed ? products.length : 0,
      failedCount: passed ? 0 : products.length
    };
  }

  return {
    status: passed ? "success" : "warning",
    message: passed ? `Verifikasi Sukses: ${resultMsg}` : `Verifikasi Gagal: ${resultMsg}`,
    affectedRows: products.length,
    successCount: passed ? products.length : 0,
    failedCount: passed ? 0 : products.length
  };
}

function handleRcRepairAnalytics(options) {
  if (options.preview) {
    return {
      status: "success",
      message: "Preview: Ready to repair analytics database structure and run full cache rebuild.",
      affectedRows: 1,
      successCount: 1,
      failedCount: 0
    };
  }

  ensureAnalyticsDatabase();
  rebuildAnalytics();
  return {
    status: "success",
    message: "Eksekusi Sukses: Struktur database analitik diperbaiki dan pembangunan ulang cache selesai.",
    affectedRows: 1,
    successCount: 1,
    failedCount: 0
  };
}

