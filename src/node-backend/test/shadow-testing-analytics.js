import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";
const TEST_PORT = 5508;
const NODE_URL = `http://localhost:${TEST_PORT}`;

// Simpan Ledger ID hasil pencarian dinamis
let dynamicLedgerId = "";
let dynamicCampaignId = "";

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: ANALYTICS, REPORTING & ADS');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    return;
  }

  process.env.FLAG_ANALYTICS_REPORTING = 'true';
  process.env.PORT = String(TEST_PORT);

  // Start Server
  await import('../app.js');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Get Sales Ledger Paged ---
    const case1Res = await runTestCase('getSalesLedgerPagedV2', { page: 1, limit: 5 });
    if (case1Res && case1Res.nodeData && case1Res.nodeData.ledgers && case1Res.nodeData.ledgers.length > 0) {
      dynamicLedgerId = case1Res.nodeData.ledgers[0]['Ledger ID'];
      console.log(`[ShadowTest] Resolved dynamic Ledger ID: "${dynamicLedgerId}"`);
    }

    // --- CASE 2: Get Sales Ledger KPI ---
    await runTestCase('getSalesLedgerKPIV2', { dateFrom: '2026-06-01', dateTo: '2026-06-30' });

    // --- CASE 3: Get Sales Ledger Detail ---
    if (dynamicLedgerId) {
      await runTestCase('getSalesLedgerDetailV2', { ledgerId: dynamicLedgerId });
    } else {
      console.log('[ShadowTest] Skipping Case 3: No dynamic Ledger ID resolved.');
    }

    // --- CASE 4: Get Ads Dashboard ---
    await runTestCase('getAdsDashboard', { dateFrom: '2026-06-01', dateTo: '2026-06-15' });

    // --- CASE 5: Get Ads Campaigns ---
    const case5Res = await runTestCase('getAdsCampaigns', { dateFrom: '2026-06-01', dateTo: '2026-06-15' });
    if (case5Res && case5Res.nodeData && case5Res.nodeData.campaigns && case5Res.nodeData.campaigns.length > 0) {
      dynamicCampaignId = case5Res.nodeData.campaigns[0].CampaignID;
      console.log(`[ShadowTest] Resolved dynamic Campaign ID: "${dynamicCampaignId}"`);
    }

    // --- CASE 6: Get Ads Product Performance ---
    await runTestCase('getAdsProductPerformance', { dateFrom: '2026-06-01', dateTo: '2026-06-15', sortBy: 'spend' });

    // --- CASE 7: Toggle Ads Campaign ---
    if (dynamicCampaignId) {
      await runTestCase('toggleAdsCampaign', {
        campaignId: dynamicCampaignId,
        status: 'PAUSED',
        user: 'shadow_test@ansla.com'
      });
    } else {
      console.log('[ShadowTest] Skipping Case 7: No dynamic Campaign ID resolved.');
    }

  } catch (err) {
    console.error('\n[ShadowTest ERROR] Testing crashed:', err.message);
  } finally {
    console.log('\n[ShadowTest] Shadow testing finished.');
    console.log('==================================================');
    process.exit(0);
  }
}

async function runTestCase(action, payload) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[Test Case] Action: ${action}`);
  console.log(`Payload   : ${JSON.stringify(payload)}`);
  console.log(`--------------------------------------------------`);

  try {
    let nodeRes, gasRes;
    
    // GET vs POST Routing berdasarkan tipe aksi
    const getActions = [
      'getSalesLedgerPagedV2',
      'getSalesLedgerKPIV2',
      'getSalesLedgerDetailV2',
      'getSalesLedgerData',
      'getAdsDashboard',
      'getAdsCampaigns',
      'getAdsProductPerformance'
    ];

    const isAdsGetAction = action.startsWith('getAds');

    if (getActions.includes(action)) {
      nodeRes = await axios.get(NODE_URL, { params: { action, ...payload } });
      
      if (isAdsGetAction) {
        // GAS binds Ads actions in doPost
        gasRes = await axios.post(GAS_URL, { action, ...payload });
      } else {
        gasRes = await axios.get(GAS_URL, { params: { action, ...payload } });
      }
    } else {
      nodeRes = await axios.post(NODE_URL, { action, ...payload });
      gasRes = await axios.post(GAS_URL, { action, ...payload });
    }

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    let isMatched = false;

    if (action === 'getSalesLedgerPagedV2') {
      const nodeLen = nodeData.ledgers ? nodeData.ledgers.length : 0;
      const gasLen = gasData.ledgers ? gasData.ledgers.length : 0;
      console.log(`Node.js Ledgers Count: ${nodeLen}`);
      console.log(`GAS Ledgers Count   : ${gasLen}`);
      
      const kpisMatch = JSON.stringify(nodeData.kpi) === JSON.stringify(gasData.kpi);
      console.log(`KPI Data Matched     : ${kpisMatch}`);
      
      isMatched = (nodeLen === gasLen) && kpisMatch;
    } 
    else if (action === 'getSalesLedgerKPIV2') {
      const match = JSON.stringify(nodeData.kpi) === JSON.stringify(gasData.kpi);
      console.log(`KPI Data Matched     : ${match}`);
      isMatched = match;
    } 
    else if (action === 'getSalesLedgerDetailV2') {
      const match = nodeData.detail && gasData.detail &&
                    (nodeData.detail['Ledger ID'] === gasData.detail['Ledger ID']);
      console.log(`Ledger Detail Match  : ${match}`);
      isMatched = match;
    }
    else if (action === 'getAdsDashboard') {
      const nodeKPI = nodeData.kpis || {};
      const gasKPI = gasData.kpis || {};
      
      console.log(`Node.js Balance      : ${nodeKPI.balance}`);
      console.log(`GAS Balance          : ${gasKPI.balance}`);
      console.log(`Node.js Spend        : ${nodeKPI.totalSpend}`);
      console.log(`GAS Spend            : ${gasKPI.totalSpend}`);
      
      isMatched = (nodeKPI.balance === gasKPI.balance) && 
                  (nodeKPI.totalSpend === gasKPI.totalSpend);
    }
    else if (action === 'getAdsCampaigns') {
      const nodeLen = nodeData.campaigns ? nodeData.campaigns.length : 0;
      const gasLen = gasData.campaigns ? gasData.campaigns.length : 0;
      console.log(`Node.js Campaign Count: ${nodeLen}`);
      console.log(`GAS Campaign Count   : ${gasLen}`);
      isMatched = nodeLen === gasLen;
    }
    else if (action === 'getAdsProductPerformance') {
      const nodeLen = nodeData.products ? nodeData.products.length : 0;
      const gasLen = gasData.products ? gasData.products.length : 0;
      console.log(`Node.js Product Count: ${nodeLen}`);
      console.log(`GAS Product Count   : ${gasLen}`);
      isMatched = nodeLen === gasLen;
    }
    else {
      // General match
      console.log(`Node.js Status      : ${nodeData.status || nodeData.success}`);
      console.log(`GAS Status          : ${gasData.status || gasData.success}`);
      console.log(`Node.js Message     : ${nodeData.message}`);
      console.log(`GAS Message         : ${gasData.message}`);
      
      const nodeStatus = nodeData.status || (nodeData.success ? 'success' : 'error');
      const gasStatus = gasData.status || (gasData.success ? 'success' : 'error');
      
      isMatched = (nodeStatus.toLowerCase() === gasStatus.toLowerCase());
    }

    if (isMatched) {
      console.log(`[✅ SUCCESS] Response identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data/status output.`);
    }

    return { nodeData, gasData };

  } catch (err) {
    console.error(`[Test Case ERROR] Action ${action} failed:`, err.message);
    return null;
  }
}

runShadowTesting();
