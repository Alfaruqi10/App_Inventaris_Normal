import { RecoveryService } from '../services/recoveryService.js';
import { RecoverySheetRepository } from '../repositories/sheets/recoverySheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const recoveryRepo = new RecoverySheetRepository();
const recoveryService = new RecoveryService(recoveryRepo);

/**
 * getRecoveryRegistry - Handler untuk mengambil registri recovery tools.
 */
export async function getRecoveryRegistry(req, res) {
  try {
    const list = recoveryService.getAllTools();
    return sendCompatibleResponse(res, {
      status: "success",
      tools: list
    });
  } catch (error) {
    console.error('[RecoveryController ERROR] getRecoveryRegistry failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil registri recovery tools.', error);
  }
}

/**
 * getRecoveryJobHistory - Handler untuk mendapatkan riwayat job pemeliharaan.
 */
export async function getRecoveryJobHistory(req, res) {
  try {
    const history = await recoveryRepo.getHistory();
    return sendCompatibleResponse(res, {
      status: "success",
      history
    });
  } catch (error) {
    console.error('[RecoveryController ERROR] getRecoveryJobHistory failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil riwayat job pemeliharaan.', error);
  }
}

/**
 * executeRecoveryTool - Handler untuk mengeksekusi recovery tool.
 */
export async function executeRecoveryTool(req, res) {
  try {
    const { toolId, preview, auth, ownerPassword, orderSn, simulateError, options } = req.body;
    
    const finalOptions = {
      auth:          (options && options.auth) || auth,
      preview:       (options && options.preview !== undefined) ? options.preview : preview,
      ownerPassword: (options && options.ownerPassword) || ownerPassword,
      orderSn:       (options && options.orderSn) || orderSn,
      simulateError: (options && options.simulateError) || simulateError
    };
    
    const result = await recoveryService.execute(toolId, finalOptions);
    
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[RecoveryController ERROR] executeRecoveryTool failed:', error);
    return sendErrorResponse(res, 'Gagal mengeksekusi recovery tool.', error);
  }
}
