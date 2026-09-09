import { AdsSheetRepository } from '../repositories/sheets/adsSheetRepo.js';
import { AdsService } from '../services/adsService.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const adsRepo = new AdsSheetRepository();
const adsService = new AdsService(adsRepo);

/**
 * getAdsDashboard - Handler ringkasan KPI performa & grafik iklan
 */
export async function getAdsDashboard(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await adsService.getAdsDashboard(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] getAdsDashboard failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data dashboard Shopee Ads.', error);
  }
}

/**
 * getAdsCampaigns - Handler untuk daftar manajemen iklan kampanye
 */
export async function getAdsCampaigns(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await adsService.getAdsCampaigns(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] getAdsCampaigns failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar kampanye Shopee Ads.', error);
  }
}

/**
 * getAdsProductPerformance - Handler performa per produk teriklan
 */
export async function getAdsProductPerformance(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await adsService.getAdsProductPerformance(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] getAdsProductPerformance failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data performa produk Shopee Ads.', error);
  }
}

/**
 * getAdsPerformancePaged - Handler histori performa iklan paged (SSOT Ads_Report)
 */
export async function getAdsPerformancePaged(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await adsService.getAdsPerformancePaged(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] getAdsPerformancePaged failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data performa iklan paged.', error);
  }
}

/**
 * getAdsCampaignTrend - Handler histori tren harian campaign/item tertentu
 */
export async function getAdsCampaignTrend(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const result = await adsService.getAdsCampaignTrend(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] getAdsCampaignTrend failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil histori tren campaign.', error);
  }
}

/**
 * toggleAdsCampaign - Handler aktivasi/penangguhan status kampanye iklan
 */
export async function toggleAdsCampaign(req, res) {
  try {
    const data = req.body || {};
    const callerEmail = req.body.auth?.userEmail || req.body.callerEmail || data.user || 'Admin';
    const params = {
      ...data,
      user: callerEmail
    };
    const result = await adsService.toggleAdsCampaign(params);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[AdsController ERROR] toggleAdsCampaign failed:', error);
    return sendErrorResponse(res, 'Gagal mengubah status kampanye Shopee Ads.', error);
  }
}
