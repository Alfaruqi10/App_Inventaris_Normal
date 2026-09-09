import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Muat konfigurasi lingkungan
dotenv.config();

const GAS_URL = process.env.OLD_GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec";

// Gunakan port uji coba 5502 agar tidak bertabrakan dengan server utama
const TEST_PORT = 5502;
const NODE_URL = `http://localhost:${TEST_PORT}`;

async function runShadowTesting() {
  console.log('==================================================');
  console.log(' STARTING SHADOW TESTING: AUTHENTICATION & USER');
  console.log(` Target Node.js: ${NODE_URL}`);
  console.log(` Target Apps Script: ${GAS_URL}`);
  console.log('==================================================');

  // Cek keberadaan kredensial Google Service Account atau clasp config
  const keyPath = path.resolve('credentials/google-service-account.json');
  const claspPath = path.join(os.homedir(), '.clasprc.json');
  
  if (!fs.existsSync(keyPath) && !fs.existsSync(claspPath)) {
    console.warn('\n[!] WARNING: Kredensial Google API tidak ditemukan.');
    return;
  }

  // 1. Force enable local feature flags untuk pengujian local controller
  process.env.FLAG_AUTH = 'true';
  process.env.PORT = String(TEST_PORT);

  // Import app secara dinamis setelah mengoverride env
  await import('../app.js');
  
  // Berikan waktu 1 detik agar server Express selesai mengikat port
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`\n[Server] Test instance running on port ${TEST_PORT}. Starting test cases...`);
  
  try {
    // --- CASE 1: Login dengan Email Tidak Terdaftar ---
    await runTestCase('login', {
      email: 'nonexistent-email-for-shadow-test@example.com',
      password: 'somepassword123'
    });

    // --- CASE 2: Login dengan Password Salah (Menggunakan email valid acak) ---
    await runTestCase('login', {
      email: 'admin@ansla.com', // Coba email bawaan
      password: 'wrong-password-value'
    });

    // --- CASE 3: Registrasi dengan Format Email Tidak Valid ---
    await runTestCase('register', {
      email: 'invalid-email-format',
      nama: 'Test User',
      password: 'password123',
      role: 'Kasir'
    });

    // --- CASE 4: Registrasi dengan Password Terlalu Pendek ---
    await runTestCase('register', {
      email: 'shadow-test-user@example.com',
      nama: 'Test User',
      password: '123',
      role: 'Kasir'
    });

    // --- CASE 5: getUsers dengan Role Non-Admin ---
    await runTestCase('getUsers', {
      role: 'Kasir'
    });

    // --- CASE 6: updateUser dengan Caller Non-Admin ---
    await runTestCase('updateUser', {
      callerRole: 'Kasir',
      email: 'some-user@example.com',
      nama: 'New Name'
    });

    // --- CASE 7: resetPassword dengan Caller Non-Admin ---
    await runTestCase('resetPassword', {
      callerRole: 'Kasir',
      email: 'some-user@example.com',
      passwordBaru: 'newpassword123'
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
    // 1. Request ke Node.js local (POST)
    const nodeRes = await axios.post(NODE_URL, { action, ...payload });
    
    // 2. Request ke GAS production (POST)
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
