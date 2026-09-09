# Implementation Plan: Ads Daily Summary Historical Backfill

## Overview

This implementation follows a **4-phase rollout strategy** to transform the Ads data pipeline from reactive to self-healing with continuous validation. The feature establishes **Ads_Product_Daily as the Single Source of Truth (SSOT)**, implements automatic gap detection, and adds checksum/coverage validation after every rebuild.

**Key Technical Challenges:**
- **Breaking Change**: `buildAndUpsertAdsDailySummary()` signature change requires updating all callers
- **SSOT Migration**: All aggregation must read from Ads_Product_Daily, never directly from API
- **Validation Integration**: Auto-trigger checksum and coverage validation after every rebuild
- **Gap Detection Throttling**: Maximum once per hour to avoid excessive checks

**Technology Stack:** Google Apps Script, Vanilla JavaScript, Google Sheets API

---

## Tasks

### Phase 1: Core Infrastructure and SSOT Refactoring

- [ ] 1. Create Ads_Data_Integrity sheet and validation infrastructure
  - Create new sheet `Ads_Data_Integrity` with 18 columns: ValidationID, ValidationTime, ValidationType, Status, Date, Metric, ExpectedValue, ActualValue, Delta, DeltaPercent, EarliestDate, LatestDate, ExpectedDays, ActualDays, MissingDays, MissingDateRanges, CoveragePercent, Notes
  - Set header row formatting (teal background #047857, white text)
  - Add freeze to header row (row 1)
  - _Requirements: 13.4, 14.5_

- [ ] 2. Implement SSOT-based aggregation in buildAndUpsertAdsDailySummary()
  - [~] 2.1 Modify buildAndUpsertAdsDailySummary() signature to remove apiSummaryRows parameter
    - **BREAKING CHANGE**: Remove `apiSummaryRows` parameter from function signature
    - Change function to read directly from Ads_Product_Daily sheet using `readSheetObjects()`
    - _Requirements: 12.2, 12.4_
  
  - [~] 2.2 Implement date-based aggregation logic
    - Parse dates from Ads_Product_Daily using `parseAdsDateToISO()`
    - Create `summaryByDate` object to aggregate by date: `{ spend, sales, orders, soldQty, clicks, impressions }`
    - Accumulate values for each date from all campaign rows
    - _Requirements: 12.2, 13.2_
  
  - [~] 2.3 Compute derived KPIs and prepare summary rows
    - Calculate CTR, CPC, CPM, ROAS, ACOS from aggregated values
    - Format rows for Ads_Daily_Summary with all 15 columns
    - Set Source column to "Aggregated from SSOT"
    - Set SyncTime to Jakarta timezone using `getJakartaTimeString()`
    - _Requirements: 12.2, 7.4, 7.5_
  
  - [~] 2.4 Integrate automatic checksum validation after rebuild
    - Call `validateAdsChecksum()` after UPSERT operation completes
    - Log checksum validation results
    - Return checksum result object to caller
    - _Requirements: 13.1, 13.6_

- [ ] 3. Update all callers of buildAndUpsertAdsDailySummary() to remove API parameter
  - [~] 3.1 Modify syncAdsProductDaily() function
    - Remove API summary fetch logic
    - Call `buildAndUpsertAdsDailySummary()` without parameters
    - _Requirements: 12.2, 10.3_
  
  - [~] 3.2 Modify syncAdsHistoricalRange() function
    - Remove API summary fetch logic
    - Call `buildAndUpsertAdsDailySummary()` without parameters
    - _Requirements: 12.2, 10.2_
  
  - [~] 3.3 Modify handleRunHistoricalAdsSync() function
    - Ensure it calls updated `buildAndUpsertAdsDailySummary()` without parameters
    - _Requirements: 12.2, 10.1_

- [~] 4. Checkpoint - Verify SSOT refactoring
  - Ensure all tests pass, verify no breaking changes in daily sync behavior, ask the user if questions arise.

### Phase 2: Validation Engines (Checksum + Coverage)

- [ ] 5. Implement checksum validation engine
  - [~] 5.1 Create validateAdsChecksum() function
    - Read all rows from Ads_Product_Daily using `readSheetObjects()`
    - Read all rows from Ads_Daily_Summary using `readSheetObjects()`
    - _Requirements: 13.1, 13.2_
  
  - [~] 5.2 Build expected sums by date from SSOT
    - Create `expectedByDate` object aggregating Spend, Sales, Orders, SoldQty, Clicks, Impressions
    - Parse dates using `parseAdsDateToISO()` and filter invalid dates
    - _Requirements: 13.2_
  
  - [~] 5.3 Compare actual vs expected values with tolerance
    - Set tolerance threshold to 0.01% (0.0001)
    - Compare 6 metrics: Spend, Sales, Orders, SoldQty, Clicks, Impressions
    - Calculate delta and deltaPercent for each metric
    - Collect discrepancies where deltaPercent > tolerance
    - _Requirements: 13.2, 13.3, 13.5_
  
  - [~] 5.4 Create writeAdsChecksumDiscrepancies() helper function
    - Generate UUID for validationID using `Utilities.getUuid()`
    - Get Jakarta timestamp using `getJakartaTimeString()`
    - Format discrepancy rows with all required columns
    - Set ValidationType to "checksum", Status to "failed"
    - Append to Ads_Data_Integrity sheet
    - _Requirements: 13.4_
  
  - [~] 5.5 Return validation statistics
    - Return object with: status ("passed"/"failed"), validatedDates count, discrepancies array
    - Log success message with ✅ emoji or failure message with ❌ emoji
    - _Requirements: 13.6_

- [ ] 6. Implement coverage validation engine
  - [~] 6.1 Create validateAdsCoverage() function
    - Read all rows from Ads_Product_Daily using `readSheetObjects()`
    - Extract unique dates using `parseAdsDateToISO()` and sort
    - Handle empty database case (return early with status: "empty")
    - _Requirements: 14.1, 14.2_
  
  - [~] 6.2 Calculate coverage metrics
    - Find earliest and latest dates
    - Calculate expected days: `floor((latest - earliest) / 86400000) + 1`
    - Calculate actual days from unique date count
    - Calculate missing days: `expected - actual`
    - Calculate coverage percentage: `(actual / expected) * 100`
    - _Requirements: 14.2_
  
  - [~] 6.3 Detect missing date ranges
    - Iterate through sorted unique dates
    - Find gaps where `nextDate - currentDate > 1 day`
    - Format missing ranges as "YYYY-MM-DD to YYYY-MM-DD"
    - Join all missing ranges with ", "
    - _Requirements: 14.3, 14.4_
  
  - [~] 6.4 Determine coverage status
    - Set status to "critical" if coverage < 80%
    - Set status to "warning" if coverage < 95%
    - Set status to "ok" otherwise
    - _Requirements: 14.6_
  
  - [~] 6.5 Create writeCoverageValidationResult() helper function
    - Generate UUID for validationID
    - Get Jakarta timestamp
    - Format row with coverage metrics and empty checksum fields
    - Set ValidationType to "coverage"
    - Append to Ads_Data_Integrity sheet
    - _Requirements: 14.5_
  
  - [~] 6.6 Return coverage result object
    - Return: status, earliest, latest, expectedDays, actualDays, missingDays, coveragePercent, missingRanges
    - Log coverage validation summary
    - _Requirements: 14.5_

- [~] 7. Checkpoint - Verify validation engines
  - Ensure all tests pass, verify checksum and coverage validation work independently, ask the user if questions arise.

### Phase 3: Gap Detection and Auto-Backfill

- [ ] 8. Implement gap detection helper functions
  - [~] 8.1 Create findDateGaps() helper function
    - Accept sorted unique dates array, earliest date, latest date
    - Iterate through dates and calculate daysDiff between consecutive dates
    - When daysDiff > 1, create gap object: `{ startDate, endDate, missingDays }`
    - Return array of gap objects
    - _Requirements: 11.3_

- [ ] 9. Implement core gap detection engine
  - [~] 9.1 Create detectAndFillAdsGaps() function with throttle check
    - Get last check timestamp from ScriptProperties using key "LAST_GAP_CHECK"
    - If last check was within 1 hour (3600000 ms), return early with status "skipped"
    - _Requirements: 11.5_
  
  - [~] 9.2 Handle empty database case
    - Read Ads_Product_Daily using `readSheetObjects()`
    - If empty, log "Empty database detected"
    - Call `syncAdsHistoricalRange("01-06-2026", currentDate)`
    - Update LAST_GAP_CHECK timestamp
    - Return with status "success", reason "Empty database", action "Full backfill"
    - _Requirements: 11.1, 11.6_
  
  - [~] 9.3 Handle earliest date validation
    - Extract and sort all dates from Ads_Product_Daily
    - Find earliest date in dataset
    - If earliest > "2026-06-01", trigger backfill from "2026-06-01" to earliest
    - Update LAST_GAP_CHECK timestamp
    - _Requirements: 11.2, 11.6_
  
  - [~] 9.4 Handle internal gap detection
    - Call `findDateGaps(dates, earliest, latest)`
    - If gaps found, calculate total missing days
    - For gaps ≤ 30 days: auto-fill all gaps by calling `syncAdsHistoricalRange()` for each gap
    - For gaps > 30 days: return warning with gap details (manual review required)
    - Update LAST_GAP_CHECK timestamp only after successful processing
    - _Requirements: 11.3, 11.4, 11.6_

- [ ] 10. Integrate gap detection into database initialization
  - [~] 10.1 Modify ensureAdsDatabase() to call gap detection
    - After creating all required sheets, call `detectAndFillAdsGaps()`
    - Log gap detection result
    - Do NOT block database initialization on gap detection failure
    - _Requirements: 11.1_

- [~] 11. Checkpoint - Verify gap detection integration
  - Ensure all tests pass, verify gap detection triggers correctly on database init, verify throttling works, ask the user if questions arise.

### Phase 4: Frontend Integration and Manual Trigger

- [ ] 12. Enhance backend API for frontend integration
  - [~] 12.1 Update handleRunHistoricalAdsSync() to return enhanced response
    - Add validation results to response object (checksum + coverage)
    - Include execution statistics: totalDays, chunksProcessed, rowsSynced, executionTime
    - Handle partial success case with checkpoint information
    - Return detailed error response with code and message
    - _Requirements: 4.6, 7.2_
  
  - [~] 12.2 Enhance handleGetAdsDashboard() to include coverage metrics
    - Call `validateAdsCoverage()` before returning dashboard data
    - Add coverage field to response: `{ earliestDate, latestDate, coveragePercent, expectedDays, actualDays, missingDays, missingRanges, status }`
    - _Requirements: 14.7_

- [ ] 13. Create frontend backfill button component
  - [~] 13.1 Add HTML structure for backfill section
    - Create container div with class "ads-backfill-section"
    - Add button with id "btnBackfillAds" and label "Backfill Missing Data (June 1 - July 20)"
    - Add progress container div (initially hidden)
    - Add result message container (initially hidden)
    - _Requirements: 6.1, 6.2, 6.5_
  
  - [~] 13.2 Create AdsBackfillManager JavaScript class
    - Implement constructor with DOM element references
    - Attach click event listener to backfill button
    - _Requirements: 6.4_
  
  - [~] 13.3 Implement triggerBackfill() method
    - Disable button and change text to "Processing..."
    - Show progress container
    - Make POST request to backend with action "runHistoricalAdsSync"
    - Pass startDate "01-06-2026" and endDate "20-07-2026"
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [~] 13.4 Implement response handlers
    - Create showSuccess() method to display completion stats and validation results
    - Create showPartialSuccess() method to display checkpoint and retry button
    - Create showError() method to display error message
    - Re-enable button after completion/failure
    - _Requirements: 1.4, 2.5, 2.6, 4.6_

- [ ] 14. Create frontend coverage badge component
  - [~] 14.1 Add HTML structure for coverage badge
    - Create container div with class "coverage-badge-container"
    - Add badge div with icon, label "Data Coverage", value placeholder, and status indicator
    - Add details section for date range and missing days
    - _Requirements: 14.7_
  
  - [~] 14.2 Create AdsCoverageBadge JavaScript class
    - Implement constructor with DOM element references
    - Implement fetchCoverage() method to call backend API
    - _Requirements: 14.7_
  
  - [~] 14.3 Implement updateBadge() method
    - Update coverage percentage text
    - Set status badge (Excellent/Incomplete/Critical) based on status field
    - Update details with date range, actual/expected days, missing ranges
    - Apply color coding: green for "ok", orange for "warning", red for "critical"
    - _Requirements: 14.7_

- [~] 15. Add CSS styling for frontend components
  - Style backfill button consistently with existing dashboard buttons
  - Style progress bar with animation
  - Style result messages (success: green, warning: orange, error: red)
  - Style coverage badge with border color based on status
  - Ensure mobile-responsive design
  - _Requirements: 6.3_

- [~] 16. Final checkpoint - End-to-end validation
  - Test manual backfill trigger from frontend
  - Verify progress tracking displays correctly
  - Verify coverage badge updates after backfill
  - Verify idempotent behavior (run backfill twice, check for duplicates)
  - Verify checksum validation catches aggregation errors
  - Verify coverage validation detects missing dates
  - Verify gap detection triggers automatically on database init
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- **CRITICAL**: Phase 1 contains breaking changes. Test thoroughly before deploying.
- **SSOT Migration**: After Phase 1, Ads_Product_Daily becomes the authoritative source. All aggregations must read from it.
- **Validation Integration**: Checksum and coverage validation run automatically after every rebuild/sync operation.
- **Gap Detection Throttling**: Maximum once per hour to avoid excessive ScriptProperties reads.
- **Checkpoint/Resume**: Error handling includes checkpoint storage for large backfills that timeout.
- **Idempotent Design**: All operations use UPSERT logic based on composite keys to prevent duplicates.
- Each task references specific requirements for traceability.
- Tasks build incrementally - each phase depends on the previous phase being complete.
