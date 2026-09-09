// ============================================================
// NotificationCenter/TelegramAPI.gs — Backend Controller
// ============================================================

/**
 * Mendapatkan data dashboard ringkas Notification Center.
 */
function handleGetTelegramDashboardData() {
  ensureTelegramDatabase();
  try {
    const props = PropertiesService.getScriptProperties();
    const botToken = _getTelegramBotToken() || "";
    let botStatus = "Offline";
    let botUsername = "Not Configured";

    // Panggil API info bot
    if (botToken) {
      try {
        const url = "https://api.telegram.org/bot" + botToken + "/getMe";
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        const json = JSON.parse(res.getContentText());
        if (json.ok) {
          botStatus = "Online";
          botUsername = "@" + json.result.username;
        }
      } catch (e) {
        botStatus = "Error Connecting";
      }
    }

    const users = getTelegramUsers();
    const activeSubscribers = users.filter(u => String(u.Status).toUpperCase() === "ACTIVE" || String(u.Active).toUpperCase() === "TRUE").length;

    // Baca data antrean (Queue) untuk hitung stat harian
    const qSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_QUEUE_SHEET);
    let totalToday = 0, successToday = 0, failedToday = 0, waitingCount = 0;
    const chartData = {};

    if (qSheet && qSheet.getLastRow() > 1) {
      const rows = qSheet.getDataRange().getValues();
      const colIdx = {};
      rows[0].forEach((h, i) => { colIdx[h] = i; });

      const startOfDay = new Date();
      startOfDay.setHours(0,0,0,0);

      for (let i = 1; i < rows.length; i++) {
        const timestampIdx = colIdx["Timestamp"];
        const statusIdx = colIdx["Status"];
        if (timestampIdx === undefined || statusIdx === undefined) continue;

        const date = new Date(rows[i][timestampIdx]);
        const status = String(rows[i][statusIdx]).toUpperCase();

        if (date >= startOfDay) {
          totalToday++;
          if (status === "SUCCESS") successToday++;
          else if (status === "FAILED") failedToday++;
          else if (status === "WAITING" || status === "RETRY") waitingCount++;
        }

        // Kelompokkan data harian untuk 7 hari terakhir untuk grafik statistik
        const diffDays = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
          const dateStr = date.toLocaleDateString("id-ID", { weekday: "short" });
          if (!chartData[dateStr]) chartData[dateStr] = { success: 0, failed: 0 };
          if (status === "SUCCESS") chartData[dateStr].success++;
          if (status === "FAILED") chartData[dateStr].failed++;
        }
      }
    }

    // Ambil log aktivitas terakhir
    const lastNotif = users.length > 0 ? "Ready" : "No subscriber";
    const lastError = props.getProperty("TELEGRAM_LAST_ERROR") || "None";

    return {
      status: "success",
      data: {
        botStatus,
        botUsername,
        totalSubscribers: users.length,
        activeSubscribers,
        totalToday,
        successToday,
        failedToday,
        waitingCount,
        lastNotif,
        lastError,
        chartData: Object.keys(chartData).map(k => ({ day: k, success: chartData[k].success, failed: chartData[k].failed }))
      }
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan detail pelanggan.
 */
function handleGetTelegramSubscribers() {
  ensureTelegramDatabase();
  try {
    const users = getTelegramUsers();
    return { status: "success", subscribers: users };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Melakukan persetujuan pendaftaran (Approve).
 */
function handleApproveTelegramSubscriber(data) {
  ensureTelegramDatabase();
  try {
    const { id } = data;
    if (!id) return { status: "error", message: "ID pelanggan diperlukan." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_USERS_SHEET);
    const rows = sheet.getDataRange().getValues();
    const colIdx = {};
    rows[0].forEach((h, i) => { colIdx[h] = i; });

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["ID"]]) === String(id)) {
        const rowNum = i + 1;
        const chatId = rows[i][colIdx["ChatID"]];
        const telegramName = rows[i][colIdx["TelegramName"]];

        sheet.getRange(rowNum, colIdx["Active"] + 1).setValue(true);
        sheet.getRange(rowNum, colIdx["Status"] + 1).setValue("ACTIVE");
        sheet.getRange(rowNum, colIdx["UpdatedAt"] + 1).setValue(new Date());
        SpreadsheetApp.flush();

        // Kirim notifikasi persetujuan via State Transition Engine
        const oldStatus = rows[i][colIdx["Status"]] || "PENDING";
        TelegramNotificationEngine.handleStateTransition(id, oldStatus, "ACTIVE", chatId, telegramName, "ADMIN_UI");

        return { status: "success", message: "Pelanggan berhasil disetujui." };
      }
    }
    return { status: "error", message: "Pelanggan tidak ditemukan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Menonaktifkan pelanggan (Disable).
 */
function handleDisableTelegramSubscriber(data) {
  ensureTelegramDatabase();
  try {
    const { id } = data;
    if (!id) return { status: "error", message: "ID pelanggan diperlukan." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_USERS_SHEET);
    const rows = sheet.getDataRange().getValues();
    const colIdx = {};
    rows[0].forEach((h, i) => { colIdx[h] = i; });

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["ID"]]) === String(id)) {
        const rowNum = i + 1;
        const chatId = rows[i][colIdx["ChatID"]];
        const telegramName = rows[i][colIdx["TelegramName"]];
        const oldStatus = rows[i][colIdx["Status"]] || "ACTIVE";

        sheet.getRange(rowNum, colIdx["Active"] + 1).setValue(false);
        sheet.getRange(rowNum, colIdx["Status"] + 1).setValue("DISABLED");
        sheet.getRange(rowNum, colIdx["UpdatedAt"] + 1).setValue(new Date());
        SpreadsheetApp.flush();

        // Kirim notifikasi dinonaktifkan via State Transition Engine
        TelegramNotificationEngine.handleStateTransition(id, oldStatus, "DISABLED", chatId, telegramName, "ADMIN_UI");

        return { status: "success", message: "Pelanggan berhasil dinonaktifkan." };
      }
    }
    return { status: "error", message: "Pelanggan tidak ditemukan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Menyimpan pembaruan aturan langganan event (Rules) untuk subscriber.
 */
function handleSaveSubscriberRules(data) {
  ensureTelegramDatabase();
  try {
    const { id, role, rules } = data;
    if (!id) return { status: "error", message: "ID pelanggan diperlukan." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_USERS_SHEET);
    const rows = sheet.getDataRange().getValues();
    const colIdx = {};
    rows[0].forEach((h, i) => { colIdx[h] = i; });

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["ID"]]) === String(id)) {
        const rowNum = i + 1;
        if (role !== undefined) sheet.getRange(rowNum, colIdx["Role"] + 1).setValue(role);
        if (rules !== undefined) sheet.getRange(rowNum, colIdx["Rules"] + 1).setValue(JSON.stringify(rules));
        sheet.getRange(rowNum, colIdx["UpdatedAt"] + 1).setValue(new Date());
        return { status: "success", message: "Aturan notifikasi berhasil disimpan." };
      }
    }
    return { status: "error", message: "Pelanggan tidak ditemukan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mendapatkan seluruh daftar template pesan.
 */
function handleGetTelegramTemplates() {
  ensureTelegramDatabase();
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_TEMPLATES_SHEET);
    if (!sheet) return { status: "success", templates: [] };
    
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const templates = [];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    for (let i = 1; i < rows.length; i++) {
      templates.push({
        TemplateID: rows[i][colIdx["TemplateID"]],
        Name:       rows[i][colIdx["Name"]],
        Body:       rows[i][colIdx["Body"]],
        UpdatedAt:  rows[i][colIdx["UpdatedAt"]]
      });
    }
    return { status: "success", templates: templates };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Memperbarui isi pesan template tertentu.
 */
function handleUpdateTelegramTemplate(data) {
  ensureTelegramDatabase();
  try {
    const { templateId, body } = data;
    if (!templateId) return { status: "error", message: "Template ID diperlukan." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_TEMPLATES_SHEET);
    const rows = sheet.getDataRange().getValues();
    const colIdx = {};
    rows[0].forEach((h, i) => { colIdx[h] = i; });

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][colIdx["TemplateID"]]).toUpperCase() === templateId.toUpperCase()) {
        sheet.getRange(i + 1, colIdx["Body"] + 1).setValue(body);
        sheet.getRange(i + 1, colIdx["UpdatedAt"] + 1).setValue(new Date());
        return { status: "success", message: "Template berhasil diperbarui." };
      }
    }
    return { status: "error", message: "Template tidak ditemukan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mengirim pesan Broadcast manual.
 */
function handleSendManualBroadcast(data) {
  ensureTelegramDatabase();
  try {
    const { targetRole, messageText } = data;
    if (!messageText) return { status: "error", message: "Isi pesan wajib diisi." };

    const users = getTelegramUsers();
    
    // Filter target penerima
    const targetUsers = users.filter(u => {
      const isUserActive = String(u.Status).toUpperCase() === "ACTIVE" || String(u.Active).toUpperCase() === "TRUE";
      if (!isUserActive || !u.ChatID) return false;
      if (targetRole === "ALL") return true;
      return String(u.Role).toUpperCase() === targetRole.toUpperCase();
    });

    if (targetUsers.length === 0) {
      return { status: "error", message: "Tidak ada penerima aktif untuk target " + targetRole };
    }

    let sent = 0;
    targetUsers.forEach(u => {
      const queueId = TelegramQueueProcessor.enqueue(u.ChatID, u.TelegramName, messageText);
      const ok = TelegramQueueProcessor.dispatch(queueId);
      if (ok) sent++;
    });

    return { 
      status: "success", 
      message: "Broadcast berhasil dikirim ke " + sent + " dari " + targetUsers.length + " penerima." 
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mengirim pesan percobaan (Test Notification) ke pelanggan tertentu.
 */
function handleTestTelegramSubscriberNotification(data) {
  ensureTelegramDatabase();
  try {
    const { id } = data;
    if (!id) return { status: "error", message: "ID pelanggan diperlukan." };

    const users = getTelegramUsers();
    const sub = users.find(u => String(u.ID) === String(id));
    if (!sub || !sub.ChatID) return { status: "error", message: "Pelanggan tidak ditemukan atau tidak memiliki Chat ID." };

    const testText = "🧪 <b>TEST NOTIFIKASI SUKSES</b>\n\nHalo " + sub.TelegramName + ",\nPercobaan pengiriman pesan dari panel kontrol Notification Center berhasil diselesaikan.";
    const queueId = TelegramQueueProcessor.enqueue(sub.ChatID, sub.TelegramName, testText);
    const success = TelegramQueueProcessor.dispatch(queueId);

    if (success) {
      return { status: "success", message: "Notifikasi percobaan berhasil dikirim ke @" + sub.Username };
    } else {
      return { status: "error", message: "Gagal mengirim notifikasi percobaan. Periksa LastError pelanggan." };
    }
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mengambil antrean riwayat notifikasi (Queue History).
 */
function handleGetTelegramQueueHistory() {
  ensureTelegramDatabase();
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_QUEUE_SHEET);
    if (!sheet || sheet.getLastRow() < 2) {
      return { status: "success", queue: [] };
    }

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const queue = [];
    
    // Urutkan dari yang terbaru (bawah ke atas), ambil maksimal 100 log terakhir
    const limit = Math.max(1, rows.length - 100);
    for (let i = rows.length - 1; i >= limit; i--) {
      queue.push({
        QueueID:      rows[i][colIdx["QueueID"]],
        Timestamp:    rows[i][colIdx["Timestamp"]] ? new Date(rows[i][colIdx["Timestamp"]]).toISOString() : "",
        ChatID:       rows[i][colIdx["ChatID"]],
        Username:     rows[i][colIdx["Username"]],
        Text:         rows[i][colIdx["Text"]],
        Status:       rows[i][colIdx["Status"]],
        RetryCount:   rows[i][colIdx["RetryCount"]],
        ErrorMessage: rows[i][colIdx["ErrorMessage"]]
      });
    }
    return { status: "success", queue: queue };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mengambil konfigurasi setting Telegram.
 */
function handleGetTelegramSettings() {
  try {
    const props = PropertiesService.getScriptProperties();
    return {
      status: "success",
      settings: {
        botToken:         props.getProperty("TELEGRAM_BOT_TOKEN") || "",
        botUsername:      props.getProperty("TELEGRAM_BOT_USERNAME") || "",
        webhookUrl:       props.getProperty("TELEGRAM_WEBHOOK_URL") || "",
        timeout:          props.getProperty("TELEGRAM_TIMEOUT_MS") || "5000",
        retryCount:       props.getProperty("TELEGRAM_RETRY_COUNT") || "3",
        enabledGlobal:    props.getProperty("TELEGRAM_NOTIFICATIONS_ENABLED") !== "false",
        defaultParseMode: props.getProperty("TELEGRAM_DEFAULT_PARSE_MODE") || "HTML",
        enableSound:      props.getProperty("TELEGRAM_ENABLE_SOUND") !== "false"
      }
    };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Read-only webhook diagnostic for authorized administrators. The bot token
 * remains server-side and is never returned to callers.
 */
function handleGetTelegramWebhookInfo(data) {
  try {
    requireStockProductionPermission(data || {}, "manage_stock_alert_settings");
    const props = PropertiesService.getScriptProperties();
    const token = _getTelegramBotToken() || "";
    const configuredWebhookUrl = props.getProperty("TELEGRAM_WEBHOOK_URL") || "";
    if (!token) {
      return {
        status: "error",
        code: "telegram_token_missing",
        configuredWebhookUrl: configuredWebhookUrl,
        message: "Telegram bot token belum dikonfigurasi."
      };
    }

    const response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo", {
      method: "GET",
      muteHttpExceptions: true
    });
    const body = JSON.parse(response.getContentText() || "{}");
    if (!body.ok) {
      return {
        status: "error",
        code: "telegram_webhook_info_failed",
        configuredWebhookUrl: configuredWebhookUrl,
        message: "Telegram tidak dapat menyediakan status webhook."
      };
    }

    const info = body.result || {};
    const lastErrorSeconds = Number(info.last_error_date);
    return {
      status: "success",
      configuredWebhookUrl: configuredWebhookUrl,
      webhookUrl: String(info.url || ""),
      pendingUpdateCount: Number(info.pending_update_count) || 0,
      lastErrorDate: isFinite(lastErrorSeconds) && lastErrorSeconds > 0 ? new Date(lastErrorSeconds * 1000).toISOString() : "",
      lastErrorMessage: String(info.last_error_message || ""),
      hasCustomCertificate: info.has_custom_certificate === true,
      maxConnections: Number(info.max_connections) || 0
    };
  } catch (error) {
    return { status: "error", code: "telegram_webhook_diagnostic_failed", message: String(error && error.message || error) };
  }
}

/**
 * Menyimpan konfigurasi setting Telegram dan mengatur ulang Webhook.
 */
function handleSaveTelegramSettings(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const { botToken, botUsername, enabledGlobal, defaultParseMode, enableSound } = data;

    if (botToken !== undefined) props.setProperty("TELEGRAM_BOT_TOKEN", String(botToken).trim());
    if (botUsername !== undefined) props.setProperty("TELEGRAM_BOT_USERNAME", String(botUsername).trim());
    if (enabledGlobal !== undefined) props.setProperty("TELEGRAM_NOTIFICATIONS_ENABLED", String(enabledGlobal));
    if (defaultParseMode !== undefined) props.setProperty("TELEGRAM_DEFAULT_PARSE_MODE", String(defaultParseMode));
    if (enableSound !== undefined) props.setProperty("TELEGRAM_ENABLE_SOUND", String(enableSound));

    // Atur ulang webhook otomatis jika GAS_URL tersedia dan token valid
    const gasUrl = props.getProperty("GAS_URL") || ScriptApp.getService().getUrl();
    if (gasUrl && botToken) {
      try {
        const url = "https://api.telegram.org/bot" + String(botToken).trim() + "/setWebhook?url=" + encodeURIComponent(gasUrl);
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        const json = JSON.parse(res.getContentText());
        if (json.ok) {
          props.setProperty("TELEGRAM_WEBHOOK_URL", gasUrl);
          console.log("[TelegramAPI] Webhook set to: " + gasUrl);
        }
      } catch (err) {}
    }

    return { status: "success", message: "Konfigurasi Telegram berhasil disimpan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Mengirim ulang seluruh pesan gagal (Bulk Retry).
 */
function handleRetryAllFailedQueue() {
  ensureTelegramDatabase();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
    if (!sheet || sheet.getLastRow() < 2) {
      return { status: "success", message: "Antrean kosong." };
    }

    const data = sheet.getDataRange().getValues();
    const colIdx = {};
    data[0].forEach((h, i) => { colIdx[h] = i; });

    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][colIdx["Status"]]).toUpperCase();
      if (status === "FAILED" || status === "RETRY") {
        const queueId = data[i][colIdx["QueueID"]];
        TelegramQueueProcessor.dispatch(queueId);
        count++;
      }
    }
    return { status: "success", message: count + " antrean gagal berhasil di-retry." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Membersihkan seluruh antrean dengan status SUCCESS.
 */
function handleClearSuccessQueueLogs() {
  ensureTelegramDatabase();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(TELEGRAM_QUEUE_SHEET);
    if (!sheet || sheet.getLastRow() < 2) {
      return { status: "success", message: "Antrean kosong." };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    let count = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      const status = String(data[i][colIdx["Status"]]).toUpperCase();
      if (status === "SUCCESS") {
        sheet.deleteRow(i + 1);
        count++;
      }
    }
    return { status: "success", message: count + " log sukses dibersihkan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Menjalankan simulasi payload webhook dari antarmuka Settings/UI.
 */
function handleSimulateTelegramWebhook(data) {
  try {
    const update = {
      message: {
        chat: { id: 999999, first_name: "Simulasi", last_name: "User", username: "simulasi_bot" },
        text: "/start"
      }
    };
    const result = handleTelegramWebhook(update);
    return { status: "success", message: "Simulasi webhook berhasil diproses.", result: result };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}
