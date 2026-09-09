import { ShopeeService } from '../services/shopeeService.js';
import { ShopeeSheetRepository } from '../repositories/sheets/shopeeSheetRepo.js';
import { MasterBarangSheetRepository } from '../repositories/sheets/masterBarangSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const shopeeRepository = new ShopeeSheetRepository();
const masterRepository = new MasterBarangSheetRepository();
const shopeeService = new ShopeeService(shopeeRepository, masterRepository);

/**
 * checkShopeeAuth - Handler untuk mengecek status otorisasi Shopee.
 */
export async function checkShopeeAuth(req, res) {
  try {
    const result = shopeeService.checkShopeeAuth();
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Check auth failed:', error);
    return sendErrorResponse(res, 'Gagal memeriksa otorisasi Shopee.', error);
  }
}

/**
 * getShopeeAuthUrl - Handler untuk mengambil URL otorisasi Shopee.
 */
export async function getShopeeAuthUrl(req, res) {
  try {
    const authUrl = shopeeService.getShopeeAuthUrl();
    return sendCompatibleResponse(res, { status: "success", authUrl });
  } catch (error) {
    console.error('[ShopeeController ERROR] Get auth URL failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil URL otorisasi Shopee.', error);
  }
}

/**
 * shopeeOAuthCallback - Handler untuk menukar OAuth code.
 */
export async function shopeeOAuthCallback(req, res) {
  try {
    const { code, shopId } = req.body;
    const result = await shopeeService.exchangeShopeeCode(code, shopId);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] OAuth callback failed:', error);
    return sendErrorResponse(res, 'Gagal menukar token otorisasi Shopee.', error);
  }
}

/**
 * syncShopeeProducts - Handler untuk sinkronisasi produk dari Shopee.
 */
export async function syncShopeeProducts(req, res) {
  try {
    const result = await shopeeService.syncShopeeProducts();
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Sync products failed:', error);
    return sendErrorResponse(res, 'Gagal sinkronisasi produk dari Shopee.', error);
  }
}

/**
 * saveShopeeMapping - Handler untuk menyimpan mapping produk.
 */
export async function saveShopeeMapping(req, res) {
  try {
    const result = await shopeeService.saveShopeeMapping(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Save mapping failed:', error);
    return sendErrorResponse(res, 'Gagal menyimpan pemetaan produk.', error);
  }
}

/**
 * deleteShopeeMapping - Handler untuk menghapus mapping produk.
 */
export async function deleteShopeeMapping(req, res) {
  try {
    const result = await shopeeService.deleteShopeeMapping(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Delete mapping failed:', error);
    return sendErrorResponse(res, 'Gagal menghapus pemetaan produk.', error);
  }
}

/**
 * getAutoSuggestMapping - Handler untuk menyarankan SKU pemetaan.
 */
export async function getAutoSuggestMapping(req, res) {
  try {
    const result = await shopeeService.getAutoSuggestMapping(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Auto suggest failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil saran pemetaan produk.', error);
  }
}

/**
 * syncShopeeOrders - Handler untuk sinkronisasi pesanan dari Shopee.
 */
export async function syncShopeeOrders(req, res) {
  try {
    const result = await shopeeService.syncShopeeOrders(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Sync orders failed:', error);
    return sendErrorResponse(res, 'Gagal sinkronisasi pesanan dari Shopee.', error);
  }
}

/**
 * getShopeeProducts - Handler untuk mengambil daftar produk Shopee lokal.
 */
export async function getShopeeProducts(req, res) {
  try {
    const list = await shopeeRepository.getShopeeProducts();
    return sendCompatibleResponse(res, { status: "success", products: list });
  } catch (error) {
    console.error('[ShopeeController ERROR] Get local shopee products failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar produk Shopee lokal.', error);
  }
}

/**
 * getShopeeMappings - Handler untuk mengambil daftar mapping Shopee lokal.
 */
export async function getShopeeMappings(req, res) {
  try {
    const list = await shopeeRepository.getShopeeMappings();
    return sendCompatibleResponse(res, { status: "success", mappings: list });
  } catch (error) {
    console.error('[ShopeeController ERROR] Get local shopee mappings failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar pemetaan Shopee.', error);
  }
}

/**
 * getShopeeOrders - Handler untuk mengambil daftar orders Shopee lokal.
 */
export async function getShopeeOrders(req, res) {
  try {
    const list = await shopeeRepository.getShopeeOrders();
    return sendCompatibleResponse(res, { status: "success", orders: list });
  } catch (error) {
    console.error('[ShopeeController ERROR] Get local shopee orders failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar pesanan Shopee.', error);
  }
}

/**
 * getShopeeLogs - Handler untuk mengambil log aktivitas Shopee lokal.
 */
export async function getShopeeLogs(req, res) {
  try {
    const list = await shopeeRepository.getShopeeLogs();
    return sendCompatibleResponse(res, { status: "success", logs: list });
  } catch (error) {
    console.error('[ShopeeController ERROR] Get local shopee logs failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil log aktivitas Shopee.', error);
  }
}

/**
 * getShopeeProductsPaged - Handler untuk mengambil daftar produk Shopee dengan paginasi.
 */
export async function getShopeeProductsPaged(req, res) {
  try {
    const result = await shopeeService.getShopeeProductsPaged(req.query);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Get paged products failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar produk Shopee (paged).', error);
  }
}

/**
 * getShopeeOrdersPaged - Handler untuk mengambil daftar pesanan Shopee dengan paginasi.
 */
export async function getShopeeOrdersPaged(req, res) {
  try {
    const result = await shopeeService.getShopeeOrdersPaged(req.query);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[ShopeeController ERROR] Get paged orders failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar pesanan Shopee (paged).', error);
  }
}
