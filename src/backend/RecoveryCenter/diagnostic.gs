// ============================================================
// diagnostic.gs — Recovery Center: Diagnostic & Health Checks
// Orchestration layer. Reuse service yang sudah ada.
// ============================================================

/**
 * Debug Webhook — reuse diagnosisWebhook() yang sudah ada.
 */
function debugWebhook() {
  try {
    var res = diagnosisWebhook();
    return { status:'success', message:'Debug webhook selesai.', detail: res };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Check Missing Orders — bandingkan ShopeeOrders vs SalesLedger.
 * Return jumlah order di ShopeeOrders yang tidak ada di Ledger.
 */
function checkMissingOrders() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var so = ss.getSheetByName(SHOPEE_ORDERS_SHEET);
    var sl = ss.getSheetByName(SALES_LEDGER_SHEET);
    var ledgerSN = {};
    if (sl && sl.getLastRow() > 1) {
      var lr = sl.getDataRange().getValues(); var lh = lr[0]; var lc = {};
      lh.forEach(function(h,i){ lc[h]=i; });
      for (var i=1;i<lr.length;i++) ledgerSN[String(lr[i][lc['Order SN']]||'').trim()] = true;
    }
    var missing = 0, samples = [];
    if (so && so.getLastRow() > 1) {
      var rows = so.getDataRange().getValues(); var hdr = rows[0]; var ci = {};
      hdr.forEach(function(h,i){ ci[h]=i; });
      for (var j=1;j<rows.length;j++) {
        var sn = String(rows[j][ci['order_sn']]||'').trim();
        if (sn && !ledgerSN[sn]) { missing++; if (samples.length<10) samples.push(sn); }
      }
    }
    return {
      status:'success',
      message: missing === 0 ? 'Tidak ada order hilang.' : (missing + ' order hilang ditemukan.'),
      missing: missing, samples: samples
    };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Check Duplicate Orders — hitung duplikat by Order SN (tidak hapus).
 */
function checkDuplicateOrders() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var so = ss.getSheetByName(SHOPEE_ORDERS_SHEET);
    var sl = ss.getSheetByName(SALES_LEDGER_SHEET);
    var dup = 0;
    if (so && so.getLastRow() > 1) {
      var rows = so.getDataRange().getValues(); var hdr = rows[0]; var ci = {};
      hdr.forEach(function(h,i){ ci[h]=i; });
      var seen = {}; var total = 0;
      for (var i=1;i<rows.length;i++) {
        var sn = String(rows[i][ci['order_sn']]||'').trim();
        if (!sn) continue; total++;
        if (seen[sn]) dup++; else seen[sn] = true;
      }
    }
    var ledDup = 0;
    if (sl && sl.getLastRow() > 1) {
      var lr = sl.getDataRange().getValues(); var lh = lr[0]; var lc = {};
      lh.forEach(function(h,i){ lc[h]=i; });
      var seenL = {}; var totalL = 0;
      for (var j=1;j<lr.length;j++) {
        var lineKey = String(lr[j][lc['Logical Line Key']] || '').trim();
        if (!lineKey) lineKey = String(lr[j][lc['Order SN']] || '').trim() + '|' +
          String(lr[j][lc['Item ID']] || '').trim() + '|' + String(lr[j][lc['Model ID']] || '').trim();
        if (!lineKey || lineKey === '||') continue; totalL++;
        if (seenL[lineKey]) ledDup++; else seenL[lineKey] = true;
      }
    }
    return {
      status:'success',
      message: (dup+ledDup) === 0 ? 'Tidak ada duplikat.' : ('Ditemukan ' + dup + ' duplikat order, ' + ledDup + ' duplikat logical line ledger.'),
      duplicateOrders: dup, duplicateLedger: ledDup
    };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Check Settlement — hitung row COMPLETED/TO_CONFIRM_RECEIVE tanpa Escrow.
 */
function checkSettlement() {
  try {
    var all = _slReadAllRows();
    var missing = 0, samples = [];
    getSalesLedgerSettlements({ rows: all.rows, strict: false }).forEach(function(r) {
      var st = String(r['Status Shopee']||'').toUpperCase();
      var esc = r['Escrow Amount'];
      var hasEscrow = esc !== '' && esc !== 0 && esc !== null && esc !== undefined;
      if ((st === 'COMPLETED' || st === 'TO_CONFIRM_RECEIVE') && !hasEscrow) {
        missing++; if (samples.length<10) samples.push(String(r['Order SN']||''));
      }
    });
    return {
      status:'success',
      message: missing === 0 ? 'Semua settlement lengkap.' : (missing + ' settlement belum lengkap.'),
      missingSettlement: missing, samples: samples
    };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Check Mapping — hitung mapping Shopee vs produk.
 */
function checkMapping() {
  try {
    ensureDatabase();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sp = ss.getSheetByName(SHOPEE_PRODUCTS_SHEET);
    var mapped = 0, unmapped = 0;
    if (sp && sp.getLastRow() > 1) {
      var rows = sp.getDataRange().getValues(); var hdr = rows[0]; var ci = {};
      hdr.forEach(function(h,i){ ci[h]=i; });
      for (var i=1;i<rows.length;i++) {
        var m = String(rows[i][ci['status_mapping']]||'').toUpperCase();
        if (m === 'MAPPED') mapped++; else unmapped++;
      }
    }
    var pct = (mapped + unmapped) > 0 ? Math.round(mapped/(mapped+unmapped)*100) : 0;
    return {
      status:'success',
      message: 'Mapping: ' + mapped + ' mapped, ' + unmapped + ' unmapped (' + pct + '%).',
      mapped: mapped, unmapped: unmapped, percent: pct
    };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * API Health Check — cek token valid + ping Shopee endpoint.
 */
function apiHealthCheck() {
  try {
    var tokens = getShopeeTokens();
    if (!tokens.accessToken || !tokens.shopId) {
      return { status:'error', message:'Belum terotorisasi ke Shopee.', online:false };
    }
    // Panggil endpoint ringan
    var res = shopeeGet('/api/v2/shop/get_profile', {});
    var ok = !!(res && (res.response || res.error === undefined));
    return {
      status:'success',
      online: ok,
      message: ok ? 'API Shopee online. Shop ID: ' + tokens.shopId : 'API Shopee tidak merespons.',
      shopId: tokens.shopId
    };
  } catch (err) {
    return { status:'error', message: err.toString(), online:false };
  }
}

/**
 * Webhook Health Check — reuse handleGetWebhookDashboard().
 */
function webhookHealthCheck() {
  try {
    var data = handleGetWebhookDashboard();
    var online = !!(data && data.endpointOnline);
    return { status:'success', online: online, message: online ? 'Webhook active.' : 'Webhook offline.', detail: data };
  } catch (err) {
    return { status:'error', message: err.toString(), online:false };
  }
}

/**
 * Scan all sheets in the active spreadsheet to find IMPORTRANGE formulas,
 * and inspect any cells that are blocking the array expansion (e.g. at I59).
 */
function scanImportRangeDest() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var importRangeSheets = [];

    // 1. Scan all sheets for IMPORTRANGE formulas using TextFinder
    var textFinder = ss.createTextFinder("IMPORTRANGE").matchFormulaText(true);
    var findResults = textFinder.findAll();
    findResults.forEach(function(r) {
      importRangeSheets.push({
        sheetName: r.getSheet().getName(),
        cell: r.getA1Notation(),
        formula: r.getFormula(),
        row: r.getRow(),
        col: r.getColumn()
      });
    });

    var results = [];

    // If no sheet has the formula, scan all sheets' I59
    var sheetsToScan = [];
    if (importRangeSheets.length > 0) {
      sheetsToScan = importRangeSheets;
    } else {
      sheets.forEach(function(sheet) {
        sheetsToScan.push({
          sheetName: sheet.getName(),
          cell: "I59",
          row: 59,
          col: 9,
          formula: "N/A (Fallback Scan)"
        });
      });
    }

    sheetsToScan.forEach(function(target) {
      var sheet = ss.getSheetByName(target.sheetName);
      if (!sheet) return;

      var sheetInfo = {
        sheetName: target.sheetName,
        formulaCell: target.cell,
        formula: target.formula,
        obstructingCells: []
      };

      // Scan target area A1:AT500 (col 1 to 46, row 1 to 500)
      var maxRowScan = Math.min(500, Math.max(100, sheet.getLastRow()));
      var maxColScan = Math.min(46, Math.max(15, sheet.getLastColumn()));
      
      if (maxRowScan > 0 && maxColScan > 0) {
        var range = sheet.getRange(1, 1, maxRowScan, maxColScan);
        var values = range.getValues();
        var formulas = range.getFormulas();
        var notes = range.getNotes();
        var validations = range.getDataValidations();
        
        var mergedRanges = [];
        try {
          mergedRanges = range.getMergedRanges();
        } catch (e) {
          // Fallback if getMergedRanges is not supported on Range
        }

        function isCellMerged(row1, col1) {
          for (var i = 0; i < mergedRanges.length; i++) {
            var mr = mergedRanges[i];
            if (row1 >= mr.getRow() && row1 <= mr.getLastRow() && col1 >= mr.getColumn() && col1 <= mr.getLastColumn()) {
              return mr.getA1Notation();
            }
          }
          return null;
        }

        for (var r = 1; r <= maxRowScan; r++) {
          for (var c = 1; c <= maxColScan; c++) {
            var val = values[r - 1][c - 1];
            var f = formulas[r - 1][c - 1];
            var note = notes[r - 1][c - 1];
            var valRule = validations[r - 1][c - 1];
            var validation = valRule ? valRule.getCriteriaType().toString() : "";
            
            var isCheckbox = false;
            if (valRule && valRule.getCriteriaType() == SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
              isCheckbox = true;
            }

            var cellNotation = "";
            if (c <= 26) {
              cellNotation = String.fromCharCode(65 + c - 1) + r;
            } else {
              cellNotation = String.fromCharCode(65 + Math.floor((c - 1) / 26) - 1) + String.fromCharCode(65 + ((c - 1) % 26)) + r;
            }

            var mergedRange = isCellMerged(r, c);
            var isFormulaCell = (target.row === r && target.col === c);
            
            if (cellNotation === "I59" || (!isFormulaCell && (val !== "" || f !== "" || note !== "" || validation !== "" || mergedRange !== null))) {
              sheetInfo.obstructingCells.push({
                cell: cellNotation,
                value: val,
                valueType: typeof val,
                formula: f,
                merged: mergedRange ? mergedRange : "No",
                note: note,
                validation: validation,
                checkbox: isCheckbox
              });
            }
          }
        }
      }

      results.push(sheetInfo);
    });

    return {
      status: "success",
      results: results,
      foundFormulas: importRangeSheets
    };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}
