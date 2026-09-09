// ============================================================
// ProductionReports admin session boundary.
// This is intentionally scoped to ProductionReports and does not
// replace legacy callerEmail authorization used by other modules.
// ============================================================

var PRODUCTION_REPORTS_SESSION_SHEET = "ProductionReportsSessions";
var PRODUCTION_REPORTS_SESSION_HEADERS = ["SessionHash", "UserEmail", "CreatedAt", "ExpiresAt", "RevokedAt"];
var PRODUCTION_REPORTS_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function stockProductionReportsAuthText(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function stockProductionReportsAuthError(code, message) {
  var error = new Error(message || code);
  error.code = code;
  return error;
}

function stockProductionReportsSessionHash(sessionId) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stockProductionReportsAuthText(sessionId));
  return digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function stockProductionReportsNewSessionId() {
  // Two UUID values keep the token opaque and avoid embedding user identity.
  return "prs_" + Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function stockProductionReportsSessionEnsureSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(PRODUCTION_REPORTS_SESSION_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PRODUCTION_REPORTS_SESSION_SHEET);
    sheet.getRange(1, 1, 1, PRODUCTION_REPORTS_SESSION_HEADERS.length).setValues([PRODUCTION_REPORTS_SESSION_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, PRODUCTION_REPORTS_SESSION_HEADERS.length).setValues([PRODUCTION_REPORTS_SESSION_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionReportsAuthText);
  var missing = PRODUCTION_REPORTS_SESSION_HEADERS.filter(function(header) { return headers.indexOf(header) < 0; });
  if (missing.length) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), missing.length);
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function stockProductionReportsSessionRows(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(stockProductionReportsAuthText);
  return values.slice(1).map(function(row, index) {
    var result = { _row: index + 2 };
    headers.forEach(function(header, column) { result[header] = row[column]; });
    return result;
  });
}

function stockProductionReportsCreateSession(userEmail) {
  var email = stockProductionReportsAuthText(userEmail).toLowerCase();
  if (!email) throw stockProductionReportsAuthError("session_user_required", "Sesi aman tidak dapat dibuat.");
  var sessionId = stockProductionReportsNewSessionId();
  var sessionHash = stockProductionReportsSessionHash(sessionId);
  var now = new Date();
  var expiresAt = new Date(now.getTime() + PRODUCTION_REPORTS_SESSION_TTL_MS);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw stockProductionReportsAuthError("session_lock_timeout", "Sesi aman sedang diproses. Silakan coba lagi.");
  try {
    var sheet = stockProductionReportsSessionEnsureSheet();
    sheet.appendRow([sessionHash, email, now, expiresAt, ""]);
    return { sessionId: sessionId, createdAt: now, expiresAt: expiresAt };
  } finally {
    lock.releaseLock();
  }
}

function stockProductionReportsResolveSession(sessionId) {
  var token = stockProductionReportsAuthText(sessionId);
  if (!token) throw stockProductionReportsAuthError("session_required", "Sesi laporan produksi diperlukan.");
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_REPORTS_SESSION_SHEET);
  if (!sheet) throw stockProductionReportsAuthError("session_not_found", "Sesi laporan produksi tidak ditemukan.");
  var tokenHash = stockProductionReportsSessionHash(token);
  var session = stockProductionReportsSessionRows(sheet).filter(function(row) {
    return stockProductionReportsAuthText(row.SessionHash) === tokenHash;
  })[0];
  if (!session) throw stockProductionReportsAuthError("session_not_found", "Sesi laporan produksi tidak ditemukan.");
  if (stockProductionReportsAuthText(session.RevokedAt)) throw stockProductionReportsAuthError("session_revoked", "Sesi laporan produksi telah berakhir.");
  var expiresAt = new Date(session.ExpiresAt).getTime();
  if (!isFinite(expiresAt) || expiresAt <= new Date().getTime()) throw stockProductionReportsAuthError("session_expired", "Sesi laporan produksi telah kedaluwarsa.");
  return session;
}

function stockProductionReportsRevokeSession(sessionId) {
  var token = stockProductionReportsAuthText(sessionId);
  if (!token) return false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTION_REPORTS_SESSION_SHEET);
    if (!sheet) return false;
    var tokenHash = stockProductionReportsSessionHash(token);
    var session = stockProductionReportsSessionRows(sheet).filter(function(row) {
      return stockProductionReportsAuthText(row.SessionHash) === tokenHash;
    })[0];
    if (!session || stockProductionReportsAuthText(session.RevokedAt)) return false;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(stockProductionReportsAuthText);
    var revokedAtColumn = headers.indexOf("RevokedAt") + 1;
    if (revokedAtColumn < 1) throw stockProductionReportsAuthError("session_schema_invalid", "Schema sesi laporan produksi tidak valid.");
    sheet.getRange(session._row, revokedAtColumn).setValue(new Date());
    return true;
  } finally {
    lock.releaseLock();
  }
}

function stockProductionReportsFindSessionUser(email) {
  var userEmail = stockProductionReportsAuthText(email).toLowerCase();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USER_SHEET_NAME || "Users");
  if (!sheet || sheet.getLastRow() < 2) throw stockProductionReportsAuthError("session_user_not_found", "Pengguna sesi tidak ditemukan.");
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(stockProductionReportsAuthText);
  var emailColumn = headers.indexOf("Email");
  if (emailColumn < 0) throw stockProductionReportsAuthError("session_user_not_found", "Pengguna sesi tidak ditemukan.");
  var roleColumn = headers.indexOf("Role");
  var nameColumn = headers.indexOf("Nama");
  var statusColumn = headers.indexOf("Status");
  var activeColumn = headers.indexOf("Aktif");
  var row = values.slice(1).filter(function(valuesRow) {
    return stockProductionReportsAuthText(valuesRow[emailColumn]).toLowerCase() === userEmail;
  })[0];
  if (!row) throw stockProductionReportsAuthError("session_user_not_found", "Pengguna sesi tidak ditemukan.");
  var status = statusColumn >= 0 ? stockProductionReportsAuthText(row[statusColumn]) : "";
  if (!status && activeColumn >= 0) status = stockProductionReportsAuthText(row[activeColumn]);
  var normalizedStatus = status.toUpperCase();
  var active = !normalizedStatus || normalizedStatus === "ACTIVE" || normalizedStatus === "AKTIF" || normalizedStatus === "TRUE" || normalizedStatus === "YA";
  if (!active) throw stockProductionReportsAuthError("session_user_inactive", "Akun pengguna tidak aktif.");
  return {
    email: userEmail,
    nama: nameColumn >= 0 ? stockProductionReportsAuthText(row[nameColumn]) : userEmail,
    role: roleColumn >= 0 ? stockProductionReportsAuthText(row[roleColumn]) : ""
  };
}

function resolveProductionReportsAdminActor(sessionId, payload) {
  // payload is intentionally accepted only for API-shape compatibility. Its identity fields are ignored.
  var session = stockProductionReportsResolveSession(sessionId);
  var user = stockProductionReportsFindSessionUser(session.UserEmail);
  var role = stockProductionReportsAuthText(user.role).toUpperCase();
  if (role !== "OWNER" && role !== "ADMIN") {
    throw stockProductionReportsAuthError("production_reports_admin_required", "Akses laporan produksi hanya untuk Owner atau Admin.");
  }
  var permissions = typeof stockProductionRolePermissions === "function" ? stockProductionRolePermissions(role) : [];
  return { email: user.email, nama: user.nama, name: user.nama, role: role, permissions: permissions };
}
