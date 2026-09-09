import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const reportsSource = fs.readFileSync(new URL("../src/backend/Production/ProductionReports.gs", import.meta.url), "utf8");
const authSource = fs.readFileSync(new URL("../src/backend/Production/ProductionReportsAuth.gs", import.meta.url), "utf8");
const codeSource = fs.readFileSync(new URL("../src/backend/code.gs", import.meta.url), "utf8");
const frontendSource = fs.readFileSync(new URL("../src/frontend/index.html", import.meta.url), "utf8");
const productionCenterSource = fs.readFileSync(new URL("../src/frontend/ProductionCenter/production-center.js", import.meta.url), "utf8");

class MemorySheet {
  constructor(headers) { this.headers = headers.slice(); this.rows = []; }
  getLastRow() { return this.rows.length + (this.headers.length ? 1 : 0); }
  getLastColumn() { return this.headers.length; }
  getDataRange() { return { getValues: () => [this.headers.slice(), ...this.rows.map(row => row.slice())] }; }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues: () => row === 1
        ? [this.headers.slice(column - 1, column - 1 + columnCount)]
        : this.rows.slice(row - 2, row - 2 + rowCount).map(values => values.slice(column - 1, column - 1 + columnCount)),
      getValue: () => row === 1 ? this.headers[column - 1] : this.rows[row - 2][column - 1],
      setValue: value => { this.rows[row - 2][column - 1] = value; },
      setValues: values => { if (row === 1) this.headers.splice(column - 1, values[0].length, ...values[0]); },
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
  insertColumnsAfter(_column, count) {
    for (let index = 0; index < count; index += 1) this.headers.push("");
    this.rows.forEach(row => { for (let index = 0; index < count; index += 1) row.push(""); });
  }
  setFrozenRows() {}
}

function createFixture() {
  const users = new MemorySheet(["Email", "Nama", "Role", "Status"]);
  users.appendRow(["owner@example.test", "Owner", "OWNER", "ACTIVE"]);
  users.appendRow(["admin@example.test", "Admin", "ADMIN", "ACTIVE"]);
  users.appendRow(["staff@example.test", "Staff", "STAFF", "ACTIVE"]);
  users.appendRow(["konveksi@example.test", "Mang Iyus", "KONVEKSI", "ACTIVE"]);
  const reports = new MemorySheet([
    "ReportID", "ProductionRecipient", "TelegramChatId", "ReceivedAt", "TelegramUpdateId", "TelegramMessageId",
    "TelegramFileId", "DriveFileId", "DriveUrl", "FileName", "MimeType", "Status", "Caption",
    "VerifiedAt", "VerifiedBy", "RejectedAt", "RejectedBy", "RejectionReason"
  ]);
  reports.appendRow([
    "LP-AUTH-001", "MANG-IYUS", "", new Date("2026-09-07T10:00:00Z"), "", "", "", "", "", "", "",
    "MENUNGGU_VERIFIKASI", "", "", "", "", "", ""
  ]);
  const sheets = { Users: users, ProductionReports: reports };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Array, Date, JSON, Math, Number, Object, RegExp, String, isFinite,
    USER_SHEET_NAME: "Users",
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_algorithm, value) => Array.from(createHash("sha256").update(String(value)).digest()),
      base64Encode: value => Buffer.from(value).toString("base64"),
      getUuid: () => randomUUID(),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: name => sheets[name] || null,
      insertSheet: name => { sheets[name] = new MemorySheet([]); return sheets[name]; }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    stockProductionRolePermissions: role => ["OWNER", "ADMIN"].includes(String(role).toUpperCase()) ? ["manage_production_queue"] : [],
  };
  vm.createContext(context);
  vm.runInContext(reportsSource, context);
  vm.runInContext(authSource, context);
  return { context, users, reports, sheets };
}

function userRow(sheet, email) {
  return sheet.rows.find(row => String(row[0]).toLowerCase() === email);
}

function sessionFor(fixture, email) {
  return fixture.context.stockProductionReportsCreateSession(email).sessionId;
}

function expectDenied(code, fn) {
  assert.throws(fn, error => error && error.code === code);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test("A. successful login issues a fresh ProductionReports sessionId", () => {
  const fixture = createFixture();
  vm.runInContext(codeSource, fixture.context);
  const passwordHash = fixture.context.hashPassword("correct-password");
  userRow(fixture.users, "admin@example.test")[2] = passwordHash;
  assert.equal(fixture.context.findUserRow(fixture.users, "admin@example.test").rowIndex, 3, JSON.stringify(fixture.users.getRange(2, 1, 4, 1).getValues()));
  assert.equal(fixture.users.getRange(3, 3).getValue(), passwordHash);
  const login = fixture.context.handleLogin({ email: "admin@example.test", password: "correct-password" });
  assert.equal(login.status, "success", JSON.stringify(login));
  assert.match(login.sessionId, /^prs_[0-9a-f]{64}$/);
  assert.equal(login.user.email, "admin@example.test");
  const sessionFixture = createFixture();
  const first = sessionFixture.context.stockProductionReportsCreateSession("admin@example.test");
  const second = sessionFixture.context.stockProductionReportsCreateSession("admin@example.test");
  assert.notEqual(first.sessionId, second.sessionId);
});

test("B-C. sessionId is opaque, stored only as a hash, and resolves server-side", () => {
  const fixture = createFixture();
  const sessionId = sessionFor(fixture, "admin@example.test");
  const stored = fixture.sheets.ProductionReportsSessions.rows[0];
  assert.match(sessionId, /^prs_[0-9a-f]{64}$/);
  assert.doesNotMatch(sessionId, /admin@example\.test|ADMIN|OWNER/i);
  assert.notEqual(stored[0], sessionId);
  assert.equal(stored[0], fixture.context.stockProductionReportsSessionHash(sessionId));
  assert.equal(fixture.context.stockProductionReportsResolveSession(sessionId).UserEmail, "admin@example.test");
});

test("D-E. expired and revoked sessions are rejected", () => {
  const fixture = createFixture();
  const expired = sessionFor(fixture, "admin@example.test");
  fixture.sheets.ProductionReportsSessions.rows[0][3] = new Date(Date.now() - 1);
  expectDenied("session_expired", () => fixture.context.resolveProductionReportsAdminActor(expired, {}));

  const revoked = sessionFor(fixture, "admin@example.test");
  assert.equal(fixture.context.stockProductionReportsRevokeSession(revoked), true);
  expectDenied("session_revoked", () => fixture.context.resolveProductionReportsAdminActor(revoked, {}));
});

test("F-G. OWNER and ADMIN can access ProductionReports", () => {
  const fixture = createFixture();
  ["owner@example.test", "admin@example.test"].forEach(email => {
    const result = fixture.context.stockProductionReportsAdminList({ sessionId: sessionFor(fixture, email), callerEmail: "staff@example.test" });
    assert.equal(result.status, "success");
    assert.equal(result.total, 1);
  });
});

test("H-I. STAFF and Konveksi sessions are denied", () => {
  const fixture = createFixture();
  ["staff@example.test", "konveksi@example.test"].forEach(email => {
    const result = fixture.context.stockProductionReportsAdminList({ sessionId: sessionFor(fixture, email) });
    assert.equal(result.status, "error");
    assert.equal(result.code, "production_reports_admin_required");
  });
});

test("J-L. callerEmail, role, and name spoofing cannot elevate a STAFF session", () => {
  const fixture = createFixture();
  const sessionId = sessionFor(fixture, "staff@example.test");
  const result = fixture.context.stockProductionReportsAdminList({
    sessionId, callerEmail: "owner@example.test", role: "OWNER", nama: "Owner"
  });
  assert.equal(result.status, "error");
  assert.equal(result.code, "production_reports_admin_required");
});

test("M. spoofed frontend currentUser is not an authority source", () => {
  const fixture = createFixture();
  const result = fixture.context.stockProductionReportsAdminList({
    sessionId: sessionFor(fixture, "staff@example.test"),
    currentUser: { email: "owner@example.test", role: "OWNER", nama: "Owner" }
  });
  assert.equal(result.status, "error");
  assert.equal(result.code, "production_reports_admin_required");
});

test("N-P. role downgrade, inactive user, and deleted user are denied after login", () => {
  const fixture = createFixture();
  const adminSession = sessionFor(fixture, "admin@example.test");
  userRow(fixture.users, "admin@example.test")[2] = "STAFF";
  expectDenied("production_reports_admin_required", () => fixture.context.resolveProductionReportsAdminActor(adminSession, {}));

  const inactiveSession = sessionFor(fixture, "owner@example.test");
  userRow(fixture.users, "owner@example.test")[3] = "NONAKTIF";
  expectDenied("session_user_inactive", () => fixture.context.resolveProductionReportsAdminActor(inactiveSession, {}));

  const deletedSession = sessionFor(fixture, "konveksi@example.test");
  fixture.users.rows = fixture.users.rows.filter(row => row[0] !== "konveksi@example.test");
  expectDenied("session_user_not_found", () => fixture.context.resolveProductionReportsAdminActor(deletedSession, {}));
});

test("Q-R. VerifiedBy and RejectedBy use only the resolved session actor", () => {
  const fixture = createFixture();
  const adminSession = sessionFor(fixture, "admin@example.test");
  const verified = fixture.context.stockProductionReportsAdminTransition({
    sessionId: adminSession, reportId: "LP-AUTH-001", targetStatus: "DIVERIFIKASI", callerEmail: "owner@example.test", role: "OWNER"
  });
  assert.equal(verified.status, "success");
  assert.equal(verified.report.VerifiedBy, "admin@example.test");

  fixture.reports.appendRow([
    "LP-AUTH-002", "MANG-IYUS", "", new Date(), "", "", "", "", "", "", "", "MENUNGGU_VERIFIKASI", "", "", "", "", "", ""
  ]);
  const rejected = fixture.context.stockProductionReportsAdminTransition({
    sessionId: adminSession, reportId: "LP-AUTH-002", targetStatus: "DITOLAK", rejectionReason: "Foto tidak jelas.", callerEmail: "owner@example.test"
  });
  assert.equal(rejected.status, "success");
  assert.equal(rejected.report.RejectedBy, "admin@example.test");
});

test("S-T. logout revokes the server-side session and the same token is denied", () => {
  assert.match(codeSource, /stockProductionReportsRevokeSession\(sessionId\)/);
  assert.match(frontendSource, /inventarisProductionReportsSession/);
  const fixture = createFixture();
  const sessionId = sessionFor(fixture, "admin@example.test");
  assert.equal(fixture.context.stockProductionReportsRevokeSession(sessionId), true);
  expectDenied("session_revoked", () => fixture.context.resolveProductionReportsAdminActor(sessionId, {}));
});

test("ProductionReports frontend sends a dedicated sessionId while legacy callerEmail remains outside this boundary", () => {
  assert.match(productionCenterSource, /const reportActions = \["getProductionReports", "getProductionReportDetail", "transitionProductionReport"\]/);
  assert.match(productionCenterSource, /requestPayload\.sessionId = typeof productionReportsSessionId/);
  assert.match(reportsSource, /resolveProductionReportsAdminActor\(\(data \|\| \{\}\)\.sessionId/);
  assert.doesNotMatch(authSource, /payload\.(?:callerEmail|role|nama|currentUser)/);
});

console.log(`Production Reports opaque-session integration: PASS (${passed} security tests)`);
