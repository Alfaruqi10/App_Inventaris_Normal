# Design Document: Ads Daily Summary Historical Backfill

**Version:** 2.0  
**Date:** 2026-08-05  
**Status:** Design Phase  
**Workflow:** Requirements-First

---

## 1. Executive Summary

This design document specifies the technical architecture for the **Ads Daily Summary Historical Backfill** feature, transforming the current reactive, manual system into a **self-healing, automated, and continuously validated** data pipeline.

### Key Design Objectives

1. **Auto-Detection & Self-Healing** - Automatically detect and fill missing date ranges without manual intervention
2. **Single Source of Truth (SSOT)** - Establish Ads_Product_Daily as the authoritative data source
3. **Automated Validation** - Checksum validation after every rebuild to guarantee aggregation accuracy
4. **Continuous Monitoring** - Coverage validation with dashboard visibility and alerting

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Manual Trigger│  │Progress Track│  │Coverage Badge│     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ↓ AJAX
┌─────────────────────────────────────────────────────────────┐
│              Backend (Google Apps Script)                   │
│                                                             │
│  ┌──────────────────────────────────────────────────┐     │
│  │  AdsAPI.gs - handleRunHistoricalAdsSync()        │     │
│  └──────────────────────────────────────────────────┘     │
│                            ↓                                │
│  ┌──────────────────────────────────────────────────┐     │
│  │  AdsEngine.gs - Core Processing                  │     │
│  │  • detectAndFillAdsGaps()                        │     │
│  │  • syncAdsHistoricalRange()                      │     │
│  │  • buildAndUpsertAdsDailySummary()              │     │
│  │  • validateAdsChecksum()                        │     │
│  │  • validateAdsCoverage()                        │     │
│  └──────────────────────────────────────────────────┘     │
│                            ↓                                │
│  ┌──────────────────────────────────────────────────┐     │
│  │  AdsDatabase.gs - ensureAdsDatabase()            │     │
│  │  • Auto-triggers gap detection on init           │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│             External Services                               │
│  ┌──────────────┐              ┌──────────────┐           │
│  │ Shopee API   │              │Google Sheets │           │
│  │ v2.0         │              │ Database     │           │
│  └──────────────┘              └──────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
Shopee API (External Source)
      ↓
[Ads_Product_Daily] ← SSOT (Single Source of Truth)
      ↓           ↓
      ↓           └──> [Ads_Report] (Materialized View)
      ↓
[Ads_Daily_Summary] (Shop-Level Aggregation)
      ↓
[Ads_Data_Integrity] (Validation Results)
      ↓
Dashboard (Coverage Metrics + KPIs)
```

---

## 2. Data Models

### 2.1 Ads_Product_Daily (SSOT)

**Purpose:** Single Source of Truth for all Ads data  
**Primary Key:** Date + ShopID + CampaignID + ItemID

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| Date | String (DD-MM-YYYY) | Campaign performance date | Shopee API |
| ShopID | String | Shop identifier | Shopee API |
| CampaignID | String | Campaign identifier | Shopee API |
| ItemID | String | Product/item identifier | Shopee API |
| ProductName | String | Product name | Shopee API |
| Spend | Number | Daily ad spend (IDR) | Shopee API |
| Sales | Number | Daily sales revenue (IDR) | Shopee API |
| Orders | Integer | Number of orders | Shopee API |
| SoldQty | Integer | Units sold | Shopee API |
| Clicks | Integer | Ad clicks | Shopee API |
| Impressions | Integer | Ad impressions | Shopee API |
| CTR | Number | Click-through rate (%) | Computed |
| CPC | Number | Cost per click (IDR) | Computed |
| ROAS | Number | Return on ad spend | Computed |
| CPM | Number | Cost per thousand impressions | Computed |
| ACOS | Number | Advertising cost of sales (%) | Computed |
| SyncTime | String (ISO) | Last sync timestamp | System |
| Source | String | Data source identifier | System |

**UPSERT Logic:** Composite key (Date + ShopID + CampaignID + ItemID)

### 2.2 Ads_Daily_Summary (Aggregation)

**Purpose:** Shop-level daily aggregation (materialized view)  
**Primary Key:** Date + ShopID

| Column | Type | Description | Derivation |
|--------|------|-------------|------------|
| Date | String (DD-MM-YYYY) | Summary date | From Ads_Product_Daily |
| ShopID | String | Shop identifier | From Ads_Product_Daily |
| Spend | Number | Total daily spend | SUM(Ads_Product_Daily.Spend) |
| Sales | Number | Total daily sales | SUM(Ads_Product_Daily.Sales) |
| Orders | Integer | Total orders | SUM(Ads_Product_Daily.Orders) |
| SoldQty | Integer | Total units sold | SUM(Ads_Product_Daily.SoldQty) |
| Clicks | Integer | Total clicks | SUM(Ads_Product_Daily.Clicks) |
| Impressions | Integer | Total impressions | SUM(Ads_Product_Daily.Impressions) |
| CTR | Number | Aggregate CTR | (Clicks / Impressions) * 100 |
| CPC | Number | Aggregate CPC | Spend / Clicks |
| CPM | Number | Aggregate CPM | (Spend / Impressions) * 1000 |
| ROAS | Number | Aggregate ROAS | Sales / Spend |
| ACOS | Number | Aggregate ACOS | (Spend / Sales) * 100 |
| SyncTime | String (ISO) | Last rebuild time | System |
| Source | String | Always "Aggregated from SSOT" | System |

**UPSERT Logic:** Composite key (Date + ShopID)

### 2.3 Ads_Data_Integrity (Validation Results)

**Purpose:** Store checksum and coverage validation results  
**Primary Key:** ValidationID (auto-increment)

| Column | Type | Description |
|--------|------|-------------|
| ValidationID | String | UUID for this validation run |
| ValidationTime | String (ISO) | Timestamp of validation |
| ValidationType | String | "checksum" or "coverage" |
| Status | String | "passed", "warning", "critical" |
| Date | String (DD-MM-YYYY) | Date being validated (checksum only) |
| Metric | String | KPI name (checksum only) |
| ExpectedValue | Number | Expected value from SSOT (checksum) |
| ActualValue | Number | Actual value in aggregation (checksum) |
| Delta | Number | Absolute difference (checksum) |
| DeltaPercent | String | Percentage difference (checksum) |
| EarliestDate | String | Earliest date in SSOT (coverage only) |
| LatestDate | String | Latest date in SSOT (coverage only) |
| ExpectedDays | Integer | Expected day count (coverage only) |
| ActualDays | Integer | Actual day count (coverage only) |
| MissingDays | Integer | Missing day count (coverage only) |
| MissingDateRanges | String | List of missing ranges (coverage only) |
| CoveragePercent | String | Coverage percentage (coverage only) |
| Notes | String | Additional context |

---

## 3. Component Design

### 3.1 Gap Detection Engine

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `detectAndFillAdsGaps()`

#### Algorithm Specification

```
FUNCTION detectAndFillAdsGaps()
  // Step 1: Throttle check (max once per hour)
  lastCheck ← getScriptProperty("LAST_GAP_CHECK")
  IF lastCheck AND (currentTime - lastCheck) < 3600000 THEN
    RETURN { status: "skipped", reason: "Checked within last hour" }
  END IF
  
  // Step 2: Read SSOT
  rows ← readSheetObjects(ADS_PRODUCT_DAILY_SHEET)
  
  // Step 3: Case 1 - Empty database
  IF rows.length == 0 THEN
    LOG "Empty database detected - triggering full backfill"
    syncAdsHistoricalRange("01-06-2026", currentDate)
    setScriptProperty("LAST_GAP_CHECK", currentTime)
    RETURN { status: "success", reason: "Empty database", action: "Full backfill" }
  END IF
  
  // Step 4: Extract and sort dates
  dates ← rows.map(r => parseAdsDateToISO(r.Date)).filter(Boolean).sort()
  earliest ← dates[0]
  latest ← dates[dates.length - 1]
  
  // Step 5: Case 2 - Earliest date validation
  TARGET_START ← "2026-06-01"
  IF earliest > TARGET_START THEN
    LOG "Earliest date validation failed - backfilling from target start"
    syncAdsHistoricalRange("01-06-2026", formatAdsDateDDMMYYYY(earliest))
    setScriptProperty("LAST_GAP_CHECK", currentTime)
    RETURN { status: "success", reason: "Earliest date validation", filledRange: ... }
  END IF
  
  // Step 6: Case 3 - Internal gap detection
  gaps ← findDateGaps(dates, earliest, latest)
  IF gaps.length > 0 THEN
    totalMissingDays ← SUM(gaps.map(g => g.missingDays))
    
    IF totalMissingDays <= 30 THEN
      // Auto-fill small gaps
      FOR EACH gap IN gaps DO
        syncAdsHistoricalRange(gap.startDate, gap.endDate)
      END FOR
      RETURN { status: "success", reason: "Gap auto-fill", gaps: gaps }
    ELSE
      // Large gap - manual review required
      RETURN { status: "warning", reason: "Large gap detected", gaps: gaps }
    END IF
  END IF
  
  // Step 7: No issues found
  setScriptProperty("LAST_GAP_CHECK", currentTime)
  RETURN { status: "ok", reason: "No gaps detected" }
END FUNCTION
```

#### Helper Function: findDateGaps()

```
FUNCTION findDateGaps(dates, earliest, latest)
  gaps ← []
  uniqueDates ← removeDuplicates(dates).sort()
  
  FOR i FROM 0 TO uniqueDates.length - 2 DO
    currentDate ← parseDate(uniqueDates[i])
    nextDate ← parseDate(uniqueDates[i + 1])
    daysDiff ← (nextDate - currentDate) / 86400000  // milliseconds to days
    
    IF daysDiff > 1 THEN
      gapStartDate ← currentDate + 1 day
      gapEndDate ← nextDate - 1 day
      missingDays ← daysDiff - 1
      
      gaps.push({
        startDate: formatAdsDateDDMMYYYY(gapStartDate),
        endDate: formatAdsDateDDMMYYYY(gapEndDate),
        missingDays: missingDays
      })
    END IF
  END FOR
  
  RETURN gaps
END FUNCTION
```

#### Integration Points

1. **Trigger Point:** `ensureAdsDatabase()` in `AdsDatabase.gs`
2. **Call Frequency:** Once per hour (throttled)
3. **Side Effects:** Calls `syncAdsHistoricalRange()` which triggers full SSOT write pipeline

### 3.2 SSOT Rebuild Engine

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `buildAndUpsertAdsDailySummary()` (MODIFIED)

#### Breaking Change

**Before (v1.0):**
```javascript
function buildAndUpsertAdsDailySummary(apiSummaryRows) {
  // Accepts API data directly - bypasses SSOT
}
```

**After (v2.0):**
```javascript
function buildAndUpsertAdsDailySummary() {
  // Reads ONLY from SSOT - no API parameter
}
```

#### Algorithm Specification

```
FUNCTION buildAndUpsertAdsDailySummary()
  // Step 1: Read from SSOT
  dailyObjects ← readSheetObjects(ADS_PRODUCT_DAILY_SHEET)
  
  // Step 2: Aggregate by Date
  summaryByDate ← {}
  FOR EACH row IN dailyObjects DO
    date ← parseAdsDateToISO(row.Date)
    IF date is NULL THEN CONTINUE
    
    IF summaryByDate[date] does NOT exist THEN
      summaryByDate[date] ← {
        spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0
      }
    END IF
    
    summaryByDate[date].spend += parseFloat(row.Spend) || 0
    summaryByDate[date].sales += parseFloat(row.Sales) || 0
    summaryByDate[date].orders += parseInt(row.Orders) || 0
    summaryByDate[date].soldQty += parseInt(row.SoldQty) || 0
    summaryByDate[date].clicks += parseInt(row.Clicks) || 0
    summaryByDate[date].impressions += parseInt(row.Impressions) || 0
  END FOR
  
  // Step 3: Compute derived KPIs
  summaryRows ← []
  FOR EACH date IN summaryByDate DO
    d ← summaryByDate[date]
    
    row ← [
      date,
      getShopID(),
      d.spend,
      d.sales,
      d.orders,
      d.soldQty,
      d.clicks,
      d.impressions,
      computeCTR(d.clicks, d.impressions),
      computeCPC(d.spend, d.clicks),
      computeCPM(d.spend, d.impressions),
      computeROAS(d.sales, d.spend),
      computeACOS(d.spend, d.sales),
      getJakartaTimeString(),
      "Aggregated from SSOT"
    ]
    
    summaryRows.push(row)
  END FOR
  
  // Step 4: Write to Ads_Daily_Summary (UPSERT)
  upsertAdsDailySummaryIdempotent(
    ADS_DAILY_SUMMARY_SHEET,
    ADS_DAILY_SUMMARY_HEADERS,
    summaryRows,
    "#047857"
  )
  
  // Step 5: Auto checksum validation
  checksumResult ← validateAdsChecksum()
  LOG "Checksum validation: " + JSON.stringify(checksumResult)
  
  RETURN checksumResult
END FUNCTION
```

#### Callers to Update

All existing callers of `buildAndUpsertAdsDailySummary(apiSummaryRows)` must remove the parameter:

1. **syncAdsProductDaily()** - Remove API summary fetch
2. **syncAdsHistoricalRange()** - Call without parameter
3. **handleRunHistoricalAdsSync()** - Call without parameter

### 3.3 Checksum Validation Engine

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `validateAdsChecksum()`

#### Algorithm Specification

```
FUNCTION validateAdsChecksum()
  LOG "Starting checksum validation..."
  
  // Step 1: Read data sources
  dailyRows ← readSheetObjects(ADS_PRODUCT_DAILY_SHEET)
  summaryRows ← readSheetObjects(ADS_DAILY_SUMMARY_SHEET)
  
  // Step 2: Build expected sums from SSOT
  expectedByDate ← {}
  FOR EACH row IN dailyRows DO
    date ← parseAdsDateToISO(row.Date)
    IF date is NULL THEN CONTINUE
    
    IF expectedByDate[date] does NOT exist THEN
      expectedByDate[date] ← { spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0 }
    END IF
    
    expectedByDate[date].spend += parseFloat(row.Spend) || 0
    expectedByDate[date].sales += parseFloat(row.Sales) || 0
    expectedByDate[date].orders += parseInt(row.Orders) || 0
    expectedByDate[date].soldQty += parseInt(row.SoldQty) || 0
    expectedByDate[date].clicks += parseInt(row.Clicks) || 0
    expectedByDate[date].impressions += parseInt(row.Impressions) || 0
  END FOR
  
  // Step 3: Compare with actual values in Ads_Daily_Summary
  discrepancies ← []
  TOLERANCE ← 0.01  // 0.01% tolerance for rounding
  METRICS ← ["Spend", "Sales", "Orders", "SoldQty", "Clicks", "Impressions"]
  
  FOR EACH summaryRow IN summaryRows DO
    date ← parseAdsDateToISO(summaryRow.Date)
    IF date is NULL OR expectedByDate[date] does NOT exist THEN CONTINUE
    
    expected ← expectedByDate[date]
    
    FOR EACH metric IN METRICS DO
      expectedValue ← expected[metric.toLowerCase()]
      actualValue ← parseFloat(summaryRow[metric]) || parseInt(summaryRow[metric]) || 0
      delta ← abs(expectedValue - actualValue)
      deltaPercent ← (expectedValue > 0) ? (delta / expectedValue) * 100 : 0
      
      IF deltaPercent > TOLERANCE THEN
        discrepancies.push({
          Date: date,
          Metric: metric,
          Expected: expectedValue,
          Actual: actualValue,
          Delta: delta,
          DeltaPercent: deltaPercent.toFixed(4) + "%"
        })
      END IF
    END FOR
  END FOR
  
  // Step 4: Log and persist results
  IF discrepancies.length == 0 THEN
    LOG "✅ Checksum PASSED - All metrics match"
    RETURN {
      status: "passed",
      validatedDates: Object.keys(expectedByDate).length,
      discrepancies: 0
    }
  ELSE
    LOG "❌ Checksum FAILED - " + discrepancies.length + " discrepancies found"
    writeAdsChecksumDiscrepancies(discrepancies)
    RETURN {
      status: "failed",
      validatedDates: Object.keys(expectedByDate).length,
      discrepancies: discrepancies
    }
  END IF
END FUNCTION
```

#### Helper Function: writeAdsChecksumDiscrepancies()

```
FUNCTION writeAdsChecksumDiscrepancies(discrepancies)
  validationID ← generateUUID()
  validationTime ← getJakartaTimeString()
  
  rows ← []
  FOR EACH d IN discrepancies DO
    rows.push([
      validationID,
      validationTime,
      "checksum",
      "failed",
      d.Date,
      d.Metric,
      d.Expected,
      d.Actual,
      d.Delta,
      d.DeltaPercent,
      "", "", "", "", "", "", "",  // Empty coverage fields
      "Checksum mismatch detected during aggregation validation"
    ])
  END FOR
  
  appendToSheet(ADS_DATA_INTEGRITY_SHEET, rows)
END FUNCTION
```

### 3.4 Coverage Validation Engine

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `validateAdsCoverage()`

#### Algorithm Specification

```
FUNCTION validateAdsCoverage()
  LOG "Starting coverage validation..."
  
  // Step 1: Read SSOT
  rows ← readSheetObjects(ADS_PRODUCT_DAILY_SHEET)
  IF rows.length == 0 THEN
    RETURN { status: "empty", coverage: 0 }
  END IF
  
  // Step 2: Extract unique dates
  dates ← rows.map(r => parseAdsDateToISO(r.Date)).filter(Boolean).sort()
  uniqueDates ← removeDuplicates(dates)
  
  earliest ← uniqueDates[0]
  latest ← uniqueDates[uniqueDates.length - 1]
  
  // Step 3: Calculate expected vs actual
  earliestObj ← parseDate(earliest)
  latestObj ← parseDate(latest)
  expectedDays ← floor((latestObj - earliestObj) / 86400000) + 1
  actualDays ← uniqueDates.length
  missingDays ← expectedDays - actualDays
  coveragePercent ← (actualDays / expectedDays) * 100
  
  // Step 4: Find missing date ranges
  missingRanges ← []
  FOR i FROM 0 TO uniqueDates.length - 2 DO
    currentDate ← parseDate(uniqueDates[i])
    nextDate ← parseDate(uniqueDates[i + 1])
    daysDiff ← (nextDate - currentDate) / 86400000
    
    IF daysDiff > 1 THEN
      gapStart ← currentDate + 1 day
      gapEnd ← nextDate - 1 day
      missingRanges.push(formatDate(gapStart) + " to " + formatDate(gapEnd))
    END IF
  END FOR
  
  // Step 5: Determine status
  status ← "ok"
  IF coveragePercent < 80 THEN
    status ← "critical"
  ELSE IF coveragePercent < 95 THEN
    status ← "warning"
  END IF
  
  // Step 6: Build result
  result ← {
    status: status,
    earliest: earliest,
    latest: latest,
    expectedDays: expectedDays,
    actualDays: actualDays,
    missingDays: missingDays,
    coveragePercent: coveragePercent.toFixed(2) + "%",
    missingRanges: missingRanges.join(", ")
  }
  
  // Step 7: Persist result
  writeCoverageValidationResult(result)
  
  LOG "Coverage validation: " + JSON.stringify(result)
  RETURN result
END FUNCTION
```

#### Helper Function: writeCoverageValidationResult()

```
FUNCTION writeCoverageValidationResult(result)
  validationID ← generateUUID()
  validationTime ← getJakartaTimeString()
  
  row ← [
    validationID,
    validationTime,
    "coverage",
    result.status,
    "", "", "", "", "", "",  // Empty checksum fields
    result.earliest,
    result.latest,
    result.expectedDays,
    result.actualDays,
    result.missingDays,
    result.missingRanges,
    result.coveragePercent,
    "Coverage validation after sync operation"
  ]
  
  appendToSheet(ADS_DATA_INTEGRITY_SHEET, [row])
END FUNCTION
```

---

## 4. API Specifications

### 4.1 Manual Backfill Trigger API

**Endpoint:** `handleRunHistoricalAdsSync(params)`  
**Method:** POST (via doPost handler)  
**Authentication:** Required (existing session validation)

#### Request Parameters

```javascript
{
  action: "runHistoricalAdsSync",
  startDate: "01-06-2026",  // DD-MM-YYYY format
  endDate: "20-07-2026"      // DD-MM-YYYY format
}
```

#### Response Format (Success)

```javascript
{
  status: "success",
  message: "Historical sync completed",
  stats: {
    dateRange: "01-06-2026 to 20-07-2026",
    totalDays: 50,
    chunksProcessed: 4,
    rowsSynced: 2847,
    executionTime: "4m 32s"
  },
  validation: {
    checksum: {
      status: "passed",
      validatedDates: 50,
      discrepancies: 0
    },
    coverage: {
      status: "ok",
      coveragePercent: "100.00%",
      missingDays: 0
    }
  }
}
```

#### Response Format (Partial Success with Errors)

```javascript
{
  status: "partial",
  message: "Historical sync completed with errors",
  stats: {
    dateRange: "01-06-2026 to 20-07-2026",
    totalDays: 50,
    chunksProcessed: 3,
    chunksFailed: 1,
    rowsSynced: 2130,
    executionTime: "5m 12s"
  },
  errors: [
    {
      chunk: 4,
      dateRange: "16-07-2026 to 20-07-2026",
      error: "Shopee API timeout after 3 retries"
    }
  ],
  checkpoint: {
    lastCompletedChunk: 3,
    resumeFromDate: "16-07-2026"
  }
}
```

#### Response Format (Failure)

```javascript
{
  status: "error",
  message: "Historical sync failed",
  error: "SSOT validation failed: Ads_Product_Daily has inconsistent data",
  code: "SSOT_VALIDATION_ERROR"
}
```

### 4.2 Dashboard Coverage Metrics API

**Endpoint:** `handleGetAdsDashboard(params)`  
**Method:** GET (via doGet handler)  
**Authentication:** Required

#### Response Format (Enhanced)

```javascript
{
  status: "success",
  kpis: {
    totalSpend: 15847200,
    totalSales: 98234500,
    totalOrders: 1247,
    roas: 6.2,
    acos: 16.1,
    // ... existing KPIs
  },
  coverage: {  // NEW FIELD
    earliestDate: "2026-06-01",
    latestDate: "2026-08-05",
    coveragePercent: "98.51%",
    expectedDays: 67,
    actualDays: 66,
    missingDays: 1,
    missingRanges: "2026-07-15",
    status: "ok"  // "ok", "warning", "critical"
  },
  lastSync: "2026-08-05T14:23:18+07:00"
}
```

---

## 5. Frontend Integration

### 5.1 Manual Backfill Button Component

**File:** `src/frontend/ads-dashboard.html` (or equivalent)

#### HTML Structure

```html
<div class="ads-backfill-section">
  <h3>Historical Data Backfill</h3>
  <p class="backfill-description">
    Fill missing historical data from <strong>June 1, 2026</strong> to <strong>July 20, 2026</strong>
  </p>
  
  <button id="btnBackfillAds" class="btn btn-primary">
    <i class="icon-sync"></i> Backfill Missing Data (June 1 - July 20)
  </button>
  
  <div id="backfillProgress" class="progress-container" style="display: none;">
    <div class="progress-bar">
      <div id="progressBar" class="progress-fill" style="width: 0%;"></div>
    </div>
    <p id="progressText" class="progress-text">Processing chunk 0/0...</p>
  </div>
  
  <div id="backfillResult" class="result-message" style="display: none;">
    <p id="resultText"></p>
  </div>
</div>
```

#### JavaScript Implementation

```javascript
// File: src/frontend/js/ads-backfill.js

class AdsBackfillManager {
  constructor() {
    this.button = document.getElementById('btnBackfillAds');
    this.progressContainer = document.getElementById('backfillProgress');
    this.progressBar = document.getElementById('progressBar');
    this.progressText = document.getElementById('progressText');
    this.resultContainer = document.getElementById('backfillResult');
    this.resultText = document.getElementById('resultText');
    
    this.attachEventListeners();
  }
  
  attachEventListeners() {
    this.button.addEventListener('click', () => this.triggerBackfill());
  }
  
  async triggerBackfill() {
    // Disable button
    this.button.disabled = true;
    this.button.textContent = 'Processing...';
    
    // Show progress
    this.progressContainer.style.display = 'block';
    this.resultContainer.style.display = 'none';
    
    try {
      const response = await fetch(API_BASE_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify({
          action: 'runHistoricalAdsSync',
          startDate: '01-06-2026',
          endDate: '20-07-2026'
        })
      });
      
      const result = await response.json();
      
      if (result.status === 'success') {
        this.showSuccess(result);
      } else if (result.status === 'partial') {
        this.showPartialSuccess(result);
      } else {
        this.showError(result);
      }
      
    } catch (error) {
      this.showError({ error: error.message });
    } finally {
      // Re-enable button
      this.button.disabled = false;
      this.button.textContent = 'Backfill Missing Data (June 1 - July 20)';
      
      // Hide progress
      this.progressContainer.style.display = 'none';
    }
  }
  
  showSuccess(result) {
    this.resultContainer.style.display = 'block';
    this.resultContainer.className = 'result-message success';
    this.resultText.innerHTML = `
      <strong>✅ Backfill Completed Successfully</strong><br>
      • Date Range: ${result.stats.dateRange}<br>
      • Rows Synced: ${result.stats.rowsSynced.toLocaleString()}<br>
      • Execution Time: ${result.stats.executionTime}<br>
      • Checksum: ${result.validation.checksum.status}<br>
      • Coverage: ${result.validation.coverage.coveragePercent}
    `;
  }
  
  showPartialSuccess(result) {
    this.resultContainer.style.display = 'block';
    this.resultContainer.className = 'result-message warning';
    this.resultText.innerHTML = `
      <strong>⚠️ Backfill Partially Completed</strong><br>
      • Rows Synced: ${result.stats.rowsSynced.toLocaleString()}<br>
      • Chunks Failed: ${result.stats.chunksFailed}<br>
      • Resume From: ${result.checkpoint.resumeFromDate}<br>
      <button onclick="window.adsBackfill.retryFromCheckpoint('${result.checkpoint.resumeFromDate}')">
        Retry Failed Chunks
      </button>
    `;
  }
  
  showError(result) {
    this.resultContainer.style.display = 'block';
    this.resultContainer.className = 'result-message error';
    this.resultText.innerHTML = `
      <strong>❌ Backfill Failed</strong><br>
      Error: ${result.error || 'Unknown error occurred'}
    `;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.adsBackfill = new AdsBackfillManager();
});
```

### 5.2 Coverage Badge Component

**File:** `src/frontend/ads-dashboard.html`

#### HTML Structure

```html
<div class="coverage-badge-container">
  <div id="coverageBadge" class="coverage-badge">
    <div class="badge-icon">
      <i class="icon-check-circle"></i>
    </div>
    <div class="badge-content">
      <span class="badge-label">Data Coverage</span>
      <span id="coveragePercent" class="badge-value">--.--%</span>
      <span id="coverageStatus" class="badge-status"></span>
    </div>
    <div class="badge-details">
      <small id="coverageDetails">Loading...</small>
    </div>
  </div>
</div>
```

#### JavaScript Implementation

```javascript
// File: src/frontend/js/ads-coverage.js

class AdsCoverageBadge {
  constructor() {
    this.badge = document.getElementById('coverageBadge');
    this.percentElement = document.getElementById('coveragePercent');
    this.statusElement = document.getElementById('coverageStatus');
    this.detailsElement = document.getElementById('coverageDetails');
    
    this.fetchCoverage();
  }
  
  async fetchCoverage() {
    try {
      const response = await fetch(API_BASE_URL + '?action=getAdsDashboard', {
        method: 'GET',
        redirect: 'follow'
      });
      
      const result = await response.json();
      
      if (result.status === 'success' && result.coverage) {
        this.updateBadge(result.coverage);
      }
      
    } catch (error) {
      console.error('Failed to fetch coverage:', error);
      this.detailsElement.textContent = 'Failed to load coverage data';
    }
  }
  
  updateBadge(coverage) {
    // Update percentage
    this.percentElement.textContent = coverage.coveragePercent;
    
    // Update status badge
    const statusMap = {
      ok: { text: 'Excellent', class: 'status-ok' },
      warning: { text: 'Incomplete', class: 'status-warning' },
      critical: { text: 'Critical', class: 'status-critical' }
    };
    
    const statusInfo = statusMap[coverage.status] || statusMap.ok;
    this.statusElement.textContent = statusInfo.text;
    this.statusElement.className = 'badge-status ' + statusInfo.class;
    
    // Update details
    this.detailsElement.innerHTML = `
      ${coverage.earliestDate} to ${coverage.latestDate}<br>
      ${coverage.actualDays}/${coverage.expectedDays} days
      ${coverage.missingDays > 0 ? `<br><strong>${coverage.missingDays} missing:</strong> ${coverage.missingRanges}` : ''}
    `;
    
    // Update badge background color
    if (coverage.status === 'ok') {
      this.badge.style.borderColor = '#10b981';
    } else if (coverage.status === 'warning') {
      this.badge.style.borderColor = '#f59e0b';
    } else if (coverage.status === 'critical') {
      this.badge.style.borderColor = '#ef4444';
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.adsCoverage = new AdsCoverageBadge();
});
```

---

## 6. Integration Points

### 6.1 Database Initialization Integration

**File:** `src/backend/ShopeeAds/core/AdsDatabase.gs`  
**Function:** `ensureAdsDatabase()`

#### Modification

```javascript
function ensureAdsDatabase() {
  // Existing sheet creation code
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Ensure Ads_Product_Daily exists
  var adsProductDaily = ss.getSheetByName(ADS_PRODUCT_DAILY_SHEET);
  if (!adsProductDaily) {
    adsProductDaily = ss.insertSheet(ADS_PRODUCT_DAILY_SHEET);
    // ... set headers
  }
  
  // Ensure Ads_Daily_Summary exists
  var adsDailySummary = ss.getSheetByName(ADS_DAILY_SUMMARY_SHEET);
  if (!adsDailySummary) {
    adsDailySummary = ss.insertSheet(ADS_DAILY_SUMMARY_SHEET);
    // ... set headers
  }
  
  // NEW: Ensure Ads_Data_Integrity exists
  var adsDataIntegrity = ss.getSheetByName(ADS_DATA_INTEGRITY_SHEET);
  if (!adsDataIntegrity) {
    adsDataIntegrity = ss.insertSheet(ADS_DATA_INTEGRITY_SHEET);
    var integrityHeaders = [
      "ValidationID", "ValidationTime", "ValidationType", "Status",
      "Date", "Metric", "ExpectedValue", "ActualValue", "Delta", "DeltaPercent",
      "EarliestDate", "LatestDate", "ExpectedDays", "ActualDays",
      "MissingDays", "MissingDateRanges", "CoveragePercent", "Notes"
    ];
    adsDataIntegrity.getRange(1, 1, 1, integrityHeaders.length).setValues([integrityHeaders]);
    adsDataIntegrity.getRange(1, 1, 1, integrityHeaders.length).setFontWeight("bold");
  }
  
  // NEW: Auto gap detection and backfill
  try {
    var gapResult = detectAndFillAdsGaps();
    Logger.log("[ensureAdsDatabase] Gap detection result: " + JSON.stringify(gapResult));
  } catch (e) {
    Logger.log("[ensureAdsDatabase] Gap detection failed (non-fatal): " + e.toString());
  }
}
```

### 6.2 Daily Sync Integration

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `syncAdsProductDaily()`

#### Modification

```javascript
function syncAdsProductDaily() {
  Logger.log("[syncAdsProductDaily] Starting daily sync...");
  
  // Existing daily sync logic (3-day window)
  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(startDate.getDate() - ADS_DAILY_SYNC_WINDOW_DAYS);
  
  // Fetch from API and write to SSOT
  var productRows = fetchAdsProductDataFromAPI(startDate, endDate);
  upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, productRows);
  
  // MODIFIED: Rebuild from SSOT (no API parameter)
  buildAndUpsertAdsDailySummary();  // Auto-validates checksum internally
  
  // NEW: Coverage validation
  var coverageResult = validateAdsCoverage();
  Logger.log("[syncAdsProductDaily] Coverage: " + JSON.stringify(coverageResult));
  
  return { status: "success", rows: productRows.length };
}
```

### 6.3 Historical Sync Integration

**File:** `src/backend/ShopeeAds/core/AdsEngine.gs`  
**Function:** `syncAdsHistoricalRange(startDate, endDate)`

#### Modification

```javascript
function syncAdsHistoricalRange(startDateStr, endDateStr) {
  Logger.log("[syncAdsHistoricalRange] Syncing " + startDateStr + " to " + endDateStr);
  
  // Chunk the date range
  var chunks = chunkDateRange(startDateStr, endDateStr, ADS_HISTORICAL_CHUNK_DAYS);
  var totalRowsSynced = 0;
  
  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    Logger.log("[Chunk " + (i+1) + "/" + chunks.length + "] " + chunk.start + " to " + chunk.end);
    
    try {
      // Fetch from API
      var productRows = fetchAdsProductDataFromAPI(chunk.start, chunk.end);
      
      // Write to SSOT
      upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, productRows);
      totalRowsSynced += productRows.length;
      
    } catch (e) {
      Logger.log("[Chunk " + (i+1) + "] FAILED: " + e.toString());
      // Continue to next chunk (don't fail entire sync)
    }
  }
  
  // MODIFIED: Rebuild from SSOT (no API parameter)
  buildAndUpsertAdsDailySummary();  // Auto-validates checksum
  
  // NEW: Coverage validation
  var coverageResult = validateAdsCoverage();
  
  return {
    status: "success",
    chunks: chunks.length,
    rowsSynced: totalRowsSynced,
    coverage: coverageResult
  };
}
```

---

## 7. Performance Considerations

### 7.1 Batch Operations

**Optimization:** Accumulate rows in memory, write in batches

```javascript
// BEFORE: Write after each chunk (slow)
for (var i = 0; i < chunks.length; i++) {
  var rows = fetchFromAPI(chunks[i]);
  upsertAdsDailyRowsIdempotent(sheet, rows);  // 4 writes
}

// AFTER: Accumulate and write once (fast)
var allRows = [];
for (var i = 0; i < chunks.length; i++) {
  var rows = fetchFromAPI(chunks[i]);
  allRows = allRows.concat(rows);
}
upsertAdsDailyRowsIdempotent(sheet, allRows);  // 1 write
```

### 7.2 Sheet Connection Reuse

**Optimization:** Cache SpreadsheetApp.getActiveSpreadsheet()

```javascript
var ss = SpreadsheetApp.getActiveSpreadsheet();  // Cache this
var sheet = ss.getSheetByName(ADS_PRODUCT_DAILY_SHEET);  // Reuse ss
```

### 7.3 Throttling

**Gap Detection:** Max once per hour (3600000 ms)  
**Reason:** Avoid excessive API calls during initialization

### 7.4 Execution Time Targets

| Operation | Target | Current Estimate |
|-----------|--------|------------------|
| detectAndFillAdsGaps() | <30s | ~15s |
| syncAdsHistoricalRange(50 days) | <5min | ~4m 30s |
| buildAndUpsertAdsDailySummary() | <1min | ~45s |
| validateAdsChecksum() | <30s | ~20s |
| validateAdsCoverage() | <10s | ~5s |

---

## 8. Error Handling

### 8.1 Error Types

| Error Code | Description | Recovery Action |
|------------|-------------|-----------------|
| API_TIMEOUT | Shopee API timeout | Retry chunk 3 times, then skip |
| SSOT_VALIDATION_ERROR | SSOT data incomplete | Abort rebuild, alert user |
| CHECKSUM_FAILED | Aggregation mismatch | Log to Ads_Data_Integrity, alert |
| COVERAGE_CRITICAL | <80% coverage | Trigger auto-backfill if <30 days missing |
| GAS_TIMEOUT | Apps Script 6min limit | Save checkpoint, resume later |

### 8.2 Checkpoint/Resume Logic

```javascript
function syncAdsHistoricalRange(startDateStr, endDateStr) {
  var checkpoint = getScriptProperty("ADS_BACKFILL_CHECKPOINT");
  var startChunk = checkpoint ? parseInt(checkpoint) : 0;
  
  var chunks = chunkDateRange(startDateStr, endDateStr, 15);
  
  for (var i = startChunk; i < chunks.length; i++) {
    // Check if approaching timeout (5 minutes elapsed)
    if (Date.now() - startTime > 300000) {
      setScriptProperty("ADS_BACKFILL_CHECKPOINT", i.toString());
      return { status: "partial", lastChunk: i };
    }
    
    // Process chunk
    processChunk(chunks[i]);
    
    // Update checkpoint
    setScriptProperty("ADS_BACKFILL_CHECKPOINT", (i+1).toString());
  }
  
  // Clear checkpoint on success
  deleteScriptProperty("ADS_BACKFILL_CHECKPOINT");
  return { status: "success" };
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| detectAndFillAdsGaps() - Empty DB | Empty Ads_Product_Daily | Trigger full backfill from 2026-06-01 |
| detectAndFillAdsGaps() - Earliest Date | Earliest = 2026-07-01 | Backfill 2026-06-01 to 2026-06-30 |
| findDateGaps() - Single Gap | [2026-06-01, 2026-06-05, 2026-06-10] | [{ start: "02-06-2026", end: "04-06-2026", days: 3 }, { start: "06-06-2026", end: "09-06-2026", days: 4 }] |
| validateAdsChecksum() - Match | SSOT sum = 1000, Summary = 1000 | { status: "passed", discrepancies: 0 } |
| validateAdsChecksum() - Mismatch | SSOT sum = 1000, Summary = 950 | { status: "failed", discrepancies: [...] } |
| validateAdsCoverage() - Complete | 67 expected, 67 actual | { status: "ok", coverage: "100%" } |
| validateAdsCoverage() - Incomplete | 67 expected, 50 actual | { status: "critical", coverage: "74.63%" } |

### 9.2 Integration Tests

1. **Full Backfill Pipeline**
   - Trigger `handleRunHistoricalAdsSync("01-06-2026", "20-07-2026")`
   - Verify 50 rows in Ads_Daily_Summary
   - Verify checksum passes
   - Verify coverage = 100%

2. **Auto-Gap Detection on Init**
   - Clear Ads_Product_Daily
   - Call `ensureAdsDatabase()`
   - Verify `detectAndFillAdsGaps()` triggers
   - Verify data populated

3. **SSOT Rebuild**
   - Manually delete Ads_Daily_Summary
   - Call `buildAndUpsertAdsDailySummary()`
   - Verify data rebuilt from SSOT only
   - Verify checksum passes

### 9.3 Regression Tests

1. **Daily Sync Still Works**
   - Run `syncAdsProductDaily()`
   - Verify last 3 days synced
   - Verify no breaking changes

2. **Existing Functions Preserved**
   - Verify `ADS_DAILY_SYNC_WINDOW_DAYS` still = 3
   - Verify `shopeeGet()` still used
   - Verify no schema changes to existing sheets

---

## 10. Security Considerations

### 10.1 Authentication

- All API endpoints require existing session validation
- No new authentication mechanisms introduced

### 10.2 Rate Limiting

- Gap detection throttled to once per hour
- Shopee API calls respect existing rate limits

### 10.3 Data Validation

- All dates validated before processing
- SSOT validation prevents corrupt aggregations
- Checksum validation catches tampering

---

## 11. Rollout Plan

### Phase 1: Foundation (Week 1)
- [ ] Implement `detectAndFillAdsGaps()`
- [ ] Implement `findDateGaps()`
- [ ] Integrate into `ensureAdsDatabase()`
- [ ] Test with empty database
- [ ] Test with gaps

### Phase 2: SSOT Refactoring (Week 2)
- [ ] Modify `buildAndUpsertAdsDailySummary()` signature
- [ ] Update all callers
- [ ] Test SSOT rebuild
- [ ] Verify daily sync still works

### Phase 3: Validation (Week 3)
- [ ] Implement `validateAdsChecksum()`
- [ ] Implement `validateAdsCoverage()`
- [ ] Create Ads_Data_Integrity sheet
- [ ] Test with known discrepancies

### Phase 4: Frontend (Week 4)
- [ ] Add manual backfill button
- [ ] Add progress tracker
- [ ] Add coverage badge
- [ ] Update dashboard API

---

## 12. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Auto-backfill success rate | >95% | Log analysis |
| Checksum validation pass rate | 100% | Ads_Data_Integrity sheet |
| Coverage completeness | >98% | Dashboard coverage badge |
| Manual interventions per month | <2 | Support tickets |
| Gap detection latency | <1 hour | Timestamp comparison |
| Backfill execution time (50 days) | <5 min | Execution logs |

---

## 13. Breaking Changes

### 13.1 Function Signature Change

**Before:**
```javascript
buildAndUpsertAdsDailySummary(apiSummaryRows)
```

**After:**
```javascript
buildAndUpsertAdsDailySummary()
```

**Impact:** All callers must remove the parameter

**Callers to Update:**
1. `syncAdsProductDaily()` in AdsEngine.gs
2. `syncAdsHistoricalRange()` in AdsEngine.gs
3. `handleRunHistoricalAdsSync()` in AdsAPI.gs

### 13.2 Migration Path

```javascript
// Old code
function syncAdsProductDaily() {
  var productRows = fetchFromAPI();
  var summaryRows = fetchSummaryFromAPI();  // ← Remove this
  buildAndUpsertAdsDailySummary(summaryRows);  // ← Remove parameter
}

// New code
function syncAdsProductDaily() {
  var productRows = fetchFromAPI();
  upsertAdsDailyRowsIdempotent(ADS_PRODUCT_DAILY_SHEET, productRows);
  buildAndUpsertAdsDailySummary();  // ← No parameter, reads from SSOT
}
```

---

## 14. Appendix

### 14.1 Constants

```javascript
const ADS_PRODUCT_DAILY_SHEET = "Ads_Product_Daily";
const ADS_DAILY_SUMMARY_SHEET = "Ads_Daily_Summary";
const ADS_DATA_INTEGRITY_SHEET = "Ads_Data_Integrity";
const ADS_DAILY_SYNC_WINDOW_DAYS = 3;
const ADS_HISTORICAL_CHUNK_DAYS = 15;
const TARGET_START_DATE = "2026-06-01";
const GAP_DETECTION_THROTTLE_MS = 3600000;  // 1 hour
const CHECKSUM_TOLERANCE_PERCENT = 0.01;  // 0.01%
const COVERAGE_WARNING_THRESHOLD = 95;  // %
const COVERAGE_CRITICAL_THRESHOLD = 80;  // %
```

### 14.2 Glossary

See Requirements Document Section 2 (Glossary)

---

**Document Version:** 1.0  
**Status:** Design Phase Complete  
**Next Phase:** Task Breakdown (tasks.md)  
**Review Date:** 2026-08-12  
**Approved By:** Pending

---

*End of Design Document*
