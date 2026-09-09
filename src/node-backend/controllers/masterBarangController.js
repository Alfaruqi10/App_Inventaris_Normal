import { MasterBarangService } from '../services/masterBarangService.js';
import { MasterBarangSheetRepository } from '../repositories/sheets/masterBarangSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const masterBarangRepository = new MasterBarangSheetRepository();
const masterBarangService = new MasterBarangService(masterBarangRepository);

/**
 * getMasterBarangList - Handler untuk mengambil seluruh data barang.
 */
export async function getMasterBarangList(req, res) {
  try {
    const result = await masterBarangService.getProducts();
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[MasterBarangController ERROR] Fetch products failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar barang.', error);
  }
}

/**
 * editProduk - Handler untuk mengedit produk (Hanya Admin).
 */
export async function editProduk(req, res) {
  try {
    const result = await masterBarangService.editProduct(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[MasterBarangController ERROR] Edit product failed:', error);
    return sendErrorResponse(res, 'Gagal mengubah data produk.', error);
  }
}

/**
 * toggleProdukStatus - Handler untuk mengaktifkan/menonaktifkan produk (Hanya Admin).
 */
export async function toggleProdukStatus(req, res) {
  try {
    const result = await masterBarangService.toggleProductStatus(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[MasterBarangController ERROR] Toggle status failed:', error);
    return sendErrorResponse(res, 'Gagal mengubah status keaktifan produk.', error);
  }
}

/**
 * hapusProduk - Handler untuk menghapus produk secara permanen (Hanya Admin).
 */
export async function hapusProduk(req, res) {
  try {
    const result = await masterBarangService.deleteProduct(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[MasterBarangController ERROR] Delete product failed:', error);
    return sendErrorResponse(res, 'Gagal menghapus produk.', error);
  }
}
