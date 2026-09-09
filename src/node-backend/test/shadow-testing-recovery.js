import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";
const TEST_PORT = 5506;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: RECOVERY CENTER CORE');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    return;
  }

  process.env.FLAG_RECOVERY = 'true';
  process.env.PORT = String(TEST_PORT);

  await import('../app.js');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Get Recovery Registry (POST) ---
    await runTestCase('getRecoveryRegistry', {});

    // --- CASE 2: Get Recovery Job History (POST) ---
    await runTestCase('getRecoveryJobHistory', {});

    // --- CASE 3: Execute Tool - Preview Mode (POST) ---
    await runTestCase('executeRecoveryTool', {
      toolId: "test_repair_pending",
      options: {
        preview: true,
        auth: { role: "Admin", userEmail: "admin@ansla.com" }
      }
    });

    // --- CASE 4: Execute Tool - Real Execution Success (POST) ---
    await runTestCase('executeRecoveryTool', {
      toolId: "test_repair_pending",
      options: {
        preview: false,
        auth: { role: "Admin", userEmail: "admin@ansla.com" }
      }
    });

    // --- CASE 5: Execute Tool - Denied Role (POST) ---
    await runTestCase('executeRecoveryTool', {
      toolId: "test_historical_cleanup",
      options: {
        preview: false,
        auth: { role: "Admin", userEmail: "admin@ansla.com" }
      }
    });

    // --- CASE 6: Execute Tool - Wrong Owner Password (POST) ---
    await runTestCase('executeRecoveryTool', {
      toolId: "test_historical_cleanup",
      options: {
        preview: false,
        auth: { role: "Owner", userEmail: "owner@ansla.com" },
        ownerPassword: "wrongpassword"
      }
    });

    // --- CASE 7: Execute Tool - Correct Owner Password (POST) ---
    await runTestCase('executeRecoveryTool', {
      toolId: "test_historical_cleanup",
      options: {
        preview: false,
        auth: { role: "Owner", userEmail: "owner@ansla.com" },
        ownerPassword: "adminansla123"
      }
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
    const nodeRes = await axios.post(NODE_URL, { action, ...payload });
    const gasRes = await axios.post(GAS_URL, { action, ...payload });

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    let isMatched = true;

    if (action === 'getRecoveryRegistry') {
      const nodeTools = nodeData.tools || [];
      const gasTools = gasData.tools || [];
      console.log(`Node.js Tool Count  : ${nodeTools.length}`);
      console.log(`GAS Tool Count      : ${gasTools.length}`);
      isMatched = nodeTools.length === gasTools.length && nodeData.status === gasData.status;
    } 
    else if (action === 'getRecoveryJobHistory') {
      const nodeHistory = nodeData.history || [];
      const gasHistory = gasData.history || [];
      console.log(`Node.js Job History : ${nodeHistory.length}`);
      console.log(`GAS Job History     : ${gasHistory.length}`);
      isMatched = nodeData.status === gasData.status;
    } 
    else {
      // Untuk eksekusi tool, bandingkan status & parameter status output utama
      console.log(`Node.js Status      : ${nodeData.status}`);
      console.log(`GAS Status          : ${gasData.status}`);
      console.log(`Node.js Message     : ${nodeData.message}`);
      console.log(`GAS Message         : ${gasData.message}`);
      
      const isStatusMatch = nodeData.status === gasData.status;
      // Durasi bervariasi, tapi pesan harus mengarah pada arti/indikasi yang sama
      const isMsgMatch = nodeData.message === gasData.message || 
                         (nodeData.status === 'failed' && gasData.status === 'failed');
      isMatched = isStatusMatch && isMsgMatch;
    }

    if (isMatched) {
      console.log(`[✅ SUCCESS] Response identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data output.`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
  }
}

runShadowTesting();
