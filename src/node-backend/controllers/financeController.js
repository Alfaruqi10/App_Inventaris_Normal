import { FinanceSheetRepository } from '../repositories/sheets/financeSheetRepo.js';
import { FinanceService } from '../services/financeService.js';
import { ShopeeService } from '../services/shopeeService.js';
import { ShopeeSheetRepository } from '../repositories/sheets/shopeeSheetRepo.js';
import { MasterBarangSheetRepository } from '../repositories/sheets/masterBarangSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const financeRepo = new FinanceSheetRepository();
const shopeeRepository = new ShopeeSheetRepository();
const masterRepository = new MasterBarangSheetRepository();
const shopeeService = new ShopeeService(shopeeRepository, masterRepository);
const financeService = new FinanceService(financeRepo, shopeeService);

/**
 * getSalesLedgerPagedV2 - Handler untuk tabel + paginasi + KPI
 */
export async function getSalesLedgerPagedV2(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await financeService.getSalesLedgerPagedV2(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] getSalesLedgerPagedV2 failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data laporan penjualan (paged).', error);
  }
}

/**
 * getSalesLedgerKPIV2 - Handler untuk ringkasan KPI finansial saja
 */
export async function getSalesLedgerKPIV2(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await financeService.getSalesLedgerKPIV2(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] getSalesLedgerKPIV2 failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data KPI laporan penjualan.', error);
  }
}

/**
 * getSalesLedgerDetailV2 - Handler untuk detail data ledger per pesanan
 */
export async function getSalesLedgerDetailV2(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await financeService.getSalesLedgerDetailV2(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] getSalesLedgerDetailV2 failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data detail laporan penjualan.', error);
  }
}

/**
 * resyncFinance - Handler sinkronisasi batch data settlement dari Shopee API
 */
export async function resyncFinance(req, res) {
  try {
    const data = req.body || {};
    const result = await financeService.resyncFinance(data);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] resyncFinance failed:', error);
    return sendErrorResponse(res, 'Gagal melakukan sinkronisasi resync finance.', error);
  }
}

/**
 * refreshFinance - Handler sinkronisasi ulang data finansial pesanan spesifik
 */
export async function refreshFinance(req, res) {
  try {
    const data = req.body || {};
    const result = await financeService.refreshFinance(data);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] refreshFinance failed:', error);
    return sendErrorResponse(res, 'Gagal menyegarkan data finansial pesanan.', error);
  }
}

/**
 * getSalesLedgerData - Handler data ledger versi ringkas untuk AI
 */
export async function getSalesLedgerData(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await financeService.getSalesLedgerData(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[FinanceController ERROR] getSalesLedgerData failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data ringkasan ledger untuk AI.', error);
  }
}
