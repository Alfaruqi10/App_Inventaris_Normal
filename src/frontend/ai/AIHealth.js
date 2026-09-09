/**
 * AIHealth.js — ANSLA Inventory AI Engine
 * ==========================================
 * Monitor status dan kesehatan AI Engine.
 * Mengembalikan plain JavaScript object — tidak ada UI, tidak ada DOM.
 * Digunakan oleh developer atau integrasi monitoring masa depan.
 *
 * @module AIHealth
 * @version 1.0.0
 */

import { AI_PROVIDER, AI_MODEL, AI_TIMEOUT, GEMINI_MODELS } from "./AIConfig.js";
import { getLogStats }                        from "./AILogger.js";
import { getCacheStats }                      from "./AICache.js";
import { listTools }                          from "./AIToolRegistry.js";

// ── STATE INTERNAL ────────────────────────────────────────────────────────────
const _health = {
    /** Waktu inisialisasi engine */
    startedAt:       new Date().toISOString(),
    /** Timestamp request terakhir */
    lastRequestAt:   null,
    /** Status konektivitas (null = belum dicek, true = ok, false = error) */
    providerStatus:  null,
    /** Pesan error terakhir */
    lastError:       null,
    /** Status per model Gemini — diisi oleh checkModels() dan updateModelStatus() */
    modelStatuses:   Object.fromEntries(
        (GEMINI_MODELS ?? []).map(m => [m, { status: "pending", latencyMs: null, lastChecked: null }])
    ),
    /** Model Gemini yang terakhir berhasil digunakan */
    lastModelUsed:   null,
};

// ── UPDATE DARI AISERVICE ─────────────────────────────────────────────────────

/**
 * Catat bahwa request berhasil dikirim ke AI.
 * Dipanggil oleh AIService setelah Gemini berhasil menjawab.
 * @param {string} [modelUsed] - Nama model yang berhasil
 */
export function recordSuccess(modelUsed) {
    _health.lastRequestAt  = new Date().toISOString();
    _health.providerStatus = true;
    _health.lastError      = null;
    if (modelUsed) _health.lastModelUsed = modelUsed;
}

/**
 * Catat error dari provider AI.
 * Dipanggil oleh AIService jika semua model gagal.
 *
 * @param {string} errorMessage
 * @param {string} [modelUsed]
 */
export function recordError(errorMessage, modelUsed) {
    _health.lastRequestAt  = new Date().toISOString();
    _health.providerStatus = false;
    _health.lastError      = String(errorMessage || "Unknown error");
    if (modelUsed) _health.lastModelUsed = modelUsed;
}

/**
 * Update status satu model Gemini.
 * Dipanggil oleh AIService.checkModels().
 *
 * @param {string}      model     - Nama model
 * @param {string}      status    - "READY" | "BUSY" | "UNAVAILABLE" | "QUOTA_EXCEEDED"
 * @param {number|null} latencyMs - Latensi dalam ms (null jika gagal)
 */
export function updateModelStatus(model, status, latencyMs) {
    if (!_health.modelStatuses[model]) _health.modelStatuses[model] = {};
    _health.modelStatuses[model] = {
        status,
        latencyMs: latencyMs ?? null,
        lastChecked: new Date().toISOString(),
    };
}

// ── HEALTH REPORT ─────────────────────────────────────────────────────────────

/**
 * Ambil laporan kesehatan AI Engine lengkap.
 * Semua data diambil dari modul-modul AI lainnya — tidak memanggil API.
 *
 * @returns {AIHealthReport}
 */
export function getHealthReport() {
    const logStats   = getLogStats();
    const cacheStats = getCacheStats();
    const tools      = listTools();
    const now        = new Date();

    // Hitung uptime
    const startMs  = new Date(_health.startedAt).getTime();
    const uptimeSec = Math.floor((now.getTime() - startMs) / 1000);

    return /** @type {AIHealthReport} */ ({
        // ── Info Engine ───────────────────────────────────────────────────
        provider:        AI_PROVIDER,
        model:           AI_MODEL,
        timeoutMs:       AI_TIMEOUT,
        startedAt:       _health.startedAt,
        uptimeSeconds:   uptimeSec,
        reportedAt:      now.toISOString(),

        // ── Status Provider ───────────────────────────────────────────────
        providerStatus:  _health.providerStatus === null
            ? "pending"
            : _health.providerStatus
                ? "connected"
                : "error",
        lastRequestAt:   _health.lastRequestAt,
        lastError:       _health.lastError,
        lastModelUsed:   _health.lastModelUsed,

        // ── Status per Model Gemini ───────────────────────────────────────
        modelStatuses:   { ..._health.modelStatuses },

        // ── Statistik Request ─────────────────────────────────────────────
        requests: {
            total:        logStats.total,
            success:      logStats.success,
            failed:       logStats.failed,
            successRate:  logStats.successRate,  // %
            aiCalls:      logStats.aiCalls,
            toolCalls:    logStats.toolCalls,
            avgDurationMs: logStats.avgDurationMs,
            errorCount:   logStats.errorCount,
        },

        // ── Cache ─────────────────────────────────────────────────────────
        cache: {
            hits:        logStats.cacheHits,
            misses:      logStats.cacheMisses,
            hitRate:     logStats.total > 0
                ? Math.round((logStats.cacheHits / logStats.total) * 100)
                : 0,
            activeEntries: cacheStats.active,
            expiredEntries: cacheStats.expired,
            totalEntries:  cacheStats.total,
            maxSize:       cacheStats.maxSize,
        },

        // ── Tool Registry ─────────────────────────────────────────────────
        toolRegistry: {
            totalTools:   tools.length,
            tools:        tools.map(t => ({
                name:    t.name,
                intent:  t.intent,
                roles:   t.roles,
            })),
        },

        // ── Data Readiness ────────────────────────────────────────────────
        // Cek apakah data aplikasi sudah dimuat
        dataReadiness: _checkDataReadiness(),
    });
}

/**
 * Ringkasan singkat status engine (untuk logging cepat).
 * @returns {string}
 */
export function getStatusSummary() {
    const report = getHealthReport();
    const status = report.providerStatus;
    const sr     = report.requests.successRate;
    const total  = report.requests.total;
    return `[AIHealth] provider=${report.provider}/${report.model} status=${status} requests=${total} successRate=${sr}% uptime=${report.uptimeSeconds}s`;
}

// ── PRIVATE ───────────────────────────────────────────────────────────────────

/**
 * Periksa apakah variabel data aplikasi sudah dimuat.
 * Tidak mengubah data apapun.
 *
 * @returns {object}
 */
function _checkDataReadiness() {
    const g = (key) => typeof window !== "undefined" ? window[key] : undefined;

    return {
        masterData:        Array.isArray(g("masterData"))            && g("masterData").length > 0,
        transactionData:   Array.isArray(g("transactionData"))       && g("transactionData").length > 0,
        // shopeeOrdersFullData adalah variabel aktif; shopeeOrdersData adalah legacy kosong
        shopeeOrdersData:  (Array.isArray(g("shopeeOrdersFullData")) && g("shopeeOrdersFullData").length > 0)
                        || (Array.isArray(g("shopeeOrdersData"))     && g("shopeeOrdersData").length > 0),
        shopeeMappingData: Array.isArray(g("shopeeMappingData"))     && g("shopeeMappingData").length > 0,
        currentUser:      !!g("currentUser"),
    };
}

/**
 * @typedef {Object} AIHealthReport
 * @property {string}  provider
 * @property {string}  model
 * @property {number}  timeoutMs
 * @property {string}  startedAt
 * @property {number}  uptimeSeconds
 * @property {string}  reportedAt
 * @property {string}  providerStatus  - "pending" | "connected" | "error"
 * @property {string|null} lastRequestAt
 * @property {string|null} lastError
 * @property {object}  requests
 * @property {object}  cache
 * @property {object}  toolRegistry
 * @property {object}  dataReadiness
 */
