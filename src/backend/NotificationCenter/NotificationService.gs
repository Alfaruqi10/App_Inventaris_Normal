// ============================================================
// NotificationCenter/NotificationService.gs — Core Engine V2
// ============================================================

/**
 * Registry Saluran Komunikasi (Future-proof channel gateway).
 */
var NotificationChannels = (function() {
  const registry = {};

  return {
    register: function(channelId, channelObj) {
      registry[channelId] = channelObj;
      console.log("[NotificationChannels] Berhasil mendaftarkan saluran: " + channelId);
    },
    get: function(channelId) {
      return registry[channelId];
    },
    send: function(channelId, recipientChatId, recipientName, text, options) {
      const ch = this.get(channelId);
      if (!ch) {
        console.warn("[NotificationChannels] Saluran " + channelId + " tidak terdaftar.");
        return false;
      }
      try {
        return ch.send(recipientChatId, recipientName, text, options);
      } catch (e) {
        console.error("[NotificationChannels ERROR] Saluran " + channelId + " gagal mengirim ke " + recipientChatId + ": " + e.toString());
        return false;
      }
    }
  };
})();

// ============================================================
// Registrasi Saluran Default (Default Channels Registry)
// ============================================================

// 1. Telegram Bot Channel
NotificationChannels.register("telegram", {
  send: function(chatId, username, text, options) {
    const queueId = TelegramQueueProcessor.enqueue(chatId, username, text, options || {});
    return TelegramQueueProcessor.dispatch(queueId);
  }
});

// 2. WhatsApp Channel (Placeholder - Future-Ready)
NotificationChannels.register("whatsapp", {
  send: function(phone, name, text, options) {
    console.log("[NotificationChannels] WhatsApp simulation to " + name + " (" + phone + ") with text: " + text);
    // Masa depan: hubungkan ke gateway WhatsApp API seperti Fonnte/Waba
    return true; 
  }
});

// 3. Email Channel (Placeholder - Future-Ready)
NotificationChannels.register("email", {
  send: function(emailAddress, name, text, options) {
    console.log("[NotificationChannels] Email simulation to " + name + " (" + emailAddress + ")");
    // Masa depan: MailApp.sendEmail(emailAddress, "ANSLA System Alert", text);
    return true;
  }
});

// 4. Discord Channel (Placeholder - Future-Ready)
NotificationChannels.register("discord", {
  send: function(webhookUrl, name, text, options) {
    console.log("[NotificationChannels] Discord webhook simulation to: " + webhookUrl);
    // Masa depan: UrlFetchApp.fetch(webhookUrl, { method: "POST", payload: ... })
    return true;
  }
});

// ============================================================
// Core Notification Service Engine
// ============================================================

var NotificationService = (function() {
  return {
    // Direct delivery is intentionally part of the existing gateway. Production
    // routing resolves one external recipient before calling this method; it
    // never broadens a routed instruction into the global subscriber list.
    sendToRecipient: function(eventType, recipient, payload) {
      try {
        ensureTelegramDatabase();
        const props = PropertiesService.getScriptProperties();
        if (props.getProperty("TELEGRAM_NOTIFICATIONS_ENABLED") === "false") {
          return { status: "suppressed", reason: "global_disabled", sent: 0 };
        }
        const target = recipient || {};
        const chatId = target.telegramChatId || target.ChatID;
        if (!chatId) return { status: "error", message: "Penerima Telegram tidak memiliki Chat ID.", sent: 0 };
        const messageText = String(eventType).toUpperCase() === "PRODUCTION_REQUIRED" && payload && payload.message
          ? payload.message
          : ((payload && (payload.message || payload.note || payload.error)) || ("Notification: " + eventType));
        const success = NotificationChannels.send("telegram", chatId, target.name || target.TelegramName || "Penerima Produksi", messageText, {
          notificationType: eventType,
          entityKey: payload && (payload.entityKey || payload.sku) || "",
          idempotencyKey: payload && payload.idempotencyKey || ""
        });
        if (success) this.updateLastActive(chatId);
        return { status: success ? "success" : "error", sent: success ? 1 : 0, failed: success ? 0 : 1, total: 1 };
      } catch (err) {
        console.error("[NotificationService ERROR] Pengiriman langsung gagal: " + err.toString());
        return { status: "error", message: err.toString(), sent: 0 };
      }
    },
    /**
     * Kirim notifikasi terpusat berdasarkan Event Type.
     * @param {string} eventType - Tipe Event (e.g., ORDER_NEW, STOCK_MIN, SYS_RECOVERY, dll.)
     * @param {Object} payload - Objek data pendukung berisi nilai placeholder
     * @return {Object} Status hasil pengiriman { status, sent, queued, failed }
     */
    send: function(eventType, payload) {
      console.log("[NotificationService] Menerima notifikasi untuk event: " + eventType);
      
      try {
        ensureTelegramDatabase();
        
        // 1. Cek status aktifasi notifikasi secara global
        const props = PropertiesService.getScriptProperties();
        const globalEnabled = props.getProperty("TELEGRAM_NOTIFICATIONS_ENABLED") !== "false";
        if (!globalEnabled) {
          console.log("[NotificationService] Notifikasi dinonaktifkan secara global. Lewati.");
          return { status: "suppressed", reason: "global_disabled" };
        }

        // 2. Ambil Template Pesan
        const template = this.getTemplate(eventType);
        let messageText = "";
        const normalizedEventType = String(eventType).toUpperCase();
        const usePreformattedMessage = normalizedEventType === "PRODUCTION_REQUIRED" || normalizedEventType.indexOf("ORDER_") === 0;
        if (usePreformattedMessage && payload && payload.message) {
          // Production notifications are a single current work queue table.
          // Order lifecycle messages also arrive from the canonical order formatter.
          messageText = payload.message;
        } else if (!template) {
          console.warn("[NotificationService] Template tidak ditemukan untuk event: " + eventType + ". Menggunakan fallback.");
          messageText = payload.note || payload.error || ("Notification: " + eventType);
        } else {
          // 3. Format pesan dengan data placeholder
          messageText = this.formatTemplate(template.Body, payload);
        }

        // 4. Cari pelanggan (Subscribers) yang aktif dan berlangganan rule event ini
        const subscribers = this.getSubscribersForEvent(eventType);
        if (subscribers.length === 0) {
          console.log("[NotificationService] Tidak ada subscriber aktif yang berlangganan event: " + eventType);
          return { status: "success", message: "No subscribers", sent: 0 };
        }

        let sent = 0, failed = 0;

        // 5. Kirim pesan ke semua saluran terdaftar untuk setiap subscriber
        subscribers.forEach(sub => {
          // Default ke saluran Telegram, dapat diperluas di kolom saluran di masa depan
          const activeChannels = sub.Channels ? String(sub.Channels).split(",") : ["telegram"];
          
          activeChannels.forEach(channelId => {
            const cleanChan = channelId.trim().toLowerCase();
            const recipientChatId = sub.ChatID; // Di masa depan, dipetakan ke nomor HP/Email sesuai channel
            
            const success = NotificationChannels.send(cleanChan, recipientChatId, sub.TelegramName, messageText, {
              notificationType: eventType,
              entityKey: payload.entityKey || payload.sku || "",
              idempotencyKey: payload.idempotencyKey || ""
            });
            if (success) {
              sent++;
              this.updateLastActive(sub.ChatID);
            } else {
              failed++;
            }
          });
        });

        return {
          status: "success",
          sent: sent,
          failed: failed,
          total: subscribers.length
        };

      } catch (err) {
        console.error("[NotificationService ERROR] Gagal mengirim notifikasi: " + err.toString());
        return { status: "error", message: err.toString() };
      }
    },

    /**
     * Memformat teks template dengan mengganti placeholder {{key}} dengan payload[key].
     */
    formatTemplate: function(body, payload) {
      if (!body) return "";
      let formatted = body;
      
      // Standar placeholder mapping
      const mapping = {
        invoice:     payload.invoice || payload.orderSn || "-",
        order_sn:    payload.orderSn || payload.invoice || "-",
        customer:    formatOrderNotificationBuyer(payload.buyerName || payload.buyer_name || payload.customer, payload.buyerUsername || payload.buyer_username),
        buyer:       formatOrderNotificationBuyer(payload.buyerName || payload.buyer_name || payload.customer, payload.buyerUsername || payload.buyer_username),
        buyer_name:  orderNotificationSafeText(payload.buyerName || payload.buyer_name, "-"),
        buyer_username: orderNotificationSafeText(payload.buyerUsername || payload.buyer_username, ""),
        amount:      payload.amount || payload.totalPrice || "0",
        courier:     payload.courier || payload.shippingCarrier || "-",
        reason:      payload.reason || "-",
        sku:         payload.sku || "-",
        product:     payload.product || payload.productName || "-",
        stock:       payload.stock || payload.qty || "0",
        min_stock:   payload.min_stock || payload.minStock || "0",
        shopee_id:   payload.shopee_id || payload.itemId || "-",
        tool:        payload.tool || payload.toolId || "-",
        status:      payload.status || "-",
        affected:    payload.affected || payload.affectedRows || "0",
        total_items: payload.totalItems || payload.total_items || "0",
        duration:    payload.duration || "0.0s",
        note:        payload.note || "-",
        filename:    payload.filename || "-",
        module:      payload.module || "-",
        error:       payload.error || "-",
        user:        payload.user || "System",
        date:        payload.date || new Date().toLocaleString(),
        ideal_stock: payload.idealStock || payload.ideal_stock || "0",
        production_qty: payload.productionQty || payload.production_qty || "0",
        moving_stat: payload.movingStat || payload.moving_stat || "-",
        priority: payload.priority || "-"
      };

      // Failsafe: Jika template tidak mengandung {{note}} tapi payload.note berisi pesan lengkap (kaya/multi-baris),
      // dan template body adalah template bawaan lama (tidak memiliki rincian detil produk/stok),
      // maka kita paksa gunakan payload.note agar informasi penting (produk, variasi, qty, stok) tidak hilang.
      const isDefaultSimpleTemplate = body.includes("No. Invoice:") && !body.includes("Produk:") && !body.includes("Variasi:") && !body.includes("{{note}}");
      if (isDefaultSimpleTemplate && payload.note && payload.note.includes("Produk:")) {
        return payload.note;
      }

      Object.keys(mapping).forEach(key => {
        const regex = new RegExp("{{" + key + "}}", "g");
        formatted = formatted.replace(regex, mapping[key]);
      });

      return formatted;
    },

    /**
     * Mengambil template dari sheet TelegramTemplates.
     */
    getTemplate: function(templateId) {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(TELEGRAM_TEMPLATES_SHEET);
      if (!sheet || sheet.getLastRow() < 2) return null;

      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const colIdx = {};
      headers.forEach((h, i) => { colIdx[h] = i; });

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colIdx["TemplateID"]]).toUpperCase() === templateId.toUpperCase()) {
          return {
            TemplateID: data[i][colIdx["TemplateID"]],
            Name:       data[i][colIdx["Name"]],
            Body:       data[i][colIdx["Body"]],
            UpdatedAt:  data[i][colIdx["UpdatedAt"]]
          };
        }
      }
      return null;
    },

    /**
     * Mencari seluruh user aktif yang berlangganan event tertentu.
     */
    getSubscribersForEvent: function(eventType) {
      const users = getTelegramUsers();
      
      // Map Event Type to UI Permission Rule
      const mapEventToRule = function(evType) {
        const ev = String(evType).toUpperCase();
        
        // Category: Shopee
        if (ev.startsWith("ORDER_")) {
          return "sync_pesanan";
        }
        
        // Category: Inventory
        if (ev === "BARANG_MASUK") return "barang_masuk";
        if (ev === "BARANG_KELUAR") return "barang_keluar";
        if (ev === "STOCK_MIN" || ev === "STOCK_EMPTY") return "produk";
        if (ev === "STOCK_LOW") return "notify_stock_low";
        if (ev === "STOCK_CRITICAL") return "notify_stock_critical";
        if (ev === "PRODUCTION_REQUIRED") return "notify_production_required";
        if (ev === "PRODUCTION_COMPLETED") return "notify_production_completed";
        if (ev === "PRODUCTION_SUMMARY") return "notify_production_summary";
        if (ev === "STOCK_UNMAPPED") return "mapping_produk";
        
        // Category: Shopee/Deduction
        if (ev === "SYS_DEDUCTION") return "approve_deduction";
        
        // Category: Maintenance
        if (ev === "SYS_RECOVERY") return "recovery_center";
        if (ev === "SYS_ERROR") return "maintenance_audit";
        if (ev === "SYS_BACKUP") return "telegram_settings";
        
        // Category: AI
        if (ev === "AI_SUMMARY") return "ai_summary";
        if (ev === "AI_INSIGHT") return "ai_insight";
        if (ev === "AI_ALERT") return "ai_alert";
        
        return evType;
      };

      const mappedRule = mapEventToRule(eventType);
      
      return users.filter(u => {
        // Cek status harus ACTIVE (atau Active = true)
        const isUserActive = String(u.Status).toUpperCase() === "ACTIVE" || String(u.Active).toUpperCase() === "TRUE";
        if (!isUserActive || !u.ChatID) return false;

        // Cek filter rule berlangganan
        let rules = [];
        try {
          if (u.Rules) {
            rules = JSON.parse(u.Rules);
          }
        } catch (e) {
          if (typeof u.Rules === "string") {
            rules = u.Rules.split(",").map(r => r.trim());
          }
        }

        const userRole = String(u.Role).toUpperCase();
        if (rules.length === 0 && (userRole === "OWNER" || userRole === "ADMIN")) {
          return true;
        }

        return rules.indexOf(eventType) >= 0 || rules.indexOf(mappedRule) >= 0;
      });
    },

    /**
     * Update waktu aktif terakhir (LastActive).
     */
    updateLastActive: function(chatId) {
      try {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TELEGRAM_USERS_SHEET);
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const colIdx = {};
        headers.forEach((h, i) => { colIdx[h] = i; });

        for (let i = 1; i < data.length; i++) {
          if (String(data[i][colIdx["ChatID"]]) === String(chatId)) {
            sheet.getRange(i + 1, colIdx["LastActive"] + 1).setValue(new Date());
            break;
          }
        }
      } catch (e) {
        console.error("[NotificationService] Gagal update LastActive:", e);
      }
    }
  };
})();
