/**
 * AIRouter.js — ANSLA Inventory AI Engine
 * ==========================================
 * Router menentukan strategi jawaban berdasarkan intent pertanyaan.
 *
 * Strategi:
 *   TOOL_ONLY  → Jawab langsung dari AITools (tanpa memanggil Gemini)
 *   AI_WITH_CONTEXT → Bangun context + kirim ke Gemini
 *
 * Intent classifier menggunakan keyword matching berbasis aturan.
 * Tidak memerlukan model ML — cukup untuk domain inventaris yang terbatas.
 *
 * @module AIRouter
 * @version 1.0.0
 */

import { AI_DEBUG } from "./AIConfig.js";
import { getToolByIntent, executeTool } from "./AIToolRegistry.js";

// ── STRATEGI ROUTING ──────────────────────────────────────────────────────────
/** @enum {string} */
export const ROUTE_STRATEGY = {
    TOOL_ONLY:        "TOOL_ONLY",       // Jawab dengan tool lokal, tanpa AI
    AI_WITH_CONTEXT:  "AI_WITH_CONTEXT", // Kirim ke Gemini dengan context
};

// ── INTENT CLASSIFIER ─────────────────────────────────────────────────────────
/**
 * Daftar intent beserta keyword pemicunya.
 * Urutan penting — lebih spesifik di atas, lebih general di bawah.
 *
 * @type {IntentRule[]}
 */
const INTENT_RULES = [
    // ── TOOL_ONLY intents ─────────────────────────────────────────────────────
    {
        intent:   "findSKU",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["sku", "kode barang", "kode produk", "cari sku", "temukan sku"],
        extract:  (q) => _extractAfterKeyword(q, ["sku", "kode barang", "kode produk", "cari sku"]),
    },
    {
        intent:   "findProduct",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["cari produk", "cari barang", "temukan produk", "ada produk", "stok", "berapa stok",
                   "stok produk", "stok barang", "info produk", "detail produk"],
        extract:  (q) => _extractSearchQuery(q),
    },
    {
        intent:   "stockSummary",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["ringkasan stok", "summary stok", "kondisi stok", "status stok",
                   "produk habis", "produk menipis", "stok kritis", "stok habis",
                   "perlu restock", "harus restock", "restock apa"],
    },
    {
        intent:   "recentTransactions",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["transaksi terakhir", "transaksi terbaru", "riwayat transaksi",
                   "history transaksi", "transaksi hari ini", "masuk hari ini",
                   "keluar hari ini", "barang masuk tadi", "barang keluar tadi"],
    },
    {
        intent:   "pendingOrders",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["pesanan pending", "order pending", "menunggu approve", "waiting approval",
                   "pesanan belum diproses", "approve order", "pesanan shopee pending"],
    },
    {
        intent:   "mappingSummary",
        strategy: ROUTE_STRATEGY.TOOL_ONLY,
        keywords: ["mapping shopee", "status mapping", "belum mapping", "sudah mapping",
                   "ringkasan mapping", "mapping produk"],
    },

    // ── AI_WITH_CONTEXT intents ───────────────────────────────────────────────
    {
        intent:   "dailySummary",
        strategy: ROUTE_STRATEGY.AI_WITH_CONTEXT,
        keywords: ["ringkasan hari ini", "summary hari ini", "laporan hari ini",
                   "apa yang terjadi hari ini", "aktivitas hari ini",
                   "yang harus dikerjakan", "apa yang harus saya kerjakan",
                   "prioritas hari ini", "agenda hari ini"],
    },
    {
        intent:   "analysis",
        strategy: ROUTE_STRATEGY.AI_WITH_CONTEXT,
        keywords: ["analisa", "analisis", "rekomendasi", "saran", "prediksi",
                   "tren", "trend", "paling laris", "paling banyak", "paling sedikit",
                   "tidak laku", "slow moving", "fast moving", "performa produk",
                   "produk terbaik", "produk terburuk"],
    },
    {
        intent:   "forecast",
        strategy: ROUTE_STRATEGY.AI_WITH_CONTEXT,
        keywords: ["forecast", "prediksi stok", "estimasi", "perkiraan",
                   "minggu depan", "bulan depan", "perlu berapa", "butuh berapa"],
    },
    {
        intent:   "generalQuestion",
        strategy: ROUTE_STRATEGY.AI_WITH_CONTEXT,
        keywords: [], // fallback — semua yang tidak cocok di atas
    },
];

// ── KEYWORD HELPERS ───────────────────────────────────────────────────────────

/** Normalisasi: lowercase + trim */
function norm(s) { return String(s || "").toLowerCase().trim(); }

/** Ekstrak kata setelah keyword (untuk pencarian) */
function _extractAfterKeyword(q, keywords) {
    const nq = norm(q);
    for (const kw of keywords) {
        const idx = nq.indexOf(kw);
        if (idx !== -1) {
            const after = q.slice(idx + kw.length).trim();
            // Bersihkan tanda tanya, titik di akhir
            return after.replace(/[?.,!]+$/, "").trim();
        }
    }
    return q.trim();
}

/** Ekstrak query pencarian umum dari kalimat */
function _extractSearchQuery(q) {
    const stopWords = ["cari", "temukan", "ada", "produk", "barang", "stok", "berapa",
                       "info", "detail", "tentang", "nama", "apa", "yang"];
    const nq = norm(q);
    const words = nq.split(/\s+/).filter(w => !stopWords.includes(w));
    return words.join(" ").trim() || q.trim();
}

// ── CLASSIFIER ────────────────────────────────────────────────────────────────

/**
 * Klasifikasikan intent dari pertanyaan user.
 *
 * @param {string} question
 * @returns {{ intent: string, strategy: string, extractedQuery: string|null }}
 */
export function classifyIntent(question) {
    const nq = norm(question);

    for (const rule of INTENT_RULES) {
        // generalQuestion = fallback (no keywords)
        if (rule.keywords.length === 0) continue;

        const matched = rule.keywords.some(kw => nq.includes(kw));
        if (matched) {
            const extractedQuery = rule.extract ? rule.extract(question) : null;
            if (AI_DEBUG) {
                console.log(`[AIRouter] Intent: "${rule.intent}" (${rule.strategy})`);
            }
            return {
                intent:         rule.intent,
                strategy:       rule.strategy,
                extractedQuery,
            };
        }
    }

    // Fallback: generalQuestion → kirim ke AI
    if (AI_DEBUG) console.log(`[AIRouter] Intent: "generalQuestion" (FALLBACK)`);
    return {
        intent:         "generalQuestion",
        strategy:       ROUTE_STRATEGY.AI_WITH_CONTEXT,
        extractedQuery: null,
    };
}

// ── ROUTER ────────────────────────────────────────────────────────────────────

/**
 * Route pertanyaan ke strategi yang tepat.
 * Jika TOOL_ONLY → eksekusi tool dan kembalikan hasil.
 * Jika AI_WITH_CONTEXT → kembalikan sinyal untuk memanggil Gemini.
 *
 * @param {string} question    - Pertanyaan user
 * @param {string} [userRole]  - Role user untuk permission check
 * @returns {RouteResult}
 */
export function route(question, userRole) {
    const { intent, strategy, extractedQuery } = classifyIntent(question);

    // Jika TOOL_ONLY, coba eksekusi langsung
    if (strategy === ROUTE_STRATEGY.TOOL_ONLY) {
        const tool = getToolByIntent(intent);

        if (tool) {
            // Cek role di tool definition
            if (userRole && tool.roles && !tool.roles.includes(userRole)) {
                return {
                    strategy:  ROUTE_STRATEGY.TOOL_ONLY,
                    intent,
                    handled:   true,
                    success:   false,
                    data:      null,
                    text:      `Fitur ini tidak tersedia untuk role "${userRole}".`,
                    extractedQuery,
                };
            }

            const result = executeTool(tool.name, extractedQuery);

            return {
                strategy:  ROUTE_STRATEGY.TOOL_ONLY,
                intent,
                handled:   true,
                success:   result.success,
                data:      result.data,
                text:      null, // Tool mengembalikan data, bukan teks
                extractedQuery,
                error:     result.error,
            };
        }
    }

    // AI_WITH_CONTEXT (atau TOOL_ONLY yang tidak punya tool)
    return {
        strategy:  ROUTE_STRATEGY.AI_WITH_CONTEXT,
        intent,
        handled:   false, // Signal: "masih perlu dipanggil AI"
        success:   null,
        data:      null,
        text:      null,
        extractedQuery,
    };
}

/**
 * @typedef {Object} RouteResult
 * @property {string}       strategy       - TOOL_ONLY atau AI_WITH_CONTEXT
 * @property {string}       intent         - Intent yang terdeteksi
 * @property {boolean}      handled        - true jika sudah dijawab tool
 * @property {boolean|null} success        - Apakah tool berhasil
 * @property {any}          data           - Data dari tool (jika TOOL_ONLY)
 * @property {string|null}  text           - Teks langsung (jika ada)
 * @property {string|null}  extractedQuery - Query yang diekstrak dari pertanyaan
 * @property {string}       [error]        - Pesan error jika gagal
 */

/**
 * @typedef {Object} IntentRule
 * @property {string}   intent
 * @property {string}   strategy
 * @property {string[]} keywords
 * @property {Function} [extract]
 */
