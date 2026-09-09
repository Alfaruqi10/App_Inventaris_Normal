/**
 * AIConfig.js — ANSLA Inventory AI Engine
 * =========================================
 * Pusat konfigurasi AI yang bersifat provider-agnostic.
 * Semua pengaturan provider, model, dan parameter berasal dari sini.
 * Untuk berpindah provider (misal Gemini → OpenAI → Claude),
 * cukup ubah konstanta di file ini tanpa menyentuh kode lain.
 *
 * @module AIConfig
 * @version 3.0.0 — Smart Model Router
 */

// ── PROVIDER AKTIF ────────────────────────────────────────────────────────────
// Nilai yang valid: "gemini" | "openai" | "claude"
export const AI_PROVIDER = "gemini";

// ── GEMINI: DAFTAR MODEL (urutan = prioritas fallback) ────────────────────────
// Priority 1 → Primary: gemini-3.5-flash (lebih kapabel, default)
// Priority 2 → Fallback: gemini-3.1-flash-lite (cepat, hemat quota)
// Jika kedua gagal → Offline Mode via AITools (data lokal inventaris)
// TIDAK menggunakan gemini-2.5-* dalam bentuk apapun
export const GEMINI_MODELS = [
    "gemini-3.5-flash",      // Priority 1 — primary
    "gemini-3.1-flash-lite", // Priority 2 — fallback otomatis
];
// ── SMART MODEL ROUTING ───────────────────────────────────────────────────────
// Jika true, pilih model berdasarkan intent (bukan selalu model pertama).
// Jika false, selalu gunakan GEMINI_MODELS[0].
export const AUTO_MODEL_ROUTING = true;

// Jika true, otomatis pindah ke model berikutnya saat 503/429/timeout.
export const AUTO_FALLBACK      = true;

// ── INTENT → MODEL MAPPING ────────────────────────────────────────────────────
// Tentukan model terbaik per intent.
// Key  : nama intent (sesuai AIRouter.js)
// Value: nama model Gemini
//
// Intent ringan  → model ringan (Priority 1)
// Intent analisa → model lebih kuat (Priority 2)
export const INTENT_MODEL_MAP = {

    // Query ringan → fallback model (hemat quota, cepat)
    findSKU:            "gemini-3.1-flash-lite",
    findProduct:        "gemini-3.1-flash-lite",
    stockSummary:       "gemini-3.1-flash-lite",
    todayTransactions:  "gemini-3.1-flash-lite",
    recentTransactions: "gemini-3.1-flash-lite",
    mappingSummary:     "gemini-3.1-flash-lite",
    generalQuestion:    "gemini-3.5-flash",
    pendingOrders:      "gemini-3.1-flash-lite",

    // Query analisis → primary model (lebih kapabel)
    analysis:           "gemini-3.5-flash",
    forecast:           "gemini-3.5-flash",
    dailySummary:       "gemini-3.5-flash",
    slowMoving:         "gemini-3.5-flash",
    topProducts:        "gemini-3.5-flash",
};

// ── MODEL LAMA (backward compat) ─────────────────────────────────────────────
// Dulu hanya ada satu model — sekarang menggunakan GEMINI_MODELS[0] sebagai default.
export const AI_MODELS = {
    gemini: GEMINI_MODELS[0],
    openai: "gpt-4o-mini",
    claude: "claude-3-haiku-20240307",
};

// Default model aktif (dipakai oleh adapter non-Gemini)
export const AI_MODEL = AI_MODELS[AI_PROVIDER];

// ── API KEYS ──────────────────────────────────────────────────────────────────
export const AI_API_KEYS = {
    gemini: "",
    openai: "",
    claude: "",
};

export const AI_API_KEY = AI_API_KEYS[AI_PROVIDER];

// ── ENDPOINT / BASE URL ───────────────────────────────────────────────────────
export const AI_ENDPOINTS = {
    gemini: "https://generativelanguage.googleapis.com",
    openai: "https://api.openai.com",
    claude: "https://api.anthropic.com",
};

export const AI_ENDPOINT = AI_ENDPOINTS[AI_PROVIDER];

// ── PARAMETER GENERASI ────────────────────────────────────────────────────────
export const AI_TEMPERATURE        = 0.3;
export const AI_MAX_OUTPUT_TOKENS  = 2048;
export const AI_TOP_P              = 0.9;

// ── TIMEOUT & RETRY ───────────────────────────────────────────────────────────
// Timeout per request (lebih ketat dari sebelumnya agar fallback cepat terjadi)
export const AI_TIMEOUT            = 15000;
// Jumlah maksimal retry per model sebelum pindah ke model berikutnya
export const AI_MAX_RETRIES        = 3;
// Delay antar retry (ms) — eksponensial di AIService
export const AI_RETRY_DELAY        = 800;

// ── CONTEXT ───────────────────────────────────────────────────────────────────
export const AI_MAX_RECENT_TX      = 10;
export const AI_MAX_LOW_STOCK      = 20;
export const AI_LOW_STOCK_LIMIT    = 5;

// ── FLAGS ─────────────────────────────────────────────────────────────────────
export const AI_DEBUG              = false;
export const AI_LOGGING            = true;
export const AI_CACHE_ENABLED      = true;
export const AI_CACHE_TTL_MS       = 60_000;

// ── ERROR CODES YANG MEMICU FALLBACK ─────────────────────────────────────────
// Substring dari error.message yang dianggap sebagai sinyal "pakai model lain".
export const FALLBACK_ERROR_PATTERNS = [
    "503",
    "503 Service Unavailable",
    "UNAVAILABLE",
    "RESOURCE_EXHAUSTED",
    "429",
    "quota",
    "overloaded",
    "timeout",
    "Too Many Requests",
];
