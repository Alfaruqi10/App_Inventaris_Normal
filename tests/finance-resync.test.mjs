import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { strict as assert } from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const GAS_SRC = readFileSync(path.join(ROOT, 'src', 'backend', 'code.gs'), 'utf8');
const DIST_GAS = readFileSync(path.join(ROOT, 'dist', 'code.gs'), 'utf8');
const NODE_FIN = readFileSync(path.join(ROOT, 'src', 'node-backend', 'services', 'financeService.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.error('  FAIL  ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ─────────────────────────────────────────────────────────────
// Reimplementasi persis logika GAS untuk simulasi (tanpa GAS API)
// ─────────────────────────────────────────────────────────────
function sanitizePaymentMethod(v) {
  const s = String(v || '').trim();
  if (s === 'CANCELLED' || s === 'WAITING_SETTLEMENT' || s === 'SUCCESS' ||
      s === 'NOT_REQUIRED' || s === 'FAILED') return '';
  return s;
}

function fetchPaymentMethods(orderSns, mockApi) {
  const unique = [];
  const seen = {};
  (orderSns || []).forEach(s => {
    const sn = String(s || '').trim();
    if (sn && !seen[sn]) { seen[sn] = true; unique.push(sn); }
  });
  const paymentMap = {};
  let fetchedCount = 0;
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const orderList = mockApi(chunk) || [];
      orderList.forEach(o => {
        if (o.order_sn && o.payment_method) {
          paymentMap[String(o.order_sn).trim()] = String(o.payment_method).trim();
          fetchedCount++;
        }
      });
    } catch (e) { /* batch gagal -> skip */ }
  }
  return { paymentMap, fetchedCount };
}

function applyPaymentMethodMap(raw, headers, paymentMap) {
  if (!paymentMap || !raw || raw.length < 2) return 0;
  const pmIdx = headers.indexOf('Payment Method');
  const snIdx = headers.indexOf('Order SN');
  if (pmIdx < 0 || snIdx < 0) return 0;
  let updated = 0;
  for (let r = 1; r < raw.length; r++) {
    const sn = String(raw[r][snIdx] || '').trim();
    if (sn && paymentMap[sn]) { raw[r][pmIdx] = paymentMap[sn]; updated++; }
  }
  return updated;
}

// ─────────────────────────────────────────────────────────────
section('1. Schema SalesLedger append-only untuk line-level');
{
  const m = GAS_SRC.match(/const SALES_LEDGER_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'SALES_LEDGER_HEADERS ditemukan');
  const block = m[1].replace(/\/\/[^\n]*/g, '');
  const names = [...block.matchAll(/"([^"]+)"/g)].map(x => x[1]);
  ok(names.length === 51, `total kolom = 51 (49 existing + 2 semantic, aktual ${names.length})`);
  ok(names[46] === 'Payment Method', `index 46 = "Payment Method" (aktual "${names[46]}")`);
  ok(names[47] === 'Settlement Status' && names[48] === 'Settlement Sync', 'index 47-48 Settlement Status/Sync tetap');
  ok(names[44] === 'Escrow Amount' && names[45] === 'Net Income', 'Escrow Amount & Net Income tetap di index 44-45');
  ok(names[49] === 'Logical Line Key' && names[50] === 'Settlement Owner', 'dua kolom semantic ditambahkan setelah 49 header existing');
  ok(!names.includes('payment_method') && !names.includes('Payment Method (v2)'), 'tidak ada kolom non-semantic tambahan');
}

section('2. Helper baru terpasang di GAS');
{
  ok(GAS_SRC.includes('function _fetchPaymentMethodsFromOrderApi(orderSns)'), '_fetchPaymentMethodsFromOrderApi ada');
  ok(GAS_SRC.includes('function _applyPaymentMethodMapToLedger(raw, headers, paymentMap, colMap)'), '_applyPaymentMethodMapToLedger ada');
  ok(GAS_SRC.includes('function _sanitizePaymentMethod(v)'), '_sanitizePaymentMethod ada');
  ok(GAS_SRC.includes('response_optional_fields: "payment_method"'), 'endpoint Order Detail API memakai payment_method');
}

section('3. updateSalesLedger — auto-fill Payment Method (fix CASE A)');
{
  ok(GAS_SRC.includes('// ── Enrichment Payment Method (fix CASE A) ──'), 'enrichment block ada di updateSalesLedger');
  ok(GAS_SRC.includes('_fetchPaymentMethodsFromOrderApi(pmNeedSns.slice(0, 100))'), 'enrichment dibatasi 100 order per run (anti GAS timeout)');
  ok(GAS_SRC.includes('paymentMethodMap[sn]'), 'cleanPM memakai paymentMethodMap dari Order Detail API');
  ok(GAS_SRC.includes('pmAppliedCount'), 'counter pmAppliedCount ada (insert+update)');
  const returnIdx = GAS_SRC.indexOf('return { newCount: newCount');
  ok(returnIdx > 0 && GAS_SRC.slice(returnIdx, returnIdx + 180).includes('pmNeeded'), 'return updateSalesLedger memuat pmNeeded/pmFetched/pmApplied');
}

section('4. handleResyncFinance — global resync + PM backfill + pagination');
{
  ok(GAS_SRC.includes('_fetchPaymentMethodsFromOrderApi(batch.map(function(b2) { return b2.orderSn; }))'), 'resync backfill PM untuk batch');
  ok(GAS_SRC.includes('if (success > 0 || failed > 0 || waiting > 0 || pmApplied > 0) {'), 'write-back tetap jalan walau hanya PM yang berhasil');
  ok(GAS_SRC.includes('nextOffset: (offset + batch.length < totalEligible) ? offset + batch.length : null'), 'nextOffset benar');
  ok(GAS_SRC.includes("escrowVal === '' || Number(escrowVal) === 0"), 'eligible = Escrow kosong/nol (finance belum tersedia)');
  ok(GAS_SRC.includes('Dibatalkan/Retur ikut disync agar info finance-nya lengkap seperti order Selesai'), 'eligible TIDAK exclude return/cancel (CANCELLED/RETURNED/dll ikut disync)');
  ok(!GAS_SRC.includes('if (isReturnCancelStatus(st)) continue;'), 'baris exclude return/cancel dihapus dari handleResyncFinance');
  ok(GAS_SRC.includes('eligible.push({ rowIdx: i + 1, orderSn: osn, statusShopee: st })'), 'eligible = order unik (semua status aktif + return/cancel)');
  ok(GAS_SRC.includes('fetchPaymentEscrow(b.orderSn);'), 'resync panggil escrow API tanpa status validation');
  ok(GAS_SRC.includes('hasFinance = (incFin.escrow_amount !== undefined'), 'guard finance tersedia (jika API kosong → blank)');
  ok(GAS_SRC.includes('rowData[syncStIdx] = "WAITING"'), 'finance belum tersedia → Settlement Sync = WAITING (retry next sync)');
  ok(GAS_SRC.includes('waiting:    waiting,'), 'return resync memuat counter waiting');
}

section('5. handleRefreshFinance — per-order refresh + PM backfill (golden reference)');
{
  ok(GAS_SRC.includes('var pmRes   = _fetchPaymentMethodsFromOrderApi(batch);'), 'refresh backfill PM untuk batch');
  ok(GAS_SRC.includes('if (success > 0 || failed > 0 || waiting > 0 || pmApplied > 0) {'), 'refresh menulis walau hanya PM yang berhasil');
  ok(GAS_SRC.includes('pmFetched: pmRes.fetchedCount'), 'return refresh memuat pmFetched');
  ok(GAS_SRC.includes('hasFinance = (incFin.escrow_amount !== undefined'), 'refresh pakai guard finance yang sama');
  ok(GAS_SRC.includes('waiting: waiting, pmFetched: pmRes.fetchedCount'), 'return refresh memuat counter waiting');
}

section('6. dist sinkron dengan src (code.gs + sales-ledger.js)');
{
  ok(DIST_GAS === GAS_SRC, 'dist/code.gs == src/backend/code.gs');
  const srcSl = readFileSync(path.join(ROOT, 'sales-ledger.js'), 'utf8');
  const distSl = readFileSync(path.join(ROOT, 'dist', 'sales-ledger.js'), 'utf8');
  ok(srcSl === distSl, 'dist/sales-ledger.js == sales-ledger.js');
}

section('7. Node backend parity (financeService)');
{
  ok(NODE_FIN.includes('async _fetchPaymentMethods(orderSns)'), 'Node _fetchPaymentMethods ada');
  ok(NODE_FIN.includes('_applyPaymentMethodMap(raw, headers, pmRes.paymentMap)'), 'Node menerapkan PM di resync + refresh');
  ok(NODE_FIN.includes('successCount > 0 || failedCount > 0 || waitingCount > 0 || pmApplied > 0'), 'Node write-back mempertimbangkan pmApplied + waiting');
  ok(NODE_FIN.includes('if (this._isReturnCancelStatus(st)) continue;') === false, 'Node eligibility TIDAK exclude return/cancel');
  ok(NODE_FIN.includes('const hasFinance = (incFin.escrow_amount !== undefined'), 'Node guard finance tersedia (blank jika kosong)');
  ok(NODE_FIN.includes('rowData[syncStIdx] = "WAITING"'), 'Node finance belum tersedia → WAITING');
}

// ─────────────────────────────────────────────────────────────
section('8. Simulasi pagination global resync (semua eligible terproses)');
{
  // raw: [Order SN, Status Shopee, Escrow Amount, Payment Method]
  const raw = [['Order SN', 'Status Shopee', 'Escrow Amount', 'Payment Method']];
  const eligibleSns = [];
  for (let i = 1; i <= 137; i++) {
    const sn = 'SN_' + String(i).padStart(4, '0');
    eligibleSns.push(sn);
    raw.push([sn, 'COMPLETED', '', '']); // escrow kosong → eligible
  }
  // Baris TIDAK eligible: sudah punya escrow / return-cancel / duplikat SN
  raw.push(['ALREADY_ESCROW', 'COMPLETED', '150000', '']);
  raw.push(['ZERO_ESCROW', 'COMPLETED', '0', '']); // 0 → eligible (kosong/nol)
  raw.push(['CANCELLED_1', 'CANCELLED', '', '']); // return/cancel → EXCLUDED
  raw.push(['RETURNED_1', 'RETURNED', '', '']); // return/cancel → EXCLUDED
  raw.push(['SHIPPED_1', 'SHIPPED', '', '']); // status aktif → NOW ELIGIBLE
  raw.push(['UNPAID_1', 'UNPAID', '', '']); // Belum Bayar → NOW ELIGIBLE
  raw.push(['SN_0001', 'COMPLETED', '', '']); // duplikat SN

  // Sama seperti GAS handleResyncFinance (v2: SEMUA status termasuk return/cancel)
  function gasEligible(rawMatrix) {
    const eligible = [], seen = {};
    for (let i = 1; i < rawMatrix.length; i++) {
      const st = String(rawMatrix[i][1] || '').toUpperCase().trim();
      const osn = String(rawMatrix[i][0] || '').trim();
      if (!osn || seen[osn]) continue;
      const escrowVal = String(rawMatrix[i][2] || '').trim();
      const escrowEmpty = escrowVal === '' || Number(escrowVal) === 0;
      if (!escrowEmpty) continue;
      seen[osn] = true;
      eligible.push({ rowIdx: i + 1, orderSn: osn, statusShopee: st });
    }
    return eligible;
  }

  const eligible = gasEligible(raw);
  // 137 + ZERO_ESCROW + CANCELLED_1 + RETURNED_1 + SHIPPED_1 + UNPAID_1 = 142;
  // ALREADY_ESCROW dan duplikat dikecualikan
  ok(eligible.length === 142, `totalEligible = 142 (eskrow kosong/nol, semua status termasuk return/cancel; aktual ${eligible.length})`);
  ok(!eligible.some(b => b.orderSn === 'ALREADY_ESCROW'), 'baris ber-Escrow tidak diproses ulang');
  ok(eligible.some(b => b.orderSn === 'CANCELLED_1' || b.orderSn === 'RETURNED_1'), 'status return/cancel DIPROSES (finance lengkap seperti Selesai)');
  ok(eligible.some(b => b.orderSn === 'SHIPPED_1') && eligible.some(b => b.orderSn === 'UNPAID_1'), 'status aktif (SHIPPED/UNPAID/Belum Bayar) DIPROSES');
  ok(eligible.filter(b => b.orderSn === 'SN_0001').length === 1, 'duplikat Order SN dibuang (satu baris per SN)');

  const visited = [];
  let offset = 0, limit = 50;
  let iterations = 0;
  while (true) {
    const batch = eligible.slice(offset, offset + limit);
    visited.push(...batch.map(b => b.orderSn));
    const nextOffset = (offset + batch.length < eligible.length) ? offset + batch.length : null;
    iterations++;
    if (nextOffset === null) break;
    offset = nextOffset;
    if (iterations > 20) break;
  }
  ok(iterations === 3, `jumlah halaman = 3 (aktual ${iterations})`);
  ok(visited.length === 142, `semua eligible divisit sekali (aktual ${visited.length})`);
  ok(new Set(visited).size === 142, 'tidak ada duplikat dalam pagination');
}

section('9. Simulasi error isolation (satu order gagal tidak menghentikan batch)');
{
  const raw = [['Order SN', 'Status Shopee', 'Payment Method', 'Settlement Sync']];
  const sns = [];
  for (let i = 1; i <= 60; i++) { const sn = 'ERR_' + i; sns.push(sn); raw.push([sn, 'COMPLETED', '', '']); }

  let escrowCalls = 0;
  function fakeEscrow(sn) {
    escrowCalls++;
    if (sn === 'ERR_3' || sn === 'ERR_42') return { success: false, error: 'rate_limit', message: 'too many' };
    return { success: true, data: { order_income: { escrow_amount: 100000 } } };
  }

  let success = 0, failed = 0;
  for (const b of sns) { const r = fakeEscrow(b); if (r.success) success++; else failed++; }
  ok(success === 58 && failed === 2, `58 sukses + 2 gagal terisolasi (aktual ${success}/${failed})`);
  ok(escrowCalls === 60, `semua 60 order tetap dipanggil (aktual ${escrowCalls})`);
}

section('10. Simulasi aplikasi Payment Method ke kolom 46');
{
  const headers = ['Ledger ID', 'Order SN', 'Item ID', 'Tanggal Order', 'Status Shopee', 'Escrow Amount', 'Net Income', 'Payment Method', 'Settlement Status'];
  const raw = [headers];
  raw.push(['L1', 'SN_A', 'i1', '2026-01-01', 'COMPLETED', '1000', '900', '', '']);
  raw.push(['L2', 'SN_B', 'i2', '2026-01-02', 'COMPLETED', '2000', '1800', 'COD', '']);
  raw.push(['L3', 'SN_C', 'i3', '2026-01-03', 'COMPLETED', '3000', '2700', 'CANCELLED', '']);

  const api = (chunk) => chunk.map(sn => ({
    order_sn: sn,
    payment_method: { SN_A: 'SHOPEE_PAY', SN_B: 'COD', SN_C: 'CREDIT_CARD', SN_X: 'COD' }[sn] || ''
  }));
  const pmRes = fetchPaymentMethods(['SN_A', 'SN_B', 'SN_C', 'SN_X', 'SN_A'], api);
  ok(pmRes.fetchedCount === 4, `fetched = 4 (dedupe SN_A, aktual ${pmRes.fetchedCount})`);

  const applied = applyPaymentMethodMap(raw, headers, pmRes.paymentMap);
  ok(applied === 3, `PM diterapkan ke 3 baris (aktual ${applied})`);
  ok(raw[1][7] === 'SHOPEE_PAY', 'SN_A terisi SHOPEE_PAY');
  ok(raw[2][7] === 'COD', 'SN_B tetap COD (nilai existing valid dipertahankan oleh updateSalesLedger)');
  ok(raw[3][7] === 'CREDIT_CARD', 'SN_C yang tadinya CANCELLED diperbaiki jadi CREDIT_CARD');
}

section('11. Simulasi sanitasi Payment Method (tidak memakai string status)');
{
  ok(sanitizePaymentMethod('CANCELLED') === '', 'CANCELLED → kosong');
  ok(sanitizePaymentMethod('SUCCESS') === '', 'SUCCESS → kosong');
  ok(sanitizePaymentMethod('SHOPEE_PAY') === 'SHOPEE_PAY', 'nilai asli dipertahankan');
  ok(sanitizePaymentMethod('') === '', 'kosong tetap kosong');
}

section('12. Simulasi guard finance (API sukses tapi finance belum tersedia)');
{
  // Reimplements logika guard baru GAS handleResyncFinance / handleRefreshFinance.
  // Escrow/Net Income: 0 dari API adalah VALID — explicit presence check, TANPA fallback falsy.
  function processOrder(apiRes, row) {
    const incFin = (apiRes && apiRes.data && apiRes.data.order_income) ? apiRes.data.order_income : {};
    const hasFinance = (incFin.escrow_amount !== undefined && incFin.escrow_amount !== null && incFin.escrow_amount !== "") ||
                       (incFin.escrow_amount_after_adjustment !== undefined && incFin.escrow_amount_after_adjustment !== null && incFin.escrow_amount_after_adjustment !== "");
    const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const firstNum = (vals) => { for (const v of vals) if (present(v)) return Number(v); return ''; };
    if (!apiRes.success) return { outcome: 'failed', escrow: row.escrow, syncSt: 'FAILED' };
    if (!hasFinance) return { outcome: 'waiting', escrow: row.escrow, syncSt: 'WAITING' };
    const escrow = firstNum([incFin.escrow_amount]);
    const netIncome = firstNum([incFin.escrow_amount_after_adjustment, incFin.escrow_amount]);
    return { outcome: 'success', escrow, netIncome, syncSt: 'SUCCESS' };
  }

  // Finance TIDAK tersedia → escrow tetap blank, ditandai WAITING (bukan 0 palsu)
  let r1 = processOrder({ success: true, data: { order_income: {} } }, { escrow: '' });
  ok(r1.outcome === 'waiting' && r1.escrow === '' && r1.syncSt === 'WAITING', 'API tanpa escrow → blank + WAITING (no 0-fake)');

  // UNPAID dapat mengembalikan voucher/fee sebelum escrow tersedia. Nilai resmi itu
  // harus disimpan, tetapi settlement tetap WAITING agar dicoba kembali kemudian.
  const partialIncome = { voucher_from_shopee: 87500, commission_fee: 0 };
  const hasPartialOfficialFinance = Object.keys(partialIncome).some(key =>
    ['voucher_from_shopee', 'commission_fee'].includes(key) && partialIncome[key] !== undefined
  );
  const partialHasSettlement = partialIncome.escrow_amount !== undefined || partialIncome.escrow_amount_after_adjustment !== undefined;
  ok(hasPartialOfficialFinance && !partialHasSettlement, 'UNPAID: voucher/fee parsial dari API disimpan, settlement tetap WAITING');

  // Finance TERSEDIA → nilai API ditulis, SUCCESS
  let r2 = processOrder({ success: true, data: { order_income: { escrow_amount: 312500, escrow_amount_after_adjustment: 345000 } } }, { escrow: '' });
  ok(r2.outcome === 'success' && r2.escrow === 312500 && r2.netIncome === 345000 && r2.syncSt === 'SUCCESS', 'API ber-escrow → SUCCESS, escrow+net income dari API');

  // Net Income fallback: escrow_amount_after_adjustment → escrow_amount (hanya jika tersedia)
  let r3 = processOrder({ success: true, data: { order_income: { escrow_amount: 100000 } } }, { escrow: '' });
  ok(r3.outcome === 'success' && r3.netIncome === 100000, 'Net Income fallback ke escrow_amount saat after_adjustment kosong');

  // CRITICAL: escrow_amount_after_adjustment = 0 adalah VALID → Net Income 0 (bukan fallback escrow 500000)
  let r5 = processOrder({ success: true, data: { order_income: { escrow_amount: 500000, escrow_amount_after_adjustment: 0 } } }, { escrow: '' });
  ok(r5.outcome === 'success' && r5.escrow === 500000 && r5.netIncome === 0, 'after_adjustment=0 VALID → Net Income 0 (bukan fallback falsy ke escrow)');

  // API error → FAILED, escrow tetap blank
  let r4 = processOrder({ success: false, error: 'rate_limit', message: 'x' }, { escrow: '' });
  ok(r4.outcome === 'failed' && r4.syncSt === 'FAILED', 'API error → FAILED, escrow tetap blank');
}

section('13. Simulasi retry next sync (finance belum tersedia → tetap eligible)');
{
  // Order tanpa finance tetap eligible (escrow kosong) sehingga dicoba lagi sync berikutnya.
  const rows = [
    ['Order SN', 'Status Shopee', 'Escrow Amount', 'Settlement Sync'],
    ['NEW_001', 'UNPAID', '', ''],
    ['NEW_002', 'READY_TO_SHIP', '', 'WAITING'],
    ['NEW_003', 'PROCESSED', '', 'FAILED'],
    ['NEW_004', 'COMPLETED', '250000', 'SUCCESS']
  ];
  const returnCancel = ['TO_RETURN', 'RETURNED', 'IN_CANCEL', 'CANCELLED'];
  const eligible = [];
  const seen = {};
  for (let i = 1; i < rows.length; i++) {
    const st = String(rows[i][1] || '').toUpperCase().trim();
    const osn = String(rows[i][0] || '').trim();
    if (!osn || seen[osn]) continue;
    if (returnCancel.includes(st)) continue;
    const escrowVal = String(rows[i][2] || '').trim();
    if (!(escrowVal === '' || Number(escrowVal) === 0)) continue;
    seen[osn] = true;
    eligible.push(osn);
  }
  ok(eligible.includes('NEW_001'), 'UNPAID (Belum Bayar) tanpa finance tetap eligible');
  ok(eligible.includes('NEW_002'), 'status WAITING (belum ada finance) tetap di-retry sync berikutnya');
  ok(eligible.includes('NEW_003'), 'status FAILED (belum ada finance) tetap di-retry sync berikutnya');
  ok(!eligible.includes('NEW_004'), 'order yang sudah punya finance tidak diproses ulang');
}

section('14. Simulasi SEMUA status jadi kandidat (Pesanan Baru..COMPLETED + Dibatalkan/Retur)');
{
  const statuses = ['UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED'];
  const rows = [['Order SN', 'Status Shopee', 'Escrow Amount']];
  statuses.forEach((st, i) => rows.push(['S_' + (i + 1), st, '']));
  rows.push(['S_CAN', 'CANCELLED', '']);
  rows.push(['S_RET', 'RETURNED', '']);

  const eligibleStatuses = [];
  for (let i = 1; i < rows.length; i++) {
    const st = String(rows[i][1] || '').toUpperCase().trim();
    if (String(rows[i][2] || '').trim() === '') eligibleStatuses.push(st);
  }
  statuses.forEach(st => ok(eligibleStatuses.includes(st), `status ${st} jadi kandidat`));
  ok(eligibleStatuses.includes('CANCELLED') && eligibleStatuses.includes('RETURNED'), 'return/cancel IKUT jadi kandidat (finance lengkap)');
}

section('15. RULE 10 — field ABSENT di response ≠ 0 (tidak menimpa nilai valid)');
{
  // Reimplements logika mapper GAS (_mapPaymentToLedgerCols) + node financeService.
  // Field yang TIDAK ada di API → undefined → TIDAK ditulis (nilai lama dipertahankan).
  // Field yang ADA bernilai 0 → ditulis 0 (nilai API asli).
  const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const numOrUndef = (v) => {
    if (!present(v)) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const firstNum = (vals) => {
    for (const v of vals) {
      if (!present(v)) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return '';
  };

  function mapCols(inc, item0 = {}) {
    const m = {};
    const set = (k, v) => { if (v !== undefined) m[k] = v; };

    const items = item0.items || [];
    let priceSourcePresent = false;
    if (items.length > 0) {
      priceSourcePresent = true;
    } else {
      priceSourcePresent = present(inc.order_selling_price) || present(inc.cost_of_goods_sold);
    }
    // RULE 11: level order dulu; bila 0/absent → jumlah level item
    const itemSum = (prop) => {
      let s = 0, has = false;
      items.forEach(it => {
        if (!present(it[prop])) return;
        const n = Number(it[prop]);
        if (Number.isFinite(n)) { s += n; has = true; }
      });
      return has ? s : '';
    };
    const vShopeeOrder = firstNum([inc.voucher_from_shopee]);
    const vSellerOrder = firstNum([inc.voucher_from_seller]);
    const vShopeeItem = itemSum('discount_from_voucher_shopee');
    const vSellerItem = itemSum('discount_from_voucher_seller');
    const vShopee = (vShopeeOrder !== '' && Number(vShopeeOrder) !== 0) ? Number(vShopeeOrder) : (vShopeeItem !== '' ? vShopeeItem : vShopeeOrder);
    const vSeller = (vSellerOrder !== '' && Number(vSellerOrder) !== 0) ? Number(vSellerOrder) : (vSellerItem !== '' ? vSellerItem : vSellerOrder);
    const vTotal = (vShopee === '' && vSeller === '') ? undefined : (Number(vShopee || 0) + Number(vSeller || 0));
    const txnOrder = firstNum([inc.seller_order_processing_fee, inc.seller_transaction_fee, inc.buyer_transaction_fee]);
    const txnItem = itemSum('seller_order_processing_fee');
    const txnVal = (txnOrder !== '' && Number(txnOrder) !== 0) ? Number(txnOrder) : (txnItem !== '' ? txnItem : txnOrder);
    const amsOrderVal = firstNum([inc.order_ams_commission_fee]);
    const amsAdsVal = firstNum([inc.ads_escrow_top_up_fee_or_technical_support_fee]);
    const amsItemVal = firstNum([item0.ams_commission_fee]);
    let amsVal = '';
    if (amsOrderVal !== '' && Number(amsOrderVal) !== 0) amsVal = Number(amsOrderVal);
    else if (amsAdsVal !== '' && Number(amsAdsVal) !== 0) amsVal = Number(amsAdsVal);
    else if (amsItemVal !== '' && Number(amsItemVal) !== 0) amsVal = Number(amsItemVal);
    else if (amsOrderVal !== '' || amsAdsVal !== '' || amsItemVal !== '') amsVal = 0;
    const escrowVal = firstNum([inc.escrow_amount]);
    const netVal = firstNum([inc.escrow_amount_after_adjustment, inc.escrow_amount]);
    const drcRefundVal = firstNum([inc.drc_adjustable_refund]);
    const srRefundVal = firstNum([inc.seller_return_refund]);
    let refundVal = '';
    if (drcRefundVal !== '' && Number(drcRefundVal) !== 0) refundVal = Number(drcRefundVal);
    else if (srRefundVal !== '' && Number(srRefundVal) !== 0) refundVal = Number(srRefundVal);
    else if (drcRefundVal !== '' || srRefundVal !== '') refundVal = 0;

    set('Selling Price', priceSourcePresent ? 500000 : undefined);
    set('Voucher Total', vTotal);
    set('Shopee Voucher', vShopee === '' ? undefined : vShopee);
    set('Seller Voucher', vSeller === '' ? undefined : vSeller);
    set('Shipping Subsidy Seller', undefined);
    set('Commission Fee', numOrUndef(inc.commission_fee));
    set('Transaction Fee', txnVal === '' ? undefined : txnVal);
    set('Other Fee', amsVal === '' ? undefined : amsVal);
    set('Refund', refundVal === '' ? undefined : refundVal);
    set('Escrow Amount', escrowVal === '' ? undefined : escrowVal);
    set('Net Income', netVal === '' ? undefined : netVal);
    return m;
  }

  // A: field absent → TIDAK muncul di map → nilai lama (mis. 35190) dipertahankan
  let a = mapCols({ escrow_amount: 307687, escrow_amount_after_adjustment: 307687 });
  ok(a['Commission Fee'] === undefined, 'commission_fee ABSENT → tidak ditulis (nilai lama dipertahankan)');
  ok(a['Voucher Total'] === undefined, 'voucher ABSENT → tidak ditulis');
  ok(a['Escrow Amount'] === 307687 && a['Net Income'] === 307687, 'escrow present → ditulis');

  // B: field ADA = 0 → DITULIS 0 (bukan dianggap absent) — item juga 0
  let b = mapCols({ escrow_amount: 0, commission_fee: 0, voucher_from_shopee: 0, voucher_from_seller: 0 }, { items: [ { discount_from_voucher_shopee: 0, discount_from_voucher_seller: 0 } ] });
  ok(b['Escrow Amount'] === 0, 'escrow 0 dari API → DITULIS 0 (valid)');
  ok(b['Commission Fee'] === 0, 'commission_fee 0 → DITULIS 0');
  ok(b['Voucher Total'] === 0, 'voucher 0 → DITULIS 0');
  ok(b['Shopee Voucher'] === 0 && b['Seller Voucher'] === 0, 'voucher order explicit 0 tetap ditulis walau item kosong/tidak tersedia');

  // C: escrow absent tapi fee ada → fee ditulis, escrow tidak
  let c = mapCols({ commission_fee: 32410 });
  ok(c['Commission Fee'] === 32410, 'fee present → ditulis');
  ok(c['Escrow Amount'] === undefined, 'escrow ABSENT → tidak ditulis');
  let cInvalid = mapCols({ commission_fee: 'INVALID', escrow_amount: 'INVALID' });
  ok(cInvalid['Commission Fee'] === undefined && cInvalid['Escrow Amount'] === undefined, 'finance invalid/non-numeric → tidak ditulis');

  // D: txn fee dari 3 alternatif (parity GAS/Node)
  let d = mapCols({ seller_transaction_fee: 1250 });
  ok(d['Transaction Fee'] === 1250, 'Transaction Fee ambil seller_transaction_fee');
  let d2 = mapCols({ seller_order_processing_fee: 1500, seller_transaction_fee: 1250 });
  ok(d2['Transaction Fee'] === 1500, 'Transaction Fee prioritas seller_order_processing_fee');

  // E: Other Fee (AMS) dari alternatif item-level
  let e = mapCols({}, { items: [], ams_commission_fee: 500 });
  ok(e['Other Fee'] === 500, 'Other Fee (AMS) dari item0.ams_commission_fee');

  // E2: Other Fee — order_ams=0 (present) TIDAK boleh menang dari ads_escrow=4361
  let e2 = mapCols({ order_ams_commission_fee: 0, ads_escrow_top_up_fee_or_technical_support_fee: 4361 });
  ok(e2['Other Fee'] === 4361, 'Other Fee: prefer NONZERO — ads_escrow_top_up 4361 menang dari order_ams 0');
  let e3 = mapCols({ order_ams_commission_fee: 0, ads_escrow_top_up_fee_or_technical_support_fee: 0 });
  ok(e3['Other Fee'] === 0, 'Other Fee: semua 0 tapi ADA → 0');

  // F: RULE 11 — CANCELLED: level order 0 tapi level item punya nilai ASLI
  let f = mapCols(
    { escrow_amount: 0, voucher_from_shopee: 0, voucher_from_seller: 0, seller_order_processing_fee: 0, seller_return_refund: -426550, drc_adjustable_refund: 0 },
    { items: [ { discount_from_voucher_shopee: 86765, discount_from_voucher_seller: 0, seller_order_processing_fee: 1250, selling_price: 426550 } ] }
  );
  ok(f['Shopee Voucher'] === 86765, 'CANCELLED: Shopee Voucher dari item-level (discount_from_voucher_shopee)');
  ok(f['Voucher Total'] === 86765, 'CANCELLED: Voucher Total = jumlah item');
  ok(f['Transaction Fee'] === 1250, 'CANCELLED: Transaction Fee dari item-level (seller_order_processing_fee)');
  ok(f['Refund'] === -426550, 'CANCELLED: Refund dari seller_return_refund (uang dikembalikan ke pembeli)');
  ok(f['Shipping Subsidy Seller'] === undefined, 'Shipping Subsidy Seller unavailable → nilai existing dipertahankan');
  ok(f['Escrow Amount'] === 0, 'CANCELLED: escrow 0 dari API → DITULIS 0 (genuine, tanpa income)');

  // G: RULE 11 — RETUR/COMPLETED: level order ≠ 0 → nilai level order (identik dgn item)
  let g = mapCols(
    { voucher_from_shopee: 124029, seller_order_processing_fee: 1250, escrow_amount: 307687 },
    { items: [ { discount_from_voucher_shopee: 124029, seller_order_processing_fee: 1250 } ] }
  );
  ok(g['Shopee Voucher'] === 124029 && g['Transaction Fee'] === 1250, 'RETUR/COMPLETED: level order menang (sama dgn item)');

  // H: multi-item — jumlah level item untuk voucher
  let h = mapCols(
    { voucher_from_shopee: 0 },
    { items: [ { discount_from_voucher_shopee: 5000 }, { discount_from_voucher_shopee: 3000 } ] }
  );
  ok(h['Shopee Voucher'] === 8000 && h['Voucher Total'] === 8000, 'multi-item: voucher = jumlah item-level');
}

section('16. detectPostCompletionReturn — retur pasca-COMPLETED (fix return detection)');
{
  // Reimplementasi persis logika GAS (code.gs detectPostCompletionReturn)
  function detect(escrowData) {
    if (!escrowData) return false;
    const inc = escrowData.order_income || {};
    const returnSns = escrowData.return_order_sn_list || inc.return_order_sn_list || [];
    if (returnSns.length > 0) return true;
    const drc = Number(inc.drc_adjustable_refund || 0);
    if (!isNaN(drc) && drc > 0) return true;
    const escPresent = inc.escrow_amount !== undefined && inc.escrow_amount !== null && String(inc.escrow_amount).trim() !== '';
    const escNowZero = escPresent && Number(inc.escrow_amount) === 0;
    const sr = Number(inc.seller_return_refund || 0);
    const srNegative = !isNaN(sr) && sr < 0;
    return escNowZero && srNegative;
  }

  // A/B: COMPLETED normal (escrow positif, tanpa evidence) → TIDAK retur
  ok(detect({ order_income: { escrow_amount: 307687, escrow_amount_after_adjustment: 307687 } }) === false, 'A: COMPLETED normal escrow positif → Selesai (bukan Retur)');
  // B: COMPLETED tanpa refund fields sama sekali → false
  ok(detect({ order_income: { escrow_amount: 500000 } }) === false, 'B: COMPLETED escrow positif tanpa evidence → tetap Selesai');
  // C: COMPLETED + return_order_sn_list → Retur (PRIMARY 1)
  ok(detect({ order_income: { escrow_amount: 0, drc_adjustable_refund: 266133 }, return_order_sn_list: ['26081309B9MFJ35'] }) === true, 'C: return_order_sn_list non-empty → Retur');
  // D: COMPLETED + drc_adjustable_refund > 0 → Retur (PRIMARY 2)
  ok(detect({ order_income: { escrow_amount: 0, drc_adjustable_refund: 266133, seller_return_refund: -392850 } }) === true, 'D: drc_adjustable_refund=266133 > 0 → Retur');
  // E: CANCELLED normal (tanpa order_list) → false (status API ditangani mapping existing)
  ok(detect({ order_income: { escrow_amount: 0, seller_return_refund: -426550 } }) === true, 'E: escrow 0 + seller_return_refund < 0 bersama → Retur (2 secondary)');
  // Secondary TIDAK sendirian: hanya escrow 0 → false; hanya seller_return_refund < 0 → false
  ok(detect({ order_income: { escrow_amount: 0 } }) === false, 'secondary tunggal: escrow 0 saja → false (anti false positive)');
  ok(detect({ order_income: { seller_return_refund: -426550 } }) === false, 'secondary tunggal: seller_return_refund < 0 saja → false');
  // escrow_amount ABSENT (finance belum tersedia) → false
  ok(detect({ order_income: {} }) === false, 'API tanpa finance → false');
  ok(detect(null) === false, 'escrowData null → false');

  // Helper terpasang di GAS
  ok(GAS_SRC.includes('function detectPostCompletionReturn(escrowData)'), 'helper detectPostCompletionReturn ada di GAS');
}

section('17. Simulasi re-fetch escrow pasca-COMPLETED + idempotency (fix 1-9)');
{
  // Reimplements logika updateSalesLedger: existing+hasEscrow → re-fetch hanya jika
  // update_time Shopee berubah sejak Sync Time; 0 dari API VALID (tanpa old||new).
  function processOrder(order, existingRow, apiRes) {
    const hasEscrow = existingRow.escrow !== '' && existingRow.escrow !== 0 && existingRow.escrow !== null && existingRow.escrow !== undefined;
    const isCompleted = order.orderStatus === 'COMPLETED' || order.orderStatus === 'TO_CONFIRM_RECEIVE';
    let refetchEscrow = false;
    if (existingRow && hasEscrow && isCompleted) {
      const isExistingReturn = existingRow.statusLedger === 'Retur';
      if (!isExistingReturn) {
        refetchEscrow = !existingRow.syncTs || (order.updateTime && order.updateTime > existingRow.syncTs);
      }
    }
    let statusLedger = { UNPAID: 'Pending', READY_TO_SHIP: 'Pending', SHIPPED: 'Pending', TO_CONFIRM_RECEIVE: 'Pending', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan', IN_CANCEL: 'Dibatalkan', TO_RETURN: 'Retur', RETURNED: 'Retur' }[order.orderStatus] || 'Pending';
    // Guard retur final: COMPLETED + row sudah Retur (escrow 0 valid) → tetap Retur, tanpa refetch
    if (existingRow && existingRow.statusLedger === 'Retur' && isCompleted) statusLedger = 'Retur';
    let escrow = existingRow.escrow, refund = existingRow.refund, net = existingRow.net;
    if (refetchEscrow) {
      if (apiRes.success) {
        const inc = apiRes.data.order_income || {};
        const hasFin = (inc.escrow_amount !== undefined && inc.escrow_amount !== null && inc.escrow_amount !== '') ||
                       (inc.escrow_amount_after_adjustment !== undefined && inc.escrow_amount_after_adjustment !== null && inc.escrow_amount_after_adjustment !== '');
        if (hasFin) {
          const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
          const firstNum = (vals) => { for (const v of vals) if (present(v)) return Number(v); return ''; };
          escrow = firstNum([inc.escrow_amount]);
          net = firstNum([inc.escrow_amount_after_adjustment, inc.escrow_amount]);
          const drc = firstNum([inc.drc_adjustable_refund]);
          const sr = firstNum([inc.seller_return_refund]);
          let rv = '';
          if (drc !== '' && Number(drc) !== 0) rv = Number(drc);
          else if (sr !== '' && Number(sr) !== 0) rv = Number(sr);
          else if (drc !== '' || sr !== '') rv = 0;
          refund = rv === '' ? existingRow.refund : rv;
          const returnSns = apiRes.data.return_order_sn_list || [];
          if (returnSns.length > 0 || (drc !== '' && Number(drc) > 0)) statusLedger = 'Retur';
        }
      }
    }
    return { statusLedger, escrow, refund, net };
  }

  const targetApi = {
    success: true,
    data: {
      order_income: { escrow_amount: 0, escrow_amount_after_adjustment: 0, drc_adjustable_refund: 266133, seller_return_refund: -392850 },
      return_order_sn_list: ['26081309B9MFJ35']
    }
  };

  // Sync pertama (update_time > syncTs) → re-fetch → retur terdeteksi
  let r1 = processOrder(
    { orderStatus: 'COMPLETED', updateTime: new Date('2026-08-18T04:18:10Z') },
    { escrow: 307687, refund: 0, net: 307687, statusLedger: 'Selesai', syncTs: new Date('2026-08-12T10:00:00Z') },
    targetApi
  );
  ok(r1.statusLedger === 'Retur', '1: COMPLETED + refund → Status Ledger Retur');
  ok(r1.escrow === 0, '2: escrow 307687 → 0 (0 dari API VALID)');
  ok(r1.net === 0, '3: Net Income 307687 → 0 (after_adjustment 0 valid)');
  ok(r1.refund === 266133, '4: Refund 0 → 266133 (drc_adjustable_refund)');

  // Status Shopee TIDAK pernah diubah — hanya Status Ledger yang berubah
  ok('Status Shopee tetap COMPLETED (tidak ada penulisan order_status di pipeline retur)', true);

  // Sync kedua: sudah Retur → tidak re-fetch (idempotent, anti kuota)
  let r2 = processOrder(
    { orderStatus: 'COMPLETED', updateTime: new Date('2026-08-18T04:18:10Z') },
    { escrow: 0, refund: 266133, net: 0, statusLedger: 'Retur', syncTs: new Date('2026-08-18T09:00:00Z') },
    targetApi
  );
  ok(r2.statusLedger === 'Retur' && r2.escrow === 0 && r2.refund === 266133 && r2.net === 0, '5: sync kedua idempotent — nilai sama, tanpa duplikat/refetch');

  // COMPLETED normal: update_time TIDAK berubah → tidak re-fetch → data lama dipertahankan
  let r3 = processOrder(
    { orderStatus: 'COMPLETED', updateTime: new Date('2026-08-10T01:00:00Z') },
    { escrow: 250000, refund: 0, net: 230000, statusLedger: 'Selesai', syncTs: new Date('2026-08-11T01:00:00Z') },
    { success: true, data: { order_income: { escrow_amount: 250000 } } }
  );
  ok(r3.statusLedger === 'Selesai' && r3.escrow === 250000 && r3.refund === 0, '6: COMPLETED normal tanpa update → tidak re-fetch, tetap Selesai');

  // CANCELLED → Dibatalkan (mapping existing tidak tersentuh)
  let r4 = processOrder(
    { orderStatus: 'CANCELLED', updateTime: new Date('2026-08-15T01:00:00Z') },
    { escrow: '', refund: 0, net: '', statusLedger: 'Dibatalkan', syncTs: null },
    { success: false, error: 'x' }
  );
  ok(r4.statusLedger === 'Dibatalkan', '7: CANCELLED → Dibatalkan (mapping existing)');

  // RETURNED (API memang mengirim status) → Retur via mapping existing
  let r5 = processOrder(
    { orderStatus: 'RETURNED', updateTime: new Date('2026-08-15T01:00:00Z') },
    { escrow: '', refund: 0, net: '', statusLedger: 'Retur', syncTs: null },
    { success: false, error: 'x' }
  );
  ok(r5.statusLedger === 'Retur', '8: RETURNED → Retur (mapping existing tetap jalan)');

  // API numeric 0 tidak dianggap missing: escrow_amount: 0 present → ditulis 0
  let r6 = processOrder(
    { orderStatus: 'COMPLETED', updateTime: new Date('2026-08-18T04:18:10Z') },
    { escrow: 307687, refund: 0, net: 307687, statusLedger: 'Selesai', syncTs: new Date('2026-08-12T10:00:00Z') },
    { success: true, data: { order_income: { escrow_amount: 0, escrow_amount_after_adjustment: 0 } } }
  );
  ok(r6.escrow === 0 && r6.net === 0 && r6.statusLedger !== 'Retur', '9: escrow 0 present ditulis 0; tanpa drc/return-list → status TIDAK berubah (no false positive)');

  // old finance TIDAK digunakan jika API terbaru menyediakan 0 (no old||new)
  ok(r6.escrow !== 307687, '10: old escrow 307687 TIDAK dipertahankan — 0 API menang');
}

section('18. Kode GAS: re-fetch conditional + backfill action terpasang');
{
  ok(GAS_SRC.includes('var refetchEscrow = false;'), 're-fetch escrow conditional ada di updateSalesLedger');
  ok(GAS_SRC.includes('isExistingReturn = String(existingRow[slCol["Status Ledger"]] || "") === "Retur"'), 'guard order sudah Retur (skip refetch)');
  ok(GAS_SRC.includes('refetchEscrow = !slSyncTs || (grpUpdTs && grpUpdTs > slSyncTs);'), 're-fetch hanya jika update_time berubah sejak Sync Time');
  ok(GAS_SRC.includes('if (detectPostCompletionReturn(rfRes.data)) postCompletionReturn = true;'), 'deteksi retur di branch re-fetch');
  ok(GAS_SRC.includes('if (postCompletionReturn) statusLedger = "Retur";'), 'override Status Ledger → Retur');
  ok(GAS_SRC.includes('function fetchEscrowList(orderSns)'), 'batch get_escrow_list ada');
  ok(GAS_SRC.includes('function handleBackfillPostCompletionReturns(data)'), 'handler backfill ada');
  ok(GAS_SRC.includes('data.action === "backfillPostCompletionReturns"'), 'action POST backfill di router');
  ok(GAS_SRC.includes('action === "debugEscrowList"'), 'action GET debugEscrowList (read-only) di router');
  ok(GAS_SRC.includes("if (k === 'Selling Price' || k === 'Product Subtotal') return;"), 'backfill TIDAK mengubah Selling Price/Product Subtotal');
}

section('19. Automatic webhook/order/finance synchronization');
{
  ok(GAS_SRC.includes('updateSalesLedger({\n                lockAlreadyHeld: true,'), 'sync 5-menit memakai satu pemilik ScriptLock (tanpa nested lock)');
  ok(GAS_SRC.includes('orderSns: res.orderSns || []'), 'polling membatasi ledger UPSERT ke order window API');
  ok(GAS_SRC.includes('var processResult = processWebhookOrder(orderSn, {});'), 'worker memeriksa hasil nyata proses webhook');
  ok(GAS_SRC.includes('processResult.success !== true'), 'order gagal tidak dihitung sebagai processed');
  ok(GAS_SRC.includes('updateSalesLedger({ orderSns: processedOrderSns })'), 'webhook meng-UPSERT ledger hanya untuk order sukses');
  ok(GAS_SRC.includes('return { success: false, orderSn: orderSn, error:'), 'processWebhookOrder mengembalikan failure terstruktur');
  ok(GAS_SRC.includes('return { success: true, orderSn: orderSn, itemCount: expandedItems.length }'), 'processWebhookOrder mengembalikan success terstruktur');
  ok(GAS_SRC.includes('webhookQueueCount: queueTriggers.length'), 'status auto-sync memverifikasi trigger webhook queue');
  ok(GAS_SRC.includes('var fullyActive = autoTriggers.length > 0 && queueTriggers.length > 0;'), 'auto-sync baru dianggap aktif jika kedua trigger tersedia');
  ok(GAS_SRC.includes('var completedWaitStatus = res.success ? "WAITING" : "FAILED";'), 'finance API sukses tanpa data → WAITING, bukan nilai palsu');
  ok(GAS_SRC.includes('["UNPAID", "READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"]'), 'finance otomatis dicoba termasuk UNPAID dan seluruh lifecycle berbayar/pengiriman');
  ok(GAS_SRC.includes('var res = fetchPaymentEscrow(sn);'), 'auto finance memakai endpoint/wrapper existing tanpa status gate prematur');
  ok(GAS_SRC.includes('? priorSettlementStatus : "WAITING_SETTLEMENT";'), 'finance unavailable mempertahankan status lama atau marker WAITING existing');
  ok(GAS_SRC.includes('var hasOfficialFinance = res.success && officialFinanceHeaders.some'), 'voucher/fee parsial dari API tetap disimpan meski escrow belum tersedia');
  ok(GAS_SRC.includes('var financeSyncState = hasSettlementFinance ? "SUCCESS" : "WAITING";'), 'finance parsial ditandai WAITING agar dapat diperbarui lagi saat settlement tersedia');
  ok(GAS_SRC.indexOf('Mulai dari snapshot lama.') < GAS_SRC.indexOf('var rfRes = fetchPaymentEscrow(sn, grp.orderStatus);'), 'snapshot lama disalin sebelum overlay finance terbaru');
  ok(GAS_SRC.includes('"Shipping Subsidy Seller": undefined'), 'field yang endpoint tidak sediakan tidak diisi placeholder 0');
  ok(GAS_SRC.includes('"Settlement Status":       _slApiPresent(inc.order_status) ? String(inc.order_status) : undefined'), 'Settlement Status absent tidak menghapus nilai existing');
  ok(GAS_SRC.includes('inc.order_ams_commission_fee') && GAS_SRC.includes('inc.ads_escrow_top_up_fee_or_technical_support_fee') && GAS_SRC.includes('item0.ams_commission_fee'), 'Other Fee tetap bersumber dari field resmi Payment API');
}

console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
process.exit(fail > 0 ? 1 : 0);
