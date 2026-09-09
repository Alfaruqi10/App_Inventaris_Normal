import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'assert';
import { FinanceService } from '../src/node-backend/services/financeService.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOPEE_SERVICE = readFileSync(path.join(ROOT, 'src', 'node-backend', 'services', 'shopeeService.js'), 'utf8');
const HEADERS = [
  'Other Fee',
  'Shipping Subsidy Shopee',
  'Escrow Amount',
  'Net Income'
];

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  PASS  ${name}`);
}

console.log('\n== SalesLedger payment evidence read-only contract ==');

const readOnlyStart = SHOPEE_SERVICE.indexOf('async shopeeGetReadOnly(');
const readOnlyEnd = SHOPEE_SERVICE.indexOf('\n  /**', readOnlyStart + 1);
const readOnlyMethod = SHOPEE_SERVICE.slice(readOnlyStart, readOnlyEnd < 0 ? undefined : readOnlyEnd);

test('read-only Shopee accessor exists', () => {
  assert.ok(readOnlyStart >= 0);
  assert.match(readOnlyMethod, /axios\.get/);
  assert.match(readOnlyMethod, /getShopeeTokens\(\)/);
});

test('read-only accessor fails closed instead of refreshing', () => {
  assert.match(readOnlyMethod, /near expiry and refresh is forbidden/);
  assert.doesNotMatch(readOnlyMethod, /getValidAccessToken/);
  assert.doesNotMatch(readOnlyMethod, /refreshShopeeAccessToken/);
  assert.doesNotMatch(readOnlyMethod, /saveShopeeTokens/);
  assert.doesNotMatch(readOnlyMethod, /setProperty/);
});

const service = new FinanceService(null, null);
const getMapped = (paymentData) => {
  const indexed = service._mapPaymentToLedgerCols(paymentData, HEADERS);
  return Object.fromEntries(Object.entries(indexed).map(([index, value]) => [HEADERS[Number(index)], value]));
};

test('Other Fee follows the documented order, ads, then item priority', () => {
  assert.equal(getMapped({
    order_income: {
      order_ams_commission_fee: 10,
      ads_escrow_top_up_fee_or_technical_support_fee: 20,
      shopee_shipping_rebate: 30,
      escrow_amount: 40,
      escrow_amount_after_adjustment: 50
    },
    items: [{ ams_commission_fee: 60 }]
  })['Other Fee'], 10);
  assert.equal(getMapped({
    order_income: { ads_escrow_top_up_fee_or_technical_support_fee: 20 },
    items: [{ ams_commission_fee: 60 }]
  })['Other Fee'], 20);
  assert.equal(getMapped({ order_income: {}, items: [{ ams_commission_fee: 60 }] })['Other Fee'], 60);
});

test('shipping, escrow, and net income retain direct payment mappings', () => {
  const mapped = getMapped({
    order_income: {
      shopee_shipping_rebate: 100,
      escrow_amount: 200,
      escrow_amount_after_adjustment: 150
    }
  });
  assert.equal(mapped['Shipping Subsidy Shopee'], 100);
  assert.equal(mapped['Escrow Amount'], 200);
  assert.equal(mapped['Net Income'], 150);
});

console.log(`\n${pass} payment-evidence contract tests passed.`);
