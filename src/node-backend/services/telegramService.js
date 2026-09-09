import axios from 'axios';
import propertiesService from '../utils/properties.js';
import { getJakartaTimeString } from '../utils/dateFormatter.js';

export class TelegramService {
  /**
   * @param {TelegramRepository} telegramRepository
   */
  constructor(telegramRepository) {
    this.telegramRepo = telegramRepository;
    this.lastSentPerChat = {}; // Registri waktu kirim terakhir per ChatID untuk Rate Limiting
    this.processingQueue = false;
  }

  /**
   * Mendapatkan Token Bot dari properties.
   */
  getBotToken() {
    return propertiesService.getProperty("TELEGRAM_BOT_TOKEN") || process.env.TELEGRAM_BOT_TOKEN || "";
  }

  /**
   * Mendapatkan Owner Chat ID dari properties.
   */
  getOwnerChatId() {
    return propertiesService.getProperty("TELEGRAM_CHAT_ID") || process.env.TELEGRAM_CHAT_ID || "";
  }

  /**
   * Mengecek apakah pengiriman Telegram diaktifkan secara global.
   */
  isTelegramEnabled() {
    return propertiesService.getProperty("TELEGRAM_NOTIFICATIONS_ENABLED") !== "false";
  }

  /**
   * Mengirim request ke Telegram API secara langsung.
   */
  async sendApi(chatId, text) {
    const token = this.getBotToken();
    if (!token) throw new Error("Bot Token belum dikonfigurasi.");

    const parseMode = propertiesService.getProperty("TELEGRAM_DEFAULT_PARSE_MODE") || "HTML";
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode
    };

    try {
      const res = await axios.post(url, payload, { timeout: 8000 });
      if (res.data && res.data.ok) {
        return true;
      }
      throw new Error(res.data.description || "Gagal mengirim pesan.");
    } catch (err) {
      if (err.response && err.response.data) {
        const desc = err.response.data.description || "";
        if (err.response.data.error_code === 403) {
          // Nonaktifkan user jika bot diblokir
          await this.disableUserByChatId(chatId, "Bot blocked by user (403)");
        }
        throw new Error(desc || err.message);
      }
      throw err;
    }
  }

  /**
   * Nonaktifkan user berdasarkan ChatID (misal karena diblokir).
   */
  async disableUserByChatId(chatId, reason) {
    const user = await this.telegramRepo.getTelegramUserByChatId(chatId);
    if (user) {
      await this.telegramRepo.updateTelegramUser(user.ID || user.id, {
        Active: false,
        Status: "DISABLED",
        LastError: reason
      });
      console.log(`[TelegramService] User ${chatId} dinonaktifkan: ${reason}`);
    }
  }

  /**
   * Menambahkan pesan baru ke antrean pengiriman.
   */
  async enqueue(chatId, text, username = "N/A", idempotencyKey = "") {
    const queueItem = {
      chatId,
      username,
      text,
      status: "PENDING",
      retryCount: 0,
      errorMessage: "",
      idempotencyKey,
      processingTimeMs: 0
    };
    return await this.telegramRepo.enqueueMessage(queueItem);
  }

  /**
   * Mengirim pesan antrean secara langsung (Immediate Dispatch).
   */
  async dispatch(queueId) {
    const list = await this.telegramRepo.getTelegramQueueHistory();
    const item = list.find(q => String(q.QueueID) === String(queueId));
    if (!item) return false;

    // Ubah status ke SENDING
    await this.telegramRepo.updateQueueStatus(queueId, "SENDING");

    const startTime = Date.now();
    const chatId = item.ChatID || item.chat_id;
    try {
      const success = await this.sendApi(chatId, item.Text);
      const duration = Date.now() - startTime;

      if (success) {
        await this.telegramRepo.updateQueueStatus(queueId, "SUCCESS", {
          ErrorMessage: "",
          ProcessingTimeMs: duration,
          Timestamp: getJakartaTimeString()
        });
        this.lastSentPerChat[chatId] = Date.now();
        return true;
      } else {
        throw new Error("Gagal mengirim via Telegram API.");
      }
    } catch (e) {
      const duration = Date.now() - startTime;
      const errStr = e.message || e.toString();
      console.error(`[TelegramQueue] Gagal kirim ke ChatID ${chatId}: ${errStr}`);

      const retryCount = Number(item.RetryCount || 0) + 1;
      const nextStatus = retryCount >= 3 ? "DLQ" : "RETRY"; // Masuk DLQ setelah 3 kali gagal

      await this.telegramRepo.updateQueueStatus(queueId, nextStatus, {
        RetryCount: retryCount,
        ErrorMessage: errStr,
        ProcessingTimeMs: duration,
        Timestamp: getJakartaTimeString()
      });

      // Simpan error terakhir di user profile
      const user = await this.telegramRepo.getTelegramUserByChatId(chatId);
      if (user) {
        await this.telegramRepo.updateTelegramUser(user.ID || user.id, { LastError: errStr });
      }

      return false;
    }
  }

  /**
   * Memproses antrean WAITING & RETRY (Rate Limiter Terintegrasi).
   */
  async processQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      const pending = await this.telegramRepo.getPendingQueueMessages();
      for (const item of pending) {
        const chatId = item.ChatID || item.chat_id;
        
        // 1. Rate Limit per ChatID (maks 1 pesan / detik)
        const lastSent = this.lastSentPerChat[chatId] || 0;
        const now = Date.now();
        const elapsed = now - lastSent;
        if (elapsed < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
        }

        // 2. Kirim pesan
        await this.dispatch(item.QueueID);

        // 3. Jeda global minimal 34ms untuk mencegah hit rate-limit 30 pesan/detik secara global
        await new Promise(resolve => setTimeout(resolve, 34));
      }
    } catch (err) {
      console.error('[TelegramService] Queue worker error:', err.message);
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Mengambil data dashboard ringkas Notification Center.
   */
  async getTelegramDashboardData() {
    const token = this.getBotToken();
    let botStatus = "Offline";
    let botUsername = "Not Configured";

    if (token) {
      try {
        const url = `https://api.telegram.org/bot${token}/getMe`;
        const res = await axios.get(url, { timeout: 3000 });
        if (res.data && res.data.ok) {
          botStatus = "Online";
          botUsername = "@" + res.data.result.username;
        }
      } catch (e) {
        botStatus = "Error Connecting";
      }
    }

    const users = await this.telegramRepo.getTelegramUsers();
    const activeSubscribers = users.filter(u => String(u.Status).toUpperCase() === "ACTIVE" || String(u.Active).toUpperCase() === "TRUE").length;

    // Hitung status harian antrean
    const queueList = await this.telegramRepo.getTelegramQueueHistory();
    let totalToday = 0, successToday = 0, failedToday = 0, waitingCount = 0, dlqCount = 0;
    let sumDuration = 0, successDurationCount = 0;

    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);

    const chartData = {};

    queueList.forEach(q => {
      const qDate = new Date(q.Timestamp);
      const status = String(q.Status).toUpperCase();

      if (qDate >= startOfDay) {
        totalToday++;
        if (status === "SUCCESS") {
          successToday++;
          const duration = Number(q.ProcessingTimeMs || 0);
          if (duration > 0) {
            sumDuration += duration;
            successDurationCount++;
          }
        }
        else if (status === "FAILED") failedToday++;
        else if (status === "DLQ") dlqCount++;
        else if (status === "PENDING" || status === "RETRY" || status === "SENDING") waitingCount++;
      }

      // Kelompokkan 7 hari terakhir
      const diffDays = Math.floor((Date.now() - qDate.getTime()) / (1000 * 3600 * 24));
      if (diffDays < 7) {
        const dateStr = qDate.toLocaleDateString("id-ID", { weekday: "short" });
        if (!chartData[dateStr]) chartData[dateStr] = { success: 0, failed: 0 };
        if (status === "SUCCESS") chartData[dateStr].success++;
        if (status === "FAILED" || status === "DLQ") chartData[dateStr].failed++;
      }
    });

    const averageSendTimeMs = successDurationCount > 0 ? Math.round(sumDuration / successDurationCount) : 0;
    const lastError = propertiesService.getProperty("TELEGRAM_LAST_ERROR") || "None";

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
        dlqCount,
        lastNotif: users.length > 0 ? "Ready" : "No subscriber",
        lastError,
        averageSendTime: `${averageSendTimeMs} ms`,
        chartData: Object.keys(chartData).map(k => ({ day: k, success: chartData[k].success, failed: chartData[k].failed }))
      }
    };
  }

  /**
   * Mengambil URL/Link tautan gabung Bot Telegram.
   */
  async generateTelegramJoinLink() {
    const token = this.getBotToken();
    if (!token) {
      return { status: "error", message: "Telegram Bot Token belum dikonfigurasi" };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/getMe`;
      const res = await axios.get(url, { timeout: 3000 });
      if (res.data && res.data.ok) {
        const botUsername = res.data.result.username;
        return {
          status: "success",
          link: `https://t.me/${botUsername}?start=register`,
          botUsername
        };
      }
      return { status: "error", message: "Gagal mendapatkan username bot." };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * Mengirim pesan manual massal (Broadcast).
   */
  async broadcastTelegram(data) {
    if (!this.isTelegramEnabled()) {
      return { status: "suppressed", sent: 0, failed: 0, reason: "Global settings disabled" };
    }

    const { message, targetRole } = data;
    if (!message) return { status: "error", message: "Isi pesan wajib diisi." };

    try {
      const users = await this.telegramRepo.getTelegramUsers();
      const targetUsers = users.filter(u => {
        const isUserActive = String(u.Status).toUpperCase() === "ACTIVE" || String(u.Active).toUpperCase() === "TRUE";
        if (!isUserActive || !u.ChatID) return false;
        if (!targetRole || targetRole === "ALL") return true;
        return String(u.Role).toUpperCase() === String(targetRole).toUpperCase();
      });

      // Tambahkan Owner Chat ID juga ke list
      const ownerChatId = this.getOwnerChatId();
      if (ownerChatId) {
        const hasOwner = targetUsers.some(u => String(u.ChatID) === String(ownerChatId));
        if (!hasOwner) {
          targetUsers.push({ ChatID: ownerChatId, TelegramName: "Owner Admin", Username: "owner" });
        }
      }

      if (targetUsers.length === 0) {
        return { status: "error", message: `Tidak ada penerima aktif untuk target: ${targetRole || "ALL"}` };
      }

      let sent = 0;
      // Gunakan Idempotency Key unik untuk broadcast agar tidak terkirim ganda dalam waktu singkat
      const eventHash = crypto.createHash('md5').update(message).digest('hex').substring(0, 10);
      for (const u of targetUsers) {
        const idempotencyKey = `BROADCAST_${u.ChatID}_${eventHash}`;
        const queueId = await this.enqueue(u.ChatID, message, u.TelegramName, idempotencyKey);
        const ok = await this.dispatch(queueId);
        if (ok) sent++;
      }

      return {
        status: "success",
        message: `Broadcast berhasil dikirim ke ${sent} dari ${targetUsers.length} penerima.`
      };
    } catch (err) {
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Menangani data update Telegram Webhook (Auto Register /start).
   */
  async handleTelegramWebhook(update) {
    try {
      if (!update || !update.message) return { status: "ignored" };

      const message = update.message;
      const chatId = String(message.chat.id).trim();
      const text = String(message.text || "").trim();
      const from = message.from || {};
      const firstName = from.first_name || "";
      const lastName = from.last_name || "";
      const telegramName = (firstName + " " + lastName).trim() || "User";
      const username = from.username || "";

      if (text.startsWith("/start")) {
        // Cek jika user sudah terdaftar
        const existing = await this.telegramRepo.getTelegramUserByChatId(chatId);
        if (existing) {
          return { status: "success", message: "User already exists", chatId };
        }

        // Simpan user baru dengan status PENDING
        const id = "TU_" + Date.now();
        await this.telegramRepo.saveTelegramUser({
          id,
          telegramName,
          username,
          chatId,
          role: "Staff",
          active: false,
          status: "PENDING",
          rules: "[]"
        });

        // Kirim notifikasi sambutan pendaftaran
        const welcomeText = `👋 <b>Pendaftaran Akun ANSLA Bot</b>\n\nHalo ${telegramName},\nAkun Anda dengan Chat ID <code>${chatId}</code> telah didaftarkan dan menunggu persetujuan Administrator.`;
        await this.enqueue(chatId, welcomeText, telegramName, `WELCOME_PENDING_${chatId}`);
        await this.processQueue();

        return { status: "success", message: "User registered pending approval", chatId };
      }

      return { status: "ignored" };
    } catch (err) {
      console.error('[TelegramService ERROR] Webhook failed:', err.message);
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Melakukan persetujuan pendaftaran (Approve).
   */
  async approveTelegramSubscriber(id) {
    const users = await this.telegramRepo.getTelegramUsers();
    const sub = users.find(u => String(u.ID || u.id) === String(id));
    if (!sub) return { status: "error", message: "Pelanggan tidak ditemukan." };

    try {
      await this.telegramRepo.updateTelegramUser(id, {
        Active: true,
        Status: "ACTIVE"
      });

      // Kirim pesan pemberitahuan sukses disetujui
      const approveText = `🎉 <b>Akun ANSLA Bot Aktif!</b>\n\nHalo ${sub.TelegramName || 'User'},\nAkun Anda telah disetujui oleh Administrator. Anda sekarang akan menerima notifikasi stok dan pesanan.`;
      await this.enqueue(sub.ChatID || sub.chat_id, approveText, sub.TelegramName, `APPROVE_SUCCESS_${id}`);
      await this.processQueue();

      return { status: "success", message: "Pelanggan berhasil disetujui." };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * Menonaktifkan pelanggan (Disable).
   */
  async disableTelegramSubscriber(id) {
    const users = await this.telegramRepo.getTelegramUsers();
    const sub = users.find(u => String(u.ID || u.id) === String(id));
    if (!sub) return { status: "error", message: "Pelanggan tidak ditemukan." };

    try {
      await this.telegramRepo.updateTelegramUser(id, {
        Active: false,
        Status: "DISABLED"
      });

      const disableText = `🔒 <b>Akun ANSLA Bot Dinonaktifkan</b>\n\nHalo ${sub.TelegramName || 'User'},\nAkun Anda telah dinonaktifkan oleh Administrator.`;
      await this.enqueue(sub.ChatID || sub.chat_id, disableText, sub.TelegramName, `DISABLE_NOTICE_${id}`);
      await this.processQueue();

      return { status: "success", message: "Pelanggan berhasil dinonaktifkan." };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * Menjalankan pengiriman pesan percobaan (Test Notification).
   */
  async testTelegramSubscriberNotification(id) {
    const users = await this.telegramRepo.getTelegramUsers();
    const sub = users.find(u => String(u.ID || u.id) === String(id));
    if (!sub || !sub.ChatID) return { status: "error", message: "Pelanggan tidak ditemukan atau tidak memiliki Chat ID." };

    try {
      const testText = `🧪 <b>TEST NOTIFIKASI SUKSES</b>\n\nHalo ${sub.TelegramName},\nPercobaan pengiriman pesan dari panel kontrol Notification Center berhasil diselesaikan.`;
      const queueId = await this.enqueue(sub.ChatID, testText, sub.TelegramName, `TEST_NOTIF_${id}_${Date.now()}`);
      const success = await this.dispatch(queueId);

      if (success) {
        return { status: "success", message: `Notifikasi percobaan berhasil dikirim ke @${sub.Username || sub.username}` };
      } else {
        return { status: "error", message: "Gagal mengirim notifikasi percobaan. Periksa LastError pelanggan." };
      }
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  }
}

import crypto from 'crypto';
