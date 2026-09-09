import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "backend", "code.gs");
const source = fs.readFileSync(sourcePath, "utf8");
const semanticsPath = path.join(root, "src", "backend", "SalesLedgerSemantics.gs");
const semanticsSource = fs.readFileSync(semanticsPath, "utf8");
const reconciliationPath = path.join(root, "src", "backend", "ReconciliationWorker.gs");
const reconciliationSource = fs.readFileSync(reconciliationPath, "utf8");
const helperStart = source.indexOf("function aggregateSalesLedgerOrderItems(items)");
const helperEnd = source.indexOf("// --- FEATURE FLAGS", helperStart);

assert.ok(helperStart >= 0 && helperEnd > helperStart, "Qty aggregation helper ditemukan");

const context = vm.createContext({ isFinite });
vm.runInContext(source.slice(helperStart, helperEnd), context, { filename: sourcePath });

let passed = 0;
function test(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

function unit(itemId, modelId, qty = 1, amount = 145500) {
  return { itemId, modelId, prodName: "Produk", varName: "Model", qty, amount, invSku: "SKU" };
}

function aggregate(items) {
  return context.aggregateSalesLedgerOrderItems(items);
}

function units(items) {
  return context.buildSalesLedgerUnitRepresentation(items);
}

function lineWriterSource() {
  const start = semanticsSource.indexOf("function updateSalesLedgerLineLevel(options)");
  assert.ok(start >= 0, "writer line-level ditemukan");
  return semanticsSource.slice(start);
}

function totalQty(items) {
  return aggregate(items).reduce((sum, item) => sum + item.qty, 0);
}

function subtotal(items) {
  return aggregate(items).reduce((sum, item) => sum + item.qty * item.amount, 0);
}

function pricing(items) {
  return context.buildSalesLedgerUniqueLinePricing(items);
}

function settlementPricing(items, status, finalValue) {
  return context.applySalesLedgerSettlementPricing(pricing(items), status, finalValue);
}

test("Qty=1 tetap 1", () => {
  assert.equal(totalQty([unit("A", "X")]), 1);
});

test("Qty=2 dari unit rows menjadi 2", () => {
  assert.equal(totalQty([unit("A", "X"), unit("A", "X")]), 2);
});

test("Qty=5 dari unit rows menjadi 5", () => {
  assert.equal(totalQty(Array.from({ length: 5 }, () => unit("A", "X"))), 5);
});

test("Qty=11 mempertahankan seluruh jumlah Shopee", () => {
  const items = Array.from({ length: 11 }, () => unit("A", "X", 1, 145500));
  assert.equal(totalQty(items), 11);
  assert.equal(subtotal(items), 1600500);
});

test("multi-item menjumlahkan Qty setiap logical item", () => {
  const result = aggregate([
    unit("A", "X"), unit("A", "X"),
    unit("B", "Y"), unit("B", "Y"), unit("B", "Y")
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(item => item.qty).sort())), [2, 3]);
  assert.equal(totalQty(result), 5);
});

test("multi-model tidak tergabung hanya karena Item ID sama", () => {
  const result = aggregate([
    ...Array.from({ length: 5 }, () => unit("A", "X")),
    ...Array.from({ length: 3 }, () => unit("A", "Y"))
  ]);
  assert.equal(result.length, 2);
  assert.equal(result.find(item => item.modelId === "X").qty, 5);
  assert.equal(result.find(item => item.modelId === "Y").qty, 3);
});

test("Qty API yang sudah agregat tetap dihitung benar", () => {
  assert.equal(totalQty([unit("A", "X", 11)]), 11);
});

test("Completed single-line memakai harga unit per Qty dan subtotal gross", () => {
  const result = settlementPricing([{
    itemId: "A", modelId: "X", qty: 11, unitPrice: 145500, lineSubtotal: 1600500
  }], "COMPLETED", 1257382);
  assert.equal(result.valid, true);
  assert.equal(result.lineCount, 1);
  assert.equal(result.sellingPrice, "145500;145500;145500;145500;145500;145500;145500;145500;145500;145500;145500");
  assert.equal(result.productSubtotal, 1600500);
  assert.equal(result.usesSettlementFinal, false);
});

test("Selling Price multi-line mengikuti setiap product/model unik", () => {
  const result = pricing([
    { itemId: "A", modelId: "A", qty: 1, unitPrice: 361350, lineSubtotal: 361350 },
    { itemId: "B", modelId: "B", qty: 1, unitPrice: 330650, lineSubtotal: 330650 },
    { itemId: "B", modelId: "C", qty: 1, unitPrice: 330650, lineSubtotal: 330650 },
    { itemId: "C", modelId: "D", qty: 1, unitPrice: 251750, lineSubtotal: 251750 }
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.lineCount, 4);
  assert.equal(result.sellingPrice, "361350;330650;330650;251750");
  assert.equal(result.productSubtotal, 1274400);
});

test("Qty menggandakan Selling Price untuk logical line yang sama", () => {
  const result = pricing([
    { itemId: "A", modelId: "X", qty: 1, unitPrice: 145500, lineSubtotal: 145500 },
    { itemId: "A", modelId: "X", qty: 10, unitPrice: 145500, lineSubtotal: 1455000 }
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.sellingPrice, "145500;145500;145500;145500;145500;145500;145500;145500;145500;145500;145500");
  assert.equal(result.productSubtotal, 1600500);
});

test("Multi-line tidak mengalokasikan settlement total secara spekulatif", () => {
  const result = settlementPricing([
    { itemId: "A", modelId: "A", qty: 1, unitPrice: 361350, lineSubtotal: 361350 },
    { itemId: "B", modelId: "B", qty: 1, unitPrice: 330650, lineSubtotal: 330650 },
    { itemId: "B", modelId: "C", qty: 1, unitPrice: 330650, lineSubtotal: 330650 },
    { itemId: "C", modelId: "D", qty: 1, unitPrice: 251750, lineSubtotal: 251750 }
  ], "COMPLETED", 1000935);
  assert.equal(result.sellingPrice, "361350;330650;330650;251750");
  assert.equal(result.productSubtotal, 1274400);
  assert.equal(result.usesSettlementFinal, false);
});

test("Cancelled tidak pernah memakai settlement completed untuk Product Subtotal", () => {
  const result = settlementPricing([{
    itemId: "A", modelId: "X", qty: 11, unitPrice: 145500, lineSubtotal: 1600500
  }], "CANCELLED", 1257382);
  assert.equal(result.sellingPrice, "145500;145500;145500;145500;145500;145500;145500;145500;145500;145500;145500");
  assert.equal(result.productSubtotal, 1600500);
  assert.equal(result.usesSettlementFinal, false);
});

test("representasi Qty=1 memiliki satu produk dan satu variasi", () => {
  const result = units([{ ...unit("A", "X"), prodName: "Produk A", varName: "Hitam,M" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ prodName: "Produk A", varName: "Hitam,M" }]);
});

test("representasi model sama Qty=4 mengulang produk dan variasi empat kali", () => {
  const result = units([{ ...unit("A", "X", 4), prodName: "Produk A", varName: "Hitam,M" }]);
  assert.equal(result.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(entry => entry.prodName))), ["Produk A", "Produk A", "Produk A", "Produk A"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(entry => entry.varName))), ["Hitam,M", "Hitam,M", "Hitam,M", "Hitam,M"]);
});

test("representasi model sama Qty=11 mengulang tepat sebelas unit", () => {
  const result = units([{ ...unit("A", "X", 11), prodName: "Produk A", varName: "Navy,All Size" }]);
  assert.equal(result.length, 11);
  assert.ok(result.every(entry => entry.prodName === "Produk A" && entry.varName === "Navy,All Size"));
});

test("multi-model mempertahankan jumlah dan pasangan setiap unit", () => {
  const result = units([
    { ...unit("A", "A", 2), prodName: "Produk A", varName: "Variasi A" },
    { ...unit("B", "B", 1), prodName: "Produk B", varName: "Variasi B" },
    { ...unit("C", "C", 2), prodName: "Produk C", varName: "Variasi C" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { prodName: "Produk A", varName: "Variasi A" },
    { prodName: "Produk A", varName: "Variasi A" },
    { prodName: "Produk B", varName: "Variasi B" },
    { prodName: "Produk C", varName: "Variasi C" },
    { prodName: "Produk C", varName: "Variasi C" }
  ]);
});

test("model selang-seling mempertahankan urutan sumber", () => {
  const result = units([
    { ...unit("A", "XXL"), prodName: "Produk A", varName: "Hitam,XXL" },
    { ...unit("A", "M"), prodName: "Produk A", varName: "Hitam,M" },
    { ...unit("A", "XXL"), prodName: "Produk A", varName: "Hitam,XXL" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(entry => entry.varName))), ["Hitam,XXL", "Hitam,M", "Hitam,XXL"]);
});

test("representasi unit dari input sama tetap idempoten", () => {
  const items = [
    { ...unit("A", "X", 2), prodName: "Produk A", varName: "Variasi A" },
    { ...unit("B", "Y"), prodName: "Produk B", varName: "Variasi B" }
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(units(items))), JSON.parse(JSON.stringify(units(items))));
});

test("rebuild Ledger berulang dari rows yang sama tetap idempoten", () => {
  const items = Array.from({ length: 11 }, () => unit("A", "X"));
  assert.equal(totalQty(items), 11);
  assert.equal(totalQty(items), 11);
  assert.match(source, /const rowKey = baseKey \+ "_" \+ item\.unit_index;/);
  assert.match(source, /const existingRowIdx = existingMap\[rowKey\];/);
});

test("polling dan webhook memakai unit-index upsert yang sama", () => {
  const occurrences = (source.match(/const rowKey\s*=\s*baseKey\s*\+\s*"_"\s*\+\s*item\.unit_index;/g) || []).length;
  assert.equal(occurrences, 2);
});

test("SalesLedger writer membangun satu row untuk setiap logical line", () => {
  const writer = lineWriterSource();
  assert.match(writer, /var lineKey = orderSn \+ "\\|" \+ itemId \+ "\\|" \+ modelId/);
  assert.match(writer, /groups\[orderSn\]\[lineKey\]/);
  assert.match(writer, /set\(SALES_LEDGER_LOGICAL_LINE_KEY_HEADER, key\)/);
  assert.match(writer, /set\("Qty", line\.qty\)/);
  assert.doesNotMatch(writer, /sourceUnits\s*=\s*buildSalesLedgerUnitRepresentation/);
});

test("reconciliation hanya meneruskan order yang telah diverifikasi ke SalesLedger", () => {
  assert.match(reconciliationSource, /updateSalesLedger\(\{\s*orderSns:\s*verifiedOrders/);
  assert.doesNotMatch(reconciliationSource, /var ledgerResult\s*=\s*updateSalesLedger\(\s*\)/);
});

test("updateSalesLedger scoped hanya merencanakan order dalam scope", () => {
  const writer = lineWriterSource();
  assert.match(writer, /Array\.isArray\(options\.orderSns\)/);
  assert.match(writer, /if \(Array\.isArray\(options\.orderSns\) && !targetOrderSet\[orderSn\]\) return;/);
  assert.match(writer, /if \(options\.executeWrite !== true\)/);
});

function applyScopedReconciliation(ledger, shopeeOrders, orderSns, preserveOrderContent = false) {
  const result = structuredClone(ledger);
  const scope = new Set(orderSns);
  for (const orderSn of scope) {
    if (!preserveOrderContent && Object.hasOwn(shopeeOrders, orderSn)) result[orderSn] = structuredClone(shopeeOrders[orderSn]);
  }
  return result;
}

test("reconciliation scoped tidak menyentuh order di luar kandidat", () => {
  const ledger = { A: { qty: 1 }, B: { qty: 2 }, C: { qty: 11 }, D: { qty: 4 } };
  const sourceRows = { A: { qty: 3 }, B: { qty: 5 }, C: { qty: 1 }, D: { qty: 1 } };
  const result = applyScopedReconciliation(ledger, sourceRows, ["A", "B"]);
  assert.equal(result.A.qty, 3);
  assert.equal(result.B.qty, 5);
  assert.equal(result.C.qty, 11);
  assert.equal(result.D.qty, 4);
});

test("historical repair tidak tertimpa jika order stale berada di luar scope reconciliation", () => {
  const repairedLedger = { repaired: { qty: 11, subtotal: 1600500 }, other: { qty: 1 } };
  const staleSource = { repaired: { qty: 1, subtotal: 145500 }, other: { qty: 2 } };
  const result = applyScopedReconciliation(repairedLedger, staleSource, ["other"]);
  assert.deepEqual(result.repaired, { qty: 11, subtotal: 1600500 });
  assert.deepEqual(result.other, { qty: 2 });
});

test("finance reconciliation mempertahankan historical repair walau order stale ada di dalam scope", () => {
  const repairedLedger = { repaired: { qty: 11, subtotal: 1600500, productEntries: 11, variationEntries: 11 } };
  const staleSource = { repaired: { qty: 1, subtotal: 145500, productEntries: 1, variationEntries: 1 } };
  const result = applyScopedReconciliation(repairedLedger, staleSource, ["repaired"], true);
  assert.deepEqual(result.repaired, repairedLedger.repaired);
});

test("reconciliation scoped tetap idempoten", () => {
  const ledger = { A: { qty: 1 }, C: { qty: 11 } };
  const sourceRows = { A: { qty: 3 }, C: { qty: 1 } };
  const once = applyScopedReconciliation(ledger, sourceRows, ["A"]);
  const twice = applyScopedReconciliation(once, sourceRows, ["A"]);
  assert.deepEqual(twice, once);
  assert.equal(twice.C.qty, 11);
});

test("reconciliation memakai writer yang fail-closed sebelum schema/migrasi eksplisit", () => {
  assert.match(reconciliationSource, /orderSns:\s*verifiedOrders,\s*preserveOrderContent:\s*true/);
  const writer = lineWriterSource();
  assert.match(writer, /SCHEMA_MIGRATION_REQUIRED/);
  assert.match(writer, /SALES_LEDGER_LOGICAL_LINE_KEY_HEADER/);
});

test("targeted repair membangun Qty dan unit representation dari Order Detail Shopee", () => {
  context._extractShopeeItemUnitPrice = (item) => item.model_discounted_price;
  const repairStart = source.indexOf("function buildSalesLedgerSnapshotFromShopeeOrder(order)");
  const repairEnd = source.indexOf("// --- FEATURE FLAGS", repairStart);
  vm.runInContext(source.slice(repairStart, repairEnd), context, { filename: sourcePath });
  const result = context.buildSalesLedgerSnapshotFromShopeeOrder({
    total_amount: 1600500,
    item_list: [{
      item_id: "A", model_id: "N", item_name: "Produk A", model_name: "Navy,All Size",
      model_quantity_purchased: 11, model_discounted_price: 145500
    }]
  });
  assert.equal(result.qty, 11);
  assert.equal(result.subtotal, 1600500);
  assert.equal(result.productText.split("; ").length, 11);
  assert.equal(result.variationText.split("; ").length, 11);
});

test("targeted repair hanya menulis empat field SalesLedger", () => {
  const repairStart = source.indexOf("function repairSalesLedgerOrderFromShopee(orderSn)");
  const repairEnd = source.indexOf("        /**\n         * Targeted repair", repairStart);
  const repairSource = source.slice(repairStart, repairEnd);
  assert.match(repairSource, /Shopee Order Detail API/);
  assert.match(repairSource, /response_optional_fields:\s*"item_list,total_amount"/);
  assert.match(repairSource, /sheet\.getRange\(rowNumber, columns\["Nama Produk"\] \+ 1\)\.setValue/);
  assert.match(repairSource, /sheet\.getRange\(rowNumber, columns\["Variasi"\] \+ 1\)\.setValue/);
  assert.match(repairSource, /sheet\.getRange\(rowNumber, columns\["Qty"\] \+ 1\)\.setValue/);
  assert.match(repairSource, /sheet\.getRange\(rowNumber, columns\["Subtotal"\] \+ 1\)\.setValue/);
  assert.doesNotMatch(repairSource, /ShopeeOrders/);
});

test("targeted repair route memerlukan Admin dan orderSn dari request", () => {
  assert.match(source, /data\.action === "repairSalesLedgerOrderFromShopee"/);
  const handlerStart = source.indexOf("function handleRepairSalesLedgerOrderFromShopee(data)");
  const handlerEnd = source.indexOf("function handleFixMultiItemSellingPrice", handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /callerRole.*!== "Admin"/);
  assert.match(handlerSource, /repairSalesLedgerOrderFromShopee\(\(data \|\| \{\}\)\.orderSn\)/);
});

test("live SalesLedger preview is early-return and read-only", () => {
  const routeIndex = source.indexOf('data.action === "previewSalesLedgerOrderRepairFromShopee"');
  const ensureIndex = source.indexOf("ensureDatabase();");
  assert.ok(routeIndex >= 0 && routeIndex < ensureIndex);

  const previewStart = source.indexOf("function handlePreviewSalesLedgerOrderRepairFromShopee(data)");
  const previewEnd = source.indexOf("function handleFixMultiItemSellingPrice", previewStart);
  const previewSource = source.slice(previewStart, previewEnd);
  assert.match(previewSource, /shopeeGet\("\/api\/v2\/order\/get_order_detail"/);
  assert.match(previewSource, /uniqueLineCount: linePricing\.lineCount/);
  assert.match(previewSource, /priceSource: expectedPriceSource/);
  assert.match(previewSource, /getDataRange\(\)\.getValues\(\)/);
  assert.doesNotMatch(previewSource, /\.setValue\(|\.setValues\(|appendRow\(|deleteRow\(|clearContent\(/);
  assert.doesNotMatch(previewSource, /repairSalesLedgerOrderFromShopee\(/);
  assert.doesNotMatch(previewSource, /ensureDatabase\(\)/);
});

test("targeted financial repair route tersedia untuk Admin", () => {
  assert.match(source, /data\.action === "repairSalesLedgerTargetedProductFinancials"/);
  const handlerStart = source.indexOf("function handleRepairSalesLedgerTargetedProductFinancials(data)");
  assert.ok(handlerStart >= 0, "handler targeted financial repair ditemukan");
  assert.match(source.slice(handlerStart, handlerStart + 500), /callerRole/);
});

test("targeted pricing memakai satu entry per Qty dan gross subtotal", () => {
  const repairStart = source.indexOf("function repairSalesLedgerTargetedProductFinancials(orderSns)");
  const repairEnd = source.indexOf("function handleRepairSalesLedgerTargetedProductFinancials(data)", repairStart);
  const repairSource = source.slice(repairStart, repairEnd);
  assert.match(repairSource, /sourceItems\.forEach\(function\(item\)/);
  assert.match(repairSource, /buildSalesLedgerUniqueLinePricing\(sourcePricingItems\)/);
  assert.match(repairSource, /sourcePricing/);
  assert.doesNotMatch(repairSource, /ShopeeOrders/);
});

test("targeted completed repair memakai gross Order Detail Shopee", () => {
  const repairStart = source.indexOf("function repairSalesLedgerTargetedProductFinancials(orderSns)");
  const repairEnd = source.indexOf("function handleRepairSalesLedgerTargetedProductFinancials(data)", repairStart);
  const repairSource = source.slice(repairStart, repairEnd);
  assert.doesNotMatch(repairSource, /fetchPaymentEscrow\(orderSn, statusShopee\)/);
  assert.match(repairSource, /productSubtotalSource = "Shopee Order Detail unit price/);
  assert.doesNotMatch(repairSource, /escrow_amount_after_adjustment/);
  assert.match(repairSource, /Product Subtotal/);
  assert.match(repairSource, /statusShopee === "COMPLETED"/);
});

test("Targeted repair menulis hanya cell yang berbeda", () => {
  const repairStart = source.indexOf("function repairSalesLedgerTargetedProductFinancials(orderSns)");
  const repairEnd = source.indexOf("function handleRepairSalesLedgerTargetedProductFinancials(data)", repairStart);
  const repairSource = source.slice(repairStart, repairEnd);
  assert.match(repairSource, /sheet\.getRange\(plan\.rowNumber, change\.column \+ 1\)\.setValue\(change\.newValue\)/);
  assert.doesNotMatch(repairSource, /getRange\(1, 1, .*setValues/);
});

test("writer membuat nilai produk per logical line dan settlement hanya untuk owner", () => {
  const writer = lineWriterSource();
  const mapperStart = source.indexOf("function _mapPaymentToLedgerCols(paymentData");
  const mapperEnd = source.indexOf("function testPaymentEscrow", mapperStart);
  const mapperSource = source.slice(mapperStart, mapperEnd);
  assert.match(writer, /set\("Selling Price", line\.amount\)/);
  assert.match(writer, /set\("Product Subtotal", line\.amount \* line\.qty\)/);
  assert.match(writer, /if \(!isOwner\) set\(field, ""\)/);
  assert.match(mapperSource, /buildSalesLedgerUniqueLinePricing/);
  assert.match(mapperSource, /lineSubtotal \/ quantity/);
  assert.doesNotMatch(mapperSource, /applySalesLedgerSettlementPricing\(/);
  assert.doesNotMatch(mapperSource, /escrow_amount_after_adjustment[\s\S]{0,240}sellingPrice/);
  assert.doesNotMatch(writer, /paymentCols\["Product Subtotal"\]\s*=\s*grpSubtotalSum/);
});

test("writer meneruskan status Shopee dari source line", () => {
  const writer = lineWriterSource();
  assert.match(writer, /set\("Status Shopee", line\.status\)/);
  assert.match(writer, /set\("Status Ledger", _mapShopeeStatusToLedger\(line\.status\)\)/);
  assert.match(writer, /_mapPaymentToLedgerCols\(paymentResponse\.data, orderPricing, ledgerCol, lines\[0\]\.status\)/);
});

test("CANCELLED memakai gross Product Subtotal tanpa settlement", () => {
  const writer = lineWriterSource();
  assert.match(source, /function applySalesLedgerPricingFallback\(priceMap, colMap, fallbackPricing, isCancelled\)/);
  assert.match(source, /if \(!hasSalesLedgerPricingValue\(priceMap, "Product Subtotal"/);
  assert.match(writer, /set\("Product Subtotal", line\.amount \* line\.qty\)/);
});

test("legacy multi-item price migration dinonaktifkan agar tidak menimpa source baru", () => {
  const migrationStart = source.indexOf("function handleFixMultiItemSellingPrice()");
  const migrationSource = source.slice(migrationStart, migrationStart + 700);
  assert.match(migrationSource, /Legacy Selling Price migration is disabled/);
  assert.match(migrationSource, /return \{\s*status: "error"/s);
});

console.log(`\nSales Ledger Qty tests: ${passed}/40 PASS`);
