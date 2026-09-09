# ADS_REPORT SALES ZERO — READ-ONLY ROOT CAUSE AUDIT

**Audit Date:** 2026-08-24  
**Status:** IN PROGRESS - READ-ONLY MODE  
**Target Case:** 07/07/2026 - CampaignID 479360465 (ANSLA - Joia)

---

## AUDIT SCOPE

**STRICT READ-ONLY MODE:**
- ❌ NO database changes
- ❌ NO historical resync
- ❌ NO rebuildAdsReport execution
- ❌ NO deployment
- ❌ NO schema modification
- ✅ ONLY read and analyze existing data
- ✅ ONLY trace code logic
- ✅ ONLY document findings

---

## 1. EXECUTIVE SUMMARY

This audit investigates why `Ads_Report` shows `Sales = 0` for:
- **Date:** 07/07/2026
- **CampaignID:** 479360465
- **Campaign Name:** ANSLA - Joia - Long Outer Wanita
- **Ad Type:** Individual

**Critical Note:**
The previously assumed fix value of "Rp145.500" will NOT be accepted without raw API evidence. This audit will determine the correct value based on:
1. Raw Shopee API response
2. Campaign attribution
3. Seller Center verification
4. Code path analysis

---

## 2. TARGET CASE DETAILS

### Database Evidence (Ads_Report):
```
Date: 07/07/2026
CampaignID: 479360465
Campaign: ANSLA - Joia - Long Outer Wanita
Jenis: Individual
Spend: Rp59.028
Sales: Rp0 ❌ (ISSUE)
Orders: 0
```

### Seller Center Evidence (Provided):
```
Date: 07/07/2026

Joia Individual:
- Sales: Rp0
- Orders: 0
- Produk Terjual: 0

Automatic Ads:
- Sales: Rp4.134.800
- Spend: Rp311.248

Total Iklan Produk:
- Impressions: 16k
- Clicks: 804
- Orders: 7
- Sold Qty: 11
- Sales: Rp4.134.800
- Spend: Rp370.275
```

**CRITICAL OBSERVATION:**
Seller Center shows Joia Individual = Rp0, NOT Rp145.500. This contradicts previous assumptions.

---

## 3. DATA PIPELINE TRACE PLAN

### Layer-by-Layer Analysis:

```
Layer 1: Raw Shopee API Response
         ↓ (API endpoint: /api/v2/ads/get_product_campaign_daily_performance)
Layer 2: Parser (syncAdsProductDaily function)
         ↓ (Extract broad_gmv, direct_order, etc.)
Layer 3: Mapper (reconcileAndAdjustProductRows)
         ↓ (Normalize and map fields)
Layer 4: Validation (isValidCampaignId, column shift detection)
         ↓ (Accept or reject rows)
Layer 5: Ads_Product_Daily (UPSERT)
         ↓ (Write to database)
Layer 6: rebuildAdsReport (Read from Ads_Product_Daily)
         ↓ (Build dailyPerfMap)
Layer 7: Ads_Report (Write final report)
         ↓
Layer 8: Backend API
         ↓
Layer 9: Frontend Display
```

---

## 4. CODE ANALYSIS - SYNC PIPELINE

### 4.1. API Fetch (AdsEngine.gs Line 344-348)

**Code:**
```javascript
var res = shopeeGet("/api/v2/ads/get_product_campaign_daily_performance", {
  campaign_id_list: campaignIdListStr,
  start_date: startDateStr,
  end_date: endDateStr
});
```

**Question:** What does raw API return for CampaignID 479360465 on 07/07/2026?

**Need to verify:**
- `p.broad_gmv` value
- `p.direct_order` value
- `p.broad_order` value
- `p.expense` value
- `p.impression` value
- `p.clicks` value

**Expected API Response Structure:**
```json
{
  "response": {
    "campaign_list": [
      {
        "campaign_id": "479360465",
        "metrics_list": [
          {
            "date": "07-07-2026",
            "expense": 59028,
            "broad_gmv": ?,
            "direct_order": ?,
            "broad_order": ?,
            "broad_item_sold": ?,
            "clicks": ?,
            "impression": ?
          }
        ]
      }
    ]
  }
}
```

---

### 4.2. Parser (AdsEngine.gs Line 356-360)

**Code:**
```javascript
metrics.forEach(function(p) {
  var spend = parseFloat(p.expense) || 0;
  var sales = parseFloat(p.broad_gmv) || 0;
  var orders = parseInt(p.direct_order !== undefined ? p.direct_order : (p.broad_order !== undefined ? p.broad_order : 0)) || 0;
  var soldQty = parseInt(p.broad_order_amount !== undefined ? p.broad_order_amount : (p.broad_item_sold !== undefined ? p.broad_item_sold : (p.direct_item_sold !== undefined ? p.direct_item_sold : (p.direct_order_amount !== undefined ? p.direct_order_amount : 0)))) || 0;
```

**Analysis:**
- `sales` extracted from `p.broad_gmv`
- Falls back to `0` if `p.broad_gmv` is undefined/null

**Critical Question:**
Did API return `broad_gmv = 0` OR was `broad_gmv` field missing?

---

### 4.3. Validation (AdsEngine.gs Line 373-381)

**Code:**
```javascript
// VALIDATION & ANOMALY CHECKS
if (!isValidCampaignId(cId)) {
  Logger.log("[syncAdsProductDaily VALIDATION] Skipped invalid campaign_id='" + cId + "' on date " + (p.date || endDateStr));
  return;
}
if (spend > 0 && Math.round(spend) === parseInt(cId)) {
  Logger.log("[syncAdsProductDaily ANOMALY] Column shift detected: cId='" + cId + "' == spend=" + spend + ". Row REJECTED.");
  return;
}
```

**Analysis for CampaignID 479360465:**
- `isValidCampaignId("479360465")` → **TRUE** (9 digits, numeric)
- Column shift check: `59028 === 479360465` → **FALSE**
- **Result:** Row should PASS validation ✅

---

### 4.4. Build productRows Array (AdsEngine.gs Line 383-394)

**Code:**
```javascript
productRows.push([
  p.date || endDateStr,      // 0: Date
  cId,                        // 1: CampaignID = "479360465"
  cInfo.name,                 // 2: CampaignName
  jenisIklan,                 // 3: JenisIklan = "Individual"
  cInfo.itemId,               // 4: ItemID
  cInfo.name,                 // 5: NamaProduk
  "ongoing",                  // 6: StatusCampaign
  impressions, clicks, ctr,   // 7-9
  spend, sales, orders, soldQty, // 10-13: sales at index 11
  roas, cpc, acos, cpm        // 14-17
]);
```

**Analysis:**
- `sales` value (from `p.broad_gmv`) placed at index 11
- If `p.broad_gmv = 0`, then `sales = 0` at index 11

---

### 4.5. reconcileAndAdjustProductRows (AdsEngine.gs Line 2352-2416)

**Code:**
```javascript
productRows.forEach(function(row) {
  var cId = cleanText(row[1]);
  if (cId === "SHOP_TOTAL" || cId === "Total Toko") return; // Skip
  
  var spend = parseFloat(row[10]) || 0;
  var sales = parseFloat(row[11]) || 0; // Read from index 11
  var orders = parseInt(row[12]) || 0;
  var soldQty = parseInt(row[13]) || 0;
  
  // ... build normRow with same sales value
  var normRow = [
    isoDate,        // 0
    cId,            // 1
    campaignName,   // 2
    row[3] || "Individual", // 3
    row[4] || "",   // 4
    productName,    // 5
    row[6] || "ongoing", // 6
    impressions,    // 7
    clicks,         // 8
    ctr,            // 9
    spend,          // 10
    sales,          // 11 ← Same value from row[11]
    orders,         // 12
    soldQty,        // 13
    roas, cpc, acos, cpm // 14-17
  ];
  
  cleanRows.push(normRow);
});
```

**Analysis:**
- CampaignID "479360465" ≠ "SHOP_TOTAL" → NOT skipped ✅
- `sales` value passed through unchanged
- If input `sales = 0`, output `sales = 0`

---

### 4.6. UPSERT to Ads_Product_Daily (AdsEngine.gs Line 431)

**Code:**
```javascript
upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, ADS_PRODUCT_DAILY_HEADERS, productRows, [0, 1, 4], -1, "#0F766E");
```

**Primary Key:** `[ReportDate, CampaignID, ItemID]`

**Analysis:**
- If row with same key exists → UPDATE
- If row doesn't exist → INSERT
- **Critical:** If new sync has `sales = 0` from API, it will OVERWRITE previous value

---

### 4.7. rebuildAdsReport (AdsEngine.gs Line 1208-1233)

**Code:**
```javascript
dailyObjects.forEach(function(d) {
  var cId = cleanText(getPropCaseInsensitive(d, "CampaignID"));
  
  if (!isValidCampaignId(cId)) return; // Skip invalid
  
  var perfKey = reportDate + "|" + cId;
  if (!dailyPerfMap[perfKey]) {
    dailyPerfMap[perfKey] = {
      spend: cleanNumericValue(getPropCaseInsensitive(d, "Spend")),
      sales: cleanNumericValue(getPropCaseInsensitive(d, "Sales")),
      orders: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Orders"))) || 0,
      soldQty: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "SoldQty"))) || 0,
      clicks: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Clicks"))) || 0,
      impressions: parseInt(cleanNumericValue(getPropCaseInsensitive(d, "Impressions"))) || 0,
      itemId: cleanText(getPropCaseInsensitive(d, "ItemID"))
    };
  }
});
```

**Analysis for CampaignID 479360465:**
- `isValidCampaignId("479360465")` → **TRUE** ✅
- Row NOT skipped
- `sales` read from Ads_Product_Daily via `getPropCaseInsensitive(d, "Sales")`
- If Ads_Product_Daily has `Sales = 0`, then `dailyPerfMap` has `sales: 0`

---

### 4.8. Build Ads_Report Rows (AdsEngine.gs Line 1286-1324)

**Code:**
```javascript
masterCampaignList.forEach(function(c) {
  var perfKey = reportDate + "|" + c.cId;
  var perf = dailyPerfMap[perfKey] || {
    spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0, itemId: c.itemId
  };
  
  var spend = Math.round(perf.spend);
  var sales = normalizeAdsSalesToHundred(perf.sales); // ← Normalize to Rp100
  var orders = perf.orders;
  var soldQty = perf.soldQty;
  
  reportRows.push([
    reportDate,
    c.cId,
    c.cName,
    "Individual",
    perf.itemId || c.itemId || "",
    c.cName,
    c.status,
    impressions, clicks, ctr,
    spend, sales, orders, soldQty,
    roas, cpc, acos, cpm
  ]);
});
```

**Analysis:**
- If `dailyPerfMap[perfKey]` exists with `sales: 0` → `sales = 0`
- If `dailyPerfMap[perfKey]` doesn't exist → fallback `sales: 0`
- `normalizeAdsSalesToHundred(0)` → **0**

---

## 5. FIRST POINT OF DIVERGENCE HYPOTHESIS

### Scenario A: API Returns broad_gmv = 0
```
Layer 1: Raw API → broad_gmv = 0
Layer 2: Parser → sales = 0 (from broad_gmv)
Layer 3: Mapper → sales = 0 (passthrough)
Layer 4: Validation → PASS ✅
Layer 5: Ads_Product_Daily → Sales = 0 (written)
Layer 6: rebuildAdsReport → sales = 0 (read)
Layer 7: Ads_Report → Sales = 0 (written)
```

**First Point of Divergence:** **RAW API** (Layer 1)

---

### Scenario B: API Missing broad_gmv Field
```
Layer 1: Raw API → broad_gmv = undefined
Layer 2: Parser → sales = 0 (fallback)
Layer 3: Mapper → sales = 0 (passthrough)
Layer 4: Validation → PASS ✅
Layer 5: Ads_Product_Daily → Sales = 0 (written)
Layer 6: rebuildAdsReport → sales = 0 (read)
Layer 7: Ads_Report → Sales = 0 (written)
```

**First Point of Divergence:** **RAW API** (Layer 1) - field missing

---

### Scenario C: Validation Rejected in Previous Sync
```
Previous Sync:
Layer 1: Raw API → broad_gmv = 145485 ✅
Layer 2: Parser → sales = 145485 ✅
Layer 3: Mapper → sales = 145485 ✅
Layer 4: Validation → REJECT ❌ (reason unknown)
Layer 5: Ads_Product_Daily → NOT UPDATED (old Sales = 0 remains)

Current Sync:
Layer 1: Raw API → broad_gmv = 0
Layer 2-7: sales = 0 propagates
```

**First Point of Divergence:** **VALIDATION** (Layer 4) in previous sync

---

## 6. REMAINDER LOGIC AUDIT

### Location: AdsEngine.gs Line 1336-1342

**Code:**
```javascript
// Automatic Ads calculation
var st = summaryMap[reportDate];
if (st) {
  var otoSpend = autoPerf ? autoPerf.spend : Math.round(Math.max(0, st.spend - sumIndSpend));
  var otoSales = autoPerf ? normalizeAdsSalesToHundred(autoPerf.sales) : 0; // ← NOT USING REMAINDER
  var otoOrders = autoPerf ? autoPerf.orders : 0;
  var otoSoldQty = autoPerf ? autoPerf.soldQty : 0;
  var otoClicks = autoPerf ? autoPerf.clicks : Math.max(0, st.clicks - sumIndClicks);
  var otoImpressions = autoPerf ? autoPerf.impressions : Math.max(0, st.impressions - sumIndImpressions);
```

**Analysis:**
- **Automatic Sales:** Uses `autoPerf.sales` if available, otherwise **0** (NOT remainder)
- **Automatic Spend:** Uses remainder `st.spend - sumIndSpend` if autoPerf not available
- **Automatic Orders:** Uses `autoPerf.orders` if available, otherwise **0** (NOT remainder)

**Conclusion:**
- ✅ Code does NOT use remainder for Automatic Sales/Orders
- ✅ This is CORRECT behavior (as per previous fix requirements)
- ❌ Remainder is NOT the cause of Joia Individual showing Sales = 0

---

## 7. SELLER CENTER vs API MISMATCH ANALYSIS

### Seller Center Data (07/07/2026):
```
Joia Individual:
  Sales: Rp0
  Orders: 0

Automatic Ads:
  Sales: Rp4.134.800
  Spend: Rp311.248

Total:
  Sales: Rp4.134.800
  Spend: Rp370.275
```

### Calculation Check:
```
Total Spend (370.275) = Joia Spend (59.028) + Automatic Spend (311.248) ✅
Total Sales (4.134.800) = Joia Sales (0) + Automatic Sales (4.134.800) ✅
```

**CRITICAL FINDING:**
Seller Center confirms Joia Individual = **Rp0**, NOT Rp145.500.

**Question:** Where did "Rp145.500" come from in previous analysis?

---

## 8. PREVIOUS ASSUMPTION ERROR

### Previous Claim:
```
"API menunjukkan Joia Sales = Rp145.485"
```

### Evidence Required:
1. Raw API response showing `broad_gmv = 145485` for CampaignID 479360465
2. Attribution proof that 145485 belongs to Joia Individual
3. Explanation why Seller Center shows 0 but API shows 145485

### Possible Source of 145485:
Looking at code Line 358:
```javascript
var sales = parseFloat(p.broad_gmv) || 0;
```

Could this be from:
- Different campaign?
- Different date?
- Shop total?
- Automatic Ads attributed incorrectly?

**Need to verify actual API response log for 07/07/2026.**

---

## 9. HISTORICAL ANOMALY SCAN (Pending)

**Required Actions:**
1. Read all rows from Ads_Product_Daily
2. Read all rows from Ads_Report
3. Filter rows where `Spend > 0 AND Sales = 0`
4. Cross-reference with Ads_Daily_Summary
5. Identify pattern

**Cannot execute without access to actual database.**

---

## 10. DATABASE SCHEMA FINGERPRINT

### Ads_Product_Daily Expected Schema:
```
Columns (18):
1. ReportDate
2. CampaignID
3. CampaignName
4. JenisIklan
5. ItemID
6. NamaProduk
7. StatusCampaign
8. Impressions
9. Clicks
10. CTR
11. Spend
12. Sales
13. Orders
14. SoldQty
15. ROAS
16. CPC
17. ACOS
18. CPM
```

### Ads_Report Expected Schema:
```
Columns (18): Same as Ads_Product_Daily
```

**Verification Required:**
- Count actual columns in spreadsheet
- Verify header names match exactly
- Verify column order unchanged

---

## 11. CRITICAL QUESTIONS REQUIRING ANSWERS

### Q1: What is the RAW API Response?
```
Endpoint: /api/v2/ads/get_product_campaign_daily_performance
Params: {
  campaign_id_list: "479360465",
  start_date: "07-07-2026",
  end_date: "07-07-2026"
}

Response: ?
```

**Need actual API response JSON.**

---

### Q2: What is in Ads_Product_Daily?
```
Date: 2026-07-07 (or 07/07/2026)
CampaignID: 479360465
Sales: ?
Orders: ?
Spend: ?
```

**Need actual database row.**

---

### Q3: Was there a previous sync that wrote Sales = 0?
```
Check sync logs for dates:
- 07/07/2026
- 08/07/2026
- 09/07/2026
```

**Need execution log history.**

---

### Q4: Why does Seller Center show 0?
```
Possible reasons:
1. Joia campaign genuinely had no attributed sales on 07/07/2026
2. Sales attributed to Automatic Ads instead
3. Sales attributed to different campaign
4. Attribution delay in Seller Center
```

**Need Shopee attribution documentation.**

---

## 12. INTERIM CONCLUSION (Before API Evidence)

### Based on Code Analysis:

**CampaignID 479360465 validation:** ✅ PASSES (numeric 9 digits)

**Data flow:** If API returns `broad_gmv = 0`, then Sales = 0 throughout pipeline

**No code bug found in:**
- Parser (correctly reads `p.broad_gmv`)
- Mapper (correctly passes through `sales`)
- Validation (correctly accepts numeric CampaignID)
- UPSERT (correctly writes to database)
- rebuildAdsReport (correctly reads from database)

**Remainder logic:** ✅ CORRECT (does NOT use remainder for Automatic Sales)

### Two Possibilities:

**Possibility 1: API RETURNS CORRECT DATA (broad_gmv = 0)**
- Shopee API correctly reports Joia had no attributed sales
- Seller Center confirms: Joia Sales = 0
- Database correctly stores: Sales = 0
- Ads_Report correctly shows: Sales = 0
- **Result:** NO BUG, data is correct

**Possibility 2: API ATTRIBUTION ERROR**
- Shopee API incorrectly attributes Joia sales to Automatic Ads
- API returns `broad_gmv = 0` for Joia (wrong)
- API returns `broad_gmv = 4134800` for Automatic (includes Joia sales)
- Database correctly stores what API provides
- **Result:** BUG is in SHOPEE API ATTRIBUTION, not our code

---

## 13. NEXT STEPS (READ-ONLY)

### Required Evidence:

1. ✅ **Raw API response** for CampaignID 479360465 on 07/07/2026
   - Method: Check sync execution logs
   - Or: Re-fetch API (read-only, no database write)

2. ✅ **Actual Ads_Product_Daily row** for 07/07/2026
   - Method: Read spreadsheet directly
   - Verify: Date, CampaignID, Sales, Orders

3. ✅ **Actual Ads_Report row** for 07/07/2026
   - Method: Read spreadsheet directly
   - Verify: Date, CampaignID, Sales, Orders

4. ✅ **Sync execution logs** for 07/07/2026
   - Check for validation warnings
   - Check for API errors
   - Check for UPSERT results

5. ✅ **Shopee Seller Center screenshot** for 07/07/2026
   - Already provided: Joia = 0, Automatic = 4.134.800

---

## 14. AUDIT STATUS

**Status:** PENDING API EVIDENCE

**Cannot proceed without:**
- Raw API response verification
- Actual database content verification
- Execution log verification

**Recommendation:**
Execute READ-ONLY data fetch to capture evidence before making any conclusions.

---

**Audit Prepared By:** AI Code Audit System  
**Date:** 2026-08-24 04:43 UTC  
**Next Action:** AWAIT APPROVAL TO FETCH READ-ONLY API DATA

---

