import { DeductionService } from '../services/deductionService.js';
import { DeductionSheetRepository } from '../repositories/sheets/deductionSheetRepo.js';
import { ShopeeSheetRepository } from '../repositories/sheets/shopeeSheetRepo.js';
import { TelegramService } from '../services/telegramService.js';
import { TelegramSheetRepository } from '../repositories/sheets/telegramSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const deductionRepo = new DeductionSheetRepository();
const shopeeRepo = new ShopeeSheetRepository();
const telegramRepo = new TelegramSheetRepository();
const telegramService = new TelegramService(telegramRepo);

const deductionService = new DeductionService(deductionRepo, shopeeRepo, telegramService);

/**
 * getStockBySku - Handler untuk mengecek stok berdasarkan SKU.
 */
export async function getStockBySku(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const sku = params.sku || params.skuCode;
    const result = await deductionService.getStockBySku(sku);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] getStockBySku failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data stok.', error);
  }
}

/**
 * approveDeduction - Handler untuk menyetujui pemotongan stok satu pesanan.
 */
export async function approveDeduction(req, res) {
  try {
    const { orderSn, itemId, modelId, productName, variationName, qty, approvedBy, source, suppressTelegram, callerRole } = req.body;
    const userName = req.body.auth?.userEmail || req.body.callerEmail || approvedBy || 'Admin';
    const role = req.body.auth?.role || callerRole || 'Admin';

    const result = await deductionService.approveDeduction({
      orderSn,
      itemId,
      modelId,
      productName,
      variationName,
      qty,
      approvedBy: userName,
      source: source || 'SingleApprove',
      suppressTelegram,
      callerRole: role
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] approveDeduction failed:', error);
    return sendErrorResponse(res, 'Gagal menyetujui deduksi stok.', error);
  }
}

/**
 * bulkApproveDeduction - Handler untuk bulk approval pemotongan stok.
 */
export async function bulkApproveDeduction(req, res) {
  try {
    const { items, approvedBy, source, suppressTelegram } = req.body;
    const userName = req.body.auth?.userEmail || approvedBy || 'Admin';

    const result = await deductionService.bulkApproveDeduction({
      items,
      approvedBy: userName,
      source: source || 'BulkApprove',
      suppressTelegram
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] bulkApproveDeduction failed:', error);
    return sendErrorResponse(res, 'Gagal menyetujui bulk deduksi stok.', error);
  }
}

/**
 * skipDeduction - Handler untuk men-skip deduksi satu pesanan.
 */
export async function skipDeduction(req, res) {
  try {
    const { orderSn, reason, note, skipType, skippedBy } = req.body;
    const callerRole = req.body.auth?.role || 'Admin';
    const operator = req.body.auth?.userEmail || skippedBy || 'Admin';

    const result = await deductionService.skipDeduction({
      orderSn,
      reason,
      note,
      skipType,
      skippedBy: operator,
      callerRole
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] skipDeduction failed:', error);
    return sendErrorResponse(res, 'Gagal melakukan skip deduksi.', error);
  }
}

/**
 * bulkSkipDeduction - Handler untuk bulk skip deduksi.
 */
export async function bulkSkipDeduction(req, res) {
  try {
    const { orderSns, reason, note, skipType, skippedBy } = req.body;
    const callerRole = req.body.auth?.role || 'Admin';
    const operator = req.body.auth?.userEmail || skippedBy || 'Admin';

    const result = await deductionService.bulkSkipDeduction({
      orderSns,
      reason,
      note,
      skipType,
      skippedBy: operator,
      callerRole
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] bulkSkipDeduction failed:', error);
    return sendErrorResponse(res, 'Gagal melakukan bulk skip deduksi.', error);
  }
}

/**
 * undoSkip - Handler untuk membatalkan status skip/historical kembali ke PENDING.
 */
export async function undoSkip(req, res) {
  try {
    const { orderSn, undoBy } = req.body;
    const callerRole = req.body.auth?.role || 'Admin';
    const operator = req.body.auth?.userEmail || undoBy || 'Admin';

    const result = await deductionService.undoSkip({
      orderSn,
      undoBy: operator,
      callerRole
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] undoSkip failed:', error);
    return sendErrorResponse(res, 'Gagal melakukan undo skip deduksi.', error);
  }
}

/**
 * retryDeduction - Handler untuk mengulangi deduksi stok yang sempat gagal.
 */
export async function retryDeduction(req, res) {
  try {
    const { orderSn, itemId, modelId, productName, variationName, qty } = req.body;
    const callerRole = req.body.auth?.role || 'Admin';

    const result = await deductionService.retryDeduction({
      orderSn,
      itemId,
      modelId,
      productName,
      variationName,
      qty,
      callerRole
    });

    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[DeductionController ERROR] retryDeduction failed:', error);
    return sendErrorResponse(res, 'Gagal mengulangi deduksi stok.', error);
  }
}
