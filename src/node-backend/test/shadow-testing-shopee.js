import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Muat konfigurasi lingkungan
dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";

// Gunakan port uji coba 5504
const TEST_PORT = 5504;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: SHOPEE INTEGRATION');
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
  process.env.FLAG_SHOPEE = 'true';
  process.env.PORT = String(TEST_PORT);

  // Import app secara dinamis setelah mengoverride env
  await import('../app.js');
  
  // Berikan waktu 1 detik agar server Express selesai mengikat port
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Cek Otorisasi Shopee (POST) ---
    // --- CASE 1: Cek Otorisasi Shopee (GET) ---
    await runGetTestCase('checkShopeeAuth');

    // --- CASE 2: Ambil URL Otorisasi Shopee (GET) ---
    await runGetTestCase('getShopeeAuthUrl');

    // --- CASE 3: Auto-suggest Mapping dengan SKU yang ada ---
    // Kita coba cari SKU yang salah satu dari master barang (misal: 'TST001' atau sejenisnya)
    await runTestCase('getAutoSuggestMapping', {
      nama_produk: 'Kaos Polos Cotton Combed',
      variasi: 'Merah, L',
      seller_sku: 'MOCK-SKU-123'
    });

    // --- CASE 4: Simpan Mapping tanpa Item ID ---
    await runTestCase('saveShopeeMapping', {
      itemId: '',
      inventorySku: 'MOCK-SKU-123'
    });

    // --- CASE 5: Hapus Mapping dengan Caller Kasir (Non-Admin) ---
    await runTestCase('deleteShopeeMapping', {
      callerRole: 'Kasir',
      itemId: '12345',
      modelId: '67890'
    });

    // --- CASE 6: Ambil Daftar Produk Shopee Lokal (GET) ---
    await runGetTestCase('getShopeeProducts');

    // --- CASE 7: Ambil Daftar Mapping Shopee Lokal (GET) ---
    await runGetTestCase('getShopeeMappings');

    // --- CASE 8: Ambil Daftar Orders Shopee Lokal (GET) ---
    await runGetTestCase('getShopeeOrders');

    // --- CASE 9: Ambil Log Aktivitas Shopee Lokal (GET) ---
    await runGetTestCase('getShopeeLogs');

    // --- CASE 10: Ambil Daftar Produk Paged (GET) ---
    await runGetTestCase('getShopeeProductsPaged');

    // --- CASE 11: Ambil Daftar Orders Paged (GET) ---
    await runGetTestCase('getShopeeOrdersPaged');

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

    console.log(`Node.js Response    : ${JSON.stringify(nodeData)}`);
    console.log(`GAS Response        : ${JSON.stringify(gasData)}`);

    const isStatusMatched = nodeData.status === gasData.status;
    
    // Untuk getShopeeAuthUrl, path URL-nya dinamis karena timestamp. Kita cek kemiripan strukturnya saja.
    let isMsgMatched = nodeData.message === gasData.message;
    if (action === 'getShopeeAuthUrl') {
      isMsgMatched = !!(nodeData.authUrl && gasData.authUrl);
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
    
    // Cek jumlah data yang ditarik untuk memastikan keselarasan pembacaan sheet
    let key = action.replace('getShopee', '').toLowerCase(); // e.g. products, mappings, orders, logs
    if (key.endsWith('paged')) {
      key = key.replace('paged', '');
    }
    const nodeArr = nodeData[key] || [];
    const gasArr = gasData[key] || [];

    console.log(`Node.js List Count  : ${nodeArr.length}`);
    console.log(`GAS List Count      : ${gasArr.length}`);

    if (isStatusMatched && nodeArr.length === gasArr.length) {
      console.log(`[✅ SUCCESS] Response status dan jumlah data identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Terdeteksi perbedaan data output.`);
      if (!isStatusMatched) console.log(`  - Status mismatch: Node.js='${nodeData.status}', GAS='${gasData.status}'`);
      if (nodeArr.length !== gasArr.length) console.log(`  - Count mismatch: Node.js=${nodeArr.length}, GAS=${gasArr.length}`);
    }

  } catch (error) {
    console.error(`[❌ ERROR] Failed to execute request:`, error.message);
  }
}

runShadowTesting();
