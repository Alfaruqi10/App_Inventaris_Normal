import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const enginePath = new URL("../src/backend/Production/StockProductionEngine.gs", import.meta.url);
const engineSource = fs.readFileSync(enginePath, "utf8");

class MemorySheet {
  constructor(headers = []) { this.headers = [...headers]; this.rows = []; }
  getLastRow() { return this.headers.length ? this.rows.length + 1 : 0; }
  getLastColumn() { return this.headers.length; }
  getDataRange() { return { getValues: () => [this.headers, ...this.rows] }; }
  setFrozenRows() {}
  appendRow(values) { this.rows.push([...values]); }
  deleteRow(row) { this.rows.splice(row - 2, 1); }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues: () => {
        if (row === 1) return [this.headers.slice(column - 1, column - 1 + columnCount)];
        return Array.from({ length: rowCount }, (_, offset) => {
          const values = this.rows[row - 2 + offset] || [];
          return values.slice(column - 1, column - 1 + columnCount);
        });
      },
      setValues: (values) => {
        if (row === 1) { this.headers = [...values[0]]; return; }
        values.forEach((valuesRow, offset) => {
          const target = this.rows[row - 2 + offset] || [];
          valuesRow.forEach((value, index) => { target[column - 1 + index] = value; });
          this.rows[row - 2 + offset] = target;
        });
      },
      setValue: (value) => {
        const target = this.rows[row - 2] || [];
        target[column - 1] = value;
        this.rows[row - 2] = target;
      }
    };
  }
}

const sheets = new Map();
sheets.set("Users", new MemorySheet(["Email", "Nama", "Role", "Status"]));
sheets.get("Users").appendRow(["owner@example.invalid", "Owner Test", "OWNER", "ACTIVE"]);

const context = {
  console, isFinite, JSON, Math, Number, String, Date, Object,
  USER_SHEET_NAME: "Users",
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => sheets.get(name) || null,
      insertSheet: (name) => { const sheet = new MemorySheet(); sheets.set(name, sheet); return sheet; }
    })
  }
};
vm.createContext(context);
vm.runInContext(engineSource, context);

// Delete checks configuration usage in production; this harness deliberately
// supplies no inventory/configuration and never touches production state.
context.readStockProductionInventory = () => ({ ok: false });

const caller = { callerEmail: "owner@example.invalid" };
const empty = context.handleGetProductionRecipients(caller);
assert.equal(empty.status, "success");
assert.deepEqual(JSON.parse(JSON.stringify(empty.rows)), []);

const created = context.handleSaveProductionRecipient({
  ...caller, mode: "CREATE", id: "MANG-IYUS", recipientId: "MANG-IYUS",
  name: "Mang Iyus", type: "KONVEKSI", telegramChatId: "-1001234567890",
  chatId: "-1001234567890", active: true, notes: "Tes in-memory"
});
assert.equal(created.status, "success");
assert.equal(created.mode, "created");
assert.equal(created.recipient.type, "KONVEKSI");
assert.equal(typeof created.recipient.telegramChatId, "string");

const listed = context.handleGetProductionRecipients(caller);
assert.equal(listed.rows.length, 1);
assert.equal(listed.rows[0].name, "Mang Iyus");

const updated = context.handleSaveProductionRecipient({
  ...caller, mode: "UPDATE", recipientId: "MANG-IYUS", name: "Mang Iyus Konveksi",
  type: "PENJAHIT", chatId: "-1001234567890", active: false, notes: "Diperbarui"
});
assert.equal(updated.status, "success");
assert.equal(updated.mode, "updated");
assert.equal(updated.recipient.type, "KONVEKSI");
assert.equal(updated.recipient.active, false);

const deleted = context.handleDeleteProductionRecipient({ ...caller, id: "MANG-IYUS" });
assert.equal(deleted.status, "success");
assert.equal(context.handleGetProductionRecipients(caller).rows.length, 0);
assert.deepEqual([...sheets.keys()].sort(), ["ProductionRecipients", "Users"]);

console.log("Production recipient CRUD harness: PASS (in-memory only)");
