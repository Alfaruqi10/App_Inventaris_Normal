import { DashboardService } from '../services/dashboardService.js';
import { DashboardSheetRepository } from '../repositories/sheets/dashboardSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const sheetRepository = new DashboardSheetRepository();
const dashboardService = new DashboardService(sheetRepository);

/**
 * getOrdersKPI - Handler untuk KPI pesanan Dashboard.
 */
export async function getOrdersKPI(req, res) {
  try {
    const { dateFrom, dateTo } = req.query;
    const kpiData = await dashboardService.getOrdersKPI(dateFrom, dateTo);
    
    // Kembalikan respon identik GAS
    return sendCompatibleResponse(res, kpiData);
  } catch (error) {
    console.error('[DashboardController ERROR] Failed to fetch orders KPI:', error);
    return sendErrorResponse(res, 'Gagal memuat KPI data pesanan.', error);
  }
}

/**
 * getData - Handler untuk memuat tabel produk master dan transaksi barang.
 */
export async function getData(req, res) {
  try {
    const data = await dashboardService.getMasterAndTransactionData();
    
    return sendCompatibleResponse(res, {
      master: data.master,
      transaksi: data.transaksi
    });
  } catch (error) {
    console.error('[DashboardController ERROR] Failed to fetch inventory data:', error);
    return sendErrorResponse(res, 'Gagal memuat data master barang dan riwayat transaksi.', error);
  }
}
