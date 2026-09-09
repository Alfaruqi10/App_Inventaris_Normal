/**
 * AIContext.js — ANSLA Inventory AI Engine
 * ==========================================
 * Context Builder: mengambil snapshot data inventaris yang sudah dimuat aplikasi
 * dan merakitnya menjadi object terstruktur yang siap dikirim ke AI Engine.
 *
 * Context ini TIDAK memanggil API apapun.
 * Context TIDAK mengubah data apapun.
 * Context membaca data dari variabel global window.* yang diisi oleh aplikasi.
 *
 * @module AIContext
 * @version 2.0.0
 */

import {
    AI_LOW_STOCK_LIMIT,
    AI_MAX_RECENT_TX,
    AI_MAX_LOW_STOCK,
} from "./AIConfig.js";

import {
    stockSummary,
    todayTransactions,
    recentTransactions,
    pendingOrders,
    mappingSummary,
    topProducts,
    getSalesSummary,
    topSellingProducts,
} from "./AITools.js";

// ── HELPER INTERNAL ───────────────────────────────────────────────────────────

/** Ambil variabel dari window scope dengan aman */
function getGlobal(key, fallback = null) {
    return (typeof window !== "undefined" && window[key] !== undefined)
        ? window[key]
        : fallback;
}

/** Ambil array dari window scope (fallback []) */
function getArr(key) {
    const v = getGlobal(key, []);
    return Array.isArray(v) ? v : [];
}

/** Parse integer aman */
function safeInt(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

// ── CONTEXT BUILDER ───────────────────────────────────────────────────────────

/**
 * Bangun snapshot context inventaris lengkap.
 * Dipanggil sesaat sebelum mengirim request ke AI Engine.
 *
 * @param {string} [currentPage="Dashboard"] - Nama halaman yang sedang dibuka user
 * @returns {AIContextSnapshot} Object context siap pakai
 */
export function buildContext(currentPage = "Dashboard") {
    const now       = new Date();
    const user      = getGlobal("currentUser");
    const stock     = stockSummary();
    const todayTx   = todayTransactions();
    const recentTx  = recentTransactions(AI_MAX_RECENT_TX, "ALL");
    const pending   = pendingOrders();
    const mapping   = mappingSummary();
    const topProds  = topProducts(5);

    // ── Sales Ledger summary ───────────────────────────────────────────────
    const salesSummary = getSalesSummary();

    // ── Notifikasi Shopee ──────────────────────────────────────────────────    const notifRaw  = getArr("shopeeNotifsData");
    const unreadNotif = notifRaw.filter(n => String(n["Is Read"]).toLowerCase() !== "true");
    const recentNotif = [...notifRaw]
        .sort((a, b) => new Date(b["Created At"] || 0) - new Date(a["Created At"] || 0))
        .slice(0, 5)
        .map(n => ({
            type:    n["Type"]       || "-",
            message: n["Message"]    || "-",
            isRead:  String(n["Is Read"]).toLowerCase() === "true",
            tanggal: n["Created At"] || "-",
        }));

    // ── Shopee Orders lengkap ──────────────────────────────────────────────
    // shopeeOrdersFullData = data nyata dari loadShopeeOrdersPage()
    // shopeeOrdersData = legacy variable, tidak pernah terisi, jangan dipakai
    const ordersRaw = (getArr("shopeeOrdersFullData").length > 0)
        ? getArr("shopeeOrdersFullData")
        : getArr("shopeeOrdersData");
    const totalOrders   = ordersRaw.length;
    const ordersByStatus = ordersRaw.reduce((acc, o) => {
        const s = String(o["order_status"] || "UNKNOWN").toUpperCase();
        acc[s]  = (acc[s] || 0) + 1;
        return acc;
    }, {});

    // ── Shopee Products (ringkasan) ────────────────────────────────────────
    const shopeeProds   = getArr("shopeeProductsData");

    // ── Telegram status (dari DOM atau global — jika tersedia) ────────────
    const telegramStatus = _getTelegramStatus();

    /** @type {AIContextSnapshot} */
    const context = {
        // ── META ───────────────────────────────────────────────────────────
        generatedAt:   now.toISOString(),
        tanggalDisplay: now.toLocaleDateString("id-ID", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
        }),
        waktuDisplay:   now.toLocaleTimeString("id-ID"),
        currentPage,

        // ── USER ───────────────────────────────────────────────────────────
        user: user ? {
            nama:  user.nama  || "-",
            email: user.email || "-",
            role:  user.role  || "Kasir",
        } : null,

        // ── STOK & PRODUK ──────────────────────────────────────────────────
        stok: {
            totalProduk:   stock.totalProduk,
            totalStok:     stock.totalStok,
            produkAman:    stock.produkAman,
            produkMenipis: stock.produkMenipis,
            produkHabis:   stock.produkHabis,
            batasMinimum:  AI_LOW_STOCK_LIMIT,
            listMenipis:   stock.listMenipis,
            listHabis:     stock.listHabis,
        },

        // ── TRANSAKSI ──────────────────────────────────────────────────────
        transaksiHariIni: {
            totalMasuk:  todayTx.masuk,
            totalKeluar: todayTx.keluar,
            total:       todayTx.total,
            daftar:      todayTx.transactions,
        },

        // ── RIWAYAT TRANSAKSI TERBARU ──────────────────────────────────────
        riwayatTerbaru: {
            total:  recentTx.total,
            daftar: recentTx.transactions,
        },

        // ── SHOPEE: PESANAN ────────────────────────────────────────────────
        // Baca KPI dari DOM (diisi oleh _soRenderKpi setelah API call) — paling akurat
        // karena mencerminkan TOTAL semua halaman, bukan hanya halaman aktif
        shopee: (function() {
            const domKpi = (id) => {
                if (typeof document === "undefined") return null;
                const el = document.getElementById(id);
                return el ? (parseInt(el.textContent, 10) || 0) : null;
            };
            const kpiTotal   = domKpi("tab-count-ALL");
            const kpiNew     = domKpi("so-kpi-new");
            const kpiPending = domKpi("so-kpi-pending");
            const kpiShipped = domKpi("so-kpi-shipped");
            const kpiDone    = domKpi("so-kpi-done");
            const kpiUnpaid  = domKpi("so-kpi-unpaid");
            return {
                // Gunakan KPI DOM jika tersedia, fallback ke array halaman aktif
                totalOrders:       kpiTotal   ?? totalOrders,
                pendingApproval:   kpiPending ?? pending.total,
                pesananBaru:       kpiNew     ?? null,
                dikirim:           kpiShipped ?? null,
                selesai:           kpiDone    ?? null,
                belumBayar:        kpiUnpaid  ?? null,
                ordersByStatus,
                listPending:       pending.pending,
                totalProdukShopee: shopeeProds.length,
            };
        })(),

        // ── SHOPEE: MAPPING ────────────────────────────────────────────────
        mapping: {
            total:           mapping.totalMapping,
            terverifikasi:   mapping.terverifikasi,
            belumVerifikasi: mapping.belumVerifikasi,
            daftar:          mapping.mappings,
        },

        // ── NOTIFIKASI SHOPEE ──────────────────────────────────────────────
        notifikasi: {
            total:       notifRaw.length,
            belumDibaca: unreadNotif.length,
            terbaru:     recentNotif,
        },

        // ── TELEGRAM ──────────────────────────────────────────────────────
        telegram: telegramStatus,

        // ── PRODUK TERLARIS ────────────────────────────────────────────────
        produkTerlaris: topProds.products,

        // ── PENJUALAN (SALES LEDGER) ───────────────────────────────────────
        penjualan: {
            totalOmzet:          salesSummary.totalOmzet,
            totalPesananSelesai: salesSummary.totalSelesai,
            totalPesananPending: salesSummary.totalPending,
            totalRetur:          salesSummary.totalRetur,
            totalDibatalkan:     salesSummary.totalDibatalkan,
            estimasiPendapatan:  salesSummary.estimasiPendapatan,
            produkTerlarisSales: salesSummary.topProducts,
        },
    };

    return context;
}

/**
 * Baca status Telegram dari variabel global aplikasi jika tersedia.
 * @returns {object}
 */
function _getTelegramStatus() {
    // Aplikasi mungkin menyimpan status Telegram di window setelah loadTelegramStatus()
    const status = getGlobal("telegramStatus", null);
    if (status) return status;

    // Fallback: baca dari elemen DOM jika ada
    const todayEl = typeof document !== "undefined"
        ? document.getElementById("tg-today-count")
        : null;

    return {
        available:      !!todayEl,
        notifHariIni:   todayEl ? safeInt(todayEl.textContent) : null,
    };
}

// ── CONTEXT TO TEXT ───────────────────────────────────────────────────────────

/**
 * Ubah context snapshot menjadi teks terstruktur untuk disisipkan ke system prompt.
 * Digunakan sebagai grounding data yang dikirim ke AI bersama user message.
 *
 * @param {AIContextSnapshot} ctx - Hasil dari buildContext()
 * @returns {string}
 */
export function contextToText(ctx) {
    const lines = [
        `=== CONTEXT INVENTARIS ANSLA ===`,
        `Tanggal  : ${ctx.tanggalDisplay}`,
        `Pukul    : ${ctx.waktuDisplay}`,
        `Halaman  : ${ctx.currentPage}`,
        `Operator : ${ctx.user ? `${ctx.user.nama} (${ctx.user.role})` : "Tidak diketahui"}`,
        ``,
        `--- STOK ---`,
        `Total produk   : ${ctx.stok.totalProduk}`,
        `Total unit stok: ${ctx.stok.totalStok}`,
        `Produk aman    : ${ctx.stok.produkAman}`,
        `Produk menipis : ${ctx.stok.produkMenipis} (stok ≤${ctx.stok.batasMinimum})`,
        `Produk habis   : ${ctx.stok.produkHabis}`,
    ];

    if (ctx.stok.listMenipis.length > 0) {
        lines.push(`Daftar menipis : ${ctx.stok.listMenipis.map(p =>
            `${p.nama} (${p.sku}) stok=${p.stok}`).join("; ")}`);
    }
    if (ctx.stok.listHabis.length > 0) {
        lines.push(`Daftar habis   : ${ctx.stok.listHabis.map(p =>
            `${p.nama} (${p.sku})`).join("; ")}`);
    }

    lines.push(
        ``,
        `--- TRANSAKSI HARI INI ---`,
        `Masuk : ${ctx.transaksiHariIni.totalMasuk}`,
        `Keluar: ${ctx.transaksiHariIni.totalKeluar}`,
        `Total : ${ctx.transaksiHariIni.total}`,
    );

    if (ctx.riwayatTerbaru.daftar.length > 0) {
        lines.push(
            ``,
            `--- RIWAYAT TERBARU (${ctx.riwayatTerbaru.daftar.length} entri) ---`,
            ...ctx.riwayatTerbaru.daftar.map(t =>
                `${t.timestamp} | ${t.jenis} | ${t.nama} (${t.sku}) | qty=${t.jumlah}`
            ),
        );
    }

    lines.push(
        ``,
        `--- SHOPEE PESANAN ---`,
        `Total pesanan         : ${ctx.shopee.totalOrders}`,
        `Pesanan baru          : ${ctx.shopee.pesananBaru ?? "-"}`,
        `Approve pending       : ${ctx.shopee.pendingApproval}`,
        `Dikirim               : ${ctx.shopee.dikirim ?? "-"}`,
        `Selesai               : ${ctx.shopee.selesai ?? "-"}`,
        `Belum bayar           : ${ctx.shopee.belumBayar ?? "-"}`,
        `Total produk Shopee   : ${ctx.shopee.totalProdukShopee}`,
        `Mapping terverifikasi : ${ctx.mapping.terverifikasi} / ${ctx.mapping.total}`,
        `Mapping belum verif   : ${ctx.mapping.belumVerifikasi}`,
    );

    if (Object.keys(ctx.shopee.ordersByStatus || {}).length > 0) {
        lines.push(`Status pesanan: ${
            Object.entries(ctx.shopee.ordersByStatus)
                .map(([s, n]) => `${s}=${n}`).join(", ")
        }`);
    }

    lines.push(
        ``,
        `--- NOTIFIKASI ---`,
        `Total notifikasi  : ${ctx.notifikasi.total}`,
        `Belum dibaca      : ${ctx.notifikasi.belumDibaca}`,
    );

    if (ctx.notifikasi.terbaru.length > 0) {
        lines.push(
            `Notifikasi terbaru:`,
            ...ctx.notifikasi.terbaru.map(n =>
                `  [${n.type}] ${n.message} (${n.isRead ? "dibaca" : "belum dibaca"})`
            ),
        );
    }

    if (ctx.telegram?.notifHariIni !== null && ctx.telegram?.notifHariIni !== undefined) {
        lines.push(
            ``,
            `--- TELEGRAM ---`,
            `Notif hari ini: ${ctx.telegram.notifHariIni}`,
        );
    }

    if (ctx.produkTerlaris.length > 0) {
        lines.push(
            ``,
            `--- PRODUK TERLARIS ---`,
            ...ctx.produkTerlaris.map(p =>
                `${p.rank}. ${p.nama} (${p.sku}) — ${p.totalKeluar} unit keluar`
            ),
        );
    }

    if (ctx.penjualan) {
        const pj = ctx.penjualan;
        lines.push(
            ``,
            `--- PENJUALAN (SALES LEDGER) ---`,
            `Total omzet           : Rp ${(pj.totalOmzet || 0).toLocaleString("id-ID")}`,
            `Estimasi pendapatan   : Rp ${(pj.estimasiPendapatan || 0).toLocaleString("id-ID")}`,
            `Pesanan selesai       : ${pj.totalPesananSelesai || 0}`,
            `Pesanan pending       : ${pj.totalPesananPending || 0}`,
            `Retur                 : ${pj.totalRetur || 0}`,
            `Dibatalkan            : ${pj.totalDibatalkan || 0}`,
        );
        if (pj.produkTerlarisSales && pj.produkTerlarisSales.length > 0) {
            lines.push(`Produk terlaris (omzet):`);
            pj.produkTerlarisSales.forEach(p => {
                lines.push(`  ${p.rank}. ${p.namaProduk} (${p.sku}) — Rp ${(p.totalSubtotal || 0).toLocaleString("id-ID")}, qty=${p.totalQty}`);
            });
        }
    }

    lines.push(`=== AKHIR CONTEXT ===`);
    return lines.join("\n");
}

/**
 * @typedef {Object} AIContextSnapshot
 * @property {string}        generatedAt
 * @property {string}        tanggalDisplay
 * @property {string}        waktuDisplay
 * @property {string}        currentPage
 * @property {object|null}   user
 * @property {object}        stok
 * @property {object}        transaksiHariIni
 * @property {object}        riwayatTerbaru
 * @property {object}        shopee
 * @property {object}        mapping
 * @property {object}        notifikasi
 * @property {object}        telegram
 * @property {Array}         produkTerlaris
 */

import {
    AI_LOW_STOCK_LIMIT,
    AI_MAX_RECENT_TX,
    AI_MAX_LOW_STOCK,
} from "./AIConfig.js";

import {
    stockSummary,
    todayTransactions,
    recentTransactions,
    pendingOrders,
    mappingSummary,
    topProducts,
} from "./AITools.js";

// ── HELPER INTERNAL ───────────────────────────────────────────────────────────

/** Ambil variabel dari window scope dengan aman */
function getGlobal(key, fallback = null) {
    return (typeof window !== "undefined" && window[key] !== undefined)
        ? window[key]
        : fallback;
}

/** Format tanggal ke string lokal Indonesia */
function formatDate(d) {
    try {
        return (typeof window !== "undefined" && window.formatDateTimeShort) ? window.formatDateTimeShort(d) : String(d);
    } catch {
        return String(d);
    }
}

// ── CONTEXT BUILDER ───────────────────────────────────────────────────────────

/**
 * Bangun snapshot context inventaris lengkap.
 * Dipanggil sesaat sebelum mengirim request ke AI Engine.
 *
 * @param {string} [currentPage="Dashboard"] - Nama halaman yang sedang dibuka user
 * @returns {AIContextSnapshot} Object context siap pakai
 */
export function buildContext(currentPage = "Dashboard") {
    const now          = new Date();
    const user         = getGlobal("currentUser");
    const stock        = stockSummary();
    const todayTx      = todayTransactions();
    const recentTx     = recentTransactions(AI_MAX_RECENT_TX, "ALL");
    const pending      = pendingOrders();
    const mapping      = mappingSummary();
    const topProds     = topProducts(5);

    /** @type {AIContextSnapshot} */
    const context = {
        // ── META ───────────────────────────────────────────────────────────
        generatedAt:   now.toISOString(),
        tanggalDisplay: (typeof window !== "undefined" && window.formatDateTime) ? window.formatDateTime(now) : now.toLocaleString(),
        waktuDisplay:   (typeof window !== "undefined" && window.formatTime) ? window.formatTime(now) : now.toLocaleTimeString(),
        currentPage,

        // ── USER ───────────────────────────────────────────────────────────
        user: user ? {
            nama:  user.nama  || "-",
            email: user.email || "-",
            role:  user.role  || "Kasir",
        } : null,

        // ── STOK & PRODUK ──────────────────────────────────────────────────
        stok: {
            totalProduk:   stock.totalProduk,
            totalStok:     stock.totalStok,
            produkAman:    stock.produkAman,
            produkMenipis: stock.produkMenipis,
            produkHabis:   stock.produkHabis,
            batasMinimum:  AI_LOW_STOCK_LIMIT,
            // Daftar produk menipis (untuk rekomendasi restock)
            listMenipis:   stock.listMenipis,
            // Daftar produk habis
            listHabis:     stock.listHabis,
        },

        // ── TRANSAKSI ──────────────────────────────────────────────────────
        transaksiHariIni: {
            totalMasuk:   todayTx.masuk,
            totalKeluar:  todayTx.keluar,
            total:        todayTx.total,
            daftar:       todayTx.transactions,
        },

        // ── RIWAYAT TRANSAKSI TERBARU ──────────────────────────────────────
        riwayatTerbaru: {
            total:     recentTx.total,
            daftar:    recentTx.transactions,
        },

        // ── SHOPEE: PESANAN PENDING ────────────────────────────────────────
        shopee: {
            pendingApproval: pending.total,
            listPending:     pending.pending,
        },

        // ── SHOPEE: MAPPING ────────────────────────────────────────────────
        mapping: {
            total:          mapping.totalMapping,
            terverifikasi:  mapping.terverifikasi,
            belumVerifikasi: mapping.belumVerifikasi,
            daftar:         mapping.mappings,
        },

        // ── PRODUK TERLARIS ────────────────────────────────────────────────
        produkTerlaris: topProds.products,
    };

    return context;
}

/**
 * Ubah context snapshot menjadi teks ringkas untuk disisipkan ke system prompt.
 * Digunakan sebagai "grounding data" yang dikirim ke AI bersama user message.
 *
 * @param {AIContextSnapshot} ctx - Hasil dari buildContext()
 * @returns {string} Teks context yang siap disertakan ke prompt
 */
export function contextToText(ctx) {
    const lines = [
        `=== CONTEXT INVENTARIS ANSLA ===`,
        `Tanggal: ${ctx.tanggalDisplay}, Pukul ${ctx.waktuDisplay}`,
        `Halaman aktif: ${ctx.currentPage}`,
        `Operator: ${ctx.user ? `${ctx.user.nama} (${ctx.user.role})` : "Tidak diketahui"}`,
        ``,
        `--- STOK ---`,
        `Total produk: ${ctx.stok.totalProduk}`,
        `Total unit stok: ${ctx.stok.totalStok}`,
        `Produk aman: ${ctx.stok.produkAman}`,
        `Produk menipis (≤${ctx.stok.batasMinimum}): ${ctx.stok.produkMenipis}`,
        `Produk habis: ${ctx.stok.produkHabis}`,
    ];

    if (ctx.stok.listMenipis.length > 0) {
        lines.push(`Daftar menipis: ${ctx.stok.listMenipis.map(p => `${p.nama} (${p.sku}) stok=${p.stok}`).join(", ")}`);
    }
    if (ctx.stok.listHabis.length > 0) {
        lines.push(`Daftar habis: ${ctx.stok.listHabis.map(p => `${p.nama} (${p.sku})`).join(", ")}`);
    }

    lines.push(
        ``,
        `--- TRANSAKSI HARI INI ---`,
        `Masuk: ${ctx.transaksiHariIni.totalMasuk}, Keluar: ${ctx.transaksiHariIni.totalKeluar}, Total: ${ctx.transaksiHariIni.total}`,
    );

    if (ctx.riwayatTerbaru.daftar.length > 0) {
        lines.push(
            ``,
            `--- RIWAYAT TERBARU (${ctx.riwayatTerbaru.daftar.length} transaksi) ---`,
            ...ctx.riwayatTerbaru.daftar.map(t =>
                `${t.timestamp} | ${t.jenis} | ${t.nama} (${t.sku}) | ${t.jumlah} unit`
            ),
        );
    }

    lines.push(
        ``,
        `--- SHOPEE ---`,
        `Pesanan pending approval: ${ctx.shopee.pendingApproval}`,
        `Mapping terverifikasi: ${ctx.mapping.terverifikasi} / ${ctx.mapping.total}`,
        `Mapping belum verifikasi: ${ctx.mapping.belumVerifikasi}`,
    );

    if (ctx.produkTerlaris.length > 0) {
        lines.push(
            ``,
            `--- PRODUK TERLARIS ---`,
            ...ctx.produkTerlaris.map(p => `${p.rank}. ${p.nama} (${p.sku}) — ${p.totalKeluar} unit keluar`),
        );
    }

    lines.push(`=== AKHIR CONTEXT ===`);

    return lines.join("\n");
}

/**
 * @typedef {Object} AIContextSnapshot
 * @property {string}   generatedAt
 * @property {string}   tanggalDisplay
 * @property {string}   waktuDisplay
 * @property {string}   currentPage
 * @property {object|null} user
 * @property {object}   stok
 * @property {object}   transaksiHariIni
 * @property {object}   riwayatTerbaru
 * @property {object}   shopee
 * @property {object}   mapping
 * @property {Array}    produkTerlaris
 */
