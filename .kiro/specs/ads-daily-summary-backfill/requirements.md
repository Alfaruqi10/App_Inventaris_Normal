# Requirements Document

## Introduction

The Ads Daily Summary Historical Backfill feature enables both manual and automatic detection and filling of missing historical data in the `Ads_Daily_Summary` and `Ads_Product_Daily` sheets. The current system only syncs the last 3 days automatically, leaving a data gap from 2026-06-01 to 2026-07-20 that requires backfill intervention.

This feature provides:
1. **Manual Trigger**: User-friendly frontend interface with a button to trigger backfill for specific date ranges
2. **Automatic Gap Detection**: Self-healing system that detects and fills missing date ranges without manual intervention
3. **SSOT Architecture**: Establishes Ads_Product_Daily as the Single Source of Truth with Ads_Daily_Summary and Ads_Report as derived materialized views
4. **Checksum Validation**: Automated validation that aggregated KPIs match the sum of individual campaigns
5. **Coverage Monitoring**: Continuous monitoring of date range completeness with automatic alerting for gaps

The system ensures idempotent behavior, comprehensive logging, checkpoint/resume capability for timeout handling, and data integrity verification at every stage.

## Glossary

- **Backfill_System**: The complete system component that orchestrates historical data synchronization for the Ads Daily Summary sheet
- **Backfill_API**: The backend Google Apps Script endpoint that processes backfill requests and coordinates data fetching
- **Progress_Tracker**: The frontend component that displays real-time progress information during backfill execution
- **Ads_Daily_Summary**: Google Sheets table containing aggregated daily advertising performance metrics (15 columns: Date, ShopID, Spend, Sales, Orders, SoldQty, Clicks, Impressions, CTR, CPC, CPM, ROAS, ACOS, SyncTime, Source)
- **Ads_Product_Daily**: Single Source of Truth (SSOT) sheet containing raw daily performance data per campaign (18 columns including Date, ShopID, CampaignID, ItemID, ProductName, Spend, Sales, Orders, SoldQty, Clicks, Impressions, CTR, CPC, ROAS, CPM, ACOS, SyncTime, Source)
- **Ads_Report**: Materialized view derived from Ads_Product_Daily for frontend performance optimization (read-only aggregation layer)
- **Chunk**: A subset of the total date range processed in a single API call (maximum 15 days per chunk due to Shopee API constraints)
- **Idempotent_Operation**: An operation that produces the same result when executed multiple times with the same inputs
- **Historical_Sync_Endpoint**: Shopee API endpoint `/api/v2/ads/get_all_cpc_ads_daily_performance` that returns daily aggregated performance data
- **Trigger_Button**: Frontend UI element that initiates the backfill process when clicked
- **Gap_Detection**: Automated system that identifies missing date ranges in Ads_Product_Daily and Ads_Daily_Summary
- **Checksum_Validation**: Verification process that ensures aggregated KPIs in Ads_Daily_Summary match the sum of individual campaigns in Ads_Product_Daily
- **Coverage_Validation**: System that validates date range completeness by comparing expected vs actual date counts
- **User**: The system administrator or operator who manages the inventory and analytics system
- **SSOT** (Single Source of Truth): The authoritative data source that all other views and aggregations derive from

## Requirements

### Requirement 1: Manual Backfill Trigger

**User Story:** As a user, I want to trigger a one-time historical backfill for missing Ads Daily Summary data, so that I can fill the data gap from 2026-06-01 to 2026-07-20.

#### Acceptance Criteria

1. WHEN a user clicks the Trigger_Button on the Ads Dashboard, THE Backfill_System SHALL initiate the backfill process for the predefined date range (2026-06-01 to 2026-07-20)
2. WHEN the backfill process is initiated, THE Backfill_API SHALL call the existing `handleRunHistoricalAdsSync()` function with the specified date range
3. WHEN the backfill process starts, THE Trigger_Button SHALL be disabled to prevent concurrent executions
4. WHEN the backfill process completes or fails, THE Trigger_Button SHALL be re-enabled
5. THE Backfill_System SHALL use the existing Historical_Sync_Endpoint to fetch data

### Requirement 2: Progress Tracking Display

**User Story:** As a user, I want to see real-time progress during the backfill process, so that I know which chunk is being processed and can estimate remaining time.

#### Acceptance Criteria

1. WHEN the backfill process is executing, THE Progress_Tracker SHALL display the current chunk number being processed
2. WHEN the backfill process is executing, THE Progress_Tracker SHALL display the total number of chunks
3. WHEN the backfill process is executing, THE Progress_Tracker SHALL display the date range of the current chunk
4. WHEN a chunk completes successfully, THE Progress_Tracker SHALL update to show the next chunk information
5. WHEN the backfill process completes, THE Progress_Tracker SHALL display a success message with total statistics (chunks processed, rows synced)
6. IF the backfill process fails, THEN THE Progress_Tracker SHALL display an error message with failure details

### Requirement 3: Idempotent Data Synchronization

**User Story:** As a user, I want the backfill process to be idempotent, so that running it multiple times does not create duplicate records in the Ads_Daily_Summary sheet.

#### Acceptance Criteria

1. WHEN the Backfill_System writes data to Ads_Daily_Summary, THE Backfill_System SHALL use UPSERT logic based on the composite key (Date + ShopID)
2. WHEN a row with the same Date and ShopID already exists, THE Backfill_System SHALL update the existing row instead of inserting a new row
3. WHEN the backfill process is run multiple times for the same date range, THE Ads_Daily_Summary SHALL contain no duplicate entries
4. THE Backfill_System SHALL preserve existing data outside the backfill date range

### Requirement 4: Error Handling and Recovery

**User Story:** As a user, I want the backfill process to handle errors gracefully and allow me to retry, so that I can recover from failures without losing progress.

#### Acceptance Criteria

1. IF a chunk fetch fails due to network error, THEN THE Backfill_System SHALL log the error and continue processing remaining chunks
2. IF the Google Apps Script execution timeout is approaching, THEN THE Backfill_System SHALL save a checkpoint with the last completed chunk index
3. WHEN the user retries after a failure, THE Backfill_System SHALL resume from the last completed chunk checkpoint
4. WHEN all chunks complete successfully, THE Backfill_System SHALL clear the checkpoint data
5. IF the Shopee API returns an error response, THEN THE Backfill_System SHALL log the error details and mark that chunk as failed
6. WHEN the backfill process encounters errors, THE Backfill_API SHALL return a detailed error response including which chunks succeeded and which failed

### Requirement 5: Date Range Chunking

**User Story:** As a system administrator, I want the backfill to automatically split large date ranges into manageable chunks, so that the process completes within Google Apps Script execution limits.

#### Acceptance Criteria

1. WHEN the backfill process starts, THE Backfill_System SHALL calculate the total number of days between start date and end date
2. WHEN the total date range exceeds 15 days, THE Backfill_System SHALL split the range into multiple chunks of maximum 15 days each
3. WHEN processing chunks, THE Backfill_System SHALL process chunks sequentially (not in parallel)
4. THE Backfill_System SHALL use the existing `ADS_HISTORICAL_CHUNK_DAYS` constant (value: 15) to determine chunk size
5. WHEN calculating chunks, THE Backfill_System SHALL ensure no date is omitted or duplicated across chunks

### Requirement 6: Frontend Integration

**User Story:** As a user, I want a clearly labeled button on the Ads Dashboard to trigger the backfill, so that I can easily initiate the process without technical knowledge.

#### Acceptance Criteria

1. THE Ads Dashboard SHALL display a Trigger_Button labeled "Backfill Missing Data (June 1 - July 20)"
2. WHEN the Trigger_Button is rendered, THE Ads Dashboard SHALL display the target date range (2026-06-01 to 2026-07-20) in the button label or nearby text
3. THE Trigger_Button SHALL be styled consistently with other dashboard action buttons
4. WHEN clicked, THE Trigger_Button SHALL call the Backfill_API endpoint via AJAX
5. THE Progress_Tracker SHALL be positioned below or adjacent to the Trigger_Button for visibility

### Requirement 7: Data Integrity Verification

**User Story:** As a system administrator, I want the backfill process to verify data integrity after completion, so that I can confirm the data was synchronized correctly.

#### Acceptance Criteria

1. WHEN the backfill process completes, THE Backfill_System SHALL call the existing `verifyAdsDataIntegrity()` function
2. WHEN integrity verification completes, THE Backfill_System SHALL include integrity check results in the completion response
3. THE Backfill_System SHALL log all data write operations for audit purposes
4. WHEN the backfill writes to Ads_Daily_Summary, THE Backfill_System SHALL record the SyncTime timestamp in Jakarta timezone
5. WHEN the backfill writes to Ads_Daily_Summary, THE Backfill_System SHALL set the Source column to "Historical Backfill"

### Requirement 8: Performance Optimization

**User Story:** As a system administrator, I want the backfill process to complete efficiently, so that it does not timeout or consume excessive resources.

#### Acceptance Criteria

1. THE Backfill_System SHALL reuse existing Google Sheets connections instead of creating new connections for each chunk
2. THE Backfill_System SHALL batch write operations where possible to minimize API calls
3. THE Backfill_System SHALL use the existing `upsertAdsDailySummaryIdempotent()` function for efficient data writes
4. WHEN processing multiple chunks, THE Backfill_System SHALL accumulate rows in memory and write in batches rather than writing after each chunk
5. THE Backfill_System SHALL complete the entire backfill process (50 days) within 5 minutes under normal conditions

### Requirement 9: Logging and Monitoring

**User Story:** As a system administrator, I want comprehensive logs of the backfill process, so that I can troubleshoot issues and verify successful execution.

#### Acceptance Criteria

1. WHEN the backfill process starts, THE Backfill_System SHALL log the start timestamp, date range, and total number of chunks
2. WHEN each chunk is processed, THE Backfill_System SHALL log the chunk number, date range, and number of rows fetched
3. WHEN the backfill process completes, THE Backfill_System SHALL log the completion timestamp, total rows synced, and total chunks processed
4. IF any errors occur, THEN THE Backfill_System SHALL log the error message, chunk number, and stack trace
5. THE Backfill_System SHALL use the existing `Logger.log()` function for all logging operations
6. WHEN the backfill completes, THE Backfill_System SHALL update the `LAST_HISTORICAL_SYNC` script property with the completion timestamp

### Requirement 10: Preservation of Existing Architecture

**User Story:** As a developer, I want the backfill feature to reuse existing sync functions, so that the codebase remains maintainable and consistent.

#### Acceptance Criteria

1. THE Backfill_System SHALL reuse the existing `handleRunHistoricalAdsSync()` function for backend processing
2. THE Backfill_System SHALL reuse the existing `syncAdsHistoricalRange()` function for data fetching
3. THE Backfill_System SHALL reuse the existing `buildAndUpsertAdsDailySummary()` function for data aggregation
4. THE Backfill_System SHALL NOT modify the existing daily sync behavior (3-day rolling window)
5. THE Backfill_System SHALL NOT modify the value of `ADS_DAILY_SYNC_WINDOW_DAYS` constant
6. THE Backfill_System SHALL use the existing `shopeeGet()` function for all Shopee API calls

### Requirement 11: Automatic Gap Detection and Backfill

**User Story:** As a system administrator, I want the system to automatically detect missing historical data and trigger backfill, so that data gaps are self-healing without manual intervention.

#### Acceptance Criteria

1. WHEN `ensureAdsDatabase()` is called, THE Backfill_System SHALL check if Ads_Product_Daily sheet is empty or has fewer than expected rows
2. IF Ads_Product_Daily is empty OR earliest date is later than "2026-06-01", THEN THE Backfill_System SHALL automatically trigger historical backfill from "2026-06-01" to the earliest existing date
3. WHEN the Backfill_System detects gaps (missing dates between earliest and latest date), THE Backfill_System SHALL log a warning with gap details (start date, end date, total missing days)
4. WHEN a gap is detected, THE Backfill_System SHALL provide an API endpoint to auto-fill detected gaps without manual date specification
5. THE Backfill_System SHALL store the last gap detection timestamp in ScriptProperties to avoid excessive detection calls (maximum once per hour)
6. WHEN automatic backfill is triggered, THE Backfill_System SHALL log the reason (empty database, gap detected, earliest date validation) and date range being filled

### Requirement 12: Single Source of Truth (SSOT) Architecture

**User Story:** As a developer, I want Ads_Product_Daily to be the authoritative source of truth, so that all aggregations and reports are derived from a consistent base layer.

#### Acceptance Criteria

1. THE Backfill_System SHALL designate Ads_Product_Daily as the Single Source of Truth (SSOT) for all Ads data
2. WHEN Ads_Daily_Summary is built or rebuilt, THE Backfill_System SHALL ONLY read from Ads_Product_Daily (never from Shopee API directly except during initial sync)
3. WHEN Ads_Report is built or rebuilt, THE Backfill_System SHALL ONLY read from Ads_Product_Daily (materialized view pattern)
4. THE Backfill_System SHALL ensure all writes to Ads_Product_Daily happen BEFORE any aggregation to Ads_Daily_Summary or Ads_Report
5. IF Ads_Product_Daily has inconsistencies or missing data, THEN THE Backfill_System SHALL NOT proceed with aggregation and SHALL return an error indicating SSOT data quality issue
6. THE Backfill_System SHALL include SSOT validation in the `verifyAdsDataIntegrity()` function to ensure Ads_Product_Daily completeness before aggregation

### Requirement 13: Checksum Validation After Rebuild

**User Story:** As a system administrator, I want automated checksum validation after every rebuild, so that aggregation accuracy is guaranteed and data integrity issues are detected immediately.

#### Acceptance Criteria

1. WHEN `buildAndUpsertAdsDailySummary()` completes, THE Backfill_System SHALL automatically execute checksum validation for all KPIs
2. THE Backfill_System SHALL validate that for each date in Ads_Daily_Summary, the aggregated values (Spend, Sales, Orders, SoldQty, Clicks, Impressions) match the SUM of all campaigns for that date in Ads_Product_Daily
3. IF checksum mismatch is detected, THEN THE Backfill_System SHALL log the discrepancy details including date, expected value, actual value, and delta percentage
4. WHEN checksum validation fails, THE Backfill_System SHALL write failure details to Ads_Data_Integrity sheet with columns: Date, Metric, ExpectedValue, ActualValue, Delta, DeltaPercentage, ValidationTime
5. THE Backfill_System SHALL set a tolerance threshold of 0.01% for floating-point rounding differences (values within 0.01% are considered valid)
6. WHEN checksum validation completes, THE Backfill_System SHALL return validation statistics including total dates validated, dates passed, dates failed, and total discrepancies found

### Requirement 14: Coverage Validation and Monitoring

**User Story:** As a system administrator, I want automated coverage validation to detect missing dates and incomplete data ranges, so that historical data completeness is continuously monitored.

#### Acceptance Criteria

1. THE Backfill_System SHALL implement a `validateAdsCoverage()` function that executes after every sync or rebuild operation
2. WHEN coverage validation runs, THE Backfill_System SHALL calculate: earliest date, latest date, expected day count (latest - earliest + 1), actual row count, and missing day count
3. THE Backfill_System SHALL identify all missing dates between earliest and latest date by comparing the date sequence in Ads_Product_Daily against an expected sequential date list
4. WHEN missing dates are detected, THE Backfill_System SHALL log a warning with details: total missing days, list of missing date ranges (e.g., "2026-06-05 to 2026-06-08, 2026-06-15")
5. THE Backfill_System SHALL write coverage validation results to Ads_Data_Integrity sheet with columns: ValidationTime, EarliestDate, LatestDate, ExpectedDays, ActualDays, MissingDays, MissingDateRanges, CoveragePercentage
6. WHEN coverage is below 95% (more than 5% of expected days missing), THE Backfill_System SHALL flag the validation result as "CRITICAL" and recommend triggering historical backfill
7. THE Backfill_System SHALL expose coverage metrics via the `handleGetAdsDashboard()` API response to display coverage status on the frontend dashboard
