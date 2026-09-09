# PHASE 2 JOIA AUDIT — DEPLOYMENT & EXECUTION GUIDE

## 📋 OVERVIEW

Phase 2 Joia Audit adalah **READ-ONLY diagnostic function** yang menginvestigasi kenapa Sales = 0 untuk campaign Joia (479360465) pada tanggal 07/07/2026, padahal terdapat indikasi angka Rp145.500 / Rp145.485.

**Mode**: 100% READ-ONLY (tidak ada database write, tidak ada schema change)

**Target Investigation**:
- Date: 07/07/2026
- CampaignID: 479360465
- Campaign: ANSLA - Joia - Long Outer Wanita
- Ad Type: Individual

---

## 🎯 OBJECTIVES

1. Mengambil **raw API response** untuk campaign 479360465 pada 07/07/2026
2. Membaca data dari **Ads_Product_Daily** dan **Ads_Report**
3. Mengambil **shop total** untuk cross-reference
4. Membangun **comparison matrix** untuk membandingkan semua sources
5. Mengidentifikasi **first point of divergence** (API → DB → Report)
6. Memverifikasi **origin Rp145.500 dan Rp145.485** (campaign-specific vs shop-total)
7. Menentukan **root cause** definitif
8. Memberikan **recommendations** untuk fix (jika diperlukan)

---

## 📂 FILES CREATED

### 1. Phase2JoiaAudit.gs
**Path**: `src/backend/ShopeeAds/core/Phase2JoiaAudit.gs`

**Main Function**: `runPhase2JoiaAudit()`

**Steps**:
- STEP 1: Fetch Raw Campaign API (`get_product_campaign_daily_performance`)
- STEP 2: Read Ads_Product_Daily
- STEP 3: Read Ads_Report
- STEP 4: Fetch Shop Total (`get_all_cpc_ads_daily_performance`)
- STEP 5: Check Automatic Ads
- STEP 6: Build Comparison Matrix
- STEP 7: Trace Code Path
- STEP 8: Identify First Point of Divergence
- STEP 9: Verify Value Origins (145500 / 145485)
- STEP 10: Scan Historical Anomalies
- STEP 11: Determine Root Cause
- STEP 12: Generate Recommendations

**Output**: Comprehensive diagnostic report dengan verdict:
- **CASE A**: APPLICATION PIPELINE BUG (API > 0 → DB = 0)
- **CASE B**: ADS_REPORT AGGREGATION BUG (DB > 0 → Report = 0)
- **CASE C**: NO APPLICATION BUG (semua konsisten = 0)
- **CASE D**: SHOPEE ATTRIBUTION DISCREPANCY (API = 0 tapi Seller Center > 0)
- **CASE E**: INSUFFICIENT DATA
- **CASE F**: UNKNOWN/COMPLEX PATTERN

### 2. Phase2JoiaAuditRunner.gs
**Path**: `src/backend/ShopeeAds/core/Phase2JoiaAuditRunner.gs`

**Main Function**: `executePhase2JoiaAudit()`

**Features**:
- Pre-flight checks (environment validation)
- Wrapper execution dengan error handling
- Automatic summary sheet creation
- Cleanup utilities

**Helper Functions**:
- `runPreflightChecks()` — Validate environment sebelum run
- `writeSummaryToTempSheet()` — Write hasil ke Google Sheet temporary
- `checkPhase2AuditReadiness()` — Quick status check
- `cleanupPhase2AuditSummaries()` — Delete temporary sheets

---

## 🚀 DEPLOYMENT STEPS

### Step 1: Copy Files ke Google Apps Script

1. Buka Google Apps Script project: **App_Inventaris_Normal**
2. Buat file baru: **ShopeeAds/core/Phase2JoiaAudit.gs**
3. Copy-paste isi dari `src/backend/ShopeeAds/core/Phase2JoiaAudit.gs`
4. Buat file baru: **ShopeeAds/core/Phase2JoiaAuditRunner.gs**
5. Copy-paste isi dari `src/backend/ShopeeAds/core/Phase2JoiaAuditRunner.gs`
6. **Save** (Ctrl+S)

### Step 2: Pre-flight Check

Sebelum menjalankan audit, lakukan readiness check:

```javascript
checkPhase2AuditReadiness()
```

Expected output:
```
✅ READY: All preflight checks passed
  - shopeeGet: Available
  - Tokens: Configured
  - Sheets: All exist
  - Data: Available

You can now run: executePhase2JoiaAudit()
```

Jika gagal, fix error yang muncul sebelum lanjut.

### Step 3: Execute Audit

Run main function:

```javascript
executePhase2JoiaAudit()
```

Function ini akan:
1. Run preflight checks
2. Execute 12-step diagnostic audit
3. Generate comprehensive report
4. Write summary ke temporary Google Sheet
5. Return structured result object

---

## 📊 READING THE RESULTS

### 1. Execution Log

Check **Execution Log** di Google Apps Script untuk detailed report:

- View → Execution log (Ctrl+Enter)
- Scroll ke bagian **PHASE 2 READ-ONLY VERIFICATION REPORT**

### 2. Summary Sheet

Audit secara otomatis membuat temporary sheet dengan nama:

```
Phase2_Joia_Audit_Summary_YYYYMMDD_HHMMSS
```

Sheet ini berisi:
- Comparison Matrix (API vs DB vs Report)
- First Point of Divergence
- Root Cause Verdict
- Recommendations

### 3. Return Object

Function `executePhase2JoiaAudit()` return object dengan struktur:

```javascript
{
  status: "success",
  phase: "completed",
  rootCause: {
    case: "CASE A",
    title: "APPLICATION PIPELINE BUG",
    description: "...",
    severity: "CRITICAL",
    actionRequired: "..."
  },
  comparison: {
    Sales: {
      raw_api: ...,
      ads_product_daily: ...,
      ads_report: ...,
      shop_total: ...,
      seller_center: 145500
    },
    Orders: { ... },
    // ... other fields
  },
  divergence: {
    found: true,
    location: "API → Ads_Product_Daily",
    details: "...",
    severity: "CRITICAL"
  },
  recommendations: {
    immediate: [...],
    shortTerm: [...],
    longTerm: [...],
    doNot: [...]
  },
  timestamp: "..."
}
```

---

## 🔍 INTERPRETING RESULTS

### CASE A: APPLICATION PIPELINE BUG

**Meaning**: Raw API mengembalikan Sales > 0, tapi database (Ads_Product_Daily) = 0

**First Divergence**: API → Ads_Product_Daily

**Root Cause**: Data hilang di pipeline (Parser/Mapper/Validator/Writer)

**Action Required**: 
- Identify exact code location di `syncAdsProductDaily()`
- Add logging untuk trace data flow
- Fix bug di Phase 3
- Resync historical data

---

### CASE B: ADS_REPORT AGGREGATION BUG

**Meaning**: Ads_Product_Daily memiliki Sales > 0, tapi Ads_Report = 0

**First Divergence**: Ads_Product_Daily → Ads_Report

**Root Cause**: Bug di aggregation logic (`rebuildAdsReport()`)

**Action Required**:
- Fix aggregation logic di `rebuildAdsReport()`
- Test dengan Joia data
- Rebuild Ads_Report

---

### CASE C: NO APPLICATION BUG

**Meaning**: API, Database, dan Report semua konsisten menunjukkan Sales = 0

**First Divergence**: None

**Root Cause**: Tidak ada bug di application

**Action Required**: 
- Confirm dengan user bahwa Sales = 0 adalah correct
- Close audit
- Update documentation

---

### CASE D: SHOPEE ATTRIBUTION DISCREPANCY

**Meaning**: API = 0, tapi Seller Center UI menunjukkan Sales > 0

**First Divergence**: Shopee API vs Seller Center UI

**Root Cause**: Attribution mismatch antara API endpoint dan Seller Center

**Action Required**:
- Verify correct API endpoint usage
- Check campaign mapping
- Contact Shopee support jika confirmed
- Document attribution differences

---

### CASE E: INSUFFICIENT DATA

**Meaning**: Tidak bisa fetch required data untuk verification

**Root Cause**: API error, missing sheets, atau no data

**Action Required**: Fix data access issues dan re-run

---

### CASE F: UNKNOWN/COMPLEX PATTERN

**Meaning**: Data pattern tidak match standard cases

**Action Required**: Manual deep-dive investigation

---

## 📌 KEY FINDINGS TO LOOK FOR

### 1. Comparison Matrix

Check apakah values **match atau mismatch** di setiap stage:

```
Sales:
  Raw API:           145500  ← Campaign-specific API value
  Ads_Product_Daily: 0       ← Database value (MISMATCH!)
  Ads_Report:        0       ← Report value
  Shop Total:        145485  ← Shop-level (NOT campaign-specific)
  Seller Center:     145500  ← UI value
```

**Interpretation**:
- API = 145500 → Data **ada** dari Shopee
- DB = 0 → Data **hilang** saat write ke database
- Shop Total = 145485 → **Beda** 15 rupiah, ini shop-level bukan Joia-specific

### 2. Value Origin Analysis

Verify apakah 145500 dan 145485 **valid untuk Joia attribution**:

```
145500:
  Found: true
  Valid for Joia: true
  Sources: raw_api_campaign_specific

145485:
  Found: true
  Valid for Joia: false  ← IMPORTANT!
  Sources: shop_total_api
  WARNING: Shop Total is NOT campaign-specific
```

**Interpretation**:
- **145500** = campaign-specific value ✅
- **145485** = shop-total value ❌ (JANGAN gunakan untuk Joia attribution!)

---

## 🚫 CRITICAL WARNINGS

### DO NOT:
1. ❌ **DO NOT** use Shop Total (145485) untuk Joia Individual attribution
2. ❌ **DO NOT** use remainder logic `(shop_total - other_campaigns)` untuk attribution
3. ❌ **DO NOT** modify database schema selama investigation
4. ❌ **DO NOT** assume Seller Center values are campaign-specific tanpa verification
5. ❌ **DO NOT** resync data sebelum root cause confirmed dan fix tested

### DO:
1. ✅ **USE** campaign-specific API endpoint (`get_product_campaign_daily_performance`)
2. ✅ **VERIFY** CampaignID matching (479360465)
3. ✅ **TRACE** exact code path untuk identify data loss location
4. ✅ **LOG** hasil audit untuk documentation
5. ✅ **WAIT** for approval sebelum Phase 3 (fix implementation)

---

## 🧹 CLEANUP

Setelah selesai review, delete temporary summary sheets:

```javascript
cleanupPhase2AuditSummaries()
```

Function ini akan delete semua sheets dengan prefix:
```
Phase2_Joia_Audit_Summary_*
```

---

## 🔄 RE-RUN AUDIT

Jika perlu re-run audit (misal setelah data sync):

1. Clean up previous summaries:
   ```javascript
   cleanupPhase2AuditSummaries()
   ```

2. Re-run audit:
   ```javascript
   executePhase2JoiaAudit()
   ```

3. Compare results dengan previous run

---

## ⚠️ TROUBLESHOOTING

### Error: "shopeeGet function not available"

**Cause**: Function `shopeeGet` belum defined di scope

**Fix**: Pastikan file `code.gs` sudah di-deploy dengan benar

---

### Error: "Sheet not found: Ads_Product_Daily"

**Cause**: Sheet Ads_Product_Daily belum exist

**Fix**: Run `ensureAdsDatabase()` terlebih dahulu

---

### Error: "Shopee tokens not configured"

**Cause**: Credentials belum di-set

**Fix**: 
1. Check Script Properties
2. Verify `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` exist
3. Run `getShopeeTokens()` untuk test

---

### Warning: "Campaign 479360465 not found in API response"

**Possible Causes**:
1. Campaign tidak aktif pada tanggal 07/07/2026
2. Campaign ID salah
3. API tidak return data untuk date range tersebut
4. Rate limit atau network error

**Fix**:
1. Verify campaign exist di Ads_Campaign sheet
2. Check date range di API call
3. Verify API credentials
4. Retry setelah beberapa menit (jika rate limit)

---

### Error: "NOT FOUND in Ads_Product_Daily"

**Possible Causes**:
1. Data belum di-sync untuk tanggal 07/07/2026
2. Campaign 479360465 tidak ada di database
3. Date format mismatch

**Fix**:
1. Run historical sync:
   ```javascript
   syncAdsHistoricalRange("01-07-2026", "10-07-2026")
   ```
2. Re-run audit setelah sync complete

---

## 📚 NEXT STEPS AFTER AUDIT

### If CASE A or CASE B (Application Bug Found):

1. **Review audit report** di execution log dan summary sheet
2. **Identify exact code location** yang menyebabkan data loss
3. **Create bug fix plan** untuk Phase 3
4. **Write unit tests** untuk scenario ini
5. **Test fix** dengan Joia campaign data
6. **Resync historical data** setelah fix deployed
7. **Verify fix** dengan integration tests
8. **Close audit** dengan documentation

### If CASE C (No Bug):

1. **Confirm dengan user** bahwa Sales = 0 adalah expected
2. **Document findings** untuk audit trail
3. **Close audit** as "No Action Required"

### If CASE D (Shopee Attribution Issue):

1. **Document API vs Seller Center discrepancy**
2. **Contact Shopee support** jika perlu clarification
3. **Update expectations** based on API reality
4. **Build reconciliation report** (optional)

---

## 📞 SUPPORT

Jika ada pertanyaan atau issue saat deployment/execution:

1. Check **Execution Log** untuk detailed error messages
2. Review **Pre-flight Check** results
3. Verify **all dependencies** (shopeeGet, tokens, sheets) available
4. Check **API rate limits** jika ada network errors
5. Review **existing codebase** untuk context

---

## ✅ CHECKLIST BEFORE EXECUTION

- [ ] Files deployed ke Google Apps Script
- [ ] Pre-flight check passed (`checkPhase2AuditReadiness()`)
- [ ] Shopee credentials configured
- [ ] Ads_Product_Daily has data
- [ ] Ready to run READ-ONLY audit
- [ ] Execution log viewer open
- [ ] Ready to review results

---

## 🎯 SUCCESS CRITERIA

Audit dianggap **SUCCESS** jika:

1. ✅ All 12 steps executed without fatal errors
2. ✅ Comparison matrix generated dengan complete data
3. ✅ Root cause verdict determined (CASE A-F)
4. ✅ Recommendations provided
5. ✅ Summary sheet created
6. ✅ NO database modifications made
7. ✅ NO schema changes made

---

**END OF DEPLOYMENT GUIDE**

**Status**: Phase 2 Joia Audit READY FOR EXECUTION

**Mode**: 100% READ-ONLY

**Next Action**: Run `executePhase2JoiaAudit()` di Google Apps Script Editor

---

Generated: 2026-08-24T07:12:58Z
