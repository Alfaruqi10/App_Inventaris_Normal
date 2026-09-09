# Architecture Enhancements: Ads Data Pipeline

**Version:** 2.0  
**Date:** 2026-08-05  
**Status:** Proposed Enhancements

---

## Executive Summary

This document outlines 4 critical architectural enhancements to transform the Ads Data Pipeline from a manual, reactive system to an **automated, self-healing, and continuously validated** architecture.

### Current State (v1.0)
- ❌ Manual backfill trigger required when gaps exist
- ❌ No automatic detection of missing data
- ❌ Multiple sources of truth (API → Ads_Product_Daily → Ads_Daily_Summary)
- ❌ No automated validation after aggregation
- ❌ No monitoring of date coverage completeness

### Target State (v2.0)
- ✅ **Auto Historical Backfill** - Self-healing when gaps detected
- ✅ **Single Source of Truth** - Ads_Product_Daily as SSOT
- ✅ **Checksum Validation** - Automated verification after every rebuild
- ✅ **Coverage Validation** - Continuous monitoring with alerting

---

## Enhancement 1: Auto Historical Backfill

### Problem Statement
Current system requires **manual intervention** to detect and fill historical data gaps. Users must:
1. Notice data is missing (reactive)
2. Calculate the missing date range manually
3. Trigger backfill via Apps Script or API call

**Impact:** Data gaps can persist for days/weeks before detection.

### Proposed Solution

**Auto-detect and auto-fill** missing date ranges during system initialization and regular sync operations.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│  ensureAdsDatabase() - System Initialization        │
└──────────────────────────────────────────────────────┘
                       ↓
         ┌─────────────────────────┐
         │  Gap Detection Engine   │
         └─────────────────────────┘

                       ↓
         ┌─────────────────────────┐
         │   Check Conditions:     │
         │   1. Sheet empty?       │
         │   2. Earliest > target? │
         │   3. Gaps detected?     │
         └─────────────────────────┘
                       ↓
              Yes ───────→ Trigger Auto Backfill
                       ↓
         ┌─────────────────────────┐
         │  syncAdsHistoricalRange │
         │  (startDate, endDate)   │
         └─────────────────────────┘
                       ↓
         ┌─────────────────────────┐
         │   Write to SSOT         │
         │   (Ads_Product_Daily)   │
         └─────────────────────────┘
```

### Implementation Components

#### 1.1 Gap Detection Function

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**New Function:** `detectAndFillAdsGaps()`

```javascript
function detectAndFillAdsGaps() {
  // Throttle: Check max once per hour
  var lastCheck = PropertiesService.getScriptProperties().getProperty("LAST_GAP_CHECK");
  if (lastCheck && (Date.now() - parseInt(lastCheck)) < 3600000) {
    return { status: "skipped", reason: "Checked within last hour" };
  }
  
  var rows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  
  // Case 1: Empty sheet
  if (rows.length === 0) {
    Logger.log("[Auto Backfill] Ads_Product_Daily is EMPTY - triggering full historical sync");
    syncAdsHistoricalRange("01-06-2026", formatAdsDateDDMMYYYY(new Date()));
    PropertiesService.getScriptProperties().setProperty("LAST_GAP_CHECK", Date.now().toString());
    return { status: "success", reason: "Empty database", action: "Full backfill" };
  }
  
  // Case 2: Earliest date check
  var dates = rows.map(r => parseAdsDateToISO(r["Date"])).filter(Boolean).sort();

  var earliest = dates[0];
  var latest = dates[dates.length - 1];
  
  var TARGET_START = "2026-06-01";
  if (earliest > TARGET_START) {
    Logger.log("[Auto Backfill] Earliest date " + earliest + " > target " + TARGET_START);
    syncAdsHistoricalRange("01-06-2026", formatAdsDateDDMMYYYY(new Date(earliest)));
    PropertiesService.getScriptProperties().setProperty("LAST_GAP_CHECK", Date.now().toString());
    return { status: "success", reason: "Earliest date validation", filledRange: TARGET_START + " to " + earliest };
  }
  
  // Case 3: Gap detection (missing dates between earliest and latest)
  var gaps = findDateGaps(dates, earliest, latest);
  if (gaps.length > 0) {
    Logger.log("[Auto Backfill] Found " + gaps.length + " gap(s): " + JSON.stringify(gaps));
    // Auto-fill only if total missing days < 30 (avoid huge backfill on detection)
    var totalMissingDays = gaps.reduce((sum, g) => sum + g.missingDays, 0);
    if (totalMissingDays <= 30) {
      gaps.forEach(gap => {
        syncAdsHistoricalRange(gap.startDate, gap.endDate);
      });
      return { status: "success", reason: "Gap auto-fill", gaps: gaps };
    } else {
      return { status: "warning", reason: "Large gap detected (" + totalMissingDays + " days) - manual review recommended", gaps: gaps };
    }
  }
  
  PropertiesService.getScriptProperties().setProperty("LAST_GAP_CHECK", Date.now().toString());
  return { status: "ok", reason: "No gaps detected" };
}
```

#### 1.2 Integration Point

**Modify:** `ensureAdsDatabase()` to call gap detection

```javascript
function ensureAdsDatabase() {
  // ... existing sheet creation code ...
  
  // Auto gap detection and backfill
  try {
    var gapResult = detectAndFillAdsGaps();
    Logger.log("[ensureAdsDatabase] Gap detection result: " + JSON.stringify(gapResult));
  } catch (e) {
    Logger.log("[ensureAdsDatabase] Gap detection failed (non-fatal): " + e.toString());
  }
}
```

### Benefits

1. ✅ **Self-Healing** - Gaps automatically filled without manual intervention
2. ✅ **Proactive** - Detects issues during initialization, not after user complaint
3. ✅ **Throttled** - Max once per hour to avoid excessive API calls

4. ✅ **Safe** - Large gaps (>30 days) trigger warning instead of auto-fill
5. ✅ **Logged** - All auto-backfill actions logged for audit

---

## Enhancement 2: Single Source of Truth (SSOT) Architecture

### Problem Statement

Current architecture has **multiple sources** for aggregated data:
1. API → Ads_Product_Daily (per-campaign detail)
2. API → Ads_Daily_Summary (shop-level aggregation)
3. Ads_Product_Daily → Ads_Report (materialized view)

**Issues:**
- Ads_Daily_Summary can diverge from Ads_Product_Daily if rebuilt from API instead of SSOT
- No clear authoritative source when discrepancies occur
- Rebuild logic inconsistent (sometimes from API, sometimes from sheet)

### Proposed Solution

**Establish Ads_Product_Daily as the Single Source of Truth (SSOT)**

All aggregations MUST derive from Ads_Product_Daily:
```
Shopee API (external source)
      ↓
Ads_Product_Daily (SSOT) ← All writes happen here FIRST
      ↓                 ↓
Ads_Daily_Summary     Ads_Report (materialized views)
(shop aggregate)      (frontend view)
```

### Architecture Principles

#### 1. Write Path: API → SSOT Only

```javascript
// ✅ CORRECT: Write to SSOT first
function syncAdsHistoricalRange(startDate, endDate) {
  // Fetch from API
  var productRows = fetchFromShopeeAPI(...);
  
  // Write to SSOT
  upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, productRows);
  
  // Then rebuild aggregations FROM SSOT
  buildAndUpsertAdsDailySummary(); // Reads from Ads_Product_Daily
  rebuildAdsReport(); // Reads from Ads_Product_Daily
}

// ❌ WRONG: Write to multiple destinations
function syncAdsHistoricalRange(startDate, endDate) {
  var productRows = fetchFromShopeeAPI(...);
  var summaryRows = fetchSummaryFromAPI(...); // ← Problem: bypasses SSOT
  
  upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, productRows);
  upsertAdsDailySummaryIdempotent(ADS_DAILY_SUMMARY_SHEET, summaryRows); // ← Divergence risk
}
```

#### 2. Read Path: Always from SSOT

```javascript
// ✅ CORRECT: Rebuild from SSOT
function buildAndUpsertAdsDailySummary() {
  var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET); // ← Read from SSOT
  
  var summaryByDate = {};
  dailyObjects.forEach(d => {
    // Aggregate from SSOT
    if (!summaryByDate[d.Date]) summaryByDate[d.Date] = { spend: 0, sales: 0, ... };
    summaryByDate[d.Date].spend += d.Spend;
    summaryByDate[d.Date].sales += d.Sales;
  });
  
  upsertAdsDailySummaryIdempotent(ADS_DAILY_SUMMARY_SHEET, summaryRows);
}
```

### Implementation Changes

#### 2.1 Modify `buildAndUpsertAdsDailySummary()`

**Current:** Accepts `apiSummaryRows` parameter (bypasses SSOT)

```javascript
// BEFORE (v1.0)
function buildAndUpsertAdsDailySummary(apiSummaryRows) {
  var apiSummaryMap = {};
  apiSummaryRows.forEach(row => {
    // Use API data directly ← Problem
  });
}
```

**Proposed:** Remove API parameter, read ONLY from SSOT

```javascript
// AFTER (v2.0)
function buildAndUpsertAdsDailySummary() {
  // Read ONLY from SSOT
  var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  
  var summaryByDate = {};
  dailyObjects.forEach(d => {
    var date = parseAdsDateToISO(d["Date"]);
    if (!date) return;
    
    if (!summaryByDate[date]) {
      summaryByDate[date] = { spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0 };
    }
    
    summaryByDate[date].spend += parseFloat(d["Spend"]) || 0;
    summaryByDate[date].sales += parseFloat(d["Sales"]) || 0;
    summaryByDate[date].orders += parseInt(d["Orders"]) || 0;
    summaryByDate[date].soldQty += parseInt(d["SoldQty"]) || 0;
    summaryByDate[date].clicks += parseInt(d["Clicks"]) || 0;
    summaryByDate[date].impressions += parseInt(d["Impressions"]) || 0;
  });
  
  // Compute derived KPIs
  var summaryRows = Object.keys(summaryByDate).map(date => {
    var d = summaryByDate[date];
    return [
      date, shopId, d.spend, d.sales, d.orders, d.soldQty, d.clicks, d.impressions,
      computeCTR(d.clicks, d.impressions),
      computeCPC(d.spend, d.clicks),
      computeCPM(d.spend, d.impressions),
      computeROAS(d.sales, d.spend),
      computeACOS(d.spend, d.sales),
      getJakartaTimeString(),
      "Aggregated from SSOT"
    ];
  });
  
  upsertAdsDailySummaryIdempotent(ADS_DAILY_SUMMARY_SHEET, ADS_DAILY_SUMMARY_HEADERS, summaryRows, "#047857");
}
```

### Benefits

1. ✅ **Consistency** - Single source eliminates divergence
2. ✅ **Traceability** - All aggregations auditable back to SSOT
3. ✅ **Rebuild Safety** - Can always rebuild Ads_Daily_Summary from SSOT
4. ✅ **Data Quality** - SSOT validation ensures downstream accuracy

---

## Enhancement 3: Checksum Validation After Rebuild

### Problem Statement

Current system has NO automated validation that aggregated KPIs in `Ads_Daily_Summary` match the sum of campaigns in `Ads_Product_Daily`.

**Risks:**
- Silent data corruption during aggregation
- Incorrect ROAS/CTR calculations displayed on dashboard
- Business decisions made on wrong data

### Proposed Solution

**Automated checksum validation** after EVERY rebuild operation.

### Architecture

```
buildAndUpsertAdsDailySummary()
         ↓
   Write to Ads_Daily_Summary
         ↓
   validateAdsChecksum() ← NEW
         ↓
   ┌─ PASS → Log success
   └─ FAIL → Write to Ads_Data_Integrity + Alert
```

### Implementation

#### 3.1 Checksum Validation Function

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**New Function:** `validateAdsChecksum()`

```javascript
function validateAdsChecksum() {
  Logger.log("[Checksum Validation] Starting validation...");
  
  var dailyRows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  var summaryRows = readSheetObjects(ADS_DAILY_SUMMARY_SHEET) || [];
  
  // Build expected sums from SSOT (Ads_Product_Daily)
  var expectedByDate = {};
  dailyRows.forEach(r => {
    var date = parseAdsDateToISO(r["Date"]);
    if (!date) return;
    
    if (!expectedByDate[date]) {
      expectedByDate[date] = { spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0 };
    }
    
    expectedByDate[date].spend += parseFloat(r["Spend"]) || 0;
    expectedByDate[date].sales += parseFloat(r["Sales"]) || 0;
    expectedByDate[date].orders += parseInt(r["Orders"]) || 0;
    expectedByDate[date].soldQty += parseInt(r["SoldQty"]) || 0;
    expectedByDate[date].clicks += parseInt(r["Clicks"]) || 0;
    expectedByDate[date].impressions += parseInt(r["Impressions"]) || 0;
  });
  
  // Compare with actual values in Ads_Daily_Summary
  var discrepancies = [];
  summaryRows.forEach(s => {
    var date = parseAdsDateToISO(s["Date"]);
    if (!date || !expectedByDate[date]) return;
    
    var exp = expectedByDate[date];
    var metrics = ["Spend", "Sales", "Orders", "SoldQty", "Clicks", "Impressions"];
    
    metrics.forEach(metric => {
      var expected = exp[metric.toLowerCase()];
      var actual = parseFloat(s[metric]) || parseInt(s[metric]) || 0;
      var delta = Math.abs(expected - actual);
      var deltaPercent = expected > 0 ? (delta / expected) * 100 : 0;
      
      // Tolerance: 0.01% for rounding errors
      if (deltaPercent > 0.01) {
        discrepancies.push({
          Date: date,
          Metric: metric,
          Expected: expected,
          Actual: actual,
          Delta: delta,
          DeltaPercent: deltaPercent.toFixed(4) + "%"
        });
      }
    });
  });
  
  // Log results
  if (discrepancies.length === 0) {
    Logger.log("[Checksum Validation] ✅ PASSED - All checksums match");
    return { status: "passed", validatedDates: Object.keys(expectedByDate).length, discrepancies: 0 };
  } else {
    Logger.log("[Checksum Validation] ❌ FAILED - " + discrepancies.length + " discrepancies found");
    
    // Write to Ads_Data_Integrity sheet
    writeAdsDataIntegrityIssues(discrepancies);
    
    return { status: "failed", validatedDates: Object.keys(expectedByDate).length, discrepancies: discrepancies };
  }
}
```

#### 3.2 Integration

**Modify:** `buildAndUpsertAdsDailySummary()` to auto-validate

```javascript
function buildAndUpsertAdsDailySummary() {
  // ... existing aggregation logic ...
  
  upsertAdsDailySummaryIdempotent(ADS_DAILY_SUMMARY_SHEET, summaryRows, "#047857");
  
  // Auto checksum validation
  var checksumResult = validateAdsChecksum();
  Logger.log("[buildAndUpsertAdsDailySummary] Checksum: " + JSON.stringify(checksumResult));
  
  return checksumResult;
}
```

### Benefits

1. ✅ **Data Integrity** - Catch aggregation bugs immediately
2. ✅ **Audit Trail** - All discrepancies logged to Ads_Data_Integrity
3. ✅ **Confidence** - Dashboard KPIs guaranteed accurate
4. ✅ **Debugging** - Pinpoint exact date/metric with issues

---

## Enhancement 4: Coverage Validation and Monitoring

### Problem Statement

Current system has NO monitoring of date range completeness. Issues:
- Missing dates can persist undetected
- No visibility into "earliest date" or "latest date"
- No metric for "% coverage" of expected date range

### Proposed Solution

**Continuous coverage monitoring** with automatic alerting.

### Architecture

```
syncAdsProductDaily() / syncAdsHistoricalRange()
         ↓
   Write to Ads_Product_Daily
         ↓
   validateAdsCoverage() ← NEW
         ↓
   Calculate: earliest, latest, expected, actual, missing
         ↓
   Write to Ads_Data_Integrity
         ↓
   Expose metrics via API → Dashboard
```

### Implementation

#### 4.1 Coverage Validation Function

```javascript
function validateAdsCoverage() {
  Logger.log("[Coverage Validation] Starting...");
  
  var rows = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  if (rows.length === 0) {
    return { status: "empty", coverage: 0 };
  }
  
  var dates = rows.map(r => parseAdsDateToISO(r["Date"])).filter(Boolean).sort();
  var uniqueDates = [...new Set(dates)]; // Remove duplicates
  
  var earliest = uniqueDates[0];
  var latest = uniqueDates[uniqueDates.length - 1];
  
  // Expected days = (latest - earliest + 1)
  var earliestObj = new Date(earliest);
  var latestObj = new Date(latest);
  var expectedDays = Math.floor((latestObj - earliestObj) / (1000 * 60 * 60 * 24)) + 1;
  
  var actualDays = uniqueDates.length;
  var missingDays = expectedDays - actualDays;
  var coveragePercent = (actualDays / expectedDays) * 100;
  
  // Find missing date ranges
  var missingRanges = [];
  for (var i = 0; i < uniqueDates.length - 1; i++) {
    var currDate = new Date(uniqueDates[i]);
    var nextDate = new Date(uniqueDates[i + 1]);
    var daysDiff = (nextDate - currDate) / (1000 * 60 * 60 * 24);
    
    if (daysDiff > 1) {
      var gapStart = new Date(currDate.getTime() + 86400000); // Next day after current
      var gapEnd = new Date(nextDate.getTime() - 86400000); // Day before next
      missingRanges.push(
        Utilities.formatDate(gapStart, "Asia/Jakarta", "yyyy-MM-dd") + " to " +
        Utilities.formatDate(gapEnd, "Asia/Jakarta", "yyyy-MM-dd")
      );
    }
  }
  
  var result = {
    status: coveragePercent >= 95 ? "ok" : (coveragePercent >= 80 ? "warning" : "critical"),
    earliest: earliest,
    latest: latest,
    expectedDays: expectedDays,
    actualDays: actualDays,
    missingDays: missingDays,
    coveragePercent: coveragePercent.toFixed(2) + "%",
    missingRanges: missingRanges.join(", ")
  };
  
  // Write to Ads_Data_Integrity
  writeCoverageValidationResult(result);
  
  Logger.log("[Coverage Validation] " + JSON.stringify(result));
  return result;
}
```

#### 4.2 Dashboard Integration

**Modify:** `handleGetAdsDashboard()` to include coverage metrics

```javascript
function handleGetAdsDashboard(params) {
  // ... existing KPI calculations ...
  
  var coverage = validateAdsCoverage();
  
  return {
    status: "success",
    kpis: { ... },
    coverage: {
      earliestDate: coverage.earliest,
      latestDate: coverage.latest,
      coveragePercent: coverage.coveragePercent,
      missingDays: coverage.missingDays,
      status: coverage.status
    }
  };
}
```

### Benefits

1. ✅ **Visibility** - Dashboard shows coverage status
2. ✅ **Proactive** - Detect gaps before users complain
3. ✅ **Metrics** - "% coverage" as health indicator
4. ✅ **Alerting** - <95% triggers warning, <80% critical

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Implement `detectAndFillAdsGaps()`
- [ ] Integrate gap detection into `ensureAdsDatabase()`
- [ ] Test auto-backfill with empty database
- [ ] Test auto-backfill with gap detection

### Phase 2: SSOT Refactoring (Week 2)
- [ ] Modify `buildAndUpsertAdsDailySummary()` to remove API parameter
- [ ] Update all callers to use SSOT-only pattern
- [ ] Verify Ads_Report rebuild uses SSOT
- [ ] Add SSOT validation checks

### Phase 3: Checksum Validation (Week 3)
- [ ] Implement `validateAdsChecksum()`
- [ ] Integrate into rebuild functions
- [ ] Create Ads_Data_Integrity schema for discrepancies
- [ ] Test with known bad data

### Phase 4: Coverage Monitoring (Week 4)
- [ ] Implement `validateAdsCoverage()`
- [ ] Add coverage metrics to dashboard API
- [ ] Update frontend to display coverage status
- [ ] Create alerting for <95% coverage

---

## Testing Strategy

### Unit Tests
- [ ] `detectAndFillAdsGaps()` with empty sheet
- [ ] `detectAndFillAdsGaps()` with gaps
- [ ] `validateAdsChecksum()` with correct data
- [ ] `validateAdsChecksum()` with discrepancies
- [ ] `validateAdsCoverage()` with complete data
- [ ] `validateAdsCoverage()` with missing dates

### Integration Tests
- [ ] Full backfill → checksum → coverage pipeline
- [ ] Auto-fill triggered on `ensureAdsDatabase()`
- [ ] Dashboard displays coverage metrics
- [ ] Alerts trigger on low coverage

---

## Rollback Plan

If issues arise:
1. **Gap Detection**: Set throttle to 24 hours instead of 1 hour
2. **SSOT**: Revert to API parameter, add deprecation warning
3. **Checksum**: Make validation optional via feature flag
4. **Coverage**: Disable dashboard display, keep backend logging

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Auto-backfill success rate | >95% | N/A |
| Checksum validation pass rate | 100% | N/A |
| Coverage completeness | >98% | ~74% (50/67 days) |
| Manual interventions per month | <2 | ~5 |
| Gap detection latency | <1 hour | N/A |

---

**Document Version:** 1.0  
**Status:** Proposed  
**Review Date:** 2026-08-12  
**Approved By:** Pending

---

*End of Architecture Enhancements Document*
