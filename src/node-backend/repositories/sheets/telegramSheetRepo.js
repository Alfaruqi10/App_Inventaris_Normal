import { TelegramRepository } from '../telegramRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class TelegramSheetRepository extends TelegramRepository {
  constructor() {
    super();
    this.usersSheet = "TelegramUsers";
    this.templatesSheet = "TelegramTemplates";
    this.queueSheet = "TelegramQueue";
    this.historySheet = "TelegramNotificationHistory";
    this.logsSheet = "TelegramLogs";
  }

  async getTelegramUsers() {
    return await sheetsService.readSheetObjects(this.usersSheet);
  }

  async getTelegramUserByChatId(chatId) {
    const users = await this.getTelegramUsers();
    return users.find(u => String(u.ChatID || u.chat_id).trim() === String(chatId).trim());
  }

  async saveTelegramUser(user) {
    const rows = await sheetsService.readRows(this.usersSheet);
    let headers = rows[0] || [];

    if (headers.length === 0) {
      headers = [
        "ID", "TelegramName", "Username", "ChatID", "Role", "Active", 
        "CreatedAt", "UpdatedAt", "LastError", "Status", "LastActive", "Rules",
        "PendingNotificationSent", "ApprovedNotificationSent", "ActivatedNotificationSent", "RejectedNotificationSent", "WelcomeNotificationSent"
      ];
      await sheetsService.appendRow(this.usersSheet, headers);
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const newRow = new Array(headers.length).fill("");
    const set = (colName, val) => {
      if (colIdx[colName] !== undefined) newRow[colIdx[colName]] = val;
    };

    const now = getJakartaTimeString();
    set("ID", user.id || ("TU_" + Date.now()));
    set("TelegramName", user.telegramName || "");
    set("Username", user.username || "");
    set("ChatID", String(user.chatId).trim());
    set("Role", user.role || "Staff");
    set("Active", user.active !== undefined ? user.active : false);
    set("CreatedAt", now);
    set("UpdatedAt", now);
    set("LastError", user.lastError || "");
    set("Status", user.status || "PENDING");
    set("LastActive", now);
    set("Rules", user.rules || "[]");

    await sheetsService.appendRow(this.usersSheet, newRow);
    return user;
  }

  async updateTelegramUser(id, updates) {
    const rows = await sheetsService.readRows(this.usersSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const idIdx = headers.indexOf("ID");
    const updatedIdx = headers.indexOf("UpdatedAt");

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx]) === String(id)) {
        const rowNum = i + 1;
        // Lakukan pembaruan untuk setiap properti
        for (const [key, val] of Object.entries(updates)) {
          const colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            await sheetsService.updateCell(this.usersSheet, rowNum, colIdx + 1, val);
          }
        }
        if (updatedIdx >= 0) {
          await sheetsService.updateCell(this.usersSheet, rowNum, updatedIdx + 1, getJakartaTimeString());
        }
        return true;
      }
    }
    return false;
  }

  async deleteTelegramUser(id) {
    const rows = await sheetsService.readRows(this.usersSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const idIdx = headers.indexOf("ID");

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx]) === String(id)) {
        await sheetsService.deleteRow(this.usersSheet, i + 1);
        return true;
      }
    }
    return false;
  }

  async getTelegramTemplates() {
    return await sheetsService.readSheetObjects(this.templatesSheet);
  }

  async getTelegramTemplateById(templateId, version) {
    const templates = await this.getTelegramTemplates();
    return templates.find(t => 
      String(t.TemplateID || t.template_id || "").toUpperCase() === String(templateId).toUpperCase() &&
      (version === undefined || String(t.Version || t.version || "1") === String(version))
    );
  }

  async updateTelegramTemplate(templateId, body, version = "1") {
    const rows = await sheetsService.readRows(this.templatesSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const templateIdIdx = headers.indexOf("TemplateID");
    const verIdx = headers.indexOf("Version");
    const bodyIdx = headers.indexOf("Body");
    const updatedIdx = headers.indexOf("UpdatedAt");

    for (let i = 1; i < rows.length; i++) {
      const isIdMatch = String(rows[i][templateIdIdx]).toUpperCase() === String(templateId).toUpperCase();
      const isVerMatch = verIdx < 0 || String(rows[i][verIdx] || "1") === String(version);

      if (isIdMatch && isVerMatch) {
        const rowNum = i + 1;
        if (bodyIdx >= 0) {
          await sheetsService.updateCell(this.templatesSheet, rowNum, bodyIdx + 1, body);
        }
        if (updatedIdx >= 0) {
          await sheetsService.updateCell(this.templatesSheet, rowNum, updatedIdx + 1, getJakartaTimeString());
        }
        return true;
      }
    }
    return false;
  }

  async getTelegramQueueHistory() {
    return await sheetsService.readSheetObjects(this.queueSheet);
  }

  async enqueueMessage(queueItem) {
    const rows = await sheetsService.readRows(this.queueSheet);
    let headers = rows[0] || [];

    if (headers.length === 0) {
      headers = [
        "QueueID", "Timestamp", "ChatID", "Username", "Text", 
        "Status", "RetryCount", "ErrorMessage", "IdempotencyKey", "ProcessingTimeMs"
      ];
      await sheetsService.appendRow(this.queueSheet, headers);
    }

    // Cek Idempotency: Jika IdempotencyKey tidak kosong, cek apakah sudah ada data sukses atau antrean aktif
    if (queueItem.idempotencyKey) {
      const colIdxKey = headers.indexOf("IdempotencyKey");
      const colIdxStatus = headers.indexOf("Status");
      if (colIdxKey >= 0 && colIdxStatus >= 0) {
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][colIdxKey]) === queueItem.idempotencyKey) {
            const st = String(rows[i][colIdxStatus]).toUpperCase();
            if (st === "SUCCESS" || st === "PENDING" || st === "SENDING" || st === "RETRY") {
              console.log(`[TelegramSheetRepository] Enqueue skipped (idempotency key hit: ${queueItem.idempotencyKey}, status: ${st})`);
              return rows[i][headers.indexOf("QueueID")]; // Kembalikan QueueID yang sudah ada
            }
          }
        }
      }
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const newRow = new Array(headers.length).fill("");
    const set = (colName, val) => {
      if (colIdx[colName] !== undefined) newRow[colIdx[colName]] = val;
    };

    const queueId = queueItem.queueId || ("Q_" + Date.now() + "_" + Math.floor(Math.random() * 1000));
    set("QueueID", queueId);
    set("Timestamp", getJakartaTimeString());
    set("ChatID", String(queueItem.chatId).trim());
    set("Username", queueItem.username || "N/A");
    set("Text", queueItem.text);
    set("Status", queueItem.status || "PENDING");
    set("RetryCount", queueItem.retryCount || 0);
    set("ErrorMessage", queueItem.errorMessage || "");
    set("IdempotencyKey", queueItem.idempotencyKey || "");
    set("ProcessingTimeMs", queueItem.processingTimeMs || 0);

    await sheetsService.appendRow(this.queueSheet, newRow);
    return queueId;
  }

  async updateQueueStatus(queueId, status, updates = {}) {
    const rows = await sheetsService.readRows(this.queueSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const queueIdIdx = headers.indexOf("QueueID");
    const statusIdx = headers.indexOf("Status");

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][queueIdIdx]) === String(queueId)) {
        const rowNum = i + 1;
        if (statusIdx >= 0) {
          await sheetsService.updateCell(this.queueSheet, rowNum, statusIdx + 1, status);
        }
        for (const [key, val] of Object.entries(updates)) {
          const colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            await sheetsService.updateCell(this.queueSheet, rowNum, colIdx + 1, val);
          }
        }
        return true;
      }
    }
    return false;
  }

  async getPendingQueueMessages() {
    const list = await this.getTelegramQueueHistory();
    return list.filter(q => {
      const st = String(q.Status || q.status || "").toUpperCase();
      return st === "PENDING" || st === "RETRY";
    });
  }

  async getTelegramDLQ() {
    const list = await this.getTelegramQueueHistory();
    return list.filter(q => String(q.Status || q.status || "").toUpperCase() === "DLQ");
  }

  async retryDLQMessage(queueId) {
    return await this.updateQueueStatus(queueId, "PENDING", {
      RetryCount: 0,
      ErrorMessage: "",
      Timestamp: getJakartaTimeString()
    });
  }

  async saveNotificationHistory(historyObj) {
    const rows = await sheetsService.readRows(this.historySheet);
    let headers = rows[0] || [];

    if (headers.length === 0) {
      headers = [
        "NotificationID", "ChatID", "UserID", "Event", "OldStatus", 
        "NewStatus", "MessageType", "MessageHash", "SentAt", "Success", "RetryCount", "Source"
      ];
      await sheetsService.appendRow(this.historySheet, headers);
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const newRow = new Array(headers.length).fill("");
    const set = (colName, val) => {
      if (colIdx[colName] !== undefined) newRow[colIdx[colName]] = val;
    };

    set("NotificationID", historyObj.notificationId || ("N_" + Date.now()));
    set("ChatID", String(historyObj.chatId).trim());
    set("UserID", historyObj.userId || "");
    set("Event", historyObj.event || "");
    set("OldStatus", historyObj.oldStatus || "");
    set("NewStatus", historyObj.newStatus || "");
    set("MessageType", historyObj.messageType || "");
    set("MessageHash", historyObj.messageHash || "");
    set("SentAt", getJakartaTimeString());
    set("Success", historyObj.success !== undefined ? historyObj.success : true);
    set("RetryCount", historyObj.retryCount || 0);
    set("Source", historyObj.source || "SYSTEM");

    await sheetsService.appendRow(this.historySheet, newRow);
    return true;
  }

  async getTelegramLogs() {
    // Membaca log aktivitas dari sheet TelegramLogs
    const list = await sheetsService.readSheetObjects(this.logsSheet);
    return list;
  }
}
