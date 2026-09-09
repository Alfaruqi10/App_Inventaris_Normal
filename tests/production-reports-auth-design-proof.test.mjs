import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

class MemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  createSession({ userEmail, now, ttlMs }) {
    const createdAt = Number(now);
    const expiresAt = createdAt + Number(ttlMs);
    const sessionId = "sess_" + randomBytes(32).toString("hex");
    const session = { sessionId, userEmail, createdAt, expiresAt, revoked: false };
    this.sessions.set(sessionId, session);
    return { ...session };
  }

  resolveSession(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    return session ? { ...session } : null;
  }

  revokeSession(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) return false;
    session.revoked = true;
    return true;
  }
}

function isSessionExpired(session, now) {
  return !session || Number(session.expiresAt) <= Number(now);
}

function createUsersRepository(users) {
  const entries = new Map(users.map(user => [user.email.toLowerCase(), { ...user }]));
  return {
    findByEmail(email) {
      const user = entries.get(String(email || "").toLowerCase());
      return user ? { ...user } : null;
    },
    update(email, changes) {
      const key = String(email || "").toLowerCase();
      const user = entries.get(key);
      if (!user) throw new Error("Mock user not found");
      entries.set(key, { ...user, ...changes });
    },
    remove(email) {
      entries.delete(String(email || "").toLowerCase());
    }
  };
}

function resolveProductionReportsAdminActor(sessionId, _payload, { sessionStore, usersRepository, now }) {
  if (!sessionId) throw new Error("session_required");
  const session = sessionStore.resolveSession(sessionId);
  if (!session) throw new Error("session_not_found");
  if (session.revoked) throw new Error("session_revoked");
  if (isSessionExpired(session, now)) throw new Error("session_expired");

  // The payload is deliberately not consulted for identity, role, or name.
  const user = usersRepository.findByEmail(session.userEmail);
  if (!user) throw new Error("session_user_not_found");
  if (!user.active) throw new Error("session_user_inactive");
  if (user.role !== "OWNER" && user.role !== "ADMIN") throw new Error("production_reports_admin_required");
  return { email: user.email, nama: user.nama, role: user.role };
}

function mockTransitionProductionReport(sessionId, payload, dependencies) {
  const actor = resolveProductionReportsAdminActor(sessionId, payload, dependencies);
  const report = dependencies.reports.get(String(payload.reportId || ""));
  if (!report) throw new Error("report_not_found");
  if (report.Status !== "MENUNGGU_VERIFIKASI") throw new Error("invalid_report_transition");
  if (payload.targetStatus !== "DIVERIFIKASI" && payload.targetStatus !== "DITOLAK") throw new Error("invalid_report_transition");
  if (payload.targetStatus === "DITOLAK" && !String(payload.rejectionReason || "").trim()) {
    throw new Error("rejection_reason_required");
  }

  const updated = { ...report, Status: payload.targetStatus };
  if (payload.targetStatus === "DIVERIFIKASI") {
    updated.VerifiedBy = actor.email;
    updated.VerifiedAt = dependencies.now;
  } else {
    updated.RejectedBy = actor.email;
    updated.RejectedAt = dependencies.now;
    updated.RejectionReason = String(payload.rejectionReason).trim();
  }
  dependencies.reports.set(updated.ReportID, updated);
  return { actor, report: { ...updated } };
}

const NOW = Date.UTC(2026, 8, 7, 10, 0, 0);
const TTL_MS = 60 * 60 * 1000;

function createFixture() {
  const sessionStore = new MemorySessionStore();
  const usersRepository = createUsersRepository([
    { email: "owner@example.test", nama: "Owner", role: "OWNER", active: true },
    { email: "admin@example.test", nama: "Admin", role: "ADMIN", active: true },
    { email: "staff@example.test", nama: "Staff", role: "STAFF", active: true },
    { email: "konveksi@example.test", nama: "Mang Iyus", role: "KONVEKSI", active: true },
    { email: "inactive@example.test", nama: "Inactive", role: "ADMIN", active: false }
  ]);
  const reports = new Map();
  return {
    sessionStore,
    usersRepository,
    reports,
    now: NOW,
    createSession(userEmail, overrides = {}) {
      return sessionStore.createSession({ userEmail, now: NOW, ttlMs: TTL_MS, ...overrides });
    },
    dependencies() {
      return { sessionStore, usersRepository, reports, now: NOW };
    }
  };
}

function seedPendingReport(fixture, reportId = "LP-DESIGN-PROOF-001") {
  fixture.reports.set(reportId, {
    ReportID: reportId,
    Status: "MENUNGGU_VERIFIKASI",
    VerifiedAt: "",
    VerifiedBy: "",
    RejectedAt: "",
    RejectedBy: "",
    RejectionReason: ""
  });
  return reportId;
}

function expectDenied(expectedCode, fn) {
  assert.throws(fn, error => error && error.message === expectedCode);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test("A. valid OWNER session is allowed", () => {
  const fixture = createFixture();
  const actor = resolveProductionReportsAdminActor(fixture.createSession("owner@example.test").sessionId, {}, fixture.dependencies());
  assert.deepEqual(actor, { email: "owner@example.test", nama: "Owner", role: "OWNER" });
});

test("B. valid ADMIN session is allowed", () => {
  const fixture = createFixture();
  const actor = resolveProductionReportsAdminActor(fixture.createSession("admin@example.test").sessionId, {}, fixture.dependencies());
  assert.equal(actor.email, "admin@example.test");
  assert.equal(actor.role, "ADMIN");
});

test("C. valid STAFF session is denied", () => {
  const fixture = createFixture();
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(fixture.createSession("staff@example.test").sessionId, {}, fixture.dependencies()));
});

test("D. valid Konveksi session is denied", () => {
  const fixture = createFixture();
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(fixture.createSession("konveksi@example.test").sessionId, {}, fixture.dependencies()));
});

test("E. missing session is denied", () => {
  const fixture = createFixture();
  expectDenied("session_required", () => resolveProductionReportsAdminActor("", {}, fixture.dependencies()));
});

test("F. expired session is denied", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test", { ttlMs: -1 });
  expectDenied("session_expired", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("G. revoked session is denied", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test");
  assert.equal(fixture.sessionStore.revokeSession(session.sessionId), true);
  expectDenied("session_revoked", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("H. spoofed callerEmail cannot elevate a STAFF session", () => {
  const fixture = createFixture();
  const session = fixture.createSession("staff@example.test");
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(session.sessionId, { callerEmail: "owner@example.test" }, fixture.dependencies()));
});

test("I. spoofed role cannot elevate a STAFF session", () => {
  const fixture = createFixture();
  const session = fixture.createSession("staff@example.test");
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(session.sessionId, { role: "OWNER", nama: "Owner" }, fixture.dependencies()));
});

test("J. verification and rejection attribution always use the resolved actor", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test");
  const verifiedId = seedPendingReport(fixture, "LP-VERIFY-001");
  const verified = mockTransitionProductionReport(session.sessionId, {
    reportId: verifiedId, targetStatus: "DIVERIFIKASI", callerEmail: "owner@example.test", role: "OWNER"
  }, fixture.dependencies());
  assert.equal(verified.actor.email, "admin@example.test");
  assert.equal(verified.report.VerifiedBy, "admin@example.test");

  const rejectedId = seedPendingReport(fixture, "LP-REJECT-001");
  const rejected = mockTransitionProductionReport(session.sessionId, {
    reportId: rejectedId, targetStatus: "DITOLAK", rejectionReason: "Foto tidak lengkap.", callerEmail: "owner@example.test"
  }, fixture.dependencies());
  assert.equal(rejected.report.RejectedBy, "admin@example.test");
  assert.equal(rejected.report.RejectionReason, "Foto tidak lengkap.");
});

test("empty and random unknown session IDs are denied", () => {
  const fixture = createFixture();
  expectDenied("session_required", () => resolveProductionReportsAdminActor(null, {}, fixture.dependencies()));
  expectDenied("session_not_found", () => resolveProductionReportsAdminActor("sess_not_in_store", {}, fixture.dependencies()));
});

test("deleted session user is denied", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test");
  fixture.usersRepository.remove("admin@example.test");
  expectDenied("session_user_not_found", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("inactive session user is denied", () => {
  const fixture = createFixture();
  const session = fixture.createSession("inactive@example.test");
  expectDenied("session_user_inactive", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("a valid session is denied after its ADMIN role changes to STAFF", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test");
  fixture.usersRepository.update("admin@example.test", { role: "STAFF" });
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("a valid session is denied after its OWNER role changes to STAFF", () => {
  const fixture = createFixture();
  const session = fixture.createSession("owner@example.test");
  fixture.usersRepository.update("owner@example.test", { role: "STAFF" });
  expectDenied("production_reports_admin_required", () => resolveProductionReportsAdminActor(session.sessionId, {}, fixture.dependencies()));
});

test("an ADMIN remains the actor when payload claims OWNER", () => {
  const fixture = createFixture();
  const session = fixture.createSession("admin@example.test");
  const actor = resolveProductionReportsAdminActor(session.sessionId, {
    callerEmail: "owner@example.test", role: "OWNER", nama: "Owner"
  }, fixture.dependencies());
  assert.deepEqual(actor, { email: "admin@example.test", nama: "Admin", role: "ADMIN" });
});

test("sessions are opaque, distinct, and retain only an identity reference server-side", () => {
  const fixture = createFixture();
  const first = fixture.createSession("admin@example.test");
  const second = fixture.createSession("admin@example.test");
  assert.notEqual(first.sessionId, second.sessionId);
  assert.match(first.sessionId, /^sess_[0-9a-f]{64}$/);
  assert.doesNotMatch(first.sessionId, /admin@example\.test|ADMIN|OWNER/i);
  assert.deepEqual(Object.keys(first).sort(), ["createdAt", "expiresAt", "revoked", "sessionId", "userEmail"].sort());
  assert.equal(first.userEmail, "admin@example.test");
});

test("revoked and expired sessions cannot mutate the mocked report", () => {
  const fixture = createFixture();
  const reportId = seedPendingReport(fixture);
  const revoked = fixture.createSession("admin@example.test");
  fixture.sessionStore.revokeSession(revoked.sessionId);
  expectDenied("session_revoked", () => mockTransitionProductionReport(revoked.sessionId, { reportId, targetStatus: "DIVERIFIKASI" }, fixture.dependencies()));
  assert.equal(fixture.reports.get(reportId).Status, "MENUNGGU_VERIFIKASI");

  const expired = fixture.createSession("admin@example.test", { ttlMs: -1 });
  expectDenied("session_expired", () => mockTransitionProductionReport(expired.sessionId, { reportId, targetStatus: "DIVERIFIKASI" }, fixture.dependencies()));
  assert.equal(fixture.reports.get(reportId).Status, "MENUNGGU_VERIFIKASI");
});

test("mock transition rejects invalid lifecycle transitions without changing the report", () => {
  const fixture = createFixture();
  const reportId = seedPendingReport(fixture);
  const session = fixture.createSession("admin@example.test");
  expectDenied("invalid_report_transition", () => mockTransitionProductionReport(session.sessionId, { reportId, targetStatus: "COMPLETED" }, fixture.dependencies()));
  assert.equal(fixture.reports.get(reportId).Status, "MENUNGGU_VERIFIKASI");
});

console.log(`Production Reports auth design proof: PASS (${passed} in-memory security tests)`);
