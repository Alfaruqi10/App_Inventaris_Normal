import express from 'express';
import { featureFlagProxy } from './proxy.js';
import { sendCompatibleResponse } from '../controllers/adapter.js';

const router = express.Router();

/**
 * Pemetaan Aksi (Action) ke Feature Flag nama variabel lingkungan.
 */
const ACTION_FLAGS = {
  // --- Modul 1: Dashboard & KPI ---
  'getOrdersKPI': 'FLAG_DASHBOARD',
  'getData': 'FLAG_DASHBOARD',
  'getSystemHealth': 'FLAG_SYSTEM_HEALTH',

  // --- Modul 2: Authentication ---
  'login': 'FLAG_AUTH',
  'register': 'FLAG_AUTH',
  'getUsers': 'FLAG_AUTH',
  'updateUser': 'FLAG_AUTH',
  'resetPassword': 'FLAG_AUTH',
  'toggleUserStatus': 'FLAG_AUTH',

  // --- Modul 3: Master Barang ---
  'getMasterBarangList': 'FLAG_MASTER_BARANG',
  'editProduk': 'FLAG_MASTER_BARANG',
  'toggleProdukStatus': 'FLAG_MASTER_BARANG',
  'hapusProduk': 'FLAG_MASTER_BARANG',

  // --- Modul 4: Shopee Integration ---
  'syncShopeeProducts': 'FLAG_SHOPEE',
  'saveShopeeMapping': 'FLAG_SHOPEE',
  'deleteShopeeMapping': 'FLAG_SHOPEE',
  'getShopeeProducts': 'FLAG_SHOPEE',
  'getShopeeMappings': 'FLAG_SHOPEE',
  'getShopeeOrders': 'FLAG_SHOPEE',
  'getShopeeLogs': 'FLAG_SHOPEE',
  'getShopeeProductsPaged': 'FLAG_SHOPEE',
  'getShopeeOrdersPaged': 'FLAG_SHOPEE',
  'syncShopeeOrders': 'FLAG_SHOPEE',
  'shopeeOAuthCallback': 'FLAG_SHOPEE',
  'checkShopeeAuth': 'FLAG_SHOPEE',
  'getShopeeAuthUrl': 'FLAG_SHOPEE',
  'getAutoSuggestMapping': 'FLAG_SHOPEE',

  // --- Modul 5: Telegram Bot ---
  'getTelegramStatus': 'FLAG_TELEGRAM',
  'getTelegramLogs': 'FLAG_TELEGRAM',
  'getTelegramUsers': 'FLAG_TELEGRAM',
  'updateTelegramUser': 'FLAG_TELEGRAM',
  'deleteTelegramUser': 'FLAG_TELEGRAM',
  'broadcastTelegram': 'FLAG_TELEGRAM',
  'getTelegramDashboardData': 'FLAG_TELEGRAM',
  'getTelegramSubscribers': 'FLAG_TELEGRAM',
  'approveTelegramSubscriber': 'FLAG_TELEGRAM',
  'disableTelegramSubscriber': 'FLAG_TELEGRAM',
  'getTelegramTemplates': 'FLAG_TELEGRAM',
  'updateTelegramTemplate': 'FLAG_TELEGRAM',
  'testTelegramSubscriberNotification': 'FLAG_TELEGRAM',
  'getTelegramQueueHistory': 'FLAG_TELEGRAM',
  'getTelegramSettings': 'FLAG_TELEGRAM',
  'saveTelegramSettings': 'FLAG_TELEGRAM',
  'simulateTelegramWebhook': 'FLAG_TELEGRAM',
  'telegramWebhook': 'FLAG_TELEGRAM',
  'saveSubscriberRules': 'FLAG_TELEGRAM',
  'getTelegramDLQ': 'FLAG_TELEGRAM',
  'retryDLQMessage': 'FLAG_TELEGRAM',

  // --- Modul 6: Recovery Center Core ---
  'getRecoveryRegistry': 'FLAG_RECOVERY',
  'executeRecoveryTool': 'FLAG_RECOVERY',
  'getRecoveryJobHistory': 'FLAG_RECOVERY',

  // --- Modul 7: Order & Stock Deduction ---
  'getStockBySku': 'FLAG_ORDER_DEDUCTION',
  'approveDeduction': 'FLAG_ORDER_DEDUCTION',
  'bulkApproveDeduction': 'FLAG_ORDER_DEDUCTION',
  'skipDeduction': 'FLAG_ORDER_DEDUCTION',
  'bulkSkipDeduction': 'FLAG_ORDER_DEDUCTION',
  'undoSkip': 'FLAG_ORDER_DEDUCTION',
  'retryDeduction': 'FLAG_ORDER_DEDUCTION',

  // --- Modul 8: Analytics & Ads ---
  'getSalesLedgerPagedV2': 'FLAG_ANALYTICS_REPORTING',
  'getSalesLedgerKPIV2': 'FLAG_ANALYTICS_REPORTING',
  'getSalesLedgerDetailV2': 'FLAG_ANALYTICS_REPORTING',
  'resyncFinance': 'FLAG_ANALYTICS_REPORTING',
  'refreshFinance': 'FLAG_ANALYTICS_REPORTING',
  'getSalesLedgerData': 'FLAG_ANALYTICS_REPORTING',
  'getAdsDashboard': 'FLAG_ANALYTICS_REPORTING',
  'getAdsCampaigns': 'FLAG_ANALYTICS_REPORTING',
  'getAdsProductPerformance': 'FLAG_ANALYTICS_REPORTING',
  'getAdsPerformancePaged': 'FLAG_ANALYTICS_REPORTING',
  'getAdsCampaignTrend': 'FLAG_ANALYTICS_REPORTING',
  'toggleAdsCampaign': 'FLAG_ANALYTICS_REPORTING',
};

/**
 * Middleware untuk merutekan request dinamis berdasarkan parameter `action`
 */
router.use(async (req, res, next) => {
  const action = req.method === 'GET' ? req.query.action : req.body?.action;
  
  if (!action) {
    return sendCompatibleResponse(res, {
      status: "error",
      message: "Bad Request: Parameter 'action' wajib dilampirkan."
    });
  }

  const flagName = ACTION_FLAGS[action];
  
  // Jika aksi belum terdaftar, default proxy ke old GAS agar tidak merusak fungsionalitas existing
  if (!flagName) {
    console.log(`[Router] Action '${action}' is not mapped to a feature flag. Defaulting to proxying to Apps Script.`);
    return featureFlagProxy('FLAG_PROXY_ALL')(req, res, next);
  }

  // Evaluasi feature flag menggunakan proxy middleware
  return featureFlagProxy(flagName)(req, res, next);
});

// --- LOCAL NODE.JS CONTROLLER MAPPINGS ---
// Di bawah ini kita akan mendaftarkan endpoint lokal setelah feature flag dilewati (FLAG = true)

// Modul 1: Dashboard & System Health (Read-Only)
router.get('/', async (req, res) => {
  const action = req.query.action;
  
  if (action === 'getSystemHealth') {
    // Panggil controller lokal Node.js
    const { getSystemHealth } = await import('../controllers/systemHealthController.js');
    return getSystemHealth(req, res);
  }
  
  if (action === 'getOrdersKPI') {
    const { getOrdersKPI } = await import('../controllers/dashboardController.js');
    return getOrdersKPI(req, res);
  }

  if (action === 'getData') {
    const { getData } = await import('../controllers/dashboardController.js');
    return getData(req, res);
  }

  // Modul 2: User Authentication
  if (action === 'getUsers') {
    const { getUsers } = await import('../controllers/userController.js');
    return getUsers(req, res);
  }

  // Modul 3: Master Barang (GET)
  if (action === 'getMasterBarangList') {
    const { getMasterBarangList } = await import('../controllers/masterBarangController.js');
    return getMasterBarangList(req, res);
  }

  // Modul 4: Shopee Integration (GET)
  if (action === 'getShopeeProducts') {
    const { getShopeeProducts } = await import('../controllers/shopeeController.js');
    return getShopeeProducts(req, res);
  }

  if (action === 'getShopeeMappings') {
    const { getShopeeMappings } = await import('../controllers/shopeeController.js');
    return getShopeeMappings(req, res);
  }

  if (action === 'getShopeeOrders') {
    const { getShopeeOrders } = await import('../controllers/shopeeController.js');
    return getShopeeOrders(req, res);
  }

  if (action === 'getShopeeLogs') {
    const { getShopeeLogs } = await import('../controllers/shopeeController.js');
    return getShopeeLogs(req, res);
  }

  if (action === 'checkShopeeAuth') {
    const { checkShopeeAuth } = await import('../controllers/shopeeController.js');
    return checkShopeeAuth(req, res);
  }

  if (action === 'getShopeeAuthUrl') {
    const { getShopeeAuthUrl } = await import('../controllers/shopeeController.js');
    return getShopeeAuthUrl(req, res);
  }

  if (action === 'getShopeeProductsPaged') {
    const { getShopeeProductsPaged } = await import('../controllers/shopeeController.js');
    return getShopeeProductsPaged(req, res);
  }

  if (action === 'getShopeeOrdersPaged') {
    const { getShopeeOrdersPaged } = await import('../controllers/shopeeController.js');
    return getShopeeOrdersPaged(req, res);
  }

  // Modul 7: Stock & Order Deduction (GET)
  if (action === 'getStockBySku') {
    const { getStockBySku } = await import('../controllers/deductionController.js');
    return getStockBySku(req, res);
  }

  // Modul 5: Telegram Bot (GET)
  if (action === 'getTelegramStatus') {
    const { getTelegramStatus } = await import('../controllers/telegramController.js');
    return getTelegramStatus(req, res);
  }

  if (action === 'getTelegramLogs') {
    const { getTelegramLogs } = await import('../controllers/telegramController.js');
    return getTelegramLogs(req, res);
  }

  if (action === 'getTelegramUsers') {
    const { getTelegramUsers } = await import('../controllers/telegramController.js');
    return getTelegramUsers(req, res);
  }

  if (action === 'getTelegramDashboardData') {
    const { getTelegramStatus } = await import('../controllers/telegramController.js');
    return getTelegramStatus(req, res);
  }

  if (action === 'getTelegramSubscribers') {
    const { getTelegramSubscribers } = await import('../controllers/telegramController.js');
    return getTelegramSubscribers(req, res);
  }

  if (action === 'getTelegramTemplates') {
    const { getTelegramTemplates } = await import('../controllers/telegramController.js');
    return getTelegramTemplates(req, res);
  }

  if (action === 'getTelegramQueueHistory') {
    const { getTelegramQueueHistory } = await import('../controllers/telegramController.js');
    return getTelegramQueueHistory(req, res);
  }

  if (action === 'getTelegramSettings') {
    const { getTelegramSettings } = await import('../controllers/telegramController.js');
    return getTelegramSettings(req, res);
  }

  if (action === 'getTelegramDLQ') {
    const { getTelegramDLQ } = await import('../controllers/telegramController.js');
    return getTelegramDLQ(req, res);
  }

  // Modul 8: Analytics, Reporting & Ads (GET)
  if (action === 'getSalesLedgerPagedV2') {
    const { getSalesLedgerPagedV2 } = await import('../controllers/financeController.js');
    return getSalesLedgerPagedV2(req, res);
  }

  if (action === 'getSalesLedgerKPIV2') {
    const { getSalesLedgerKPIV2 } = await import('../controllers/financeController.js');
    return getSalesLedgerKPIV2(req, res);
  }

  if (action === 'getSalesLedgerDetailV2') {
    const { getSalesLedgerDetailV2 } = await import('../controllers/financeController.js');
    return getSalesLedgerDetailV2(req, res);
  }

  if (action === 'getSalesLedgerData') {
    const { getSalesLedgerData } = await import('../controllers/financeController.js');
    return getSalesLedgerData(req, res);
  }

  if (action === 'getAdsDashboard') {
    const { getAdsDashboard } = await import('../controllers/adsController.js');
    return getAdsDashboard(req, res);
  }

  if (action === 'getAdsCampaigns') {
    const { getAdsCampaigns } = await import('../controllers/adsController.js');
    return getAdsCampaigns(req, res);
  }

  if (action === 'getAdsProductPerformance') {
    const { getAdsProductPerformance } = await import('../controllers/adsController.js');
    return getAdsProductPerformance(req, res);
  }

  if (action === 'getAdsPerformancePaged') {
    const { getAdsPerformancePaged } = await import('../controllers/adsController.js');
    return getAdsPerformancePaged(req, res);
  }

  if (action === 'getAdsCampaignTrend') {
    const { getAdsCampaignTrend } = await import('../controllers/adsController.js');
    return getAdsCampaignTrend(req, res);
  }

  return sendCompatibleResponse(res, {
    status: "error",
    message: `Action '${action}' is enabled in Node.js but controller endpoint is not yet bound.`
  });
});

router.post('/', async (req, res) => {
  const action = req.body.action;

  // Modul 2: User Authentication (Write Operations)
  if (action === 'login') {
    const { login } = await import('../controllers/userController.js');
    return login(req, res);
  }

  if (action === 'register') {
    const { register } = await import('../controllers/userController.js');
    return register(req, res);
  }

  if (action === 'updateUser') {
    const { updateUser } = await import('../controllers/userController.js');
    return updateUser(req, res);
  }

  if (action === 'resetPassword') {
    const { resetPassword } = await import('../controllers/userController.js');
    return resetPassword(req, res);
  }

  if (action === 'toggleUserStatus') {
    const { toggleUserStatus } = await import('../controllers/userController.js');
    return toggleUserStatus(req, res);
  }

  if (action === 'getUsers') {
    const { getUsers } = await import('../controllers/userController.js');
    return getUsers(req, res);
  }

  // Modul 3: Master Barang (POST)
  if (action === 'editProduk') {
    const { editProduk } = await import('../controllers/masterBarangController.js');
    return editProduk(req, res);
  }

  if (action === 'toggleProdukStatus') {
    const { toggleProdukStatus } = await import('../controllers/masterBarangController.js');
    return toggleProdukStatus(req, res);
  }

  if (action === 'hapusProduk') {
    const { hapusProduk } = await import('../controllers/masterBarangController.js');
    return hapusProduk(req, res);
  }

  // Modul 4: Shopee Integration (POST)
  if (action === 'syncShopeeProducts') {
    const { syncShopeeProducts } = await import('../controllers/shopeeController.js');
    return syncShopeeProducts(req, res);
  }

  if (action === 'saveShopeeMapping') {
    const { saveShopeeMapping } = await import('../controllers/shopeeController.js');
    return saveShopeeMapping(req, res);
  }

  if (action === 'deleteShopeeMapping') {
    const { deleteShopeeMapping } = await import('../controllers/shopeeController.js');
    return deleteShopeeMapping(req, res);
  }

  if (action === 'getAutoSuggestMapping') {
    const { getAutoSuggestMapping } = await import('../controllers/shopeeController.js');
    return getAutoSuggestMapping(req, res);
  }

  if (action === 'syncShopeeOrders') {
    const { syncShopeeOrders } = await import('../controllers/shopeeController.js');
    return syncShopeeOrders(req, res);
  }

  if (action === 'checkShopeeAuth') {
    const { checkShopeeAuth } = await import('../controllers/shopeeController.js');
    return checkShopeeAuth(req, res);
  }

  if (action === 'getShopeeAuthUrl') {
    const { getShopeeAuthUrl } = await import('../controllers/shopeeController.js');
    return getShopeeAuthUrl(req, res);
  }

  if (action === 'shopeeOAuthCallback') {
    const { shopeeOAuthCallback } = await import('../controllers/shopeeController.js');
    return shopeeOAuthCallback(req, res);
  }

  // Modul 5: Telegram Bot (POST)
  if (action === 'updateTelegramUser') {
    const { updateTelegramUser } = await import('../controllers/telegramController.js');
    return updateTelegramUser(req, res);
  }

  if (action === 'deleteTelegramUser') {
    const { deleteTelegramUser } = await import('../controllers/telegramController.js');
    return deleteTelegramUser(req, res);
  }

  if (action === 'broadcastTelegram') {
    const { broadcastTelegram } = await import('../controllers/telegramController.js');
    return broadcastTelegram(req, res);
  }

  if (action === 'approveTelegramSubscriber') {
    const { approveTelegramSubscriber } = await import('../controllers/telegramController.js');
    return approveTelegramSubscriber(req, res);
  }

  if (action === 'disableTelegramSubscriber') {
    const { disableTelegramSubscriber } = await import('../controllers/telegramController.js');
    return disableTelegramSubscriber(req, res);
  }

  if (action === 'testTelegramSubscriberNotification') {
    const { testTelegramSubscriberNotification } = await import('../controllers/telegramController.js');
    return testTelegramSubscriberNotification(req, res);
  }

  if (action === 'saveSubscriberRules') {
    const { saveSubscriberRules } = await import('../controllers/telegramController.js');
    return saveSubscriberRules(req, res);
  }

  if (action === 'updateTelegramTemplate') {
    const { updateTelegramTemplate } = await import('../controllers/telegramController.js');
    return updateTelegramTemplate(req, res);
  }

  if (action === 'saveTelegramSettings') {
    const { saveTelegramSettings } = await import('../controllers/telegramController.js');
    return saveTelegramSettings(req, res);
  }

  if (action === 'simulateTelegramWebhook') {
    const { simulateTelegramWebhook } = await import('../controllers/telegramController.js');
    return simulateTelegramWebhook(req, res);
  }

  if (action === 'telegramWebhook') {
    const { telegramWebhook } = await import('../controllers/telegramController.js');
    return telegramWebhook(req, res);
  }

  if (action === 'retryDLQMessage') {
    const { retryDLQMessage } = await import('../controllers/telegramController.js');
    return retryDLQMessage(req, res);
  }

  if (action === 'getTelegramDashboardData') {
    const { getTelegramStatus } = await import('../controllers/telegramController.js');
    return getTelegramStatus(req, res);
  }

  if (action === 'getTelegramSubscribers') {
    const { getTelegramSubscribers } = await import('../controllers/telegramController.js');
    return getTelegramSubscribers(req, res);
  }

  if (action === 'getTelegramTemplates') {
    const { getTelegramTemplates } = await import('../controllers/telegramController.js');
    return getTelegramTemplates(req, res);
  }

  if (action === 'getTelegramQueueHistory') {
    const { getTelegramQueueHistory } = await import('../controllers/telegramController.js');
    return getTelegramQueueHistory(req, res);
  }

  if (action === 'getTelegramSettings') {
    const { getTelegramSettings } = await import('../controllers/telegramController.js');
    return getTelegramSettings(req, res);
  }

  if (action === 'getTelegramDLQ') {
    const { getTelegramDLQ } = await import('../controllers/telegramController.js');
    return getTelegramDLQ(req, res);
  }

  // Modul 6: Recovery Center Core (POST)
  if (action === 'getRecoveryRegistry') {
    const { getRecoveryRegistry } = await import('../controllers/recoveryController.js');
    return getRecoveryRegistry(req, res);
  }

  if (action === 'getRecoveryJobHistory') {
    const { getRecoveryJobHistory } = await import('../controllers/recoveryController.js');
    return getRecoveryJobHistory(req, res);
  }

  if (action === 'executeRecoveryTool') {
    const { executeRecoveryTool } = await import('../controllers/recoveryController.js');
    return executeRecoveryTool(req, res);
  }

  // Modul 7: Stock & Order Deduction (POST)
  if (action === 'getStockBySku') {
    const { getStockBySku } = await import('../controllers/deductionController.js');
    return getStockBySku(req, res);
  }

  if (action === 'approveDeduction') {
    const { approveDeduction } = await import('../controllers/deductionController.js');
    return approveDeduction(req, res);
  }

  if (action === 'bulkApproveDeduction') {
    const { bulkApproveDeduction } = await import('../controllers/deductionController.js');
    return bulkApproveDeduction(req, res);
  }

  if (action === 'skipDeduction') {
    const { skipDeduction } = await import('../controllers/deductionController.js');
    return skipDeduction(req, res);
  }

  if (action === 'bulkSkipDeduction') {
    const { bulkSkipDeduction } = await import('../controllers/deductionController.js');
    return bulkSkipDeduction(req, res);
  }

  if (action === 'undoSkip') {
    const { undoSkip } = await import('../controllers/deductionController.js');
    return undoSkip(req, res);
  }

  if (action === 'retryDeduction') {
    const { retryDeduction } = await import('../controllers/deductionController.js');
    return retryDeduction(req, res);
  }

  // Modul 8: Analytics, Reporting & Ads (POST)
  if (action === 'resyncFinance') {
    const { resyncFinance } = await import('../controllers/financeController.js');
    return resyncFinance(req, res);
  }

  if (action === 'refreshFinance') {
    const { refreshFinance } = await import('../controllers/financeController.js');
    return refreshFinance(req, res);
  }

  if (action === 'getAdsProductPerformance') {
    const { getAdsProductPerformance } = await import('../controllers/adsController.js');
    return getAdsProductPerformance(req, res);
  }

  if (action === 'getAdsPerformancePaged') {
    const { getAdsPerformancePaged } = await import('../controllers/adsController.js');
    return getAdsPerformancePaged(req, res);
  }

  if (action === 'getAdsCampaignTrend') {
    const { getAdsCampaignTrend } = await import('../controllers/adsController.js');
    return getAdsCampaignTrend(req, res);
  }

  if (action === 'toggleAdsCampaign') {
    const { toggleAdsCampaign } = await import('../controllers/adsController.js');
    return toggleAdsCampaign(req, res);
  }

  return sendCompatibleResponse(res, {
    status: "error",
    message: `Action '${action}' is enabled in Node.js but controller endpoint is not yet bound.`
  });
});

export default router;
