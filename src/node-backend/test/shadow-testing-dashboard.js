import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Muat konfigurasi lingkungan
dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";

// Gunakan port uji coba 5501 agar tidak bertabrakan dengan server utama
const TEST_PORT = 5501;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: DASHBOARD & SYSTEM HEALTH');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  // Cek keberadaan kredensial Google Service Account atau clasp config
  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    console.warn('Pastikan Anda telah login menggunakan clasp (clasp login) atau menempatkan Service Account key JSON.');
    console.warn('Pengujian ke Google Sheets API akan dibatalkan karena tidak ada otorisasi.');
    return;
  }

  // 1. Force enable local feature flags untuk pengujian local controller
  process.env.FLAG_DASHBOARD = 'true';
  process.env.FLAG_SYSTEM_HEALTH = 'true';
  process.env.PORT = String(TEST_PORT);

  // Import app secara dinamis setelah mengoverride env
  // Ini otomatis memulai server di port TEST_PORT (karena di app.js memanggil app.listen(PORT))
  await import('../app.js');
  
  // Berikan waktu 1 detik agar server Express selesai mengikat port
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: getOrdersKPI (Tanpa Filter Tanggal) ---
    await runTestCase('getOrdersKPI', {}, (node, gas) => {
      return compareKPIResponse(node, gas);
    });

    // --- CASE 2: getOrdersKPI (Dengan Filter Tanggal) ---
    const dateParams = {
      dateFrom: '2026-07-15',
      dateTo: '2026-07-22'
    };
    await runTestCase('getOrdersKPI', dateParams, (node, gas) => {
      return compareKPIResponse(node, gas);
    });

    // --- CASE 3: getSystemHealth ---
    await runTestCase('getSystemHealth', {}, (node, gas) => {
      return compareHealthResponse(node, gas);
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
 * Menjalankan test case tunggal, mengirim ke kedua backend, dan membandingkan hasilnya.
 */
async function runTestCase(action, params, compareFn) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[Test Case] Action: ${action} | Params: ${JSON.stringify(params)}`);
  console.log(`--------------------------------------------------`);

  try {
    // 1. Request ke Node.js local
    const nodeRes = await axios.get(NODE_URL, { params: { action, ...params } });
    
    // 2. Request ke GAS production
    const gasRes = await axios.get(GAS_URL, { params: { action, ...params } });

    console.log(`Node.js HTTP Status : ${nodeRes.status}`);
    console.log(`GAS HTTP Status     : ${gasRes.status}`);

    const nodeData = nodeRes.data;
    const gasData = gasRes.data;

    // Evaluasi status respons
    if (nodeData.status !== gasData.status) {
      console.log(`[❌ FAIL] Status mismatch: Node.js is '${nodeData.status}', GAS is '${gasData.status}'`);
      return false;
    }

    // Jalankan fungsi komparator
    const isMatched = compareFn(nodeData, gasData);
    if (isMatched) {
      console.log(`[✅ SUCCESS] Response identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data output.`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
  }
}

/**
 * Komparator respon KPI Dashboard
 */
function compareKPIResponse(node, gas) {
  let matched = true;
  
  const nodeKpi = node.kpi || {};
  const gasKpi = gas.kpi || {};

  const keys = Object.keys({ ...nodeKpi, ...gasKpi });
  
  console.log('\nMetrik Perbandingan KPI:');
  console.log('--------------------------------------------------');
  console.log(`${'KPI Name'.padEnd(20)} | ${'Node.js'.padEnd(10)} | ${'Apps Script'.padEnd(10)} | Status`);
  console.log('--------------------------------------------------');
  
  keys.forEach(k => {
    const valNode = nodeKpi[k];
    const valGas = gasKpi[k];
    const status = valNode === valGas ? 'OK' : 'MISMATCH ❌';
    if (valNode !== valGas) matched = false;
    console.log(`${k.padEnd(20)} | ${String(valNode).padEnd(10)} | ${String(valGas).padEnd(10)} | ${status}`);
  });

  return matched;
}

/**
 * Komparator respon System Health
 */
function compareHealthResponse(node, gas) {
  let matched = true;

  const nodeHealth = node.health || {};
  const gasHealth = gas.health || {};

  const keys = Object.keys({ ...nodeHealth, ...gasHealth });

  console.log('\nMetrik Perbandingan System Health:');
  console.log('--------------------------------------------------');
  console.log(`${'Metric Name'.padEnd(20)} | ${'Node.js'.padEnd(15)} | ${'Apps Script'.padEnd(15)} | Status`);
  console.log('--------------------------------------------------');

  keys.forEach(k => {
    // Kita maklumi jika 'webhook' status berbeda karena endpoint port lokal tidak terekspos di log webhook luar
    if (k === 'webhook') return;

    const valNode = nodeHealth[k];
    const valGas = gasHealth[k];
    const status = valNode === valGas ? 'OK' : 'MISMATCH ❌';
    if (valNode !== valGas) matched = false;
    console.log(`${k.padEnd(20)} | ${String(valNode).padEnd(15)} | ${String(valGas).padEnd(15)} | ${status}`);
  });

  return matched;
}

runShadowTesting();
