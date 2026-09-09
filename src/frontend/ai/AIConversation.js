/**
 * AIConversation.js — ANSLA Inventory AI Engine
 * ================================================
 * Memory session untuk riwayat percakapan AI.
 * Menyimpan maksimal 20 percakapan terakhir dalam satu sesi browser.
 * Data TIDAK disimpan permanen (hilang saat refresh atau close tab).
 *
 * @module AIConversation
 * @version 1.0.0
 */

import { AI_DEBUG } from "./AIConfig.js";

// ── KONFIGURASI ───────────────────────────────────────────────────────────────
/** Jumlah maksimal percakapan yang disimpan per session */
const MAX_HISTORY = 20;

// ── STATE INTERNAL ────────────────────────────────────────────────────────────
/** @type {ConversationItem[]} */
let _history = [];

/** Counter ID percakapan dalam session */
let _idCounter = 0;

// ── HELPERS ───────────────────────────────────────────────────────────────────
/** Generate ID unik untuk setiap pesan */
function genId() {
    return `msg_${++_idCounter}_${Date.now()}`;
}

/** Buat ringkasan context (digunakan untuk debugging dan health) */
function summarizeContext(ctx) {
    if (!ctx) return "-";
    return [
        ctx.currentPage && `page:${ctx.currentPage}`,
        ctx.stok?.totalProduk && `produk:${ctx.stok.totalProduk}`,
        ctx.stok?.produkMenipis && `menipis:${ctx.stok.produkMenipis}`,
    ].filter(Boolean).join("|");
}

// ── CONVERSATION API ──────────────────────────────────────────────────────────

/**
 * Tambah satu pesan ke riwayat percakapan.
 * Jika melebihi MAX_HISTORY, hapus yang tertua (FIFO).
 *
 * @param {object} params
 * @param {"user"|"assistant"|"system"} params.role        - Peran pengirim pesan
 * @param {string}                      params.message     - Isi pesan
 * @param {string}                      [params.currentPage] - Halaman aktif saat pesan dikirim
 * @param {object}                      [params.context]   - Snapshot context inventaris
 * @param {string}                      [params.intent]    - Intent yang terdeteksi
 * @returns {ConversationItem} Pesan yang baru ditambahkan
 */
export function add({ role, message, currentPage = "Dashboard", context = null, intent = "" }) {
    const item = /** @type {ConversationItem} */ ({
        id:             genId(),
        timestamp:      new Date().toISOString(),
        role,
        message:        String(message || ""),
        currentPage,
        intent,
        contextSummary: summarizeContext(context),
    });

    // FIFO: hapus yang tertua jika penuh
    if (_history.length >= MAX_HISTORY) {
        _history.shift();
    }
    _history.push(item);

    if (AI_DEBUG) {
        console.log(`[AIConversation] add [${role}] "${message.slice(0, 60)}..."`);
    }

    return item;
}

/**
 * Ambil seluruh riwayat percakapan (read-only copy).
 * @returns {ConversationItem[]}
 */
export function getHistory() {
    return [..._history];
}

/**
 * Ambil riwayat dalam format yang siap dikirim ke AI (role + content saja).
 * Berguna untuk multi-turn conversation di masa depan.
 *
 * @param {number} [maxItems] - Batasi jumlah pesan (default: semua)
 * @returns {{ role: string, content: string }[]}
 */
export function getHistoryForAI(maxItems = MAX_HISTORY) {
    return _history
        .slice(-maxItems)
        .map(item => ({ role: item.role, content: item.message }));
}

/**
 * Ambil pesan terakhir dalam riwayat.
 * @returns {ConversationItem|null}
 */
export function lastMessage() {
    return _history.length > 0 ? { ..._history[_history.length - 1] } : null;
}

/**
 * Ambil N pesan terakhir.
 * @param {number} [n=5]
 * @returns {ConversationItem[]}
 */
export function lastN(n = 5) {
    return _history.slice(-n).map(i => ({ ...i }));
}

/**
 * Bersihkan seluruh riwayat percakapan.
 * Biasanya dipanggil saat user logout atau memulai sesi baru.
 */
export function clear() {
    _history = [];
    _idCounter = 0;
    if (AI_DEBUG) console.log("[AIConversation] History cleared.");
}

/**
 * Jumlah pesan dalam riwayat.
 * @returns {number}
 */
export function length() {
    return _history.length;
}

/**
 * Apakah riwayat kosong?
 * @returns {boolean}
 */
export function isEmpty() {
    return _history.length === 0;
}

/**
 * @typedef {Object} ConversationItem
 * @property {string}               id             - ID unik pesan
 * @property {string}               timestamp      - ISO timestamp
 * @property {"user"|"assistant"|"system"} role    - Pengirim
 * @property {string}               message        - Isi pesan
 * @property {string}               currentPage    - Halaman aktif
 * @property {string}               intent         - Intent yang terdeteksi
 * @property {string}               contextSummary - Ringkasan context saat pesan dikirim
 */
