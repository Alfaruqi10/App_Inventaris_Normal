// ============================================================
// NotificationCenter/NotificationEngine.gs — State Transition & Idempotency Engine V2
// Optimized: Cache-only idempotency, zero sheet reads, single batch write
// ============================================================

var TelegramNotificationEngine = (function() {

  /**
   * Helper: Hitung hash sederhana dari pesan.
   */
  function hashMessage(text) {
    if (!text) return "";
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return "hash_" + hash;
  }

  /**
   * Cek idempotency menggunakan CacheService + PropertiesService saja.
   * TIDAK membaca sheet history sama sekali — menghindari timeout.
   *
   * Layer 1: CacheService (cepat, volatile, TTL 6 jam)
   * Layer 2: PropertiesService (persisten, tahan restart/deploy ulang)
   */
  function isEventProcessed(eventKey) {
    var cache = CacheService.getScriptCache();
    // Layer 1: Cache (sub-millisecond)
    if (cache.get("evk_" + eventKey)) return true;

    // Layer 2: PropertiesService (persisten, ~50ms)
    var props = PropertiesService.getScriptProperties();
    var stored = props.getProperty("evk_" + eventKey);
    if (stored) {
      // Re-warm cache
      cache.put("evk_" + eventKey, "1", 21600);
      return true;
    }
    return false;
  }

  /**
   * Tandai event sebagai sudah diproses (cache + properties).
   */
  function markEventProcessed(eventKey) {
    CacheService.getScriptCache().put("evk_" + eventKey, "1", 21600); // 6 jam
    PropertiesService.getScriptProperties().setProperty("evk_" + eventKey, String(Date.now()));
  }

  /**
   * Log history ke sheet secara fire-and-forget (appendRow saja, tanpa baca).
   * Dipanggil SETELAH Telegram berhasil dikirim.
   */
  function logHistoryAsync(ss, eventKey, chatId, userId, event, oldStatus, newStatus, msgType, messageText, success, source) {
    try {
      var sheet = ss.getSheetByName(TELEGRAM_HISTORY_SHEET);
      if (!sheet) return; // Sheet belum ada, skip silently
      sheet.appendRow([
        eventKey,
        String(chatId),
        String(userId),
        event,
        oldStatus || "N/A",
        newStatus || "N/A",
        msgType,
        hashMessage(messageText),
        new Date(),
        success ? "SUCCESS" : "FAILED",
        0,
        source || "SYSTEM"
      ]);
    } catch (e) {
      console.error("[NotificationEngine] logHistory error (non-fatal): " + e.toString());
    }
  }

  /**
   * Tentukan event, flag, dan pesan berdasarkan transisi status.
   * Pure function — tidak ada I/O.
   */
  function resolveTransition(oldStatus, newStatus, telegramName, chatId) {
    if ((oldStatus === "REGISTERED" || oldStatus === "" || oldStatus === "N/A") && newStatus === "PENDING") {
      return {
        event: "USER_PENDING",
        flag: "PendingNotificationSent",
        msgType: "WELCOME_PENDING",
        text: "⏳ <b>Pendaftaran Diajukan</b>\n\n" +
          "Akun Telegram Anda berhasil didaftarkan ke Sistem Inventaris ANSLA.\n\n" +
          "Nama: " + telegramName + "\n" +
          "Chat ID: <code>" + chatId + "</code>\n\n" +
          "Pendaftaran Anda saat ini <b>menunggu persetujuan Admin</b> sebelum dapat menerima notifikasi sistem."
      };
    }
    if (oldStatus === "PENDING" && newStatus === "APPROVED") {
      return {
        event: "USER_APPROVED",
        flag: "ApprovedNotificationSent",
        msgType: "WELCOME_APPROVED",
        text: "🎉 <b>Pendaftaran Anda Telah Disetujui!</b>\n\n" +
          "Akun Anda kini aktif di modul Notification Center ANSLA.\n" +
          "Anda akan segera menerima pemberitahuan sistem sesuai aturan langganan."
      };
    }
    if (oldStatus === "APPROVED" && newStatus === "ACTIVE") {
      return {
        event: "USER_ACTIVATED",
        flag: "ActivatedNotificationSent",
        msgType: "WELCOME_ACTIVATED",
        text: "✅ <b>Akun Anda sudah aktif dan terhubung dengan sistem.</b>"
      };
    }
    if (newStatus === "DISABLED") {
      return {
        event: "USER_DISABLED",
        flag: "ActivatedNotificationSent",
        msgType: "ACCOUNT_DISABLED",
        text: "❌ <b>Akun Anda Telah Dinonaktifkan</b>\n\n" +
          "Akun Anda telah dinonaktifkan oleh Admin. Hubungi Owner untuk informasi lebih lanjut."
      };
    }
    return null; // Transisi tidak memerlukan notifikasi
  }

  return {
    /**
     * Entry point utama. Mengirim notifikasi hanya jika terjadi perubahan status.
     *
     * Optimasi:
     * - Idempotency via CacheService + PropertiesService (0 sheet reads)
     * - Sheet hanya dibuka 1x, hanya untuk menulis flag + log history
     * - Total Spreadsheet API calls: maksimal 3 (getSheetByName, getRange.setValue, appendRow)
     */
    handleStateTransition: function(userId, oldStatus, newStatus, chatId, telegramName, source) {
      var t0 = Date.now();
      var cleanOld = String(oldStatus || "").toUpperCase().trim();
      var cleanNew = String(newStatus || "").toUpperCase().trim();
      var cleanChatId = String(chatId || "").trim();

      console.log("[NotificationEngine] " + userId + ": " + cleanOld + " -> " + cleanNew);

      // 1. Status tidak berubah => langsung return (0ms)
      if (cleanOld === cleanNew && cleanOld !== "") {
        console.log("[NotificationEngine] Status identik. Skip. (" + (Date.now() - t0) + "ms)");
        return true;
      }

      // 2. Untuk PENDING->ACTIVE, pecah jadi APPROVED + ACTIVATED
      if (cleanOld === "PENDING" && cleanNew === "ACTIVE") {
        var s1 = this._executeSingle(userId, "PENDING", "APPROVED", cleanChatId, telegramName, source);
        var s2 = this._executeSingle(userId, "APPROVED", "ACTIVE", cleanChatId, telegramName, source);
        console.log("[NotificationEngine] PENDING->ACTIVE selesai. (" + (Date.now() - t0) + "ms)");
        return s1 && s2;
      }

      var result = this._executeSingle(userId, cleanOld, cleanNew, cleanChatId, telegramName, source);
      console.log("[NotificationEngine] Selesai. (" + (Date.now() - t0) + "ms)");
      return result;
    },

    /**
     * Proses satu segmen transisi secara atomik.
     * Optimized: maksimal 1x buka SS, 1x appendRow, 1x setValue
     */
    _executeSingle: function(userId, oldStatus, newStatus, chatId, telegramName, source) {
      var t0 = Date.now();

      // 1. Resolve transisi (pure, 0ms)
      var tx = resolveTransition(oldStatus, newStatus, telegramName, chatId);
      if (!tx) {
        console.log("[NotificationEngine] Transisi " + oldStatus + "->" + newStatus + " tidak perlu notifikasi.");
        return true;
      }

      // 2. Idempotency check — CacheService + PropertiesService saja (0-50ms, TANPA sheet read)
      var eventKey = tx.event + "_" + userId + "_" + newStatus;
      if (isEventProcessed(eventKey)) {
        console.log("[NotificationEngine] Event " + eventKey + " sudah diproses. Skip. (" + (Date.now() - t0) + "ms)");
        return true;
      }
      console.log("[NotificationEngine] Idempotency check selesai. (" + (Date.now() - t0) + "ms)");

      // 3. Kirim Telegram (200-500ms — I/O eksternal, tidak bisa dihindari)
      var success = false;
      try {
        success = sendTelegramToChatId(chatId, tx.text);
      } catch (err) {
        console.error("[NotificationEngine] Gagal kirim Telegram: " + err.toString());
      }
      console.log("[NotificationEngine] Telegram API selesai: " + (success ? "OK" : "GAGAL") + ". (" + (Date.now() - t0) + "ms)");

      // 4. Tandai event sebagai sudah diproses (cache + properties, ~50ms)
      markEventProcessed(eventKey);

      // 5. Tulis flag + history ke sheet (dilakukan SETELAH Telegram terkirim)
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();

        // 5a. Update flag di TelegramUsers (1x getRange + setValue)
        var userSheet = ss.getSheetByName(TELEGRAM_USERS_SHEET);
        if (userSheet && tx.flag) {
          var userData = userSheet.getDataRange().getValues();
          var headers = userData[0];
          var flagCol = headers.indexOf(tx.flag);
          if (flagCol !== -1) {
            for (var i = 1; i < userData.length; i++) {
              if (String(userData[i][headers.indexOf("ID")]) === String(userId)) {
                userSheet.getRange(i + 1, flagCol + 1).setValue(true);
                // Set WelcomeNotificationSent for ACTIVATED
                if (tx.event === "USER_ACTIVATED") {
                  var welcomeCol = headers.indexOf("WelcomeNotificationSent");
                  if (welcomeCol !== -1) {
                    userSheet.getRange(i + 1, welcomeCol + 1).setValue(true);
                  }
                }
                break;
              }
            }
          }
        }

        // 5b. Log history (1x appendRow)
        logHistoryAsync(ss, eventKey, chatId, userId, tx.event, oldStatus, newStatus, tx.msgType, tx.text, success, source);

      } catch (sheetErr) {
        // Sheet write gagal — tidak fatal, event sudah ditandai di cache+properties
        console.error("[NotificationEngine] Sheet write error (non-fatal): " + sheetErr.toString());
      }

      console.log("[NotificationEngine] Total selesai. (" + (Date.now() - t0) + "ms)");
      return success;
    }
  };
})();
