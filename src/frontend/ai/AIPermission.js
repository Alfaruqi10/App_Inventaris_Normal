/**
 * AIPermission.js — ANSLA Inventory AI Engine
 * ==============================================
 * Sistem izin AI berbasis role user.
 * AI mengikuti role yang sudah ada di aplikasi: Admin dan Kasir.
 * Setiap intent memiliki daftar role yang diizinkan.
 *
 * Jika user tidak memiliki izin, AI TIDAK memanggil Gemini.
 * AI mengembalikan pesan penolakan yang informatif.
 *
 * @module AIPermission
 * @version 1.0.0
 */

import { AI_DEBUG } from "./AIConfig.js";

// ── DEFINISI ROLE ─────────────────────────────────────────────────────────────
/** Daftar role yang valid dalam sistem ANSLA */
export const ROLES = {
    ADMIN:  "Admin",
    KASIR:  "Kasir",
};

// ── PERMISSION MAP ────────────────────────────────────────────────────────────
/**
 * Pemetaan intent → role yang diizinkan.
 * Format: intent (string) → array of role yang boleh mengakses.
 *
 * Intent yang tidak terdaftar di sini → SEMUA role diizinkan (default allow).
 *
 * @type {Record<string, string[]>}
 */
const INTENT_PERMISSIONS = {
    // ── Hanya Admin ───────────────────────────────────────────────────────────
    forecast:          [ROLES.ADMIN],
    analysis:          [ROLES.ADMIN],
    dailySummary:      [ROLES.ADMIN],
    mappingSummary:    [ROLES.ADMIN],
    pendingOrders:     [ROLES.ADMIN],

    // ── Admin dan Kasir ───────────────────────────────────────────────────────
    findProduct:       [ROLES.ADMIN, ROLES.KASIR],
    findSKU:           [ROLES.ADMIN, ROLES.KASIR],
    stockSummary:      [ROLES.ADMIN, ROLES.KASIR],
    recentTransactions:[ROLES.ADMIN, ROLES.KASIR],
    generalQuestion:   [ROLES.ADMIN, ROLES.KASIR],

    // ── Default (semua yang tidak terdaftar) ─────────────────────────────────
    // Ditangani oleh logic _defaultAllow di bawah
};

/**
 * Pesan penolakan per kategori akses.
 * Jika intent tertentu membutuhkan role Admin, gunakan pesan ini.
 */
const DENIAL_MESSAGES = {
    forecast:       "Fitur Forecast hanya tersedia untuk Admin. Hubungi Admin untuk informasi ini.",
    analysis:       "Fitur Analisa mendalam hanya tersedia untuk Admin.",
    dailySummary:   "Ringkasan harian hanya dapat diakses oleh Admin.",
    mappingSummary: "Informasi Mapping Shopee hanya tersedia untuk Admin.",
    pendingOrders:  "Data pesanan pending hanya dapat dilihat oleh Admin.",
    default:        "Fitur ini tidak tersedia untuk role Anda. Silakan hubungi Admin.",
};

// ── PERMISSION CHECKER ────────────────────────────────────────────────────────

/**
 * Periksa apakah user dengan role tertentu diizinkan untuk intent ini.
 *
 * @param {string} intent   - Intent yang terdeteksi
 * @param {string} userRole - Role user ("Admin" | "Kasir" | null)
 * @returns {PermissionResult}
 */
export function checkPermission(intent, userRole) {
    const role = normalizeRole(userRole);

    // Jika tidak login, izinkan hanya findProduct dan findSKU
    if (!role) {
        const publicIntents = ["findProduct", "findSKU"];
        if (publicIntents.includes(intent)) {
            return { allowed: true, role: null, intent };
        }
        return {
            allowed: false,
            role:    null,
            intent,
            reason:  "Anda harus login untuk menggunakan fitur AI.",
        };
    }

    // Jika Admin, selalu diizinkan
    if (role === ROLES.ADMIN) {
        return { allowed: true, role, intent };
    }

    // Cek permission map
    const allowed = INTENT_PERMISSIONS[intent];
    if (!allowed) {
        // Intent tidak terdaftar → default allow untuk semua role yang login
        return { allowed: true, role, intent };
    }

    if (allowed.includes(role)) {
        if (AI_DEBUG) console.log(`[AIPermission] ALLOWED: role=${role}, intent=${intent}`);
        return { allowed: true, role, intent };
    }

    // Akses ditolak
    const reason = DENIAL_MESSAGES[intent] || DENIAL_MESSAGES.default;
    if (AI_DEBUG) console.warn(`[AIPermission] DENIED: role=${role}, intent=${intent}`);

    return {
        allowed: false,
        role,
        intent,
        reason,
    };
}

/**
 * Ambil daftar intent yang diizinkan untuk role tertentu.
 * Berguna untuk menampilkan quick actions yang relevan.
 *
 * @param {string} userRole
 * @returns {string[]}
 */
export function getAllowedIntents(userRole) {
    const role = normalizeRole(userRole);
    if (!role) return ["findProduct", "findSKU"];
    if (role === ROLES.ADMIN) return Object.keys(INTENT_PERMISSIONS);

    return Object.entries(INTENT_PERMISSIONS)
        .filter(([, roles]) => roles.includes(role))
        .map(([intent]) => intent);
}

/**
 * Normalisasi role string dari aplikasi.
 * @param {string|null} role
 * @returns {string|null}
 */
function normalizeRole(role) {
    if (!role) return null;
    const r = String(role).trim();
    if (r === ROLES.ADMIN) return ROLES.ADMIN;
    if (r === ROLES.KASIR) return ROLES.KASIR;
    // Fallback untuk variasi capitalization
    if (r.toLowerCase() === "admin") return ROLES.ADMIN;
    if (r.toLowerCase() === "kasir") return ROLES.KASIR;
    return null; // role tidak dikenal
}

/**
 * Ambil role user aktif dari window.currentUser (helper).
 * @returns {string|null}
 */
export function getCurrentUserRole() {
    const user = (typeof window !== "undefined") ? window.currentUser : null;
    return user?.role ?? null;
}

/**
 * @typedef {Object} PermissionResult
 * @property {boolean}      allowed  - true jika akses diizinkan
 * @property {string|null}  role     - Role user yang diperiksa
 * @property {string}       intent   - Intent yang diperiksa
 * @property {string}       [reason] - Alasan penolakan (jika allowed=false)
 */
