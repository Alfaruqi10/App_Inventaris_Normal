import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const telegramSource = fs.readFileSync(new URL("../src/backend/NotificationCenter/telegram.gs", import.meta.url), "utf8");
const notificationServiceSource = fs.readFileSync(new URL("../src/backend/NotificationCenter/NotificationService.gs", import.meta.url), "utf8");
const codeSource = fs.readFileSync(new URL("../src/backend/code.gs", import.meta.url), "utf8");

const context = {
  console,
  Array,
  Date,
  JSON,
  Math,
  Number,
  Object,
  RegExp,
  String,
  isFinite,
  cleanText: value => String(value == null ? "" : value)
};
vm.createContext(context);
vm.runInContext(telegramSource, context);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const baseOrder = {
  buyer_name: "Budi Santoso",
  buyer_username: "budisantoso",
  order_sn: "2609044DH9PPNH",
  product_name: "ANSLA - Emaar - Gamis Abaya Hitam Putih BW Bordir 3D",
  variation_name: "Hitam, S",
  qty: 1,
  order_status: "UNPAID",
  recipient_address: { name: "Budi Santoso" }
};

test("buyer identity prefers display name and keeps optional username", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getOrderNotificationBuyer(baseOrder))),
    { name: "Budi Santoso", username: "budisantoso" }
  );
});

test("canonical order formatter includes buyer before order fields", () => {
  const message = context.buildOrderLifecycleNotificationMessage({
    icon: "📦",
    title: "ORDER BARU",
    buyerName: "Budi Santoso",
    buyerUsername: "budisantoso",
    orderSn: baseOrder.order_sn,
    productName: baseOrder.product_name,
    variationName: baseOrder.variation_name,
    qty: baseOrder.qty,
    includeStock: true,
    stock: 2,
    status: baseOrder.order_status
  });
  assert.equal(message, "📦 <b>ORDER BARU</b>\n\nPembeli:\nBudi Santoso (@budisantoso)\n\nOrder:\n2609044DH9PPNH\n\nProduk:\nANSLA - Emaar - Gamis Abaya Hitam Putih BW Bordir 3D\n\nVariasi:\nHitam, S\n\nQty:\n1\n\nSisa Stok:\n2\n\nStatus:\nUNPAID");
});

test("missing username renders name only", () => {
  const message = context.buildOrderLifecycleNotificationMessage({
    icon: "🚚",
    title: "PERLU DIKIRIM",
    buyerName: "Budi Santoso",
    buyerUsername: "",
    orderSn: "ORDER-1",
    productName: "Produk",
    variationName: "-",
    qty: 1,
    status: "READY_TO_SHIP"
  });
  assert.match(message, /Pembeli:\nBudi Santoso\n\nOrder:/);
  assert.doesNotMatch(message, /@(?:undefined|null)/i);
});

test("nullish buyer values never leak into Telegram", () => {
  const message = context.buildOrderLifecycleNotificationMessage({
    icon: "✅",
    title: "PESANAN SELESAI",
    buyerName: null,
    buyerUsername: "undefined",
    orderSn: "ORDER-2",
    productName: "Produk",
    variationName: "M",
    qty: 1,
    status: "COMPLETED"
  });
  assert.match(message, /Pembeli:\n-\n\nOrder:/);
  assert.doesNotMatch(message, /undefined|null|\[object Object\]|@undefined|@null/);
});

test("generic ORDER_NEW formatter uses the same buyer identity", () => {
  const message = context.buildNotificationMessage("ORDER_NEW", {
    buyerName: "Budi Santoso",
    buyerUsername: "budisantoso",
    orderSn: baseOrder.order_sn,
    productName: baseOrder.product_name,
    variationName: baseOrder.variation_name,
    qty: 1,
    remainingStock: 2,
    status: "UNPAID"
  });
  assert.match(message, /Pembeli:\nBudi Santoso \(@budisantoso\)/);
  assert.match(message, /Sisa Stok:\n2/);
});

test("all order status notifications call the canonical formatter", () => {
  const statusSection = codeSource.slice(
    codeSource.indexOf("function _sendOrderStatusTelegram"),
    codeSource.indexOf("function autoSyncShopeeOrders")
  );
  ["PROCESSED", "READY_TO_SHIP", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED", "CANCELLED", "IN_CANCEL", "TO_RETURN", "RETURNED"]
    .forEach(status => assert.match(statusSection, new RegExp('"' + status + '"')));
  assert.match(statusSection, /buildOrderLifecycleNotificationMessage\(\{/);
  assert.doesNotMatch(statusSection, /Buyer:/);
});

test("sync and webhook pass buyer identity to every order formatter path", () => {
  assert.equal((codeSource.match(/const buyerIdentity = getOrderNotificationBuyer\(order\);/g) || []).length, 2);
  assert.equal((codeSource.match(/_sendOrderStatusTelegram\([^\n]+buyerIdentity\.name, buyerIdentity\.username\)/g) || []).length, 2);
  assert.equal((codeSource.match(/buildOrderLifecycleNotificationMessage\(\{/g) || []).length >= 3, true);
});

test("order gateway preserves canonical preformatted messages", () => {
  assert.match(codeSource, /if \(eventType\.indexOf\("ORDER_"\) === 0\) notificationPayload\.message = message;/);
  assert.match(notificationServiceSource, /normalizedEventType\.indexOf\("ORDER_"\) === 0/);
});

console.log(`Order notification tests: ${passed}/${passed} PASS`);
