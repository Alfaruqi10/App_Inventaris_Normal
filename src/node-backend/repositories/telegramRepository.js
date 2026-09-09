/**
 * TelegramRepository Interface
 * Kontrak untuk operasi data Telegram (TelegramUsers, TelegramQueue, TelegramTemplates, TelegramNotificationHistory, TelegramLogs).
 */
export class TelegramRepository {
  async getTelegramUsers() { throw new Error("Method getTelegramUsers() must be implemented."); }
  async getTelegramUserByChatId(chatId) { throw new Error("Method getTelegramUserByChatId() must be implemented."); }
  async saveTelegramUser(user) { throw new Error("Method saveTelegramUser() must be implemented."); }
  async updateTelegramUser(id, updates) { throw new Error("Method updateTelegramUser() must be implemented."); }
  async deleteTelegramUser(id) { throw new Error("Method deleteTelegramUser() must be implemented."); }
  
  async getTelegramTemplates() { throw new Error("Method getTelegramTemplates() must be implemented."); }
  async getTelegramTemplateById(templateId, version) { throw new Error("Method getTelegramTemplateById() must be implemented."); }
  async updateTelegramTemplate(templateId, body, version) { throw new Error("Method updateTelegramTemplate() must be implemented."); }
  
  async getTelegramQueueHistory() { throw new Error("Method getTelegramQueueHistory() must be implemented."); }
  async enqueueMessage(queueItem) { throw new Error("Method enqueueMessage() must be implemented."); }
  async updateQueueStatus(queueId, status, updates) { throw new Error("Method updateQueueStatus() must be implemented."); }
  async getPendingQueueMessages() { throw new Error("Method getPendingQueueMessages() must be implemented."); }
  async getTelegramDLQ() { throw new Error("Method getTelegramDLQ() must be implemented."); }
  async retryDLQMessage(queueId) { throw new Error("Method retryDLQMessage() must be implemented."); }
  
  async saveNotificationHistory(historyObj) { throw new Error("Method saveNotificationHistory() must be implemented."); }
  async getTelegramLogs() { throw new Error("Method getTelegramLogs() must be implemented."); }
}
