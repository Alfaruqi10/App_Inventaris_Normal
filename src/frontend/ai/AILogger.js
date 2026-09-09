/**
 * AILogger.js — ANSLA Inventory AI Engine
 * ==========================================
 * Mencatat semua aktivitas request AI ke in-memory log.
 * Dapat diaktifkan/dimatikan melalui AI_LOGGING di AIConfig.
 * Tidak menulis ke server. Tidak mengubah data apapun.
 *
 * @module AILogger
 * @version 1.0.0
 */

import { AI_DEBUG, AI_PROVIDER, AI_MODEL } from "./AIConfig.js";

// ── KONSTANTA ─────────────────────────────────────────────────────────────────
/** Jumlah maksimal log yang disimpan di memory (FIFO) */
const MAX_LOG_ENTRIES = 200;

// ── STATE INTERNAL ────────────────────────────────────────────────────────────
/** @type {AILogEntry[]} */
const _logs = [];

// ── ESTIMASI TOKEN (sederhana) ────────────────────────────────────────────────
/**
 * Estimasi kasar jumlah token dari teks.
 * Asumsi: ~4 karakter = 1 token (standar umum LLM).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    return Math.ceil((text || "").length / 4);
}

// ── LOGGER ────────────────────────────────────────────────────────────────────

/**
 * Catat satu request AI ke log.
 *
 * @param {object} entry
 * @param {string}  entry.question       - Pertanyaan user
 * @param {string}  entry.intent         - Intent yang terdeteksi router
 * @param {boolean} entry.usedCache      - Apakah jawaban dari cache
 * @param {boolean} entry.calledAI       - Apakah Gemini dipanggil
 * @param {boolean} entry.success        - Apakah berhasil
 * @param {number}  entry.durationMs     - Durasi total (ms)
 * @param {string}  [entry.responseText] - Teks jawaban (digunakan untuk estimasi)
 * @param {string}  [entry.contextText]  - Teks context yang dikirim ke AI
 * @param {string}  [entry.error]        - Pesan error jika gagal
 * @param {string}  [entry.currentPage]  - Halaman aktif saat request
 * @param {string}  [entry.userRole]     - Role user yang bertanya
 * @param {string}  [entry.modelUsed]    - Model Gemini yang akhirnya dipakai
 * @param {number}  [entry.retryCount]   - Total percobaan yang dilakukan
 * @param {boolean} [entry.fallbackOccurred] - Apakah terjadi fallback ke model lain
 */
export function logRequest({
    question         = "",
    intent           = "unknown",
    usedCache        = false,
    calledAI         = false,
    success          = false,
    durationMs       = 0,
    responseText     = "",
    contextText      = "",
    error            = "",
    currentPage      = "-",
    userRole         = "-",
    modelUsed        = "-",
    retryCount       = 0,
    fallbackOccurred = false,
} = {}) {
    /** @type {AILogEntry} */
    const entry = {
        id:              `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp:       new Date().toISOString(),
        provider:        AI_PROVIDER,
        model:           modelUsed || AI_MODEL,   // model yang benar-benar dipakai
        question:        question.slice(0, 300),
        intent,
        currentPage,
        userRole,
        usedCache,
        calledAI,
        retryCount,
        fallbackOccurred,
        success,
        durationMs,
        responseLength:  responseText.length,
        contextSize:     contextText.length,
        tokenEstimate:   estimateTokens(question) + estimateTokens(contextText),
        error:           error.slice(0, 200),
    };

    // FIFO: hapus entry tertua jika melebihi batas
    if (_logs.length >= MAX_LOG_ENTRIES) {
        _logs.shift();
    }
    _logs.push(entry);

    if (AI_DEBUG) {
        const status = success ? "✓" : "✗";
        const src    = usedCache ? "[CACHE]" : calledAI ? "[AI]" : "[TOOL]";
        console.log(
            `[AILogger] ${status} ${src} ${intent} | ${durationMs}ms | "${question.slice(0, 60)}..."`
        );
        if (error) console.warn(`[AILogger] Error: ${error}`);
    }
}

/**
 * Ambil semua log (read-only copy).
 * @returns {AILogEntry[]}
 */
export function getLogs() {
    return [..._logs];
}

/**
 * Ambil N log terbaru.
 * @param {number} [n=50]
 * @returns {AILogEntry[]}
 */
export function getRecentLogs(n = 50) {
    return _logs.slice(-n).reverse();
}

/**
 * Bersihkan semua log.
 */
export function clearLogs() {
    _logs.length = 0;
    if (AI_DEBUG) console.log("[AILogger] Logs cleared.");
}

/**
 * Hitung statistik agregat dari log.
 * Digunakan oleh AIHealth.
 *
 * @returns {AILogStats}
 */
export function getLogStats() {
    if (_logs.length === 0) {
        return {
            total: 0, success: 0, failed: 0,
            cacheHits: 0, cacheMisses: 0,
            aiCalls: 0, toolCalls: 0,
            avgDurationMs: 0,
            successRate: 0,
            errorCount: 0,
        };
    }

    const total       = _logs.length;
    const success     = _logs.filter(l => l.success).length;
    const failed      = total - success;
    const cacheHits   = _logs.filter(l => l.usedCache).length;
    const cacheMisses = total - cacheHits;
    const aiCalls     = _logs.filter(l => l.calledAI).length;
    const toolCalls   = _logs.filter(l => !l.calledAI && !l.usedCache).length;
    const totalDur    = _logs.reduce((s, l) => s + (l.durationMs || 0), 0);
    const errorCount  = _logs.filter(l => l.error).length;

    return {
        total,
        success,
        failed,
        cacheHits,
        cacheMisses,
        aiCalls,
        toolCalls,
        avgDurationMs: Math.round(totalDur / total),
        successRate:   Math.round((success / total) * 100),
        errorCount,
    };
}

/**
 * @typedef {Object} AILogEntry
 * @property {string}  id
 * @property {string}  timestamp
 * @property {string}  provider
 * @property {string}  model             - Model yang benar-benar dipakai (bukan model default)
 * @property {string}  question
 * @property {string}  intent
 * @property {string}  currentPage
 * @property {string}  userRole
 * @property {boolean} usedCache
 * @property {boolean} calledAI
 * @property {boolean} success
 * @property {number}  durationMs
 * @property {number}  responseLength
 * @property {number}  contextSize
 * @property {number}  tokenEstimate
 * @property {string}  error
 * @property {number}  retryCount        - Total percobaan (termasuk fallback)
 * @property {boolean} fallbackOccurred  - true jika ada fallback ke model lain
 */

/**
 * @typedef {Object} AILogStats
 * @property {number} total
 * @property {number} success
 * @property {number} failed
 * @property {number} cacheHits
 * @property {number} cacheMisses
 * @property {number} aiCalls
 * @property {number} toolCalls
 * @property {number} avgDurationMs
 * @property {number} successRate
 * @property {number} errorCount
 */
