/**
 * AITools.js — ANSLA Inventory AI Engine
 * ========================================
 * Kumpulan tool internal yang membaca data inventaris yang sudah dimuat aplikasi.
 * TIDAK menggunakan fetch. TIDAK mengubah data.
 * Semua tool bersifat read-only dan mengembalikan plain object / array.
 *
 * Sumber data:
 *   - window.masterData          → MasterBarang (produk + stok)
 *   - window.transactionData     → Transaksi (masuk/keluar)
 *   - window.shopeeOrdersFullData → Pesanan Shopee (server-side paginated, active data)
 *   - window.shopeeOrdersData    → Legacy variable (tidak terisi, jangan gunakan)
 *   - window.shopeeMappingData   → Mapping SKU Shopee ↔ Inventaris
 *   - window.shopeeProductsData  → Produk dari Shopee
 *   - window.currentUser         → User yang sedang login
 *
 * @module AITools
 * @version 1.0.0
 */

import { AI_LOW_STOCK_LIMIT, AI_MAX_RECENT_TX, AI_MAX_LOW_STOCK } from "./AIConfig.js";

// ── HELPER INTERNAL ───────────────────────────────────────────────────────────

/** Ambil data dari window scope dengan fallback array kosong */
function getData(key) {
    return (typeof window !== "undefined" && Array.isArray(window[key])) ? window[key] : [];
}

/** Parse integer aman dari nilai yang mungkin string / undefined */
function safeInt(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

/** Normalisasi string untuk perbandingan (lowercase, trim) */
function norm(s) {
    return String(s || "").toLowerCase().trim();
}

// ── TOOL: findProduct ─────────────────────────────────────────────────────────
/**
 * Cari produk berdasarkan kata kunci (nama atau SKU).
 * Pencarian case-insensitive, partial match.
 *
 * @param {string} query - Kata kunci pencarian
 * @returns {{ results: Array, total: number }}
 */
export function findProduct(query) {
    if (!query) return { results: [], total: 0 };
    const q = norm(query);
    const data = getData("masterData");

    const results = data
        .filter(p =>
            norm(p["Nama Barang"]).includes(q) ||
            norm(p["Kode Barang"]).includes(q) ||
            norm(p["Warna"]).includes(q) ||
            norm(p["Ukuran"]).includes(q) ||
            norm(p["Kategori"]).includes(q)
        )
        .map(p => ({
            nama:     p["Nama Barang"] || "-",
            sku:      p["Kode Barang"] || "-",
            warna:    p["Warna"]       || "-",
            ukuran:   p["Ukuran"]      || "-",
            kategori: p["Kategori"]    || "-",
            stok:     safeInt(p["Stok Saat Ini"]),
            status:   safeInt(p["Stok Saat Ini"]) <= 0
                ? "Habis"
                : safeInt(p["Stok Saat Ini"]) <= AI_LOW_STOCK_LIMIT
                    ? "Menipis"
                    : "Aman",
        }));

    return { results, total: results.length };
}

// ── TOOL: findSKU ─────────────────────────────────────────────────────────────
/**
 * Cari produk berdasarkan SKU / kode barang (exact atau partial match).
 *
 * @param {string} sku - Kode SKU yang dicari
 * @returns {object|null} Data produk atau null jika tidak ditemukan
 */
export function findSKU(sku) {
    if (!sku) return null;
    const q = norm(sku);
    const data = getData("masterData");

    const found = data.find(p =>
        norm(p["Kode Barang"]) === q ||
        norm(p["Kode Barang"]).includes(q)
    );

    if (!found) return null;

    return {
        nama:     found["Nama Barang"]    || "-",
        sku:      found["Kode Barang"]    || "-",
        warna:    found["Warna"]          || "-",
        ukuran:   found["Ukuran"]         || "-",
        kategori: found["Kategori"]       || "-",
        stok:     safeInt(found["Stok Saat Ini"]),
        tahun:    found["Tahun Perolehan"]|| "-",
        status:   safeInt(found["Stok Saat Ini"]) <= 0
            ? "Habis"
            : safeInt(found["Stok Saat Ini"]) <= AI_LOW_STOCK_LIMIT
                ? "Menipis"
                : "Aman",
    };
}

// ── TOOL: stockSummary ────────────────────────────────────────────────────────
/**
 * Ringkasan kondisi stok seluruh produk.
 *
 * @returns {{
 *   totalProduk: number,
 *   totalStok: number,
 *   produkAman: number,
 *   produkMenipis: number,
 *   produkHabis: number,
 *   listMenipis: Array,
 *   listHabis: Array
 * }}
 */
export function stockSummary() {
    const data = getData("masterData");

    const listHabis   = [];
    const listMenipis = [];
    let totalStok     = 0;
    let produkAman    = 0;

    data.forEach(p => {
        const stok = safeInt(p["Stok Saat Ini"]);
        totalStok += stok;

        const item = {
            nama:  p["Nama Barang"] || "-",
            sku:   p["Kode Barang"] || "-",
            warna: p["Warna"]       || "-",
            stok,
        };

        if (stok <= 0) {
            listHabis.push(item);
        } else if (stok <= AI_LOW_STOCK_LIMIT) {
            listMenipis.push(item);
        } else {
            produkAman++;
        }
    });

    // Sort menipis dari yang paling kritis
    listMenipis.sort((a, b) => a.stok - b.stok);

    return {
        totalProduk:   data.length,
        totalStok,
        produkAman,
        produkMenipis: listMenipis.length,
        produkHabis:   listHabis.length,
        listMenipis:   listMenipis.slice(0, AI_MAX_LOW_STOCK),
        listHabis:     listHabis.slice(0, AI_MAX_LOW_STOCK),
    };
}

// ── TOOL: recentTransactions ──────────────────────────────────────────────────
/**
 * Ambil transaksi terbaru (masuk dan keluar).
 *
 * @param {number} [limit] - Jumlah transaksi (default: AI_MAX_RECENT_TX)
 * @param {"MASUK"|"KELUAR"|"ALL"} [jenis] - Filter jenis transaksi
 * @returns {{ transactions: Array, total: number }}
 */
export function recentTransactions(limit = AI_MAX_RECENT_TX, jenis = "ALL") {
    const data = getData("transactionData");

    const filtered = jenis === "ALL"
        ? data
        : data.filter(t => String(t["Jenis Transaksi"] || "").toUpperCase() === jenis);

    // Sort descending berdasarkan timestamp
    const sorted = [...filtered].sort((a, b) =>
        new Date(b["Timestamp"] || 0) - new Date(a["Timestamp"] || 0)
    );

    const transactions = sorted.slice(0, limit).map(t => ({
        timestamp: t["Timestamp"]        || "-",
        jenis:     t["Jenis Transaksi"]  || "-",
        sku:       t["Kode Barang"]      || "-",
        nama:      t["Nama Barang"]      || "-",
        warna:     t["Warna"]            || "-",
        ukuran:    t["Ukuran"]           || "-",
        jumlah:    safeInt(t["Jumlah"]),
        petugas:   t["Petugas"]          || t["Email Petugas"] || "-",
        keterangan:t["Keterangan"]       || "-",
    }));

    return { transactions, total: filtered.length };
}

// ── TOOL: todayTransactions ───────────────────────────────────────────────────
/**
 * Transaksi yang terjadi hari ini.
 *
 * @returns {{ masuk: number, keluar: number, transactions: Array }}
 */
export function todayTransactions() {
    const data   = getData("transactionData");
    const today  = new Date().toDateString();

    const todayData = data.filter(t => {
        if (!t["Timestamp"]) return false;
        return new Date(t["Timestamp"]).toDateString() === today;
    });

    const masuk  = todayData.filter(t => String(t["Jenis Transaksi"] || "").toUpperCase() === "MASUK").length;
    const keluar = todayData.filter(t => String(t["Jenis Transaksi"] || "").toUpperCase() === "KELUAR").length;

    return {
        masuk,
        keluar,
        total: todayData.length,
        transactions: todayData.slice(0, AI_MAX_RECENT_TX).map(t => ({
            timestamp: t["Timestamp"]       || "-",
            jenis:     t["Jenis Transaksi"] || "-",
            sku:       t["Kode Barang"]     || "-",
            nama:      t["Nama Barang"]     || "-",
            jumlah:    safeInt(t["Jumlah"]),
        })),
    };
}

// ── TOOL: pendingOrders ───────────────────────────────────────────────────────
/**
 * Pesanan Shopee yang menunggu approval atau belum diproses.
 *
 * @returns {{ pending: Array, total: number }}
 */
export function pendingOrders() {
    // shopeeOrdersFullData adalah variabel yang terisi oleh loadShopeeOrdersPage()
    // shopeeOrdersData adalah variabel legacy yang tidak pernah terisi
    const data = getData("shopeeOrdersFullData").length > 0
        ? getData("shopeeOrdersFullData")
        : getData("shopeeOrdersData");

    // Filter sesuai definisi aplikasi: pending = menunggu approve deduction
    // Sama persis dengan filter di UI: deduction_status === "WAITING_APPROVAL"
    const pending = data
        .filter(o => {
            const ds = String(o["deduction_status"] || o.deduction_status || "").toUpperCase();
            return ds === "WAITING_APPROVAL";
        })
        .map(o => ({
            orderSn:       o["order_sn"]        || "-",
            produk:        o["product_name"]    || "-",
            variasi:       o["variation_name"]  || "-",
            buyer:         o["buyer_name"]      || "-",
            qty:           safeInt(o["qty"]),
            status:        o["order_status"]    || "-",
            deductStatus:  o["deduction_status"] || "-",
            sku:           o["inventory_sku"]   || "-",
            tanggal:       o["create_time"]     || "-",
        }));

    return { pending, total: pending.length };
}

// ── TOOL: mappingSummary ──────────────────────────────────────────────────────
/**
 * Ringkasan status mapping Shopee ↔ Inventaris.
 *
 * @returns {{
 *   totalMapping: number,
 *   terverifikasi: number,
 *   belumVerifikasi: number,
 *   mappings: Array
 * }}
 */
export function mappingSummary() {
    const data = getData("shopeeMappingData");

    const terverifikasi    = data.filter(m =>
        String(m["mapping_status"] || "").toLowerCase() === "verified"
    ).length;

    const belumVerifikasi  = data.length - terverifikasi;

    const mappings = data.slice(0, 20).map(m => ({
        shopeeItemId:  m["item_id"]        || "-",
        shopeeSku:     m["model_sku"]      || m["variation_name"] || "-",
        inventarisSku: m["inventory_sku"]  || "-",
        status:        m["mapping_status"] || "-",
        verifiedBy:    m["verified_by"]    || "-",
    }));

    return {
        totalMapping: data.length,
        terverifikasi,
        belumVerifikasi,
        mappings,
    };
}

// ── TOOL: topProducts ─────────────────────────────────────────────────────────
/**
 * Produk paling laris berdasarkan total unit keluar.
 *
 * @param {number} [topN=5] - Jumlah produk teratas
 * @returns {{ products: Array }}
 */
export function topProducts(topN = 5) {
    const data = getData("transactionData");

    // Akumulasi unit keluar per SKU
    const tally = {};
    const namaMap = {};

    data
        .filter(t => String(t["Jenis Transaksi"] || "").toUpperCase() === "KELUAR")
        .forEach(t => {
            const sku = t["Kode Barang"] || "UNKNOWN";
            tally[sku]   = (tally[sku]   || 0) + safeInt(t["Jumlah"]);
            namaMap[sku] = t["Nama Barang"] || sku;
        });

    const products = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([sku, totalKeluar], idx) => ({
            rank: idx + 1,
            sku,
            nama: namaMap[sku],
            totalKeluar,
        }));

    return { products };
}

// ── TOOL: slowMovingProducts ──────────────────────────────────────────────────
/**
 * Produk yang tidak memiliki transaksi keluar sama sekali (tidak laku).
 *
 * @param {number} [limit=10]
 * @returns {{ products: Array, total: number }}
 */
export function slowMovingProducts(limit = 10) {
    const master = getData("masterData");
    const txData = getData("transactionData");

    const skuDenganKeluar = new Set(
        txData
            .filter(t => String(t["Jenis Transaksi"] || "").toUpperCase() === "KELUAR")
            .map(t => t["Kode Barang"])
    );

    const products = master
        .filter(p => !skuDenganKeluar.has(p["Kode Barang"]))
        .slice(0, limit)
        .map(p => ({
            nama:  p["Nama Barang"]    || "-",
            sku:   p["Kode Barang"]    || "-",
            stok:  safeInt(p["Stok Saat Ini"]),
            warna: p["Warna"]          || "-",
        }));

    return { products, total: products.length };
}

// ── TOOL: getSalesSummary ─────────────────────────────────────────────────────
/**
 * Ringkasan statistik penjualan dari SalesLedger.
 * Membaca dari window.salesLedgerData (diisi oleh loadSalesLedgerData()).
 *
 * @returns {{
 *   totalOmzet: number,
 *   totalSelesai: number,
 *   totalPending: number,
 *   totalRetur: number,
 *   totalDibatalkan: number,
 *   estimasiPendapatan: number,
 *   topProducts: Array
 * }}
 */
export function getSalesSummary() {
    const data = getData("salesLedgerData");

    let totalOmzet = 0, estimasiPendapatan = 0;
    const selesaiOrders = new Set(), pendingOrders = new Set();
    const returOrders = new Set(), dibatalkanOrders = new Set();

    // Akumulasi subtotal per SKU untuk top products
    const skuSubtotal = {};
    const skuQty      = {};
    const skuNama     = {};

    data.forEach(r => {
        const sl       = String(r["Status Ledger"] || "");
        const subtotal = Number(r["Subtotal"]            || 0);
        const est      = Number(r["Estimasi Pendapatan"] || 0);
        const qty      = Number(r["Qty"]                 || 0);
        const sku      = String(r["SKU Inventaris"]      || r["SKU Shopee"] || "UNKNOWN");
        const nama     = String(r["Nama Produk"]         || sku);

        const isSettlementOwner = r["Settlement Owner"] === true || String(r["Settlement Owner"] || "").toUpperCase() === "TRUE";
        if (sl === "Selesai") {
            totalOmzet         += subtotal;
            selesaiOrders.add(String(r["Order SN"] || ""));
            if (isSettlementOwner || r["Settlement Owner"] === undefined) estimasiPendapatan += est;
            skuSubtotal[sku]    = (skuSubtotal[sku] || 0) + subtotal;
            skuQty[sku]         = (skuQty[sku]      || 0) + qty;
            skuNama[sku]        = nama;
        } else if (sl === "Pending") {
            pendingOrders.add(String(r["Order SN"] || ""));
        } else if (sl === "Retur") {
            returOrders.add(String(r["Order SN"] || ""));
        } else if (sl === "Dibatalkan") {
            dibatalkanOrders.add(String(r["Order SN"] || ""));
        }
    });

    const topProducts = Object.entries(skuSubtotal)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sku, totalSubtotal], idx) => ({
            rank:         idx + 1,
            sku,
            namaProduk:   skuNama[sku],
            totalSubtotal,
            totalQty:     skuQty[sku] || 0,
        }));

    return {
        totalOmzet,
        totalSelesai: selesaiOrders.size,
        totalPending: pendingOrders.size,
        totalRetur: returOrders.size,
        totalDibatalkan: dibatalkanOrders.size,
        estimasiPendapatan,
        topProducts,
    };
}

// ── TOOL: topSellingProducts ──────────────────────────────────────────────────
/**
 * Produk terlaris berdasarkan subtotal pesanan selesai dari SalesLedger.
 *
 * @param {number} [topN=5] - Jumlah produk teratas
 * @returns {{ products: Array }}
 */
export function topSellingProducts(topN = 5) {
    const summary = getSalesSummary();
    const products = summary.topProducts.slice(0, topN);
    return { products };
}
