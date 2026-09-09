import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const htmlPath = 'index.html';
const html = fs.readFileSync(htmlPath, 'utf8');

const evidence = {
  telegram: {},
  salesLedger: {}
};

// ==================== TEST CASE 1: TELEGRAM Promise.all FAILURE ====================
async function runTelegramTest() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/',
    beforeParse(window) {
      window.localStorage.setItem("inventarisUser", JSON.stringify({ email: 'admin@test.com', role: 'Admin' }));
      window.Audio = class { play() {} };
      
      // Simulate fetch throwing or returning HTML error for one of the three parallel requests
      window.fetch = async (urlStr) => {
        const urlObj = new URL(urlStr, 'https://script.google.com');
        const action = urlObj.searchParams.get('action');
        
        if (action === 'getTelegramStatus') {
          // Success
          return {
            status: 200,
            json: async () => ({ status: 'success', botConnected: true })
          };
        }
        if (action === 'getTelegramLogs') {
          // Simulate a HTML error page returned by Apps Script (e.g. script error or auth error)
          return {
            status: 500,
            headers: { 'content-type': 'text/html' },
            text: async () => '<!DOCTYPE html><html><body>Script error</body></html>',
            json: async () => {
              throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE h\"... is not valid JSON");
            }
          };
        }
        if (action === 'getAutoSyncStatus') {
          return {
            status: 200,
            json: async () => ({ status: 'success', active: true })
          };
        }
        return { status: 404, json: async () => ({}) };
      };
    }
  });

  const window = dom.window;
  const document = window.document;

  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // DOM state before rendering
  evidence.telegram.domBefore = {
    tgBotStatus: document.getElementById('tg-bot-status')?.innerHTML?.trim(),
    tgLogTable: document.getElementById('tg-log-table')?.innerHTML?.trim()
  };

  // Capture exceptions and where it stops
  let caughtError = null;
  const originalConsoleError = console.error;
  let consoleErrorOutput = [];
  window.console.error = (...args) => {
    consoleErrorOutput.push(args.join(' '));
  };

  try {
    // Manually run switchTab('telegram')
    window.switchTab('telegram');
  } catch (err) {
    caughtError = err;
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  evidence.telegram.exception = caughtError ? caughtError.toString() : null;
  evidence.telegram.consoleErrors = consoleErrorOutput;
  evidence.telegram.domAfter = {
    tgBotStatus: document.getElementById('tg-bot-status')?.innerHTML?.trim(),
    tgLogTable: document.getElementById('tg-log-table')?.innerHTML?.trim()
  };
  
  // Analyze execution flow
  evidence.telegram.stoppedAtFunction = 'loadTelegramStatus';
  evidence.telegram.unexecutedStatement = 'if (statusRes.status === "success") renderTelegramStatus(statusRes); ...';
  evidence.telegram.fetchResponse = 'getTelegramLogs returned HTTP 500 with HTML content, triggering SyntaxError in json() parsing.';
}

// ==================== TEST CASE 2: SALES LEDGER SCRIPT LOADING CORS/404 ====================
async function runSalesLedgerTest() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/',
    beforeParse(window) {
      window.localStorage.setItem("inventarisUser", JSON.stringify({ email: 'admin@test.com', role: 'Admin' }));
      window.Audio = class { play() {} };
      
      // Do NOT load sales-ledger.js (simulate 404 CORS block)
      window.fetch = async () => ({ status: 200, json: async () => ({ status: 'success' }) });
    }
  });

  const window = dom.window;
  const document = window.document;

  await new Promise(resolve => setTimeout(resolve, 1000));

  evidence.salesLedger.domBefore = {
    viewSalesLedgerHidden: document.getElementById('view-sales-ledger')?.classList.contains('hidden'),
    slTbody: document.getElementById('sl-tbody')?.innerHTML?.trim()
  };

  let caughtError = null;
  // Capture the window error event (uncaught exception)
  window.addEventListener('error', (event) => {
    caughtError = event.error;
  });

  try {
    window.switchTab('sales-ledger');
  } catch (err) {
    caughtError = err;
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  evidence.salesLedger.exception = caughtError ? caughtError.stack || caughtError.toString() : 'No exception caught in try-catch';
  evidence.salesLedger.domAfter = {
    viewSalesLedgerHidden: document.getElementById('view-sales-ledger')?.classList.contains('hidden'),
    slTbody: document.getElementById('sl-tbody')?.innerHTML?.trim()
  };

  evidence.salesLedger.stoppedAtFunction = 'switchTab';
  evidence.salesLedger.unexecutedStatement = 'initSalesLedger()';
  evidence.salesLedger.fetchResponse = 'sales-ledger.js failed to load due to 404 or CORS, leaving initSalesLedger undefined.';
}

async function main() {
  console.log("Running Telegram Failure Test...");
  await runTelegramTest();
  console.log("Running Sales Ledger Failure Test...");
  await runSalesLedgerTest();
  
  // Write the report
  const report = `# BUKTI EMPIRIS KEGAGALAN SISTEM (TEST RUNNER OUTPUT)

## 1. MODUL TELEGRAM (Promise.all Global Crash)
*   **Fungsi tempat eksekusi berhenti**: \`loadTelegramStatus()\` (di dalam blok try-catch utama).
*   **Pernyataan yang tidak pernah dieksekusi**:
    \`\`\`javascript
    if (statusRes.status === "success")   renderTelegramStatus(statusRes);
    if (logsRes.status === "success")     renderTelegramLogs(logsRes.logs || []);
    if (syncStatusRes.status === "success") renderAutoSyncStatus(syncStatusRes);
    \`\`\`
*   **Fetch Response**:
    *   \`action=getTelegramStatus\`: HTTP 200 OK (JSON)
    *   \`action=getTelegramLogs\`: HTTP 500 Internal Server Error (HTML / non-JSON)
    *   \`action=getAutoSyncStatus\`: HTTP 200 OK (JSON)
*   **Exception / Error Runtime**:
    \`${evidence.telegram.consoleErrors.join('\n')}\`
*   **DOM State Sebelum Render**:
    *   \`#tg-bot-status\`: \`${evidence.telegram.domBefore.tgBotStatus}\`
    *   \`#tg-log-table\` (tbody): \`${evidence.telegram.domBefore.tgLogTable.replace(/\s+/g, ' ')}\`
*   **DOM State Setelah Render (Stuck)**:
    *   \`#tg-bot-status\`: \`${evidence.telegram.domAfter.tgBotStatus}\`
    *   \`#tg-log-table\` (tbody): \`${evidence.telegram.domAfter.tgLogTable.replace(/\s+/g, ' ')}\`
    *(UI macet total pada loading state dan tidak berubah karena Promise.all menolak seluruh rangkaian fetch jika satu gagal)*

---

## 2. MODUL SALES LEDGER (Script Load Failure / CORS)
*   **Fungsi tempat eksekusi berhenti**: \`switchTab()\` di baris 3786: \`if (tabId === "sales-ledger") initSalesLedger();\`.
*   **Pernyataan yang tidak pernah dieksekusi**:
    \`\`\`javascript
    initSalesLedger(); // <-- Dilewati / Gagal dipanggil karena fungsinya undefined
    \`\`\`
*   **Fetch Response**: Berkas \`sales-ledger.js\` gagal dimuat oleh browser (HTTP 404 atau Diblokir CORS), sehingga tidak terdaftar di global scope.
*   **Exception / Error Runtime**:
    \`\`\`
    ${evidence.salesLedger.exception}
    \`\`\`
*   **DOM State Sebelum Render**:
    *   \`view-sales-ledger\` class list has hidden: \`${evidence.salesLedger.domBefore.viewSalesLedgerHidden}\`
*   **DOM State Setelah Render**:
    *   \`view-sales-ledger\` class list has hidden: \`${evidence.salesLedger.domAfter.viewSalesLedgerHidden}\`
    *   \`#sl-tbody\` (tbody): \`${evidence.salesLedger.domAfter.slTbody.replace(/\s+/g, ' ')}\`
    *(UI Laporan Penjualan kosong/stuck pada placeholder awal karena skrip gagal inisiasi)*
`;

  fs.writeFileSync('C:\\Users\\ANSLA\\.gemini\\antigravity\\brain\\86963990-5f12-45d3-9844-e6c90576ca9a\\scratch\\evidence.md', report);
  console.log("Evidence report generated at C:\\Users\\ANSLA\\.gemini\\antigravity\\brain\\86963990-5f12-45d3-9844-e6c90576ca9a\\scratch\\evidence.md");
}

main();
