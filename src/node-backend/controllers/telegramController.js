import { TelegramService } from '../services/telegramService.js';
import { TelegramSheetRepository } from '../repositories/sheets/telegramSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';
import propertiesService from '../utils/properties.js';

const telegramRepository = new TelegramSheetRepository();
const telegramService = new TelegramService(telegramRepository);

/**
 * getTelegramStatus - Handler untuk mengecek status dan statistik bot Telegram.
 */
export async function getTelegramStatus(req, res) {
  try {
    const result = await telegramService.getTelegramDashboardData();
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Get status failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil status Telegram.', error);
  }
}

/**
 * getTelegramLogs - Handler untuk mengambil riwayat logs Telegram.
 */
export async function getTelegramLogs(req, res) {
  try {
    const list = await telegramRepository.getTelegramLogs();
    // Kembalikan maksimal 50 log terakhir
    const logs = list.slice(-50).reverse();
    return sendCompatibleResponse(res, { status: "success", logs });
  } catch (error) {
    console.error('[TelegramController ERROR] Get logs failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil log Telegram.', error);
  }
}

/**
 * getTelegramUsers - Handler untuk mengambil seluruh user/subscriber Telegram.
 */
export async function getTelegramUsers(req, res) {
  try {
    const users = await telegramRepository.getTelegramUsers();
    return sendCompatibleResponse(res, { status: "success", users });
  } catch (error) {
    console.error('[TelegramController ERROR] Get users failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar pengguna Telegram.', error);
  }
}

/**
 * getTelegramSubscribers - Alias untuk getTelegramUsers.
 */
export async function getTelegramSubscribers(req, res) {
  return getTelegramUsers(req, res);
}

/**
 * getTelegramTemplates - Handler untuk mengambil template notifikasi.
 */
export async function getTelegramTemplates(req, res) {
  try {
    const templates = await telegramRepository.getTelegramTemplates();
    return sendCompatibleResponse(res, { status: "success", templates });
  } catch (error) {
    console.error('[TelegramController ERROR] Get templates failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar template notifikasi.', error);
  }
}

/**
 * getTelegramQueueHistory - Handler untuk mengambil log antrean antrean.
 */
export async function getTelegramQueueHistory(req, res) {
  try {
    const queue = await telegramRepository.getTelegramQueueHistory();
    // Urutkan dari yang terbaru (limit 100)
    const result = queue.slice(-100).reverse();
    return sendCompatibleResponse(res, { status: "success", queue: result });
  } catch (error) {
    console.error('[TelegramController ERROR] Get queue history failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil daftar antrean Telegram.', error);
  }
}

/**
 * getTelegramSettings - Handler untuk mendapatkan setting properties Telegram.
 */
export async function getTelegramSettings(req, res) {
  try {
    const settings = {
      botToken:         propertiesService.getProperty("TELEGRAM_BOT_TOKEN") || "",
      botUsername:      propertiesService.getProperty("TELEGRAM_BOT_USERNAME") || "",
      webhookUrl:       propertiesService.getProperty("TELEGRAM_WEBHOOK_URL") || "",
      timeout:          propertiesService.getProperty("TELEGRAM_TIMEOUT_MS") || "5000",
      retryCount:       propertiesService.getProperty("TELEGRAM_RETRY_COUNT") || "3",
      enabledGlobal:    propertiesService.getProperty("TELEGRAM_NOTIFICATIONS_ENABLED") !== "false",
      defaultParseMode: propertiesService.getProperty("TELEGRAM_DEFAULT_PARSE_MODE") || "HTML",
      enableSound:      propertiesService.getProperty("TELEGRAM_ENABLE_SOUND") !== "false"
    };
    return sendCompatibleResponse(res, { status: "success", settings });
  } catch (error) {
    console.error('[TelegramController ERROR] Get settings failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil konfigurasi Telegram.', error);
  }
}

/**
 * saveTelegramSettings - Handler untuk menyimpan setting properties Telegram.
 */
export async function saveTelegramSettings(req, res) {
  try {
    const { botToken, botUsername, enabledGlobal, defaultParseMode, enableSound } = req.body;
    
    if (botToken !== undefined) propertiesService.setProperty("TELEGRAM_BOT_TOKEN", String(botToken).trim());
    if (botUsername !== undefined) propertiesService.setProperty("TELEGRAM_BOT_USERNAME", String(botUsername).trim());
    if (enabledGlobal !== undefined) propertiesService.setProperty("TELEGRAM_NOTIFICATIONS_ENABLED", String(enabledGlobal));
    if (defaultParseMode !== undefined) propertiesService.setProperty("TELEGRAM_DEFAULT_PARSE_MODE", String(defaultParseMode));
    if (enableSound !== undefined) propertiesService.setProperty("TELEGRAM_ENABLE_SOUND", String(enableSound));

    return sendCompatibleResponse(res, { status: "success", message: "Konfigurasi Telegram berhasil disimpan." });
  } catch (error) {
    console.error('[TelegramController ERROR] Save settings failed:', error);
    return sendErrorResponse(res, 'Gagal menyimpan konfigurasi Telegram.', error);
  }
}

/**
 * updateTelegramUser - Handler untuk memperbarui data subscriber.
 */
export async function updateTelegramUser(req, res) {
  try {
    const { id, telegramName, username, chatId, role, active } = req.body;
    const ok = await telegramRepository.updateTelegramUser(id, {
      TelegramName: telegramName,
      Username: username,
      ChatID: chatId,
      Role: role,
      Active: active
    });
    if (ok) {
      return sendCompatibleResponse(res, { status: "success", message: "User updated" });
    }
    return sendCompatibleResponse(res, { status: "error", message: "User not found" });
  } catch (error) {
    console.error('[TelegramController ERROR] Update user failed:', error);
    return sendErrorResponse(res, 'Gagal memperbarui pengguna Telegram.', error);
  }
}

/**
 * deleteTelegramUser - Handler untuk menghapus subscriber.
 */
export async function deleteTelegramUser(req, res) {
  try {
    const { id } = req.body;
    const ok = await telegramRepository.deleteTelegramUser(id);
    if (ok) {
      return sendCompatibleResponse(res, { status: "success", message: "User deleted" });
    }
    return sendCompatibleResponse(res, { status: "error", message: "User not found" });
  } catch (error) {
    console.error('[TelegramController ERROR] Delete user failed:', error);
    return sendErrorResponse(res, 'Gagal menghapus pengguna Telegram.', error);
  }
}

/**
 * broadcastTelegram - Handler untuk mengirim pesan massal.
 */
export async function broadcastTelegram(req, res) {
  try {
    const result = await telegramService.broadcastTelegram(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Broadcast failed:', error);
    return sendErrorResponse(res, 'Gagal mengirim broadcast Telegram.', error);
  }
}

/**
 * approveTelegramSubscriber - Handler menyetujui subscriber.
 */
export async function approveTelegramSubscriber(req, res) {
  try {
    const { id } = req.body;
    const result = await telegramService.approveTelegramSubscriber(id);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Approve failed:', error);
    return sendErrorResponse(res, 'Gagal menyetujui pelanggan Telegram.', error);
  }
}

/**
 * disableTelegramSubscriber - Handler menonaktifkan subscriber.
 */
export async function disableTelegramSubscriber(req, res) {
  try {
    const { id } = req.body;
    const result = await telegramService.disableTelegramSubscriber(id);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Disable failed:', error);
    return sendErrorResponse(res, 'Gagal menonaktifkan pelanggan Telegram.', error);
  }
}

/**
 * testTelegramSubscriberNotification - Handler test notifikasi per pelanggan.
 */
export async function testTelegramSubscriberNotification(req, res) {
  try {
    const { id } = req.body;
    const result = await telegramService.testTelegramSubscriberNotification(id);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Test notification failed:', error);
    return sendErrorResponse(res, 'Gagal mengirim notifikasi percobaan.', error);
  }
}

/**
 * saveSubscriberRules - Handler menyimpan hak role & event rules subscriber.
 */
export async function saveSubscriberRules(req, res) {
  try {
    const { id, role, rules } = req.body;
    const ok = await telegramRepository.updateTelegramUser(id, {
      Role: role,
      Rules: JSON.stringify(rules)
    });
    if (ok) {
      return sendCompatibleResponse(res, { status: "success", message: "Aturan notifikasi berhasil disimpan." });
    }
    return sendCompatibleResponse(res, { status: "error", message: "Pelanggan tidak ditemukan." });
  } catch (error) {
    console.error('[TelegramController ERROR] Save rules failed:', error);
    return sendErrorResponse(res, 'Gagal menyimpan aturan notifikasi.', error);
  }
}

/**
 * updateTelegramTemplate - Handler mengubah format body template.
 */
export async function updateTelegramTemplate(req, res) {
  try {
    const { templateId, body, version } = req.body;
    if (!templateId) {
      return sendCompatibleResponse(res, { status: "error", message: "Template ID diperlukan." });
    }
    const ok = await telegramRepository.updateTelegramTemplate(templateId, body, version || "1");
    if (ok) {
      return sendCompatibleResponse(res, { status: "success", message: "Template berhasil diperbarui." });
    }
    return sendCompatibleResponse(res, { status: "error", message: "Template tidak ditemukan." });
  } catch (error) {
    console.error('[TelegramController ERROR] Update template failed:', error);
    return sendErrorResponse(res, 'Gagal memperbarui template notifikasi.', error);
  }
}

/**
 * getTelegramDLQ - Handler untuk melihat list Dead Letter Queue.
 */
export async function getTelegramDLQ(req, res) {
  try {
    const list = await telegramRepository.getTelegramDLQ();
    return sendCompatibleResponse(res, { status: "success", queue: list });
  } catch (error) {
    console.error('[TelegramController ERROR] Get DLQ failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil antrean DLQ.', error);
  }
}

/**
 * retryDLQMessage - Handler untuk men-retry antrean dari DLQ.
 */
export async function retryDLQMessage(req, res) {
  try {
    const { queueId } = req.body;
    const ok = await telegramRepository.retryDLQMessage(queueId);
    if (ok) {
      // Trigger pemrosesan antrean asinkron
      telegramService.processQueue();
      return sendCompatibleResponse(res, { status: "success", message: "Antrean berhasil dijadwalkan ulang." });
    }
    return sendCompatibleResponse(res, { status: "error", message: "Antrean tidak ditemukan." });
  } catch (error) {
    console.error('[TelegramController ERROR] Retry DLQ failed:', error);
    return sendErrorResponse(res, 'Gagal menjadwalkan ulang antrean DLQ.', error);
  }
}

/**
 * simulateTelegramWebhook - Handler simulasi masuknya start command.
 */
export async function simulateTelegramWebhook(req, res) {
  try {
    const result = await telegramService.handleTelegramWebhook({
      message: {
        chat: { id: 999999, first_name: "Simulasi", last_name: "User", username: "simulasi_bot" },
        text: "/start"
      }
    });
    return sendCompatibleResponse(res, { status: "success", message: "Simulasi webhook berhasil diproses.", result });
  } catch (error) {
    console.error('[TelegramController ERROR] Simulate webhook failed:', error);
    return sendErrorResponse(res, 'Gagal mensimulasikan webhook Telegram.', error);
  }
}

/**
 * telegramWebhook - Handler riil webhook update Telegram.
 */
export async function telegramWebhook(req, res) {
  try {
    const result = await telegramService.handleTelegramWebhook(req.body);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[TelegramController ERROR] Webhook failed:', error);
    return sendErrorResponse(res, 'Gagal memproses webhook Telegram.', error);
  }
}
