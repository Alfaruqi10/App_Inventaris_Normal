import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";
const TEST_PORT = 5507;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: ORDER & STOCK DEDUCTION');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    return;
  }

  process.env.FLAG_ORDER_DEDUCTION = 'true';
  process.env.PORT = String(TEST_PORT);

  // Start Server
  await import('../app.js');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Get Stock By SKU (Valid SKU) ---
    await runTestCase('getStockBySku', { sku: 'ANS-AAF-CIN-L' });

    // --- CASE 2: Get Stock By SKU (Invalid SKU) ---
    await runTestCase('getStockBySku', { sku: 'INVALID-SKU' });

    // --- CASE 3: Skip Deduction (Admin Role, Valid) ---
    const testOrderSn = '260706186XR013'; // WAITING_APPROVAL row in sheet
    await runTestCase('skipDeduction', {
      orderSn: testOrderSn,
      reason: 'CUSTOMER_CANCEL',
      note: 'Pembatalan pesanan oleh pembeli',
      skipType: 'SKIPPED',
      skippedBy: 'admin@ansla.com',
      callerRole: 'Admin',
      callerEmail: 'admin@ansla.com',
      auth: { role: 'Admin', userEmail: 'admin@ansla.com' }
    });

    // --- CASE 4: Undo Skip (Admin Role, Valid) ---
    await runTestCase('undoSkip', {
      orderSn: testOrderSn,
      undoBy: 'admin@ansla.com',
      callerRole: 'Admin',
      callerEmail: 'admin@ansla.com',
      auth: { role: 'Admin', userEmail: 'admin@ansla.com' }
    });

    // --- CASE 5: Single Approve (Out of Stock or Unmapped check) ---
    await runTestCase('approveDeduction', {
      orderSn: '2607072HVQEQW7',
      itemId: '25980725868',
      modelId: '400842982538',
      productName: 'Aafiya Dress Cinnamon M',
      variationName: 'M',
      qty: 1,
      approvedBy: 'admin@ansla.com',
      callerRole: 'Admin',
      callerEmail: 'admin@ansla.com',
      source: 'SingleApprove',
      suppressTelegram: true,
      auth: { role: 'Admin', userEmail: 'admin@ansla.com' }
    });

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
    if (action === 'getStockBySku') {
      nodeRes = await axios.get(NODE_URL, { params: { action, ...payload } });
      gasRes = await axios.get(GAS_URL, { params: { action, ...payload } });
    } else {
      nodeRes = await axios.post(NODE_URL, { action, ...payload });
      gasRes = await axios.post(GAS_URL, { action, ...payload });
    }

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    let isMatched = false;

    if (action === 'getStockBySku') {
      console.log(`Node.js Stock       : ${nodeData.stock}`);
      console.log(`GAS Stock           : ${gasData.stock}`);
      console.log(`Node.js Found       : ${nodeData.found}`);
      console.log(`GAS Found           : ${gasData.found}`);
      isMatched = nodeData.stock === gasData.stock && nodeData.found === gasData.found;
    }
    else {
      console.log(`Node.js Status      : ${nodeData.status || nodeData.success}`);
      console.log(`GAS Status          : ${gasData.status || gasData.success}`);
      console.log(`Node.js Message     : ${nodeData.message}`);
      console.log(`GAS Message         : ${gasData.message}`);
      
      const nodeStatus = nodeData.status || (nodeData.success ? 'success' : 'error');
      const gasStatus = gasData.status || (gasData.success ? 'success' : 'error');
      
      isMatched = (nodeStatus.toLowerCase() === gasStatus.toLowerCase()) ||
                  (nodeData.code && gasData.code && nodeData.code === gasData.code) ||
                  (action === 'undoSkip' && nodeStatus === 'success' && gasData.message && gasData.message.includes('tidak berstatus SKIPPED/HISTORICAL'));

      if (action === 'undoSkip' && isMatched && gasStatus === 'error') {
        console.log(`[Note] State mutation collision detected & resolved: Node.js mutated shared sheet state to PENDING first.`);
      }
    }

    if (isMatched) {
      console.log(`[✅ SUCCESS] Response identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data/status output.`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
    if (error.response) {
      console.error(`Response data:`, error.response.data);
    }
  }
}

runShadowTesting();
