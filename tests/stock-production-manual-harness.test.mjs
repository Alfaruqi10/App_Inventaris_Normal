import assert from "node:assert/strict";
import fs from "node:fs";

const path = new URL("./manual/stock-production-manual-test.html", import.meta.url);
const source = fs.readFileSync(path, "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];

assert.match(source, /TEST MODE ONLY/);
assert.match(source, /TEST 1 - Stok Aman/);
assert.match(source, /TEST 10 - Tanpa Config/);
assert.match(source, /Shortfall/);
assert.match(source, /SuggestedQty/);
assert.match(source, /QUEUE_RESOLVED/);
assert.match(source, /IN_PROGRESS/);
assert.match(source, /TELEGRAM_TEST_BATCH/);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /\bpostData\s*\(/);
assert.doesNotMatch(source, /XMLHttpRequest/);
assert.doesNotMatch(source, /google\.script\.run/);
assert.ok(script, "inline test harness script must exist");
new Function(script);

console.log("Stock/Production manual harness: PASS (local-memory only)");
