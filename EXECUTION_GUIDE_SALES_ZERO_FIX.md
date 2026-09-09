# 🚀 EXECUTION GUIDE: Sales = 0 Fix Implementation

**Date:** 2026-08-24  
**Issue:** Ads_Report menunjukkan Sales = 0 padahal API valid  
**Status:** READY FOR EXECUTION

---

## 📋 PRE-FLIGHT CHECKLIST

### ✅ Changes Made:

1. **Fixed `isValidCampaignId()` function** (AdsEngine.gs:1106-1113)
   - ✅ Now allows "auto" and "1" for Automatic Ads
   - ✅ Still validates numeric campaign IDs ≥ 5 digits
   - ✅ Rejects legacy identifiers ("SHOP_TOTAL", "Total Toko")

2. **Created `AuditSalesZero.gs` utility module**
   - ✅ `auditSalesZeroAnomalies()` - Scan all Sales=0 anomalies
   - ✅ `generateResyncPlan()` - Generate batch re-sync plan
   - ✅ `executeCompleteSalesZeroFix()` - Auto-fix all anomalies
   - ✅ `fixSalesZeroForDate()` - Quick fix for single date

3. **Root Cause Analysis Document**
   - ✅ `ADS_REPORT_SALES_ZERO_ROOT_CAUSE_ANALYSIS.md`

---

## 🎯 EXECUTION OPTIONS

### **OPTION 1: Quick Fix untuk 07/07/2026 saja**

```javascript
// Di Google Apps Script Editor atau API endpoint
fixSalesZeroForDate("07-07-2026");
```

**Hasil yang diharapkan:**
```
[fixSalesZeroForDate] Fix completed.
  Date                    : 07-07-2026
  Sync status             : success
  Ads_Report rebuilt      : 150+ rows
  Remaining anomalies     : 0
```

**Waktu eksekusi:** ~30-60 detik

---

### **OPTION 2: Audit dulu, kemudian execute selective fix**

**Step 1: Audit**
```javascript
var auditResult = auditSalesZeroAnomalies();
Logger.log(JSON.stringify(auditResult, null, 2));
```

**Step 2: Review hasil audit**
```javascript
// Lihat daftar tanggal yang terdampak
Logger.log("Affected dates: " + auditResult.affectedDates.join(", "));

// Lihat detail anomalies
auditResult.anomalies.forEach(function(a) {
  Logger.log("Date: " + a.date + " | Campaign: " + a.campaignName + " | Spend: " + a.spend + " | Sales: " + a.sales);
});
```

**Step 3: Generate re-sync plan**
```javascript
var plan = generateResyncPlan();
Logger.log("Total chunks to re-sync: " + plan.totalChunks);
plan.chunks.forEach(function(chunk, idx) {
  Logger.log("Chunk " + (idx+1) + ": " + chunk.command);
});
```

**Step 4: Execute manual re-sync per chunk**
```javascript
// Example: Re-sync chunk 1
syncAdsHistoricalRange("07-07-2026", "09-07-2026");

// Example: Re-sync chunk 2
syncAdsHistoricalRange("15-07-2026", "20-07-2026");

// Setelah semua chunk, rebuild report
rebuildAdsReport();
```

**Waktu eksekusi:** Tergantung jumlah chunk (15-30 menit untuk 30-60 hari)

---

### **OPTION 3: Full Auto-Fix (RECOMMENDED)**

```javascript
var result = executeCompleteSalesZeroFix();
Logger.log(JSON.stringify(result, null, 2));
```

**Proses yang berjalan:**
1. Audit seluruh Ads_Product_Daily
2. Identifikasi semua tanggal dengan Sales=0 anomaly
3. Generate optimal re-sync chunks
4. Execute re-sync untuk semua affected dates
5. Rebuild Ads_Report
6. Verify fix success
7. Return comprehensive report

**Hasil yang diharapkan:**
```json
{
  "status": "success",
  "message": "Complete Sales=0 fix pipeline executed successfully.",
  "totalChunks": 5,
  "totalDaysFixed": 15,
  "reportRowsRebuilt": 200,
  "remainingAnomalies": 0,
  "executionTime": "180.5s",
  "verification": {
    "totalRowsScanned": 500,
    "anomaliesFound": 0,
    "affectedDates": 0
  }
}
```

**Waktu eksekusi:** 3-10 menit (tergantung volume data)

---

## 🔧 DEPLOYMENT STEPS

### **For Google Apps Script (GAS) Backend:**

1. **Deploy Updated AdsEngine.gs**
   ```bash
   # Copy file ke GAS editor atau deploy via clasp
   clasp push
   ```

2. **Deploy AuditSalesZero.gs**
   ```bash
   # Upload new utility file
   # File: src/backend/ShopeeAds/utils/AuditSalesZero.gs
   ```

3. **Test di GAS Editor**
   ```javascript
   // Test validation fix
   Logger.log(isValidCampaignId("479360465")); // true
   Logger.log(isValidCampaignId("auto"));      // true (FIXED!)
   Logger.log(isValidCampaignId("1"));         // true (FIXED!)
   Logger.log(isValidCampaignId("SHOP_TOTAL")); // false
   
   // Test audit
   var audit = auditSalesZeroAnomalies();
   Logger.log("Anomalies found: " + audit.anomaliesFound);
   ```

4. **Execute Fix**
   ```javascript
   // Option 1: Quick fix
   fixSalesZeroForDate("07-07-2026");
   
   // OR Option 3: Full auto-fix
   executeCompleteSalesZeroFix();
   ```

---

### **For Node.js Backend Integration:**

Jika ingin menambahkan endpoint API untuk trigger fix dari frontend:

**File:** `src/node-backend/controllers/adsController.js`

```javascript
// Add new endpoint
export async function fixAdsSalesZero(req, res) {
  try {
    const params = req.body || {};
    const date = params.date; // Optional: specific date
    
    let result;
    if (date) {
      // Fix specific date
      result = await adsService.fixSalesZeroForDate(date);
    } else {
      // Fix all anomalies
      result = await adsService.executeCompleteSalesZeroFix();
    }
    
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] fixAdsSalesZero failed:', error);
    return sendErrorResponse(res, 'Gagal memperbaiki Sales=0 anomaly.', error);
  }
}

// Add audit endpoint
export async function auditAdsSalesZero(req, res) {
  try {
    const result = await adsService.auditSalesZeroAnomalies();
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] auditAdsSalesZero failed:', error);
    return sendErrorResponse(res, 'Gagal audit Sales=0 anomaly.', error);
  }
}
```

**File:** `src/node-backend/services/adsService.js`

```javascript
// Add methods to call GAS functions via API
async fixSalesZeroForDate(date) {
  // Call GAS API: fixSalesZeroForDate(date)
  return await this.callGasFunction('fixSalesZeroForDate', { date });
}

async executeCompleteSalesZeroFix() {
  // Call GAS API: executeCompleteSalesZeroFix()
  return await this.callGasFunction('executeCompleteSalesZeroFix', {});
}

async auditSalesZeroAnomalies() {
  // Call GAS API: auditSalesZeroAnomalies()
  return await this.callGasFunction('auditSalesZeroAnomalies', {});
}
```

---

## ✅ VERIFICATION STEPS

### **1. Verify isValidCampaignId() Fix**

```javascript
// Test cases
var testCases = [
  { input: "479360465", expected: true, desc: "Valid numeric campaign" },
  { input: "98980454", expected: true, desc: "Valid numeric campaign" },
  { input: "auto", expected: true, desc: "Virtual automatic campaign" },
  { input: "1", expected: true, desc: "Shopee official auto ads" },
  { input: "SHOP_TOTAL", expected: false, desc: "Legacy identifier" },
  { input: "Total Toko", expected: false, desc: "Legacy identifier" },
  { input: "", expected: false, desc: "Empty string" },
  { input: "12345", expected: true, desc: "5 digit numeric" },
  { input: "1234", expected: false, desc: "4 digit numeric (too short)" }
];

testCases.forEach(function(test) {
  var result = isValidCampaignId(test.input);
  var status = result === test.expected ? "✅ PASS" : "❌ FAIL";
  Logger.log(status + " | " + test.desc + " | Input: '" + test.input + "' | Result: " + result);
});
```

---

### **2. Verify Audit Function**

```javascript
var audit = auditSalesZeroAnomalies();

// Check structure
Logger.log("✅ Audit status: " + audit.status);
Logger.log("✅ Total rows scanned: " + audit.totalRowsScanned);
Logger.log("✅ Anomalies found: " + audit.anomaliesFound);
Logger.log("✅ Affected dates: " + audit.affectedDates.length);
Logger.log("✅ Affected campaigns: " + audit.affectedCampaigns.length);

// Check sample anomaly
if (audit.anomalies.length > 0) {
  var sample = audit.anomalies[0];
  Logger.log("Sample anomaly:");
  Logger.log("  Date: " + sample.date);
  Logger.log("  Campaign: " + sample.campaignName + " (" + sample.campaignId + ")");
  Logger.log("  Spend: " + sample.spend);
  Logger.log("  Sales: " + sample.sales);
  Logger.log("  Reason: " + sample.reason);
}
```

---

### **3. Verify 07/07/2026 Data After Fix**

```javascript
// Read Ads_Product_Daily
var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
var targetDate = "2026-07-07";
var targetCampaign = "479360465"; // Joia campaign

var found = dailyObjects.filter(function(d) {
  var isoDate = parseAdsDateToISO(getPropCaseInsensitive(d, "ReportDate"));
  var cId = cleanText(getPropCaseInsensitive(d, "CampaignID"));
  return isoDate === targetDate && cId === targetCampaign;
});

if (found.length > 0) {
  var row = found[0];
  Logger.log("✅ Found Joia campaign on 07/07/2026:");
  Logger.log("  Spend: " + getPropCaseInsensitive(row, "Spend"));
  Logger.log("  Sales: " + getPropCaseInsensitive(row, "Sales")); // Should be > 0
  Logger.log("  Orders: " + getPropCaseInsensitive(row, "Orders"));
  
  var sales = cleanNumericValue(getPropCaseInsensitive(row, "Sales"));
  if (sales > 0) {
    Logger.log("✅ VERIFICATION PASSED: Sales > 0");
  } else {
    Logger.log("❌ VERIFICATION FAILED: Sales still = 0");
  }
} else {
  Logger.log("❌ Campaign not found in Ads_Product_Daily");
}

// Check Ads_Report
var reportObjects = readSheetObjects(ADS_REPORT_SHEET) || [];
var foundReport = reportObjects.filter(function(r) {
  var rdRaw = r["ReportDate"] || r["Tanggal"];
  var rdIso = parseAdsDateToISO(rdRaw);
  var parts = rdIso ? rdIso.split("-") : [];
  var reportDate = parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : "";
  var cId = cleanText(r["CampaignID"]);
  return reportDate === "07/07/2026" && cId === targetCampaign;
});

if (foundReport.length > 0) {
  var rRow = foundReport[0];
  Logger.log("✅ Found Joia campaign in Ads_Report:");
  Logger.log("  Spend: " + rRow["Spend"]);
  Logger.log("  Sales: " + rRow["Sales"]); // Should be ~145500 after normalization
  Logger.log("  Orders: " + rRow["Orders"]);
  
  var rSales = parseFloat(rRow["Sales"]) || 0;
  if (rSales > 0) {
    Logger.log("✅ VERIFICATION PASSED: Ads_Report Sales > 0");
  } else {
    Logger.log("❌ VERIFICATION FAILED: Ads_Report Sales still = 0");
  }
} else {
  Logger.log("❌ Campaign not found in Ads_Report");
}
```

---

### **4. Verify Database Schema Unchanged**

```javascript
// Check Ads_Product_Daily schema
var ss = SpreadsheetApp.getActiveSpreadsheet();
var dailySheet = ss.getSheetByName(ADS_PRODUCT_DAILY_SHEET);
var headers = dailySheet.getRange(1, 1, 1, dailySheet.getLastColumn()).getValues()[0];

var expectedHeaders = [
  "ReportDate", "CampaignID", "CampaignName", "JenisIklan", "ItemID", "NamaProduk",
  "StatusCampaign", "Impressions", "Clicks", "CTR", "Spend", "Sales", "Orders", "SoldQty",
  "ROAS", "CPC", "ACOS", "CPM"
];

var schemaValid = true;
if (headers.length !== expectedHeaders.length) {
  Logger.log("❌ SCHEMA CHANGED: Column count mismatch");
  schemaValid = false;
} else {
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (headers[i] !== expectedHeaders[i]) {
      Logger.log("❌ SCHEMA CHANGED: Column " + i + " expected '" + expectedHeaders[i] + "' but got '" + headers[i] + "'");
      schemaValid = false;
    }
  }
}

if (schemaValid) {
  Logger.log("✅ VERIFICATION PASSED: Database schema unchanged");
} else {
  Logger.log("❌ VERIFICATION FAILED: Database schema has been modified");
}
```

---

## 📊 EXPECTED RESULTS

### **Before Fix:**
```
Ads_Product_Daily:
  07/07/2026 | 479360465 | ANSLA - Joia | Spend: 59028 | Sales: 0 ❌

Ads_Report:
  07/07/2026 | 479360465 | ANSLA - Joia | Spend: 59028 | Sales: 0 ❌
```

### **After Fix:**
```
Ads_Product_Daily:
  2026-07-07 | 479360465 | ANSLA - Joia | Spend: 59028 | Sales: 145485 ✅

Ads_Report:
  07/07/2026 | 479360465 | ANSLA - Joia | Spend: 59028 | Sales: 145500 ✅
  (normalized to nearest Rp100)
```

---

## 🚨 ROLLBACK PLAN

Jika terjadi error atau hasil tidak sesuai:

### **1. Restore dari Backup**
```javascript
// Backup sheets dibuat otomatis oleh backupAdsSheetsWithTimestamp()
// Format: "Ads_Product_Daily_Backup_20260824_103045"

// Manual restore:
var ss = SpreadsheetApp.getActiveSpreadsheet();
var backupSheet = ss.getSheetByName("Ads_Product_Daily_Backup_20260824_103045");
var targetSheet = ss.getSheetByName(ADS_PRODUCT_DAILY_SHEET);

if (backupSheet) {
  var data = backupSheet.getDataRange().getValues();
  targetSheet.clearContents();
  targetSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  Logger.log("✅ Restored from backup");
}
```

### **2. Revert Code Changes**
```javascript
// Revert isValidCampaignId() to original version
function isValidCampaignId(cId) {
  if (!cId) return false;
  return /^\d{5,}$/.test(String(cId).trim()); // Original: reject "auto" and "1"
}
```

---

## 📞 SUPPORT & TROUBLESHOOTING

### **Common Issues:**

**Issue 1: "API rate limit exceeded"**
```
Solution: Tunggu 1-2 menit, kemudian re-run chunk yang failed.
```

**Issue 2: "Remaining anomalies > 0 after fix"**
```
Solution: 
1. Check log untuk identify tanggal yang masih bermasalah
2. Run fixSalesZeroForDate() untuk tanggal spesifik tersebut
3. Verify API response untuk tanggal tersebut (apakah memang API memberikan data valid?)
```

**Issue 3: "Sales masih 0 setelah fix"**
```
Diagnosis:
1. Check apakah API response memiliki broad_gmv field
2. Check log syncAdsProductDaily untuk validation warnings
3. Verify CampaignID valid (numeric ≥ 5 digits atau "auto"/"1")
```

---

## 🎯 FINAL CHECKLIST

Sebelum consider fix complete, pastikan:

- [ ] `isValidCampaignId()` function updated dan tested
- [ ] `AuditSalesZero.gs` deployed dan accessible
- [ ] Audit executed dan anomalies identified
- [ ] Fix executed (Option 1, 2, or 3)
- [ ] Verification passed untuk 07/07/2026
- [ ] Database schema verified unchanged
- [ ] Remaining anomalies = 0 atau explained
- [ ] Backup created dan documented
- [ ] Rollback plan tested dan ready

---

**Prepared by:** AI Code Audit System  
**Date:** 2026-08-24  
**Version:** 1.0  
**Status:** READY FOR PRODUCTION DEPLOYMENT
