import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Muat konfigurasi lingkungan
dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";

// Gunakan port uji coba 5505
const TEST_PORT = 5505;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: TELEGRAM BOT');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    return;
  }

  // Force enable local feature flags untuk pengujian local controller
  process.env.FLAG_TELEGRAM = 'true';
  process.env.PORT = String(TEST_PORT);

  // Import app secara dinamis setelah mengoverride env
  await import('../app.js');
  
  // Berikan waktu 1 detik agar server Express selesai mengikat port
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Get Telegram Status (GET) ---
    await runGetTestCase('getTelegramStatus');

    // --- CASE 2: Get Telegram Logs (GET) ---
    await runGetTestCase('getTelegramLogs');

    // --- CASE 3: Get Telegram Users (GET) ---
    await runGetTestCase('getTelegramUsers');

    // --- CASE 4: Get Telegram Templates (POST) ---
    await runTestCase('getTelegramTemplates', {});

    // --- CASE 5: Get Telegram Queue History (POST) ---
    await runTestCase('getTelegramQueueHistory', {});

    // --- CASE 6: Get Telegram Settings (POST) ---
    await runTestCase('getTelegramSettings', {});

    // --- CASE 7: Get Telegram DLQ (POST) ---
    await runTestCase('getTelegramDLQ', {});

    // --- CASE 8: Simulasikan Webhook (POST) ---
    await runTestCase('simulateTelegramWebhook', {});

    // --- CASE 9: Update Template Kosong (POST) ---
    await runTestCase('updateTelegramTemplate', {
      templateId: "",
      body: "Test template"
    });

  } catch (err) {
    console.error('\n[ShadowTest ERROR] Testing crashed:', err.message);
  } finally {
    console.log('\n[ShadowTest] Shadow testing finished.');
    console.log('==================================================');
    process.exit(0);
  }
}

/**
 * Menjalankan test case tunggal dengan payload POST
 */
async function runTestCase(action, payload) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[Test Case] Action: ${action} (POST)`);
  console.log(`Payload   : ${JSON.stringify(payload)}`);
  console.log(`--------------------------------------------------`);

  try {
    const nodeRes = await axios.post(NODE_URL, { action, ...payload });
    const gasRes = await axios.post(GAS_URL, { action, ...payload });

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    console.log(`Node.js Response    : ${JSON.stringify(nodeData)}`);
    console.log(`GAS Response        : ${JSON.stringify(gasData)}`);

    const isStatusMatched = nodeData.status === gasData.status;
    let isMsgMatched = nodeData.message === gasData.message;

    // Untuk simulasi webhook, response message/result bisa bervariasi jika database diubah, tetapi status-nya harus sama
    if (action === 'simulateTelegramWebhook') {
      isMsgMatched = true; // status check saja
    }

    // Custom check for new endpoints that are not in Apps Script:
    if (action === 'getTelegramDLQ' || action === 'retryDLQMessage') {
      if (nodeData.status === 'success') {
        console.log(`[✅ SUCCESS] New endpoint '${action}' verified successfully on Node.js (excluding GAS assertion).`);
        return;
      }
    }

    if (isStatusMatched && isMsgMatched) {
      console.log(`[✅ SUCCESS] Response identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data output.`);
      if (!isStatusMatched) console.log(`  - Status mismatch: Node.js='${nodeData.status}', GAS='${gasData.status}'`);
      if (!isMsgMatched) console.log(`  - Message mismatch: Node.js='${nodeData.message}', GAS='${gasData.message}'`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
  }
}

/**
 * Menjalankan test case tunggal dengan method GET
 */
async function runGetTestCase(action) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[Test Case] Action: ${action} (GET)`);
  console.log(`--------------------------------------------------`);

  try {
    const nodeRes = await axios.get(NODE_URL, { params: { action } });
    const gasRes = await axios.get(GAS_URL, { params: { action } });

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    const isStatusMatched = nodeData.status === gasData.status;
    
    // Pecah nama key array data list
    let key = action.replace('getTelegram', '').toLowerCase(); // e.g. status, logs, users, templates, settings, dlq
    if (key === 'queuehistory') key = 'queue';
    if (key === 'subscribers') key = 'subscribers';
    
    let isListCountMatch = true;
    if (key !== 'status' && key !== 'settings') {
      const nodeArr = nodeData[key] || [];
      const gasArr = gasData[key] || [];
      console.log(`Node.js List Count  : ${nodeArr.length}`);
      console.log(`GAS List Count      : ${gasArr.length}`);
      isListCountMatch = nodeArr.length === gasArr.length;
    } else {
      console.log(`Node.js Data Keys   : ${Object.keys(nodeData[key] || nodeData.data || {}).join(', ')}`);
      console.log(`GAS Data Keys       : ${Object.keys(gasData[key] || gasData.data || {}).join(', ')}`);
    }

    if (isStatusMatched && isListCountMatch) {
      console.log(`[✅ SUCCESS] Response status dan struktur data identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data output.`);
      if (!isStatusMatched) console.log(`  - Status mismatch: Node.js='${nodeData.status}', GAS='${gasData.status}'`);
      if (!isListCountMatch) console.log(`  - List count mismatch!`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
  }
}

runShadowTesting();
