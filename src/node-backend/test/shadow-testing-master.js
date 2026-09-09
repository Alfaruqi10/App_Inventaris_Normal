import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Muat konfigurasi lingkungan
dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";

// Gunakan port uji coba 5503
const TEST_PORT = 5503;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: MASTER BARANG');
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
  process.env.FLAG_MASTER_BARANG = 'true';
  process.env.PORT = String(TEST_PORT);

  // Import app secara dinamis setelah mengoverride env
  await import('../app.js');
  
  // Berikan waktu 1 detik agar server Express selesai mengikat port
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Mengambil Daftar Produk (GET) ---
    console.log(`\n--------------------------------------------------`);
    console.log(`[Test Case] Action: getMasterBarangList (GET)`);
    console.log(`--------------------------------------------------`);
    const nodeGetRes = await axios.get(NODE_URL, { params: { action: 'getMasterBarangList' } });
    const gasGetRes = await axios.get(GAS_URL, { params: { action: 'getMasterBarangList' } });
    console.log(`Node.js HTTP Status : ${nodeGetRes.status}`);
    console.log(`GAS HTTP Status     : ${gasGetRes.status}`);
    
    const nodeCount = nodeGetRes.data.master ? nodeGetRes.data.master.length : 0;
    const gasCount = gasGetRes.data.master ? gasGetRes.data.master.length : 0;
    console.log(`Node.js Product Count: ${nodeCount}`);
    console.log(`GAS Product Count    : ${gasCount}`);
    if (nodeGetRes.data.status === gasGetRes.data.status && nodeCount === gasCount) {
      console.log(`[✅ SUCCESS] Response status dan jumlah produk identik (0% deviasi).`);
    } else {
      console.log(`[❌ FAIL] Jumlah produk tidak sama: Node.js=${nodeCount}, GAS=${gasCount}`);
    }

    // --- CASE 2: Edit Produk dengan Caller Non-Admin ---
    await runTestCase('editProduk', {
      callerRole: 'Kasir',
      kodeBarang: 'KODE123',
      namaBarang: 'New Product Name'
    });

    // --- CASE 3: Edit Produk dengan Admin tapi Kode Barang Kosong ---
    await runTestCase('editProduk', {
      callerRole: 'Admin',
      kodeBarang: '',
      namaBarang: 'New Product Name'
    });

    // --- CASE 4: Edit Produk Non-Existent ---
    await runTestCase('editProduk', {
      callerRole: 'Admin',
      kodeBarang: 'KODE-EX-NON-EXISTENT-SHADOW-TEST-123',
      warnaLama: 'Merah',
      ukuranLama: 'L',
      namaBarang: 'New Product Name'
    });

    // --- CASE 5: toggleProdukStatus dengan Caller Non-Admin ---
    await runTestCase('toggleProdukStatus', {
      callerRole: 'Kasir',
      kodeBarang: 'KODE123',
      aktif: false
    });

    // --- CASE 6: toggleProdukStatus Non-Existent ---
    await runTestCase('toggleProdukStatus', {
      callerRole: 'Admin',
      kodeBarang: 'KODE-EX-NON-EXISTENT-SHADOW-TEST-123',
      warna: 'Merah',
      ukuran: 'L',
      aktif: false
    });

    // --- CASE 7: hapusProduk dengan Caller Non-Admin ---
    await runTestCase('hapusProduk', {
      callerRole: 'Kasir',
      kodeBarang: 'KODE123'
    });

    // --- CASE 8: hapusProduk Non-Existent ---
    await runTestCase('hapusProduk', {
      callerRole: 'Admin',
      kodeBarang: 'KODE-EX-NON-EXISTENT-SHADOW-TEST-123',
      warna: 'Merah',
      ukuran: 'L'
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
    const isMsgMatched = nodeData.message === gasData.message;

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

runShadowTesting();
