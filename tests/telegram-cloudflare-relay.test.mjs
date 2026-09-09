import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../cloudflare/telegram-webhook/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "cloudflare", "telegram-webhook", "src", "index.js"), "utf8");
const secret = "worker-test-secret";
const gasUrl = "https://script.google.com/macros/s/AKfy-test-deployment/exec";
const update = JSON.stringify({ update_id: 2001, message: { chat: { id: 12345 }, text: "/start" } });

function makeRequest(pathname = "/telegram-webhook", method = "POST", body = update, headerSecret = secret) {
  const headers = { "content-type": "application/json" };
  if (headerSecret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = headerSecret;
  return new Request(`https://relay.example${pathname}`, { method, headers, body: method === "POST" ? body : undefined });
}

async function invoke(request, env = {}, upstreamFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "ignored" }) })) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = upstreamFetch;
  try {
    return await worker.fetch(request, { TELEGRAM_WEBHOOK_SECRET: secret, GAS_EXEC_URL: gasUrl, ...env });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const calls = [];
  const response = await invoke(makeRequest(), {}, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: "ignored" }) };
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, gasUrl);
  assert.equal(calls[0].options.body, update);
  assert.equal(calls[0].options.redirect, "follow");
  assert.equal(calls[0].options.headers["X-Telegram-Bot-Api-Secret-Token"], undefined);
}

{
  let calls = 0;
  const response = await invoke(makeRequest("/telegram-webhook", "POST", update, "wrong"), {}, async () => {
    calls += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: "ignored" }) };
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
}

{
  const response = await invoke(makeRequest(), { GAS_EXEC_URL: "https://script.googleusercontent.com/macros/echo" });
  assert.equal(response.status, 503);
}

{
  const response = await invoke(makeRequest(), {}, async () => ({ ok: false, status: 500, text: async () => "" }));
  assert.equal(response.status, 502);
}

{
  const response = await invoke(makeRequest(), {}, async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "error" }) }));
  assert.equal(response.status, 502);
}

{
  assert.equal((await invoke(makeRequest("/wrong"))).status, 404);
  assert.equal((await invoke(makeRequest("/telegram-webhook", "GET"))).status, 405);
  assert.equal((await invoke(makeRequest("/telegram-webhook", "POST", "bad-json"))).status, 400);
}

{
  const workerHandler = (request) => invoke(request);
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const workerResponse = await workerHandler(new Request(`http://127.0.0.1${request.url}`, {
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    }));
    response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers.entries()));
    response.end(await workerResponse.text());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await new Promise((resolve, reject) => {
      const client = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/telegram-webhook",
        method: "POST",
        headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      }, (res) => {
        const responseChunks = [];
        res.on("data", (chunk) => responseChunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(responseChunks).toString("utf8") }));
      });
      client.on("error", reject);
      client.end(update);
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

assert.doesNotMatch(source, /console\.(log|warn|error)/);
assert.doesNotMatch(source, /ProductionQueue|ProductionHistory|MasterBarang|StockAlerts/);
assert.doesNotMatch(source, /script\.googleusercontent\.com/);

console.log("telegram-cloudflare-relay: 10 assertions passed");
