// ============================================================
// NotificationCenter/QueueProcessor.gs — Queue & Dispatch Manager
// ============================================================

var TelegramQueueProcessor = (function() {
  
  const MAX_RETRY_COUNT = 3;

  return {
    /**
     * Memasukkan pesan baru ke antrean (Queue) database.
     * @param {string} chatId 
     * @param {string} username 
     * @param {string} text 
     * @return {string} Queue ID yang di-generate
     */
    enqueue: function(chatId, username, text, options) {
      ensureTelegramDatabase();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
      
      const queueId = "Q_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      options = options || {};
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const values = {
        QueueID: queueId, Timestamp: new Date(), ChatID: String(chatId).trim(),
        Username: String(username || "N/A").trim(), Text: text, Status: "WAITING",
        RetryCount: 0, ErrorMessage: "", NotificationType: options.notificationType || "",
        EntityKey: options.entityKey || "", IdempotencyKey: options.idempotencyKey || ""
      };
      const newRow = headers.map(h => values[h] === undefined ? "" : values[h]);
      
      sheet.appendRow(newRow);
      SpreadsheetApp.flush();
      return queueId;
    },

    /**
     * Mengirim pesan antrean secara langsung (Immediate Delivery).
     * @param {string} queueId 
     * @return {boolean} True jika sukses dikirim
     */
    dispatch: function(queueId) {
      ensureTelegramDatabase();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
      const data = sheet.getDataRange().getValues();
      const colIdx = {};
      data[0].forEach((h, i) => { colIdx[h] = i; });

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colIdx["QueueID"]]) === queueId) {
          const rowNum = i + 1;
          const chatId = data[i][colIdx["ChatID"]];
          const text = data[i][colIdx["Text"]];
          let retryCount = Number(data[i][colIdx["RetryCount"]] || 0);

          sheet.getRange(rowNum, colIdx["Status"] + 1).setValue("SENDING");
          SpreadsheetApp.flush();

          try {
            const success = this.sendApi(chatId, text);
            if (success) {
              sheet.getRange(rowNum, colIdx["Status"] + 1).setValue("SUCCESS");
              sheet.getRange(rowNum, colIdx["ErrorMessage"] + 1).setValue("");
              sheet.getRange(rowNum, colIdx["Timestamp"] + 1).setValue(new Date());
              return true;
            } else {
              throw new Error("Gagal mengirim via Telegram API.");
            }
          } catch (e) {
            const errStr = e.toString();
            console.error("[TelegramQueue] Gagal kirim ke ChatID " + chatId + ": " + errStr);
            
            retryCount++;
            const nextStatus = retryCount >= MAX_RETRY_COUNT ? "FAILED" : "RETRY";
            
            sheet.getRange(rowNum, colIdx["Status"] + 1).setValue(nextStatus);
            sheet.getRange(rowNum, colIdx["RetryCount"] + 1).setValue(retryCount);
            sheet.getRange(rowNum, colIdx["ErrorMessage"] + 1).setValue(errStr);
            sheet.getRange(rowNum, colIdx["Timestamp"] + 1).setValue(new Date());

            // Tulis log error juga ke user profile
            updateUserLastError(chatId, errStr);
            return false;
          } finally {
            SpreadsheetApp.flush();
          }
        }
      }
      return false;
    },

    /**
     * Memproses antrean WAITING & RETRY (Dijalankan via Cron Job / Scheduler).
     */
    processQueue: function() {
      console.log("[TelegramQueue] Memulai pemrosesan antrean...");
      ensureTelegramDatabase();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
      if (!sheet || sheet.getLastRow() < 2) return;

      const data = sheet.getDataRange().getValues();
      const colIdx = {};
      data[0].forEach((h, i) => { colIdx[h] = i; });

      let processedCount = 0;
      for (let i = 1; i < data.length; i++) {
        const status = String(data[i][colIdx["Status"]]).toUpperCase();
        if (status === "WAITING" || status === "RETRY") {
          const queueId = data[i][colIdx["QueueID"]];
          this.dispatch(queueId);
          processedCount++;
          
          // Batasi pemrosesan maksimal 10 antrean per menit agar tidak terkena limit eksekusi GAS
          if (processedCount >= 10) break;
        }
      }
      console.log("[TelegramQueue] Selesai memproses " + processedCount + " antrean.");
    },

    /**
     * Memanggil HTTP Telegram API.
     */
    sendApi: function(chatId, text) {
      const botToken = _getTelegramBotToken();
      if (!botToken) throw new Error("Bot Token belum dikonfigurasi.");

      const parseMode = PropertiesService.getScriptProperties().getProperty("TELEGRAM_DEFAULT_PARSE_MODE") || "HTML";
      const url = "https://api.telegram.org/bot" + botToken + "/sendMessage";
      const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode
      };
      
      const options = {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      
      const res = UrlFetchApp.fetch(url, options);
      const json = JSON.parse(res.getContentText());
      
      if (!json.ok) {
        if (json.error_code === 403) {
          disableUserByChatId(chatId, "Bot blocked by user (403)");
        }
        throw new Error(json.description || "Unknown Telegram API Error");
      }
      
      return true;
    }
  };
})();

/**
 * Cron entrypoint untuk trigger waktu 1 menit.
 */
function cronProcessTelegramQueue() {
  TelegramQueueProcessor.processQueue();
}
