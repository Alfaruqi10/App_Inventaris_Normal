/**
 * AICache.js — ANSLA Inventory AI Engine
 * ========================================
 * Cache sederhana untuk respons AI.
 * Jika pertanyaan yang sama diajukan dalam window TTL, gunakan cache.
 * Tidak memanggil Gemini ulang. Menghemat kuota dan mempercepat respons.
 *
 * Implementasi: Map() in-memory. Data hilang saat refresh browser.
 * TTL default: 60 detik (dapat dikonfigurasi).
 *
 * @module AICache
 * @version 1.0.0
 */

import { AI_DEBUG } from "./AIConfig.js";

// ── KONFIGURASI ───────────────────────────────────────────────────────────────
/** TTL default dalam milidetik */
const DEFAULT_TTL_MS = 60_000; // 60 detik

/** Jumlah maksimal entry di cache */
const MAX_CACHE_SIZE = 100;

// ── STATE INTERNAL ────────────────────────────────────────────────────────────
/**
 * Cache store: key → { value, expiresAt, hits }
 * @type {Map<string, AICacheEntry>}
 */
const _cache = new Map();

// ── CACHE KEY BUILDER ─────────────────────────────────────────────────────────
/**
 * Bangun cache key dari pertanyaan dan page context.
 * Normalisasi: lowercase, trim, hilangkan spasi berlebih.
 *
 * @param {string} question   - Pertanyaan user
 * @param {string} [page=""]  - Halaman aktif (opsional, jadi bagian dari key)
 * @returns {string}
 */
export function buildCacheKey(question, page = "") {
    const normalized = question.toLowerCase().trim().replace(/\s+/g, " ");
    return `${page}::${normalized}`;
}

// ── GET ───────────────────────────────────────────────────────────────────────
/**
 * Ambil nilai dari cache jika masih valid.
 *
 * @param {string} key - Cache key (hasil buildCacheKey)
 * @returns {string|null} Nilai cache atau null jika tidak ada / sudah expired
 */
export function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        // Entry expired — hapus dan return null
        _cache.delete(key);
        if (AI_DEBUG) console.log(`[AICache] MISS (expired): ${key.slice(0, 60)}`);
        return null;
    }

    // Cache hit
    entry.hits++;
    if (AI_DEBUG) console.log(`[AICache] HIT (hits=${entry.hits}): ${key.slice(0, 60)}`);
    return entry.value;
}

// ── SET ───────────────────────────────────────────────────────────────────────
/**
 * Simpan nilai ke cache.
 *
 * @param {string} key        - Cache key
 * @param {string} value      - Nilai yang disimpan (teks respons AI)
 * @param {number} [ttlMs]    - TTL dalam ms (default: DEFAULT_TTL_MS)
 */
export function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
    // Evict entri tertua jika cache penuh (sederhana: hapus entry pertama)
    if (_cache.size >= MAX_CACHE_SIZE) {
        const firstKey = _cache.keys().next().value;
        _cache.delete(firstKey);
        if (AI_DEBUG) console.log(`[AICache] Evicted oldest entry.`);
    }

    /** @type {AICacheEntry} */
    const entry = {
        value,
        createdAt:  Date.now(),
        expiresAt:  Date.now() + ttlMs,
        ttlMs,
        hits: 0,
    };

    _cache.set(key, entry);
    if (AI_DEBUG) console.log(`[AICache] SET (ttl=${ttlMs}ms): ${key.slice(0, 60)}`);
}

// ── INVALIDATE ────────────────────────────────────────────────────────────────
/**
 * Hapus satu entry dari cache.
 * @param {string} key
 */
export function cacheDelete(key) {
    _cache.delete(key);
}

/**
 * Hapus semua entry yang sudah expired.
 * Jalankan secara periodik jika perlu (opsional).
 */
export function cachePurgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of _cache.entries()) {
        if (now > entry.expiresAt) {
            _cache.delete(key);
            purged++;
        }
    }
    if (AI_DEBUG && purged > 0) console.log(`[AICache] Purged ${purged} expired entries.`);
    return purged;
}

/**
 * Bersihkan seluruh cache.
 */
export function cacheClear() {
    _cache.clear();
    if (AI_DEBUG) console.log("[AICache] Cache cleared.");
}

// ── STATS ─────────────────────────────────────────────────────────────────────
/**
 * Statistik cache saat ini.
 * Digunakan oleh AIHealth.
 *
 * @returns {AICacheStats}
 */
export function getCacheStats() {
    const now      = Date.now();
    let active     = 0;
    let expired    = 0;
    let totalHits  = 0;

    for (const entry of _cache.values()) {
        if (now > entry.expiresAt) expired++;
        else active++;
        totalHits += entry.hits;
    }

    return {
        total:       _cache.size,
        active,
        expired,
        totalHits,
        maxSize:     MAX_CACHE_SIZE,
        defaultTtlMs: DEFAULT_TTL_MS,
    };
}

/**
 * @typedef {Object} AICacheEntry
 * @property {string}  value
 * @property {number}  createdAt
 * @property {number}  expiresAt
 * @property {number}  ttlMs
 * @property {number}  hits
 */

/**
 * @typedef {Object} AICacheStats
 * @property {number} total
 * @property {number} active
 * @property {number} expired
 * @property {number} totalHits
 * @property {number} maxSize
 * @property {number} defaultTtlMs
 */
