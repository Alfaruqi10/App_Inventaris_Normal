# 🔍 ROOT CAUSE ANALYSIS: Ads_Report Sales = 0 Issue

**Date:** 2026-08-24  
**Issue:** Ads_Report menunjukkan `Sales = 0` untuk tanggal 07/07/2026 padahal Shopee API dan Seller Center menunjukkan nilai valid  
**Affected Date:** 07/07/2026 (dan kemungkinan tanggal lain)

---

## 📋 EXECUTIVE SUMMARY

Setelah melakukan trace lengkap data pipeline dari Shopee API → Ads_Product_Daily → Ads_Report, ditemukan bahwa:

1. ✅ **API Response VALID** - `broad_gmv` dari Shopee API diterima dengan benar
2. ✅ **Parser & Mapper CORRECT** - Data diproses dengan benar di `syncAdsProductDaily()`
3. ✅ **Data Structure INTACT** - Array index dan field mapping sudah benar
4. ⚠️ **PROBLEM IDENTIFIED** - Ada 2 kemungkinan root cause

---

## 🎯 ROOT CAUSE IDENTIFICATION

### **ROOT CAUSE #1: Historical Data Corruption (MOST LIKELY)**

**Evidence:**
- Kode saat ini sudah **BENAR** dan tidak ada bug di parser/mapper
- Data flow dari API → Ads_Product_Daily → Ads_Report sudah **CORRECT**
- Namun user melaporkan data di database menunjukkan `Sales = 0`

**Hypothesis:**
Data `Sales = 0` di `Ads_Report` adalah **CORRUPTED HISTORICAL DATA** yang ditulis oleh versi kode lama sebelum fix terbaru.

**Bukti dari Kode:**

**Line 373-381** di `syncAdsProductDaily()`:
```javascript
// VALIDATION & ANOMALY CHECKS
if (!isValidCampaignId(cId)) {
  Logger.log("[syncAdsProductDaily VALIDATION] Skipped invalid campaign_id='" + cId + "' on date " + (p.date || endDateStr));
  return; // ⚠️ Row di-SKIP, tidak ditulis
}
if (spend > 0 && Math.round(spend) === parseInt(cId)) {
  Logger.log("[syncAdsProductDaily ANOMALY] Column shift detected: cId='" + cId + "' == spend=" + spend + ". Row REJECTED.");
  return; // ⚠️ Row di-REJECT, tidak ditulis
}
```

**Implikasi:**
- Jika data lama di `Ads_Product_Daily` memiliki `Sales = 0`
- Dan kemudian API sync berikutnya **ME-REJECT** row tersebut (karena validation)
- Maka row lama dengan `Sales = 0` **TIDAK TER-UPDATE**
- `rebuildAdsReport()` membaca data lama dengan `Sales = 0`

---

### **ROOT CAUSE #2: Missing Data di Ads_Product_Daily**

**Evidence dari `rebuildAdsReport()` Line 1288-1290:**
```javascript
var perfKey = reportDate + "|" + c.cId;
var perf = dailyPerfMap[perfKey] || {
  spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0, itemId: c.itemId
};
```

**Analisis:**
- Jika `dailyPerfMap[perfKey]` **TIDAK DITEMUKAN** (karena data tidak ada di Ads_Product_Daily)
- Maka fallback ke default object dengan `sales: 0`
- Ini menyebabkan `Ads_Report` memiliki `Sales = 0`

**Mengapa data bisa tidak ada di Ads_Product_Daily?**

**Line 1216** di `rebuildAdsReport()`:
```javascript
if (!isValidCampaignId(cId)) return; // ⚠️ Row di-SKIP
```

Jika ada row di `Ads_Product_Daily` dengan:
- `CampaignID = "SHOP_TOTAL"` (legacy identifier)
- `CampaignID = "Total Toko"` (legacy identifier)
- `CampaignID = "auto"` (virtual campaign)
- `CampaignID` berupa string non-numeric

Maka row tersebut **DI-SKIP** saat build `dailyPerfMap`, tapi campaignnya tetap ada di `masterCampaignList`, sehingga:
- Campaign muncul di `Ads_Report`
- Tapi dengan `Sales = 0` (karena tidak ada di `dailyPerfMap`)

---

## 🔬 DETAILED TRACE: Data Flow Analysis

### **STEP 1: API Fetch (Line 344-348)**
```javascript
var res = shopeeGet("/api/v2/ads/get_product_campaign_daily_performance", {
  campaign_id_list: campaignIdListStr,
  start_date: startDateStr,
  end_date: endDateStr
});
```
✅ **STATUS:** API berhasil mendapatkan data dengan `broad_gmv` valid

---

### **STEP 2: Parse Response (Line 356-358)**
```javascript
metrics.forEach(function(p) {
  var spend = parseFloat(p.expense) || 0;
  var sales = parseFloat(p.broad_gmv) || 0; // ✅ VALID
```
✅ **STATUS:** Parser berhasil extract `broad_gmv` menjadi `sales`

---

### **STEP 3: Build productRows Array (Line 383-394)**
```javascript
productRows.push([
  p.date || endDateStr,      // 0
  cId,                        // 1
  cInfo.name,                 // 2
  jenisIklan,                 // 3
  cInfo.itemId,               // 4
  cInfo.name,                 // 5
  "ongoing",                  // 6
  impressions, clicks, ctr,   // 7-9
  spend, sales, orders, soldQty, // 10-13 ✅ sales di index 11
  roas, cpc, acos, cpm        // 14-17
]);
```
✅ **STATUS:** Data struktur benar, `sales` ada di index 11

---

### **STEP 4: Reconcile & Adjust (Line 430)**
```javascript
productRows = reconcileAndAdjustProductRows(productRows, overallMap, campaignMap);
```

**Function detail (Line 2352-2416):**
```javascript
function reconcileAndAdjustProductRows(productRows, overallMap, campaignMap) {
  var cleanRows = [];
  productRows.forEach(function(row) {
    // Line 2365-2366: Filter
    var cId = cleanText(row[1]);
    if (cId === "SHOP_TOTAL" || cId === "Total Toko") return; // Skip legacy
    
    // Line 2380-2383: Extract values
    var spend = parseFloat(row[10]) || 0;
    var sales = parseFloat(row[11]) || 0; // ✅ Dari index 11
    var orders = parseInt(row[12]) || 0;
    var soldQty = parseInt(row[13]) || 0;
    
    // Line 2391-2413: Build normalized row
    var normRow = [
      isoDate,                  // 0: ReportDate
      cId,                      // 1: CampaignID
      campaignName,             // 2: CampaignName
      row[3] || "Individual",   // 3: JenisIklan
      row[4] || "",             // 4: ItemID
      productName,              // 5: ProductName
      row[6] || "ongoing",      // 6: StatusCampaign
      impressions,              // 7
      clicks,                   // 8
      ctr,                      // 9
      spend,                    // 10
      sales,                    // 11 ✅ Sales masih intact
      orders,                   // 12
      soldQty,                  // 13
      roas, cpc, acos, cpm      // 14-17
    ];
    
    cleanRows.push(normRow);
  });
  return cleanRows;
}
```
✅ **STATUS:** Fungsi ini tidak merusak Sales

---

### **STEP 5: Write to Ads_Product_Daily (Line 431)**
```javascript
upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, ADS_PRODUCT_DAILY_HEADERS, productRows, [0, 1, 4], -1, "#0F766E");
```

**Primary Key:** `[Date, CampaignID, ItemID]`

✅ **STATUS:** Data ditulis dengan UPSERT (update if exists, insert if new)

**⚠️ CRITICAL POINT:**
Jika row dengan key yang sama sudah ada dengan `Sales = 0` dari sync sebelumnya, dan sync baru ini **ME-REJECT** row (karena validation failure), maka data lama `Sales = 0` **TIDAK TER-UPDATE**.

---

### **STEP 6: Rebuild Ads_Report (Line 439, 1111-1366)**

**Build dailyPerfMap dari Ads_Product_Daily (Line 1208-1233):**
```javascript
dailyObjects.forEach(function(d) {
  var cId = cleanText(getPropCaseInsensitive(d, "CampaignID"));
  
  // ⚠️ CRITICAL VALIDATION
  if (!isValidCampaignId(cId)) return; // Row di-SKIP
  
  var perfKey = reportDate + "|" + cId;
  if (!dailyPerfMap[perfKey]) {
    dailyPerfMap[perfKey] = {
      spend: cleanNumericValue(getPropCaseInsensitive(d, "Spend")),
      sales: cleanNumericValue(getPropCaseInsensitive(d, "Sales")), // ✅ Read Sales
      orders: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Orders"))) || 0,
      soldQty: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "SoldQty"))) || 0,
      clicks: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Clicks"))) || 0,
      impressions: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Impressions"))) || 0,
      itemId: cleanText(getPropCaseInsensitive(d, "ItemID"))
    };
  }
});
```

**Build reportRows (Line 1286-1324):**
```javascript
masterCampaignList.forEach(function(c) {
  var perfKey = reportDate + "|" + c.cId;
  var perf = dailyPerfMap[perfKey] || {
    // ⚠️ FALLBACK dengan Sales = 0 jika tidak ada di dailyPerfMap
    spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0, itemId: c.itemId
  };
  
  var sales = normalizeAdsSalesToHundred(perf.sales); // Normalize ke Rp100
  
  reportRows.push([
    reportDate,
    c.cId,
    c.cName,
    "Individual",
    perf.itemId || c.itemId || "",
    c.cName,
    c.status,
    impressions, clicks, ctr,
    spend, sales, orders, soldQty, // ✅ Sales ditulis
    roas, cpc, acos, cpm
  ]);
});
```

⚠️ **PROBLEM POINT:**
Jika `dailyPerfMap[perfKey]` tidak ada (karena row di-SKIP oleh validation), fallback ke `sales: 0`.

---

## 🚨 CRITICAL VALIDATION RULES

### **Validation #1: `isValidCampaignId()` (Line 1106-1109)**
```javascript
function isValidCampaignId(cId) {
  if (!cId) return false;
  return /^\d{5,}$/.test(String(cId).trim()); // Must be numeric ≥ 5 digits
}
```

**Impact:**
- Jika `CampaignID` bukan numeric 5+ digits → Row **REJECTED**
- Campaign IDs yang valid: "479360465", "98980454"
- Campaign IDs yang INVALID: "SHOP_TOTAL", "Total Toko", "auto", "1"

**⚠️ PROBLEM:**
`CampaignID = "auto"` dan `CampaignID = "1"` (Automatic Ads) akan di-reject meskipun valid!

---

### **Validation #2: Column Shift Detection (Line 378-381)**
```javascript
if (spend > 0 && Math.round(spend) === parseInt(cId)) {
  Logger.log("[syncAdsProductDaily ANOMALY] Column shift detected: cId='" + cId + "' == spend=" + spend + ". Row REJECTED.");
  return;
}
```

**Impact:**
- Jika `Spend` value sama dengan `CampaignID` → Row **REJECTED**
- Example: `CampaignID = "98980454", Spend = 98980454` → REJECTED

---

## 📊 DIAGNOSIS UNTUK 07/07/2026

Berdasarkan data yang diberikan:

**Seller Center menunjukkan:**
- Campaign: "ANSLA - Joia - Long Outer Wanita"
- CampaignID: 479360465
- Spend: Rp59.028
- Sales: **Rp145.485** (dari API `broad_gmv`)

**Ads_Report menunjukkan:**
- Campaign: "ANSLA - Joia - Long Outer Wanita"
- CampaignID: 479360465
- Spend: Rp59.028
- Sales: **Rp0** ❌

**Kemungkinan Scenario:**

### **Scenario A: Data Corruption di Ads_Product_Daily**
1. Sync lama menulis data dengan `Sales = 0` ke `Ads_Product_Daily` (bug di versi lama)
2. Sync baru fetch API dengan `Sales = 145485` (valid)
3. Tapi sync baru **REJECT** row karena validation failure
4. Data lama `Sales = 0` tidak ter-update
5. `rebuildAdsReport()` membaca `Sales = 0` dari `Ads_Product_Daily`

### **Scenario B: Missing Data di Ads_Product_Daily**
1. Data campaign tidak masuk ke `Ads_Product_Daily` (karena validation reject atau bug)
2. Campaign masih ada di `Ads_Campaign` sheet
3. `rebuildAdsReport()` membaca master dari `Ads_Campaign`
4. Tapi tidak menemukan performance data di `dailyPerfMap`
5. Fallback ke `sales: 0`

---

## ✅ SOLUTION & FIX STRATEGY

### **FIX #1: Repair Historical Data di Ads_Product_Daily**

**Action:** Re-sync data untuk 07/07/2026 dan tanggal lain yang terdampak

**Code Location:** Sudah ada fungsi `syncAdsHistoricalRange()` di Line 2105

**Execution:**
```javascript
syncAdsHistoricalRange("07-07-2026", "07-07-2026");
```

**Expected Result:**
- API akan fetch data terbaru dengan `broad_gmv` valid
- Data akan di-UPSERT ke `Ads_Product_Daily` (overwrite `Sales = 0` dengan nilai valid)
- `rebuildAdsReport()` akan membaca data yang sudah diperbaiki

---

### **FIX #2: Validate & Fix CampaignID = "auto" and "1"**

**Problem:** `isValidCampaignId()` me-reject "auto" dan "1" yang seharusnya valid untuk Automatic Ads

**Current Code (Line 1106-1109):**
```javascript
function isValidCampaignId(cId) {
  if (!cId) return false;
  return /^\d{5,}$/.test(String(cId).trim()); // ❌ Reject "auto" dan "1"
}
```

**Proposed Fix:**
```javascript
function isValidCampaignId(cId) {
  if (!cId) return false;
  var s = String(cId).trim();
  // Allow "auto" (virtual automatic campaign) and "1" (Shopee official auto ads)
  if (s === "auto" || s === "1") return true;
  // Allow numeric campaign IDs ≥ 5 digits
  return /^\d{5,}$/.test(s);
}
```

**Impact:**
- Automatic Ads data akan masuk ke `dailyPerfMap`
- `rebuildAdsReport()` akan membaca data Automatic Ads dengan benar

---

### **FIX #3: Audit Seluruh Historical Data**

**Action:** Scan `Ads_Product_Daily` dan `Ads_Report` untuk menemukan semua row dengan `Sales = 0` yang seharusnya memiliki nilai valid

**Query Plan:**
1. Read all rows dari `Ads_Product_Daily` where `Spend > 0 AND Sales = 0`
2. Check Ads_Daily_Summary untuk tanggal yang sama (apakah shop total > 0?)
3. Jika shop total > 0 tapi individual sales = 0 → Mark sebagai anomaly
4. Re-sync tanggal yang terdampak menggunakan `syncAdsHistoricalRange()`

---

## 📋 EXECUTION PLAN

### **Phase 1: Immediate Fix untuk 07/07/2026**

**Step 1:** Re-sync data 07/07/2026
```javascript
syncAdsHistoricalRange("07-07-2026", "07-07-2026");
```

**Step 2:** Verify Ads_Product_Daily
- Check row untuk CampaignID 479360465 pada 07/07/2026
- Pastikan `Sales` field memiliki nilai valid (~145485)

**Step 3:** Rebuild Ads_Report
```javascript
rebuildAdsReport();
```

**Step 4:** Verify Ads_Report
- Check row untuk CampaignID 479360465 pada 07/07/2026
- Pastikan `Sales` field bukan 0 (seharusnya ~145500 setelah normalization)

---

### **Phase 2: Fix isValidCampaignId() Validation**

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`

**Line 1106-1109:** Update function

---

### **Phase 3: Historical Data Audit**

**Step 1:** Scan anomalies
**Step 2:** Identify affected dates
**Step 3:** Batch re-sync using `syncAdsHistoricalRange()`
**Step 4:** Verify integrity using `verifyAdsDataIntegrity()`

---

## 🎯 ACCEPTANCE CRITERIA

### **Success Criteria:**

1. ✅ Ads_Product_Daily untuk 07/07/2026:
   - CampaignID 479360465 memiliki `Sales > 0` (bukan 0)

2. ✅ Ads_Report untuk 07/07/2026:
   - Campaign "ANSLA - Joia" memiliki `Sales > 0` (bukan 0)
   - Total shop sales match dengan Ads_Daily_Summary

3. ✅ Automatic Ads:
   - "Iklan Produk Otomatis" memiliki data valid (tidak menggunakan remainder lama)
   - CampaignID "auto" dan "1" dapat diproses dengan benar

4. ✅ No Regression:
   - Data tanggal lain yang sudah benar tidak berubah
   - Database schema tetap sama (tidak ada perubahan kolom/struktur)

---

## 🚨 CRITICAL NOTES

1. **JANGAN UBAH DATABASE SCHEMA** - Fix hanya di logic, bukan struktur
2. **PRESERVE EXISTING FIXES** - Jangan menghidupkan kembali remainder calculation lama
3. **IDEMPOTENT OPERATION** - Re-sync harus aman dijalankan berkali-kali
4. **AUDIT FIRST** - Lakukan forensic scan sebelum mass update

---

## 📌 CONCLUSION

**Root Cause:**  
Historical data corruption di `Ads_Product_Daily` dengan `Sales = 0` yang tidak ter-update karena validation rejection di sync berikutnya, atau data tidak masuk sama sekali karena validation rules yang terlalu ketat.

**Fix Strategy:**  
1. Re-sync data terdampak menggunakan `syncAdsHistoricalRange()`
2. Fix `isValidCampaignId()` untuk allow "auto" dan "1"
3. Audit dan rebuild historical data yang terdampak

**Impact:**  
ZERO changes pada database schema. Semua fix di application logic layer.

---

**Prepared by:** AI Code Audit System  
**Date:** 2026-08-24  
**Status:** READY FOR IMPLEMENTATION
