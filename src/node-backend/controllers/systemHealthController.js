import { SystemHealthService } from '../services/systemHealthService.js';
import { SystemHealthSheetRepository } from '../repositories/sheets/systemHealthSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const sheetRepository = new SystemHealthSheetRepository();
const healthService = new SystemHealthService(sheetRepository);

/**
 * getSystemHealth - Handler untuk mengambil status kesehatan sistem.
 */
export async function getSystemHealth(req, res) {
  try {
    const healthData = await healthService.getHealthMetrics();
    
    // Kirim response menggunakan compatibility layer adapter (status: success + data)
    return sendCompatibleResponse(res, {
      health: healthData
    });
  } catch (error) {
    console.error('[SystemHealthController ERROR] Failed to fetch system health:', error);
    return sendErrorResponse(res, 'Gagal memuat dashboard kesehatan sistem.', error);
  }
}
