/**
 * AIService.js — ANSLA Inventory AI Engine
 * ==========================================
 * Kelas utama AI Engine. Mengintegrasikan seluruh modul AI Core.
 *
 * Pipeline eksekusi per request (urutan wajib):
 *   1. Router       → tentukan intent & strategi
 *   2. Permission   → cek izin role user
 *   3. Cache        → kembalikan dari cache jika tersedia
 *   4. Context      → bangun snapshot inventaris
 *   5. ModelRouter  → pilih model Gemini terbaik berdasarkan intent
 *   6. Gemini       → panggil provider, auto-fallback jika gagal
 *   7. Logger       → catat hasil + model yang digunakan
 *   8. Conversation → simpan ke history session
 *
 * @module AIService
 * @version 3.0.0 — Smart Model Router
 */

import {
    AI_PROVIDER,
    AI_API_KEY,
    AI_TEMPERATURE,
    AI_MAX_OUTPUT_TOKENS,
    AI_TOP_P,
    AI_TIMEOUT,
    AI_MAX_RETRIES,
    AI_RETRY_DELAY,
    AI_DEBUG,
    AI_LOGGING,
    AI_CACHE_ENABLED,
    AI_CACHE_TTL_MS,
    GEMINI_MODELS,
    INTENT_MODEL_MAP,
    AUTO_MODEL_ROUTING,
    AUTO_FALLBACK,
    FALLBACK_ERROR_PATTERNS,
} from "./AIConfig.js";

import { SYSTEM_PROMPT_MAIN }                     from "./AIPrompts.js";
import { buildContext, contextToText }            from "./AIContext.js";
import { route, ROUTE_STRATEGY }                  from "./AIRouter.js";
import { checkPermission, getCurrentUserRole }    from "./AIPermission.js";
import { buildCacheKey, cacheGet, cacheSet }      from "./AICache.js";
import { logRequest }                             from "./AILogger.js";
import * as conversation                          from "./AIConversation.js";
import { recordSuccess, recordError, updateModelStatus } from "./AIHealth.js";

// ══════════════════════════════════════════════════════════════════════════════
// SMART MODEL ROUTER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tentukan model Gemini terbaik berdasarkan intent.
 * Jika AUTO_MODEL_ROUTING = false, selalu kembalikan model pertama.
 *
 * @param {string} intent - Intent dari AIRouter
 * @returns {string} Nama model Gemini yang dipilih
 */
export function selectBestModel(intent) {
    if (!AUTO_MODEL_ROUTING) return GEMINI_MODELS[0];

    const preferred = INTENT_MODEL_MAP[intent];
    if (preferred && GEMINI_MODELS.includes(preferred)) return preferred;

    // Fallback ke model pertama jika intent tidak terdaftar
    return GEMINI_MODELS[0];
}

/**
 * Periksa apakah error ini adalah sinyal untuk fallback ke model lain.
 *
 * @param {Error|string} err
 * @returns {boolean}
 */
function isFallbackError(err) {
    if (!AUTO_FALLBACK) return false;
    const msg = String(err?.message ?? err ?? "").toLowerCase();
    return FALLBACK_ERROR_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

/**
 * Bangun urutan model untuk fallback.
 * Dimulai dari model yang dipilih router, lanjut ke model lain secara berurutan.
 *
 * @param {string} preferredModel - Model yang dipilih selectBestModel()
 * @returns {string[]} Urutan model yang akan dicoba
 */
function buildModelQueue(preferredModel) {
    const queue = [preferredModel];
    for (const m of GEMINI_MODELS) {
        if (!queue.includes(m)) queue.push(m);
    }
    return queue;
}

// ══════════════════════════════════════════════════════════════════════════════
// GEMINI CLIENT (shared, lazy-init)
// ══════════════════════════════════════════════════════════════════════════════

let _geminiClient = null;

/**
 * Lazy-init Gemini client (singleton).
 * Satu client dipakai oleh semua model — hanya berbeda di field `model`.
 */
async function getGeminiClient() {
    if (_geminiClient) return _geminiClient;
    const { GoogleGenAI } = await import("@google/genai");
    _geminiClient = new GoogleGenAI({ apiKey: AI_API_KEY });
    return _geminiClient;
}

/**
 * Panggil Gemini dengan model tertentu.
 * Tidak ada retry di sini — retry & fallback ditangani di callWithFallback().
 *
 * @param {string} model        - Nama model Gemini
 * @param {string} userMessage  - Pesan user
 * @param {string} systemPrompt - System prompt lengkap
 * @returns {Promise<string>}   - Teks jawaban
 */
async function callGemini(model, userMessage, systemPrompt) {
    const client   = await getGeminiClient();
    const response = await client.models.generateContent({
        model,
        contents: userMessage,
        config: {
            systemInstruction: systemPrompt,
            temperature:       AI_TEMPERATURE,
            maxOutputTokens:   AI_MAX_OUTPUT_TOKENS,
            topP:              AI_TOP_P,
        },
    });

    const text = response?.text
        ?? response?.candidates?.[0]?.content?.parts?.[0]?.text
        ?? "";

    if (!text) throw new Error("Model mengembalikan response kosong.");
    return text;
}

// ══════════════════════════════════════════════════════════════════════════════
// FALLBACK ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Kirim request ke Gemini dengan logika fallback otomatis.
 *
 * Alur:
 *   Untuk setiap model dalam queue:
 *     Coba kirim request (dengan timeout).
 *     Jika berhasil → kembalikan hasil + model yang dipakai.
 *     Jika error fallback (503/429/timeout) → lanjut ke model berikutnya.
 *     Jika error bukan fallback → lempar langsung (tidak perlu model lain).
 *   Jika semua model gagal → lempar error terakhir.
 *
 * @param {string}   preferredModel - Model awal yang dipilih router
 * @param {string}   userMessage
 * @param {string}   systemPrompt
 * @returns {Promise<{ text: string, modelUsed: string, retryCount: number, fallbackOccurred: boolean }>}
 */
async function callWithFallback(preferredModel, userMessage, systemPrompt) {
    const modelQueue = buildModelQueue(preferredModel);
    let totalRetries = 0;
    let fallbackOccurred = false;
    let lastError;

    for (let modelIdx = 0; modelIdx < modelQueue.length; modelIdx++) {
        const model = modelQueue[modelIdx];
        if (modelIdx > 0) fallbackOccurred = true;

        // Retry loop untuk model ini
        const maxTries = AUTO_FALLBACK ? 1 : AI_MAX_RETRIES + 1;
        // Saat fallback aktif, cukup 1 percobaan per model agar fallback cepat.
        // Saat fallback mati, retry semuanya pada satu model.

        for (let attempt = 1; attempt <= (AUTO_FALLBACK ? AI_MAX_RETRIES : 1); attempt++) {
            try {
                if (AI_DEBUG) {
                    console.log(`[AIService] Trying model="${model}" attempt=${attempt}/${AUTO_FALLBACK ? AI_MAX_RETRIES : 1} fallback=${fallbackOccurred}`);
                }

                const text = await _withTimeout(
                    callGemini(model, userMessage, systemPrompt),
                    AI_TIMEOUT
                );

                // Berhasil
                if (AI_DEBUG) console.log(`[AIService] ✓ model="${model}" attempt=${attempt}`);
                return { text, modelUsed: model, retryCount: totalRetries, fallbackOccurred };

            } catch (err) {
                totalRetries++;
                lastError = err;

                if (AI_DEBUG) {
                    console.warn(`[AIService] ✗ model="${model}" attempt=${attempt} error="${err.message}"`);
                }

                if (isFallbackError(err)) {
                    // Tunggu sebentar lalu pindah ke model berikutnya
                    if (attempt < (AUTO_FALLBACK ? AI_MAX_RETRIES : 1)) {
                        await _sleep(AI_RETRY_DELAY * attempt);
                    } else {
                        break; // Keluar dari retry loop, coba model berikutnya
                    }
                } else {
                    // Error bukan tipe fallback (mis: invalid request) — tidak perlu coba model lain
                    throw err;
                }
            }
        }
    }

    // Semua model dalam queue gagal
    throw lastError ?? new Error("Semua model Gemini tidak tersedia saat ini.");
}

// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER ADAPTERS (OpenAI, Claude — stubs)
// ══════════════════════════════════════════════════════════════════════════════

class OpenAIAdapter {
    async generate() {
        throw new Error("OpenAI adapter belum diimplementasi. Isi AI_API_KEYS.openai dan lengkapi adapter.");
    }
}

class ClaudeAdapter {
    async generate() {
        throw new Error("Claude adapter belum diimplementasi. Isi AI_API_KEYS.claude dan lengkapi adapter.");
    }
}

// ── Timeout wrapper ────────────────────────────────────────────────────────────
function _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(
            () => reject(new Error(`timeout: request melebihi ${ms / 1000} detik.`)),
            ms
        );
        promise.then(v => { clearTimeout(t); resolve(v); },
                     e => { clearTimeout(t); reject(e);  });
    });
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DATA FORMATTER
// ══════════════════════════════════════════════════════════════════════════════

function toolDataToText(intent, data) {
    if (!data) return "Tidak ada data yang ditemukan.";
    try {
        switch (intent) {
            case "findSKU":
                if (!data) return "Produk dengan SKU tersebut tidak ditemukan.";
                return `Produk ditemukan:\n• Nama: ${data.nama}\n• SKU: ${data.sku}\n• Warna: ${data.warna}\n• Ukuran: ${data.ukuran}\n• Stok: ${data.stok} (${data.status})\n• Kategori: ${data.kategori}`;

            case "findProduct": {
                const { results, total } = data;
                if (total === 0) return "Tidak ada produk yang cocok dengan pencarian tersebut.";
                const lines = [`Ditemukan ${total} produk:`];
                results.slice(0, 10).forEach((p, i) => {
                    lines.push(`${i + 1}. ${p.nama} (${p.sku}) — Stok: ${p.stok} [${p.status}]`);
                });
                if (total > 10) lines.push(`... dan ${total - 10} produk lainnya.`);
                return lines.join("\n");
            }

            case "stockSummary":
                return [
                    `Ringkasan Stok:`,
                    `• Total produk   : ${data.totalProduk}`,
                    `• Total unit stok: ${data.totalStok}`,
                    `• Produk aman    : ${data.produkAman}`,
                    `• Produk menipis : ${data.produkMenipis}`,
                    `• Produk habis   : ${data.produkHabis}`,
                    data.listMenipis?.length > 0
                        ? `\nMenipis (${data.listMenipis.length}):\n` +
                          data.listMenipis.map(p => `  • ${p.nama} (${p.sku}) stok=${p.stok}`).join("\n")
                        : "",
                    data.listHabis?.length > 0
                        ? `\nHabis (${data.listHabis.length}):\n` +
                          data.listHabis.map(p => `  • ${p.nama} (${p.sku})`).join("\n")
                        : "",
                ].filter(Boolean).join("\n");

            case "recentTransactions": {
                const { transactions, total } = data;
                if (!transactions || total === 0) return "Belum ada transaksi yang tercatat.";
                const lines = [`${total} transaksi total. Terbaru:`];
                transactions.slice(0, 10).forEach(t => {
                    lines.push(`• ${t.timestamp} | ${t.jenis} | ${t.nama} (${t.sku}) | qty=${t.jumlah}`);
                });
                return lines.join("\n");
            }

            case "pendingOrders": {
                const { pending, total } = data;
                if (total === 0) return "Tidak ada pesanan yang menunggu approval saat ini.";
                const lines = [`${total} pesanan pending:`];
                pending.slice(0, 10).forEach(o => {
                    lines.push(`• ${o.orderSn} | ${o.produk} | qty=${o.qty} | status=${o.deductStatus}`);
                });
                return lines.join("\n");
            }

            case "mappingSummary":
                return [
                    `Mapping Shopee:`,
                    `• Total mapping    : ${data.totalMapping}`,
                    `• Terverifikasi    : ${data.terverifikasi}`,
                    `• Belum verifikasi : ${data.belumVerifikasi}`,
                ].join("\n");

            default:
                return JSON.stringify(data, null, 2).slice(0, 800);
        }
    } catch {
        return "Data tersedia namun tidak dapat diformat.";
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// AI SERVICE CLASS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AIService — kelas utama aplikasi ANSLA.
 *
 * Pipeline per request:
 *   Route → Permission → Cache → Context → ModelRouter → Gemini(+Fallback) → Log → History
 *
 * @class AIService
 */
export class AIService {
    constructor() {
        this.provider       = AI_PROVIDER;
        /** Model terakhir yang berhasil digunakan — diperbarui setiap request */
        this.lastModelUsed  = GEMINI_MODELS[0];

        if (AI_DEBUG) {
            console.log(`[AIService] Init. Provider=${AI_PROVIDER}`);
            console.log(`[AIService] Model queue: ${GEMINI_MODELS.join(" → ")}`);
            console.log(`[AIService] AUTO_ROUTING=${AUTO_MODEL_ROUTING} AUTO_FALLBACK=${AUTO_FALLBACK}`);
        }
    }

    // ── PUBLIC: ask ───────────────────────────────────────────────────────────
    /**
     * Method utama — kirim pertanyaan melalui pipeline lengkap.
     *
     * @param {string} question      - Pertanyaan dari user
     * @param {string} [currentPage] - Halaman aktif saat ini
     * @returns {Promise<AIResponse>}
     */
    async ask(question, currentPage = "Dashboard") {
        const startMs = Date.now();

        if (!question?.trim()) {
            return this._resp(false, null, "Pertanyaan tidak boleh kosong.", startMs, "unknown", false, false, GEMINI_MODELS[0], 0, false);
        }

        // ── 1. ROUTER ───────────────────────────────────────────────────────
        const userRole    = getCurrentUserRole();
        const routeResult = route(question, userRole);
        const { intent, strategy } = routeResult;

        if (AI_DEBUG) console.log(`[AIService] intent=${intent} strategy=${strategy}`);

        // ── 2. PERMISSION ───────────────────────────────────────────────────
        const perm = checkPermission(intent, userRole);
        if (!perm.allowed) {
            if (AI_LOGGING) this._log({ question, intent, usedCache: false, calledAI: false, success: false, startMs, error: perm.reason, currentPage, userRole, modelUsed: "-", retryCount: 0, fallbackOccurred: false });
            return this._resp(false, null, perm.reason, startMs, intent, false, false, "-", 0, false);
        }

        // ── 3. TOOL_ONLY ─────────────────────────────────────────────────────
        if (strategy === ROUTE_STRATEGY.TOOL_ONLY && routeResult.handled) {
            const text = routeResult.success
                ? toolDataToText(intent, routeResult.data)
                : (routeResult.error || "Tool tidak dapat menjawab pertanyaan ini.");

            conversation.add({ role: "user",      message: question, currentPage, intent });
            conversation.add({ role: "assistant",  message: text,     currentPage, intent });

            if (AI_LOGGING) this._log({ question, intent, usedCache: false, calledAI: false, success: routeResult.success, startMs, responseText: text, currentPage, userRole, modelUsed: "tool", retryCount: 0, fallbackOccurred: false });

            return this._resp(routeResult.success, text, routeResult.error, startMs, intent, false, false, "tool", 0, false);
        }

        // ── 4. CACHE ─────────────────────────────────────────────────────────
        if (AI_CACHE_ENABLED) {
            const cacheKey = buildCacheKey(question, currentPage);
            const cached   = cacheGet(cacheKey);
            if (cached) {
                conversation.add({ role: "user",      message: question, currentPage, intent });
                conversation.add({ role: "assistant",  message: cached,   currentPage, intent });
                if (AI_LOGGING) this._log({ question, intent, usedCache: true, calledAI: false, success: true, startMs, responseText: cached, currentPage, userRole, modelUsed: "cache", retryCount: 0, fallbackOccurred: false });
                return this._resp(true, cached, null, startMs, intent, true, false, "cache", 0, false);
            }
        }

        // ── 5. CONTEXT ───────────────────────────────────────────────────────
        const snapshot     = buildContext(currentPage);
        const contextText  = contextToText(snapshot);
        const systemPrompt = `${SYSTEM_PROMPT_MAIN}\n\n${contextText}`;
        if (AI_DEBUG) console.log(`[AIService] context size=${contextText.length} chars`);

        // ── 6. MODEL ROUTER + GEMINI CALL + FALLBACK ─────────────────────────
        const preferredModel = selectBestModel(intent);
        if (AI_DEBUG) console.log(`[AIService] preferred model="${preferredModel}" for intent="${intent}"`);

        let responseText    = null;
        let callError       = null;
        let modelUsed       = preferredModel;
        let retryCount      = 0;
        let fallbackOccurred = false;

        if (AI_PROVIDER === "gemini") {
            try {
                const result = await callWithFallback(preferredModel, question, systemPrompt);
                responseText     = result.text;
                modelUsed        = result.modelUsed;
                retryCount       = result.retryCount;
                fallbackOccurred = result.fallbackOccurred;
                this.lastModelUsed = modelUsed;
                recordSuccess(modelUsed);

                if (fallbackOccurred && AI_DEBUG) {
                    console.warn(`[AIService] Fallback occurred. Final model: "${modelUsed}"`);
                }
            } catch (err) {
                callError = err.message;
                recordError(err.message, preferredModel);
                if (AI_DEBUG) console.error(`[AIService] All models failed:`, err.message);
            }
        } else {
            // Non-Gemini providers (OpenAI, Claude — stubs)
            callError = `Provider "${AI_PROVIDER}" belum diimplementasi.`;
        }

        const success = !!responseText;

        // ── 7. LOGGER ────────────────────────────────────────────────────────
        if (AI_LOGGING) {
            this._log({
                question, intent, usedCache: false, calledAI: true,
                success, startMs, responseText: responseText || "",
                contextText, error: callError || "",
                currentPage, userRole, modelUsed,
                retryCount, fallbackOccurred,
            });
        }

        // ── 8. CONVERSATION ──────────────────────────────────────────────────
        conversation.add({ role: "user",      message: question, currentPage, intent, context: snapshot });
        conversation.add({ role: "assistant",  message: responseText || callError || "", currentPage, intent });

        // ── CACHE STORE ──────────────────────────────────────────────────────
        if (success && AI_CACHE_ENABLED) {
            cacheSet(buildCacheKey(question, currentPage), responseText, AI_CACHE_TTL_MS);
        }

        return this._resp(success, responseText, callError, startMs, intent, false, true, modelUsed, retryCount, fallbackOccurred);
    }

    // ── PUBLIC: askRaw ────────────────────────────────────────────────────────
    /**
     * Kirim prompt langsung ke Gemini dengan system prompt kustom.
     * Melewati pipeline (tanpa router/permission/cache).
     * Berguna untuk pengujian atau fitur khusus.
     *
     * @param {string} userMessage
     * @param {string} [systemPrompt]
     * @param {string} [forceModel] - Paksa model tertentu (opsional)
     * @returns {Promise<AIResponse>}
     */
    async askRaw(userMessage, systemPrompt = SYSTEM_PROMPT_MAIN, forceModel = null) {
        const startMs = Date.now();
        if (!userMessage?.trim()) {
            return this._resp(false, null, "Pesan tidak boleh kosong.", startMs, "raw", false, false, "-", 0, false);
        }

        const model = forceModel ?? GEMINI_MODELS[0];
        try {
            const result = await callWithFallback(model, userMessage, systemPrompt);
            recordSuccess(result.modelUsed);
            return this._resp(true, result.text, null, startMs, "raw", false, true, result.modelUsed, result.retryCount, result.fallbackOccurred);
        } catch (err) {
            recordError(err.message, model);
            return this._resp(false, null, err.message, startMs, "raw", false, true, model, 0, false);
        }
    }

    // ── PUBLIC: checkModels ───────────────────────────────────────────────────
    /**
     * Tes semua model Gemini dan kembalikan status tiap model.
     * Simpan status ke AIHealth agar AIService dapat melewati model UNAVAILABLE.
     *
     * Status: READY | BUSY | UNAVAILABLE | QUOTA_EXCEEDED
     *
     * @returns {Promise<ModelStatusMap>}
     */
    async checkModels() {
        const results = {};
        const probe   = "Hai";

        for (const model of GEMINI_MODELS) {
            const t0 = Date.now();
            try {
                await _withTimeout(callGemini(model, probe, ""), AI_TIMEOUT);
                const latency = Date.now() - t0;
                results[model] = { status: "READY", latencyMs: latency };
                if (typeof updateModelStatus === "function") updateModelStatus(model, "READY", latency);
                if (AI_DEBUG) console.log(`[checkModels] ✓ ${model} (${latency}ms)`);
            } catch (err) {
                const msg = String(err?.message ?? "").toLowerCase();
                let status = "UNAVAILABLE";
                if (msg.includes("quota") || msg.includes("429") || msg.includes("resource_exhausted")) {
                    status = "QUOTA_EXCEEDED";
                } else if (msg.includes("503") || msg.includes("overloaded") || msg.includes("busy")) {
                    status = "BUSY";
                }
                results[model] = { status, error: err.message };
                if (typeof updateModelStatus === "function") updateModelStatus(model, status, null);
                if (AI_DEBUG) console.warn(`[checkModels] ✗ ${model} → ${status}: ${err.message}`);
            }
        }

        return results;
    }

    // ── PUBLIC: clearSession ──────────────────────────────────────────────────
    clearSession() {
        conversation.clear();
        if (AI_DEBUG) console.log("[AIService] Session cleared.");
    }

    getHistory() { return conversation.getHistory(); }

    // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

    /** Log request ke AILogger */
    _log({ question, intent, usedCache, calledAI, success, startMs, responseText = "", contextText = "", error = "", currentPage, userRole, modelUsed, retryCount, fallbackOccurred }) {
        logRequest({
            question, intent, usedCache, calledAI, success,
            durationMs:  Date.now() - startMs,
            responseText, contextText, error,
            currentPage, userRole: userRole || "-",
            // Extra fields untuk model router
            modelUsed: String(modelUsed || "-"),
            retryCount:  retryCount || 0,
            fallbackOccurred: !!fallbackOccurred,
        });
    }

    /** Bangun AIResponse standar */
    _resp(success, text, error, startMs, intent, usedCache, calledAI, modelUsed, retryCount, fallbackOccurred) {
        return {
            success,
            text:            text    ?? null,
            error:           error   ?? null,
            intent,
            usedCache,
            calledAI,
            provider:        this.provider,
            model:           String(modelUsed ?? GEMINI_MODELS[0]),
            fallbackOccurred: !!fallbackOccurred,
            retryCount:      retryCount ?? 0,
            durationMs:      Date.now() - startMs,
            timestamp:       new Date().toISOString(),
        };
    }
}

// ── SINGLETON ─────────────────────────────────────────────────────────────────
/**
 * Instance tunggal AIService untuk seluruh aplikasi ANSLA.
 *
 * @example
 *   import { aiService } from "./ai/AIService.js";
 *   const result = await aiService.ask("Ringkasan hari ini", "Dashboard");
 *   console.log(result.text, result.model, result.fallbackOccurred);
 */
export const aiService = new AIService();

/**
 * @typedef {Object} AIResponse
 * @property {boolean}      success
 * @property {string|null}  text
 * @property {string|null}  error
 * @property {string}       intent
 * @property {boolean}      usedCache
 * @property {boolean}      calledAI
 * @property {string}       provider
 * @property {string}       model            - Model Gemini yang akhirnya digunakan
 * @property {boolean}      fallbackOccurred - true jika terjadi fallback ke model lain
 * @property {number}       retryCount       - Total percobaan yang dilakukan
 * @property {number}       durationMs
 * @property {string}       timestamp
 */

/**
 * @typedef {Object.<string, {status: string, latencyMs?: number, error?: string}>} ModelStatusMap
 */
