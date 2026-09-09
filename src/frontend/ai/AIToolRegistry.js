/**
 * AIToolRegistry.js — ANSLA Inventory AI Engine
 * ================================================
 * Registry terpusat untuk semua AI tool.
 * Tool tidak di-hardcode — semua didaftarkan melalui registerTool().
 * Memisahkan definisi tool dari logic routing dan eksekusi.
 *
 * @module AIToolRegistry
 * @version 1.0.0
 */

import { AI_DEBUG } from "./AIConfig.js";
import {
    findProduct,
    findSKU,
    stockSummary,
    recentTransactions,
    todayTransactions,
    pendingOrders,
    mappingSummary,
    topProducts,
    slowMovingProducts,
} from "./AITools.js";

// ── REGISTRY STORE ────────────────────────────────────────────────────────────
/**
 * Map dari nama tool → definisi tool.
 * @type {Map<string, AIToolDefinition>}
 */
const _registry = new Map();

// ── REGISTER ──────────────────────────────────────────────────────────────────

/**
 * Daftarkan satu tool ke registry.
 *
 * @param {AIToolDefinition} def - Definisi tool
 * @throws {Error} Jika nama tool sudah terdaftar dan override=false
 */
export function registerTool(def) {
    if (!def.name || typeof def.fn !== "function") {
        throw new Error(`[AIToolRegistry] Tool harus memiliki 'name' dan 'fn'. Got: ${JSON.stringify(def)}`);
    }

    if (_registry.has(def.name) && !def.override) {
        if (AI_DEBUG) console.warn(`[AIToolRegistry] Tool "${def.name}" sudah terdaftar. Skip.`);
        return;
    }

    _registry.set(def.name, {
        name:        def.name,
        description: def.description || "",
        intent:      def.intent || def.name,
        roles:       def.roles || ["Admin", "Kasir"],
        fn:          def.fn,
        override:    def.override || false,
    });

    if (AI_DEBUG) console.log(`[AIToolRegistry] Registered: "${def.name}"`);
}

// ── GET ───────────────────────────────────────────────────────────────────────

/**
 * Ambil tool berdasarkan nama.
 *
 * @param {string} name - Nama tool
 * @returns {AIToolDefinition|null}
 */
export function getTool(name) {
    return _registry.get(name) ?? null;
}

/**
 * Ambil tool berdasarkan intent.
 * Satu intent bisa dipetakan ke beberapa tool.
 *
 * @param {string} intent
 * @returns {AIToolDefinition|null} Tool pertama yang cocok
 */
export function getToolByIntent(intent) {
    for (const tool of _registry.values()) {
        if (tool.intent === intent) return tool;
    }
    return null;
}

// ── LIST ──────────────────────────────────────────────────────────────────────

/**
 * Daftar semua tool yang terdaftar.
 * @returns {AIToolDefinition[]}
 */
export function listTools() {
    return [..._registry.values()];
}

/**
 * Daftar nama semua tool.
 * @returns {string[]}
 */
export function listToolNames() {
    return [..._registry.keys()];
}

// ── EXECUTE ───────────────────────────────────────────────────────────────────

/**
 * Eksekusi tool berdasarkan nama dengan parameter opsional.
 * Tool bersifat read-only — tidak mengubah data apapun.
 *
 * @param {string} name     - Nama tool
 * @param {any}    [params] - Parameter yang diteruskan ke fungsi tool
 * @returns {{ success: boolean, data: any, error: string|null }}
 */
export function executeTool(name, params) {
    const tool = getTool(name);

    if (!tool) {
        return { success: false, data: null, error: `Tool "${name}" tidak ditemukan.` };
    }

    try {
        const data = tool.fn(params);
        if (AI_DEBUG) console.log(`[AIToolRegistry] Executed: "${name}"`, data);
        return { success: true, data, error: null };
    } catch (err) {
        if (AI_DEBUG) console.error(`[AIToolRegistry] Error executing "${name}":`, err);
        return { success: false, data: null, error: err.message };
    }
}

// ── AUTO-REGISTRASI SEMUA TOOL DARI AITools.js ───────────────────────────────
/**
 * Daftarkan semua tool dari AITools.js ke registry.
 * Dipanggil otomatis saat module dimuat.
 * Tambahkan tool baru di sini saat AITools.js ditambah fungsi.
 */
function _autoRegister() {
    const tools = /** @type {AIToolDefinition[]} */ ([
        {
            name:        "findProduct",
            description: "Cari produk berdasarkan nama, SKU, warna, ukuran, atau kategori.",
            intent:      "findProduct",
            roles:       ["Admin", "Kasir"],
            fn:          (q) => findProduct(q),
        },
        {
            name:        "findSKU",
            description: "Cari produk berdasarkan kode SKU (exact atau partial match).",
            intent:      "findSKU",
            roles:       ["Admin", "Kasir"],
            fn:          (sku) => findSKU(sku),
        },
        {
            name:        "stockSummary",
            description: "Ringkasan kondisi stok: total produk, menipis, habis, aman.",
            intent:      "stockSummary",
            roles:       ["Admin", "Kasir"],
            fn:          () => stockSummary(),
        },
        {
            name:        "recentTransactions",
            description: "Ambil transaksi terbaru (masuk atau keluar).",
            intent:      "recentTransactions",
            roles:       ["Admin", "Kasir"],
            fn:          (p) => recentTransactions(p?.limit, p?.jenis),
        },
        {
            name:        "todayTransactions",
            description: "Transaksi yang terjadi hari ini.",
            intent:      "recentTransactions",
            roles:       ["Admin", "Kasir"],
            fn:          () => todayTransactions(),
        },
        {
            name:        "pendingOrders",
            description: "Pesanan Shopee yang menunggu approval.",
            intent:      "pendingOrders",
            roles:       ["Admin"],
            fn:          () => pendingOrders(),
        },
        {
            name:        "mappingSummary",
            description: "Ringkasan status mapping Shopee ↔ Inventaris.",
            intent:      "mappingSummary",
            roles:       ["Admin"],
            fn:          () => mappingSummary(),
        },
        {
            name:        "topProducts",
            description: "Produk paling laris berdasarkan unit keluar.",
            intent:      "analysis",
            roles:       ["Admin"],
            fn:          (p) => topProducts(p?.topN),
        },
        {
            name:        "slowMovingProducts",
            description: "Produk yang tidak memiliki transaksi keluar (tidak laku).",
            intent:      "analysis",
            roles:       ["Admin"],
            fn:          (p) => slowMovingProducts(p?.limit),
        },
    ]);

    tools.forEach(registerTool);
    if (AI_DEBUG) console.log(`[AIToolRegistry] Auto-registered ${tools.length} tools.`);
}

// Eksekusi auto-registrasi
_autoRegister();

/**
 * @typedef {Object} AIToolDefinition
 * @property {string}    name        - Nama unik tool
 * @property {string}    description - Deskripsi singkat (untuk logging/UI)
 * @property {string}    intent      - Intent yang dipetakan ke tool ini
 * @property {string[]}  roles       - Role yang diizinkan menggunakan tool ini
 * @property {Function}  fn          - Fungsi tool (read-only, tidak mengubah data)
 * @property {boolean}   [override]  - Jika true, timpa tool dengan nama sama
 */
