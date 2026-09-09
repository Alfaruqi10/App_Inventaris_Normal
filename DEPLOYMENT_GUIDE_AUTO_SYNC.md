# QUICK DEPLOYMENT GUIDE - AUTOMATIC SYNC

## 🚀 Deploy in 5 Minutes

### Prerequisites
- ✅ Code already deployed to Google Apps Script
- ✅ Shopee OAuth tokens configured
- ✅ Existing manual "Sync" and "Resync Finance" working

---

## Step 1: Deploy Backend Files

Upload these files to Google Apps Script:

```
src/backend/
├── code.gs (UPDATED)
├── ReconciliationWorker.gs (NEW)
└── AutoSyncSetup.gs (NEW)
```

**Changes in code.gs:**
- Line ~7462: `processQueuedWebhookOrders()` - added automatic `updateSalesLedger()` call
- Line ~7819: `autoSyncShopeeOrders()` - added documentation comment

---

## Step 2: Setup Time-Driven Triggers

Open **Google Apps Script Editor** → Run this function **ONCE**:

```javascript
setupAutomaticSyncSystem()
```

**Expected Output (in Logs):**
```
✅ Webhook Queue: Trigger processQueuedWebhookOrders aktif.
✅ Reconciliation: Trigger aktif: reconcileFinanceAutomatically setiap 10 menit.
✅ Auto-Sync: Already active

ACTIVE TRIGGERS:
1. Function: processQueuedWebhookOrders (every 1 minute)
2. Function: reconcileFinanceAutomatically (every 10 minutes)
3. Function: autoSyncShopeeOrders (every 5 minutes)

✅ Automatic synchronization system is now active!
```

---

## Step 3: Verify Installation

Run this function to check everything is working:

```javascript
verifyAutomaticSyncSystem()
```

**Expected Output:**
```
✅ ALL CHECKS PASSED
```

If any checks fail, fix the issues before proceeding.

---

## Step 4: Test with Real Order (Optional)

### Manual Test:
```javascript
testWebhookQueueManually()
```

### Live Test:
1. Place a test order on Shopee
2. Wait 1-2 minutes
3. Check **SalesLedger** sheet → order should appear automatically
4. Check **ShopeeLogs** sheet → look for `AUTO_LEDGER_SYNC` entry

---

## ✅ Installation Complete!

### What Happens Now:

**Automatic Flow:**
```
New Shopee Order
    ↓ (webhook, < 1 sec)
Queue in PropertiesService
    ↓ (1 minute)
processQueuedWebhookOrders()
    ↓
Update ShopeeOrders
    ↓
Update SalesLedger (automatic)
    ↓
Fetch Finance (automatic for COMPLETED orders)
    ↓
Done! (user sees data in 1-2 minutes)
```

**User Action Required:** **NONE** for normal operation

**Manual Buttons:** Still available as emergency fallback

---

## 🔍 Monitoring

### Check Logs:
1. **ShopeeLogs** sheet:
   - Look for `AUTO_LEDGER_SYNC` entries
   - Status should be `SUCCESS`

2. **GAS Execution Logs** (Apps Script Editor → Executions):
   - `processQueuedWebhookOrders` runs every 1 minute
   - `reconcileFinanceAutomatically` runs every 10 minutes
   - `autoSyncShopeeOrders` runs every 5 minutes

3. **SalesLedger Settlement Sync** column:
   - `SUCCESS` = finance synced
   - `FAILED` = will retry automatically
   - `WAITING` = not yet ready

---

## 🔧 Troubleshooting

### Issue: Orders not syncing automatically

**Solution 1: Check triggers**
```javascript
displayActiveTriggers()
```
Expected: 3 triggers active

**Solution 2: Check webhook queue**
```javascript
testWebhookQueueManually()
```

**Solution 3: Check Shopee tokens**
```javascript
var tokens = getShopeeTokens();
Logger.log(tokens);
```

---

### Issue: Finance not fetching

**Check 1: Order status**
- Finance only fetched for COMPLETED/TO_CONFIRM_RECEIVE orders
- PENDING/UNPAID orders will not have finance

**Check 2: Settlement Sync column**
- If `FAILED` → will retry automatically in 10 minutes
- If `WAITING` → order not ready yet

**Check 3: API quota**
- Check Shopee Partner Console for API quota status

---

### Issue: Duplicate orders

**This should NOT happen** (deduplication logic intact).

If duplicates appear:
1. Run diagnostic: `diagnosisWebhook()`
2. Check `normalizeOrderKey()` function
3. Check ShopeeLogs for concurrent processing

---

## ⚠️ Rollback (Disable Automatic Sync)

If you need to disable automatic sync:

```javascript
removeAutomaticSyncSystem()
```

This will:
- Remove all 3 automatic triggers
- Preserve manual "Sync" and "Resync Finance" buttons
- User must manually sync like before

---

## 📊 Expected Performance

### Before Fix:
- User manually clicks "Sync" → 30-60 sec wait
- User manually clicks "Resync Finance" → 30-60 sec wait
- Total: **1-2 minutes manual work per order check**

### After Fix:
- Order automatically synced in **1-2 minutes**
- Finance automatically fetched
- **Zero manual work required**

### Time Saved:
- 50 order checks/day × 2 min = **100 min/day**
- **~50 hours/month** saved

---

## 📝 Important Notes

### ✅ What's Preserved:
- All existing business logic
- Deduplication (order 260816GT1EU4SH remains Qty=1)
- Post-completion return detection (order 26081261H2HSYF remains Retur)
- Finance mapping (0 from API is valid, not replaced)
- Stock deduction (still requires manual approval)
- Manual Sync buttons (emergency fallback)

### ⚠️ What's New:
- Automatic SalesLedger sync after webhook processing
- Reconciliation worker for missed/failed orders
- Conditional finance fetch (quota optimization)
- Retry mechanism for failed syncs

### 🔒 Safety:
- LockService prevents concurrent processing
- Idempotent operations (safe to run multiple times)
- No data loss (only updates, never deletes)
- Manual buttons preserved as fallback

---

## 🆘 Support

If you encounter issues:

1. **Check verification**: `verifyAutomaticSyncSystem()`
2. **Check logs**: ShopeeLogs sheet + GAS Executions
3. **Manual test**: `testWebhookQueueManually()`
4. **Reconciliation test**: `testReconciliationWorkerManually()`

For detailed implementation info, see: `IMPLEMENTATION_REPORT_AUTO_SYNC.md`

---

**Deployment Date:** 2026-08-24  
**Version:** v1.0  
**Status:** ✅ PRODUCTION READY
