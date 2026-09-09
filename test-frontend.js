import pkg from 'jsdom';
const { JSDOM } = pkg;
import fs from 'fs';
import path from 'path';

process.on('uncaughtException', (err) => {
  console.error('\n!!! UNCAUGHT EXCEPTION !!!');
  console.error(err);
  if (err.stack) console.error(err.stack);
});

const htmlPath = 'dist/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    // Set localStorage data before scripts execute
    window.localStorage.setItem("inventarisUser", JSON.stringify({
      email: 'admin@test.com',
      role: 'Admin',
      nama: 'Admin User'
    }));
    window.localStorage.setItem("GAS_URL", "https://script.google.com/macros/s/AKfycbx85eZMbdg_IvxxzGRAZucD1dFpZ8vdkdKKjtTeAqYnYpc1qBQUdK4YvLxjDmc7nynGzA/exec");

    window.Audio = class {
      play() {}
    };

    window.console.error = (...args) => {
      console.log('\n[BROWSER CONSOLE.ERROR]', ...args);
    };
    window.console.warn = (...args) => {
      console.log('\n[BROWSER CONSOLE.WARN]', ...args);
    };
    window.console.log = (...args) => {
      console.log('[BROWSER CONSOLE.LOG]', ...args);
    };

    window.fetch = async (urlStr, options) => {
      const urlObj = new URL(urlStr, 'https://script.google.com');
      let action = urlObj.searchParams.get('action');
      if (!action && options && options.body) {
        try {
          const bodyObj = JSON.parse(options.body);
          action = bodyObj.action;
        } catch (e) {}
      }
      console.log(`\n[Mock Fetch Request]: ${urlStr}`);
      console.log(`  Action: ${action}`);

      const getResponse = () => {
        if (action === 'getTelegramStatus' || action === 'getTelegramDashboardData') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              botConnected: true,
              botName: 'MyTestBot',
              activeUsers: 5,
              totalHariIni: 10,
              successHariIni: 8,
              failedHariIni: 2,
              data: {
                botStatus: 'Online',
                botUsername: 'MyTestBot',
                totalSubscribers: 5,
                activeSubscribers: 5,
                totalToday: 10,
                successToday: 8,
                failedToday: 2,
                waitingCount: 0,
                lastError: 'None'
              }
            })
          };
        }
        
        if (action === 'getTelegramLogs' || action === 'getTelegramQueueHistory') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              logs: [
                { tanggal: '11/07/2026 12:00', jenis_notifikasi: 'BARANG_MASUK', status: 'SUCCESS', error_message: '' }
              ],
              queue: [
                { QueueID: 'Q001', Timestamp: Date.now(), Username: 'budi_tg', ChatID: '12345', Status: 'SUCCESS', RetryCount: 0, ErrorMessage: '', Text: 'Test notification' }
              ]
            })
          };
        }

        if (action === 'getTelegramSubscribers') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              subscribers: [
                { id: '12345', name: 'Budi', username: 'budi_tg', role: 'Kasir', status: 'ACTIVE' }
              ]
            })
          };
        }

        if (action === 'getTelegramTemplates') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              templates: [
                { templateId: 'BARANG_MASUK', title: 'Barang Masuk', body: 'Stok masuk: {qty}' }
              ]
            })
          };
        }

        if (action === 'getTelegramSettings') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              settings: {
                dailyBackupReport: true
              }
            })
          };
        }

        if (action === 'getAutoSyncStatus') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              active: true,
              count: 1,
              message: 'Auto-sync aktif'
            })
          };
        }

        if (action === 'getSalesLedgerKPIV2') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              kpi: {
                totalOmzet: 5000000,
                pendapatanBersih: 4500000,
                totalPesanan: 20,
                totalQty: 25,
                voucherShopee: 100000,
                voucherSeller: 50000,
                totalFee: 350000
              }
            })
          };
        }

        if (action === 'getSalesLedgerPagedV2') {
          return {
            status: 200,
            json: async () => ({
              status: 'success',
              ledgers: [
                {
                  'Ledger ID': 'L123',
                  'Order SN': 'SN999999',
                  'Tanggal Order': '2026-07-11T12:00:00.000Z',
                  'Nama Produk': 'Produk Demo',
                  'Variasi': 'Merah',
                  'Buyer Name': 'Budi',
                  'Qty': 2,
                  'Harga Produk': 50000,
                  'Subtotal': 100000,
                  'Shopee Voucher': 5000,
                  'Seller Voucher': 2000,
                  'Commission Fee': 3000,
                  'Service Fee': 1500,
                  'Escrow Amount': 90000,
                  'Status Shopee': 'COMPLETED',
                  'Status Ledger': 'Lunas',
                  'Settlement Status': 'Settled',
                  'Deduction Status': 'Deducted'
                }
              ],
              total: 1,
              page: 1,
              totalPages: 1
            })
          };
        }

        return {
          status: 404,
          json: async () => ({ status: 'error', message: 'Not Found' })
        };
      };

      const res = getResponse();
      if (res.ok === undefined) {
        res.ok = res.status >= 200 && res.status < 300;
      }
      if (res.statusText === undefined) {
        res.statusText = res.ok ? 'OK' : 'Error';
      }
      return res;
    };
  }
});

// Load all local scripts manually and map global constants to the JSDOM window context
const indexHtmlContent = fs.readFileSync('src/frontend/index.html', 'utf8');
const scriptSrcRegex = /<script\s+src="([^"]+)"\s*><\/script>/g;
let match;
while ((match = scriptSrcRegex.exec(indexHtmlContent)) !== null) {
  const src = match[1];
  if (!src.startsWith('http') && !src.startsWith('https')) {
    console.log(`[Test Runner] Loading script: ${src}`);
    try {
      let scriptContent = fs.readFileSync(src, 'utf8');
      // Convert top-level const and let to var so they attach to the JSDOM global window object
      scriptContent = scriptContent.replace(/^const\s+([A-Za-z0-9_$]+)/gm, 'var $1');
      scriptContent = scriptContent.replace(/^let\s+([A-Za-z0-9_$]+)/gm, 'var $1');
      dom.window.eval(scriptContent);
    } catch (e) {
      console.error(`[Test Runner] Failed to load/evaluate script ${src}:`, e.message);
    }
  }
}

setTimeout(() => {
  const window = dom.window;
  const document = window.document;

  console.log("\n--- Checking Initial State ---");
  console.log("Current User:", window.currentUser); // Wait, local currentUser is in module scope, but we can verify it parsed correctly by showing the app
  
  console.log("\n--- Simulating switchTab('telegram') ---");
  const tgSectionBefore = document.getElementById('view-telegram');
  console.log("Telegram section hidden class before switch:", tgSectionBefore?.classList.contains('hidden'));
  console.log("nc-bot-status text before switch:", document.getElementById('nc-bot-status')?.textContent);

  try {
    window.switchTab('telegram');
  } catch (err) {
    console.error("switchTab('telegram') failed with exception:", err);
  }

  setTimeout(() => {
    console.log("\nTelegram section hidden class after switch:", tgSectionBefore?.classList.contains('hidden'));
    console.log("nc-bot-status text after switch:", document.getElementById('nc-bot-status')?.textContent);
    console.log("nc-subs-table-body rows after render:", document.getElementById('nc-subs-table-body')?.innerHTML);
    console.log("nc-queue-table-body rows after render:", document.getElementById('nc-queue-table-body')?.innerHTML);

    console.log("\n--- Simulating switchTab('sales-ledger') ---");
    const slSectionBefore = document.getElementById('view-sales-ledger');
    console.log("Sales Ledger section hidden class before switch:", slSectionBefore?.classList.contains('hidden'));

    try {
      window.switchTab('sales-ledger');
    } catch (err) {
      console.error("switchTab('sales-ledger') failed with exception:", err);
    }

    setTimeout(() => {
      console.log("\nSales Ledger section hidden class after switch:", slSectionBefore?.classList.contains('hidden'));
      console.log("sl-tbody rows after render:", document.getElementById('sl-tbody')?.innerHTML);
      console.log("sl-kpi-omzet value after render:", document.getElementById('sl-kpi-omzet')?.textContent);
      
      console.log("\n--- Test Done ---");
      process.exit(0);
    }, 1000);
  }, 1000);
}, 2000);
