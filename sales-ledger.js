// ============================================================
// SALES LEDGER — Frontend JavaScript
// Laporan Penjualan — ANSLA Inventaris
// ============================================================

/** Ambil GAS_URL — support script inline (let) dan external script */
function _slGasUrl() {
    // Coba dari closure (let di inline script yang sudah di-expose ke window)
    if (typeof GAS_URL !== 'undefined' && GAS_URL) return GAS_URL;
    if (window.GAS_URL) return window.GAS_URL;
    return null;
}

var _slSearchTimer = null;
var _slCurrentPage = 1;
var _slLastKpi = null;

// ── Format helpers ─────────────────────────────────────────
function _slFmtRupiah(n) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', maximumFractionDigits: 0
    }).format(Number(n) || 0);
}
// Cek nilai benar-benar kosong (null/undefined/blank). 0 dianggap ADA (nilai valid dari API).
function _slHasValue(v) {
    return v !== undefined && v !== null && String(v).trim() !== '';
}
function _slFmtDate(v) {
    if (!v) return '-';
    try {
        return formatDate(v);
    } catch(e) { return String(v); }
}
function _slTrunc(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Badge helpers ──────────────────────────────────────────
function _slStatusLedgerBadge(status) {
    var labelMap = {
        'Pending':    'Menunggu Sinkronisasi',
        'Selesai':    'Tersinkronisasi',
        'Dibatalkan': 'Dibatalkan',
        'Retur':      'Retur'
    };
    var clsMap = {
        'Pending':    'ds-badge ds-badge-amber',
        'Selesai':    'ds-badge ds-badge-green',
        'Dibatalkan': 'ds-badge ds-badge-red',
        'Retur':      'ds-badge ds-badge-purple'
    };
    var cls   = clsMap[status]   || 'ds-badge ds-badge-gray';
    var label = labelMap[status] || (status || '-');
    return '<span class="' + cls + '">' + label + '</span>';
}
function _slDeductionBadge(status) {
    var map = {
        'DEDUCTED':         'ds-badge ds-badge-green',
        'SUCCESS':          'ds-badge ds-badge-green',
        'WAITING_APPROVAL': 'ds-badge ds-badge-amber',
        'PENDING':          'ds-badge ds-badge-gray',
        'FAILED':           'ds-badge ds-badge-red',
        'SKIPPED':          'ds-badge ds-badge-gray',
        'RETURN_PENDING':   'ds-badge ds-badge-purple'
    };
    var cls = map[status] || 'ds-badge ds-badge-gray';
    return '<span class="' + cls + '">' + (status || '-') + '</span>';
}
function _slStatusShopeeBadge(status) {
    var colors = {
        'COMPLETED':          'ds-badge-green',
        'SHIPPED':            'ds-badge-blue',
        'READY_TO_SHIP':      'ds-badge-sky',
        'TO_CONFIRM_RECEIVE': 'ds-badge-indigo',
        'UNPAID':             'ds-badge-amber',
        'CANCELLED':          'ds-badge-red',
        'IN_CANCEL':          'ds-badge-red',
        'TO_RETURN':          'ds-badge-purple',
        'RETURNED':           'ds-badge-purple',
        'PROCESSED':          'ds-badge-blue'
    };
    var cls   = 'ds-badge ' + (colors[status] || 'ds-badge-gray');
    var label = _slStatusShopeeLabelID(status);
    return '<span class="' + cls + '" style="font-size:.65rem">' + label + '</span>';
}

// ── Status Shopee → label Indonesia (Shopee Seller Centre style) ──
function _slStatusShopeeLabelID(status) {
    var map = {
        'UNPAID':             'Belum Bayar',
        'PROCESSED':          'Pesanan Baru',
        'READY_TO_SHIP':      'Perlu Dikirim',
        'SHIPPED':            'Dikirim',
        'TO_CONFIRM_RECEIVE': 'Menunggu Konfirmasi Pembeli',
        'COMPLETED':          'Selesai',
        'CANCELLED':          'Dibatalkan',
        'TO_RETURN':          'Pengembalian',
        'RETURNED':           'Retur'
    };
    return map[String(status || '').toUpperCase()] || status || '-';
}
function _slSettlementBadge(status) {
    var map = {
        'RELEASED':  'ds-badge ds-badge-green',
        'IN_ESCROW': 'ds-badge ds-badge-amber',
        'BUYER_DUE': 'ds-badge ds-badge-red'
    };
    var cls = map[String(status || '').toUpperCase()] || 'ds-badge ds-badge-gray';
    return status ? '<span class="' + cls + '">' + status + '</span>' : '<span class="ds-badge ds-badge-gray">—</span>';
}
function _slUpdateKpiDom(kpi) {
    if (!kpi) return;
    _slLastKpi = kpi;
    var el = function(id) { return document.getElementById(id); };
    // v1 fields (backward compat)
    if (el('sl-kpi-omzet'))  el('sl-kpi-omzet').textContent  = _slFmtRupiah(kpi.totalOmzet);
    if (el('sl-kpi-pesanan'))el('sl-kpi-pesanan').textContent = (kpi.totalPesanan || 0).toLocaleString('id-ID');
    if (el('sl-kpi-qty'))    el('sl-kpi-qty').textContent     = (kpi.totalQty || 0).toLocaleString('id-ID');
    if (el('sl-kpi-avg'))    el('sl-kpi-avg').textContent     = _slFmtRupiah(kpi.averageOrder);
    if (el('sl-kpi-retur'))  el('sl-kpi-retur').textContent   = ((kpi.totalRetur || 0) + (kpi.totalDibatalkan || 0)).toLocaleString('id-ID');
    // v2 fields
    if (el('sl-kpi-pendapatan-bersih')) el('sl-kpi-pendapatan-bersih').textContent = _slFmtRupiah(kpi.pendapatanBersih || 0);
    if (el('sl-kpi-voucher-shopee'))    el('sl-kpi-voucher-shopee').textContent    = _slFmtRupiah(kpi.voucherShopee   || 0);
    if (el('sl-kpi-voucher-seller'))    el('sl-kpi-voucher-seller').textContent    = _slFmtRupiah(kpi.voucherSeller   || 0);
    if (el('sl-kpi-total-fee'))         el('sl-kpi-total-fee').textContent         = _slFmtRupiah(kpi.totalFee        || 0);
}

// ── Init (dipanggil dari switchTab) ────────────────────────
function initSalesLedger() {
    var panel = document.getElementById('sl-filter-panel');
    if (panel) panel.classList.add('open');

    // Inisialisasi Shared Date Range Picker jika belum ada
    if (!window.slDatePicker) {
        window.slDatePicker = new SharedDateRangePicker({
            containerId: 'sl-datepicker-container',
            storageKey: 'ansla_global_date_filter_state',
            onChange: (dateFrom, dateTo, period, periodLabel) => {
                loadSalesLedgerKPI();
                loadSalesLedgerTable(1);
            }
        });
    } else {
        window.slDatePicker.syncState();
    }

    // Langsung load KPI dan tabel — tidak perlu getSalesLedgerData dulu
    loadSalesLedgerKPI();
    loadSalesLedgerTable(1);
    // Load AI data di background (non-blocking, non-fatal)
    setTimeout(function() {
        var url = _slGasUrl();
        if (!url) return;
        fetch(url + '?action=getSalesLedgerData', { redirect: 'follow' })
            .then(function(r) { return r.json(); })
            .then(function(res) { if (res.status === 'success') window.salesLedgerData = res.ledgers || []; })
            .catch(function(e) { console.warn('[SalesLedger] AI data load silently failed:', e.message); });
    }, 2000);
}

// ── Filter toggle (mobile) ─────────────────────────────────
function slToggleFilter() {
    var panel   = document.getElementById('sl-filter-panel');
    var chevron = document.getElementById('sl-filter-chevron');
    if (!panel) return;
    panel.classList.toggle('open');
    if (chevron) chevron.style.transform = panel.classList.contains('open') ? 'rotate(180deg)' : '';
}

// ── Search debounce ────────────────────────────────────────
function slSearchDebounce() {
    clearTimeout(_slSearchTimer);
    _slSearchTimer = setTimeout(function() { loadSalesLedgerTable(1); }, 350);
}

// ── Collect active filter params ───────────────────────────
function _slGetFilterParams() {
    var g = function(id) { return (document.getElementById(id) || {}).value || ''; };
    var dates = window.slDatePicker ? window.slDatePicker.getDateRange() : { dateFrom: '', dateTo: '' };
    return {
        dateFrom:     dates.dateFrom,
        dateTo:       dates.dateTo,
        statusShopee: g('sl-filter-status-shopee'),
        statusLedger: g('sl-filter-status-ledger'),
        search:       g('sl-search')
    };
}

// ── Append filter params to query string ───────────────────
function _slAppendFilters(qs, params) {
    if (params.dateFrom)     qs += '&dateFrom='     + encodeURIComponent(params.dateFrom);
    if (params.dateTo)       qs += '&dateTo='       + encodeURIComponent(params.dateTo);
    if (params.statusShopee) qs += '&statusShopee=' + encodeURIComponent(params.statusShopee);
    if (params.statusLedger) qs += '&statusLedger=' + encodeURIComponent(params.statusLedger);
    if (params.search)       qs += '&search='       + encodeURIComponent(params.search);
    return qs;
}

// ── Load window.salesLedgerData + kick off table ───────────
async function loadSalesLedgerData() {
    var url = _slGasUrl();
    if (!url) {
        setTimeout(loadSalesLedgerData, 500);
        return;
    }
    // Coba muat data untuk AI context — non-fatal jika gagal
    try {
        var res = await fetch(url + '?action=getSalesLedgerData', { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status === 'success') window.salesLedgerData = res.ledgers || [];
    } catch(e) {
        console.warn('[SalesLedger] getSalesLedgerData tidak tersedia, dilanjutkan:', e.message);
        // Non-fatal — halaman tetap berfungsi tanpa data AI
    }
    // Selalu jalankan KPI dan tabel meski getSalesLedgerData gagal
    try { loadSalesLedgerKPI(); } catch(e) { console.warn('[SalesLedger] KPI error:', e.message); }
    try { loadSalesLedgerTable(1); } catch(e) { console.warn('[SalesLedger] Table error:', e.message); }
}

// ── Load KPI card values (v2) ───────────────────────────────
async function loadSalesLedgerKPI() {
    var url = _slGasUrl();
    if (!url) return;
    var params = _slGetFilterParams();
    var qs = _slAppendFilters('action=getSalesLedgerKPIV2', params);
    try {
        var res = await fetch(url + '?' + qs, { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status === 'success') _slUpdateKpiDom(res.kpi);
    } catch(e) {
        // Silent — KPI gagal tidak tampil error ke user
        console.warn('[SalesLedger] KPI v2 error:', e.message);
    }
}

// ── Load paged table data ───────────────────────────────────
async function loadSalesLedgerTable(page) {
    _slCurrentPage = page || 1;
    var tbody      = document.getElementById('sl-tbody');
    var mobileList = document.getElementById('sl-mobile-list');

    // Show skeleton
    if (tbody) {
        var skelFrozen1 = '<td class="sl-col-frozen-1"><div class="ds-skel" style="height:16px;width:85%;border-radius:4px"></div></td>';
        var skelFrozen2 = '<td class="sl-col-frozen-2"><div class="ds-skel" style="height:16px;width:85%;border-radius:4px"></div></td>';
        var skelFrozen3 = '<td class="sl-col-frozen-3"><div class="ds-skel" style="height:16px;width:85%;border-radius:4px"></div></td>';
        var skelShort   = '<td class="sl-col-short"><div class="ds-skel" style="height:16px;width:60%;border-radius:4px;margin:0 auto"></div></td>';
        var skelNum     = '<td class="sl-col-numeric"><div class="ds-skel" style="height:16px;width:85%;border-radius:4px;margin-left:auto"></div></td>';
        var skelStatus  = '<td class="sl-col-status"><div class="ds-skel" style="height:16px;width:85%;border-radius:4px"></div></td>';
        var skelNormal  = '<td><div class="ds-skel" style="height:16px;width:85%;border-radius:4px"></div></td>';
        var skelCols = skelFrozen1 + skelFrozen2 + skelFrozen3 +
            skelNormal + skelNormal + skelShort +
            skelNum + skelNum + skelNum + skelNum + skelNum + skelNum + skelNum +
            skelStatus + skelStatus + skelStatus + skelShort;
        tbody.innerHTML = ('<tr>' + skelCols + '</tr>').repeat(4);
    }
    if (mobileList) mobileList.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">Memuat...</div>';

    var url = _slGasUrl();
    if (!url) return;

    var params = _slGetFilterParams();
    var limit  = (document.getElementById('sl-limit') || {}).value || '25';
    var qs = 'action=getSalesLedgerPagedV2&page=' + _slCurrentPage + '&limit=' + limit;
    qs = _slAppendFilters(qs, params);

    try {
        var res = await fetch(url + '?' + qs, { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status !== 'success') throw new Error(res.message || 'Gagal memuat data');
        if (res.kpi) _slUpdateKpiDom(res.kpi);
        _slRenderTable(res.ledgers || [], res.total || 0, res.page || 1, res.totalPages || 1, parseInt(limit));
    } catch(e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="17"><div class="ds-empty"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Belum ada data penjualan.<br><small>Silakan lakukan Sync Pesanan terlebih dahulu.</small></p></div></td></tr>';
        console.warn('[SalesLedger] table error:', e.message);
    }
}

// ── Render table rows ──────────────────────────────────────
function _slRenderTable(rows, total, page, totalPages, limit) {
    var tbody      = document.getElementById('sl-tbody');
    var mobileList = document.getElementById('sl-mobile-list');
    var totalInfo  = document.getElementById('sl-total-info');
    if (totalInfo) totalInfo.textContent = total.toLocaleString('id-ID') + ' hasil';

    if (!rows.length) {
        var empty = '<div class="ds-empty"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Belum ada data penjualan.<br><small>Silakan lakukan Sync Pesanan terlebih dahulu.</small></p></div>';
        if (tbody)      tbody.innerHTML      = '<tr><td colspan="17">' + empty + '</td></tr>';
        if (mobileList) mobileList.innerHTML = empty;
        var pg = document.getElementById('sl-pagination');
        if (pg) pg.innerHTML = '';
        return;
    }

    if (tbody) {
        tbody.innerHTML = rows.map(function(r) {
            var lid = encodeURIComponent(r['Ledger ID'] || '');
            // Finance 0 dari API adalah VALID — TIDAK ada fallback ke Estimasi/Subtotal.
            // Nilai kosong (null/undefined/blank) → tampilkan "—".
            var escrowHas = _slHasValue(r['Escrow Amount']);
            var escrow    = escrowHas ? Number(r['Escrow Amount']) : null;
            var netHas    = _slHasValue(r['Net Income']);
            var netInc    = netHas ? Number(r['Net Income']) : null;
            var voucherHas = _slHasValue(r['Voucher Total']) || _slHasValue(r['Voucher']);
            var voucher   = Number(r['Voucher Total'] || r['Voucher'] || 0);
            var commFeeHas = _slHasValue(r['Commission Fee']) || _slHasValue(r['Biaya Admin']);
            var commFee   = Number(r['Commission Fee'] || r['Biaya Admin'] || 0);
            var svcFeeHas  = _slHasValue(r['Service Fee'])    || _slHasValue(r['Biaya Layanan']);
            var svcFee    = Number(r['Service Fee'] || r['Biaya Layanan'] || 0);
            var settlSt   = String(r['Settlement Status'] || '');
            var prodNama  = _slTrunc(r['Nama Produk'] || '-', 32);
            var variasi   = _slTrunc(r['Variasi'] || '-', 20);
            return '<tr>' +
                '<td class="sl-col-frozen-1 font-mono text-xs text-gray-600">' + _slTrunc(r['Order SN'] || '-', 22) + '</td>' +
                '<td class="sl-col-frozen-2 whitespace-nowrap text-sm">'       + _slFmtDate(r['Tanggal Order'])       + '</td>' +
                '<td class="sl-col-frozen-3">' +
                    '<div class="sl-produk-cell">' +
                        '<div class="sl-produk-nama">' + prodNama + '</div>' +
                        '<div class="sl-produk-meta"><span class="sl-produk-variasi">' + variasi + '</span></div>' +
                    '</div>' +
                '</td>' +
                '<td class="text-sm">'                         + _slTrunc(r['Buyer Name']   || '-', 16) + '</td>' +
                '<td class="text-gray-500 text-xs">'           + variasi + '</td>' +
                '<td class="sl-col-short text-center font-semibold">'       + (r['Qty'] || 0)                        + '</td>' +
                '<td class="sl-col-numeric text-sm">'              + _slFmtRupiah(r['Harga Produk'])         + '</td>' +
                '<td class="sl-col-numeric font-semibold">'        + _slFmtRupiah(r['Subtotal'])             + '</td>' +
                '<td class="sl-col-numeric text-xs text-orange-600">' + (voucherHas ? _slFmtRupiah(voucher) : '—')  + '</td>' +
                '<td class="sl-col-numeric text-xs">'              + (commFeeHas ? _slFmtRupiah(commFee) : '—')     + '</td>' +
                '<td class="sl-col-numeric text-xs">'              + (svcFeeHas  ? _slFmtRupiah(svcFee)  : '—')     + '</td>' +
                '<td class="sl-col-numeric font-semibold text-green-700">' + (escrowHas ? _slFmtRupiah(escrow) : '—') + '</td>' +
                '<td class="sl-col-numeric font-bold text-green-800">' + (netHas ? _slFmtRupiah(netInc) : '—')    + '</td>' +
                '<td class="sl-col-status">' + _slStatusShopeeBadge(r['Status Shopee'])    + '</td>' +
                '<td class="sl-col-status">' + _slStatusLedgerBadge(r['Status Ledger'])    + '</td>' +
                '<td class="sl-col-status">' + _slSettlementBadge(settlSt)                 + '</td>' +
                '<td class="sl-col-short"><button class="ds-btn ds-btn-ghost ds-btn-icon" onclick="openSalesLedgerDetail(\'' + lid + '\')" title="Detail"><i class="ph ph-eye"></i></button></td>' +
                '</tr>';
        }).join('');
    }

    if (mobileList) {
        mobileList.innerHTML = rows.map(function(r) {
            var lid = encodeURIComponent(r['Ledger ID'] || '');
            return '<div class="txn-card">' +
                '<div class="flex items-start justify-between gap-2 mb-2">' +
                '<div><div class="font-mono text-xs text-gray-400">' + _slTrunc(r['Order SN'] || '-', 24) + '</div>' +
                '<div class="font-semibold text-sm mt-0.5">' + _slTrunc(r['Nama Produk'] || '-', 28) + '</div>' +
                '<div class="text-xs text-gray-400 mt-0.5">' + _slFmtDate(r['Tanggal Order']) + ' · ' + _slTrunc(r['Buyer Name'] || '-', 18) + '</div></div>' +
                '<div class="text-right flex-shrink-0">' + _slStatusLedgerBadge(r['Status Ledger']) +
                '<div class="font-bold text-sm mt-1">' + _slFmtRupiah(r['Subtotal']) + '</div></div></div>' +
                '<div class="flex items-center justify-between gap-2">' +
                '<div class="flex gap-1 flex-wrap">' + _slStatusShopeeBadge(r['Status Shopee']) + _slDeductionBadge(r['Deduction Status']) + '</div>' +
                '<button class="ds-btn ds-btn-ghost ds-btn-sm" onclick="openSalesLedgerDetail(\'' + lid + '\')"><i class="ph ph-eye"></i></button>' +
                '</div></div>';
        }).join('');
    }

    _slRenderPagination(page, totalPages);
}

// ── Render pagination ──────────────────────────────────────
function _slRenderPagination(page, totalPages) {
    var el = document.getElementById('sl-pagination');
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    var html = '<div class="flex items-center gap-1 text-xs">';
    html += '<button class="ds-page-btn" onclick="loadSalesLedgerTable(' + Math.max(1, page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>‹</button>';
    var s = Math.max(1, page - 2), e = Math.min(totalPages, page + 2);
    if (s > 1) html += '<button class="ds-page-btn" onclick="loadSalesLedgerTable(1)">1</button>' + (s > 2 ? '<span class="px-1 text-gray-400">…</span>' : '');
    for (var p = s; p <= e; p++) {
        html += '<button class="ds-page-btn' + (p === page ? ' active' : '') + '" onclick="loadSalesLedgerTable(' + p + ')">' + p + '</button>';
    }
    if (e < totalPages) html += (e < totalPages - 1 ? '<span class="px-1 text-gray-400">…</span>' : '') + '<button class="ds-page-btn" onclick="loadSalesLedgerTable(' + totalPages + ')">' + totalPages + '</button>';
    html += '<button class="ds-page-btn" onclick="loadSalesLedgerTable(' + Math.min(totalPages, page + 1) + ')" ' + (page >= totalPages ? 'disabled' : '') + '>›</button>';
    html += '</div>';
    el.innerHTML = html;
}

// ── Resync Finance ─────────────────────────────────────────
async function resyncFinance() {
    var url = _slGasUrl();
    var btn = document.getElementById('sl-btn-resync-finance');
    if (!url) {
        if (typeof showToast === 'function') showToast('GAS URL belum dikonfigurasi. Cek pengaturan.', 'error');
        return;
    }
    if (btn && typeof setButtonLoading === 'function' && !setButtonLoading(btn, 'Memproses...')) return;
    console.log('[ResyncFinance] Memulai resync ke:', url);
    try {
        var offset = 0;
        var limit = 50;
        var totalProcessed = 0;
        var totalSuccess = 0;
        var totalFailed = 0;
        var failedList = [];
        var totalEligible = null;
        var finalRes = null;

        do {
            var res = await fetch(url, {
                method:   'POST',
                redirect: 'follow',
                headers:  { 'Content-Type': 'text/plain' },
                body:     JSON.stringify({ action: 'resyncFinance', offset: offset, limit: limit })
            }).then(function(r) {
                console.log('[ResyncFinance] HTTP status:', r.status);
                return r.json();
            });
            console.log('[ResyncFinance] Response:', JSON.stringify(res));

            finalRes = res;
            if (res.status !== 'success') break;

            totalProcessed += Number(res.processed || 0);
            totalSuccess += Number(res.success || 0);
            totalFailed += Number(res.failed || 0);
            if (res.failedList && res.failedList.length > 0) {
                failedList = failedList.concat(res.failedList);
            }
            if (res.totalEligible !== undefined && res.totalEligible !== null) {
                totalEligible = Number(res.totalEligible);
            }

            if (res.nextOffset === null || res.nextOffset === undefined || Number(res.nextOffset) <= offset || Number(res.processed || 0) === 0) {
                offset = null;
            } else {
                offset = Number(res.nextOffset);
            }
        } while (offset !== null);

        var ok  = finalRes && finalRes.status === 'success';
        var msg = ok
            ? 'Resync selesai: ' + totalSuccess + ' berhasil, ' + totalFailed + ' gagal dari ' + totalProcessed + ' diproses.'
            : ((finalRes && finalRes.message) || 'Resync gagal');
        if (ok && failedList.length > 0) {
            console.warn('[ResyncFinance] Gagal:', JSON.stringify(failedList));
        }
        if (typeof showToast === 'function') showToast(msg, ok ? 'success' : 'error');
        if (ok && totalProcessed > 0) loadSalesLedgerData();
    } catch(e) {
        console.error('[ResyncFinance] Error:', e.message, e.stack);
        var errMsg = e.message.indexOf('fetch') >= 0 || e.message.indexOf('Failed') >= 0
            ? 'Resync gagal: ' + e.message + '. Cek Console browser untuk detail.'
            : 'Resync error: ' + e.message;
        if (typeof showToast === 'function') showToast(errMsg, 'error');
    } finally {
        if (btn && typeof resetButton === 'function') resetButton(btn);
    }
}

// ── Refresh Finance (untuk order tertentu) ─────────────────
async function refreshFinanceSelected(orderSns) {
    var url = _slGasUrl();
    if (!url) {
        if (typeof showToast === 'function') showToast('GAS URL belum dikonfigurasi.', 'error');
        return;
    }
    if (!orderSns || !orderSns.length) return;
    console.log('[RefreshFinance] Order:', orderSns.join(', '));
    try {
        var res = await fetch(url, {
            method:   'POST',
            redirect: 'follow',
            headers:  { 'Content-Type': 'text/plain' },
            body:     JSON.stringify({ action: 'refreshFinance', orderSns: orderSns }),
            redirect: 'follow'
        }).then(function(r) {
            console.log('[RefreshFinance] HTTP status:', r.status);
            return r.json();
        });
        console.log('[RefreshFinance] Response:', JSON.stringify(res));
        var ok  = res.status === 'success';
        var msg = ok
            ? 'Finance diperbarui: ' + (res.success || 0) + ' berhasil' + (res.failed > 0 ? ', ' + res.failed + ' gagal' : '')
            : (res.message || 'Refresh gagal');
        if (typeof showToast === 'function') showToast(msg, ok ? 'success' : 'error');
        if (ok) loadSalesLedgerData();
    } catch(e) {
        console.error('[RefreshFinance] Error:', e.message);
        var errMsg = e.message.indexOf('fetch') >= 0
            ? 'Gagal menghubungi server. Pastikan GAS sudah di-deploy.'
            : 'Refresh Finance error: ' + e.message;
        if (typeof showToast === 'function') showToast(errMsg, 'error');
    }
}
async function syncSalesLedger() {
    var url = _slGasUrl();
    var btn = document.getElementById('sl-btn-sync');
    if (!url) {
        if (typeof showToast === 'function') showToast('GAS URL belum dikonfigurasi. Cek pengaturan.', 'error');
        return;
    }
    if (btn && typeof setButtonLoading === 'function' && !setButtonLoading(btn, 'Memuat...')) return;
    console.log('[Sync] Mulai sync ke:', url);
    try {
        var res = await fetch(url, {
            method:   'POST',
            redirect: 'follow',
            headers:  { 'Content-Type': 'text/plain' },
            body:     JSON.stringify({ action: 'syncShopeeOrders' }),
            redirect: 'follow'
        }).then(function(r) {
            console.log('[Sync] HTTP status:', r.status);
            return r.json();
        });
        console.log('[Sync] Response:', JSON.stringify(res));
        var ok  = res.status === 'success';
        var msg = ok
            ? 'Sync selesai. Ledger baru: ' + (res.newLedger || 0) + ', diperbarui: ' + (res.updatedLedger || 0) +
              (res.paymentFetched ? ', payment: ' + res.paymentFetched : '')
            : (res.message || 'Sync gagal');
        if (typeof showToast === 'function') showToast(msg, ok ? 'success' : 'error');
        if (ok) loadSalesLedgerData();
    } catch(e) {
        console.error('[Sync] Error:', e.message, e.stack);
        var errMsg = e.message.indexOf('fetch') >= 0 || e.message.indexOf('Failed') >= 0
            ? 'Sync gagal: ' + e.message + '. Cek Console browser untuk detail.'
            : 'Sync error: ' + e.message;
        if (typeof showToast === 'function') showToast(errMsg, 'error');
    } finally {
        if (btn && typeof resetButton === 'function') resetButton(btn);
    }
}

// ── Detail Drawer v2 (7 seksi seperti Shopee Seller Centre) ──
async function openSalesLedgerDetail(encodedId) {
    var url    = _slGasUrl();
    var lid    = decodeURIComponent(encodedId);
    var drawer = document.getElementById('sl-detail-drawer');
    var overlay= document.getElementById('sl-drawer-overlay');
    var body   = document.getElementById('sl-drawer-body');
    var snEl   = document.getElementById('sl-drawer-order-sn');
    if (!drawer) return;
    drawer.classList.remove('translate-x-full');
    if (overlay) overlay.classList.remove('hidden');
    if (body) body.innerHTML = '<div class="ds-empty"><div class="loader"></div></div>';
    if (!url) return;

    try {
        var res = await fetch(url + '?action=getSalesLedgerDetailV2&ledgerId=' + encodeURIComponent(lid), { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status !== 'success') throw new Error(res.message || 'Data tidak ditemukan');
        var d   = res.detail;
        var sc  = d.sections || {};
        var p   = sc.rincian_pembayaran || {};
        var o   = sc.rincian_ongkir     || {};
        var fee = sc.biaya_marketplace  || {};
        var adj = sc.penyesuaian        || {};
        var pnd = sc.pendapatan         || {};
        var pro = sc.informasi_produk   || {};
        var ord = sc.informasi_pesanan  || {};
        var hasData = d.has_payment_data;
        var logicalLines = d.lines || [];

        if (snEl) snEl.textContent = ord.order_sn || '-';

        var noData = '<span class="text-xs text-gray-400 italic">Data belum tersedia — klik Refresh Finance</span>';

        function row(label, val, cls) {
            return '<div class="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">' +
                '<span class="text-xs text-gray-500">' + label + '</span>' +
                '<span class="text-xs font-medium ' + (cls || '') + '">' + val + '</span></div>';
        }
        function section(title, content) {
            return '<div class="mb-4"><div class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">' + title + '</div>' +
                '<div class="ds-card p-3">' + content + '</div></div>';
        }
        function lineDetail(line, index) {
            return '<div class="py-2 border-b border-gray-100 last:border-0">' +
                '<div class="text-xs font-semibold">Line ' + (index + 1) + ': ' + _slTrunc(line['Nama Produk'] || '-', 42) + '</div>' +
                '<div class="text-xs text-gray-500 mt-1">' + (line['Variasi'] || '-') + ' | SKU: ' + (line['SKU Inventaris'] || line['SKU Shopee'] || '-') + '</div>' +
                '<div class="text-xs text-gray-500 mt-1">Item ID: ' + (line['Item ID'] || '-') + ' | Model ID: ' + (line['Model ID'] || '-') + '</div>' +
                '<div class="text-xs text-gray-700 mt-1">Qty ' + (line['Qty'] || 0) + ' x ' + _slFmtRupiah(line['Harga Produk'] || 0) + ' = ' + _slFmtRupiah(line['Product Subtotal'] || line.Subtotal || 0) + '</div>' +
            '</div>';
        }

        body.innerHTML =
            // Buyer avatar
            '<div class="flex items-center gap-3 mb-5">' +
            '<div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg flex-shrink-0">' + (d.buyer_avatar_initial || '?') + '</div>' +
            '<div><div class="font-semibold text-sm">' + (ord.buyer_name || '-') + '</div>' +
            '<div class="text-xs text-gray-400">' + _slFmtDate(ord.tanggal_order) + '</div></div>' +
            '</div>' +

            // Seksi 1: Informasi Pesanan
            section('Informasi Pesanan',
                row('No. Pesanan', '<span class="font-mono text-xs">' + (ord.order_sn || '-') + '</span>') +
                row('Waktu Pesanan', _slFmtDate(ord.tanggal_order)) +
                row('Pembeli', ord.buyer_name || '-') +
                row('Status Pesanan', _slStatusShopeeBadge(ord.status_shopee)) +
                row('Status Transaksi', _slStatusLedgerBadge(ord.status_ledger))
            ) +

            // Seksi 2: Informasi Produk
            section('Informasi Produk',
                row('Produk', _slTrunc(pro.nama_produk || '-', 40)) +
                row('Variasi', pro.variasi || '-') +
                row('SKU', pro.sku_inventaris || '-') +
                row('Jumlah', (pro.qty || 0)) +
                row('Harga Produk', _slFmtRupiah(pro.harga_produk)) +
                row('Logical Lines', String(logicalLines.length))
            ) +

            (logicalLines.length > 1 ? section('Rincian Logical Line', logicalLines.map(lineDetail).join('')) : '') +

            // Seksi 3–7 conditional
            (hasData ?
                section('Informasi Pembayaran',
                    row('Subtotal Pesanan', _slFmtRupiah(p.product_subtotal), 'font-semibold') +
                    row('Voucher Shopee',  _slHasValue(p.shopee_voucher) ? '-' + _slFmtRupiah(p.shopee_voucher) : '—', 'text-orange-500') +
                    row('Voucher Toko',    _slHasValue(p.seller_voucher) ? '-' + _slFmtRupiah(p.seller_voucher) : '—', 'text-orange-500') +
                    row('Koin Shopee',     _slHasValue(p.shop_voucher)   ? '-' + _slFmtRupiah(p.shop_voucher)   : '—', 'text-orange-500')
                ) +
                section('Ongkos Kirim',
                    row('Ongkos Kirim Dibayar Pembeli', _slHasValue(p.shipping_fee_buyer) ? _slFmtRupiah(o.shipping_fee_buyer) : '—') +
                    row('Potongan Ongkir dari Shopee', _slHasValue(o.shipping_subsidy_shopee) ? _slFmtRupiah(o.shipping_subsidy_shopee) : '—', 'text-green-600') +
                    row('Subsidi Ongkir Seller',  _slHasValue(o.shipping_subsidy_seller) ? _slFmtRupiah(o.shipping_subsidy_seller) : '—', 'text-green-600')
                ) +
                section('Biaya Lainnya',
                    row('Biaya Administrasi',   _slHasValue(fee.commission_fee)    ? '-' + _slFmtRupiah(fee.commission_fee)    : '—', 'text-red-500') +
                    row('Biaya Layanan',         _slHasValue(fee.service_fee)       ? '-' + _slFmtRupiah(fee.service_fee)       : '—', 'text-red-500') +
                    row('Biaya Kampanye',        _slHasValue(fee.campaign_fee)      ? '-' + _slFmtRupiah(fee.campaign_fee)      : '—', 'text-red-500') +
                    row('Biaya Proses Pesanan',  _slHasValue(fee.transaction_fee)   ? '-' + _slFmtRupiah(fee.transaction_fee)   : '—', 'text-red-500') +
                    (Number(d['Other Fee'] || 0) !== 0 ? row('Biaya Komisi AMS', '-' + _slFmtRupiah(d['Other Fee']), 'text-red-500') : '')
                ) +
                section('Penyesuaian Pesanan',
                    row('Pengembalian', _slHasValue(adj.refund)     ? _slFmtRupiah(adj.refund)     : '—') +
                    row('Penyesuaian',  _slHasValue(adj.adjustment) ? _slFmtRupiah(adj.adjustment) : '—')
                ) +
                section('Pendapatan',
                    row('Estimasi Pendapatan', _slFmtRupiah(pnd.escrow_amount), 'text-green-700 font-bold text-sm') +
                    row('Pendapatan Bersih',   _slFmtRupiah(pnd.net_income),    'text-green-800 font-bold') +
                    row('Status Pencairan',    _slSettlementBadge(pnd.settlement_status))
                )
            :
                section('Data Finansial',
                    '<div class="py-3 text-center text-xs text-gray-400 italic">Data finansial belum tersedia.</div>' +
                    '<button class="ds-btn ds-btn-secondary ds-btn-sm w-full mt-2" onclick="refreshFinanceSelected([\'' + (ord.order_sn || '') + '\'])">' +
                    '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' +
                    ' Refresh Finance</button>'
                )
            );

    } catch(e) {
        if (body) body.innerHTML = '<div class="ds-empty"><i class="ph ph-warning-circle"></i><p>' + e.message + '</p></div>';
    }
}

// ── Refresh Finance dari drawer (ambil order SN dari header drawer) ──
async function refreshFinanceDrawer() {
    var snEl = document.getElementById('sl-drawer-order-sn');
    var orderSn = snEl ? (snEl.textContent || '').trim() : '';
    if (!orderSn || orderSn === '—') {
        if (typeof showToast === 'function') showToast('Order SN tidak ditemukan.', 'error');
        return;
    }
    var btn = document.getElementById('sl-btn-drawer-refresh');
    if (btn && typeof setButtonLoading === 'function' && !setButtonLoading(btn, 'Memproses...')) return;
    try {
        await refreshFinanceSelected([orderSn]);
        // Reload drawer setelah refresh
        var body = document.getElementById('sl-drawer-body');
        if (body) {
            // Cari ledger ID dari tabel atau re-open dengan order SN
            // Fallback: reload tabel dan tampilkan pesan sukses
            loadSalesLedgerData();
        }
    } finally {
        if (btn && typeof resetButton === 'function') resetButton(btn);
    }
}

function closeSalesLedgerDetail() {
    var drawer  = document.getElementById('sl-detail-drawer');
    var overlay = document.getElementById('sl-drawer-overlay');
    if (drawer)  drawer.classList.add('translate-x-full');
    if (overlay) overlay.classList.add('hidden');
}

// ── CSV helper (RFC 4180) ──────────────────────────────────
function _toCsvRow(values) {
    return values.map(function(v) {
        var s = String(v == null ? '' : v);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }).join(',');
}

var _slSettlementExportFields = [
    'Voucher', 'Ongkir', 'Biaya Admin', 'Biaya Layanan', 'Total Dibayar',
    'Estimasi Pendapatan', 'Voucher Total', 'Shopee Voucher', 'Seller Voucher',
    'Shop Voucher', 'Shipping Fee Buyer', 'Shipping Subsidy Shopee',
    'Shipping Subsidy Seller', 'Commission Fee', 'Service Fee', 'Campaign Fee',
    'Transaction Fee', 'Adjustment', 'Refund', 'Other Fee', 'Escrow Amount',
    'Net Income', 'Settlement Status', 'Settlement Sync'
];

function _slExportLogicalLines(orders) {
    var result = [];
    (orders || []).forEach(function(order) {
        var lines = order.lines || [order];
        lines.forEach(function(line, index) {
            var exported = Object.assign({}, line);
            var isOwner = line['Settlement Owner'] === true || String(line['Settlement Owner'] || '').toUpperCase() === 'TRUE' || (!Object.prototype.hasOwnProperty.call(line, 'Settlement Owner') && index === 0);
            exported['Semantic Level'] = 'LOGICAL_LINE';
            exported['Line Count'] = lines.length;
            exported['Logical Line Key'] = line['Logical Line Key'] || [line['Order SN'] || '', line['Item ID'] || '', line['Model ID'] || ''].join('|');
            exported['Settlement Owner'] = isOwner ? 'TRUE' : 'FALSE';
            _slSettlementExportFields.forEach(function(field) {
                exported[field] = isOwner ? (line[field] !== undefined ? line[field] : (order[field] || '')) : '';
            });
            result.push(exported);
        });
    });
    return result;
}

// ── Export Excel v2 ───────────────────────────────────────
async function exportSalesLedgerExcel() {
    var url = _slGasUrl();
    if (!url) return;
    if (typeof XLSX === 'undefined') {
        if (typeof showToast === 'function') showToast('SheetJS belum dimuat. Coba muat ulang halaman.', 'error');
        return;
    }
    if (typeof showToast === 'function') showToast('Mengambil data untuk export...', 'info');
    var qs = _slAppendFilters('action=getSalesLedgerPagedV2&page=1&limit=9999', _slGetFilterParams());
    try {
        var res = await fetch(url + '?' + qs, { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status !== 'success') throw new Error(res.message);
        var hdrs = ['Semantic Level','Line Count','Logical Line Key','Settlement Owner','Ledger ID','Order SN','Item ID','Model ID','Tanggal Order','Tanggal Update',
            'Buyer Username','Buyer Name','Nama Produk','Variasi','SKU Shopee','SKU Inventaris',
            'Qty','Harga Produk','Subtotal','Voucher','Ongkir','Biaya Admin','Biaya Layanan',
            'Total Dibayar','Estimasi Pendapatan','Status Shopee','Status Ledger',
            'Deduction Status','Mapping Status','Sync Time','Last Modified',
            'Original Price','Selling Price','Product Subtotal','Voucher Total',
            'Shopee Voucher','Seller Voucher','Shop Voucher','Shipping Fee Buyer',
            'Shipping Subsidy Shopee','Shipping Subsidy Seller','Commission Fee','Service Fee',
            'Campaign Fee','Transaction Fee','Adjustment','Refund','Other Fee',
            'Escrow Amount','Net Income','Settlement Status'];
        var exportRows = _slExportLogicalLines(res.ledgers || []);
        var aoa = [hdrs].concat(exportRows.map(function(r) {
            return hdrs.map(function(h) {
                return r[h] !== undefined ? r[h] : '';
            });
        }));
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Laporan Penjualan');
        XLSX.writeFile(wb, 'laporan-penjualan-v2-' + formatExportDate(new Date()) + '.xlsx');
        if (typeof showToast === 'function') showToast('Export Excel berhasil (' + exportRows.length + ' logical line)', 'success');
    } catch(e) {
        if (typeof showToast === 'function') showToast('Export Excel gagal: ' + e.message, 'error');
    }
}

// ── Export CSV v2 ──────────────────────────────────────────
async function exportSalesLedgerCSV() {
    var url = _slGasUrl();
    if (!url) return;
    if (typeof showToast === 'function') showToast('Mengambil data untuk export CSV...', 'info');
    var qs = _slAppendFilters('action=getSalesLedgerPagedV2&page=1&limit=9999', _slGetFilterParams());
    try {
        var res = await fetch(url + '?' + qs, { redirect: 'follow' }).then(function(r) { return r.json(); });
        if (res.status !== 'success') throw new Error(res.message);
        var hdrs = ['Semantic Level','Line Count','Logical Line Key','Settlement Owner','Ledger ID','Order SN','Item ID','Model ID','Tanggal Order','Tanggal Update',
            'Buyer Username','Buyer Name','Nama Produk','Variasi','SKU Shopee','SKU Inventaris',
            'Qty','Harga Produk','Subtotal','Voucher','Ongkir','Biaya Admin','Biaya Layanan',
            'Total Dibayar','Estimasi Pendapatan','Status Shopee','Status Ledger',
            'Deduction Status','Mapping Status','Sync Time','Last Modified',
            'Original Price','Selling Price','Product Subtotal','Voucher Total',
            'Shopee Voucher','Seller Voucher','Shop Voucher','Shipping Fee Buyer',
            'Shipping Subsidy Shopee','Shipping Subsidy Seller','Commission Fee','Service Fee',
            'Campaign Fee','Transaction Fee','Adjustment','Refund','Other Fee',
            'Escrow Amount','Net Income','Settlement Status'];
        var exportRows = _slExportLogicalLines(res.ledgers || []);
        var lines = [_toCsvRow(hdrs)].concat(exportRows.map(function(r) {
            return _toCsvRow(hdrs.map(function(h) {
                return r[h] !== undefined ? r[h] : '';
            }));
        }));
        var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'laporan-penjualan-v2-' + formatExportDate(new Date()) + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        if (typeof showToast === 'function') showToast('Export CSV berhasil (' + exportRows.length + ' logical line)', 'success');
    } catch(e) {
        if (typeof showToast === 'function') showToast('Export CSV gagal: ' + e.message, 'error');
    }
}

// ── Print ──────────────────────────────────────────────────
function printSalesLedger() {
    var printArea = document.getElementById('print-area');
    var table     = document.getElementById('sl-table');
    if (printArea && table) {
        printArea.innerHTML = '<h2 style="margin-bottom:1rem;font-size:1.1rem;font-weight:bold">Laporan Penjualan — ' +
            formatDate(new Date()) + '</h2>' + table.outerHTML;
    }
    window.print();
}
