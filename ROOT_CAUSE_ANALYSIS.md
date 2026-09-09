# Root Cause Analysis: Ads_Daily_Summary Missing Historical Data

## Executive Summary

**Problem:** `Ads_Daily_Summary` sheet only contains data from 2026-07-21 onwards, missing historical data from 2026-06-01 to 2026-07-20 (50 days gap).

**Root Cause:** Regular daily sync uses a 3-day rolling window by design. Historical sync function exists but was never triggered for the missing date range.

**Solution:** Implement one-time historical backfill feature with frontend button and progress tracking.

---

## Problem Statement

### Observed Behavior
- **Expected:** Ads_Daily_Summary should contain data from 2026-06-01 to present
- **Actual:** Data only available from 2026-07-21 onwards
- **Impact:** 50 days of historical advertising performance data is missing
- **Affected Users:** System administrators and business analysts reviewing historical ROAS and ad performance

### Business Impact
- **Analytics Gap:** Cannot analyze advertising performance trends for June 1-20, 2026
- **ROAS Calculation:** Historical ROAS metrics incomplete
- **Dashboard Accuracy:** Ads Dashboard KPIs showing incomplete historical data
- **Compliance:** Missing audit trail for advertising expenditure during missing period

---

## Investigation Process

### Step 1: Architecture Review

**Examined Components:**
```
src/backend/ShopeeAds/core/AdsEngine.gs
src/backend/ShopeeAds/api/AdsAPI.gs
src/backend/ShopeeAds/core/AdsDatabase.gs
```

**Key Findings:**

1. **Regular Daily Sync** (`syncAdsProductDaily()`)
   - **Location:** Line 235-375 in `AdsEngine.gs`
   - **Behavior:** Fetches data for last 3 days only
   - **Code Evidence:**
     ```javascript
     const ADS_DAILY_SYNC_WINDOW_DAYS = 3; // Line 7
     
     // Line 248-249
     var today = new Date();
     var pastWindow = new Date();
     pastWindow.setDate(today.getDate() - ADS_DAILY_SYNC_WINDOW_DAYS);
     ```
   - **Purpose:** Designed for daily maintenance, NOT historical backfill
   - **API Call:** `/api/v2/ads/get_all_cpc_ads_daily_performance` with 3-day window

2. **Historical Sync Function** (`syncAdsHistoricalRange()`)
   - **Location:** Line 1133-1330 in `AdsEngine.gs`
   - **Behavior:** Fetches custom date ranges in 15-day chunks
   - **Code Evidence:**
     ```javascript
     function syncAdsHistoricalRange(startDateInput, endDateInput, options) {
       var startDateStr = startDateInput || "01-06-2026";
       var endDateStr = endDateInput || formatAdsDateDDMMYYYY(new Date());
       // ... chunking logic ...
     }
     ```
   - **Features:**
     - Automatic 15-day chunking (`ADS_HISTORICAL_CHUNK_DAYS = 15`)
     - Checkpoint/resume capability for timeout handling
     - UPSERT logic to prevent duplicates
   - **Status:** **Function exists but never triggered for missing range**

3. **Data Flow Architecture**
   ```
   [Shopee API] 
        ↓
   syncAdsProductDaily() (3-day window)
        ↓
   Ads_Product_Daily sheet (raw campaign data)
        ↓
   buildAndUpsertAdsDailySummary()
        ↓
   Ads_Daily_Summary sheet (aggregated KPIs)
        ↓
   Dashboard / Analytics
   ```

### Step 2: Date Range Analysis

**Default Date Ranges in System:**

| Component | Default Start Date | Default End Date | Source Location |
|-----------|-------------------|------------------|-----------------|
| Ads Dashboard API | `2026-06-01` | Today | `AdsAPI.gs:128` |
| Campaign Management | `2026-06-01` | Today | `AdsAPI.gs:466` |
| Product Performance | `2026-06-01` | Today | `AdsAPI.gs:552` |
| Paged Performance | `2026-06-01` | Today | `AdsAPI.gs:714` |
| Analytics Engine | `2026-06-01` | Today | `AnalyticsEngine.gs:1` |

**Observation:** Frontend expects data from 2026-06-01, but backend only syncs 3-day rolling window.

### Step 3: Data Gap Calculation

```
Start Date:  2026-06-01
End Date:    2026-07-20
Total Days:  50 days

Missing Data:
- Date Range: 2026-06-01 to 2026-07-20 (50 days)
- First Available: 2026-07-21 (when daily sync started)
- Chunk Count: 50 ÷ 15 = 4 chunks (rounded up)
  - Chunk 1: 2026-06-01 to 2026-06-15 (15 days)
  - Chunk 2: 2026-06-16 to 2026-06-30 (15 days)
  - Chunk 3: 2026-07-01 to 2026-07-15 (15 days)
  - Chunk 4: 2026-07-16 to 2026-07-20 (5 days)
```

---

## Root Cause Identification

### Primary Root Cause

**Design Decision: 3-Day Rolling Window**

**Evidence:**
```javascript
// src/backend/ShopeeAds/core/AdsEngine.gs:7
const ADS_DAILY_SYNC_WINDOW_DAYS = 3; // Window sinkronisasi harian rutin (3 hari terakhir)
```

**Analysis:**
- The regular daily sync was **intentionally designed** to fetch only the last 3 days
- This is optimal for daily maintenance (performance, API quota, execution time)
- NOT designed for historical data population
- The system assumes historical data was populated before daily sync started running

### Contributing Factors

1. **Historical Sync Never Triggered**
   - `handleRunHistoricalAdsSync()` endpoint exists but requires manual invocation
   - No automatic backfill mechanism on first run
   - No detection of missing date ranges during initialization

2. **Timing of Daily Sync Activation**
   - Daily sync started running on or around 2026-07-21
   - Historical data before this date was never fetched

3. **Frontend-Backend Mismatch**
   - Frontend default date filter: `2026-06-01` (expecting full historical data)
   - Backend sync behavior: Last 3 days only (no historical data)
   - No validation or warning when data gap exists

### Why This Went Undetected

1. **No Gap Detection**: System doesn't check for missing date ranges in `Ads_Daily_Summary`
2. **No Initialization Routine**: No first-run setup to populate historical data
3. **Silent Failure**: Missing data doesn't throw errors, just shows empty results
4. **Incremental Deployment**: System evolved over time without full historical data requirement documented

---

## Technical Deep Dive

### How `buildAndUpsertAdsDailySummary()` Works

**Function Location:** `AdsEngine.gs:681-785`

**Logic Flow:**
```javascript
function buildAndUpsertAdsDailySummary(apiSummaryRows) {
  // 1. Parse API summary rows (from 3-day window)
  var apiSummaryMap = {};
  apiSummaryRows.forEach(function(row) {
    var dIso = parseAdsDateToISO(row[0]);
    apiSummaryMap[dIso] = { /* KPI data */ };
  });

  // 2. Read existing Ads_Product_Daily sheet
  var dailyObjects = readSheetObjects(ADS_PRODUCT_DAILY_SHEET) || [];
  var productByDate = {};
  dailyObjects.forEach(function(d) {
    var dIso = parseAdsDateToISO(d["Date"]);
    // Aggregate by date
  });

  // 3. Merge API data + existing sheet data
  var dateSet = {};
  Object.keys(apiSummaryMap).forEach(d => dateSet[d] = true);
  Object.keys(productByDate).forEach(d => dateSet[d] = true);

  // 4. Compute KPIs for each date and UPSERT
  Object.keys(dateSet).forEach(function(dIso) {
    // Use API data if available, else sum from products
    // Calculate CTR, CPC, CPM, ROAS, ACOS
    summaryRows.push([/* 15 columns */]);
  });

  // 5. Perform UPSERT (composite key: Date + ShopID)
  upsertAdsDailySummaryIdempotent(...);
}
```

**Key Insight:**
- Function processes ONLY dates present in:
  - `apiSummaryRows` (from 3-day API call)
  - Existing `Ads_Product_Daily` sheet
- **Missing dates are never processed** because they're not in either source

### UPSERT Logic Verification

**Function:** `upsertAdsDailySummaryIdempotent()`  
**Location:** `AdsDatabase.gs:361-440`

**Composite Key:** `Date` (col 0) + `ShopID` (col 1)

**Behavior:**
- If row with same Date + ShopID exists → UPDATE
- If row doesn't exist → INSERT
- **Idempotent:** Running multiple times produces same result

**Code Evidence:**
```javascript
function upsertAdsDailySummaryIdempotent(sheetName, headerRow, dataRows, color) {
  var sheet = ss.getSheetByName(sheetName);
  var existingData = sheet.getRange(2, 1, lastRow, ncols).getValues();
  
  var keyMap = {};
  existingData.forEach(function(row, idx) {
    var dateVal = row[0]; // Date column
    var shopId = row[1];  // ShopID column
    var key = String(dateVal) + "_" + String(shopId);
    keyMap[key] = idx + 2; // Row number (1-indexed + header)
  });

  dataRows.forEach(function(newRow) {
    var key = String(newRow[0]) + "_" + String(newRow[1]);
    if (keyMap[key]) {
      // UPDATE existing row
      sheet.getRange(keyMap[key], 1, 1, ncols).setValues([newRow]);
    } else {
      // INSERT new row
      sheet.appendRow(newRow);
    }
  });
}
```

**Verification:** ✅ UPSERT logic is correct and idempotent.

---

## Why Historical Sync Wasn't Used

### Existing Historical Sync Capability

**Function:** `syncAdsHistoricalRange(startDateInput, endDateInput, options)`

**Features:**
1. ✅ Automatic 15-day chunking
2. ✅ Checkpoint/resume for timeouts
3. ✅ UPSERT to prevent duplicates
4. ✅ Batch processing for performance
5. ✅ Comprehensive logging

**API Endpoint:** `handleRunHistoricalAdsSync(params)`

**Default Parameters:**
```javascript
var startDate = params.startDate || "01-06-2026";
var endDate = params.endDate || formatAdsDateDDMMYYYY(new Date());
```

**Why It Wasn't Triggered:**
1. **Manual Invocation Required:** No automatic trigger on system initialization
2. **No Frontend Interface:** No button in Ads Dashboard to trigger it
3. **No Documentation:** Users unaware this function exists
4. **No Initialization Script:** No setup script to populate historical data on first run

---

## Solution Architecture

### Chosen Approach: Option A - One-Time Historical Backfill

**Rationale:**
- ✅ Preserves existing architecture (3-day daily sync)
- ✅ Reuses existing `syncAdsHistoricalRange()` function
- ✅ Minimal code changes required
- ✅ User-controlled execution (click button when ready)
- ✅ Idempotent (can run multiple times safely)
- ✅ Progress tracking for user feedback

**Rejected Alternatives:**

**Option B: Auto-Detect and Backfill on Sync**
- ❌ Adds complexity to every sync execution
- ❌ Risk of timeout if large gaps detected
- ❌ Harder to troubleshoot failures

**Option C: Increase Daily Window to 60 days**
- ❌ Inefficient (re-fetches 60 days every sync)
- ❌ Higher API quota consumption
- ❌ Slower daily sync performance
- ❌ Still doesn't solve historical gap problem

### Implementation Components

**Backend (Google Apps Script):**
1. ✅ `handleRunHistoricalAdsSync()` - Already exists
2. ✅ `syncAdsHistoricalRange()` - Already exists
3. ✅ `buildAndUpsertAdsDailySummary()` - Already exists
4. 🆕 Wrapper endpoint for predefined 2026-06-01 to 2026-07-20 range

**Frontend (Vanilla JS):**
1. 🆕 Trigger button on Ads Dashboard
2. 🆕 Progress tracker component (chunk X/Y, date range)
3. 🆕 Success/error notification display
4. 🆕 Button state management (disabled during execution)

**Database (Google Sheets):**
- ✅ `Ads_Daily_Summary` - Already has UPSERT support
- ✅ Composite key: Date + ShopID
- ✅ Script properties for checkpoint storage

---

## Verification Steps Post-Fix

### Data Completeness Check

```sql
-- Expected rows after backfill: 50 days × 1 shop = 50 rows
SELECT COUNT(*) 
FROM Ads_Daily_Summary 
WHERE Date BETWEEN '2026-06-01' AND '2026-07-20'
-- Expected: 50 rows
```

### Data Integrity Check

```sql
-- Check for duplicates (should be 0)
SELECT Date, ShopID, COUNT(*) as cnt 
FROM Ads_Daily_Summary 
WHERE Date BETWEEN '2026-06-01' AND '2026-07-20'
GROUP BY Date, ShopID 
HAVING cnt > 1
-- Expected: 0 rows
```

### ROAS Calculation Check

```sql
-- Verify ROAS formula: Sales ÷ Spend
SELECT Date, Spend, Sales, ROAS,
       (Sales / Spend) as Calculated_ROAS
FROM Ads_Daily_Summary 
WHERE Date BETWEEN '2026-06-01' AND '2026-07-20'
  AND Spend > 0
-- Verify ROAS column matches calculated value
```

### Source Column Check

```sql
-- All backfilled rows should have correct source
SELECT Date, Source 
FROM Ads_Daily_Summary 
WHERE Date BETWEEN '2026-06-01' AND '2026-07-20'
-- Expected: Source = "Shopee Ads API" or "Historical Backfill"
```

### Dashboard Validation

1. **Navigate to Ads Dashboard**
2. **Set date filter:** 2026-06-01 to 2026-07-20
3. **Verify KPIs display:**
   - Total Spend > 0
   - Total Sales > 0
   - Total Orders > 0
   - ROAS calculated correctly
4. **Check chart series:** Should show daily trend for 50 days

---

## Lessons Learned

### Process Improvements

1. **Initialization Checklist**
   - Add system initialization routine to check for data gaps
   - Prompt user to run historical backfill on first setup
   - Document expected date range coverage

2. **Gap Detection**
   - Implement automatic gap detection in `Ads_Daily_Summary`
   - Log warnings when date range has missing data
   - Display admin notification when gaps detected

3. **Documentation**
   - Document all sync modes (daily vs historical)
   - Create user guide for historical backfill feature
   - Add inline code comments explaining design decisions

4. **Testing Strategy**
   - Add integration test for historical sync
   - Test idempotency (run backfill twice, verify no duplicates)
   - Test checkpoint/resume for timeout scenarios

### Architecture Recommendations

**For Future Features:**

1. **Separation of Concerns**
   - ✅ Daily sync: Last 3 days (maintenance)
   - ✅ Historical sync: Custom ranges (backfill)
   - 🆕 Gap detection: Automatic monitoring
   - 🆕 Initialization: First-run setup wizard

2. **Frontend Visibility**
   - Add "Data Coverage" indicator showing first/last date
   - Display warning banner when gaps exist
   - Provide easy-access buttons for historical sync

3. **Monitoring & Alerts**
   - Log daily sync execution to audit sheet
   - Alert when sync fails or returns 0 rows
   - Track API quota usage for historical sync

---

## Appendix: Code References

### Key Files

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `AdsEngine.gs` | Core sync logic | 7 (constant), 235-375 (daily), 1133-1330 (historical) |
| `AdsAPI.gs` | API endpoints | 1130-1145 (historical endpoint) |
| `AdsDatabase.gs` | UPSERT functions | 361-440 (idempotent UPSERT) |

### Key Constants

```javascript
// src/backend/ShopeeAds/core/AdsEngine.gs:7-9
const ADS_DAILY_SYNC_WINDOW_DAYS = 3;    // Daily sync window
const ADS_HISTORICAL_CHUNK_DAYS = 15;    // Historical sync chunk size
```

### Key Functions

```javascript
// Daily sync (3-day window)
function syncAdsProductDaily() { /* ... */ }

// Historical sync (custom range)
function syncAdsHistoricalRange(startDateInput, endDateInput, options) { /* ... */ }

// Data aggregation
function buildAndUpsertAdsDailySummary(apiSummaryRows) { /* ... */ }

// UPSERT with idempotency
function upsertAdsDailySummaryIdempotent(sheetName, headerRow, dataRows, color) { /* ... */ }
```

---

## Conclusion

The root cause of missing historical data in `Ads_Daily_Summary` is the **intentional design choice** to use a 3-day rolling window for daily maintenance, combined with the fact that the historical sync function (which does exist) was **never triggered** for the missing date range.

The solution is straightforward: create a user-friendly interface to trigger the existing historical sync function for the specific missing date range (2026-06-01 to 2026-07-20). This preserves the existing architecture while filling the data gap.

**Status:** Requirements documented in `.kiro/specs/ads-daily-summary-backfill/requirements.md`

**Next Steps:** 
1. Create design document (technical approach, API specs, UI mockups)
2. Break down into implementation tasks
3. Execute tasks (backend endpoint, frontend button, progress tracking)
4. Test and verify data completeness

---

**Document Version:** 1.0  
**Created:** 2026-08-05  
**Author:** Kiro AI Assistant  
**Related Spec:** `.kiro/specs/ads-daily-summary-backfill/`
