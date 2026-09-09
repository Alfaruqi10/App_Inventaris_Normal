import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const telegramSource = fs.readFileSync(path.join(root, "src", "backend", "NotificationCenter", "telegram.gs"), "utf8");
const telegramApiSource = fs.readFileSync(path.join(root, "src", "backend", "NotificationCenter", "TelegramAPI.gs"), "utf8");
const codeSource = fs.readFileSync(path.join(root, "src", "backend", "code.gs"), "utf8");

function loadSource(source, bindings) {
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Number,
    String,
    isFinite,
    ...bindings,
  });
  vm.runInContext(source, context, { timeout: 1_000 });
  return context;
}

{
  const requests = [];
  const context = loadSource(telegramSource, {
    _getTelegramBotToken: () => "secret-token",
    UrlFetchApp: {
      fetch(url, request) {
        requests.push({ url, request });
        return { getContentText: () => JSON.stringify({ ok: true }) };
      },
    },
  });

  assert.equal(
    context.sendTelegramToChatId("12345", "diagnostic", {
      replyMarkup: { inline_keyboard: [[{ text: "Menu", callback_data: "menu" }]] },
    }),
    true,
  );
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].request.payload);
  assert.equal(payload.chat_id, "12345");
  assert.equal(payload.text, "diagnostic");
  assert.deepEqual(payload.reply_markup, { inline_keyboard: [[{ text: "Menu", callback_data: "menu" }]] });
}

{
  const permissionChecks = [];
  const calls = [];
  const context = loadSource(telegramApiSource, {
    requireStockProductionPermission(data, permission) {
      permissionChecks.push({ data, permission });
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return key === "TELEGRAM_WEBHOOK_URL" ? "https://relay.example/telegram" : "";
          },
        };
      },
    },
    _getTelegramBotToken: () => "secret-token",
    UrlFetchApp: {
      fetch(url, options) {
        calls.push({ url, options });
        return {
          getContentText: () => JSON.stringify({
            ok: true,
            result: {
              url: "https://relay.example/telegram",
              pending_update_count: 3,
              last_error_date: 1788582254,
              last_error_message: "Wrong response from the webhook: 302 Found",
              has_custom_certificate: false,
              max_connections: 40,
            },
          }),
        };
      },
    },
  });

  const result = context.handleGetTelegramWebhookInfo({ callerEmail: "admin@example.test" });
  assert.equal(result.status, "success");
  assert.equal(result.configuredWebhookUrl, "https://relay.example/telegram");
  assert.equal(result.webhookUrl, "https://relay.example/telegram");
  assert.equal(result.pendingUpdateCount, 3);
  assert.equal(result.lastErrorMessage, "Wrong response from the webhook: 302 Found");
  assert.equal(result.lastErrorDate, new Date(1788582254 * 1000).toISOString());
  assert.equal(result.maxConnections, 40);
  assert.equal(permissionChecks.length, 1);
  assert.equal(permissionChecks[0].permission, "manage_stock_alert_settings");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/getWebhookInfo$/);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
}

{
  let fetchCount = 0;
  const context = loadSource(telegramApiSource, {
    requireStockProductionPermission() {},
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: () => "" };
      },
    },
    _getTelegramBotToken: () => "",
    UrlFetchApp: {
      fetch() {
        fetchCount += 1;
        throw new Error("must not fetch without a token");
      },
    },
  });
  const result = context.handleGetTelegramWebhookInfo({ callerEmail: "admin@example.test" });
  assert.equal(result.status, "error");
  assert.equal(result.code, "telegram_token_missing");
  assert.equal(fetchCount, 0);
}

assert.match(
  codeSource,
  /data\.action === "getTelegramWebhookInfo"\)\s*\{\s*return jsonOutput\(handleGetTelegramWebhookInfo\(data\)\);\s*\}/,
);
assert.match(
  telegramSource,
  /if \(text\.startsWith\("\/start"\)\) \{[\s\S]*?handleTelegramProductionRecipientMenu\(chatId\)[\s\S]*?handleTelegramStart\(chatId, firstName, lastName, username\)/,
);

const diagnosticBody = telegramApiSource.match(
  /function handleGetTelegramWebhookInfo\(data\) \{([\s\S]*?)\n\}\n[\s\S]*?function handleSaveTelegramSettings/,
);
assert.ok(diagnosticBody, "webhook diagnostic handler must be isolated from the settings mutation handler");
assert.match(diagnosticBody[1], /requireStockProductionPermission/);
assert.match(diagnosticBody[1], /getWebhookInfo/);
assert.doesNotMatch(
  diagnosticBody[1],
  /setProperty|SpreadsheetApp|sendTelegram|setWebhook|ProductionQueue|ProductionHistory|MasterBarang/,
);

console.log("telegram-webhook-diagnostics: 6 assertions passed");
