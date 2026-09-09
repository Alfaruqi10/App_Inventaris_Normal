import { parseDateString } from '../utils/dateParser.js';
import { getJakartaTimeString } from '../utils/dateFormatter.js';
import {
  getSalesLedgerLineSummary,
  getSalesLedgerOrderSummary
} from './salesLedgerSemantics.js';

export class FinanceService {
  constructor(financeRepository, shopeeService) {
    this.financeRepo = financeRepository;
    this.shopeeService = shopeeService;
  }

  /**
   * Helper: filter baris berdasarkan params.
   */
  _slFilterRow(row, p) {
    if (!p) return true;
    
    if (p.dateFrom || p.dateTo) {
      const tglStr = row['Tanggal Order'];
      if (tglStr) {
        const tgl = parseDateString(tglStr);
        if (tgl) {
          if (p.dateFrom) {
            const df = new Date(p.dateFrom);
            df.setHours(0, 0, 0, 0);
            if (tgl < df) return false;
          }
          if (p.dateTo) {
            const dt = new Date(p.dateTo);
            dt.setHours(23, 59, 59, 999);
            if (tgl > dt) return false;
          }
        }
      }
    }
    
    if (p.statusShopee && p.statusShopee !== '' && p.statusShopee !== 'ALL') {
      if (String(row['Status Shopee'] || '').trim().toUpperCase() !== p.statusShopee.trim().toUpperCase()) return false;
    }
    
    if (p.statusLedger && p.statusLedger !== '' && p.statusLedger !== 'ALL') {
      if (String(row['Status Ledger'] || '').trim().toUpperCase() !== p.statusLedger.trim().toUpperCase()) return false;
    }
    
    if (p.search && p.search.trim() !== '') {
      const q = p.search.trim().toLowerCase();
      const hay = [
        String(row['Order SN'] || ''),
        String(row['Buyer Name'] || ''),
        String(row['Nama Produk'] || ''),
        String(row['Variasi'] || ''),
        String(row['SKU Inventaris'] || '')
      ].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    
    return true;
  }

  /**
   * Helper: Cek apakah status return/cancel.
   */
  _isReturnCancelStatus(st) {
    const status = String(st || "").toUpperCase().trim();
    return status === 'TO_RETURN' || status === 'RETURNED' || status === 'IN_CANCEL' || status === 'CANCELLED';
  }

  /**
   * Helper: Hitung 7 KPI v2 dari array baris.
   */
  _slCalcKPIV2(rows) {
    let totalOmzet = 0;
    let pendapatanBersih = 0;
    let totalQty = 0;
    let voucherShopee = 0;
    let voucherSeller = 0;
    let totalFee = 0;
    const orderSnSet = new Set();
    
    // SELESAI + DIBATALKAN + RETUR dihitung konsisten — KPI mengikuti filter tabel,
    // menggunakan data finance asli di SalesLedger (escrow order dibatalkan umumnya 0).
    const activeStatuses = ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'TO_CONFIRM_RECEIVE',
                            'COMPLETED', 'TO_RETURN', 'RETURNED', 'IN_CANCEL', 'CANCELLED'];
    
    const orderSummaries = getSalesLedgerOrderSummary(rows, { strict: false });
    orderSummaries.forEach(summary => {
      const st = String(summary.order['Status Shopee'] || '').toUpperCase().trim();
      if (!activeStatuses.includes(st)) return;
      const settlement = summary.settlement || {};
      const lineSummary = getSalesLedgerLineSummary(summary.lines, { strict: false });
      orderSnSet.add(summary.orderSn);
      totalQty += lineSummary.totalQty;
      totalOmzet += lineSummary.grossProductRevenue;
      pendapatanBersih += Number(settlement['Escrow Amount'] || 0);
      voucherShopee += Number(settlement['Shopee Voucher'] || 0);
      voucherSeller += Number(settlement['Seller Voucher'] || 0);
      totalFee += Number(settlement['Commission Fee'] || settlement['Biaya Admin'] || 0)
                + Number(settlement['Service Fee'] || settlement['Biaya Layanan'] || 0)
                + Number(settlement['Campaign Fee'] || 0)
                + Number(settlement['Transaction Fee'] || 0);
    });
    
    return {
      totalOmzet,
      pendapatanBersih,
      totalPesanan: orderSnSet.size,
      totalQty,
      voucherShopee,
      voucherSeller,
      totalFee
    };
  }

  /**
   * GET getSalesLedgerPagedV2 — data tabel + paginasi + 7 KPI.
   */
  async getSalesLedgerPagedV2(params) {
    try {
      const p = params || {};
      const page = Math.max(1, parseInt(p.page || '1', 10));
      let limit = Math.max(1, parseInt(p.limit || '25', 10));
      if (limit > 500) limit = 500;

      const rows = await this.financeRepo.getSalesLedgers();
      const orders = getSalesLedgerOrderSummary(rows, { strict: false });
      const filteredOrders = orders.filter(summary => summary.lines.some(row => this._slFilterRow(row, p)));

      // Order list remains one Order SN per record. Detail carries its logical lines.
      filteredOrders.sort((a, b) => {
        const da = parseDateString(a.order['Tanggal Order']) || new Date(0);
        const db = parseDateString(b.order['Tanggal Order']) || new Date(0);
        return db - da;
      });
      const filteredRows = filteredOrders.flatMap(summary => summary.lines);
      const kpi = this._slCalcKPIV2(filteredRows);
      const total = filteredOrders.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const targetPage = Math.min(page, totalPages);
      const ledgers = filteredOrders.slice((targetPage - 1) * limit, targetPage * limit).map(summary => ({
        ...summary.order,
        ...(summary.settlement || {}),
        'Line Count': summary.lines.length,
        lines: summary.lines
      }));

      return {
        status: 'success',
        ledgers,
        total,
        page: targetPage,
        totalPages,
        kpi
      };
    } catch (err) {
      console.error('[FinanceService ERROR] getSalesLedgerPagedV2 failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }

  /**
   * GET getSalesLedgerKPIV2 — 7 KPI saja.
   */
  async getSalesLedgerKPIV2(params) {
    try {
      const p = params || {};
      const rows = await this.financeRepo.getSalesLedgers();
      const filtered = getSalesLedgerOrderSummary(rows, { strict: false })
        .filter(summary => summary.lines.some(row => this._slFilterRow(row, p)))
        .flatMap(summary => summary.lines);
      return {
        status: 'success',
        kpi: this._slCalcKPIV2(filtered)
      };
    } catch (err) {
      console.error('[FinanceService ERROR] getSalesLedgerKPIV2 failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }

  /**
   * GET getSalesLedgerDetailV2 — detail 1 baris dengan 7 seksi.
   */
  async getSalesLedgerDetailV2(params) {
    try {
      const p = params || {};
      const ledgerId = String(p.ledgerId || '').trim();
      if (!ledgerId) {
        return { status: 'error', message: 'ledgerId wajib ada.' };
      }

      const rows = await this.financeRepo.getSalesLedgers();
      const found = rows.find(r => String(r['Ledger ID'] || '').trim() === ledgerId);
      
      if (!found) {
        return { status: 'error', message: 'Ledger tidak ditemukan.' };
      }

      const summary = getSalesLedgerOrderSummary(rows, { strict: false })
        .find(order => order.orderSn === String(found['Order SN'] || '').trim());
      const settlement = summary?.settlement || {};
      const hasPayment = Number(settlement['Escrow Amount'] || 0) !== 0;
      const detail = { ...found, ...settlement, lines: summary?.lines || [found] };
      detail.buyer_avatar_initial = String(found['Buyer Name'] || '?').charAt(0).toUpperCase();
      detail.has_payment_data = hasPayment;
      
      detail.sections = {
        informasi_pesanan: {
          order_sn: found['Order SN'] || '',
          buyer_name: found['Buyer Name'] || '',
          status_shopee: found['Status Shopee'] || '',
          status_ledger: found['Status Ledger'] || '',
          tanggal_order: found['Tanggal Order'] || '',
          tanggal_update: found['Tanggal Update'] || ''
        },
        informasi_produk: {
          nama_produk: found['Nama Produk'] || '',
          variasi: found['Variasi'] || '',
          sku_inventaris: found['SKU Inventaris'] || '',
          qty: Number(found['Qty'] || 0),
          harga_produk: Number(found['Harga Produk'] || 0),
          original_price: Number(found['Original Price'] || found['Harga Produk'] || 0),
          selling_price: (typeof found['Selling Price'] === 'string' && found['Selling Price'].includes(';'))
            ? found['Selling Price']
            : Number(found['Selling Price'] || found['Harga Produk'] || 0)
        },
        rincian_pembayaran: {
          product_subtotal: Number(found['Product Subtotal'] || found['Subtotal'] || 0),
          shopee_voucher: Number(settlement['Shopee Voucher'] || 0),
          seller_voucher: Number(settlement['Seller Voucher'] || 0),
          shop_voucher: Number(settlement['Shop Voucher'] || 0),
          voucher_total: Number(settlement['Voucher Total'] || settlement.Voucher || 0)
        },
        rincian_ongkir: {
          shipping_fee_buyer: Number(settlement['Shipping Fee Buyer'] || settlement.Ongkir || 0),
          shipping_subsidy_shopee: Number(settlement['Shipping Subsidy Shopee'] || 0),
          shipping_subsidy_seller: Number(settlement['Shipping Subsidy Seller'] || 0)
        },
        biaya_marketplace: {
          commission_fee: Number(settlement['Commission Fee'] || settlement['Biaya Admin'] || 0),
          service_fee: Number(settlement['Service Fee'] || settlement['Biaya Layanan'] || 0),
          campaign_fee: Number(settlement['Campaign Fee'] || 0),
          transaction_fee: Number(settlement['Transaction Fee'] || 0)
        },
        penyesuaian: {
          adjustment: Number(settlement.Adjustment || 0),
          refund: Number(settlement.Refund || 0),
          other_fee: Number(settlement['Other Fee'] || 0)
        },
        pendapatan: {
          escrow_amount: Number(settlement['Escrow Amount'] || 0),
          net_income: Number(settlement['Net Income'] || settlement['Escrow Amount'] || 0),
          settlement_status: String(settlement['Settlement Status'] || '')
        }
      };

      return {
        status: 'success',
        detail
      };
    } catch (err) {
      console.error('[FinanceService ERROR] getSalesLedgerDetailV2 failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }

  /**
   * Helper: Uji & tarik data Payment Escrow Shopee API.
   */
  async _fetchPaymentEscrow(orderSn, statusShopee) {
    if (statusShopee) {
      const validStatus = ["COMPLETED", "TO_CONFIRM_RECEIVE"];
      if (!validStatus.includes(String(statusShopee).toUpperCase())) {
        return { success: false, error: "invalid_status", message: "Order belum selesai: " + statusShopee };
      }
    }

    try {
      const res = await this.shopeeService.shopeeGet("/api/v2/payment/get_escrow_detail", { order_sn: orderSn });
      if (res && res.response) {
        return { success: true, data: res.response };
      } else {
        return { success: false, error: "empty_response", message: "Respons API Shopee kosong." };
      }
    } catch (err) {
      return { success: false, error: "network_error", message: err.message };
    }
  }

  _getSettlementSyncIndex(headers) {
    const settlementSyncIdx = headers.indexOf('Settlement Sync');
    if (settlementSyncIdx >= 0) return settlementSyncIdx;

    const legacySyncIdx = headers.indexOf('Sync Status');
    return legacySyncIdx >= 0 ? legacySyncIdx : -1;
  }

  /**
   * Helper: Petakan respons order_income ke baris SalesLedger.
   */
  _mapPaymentToLedgerCols(paymentData, headers) {
    if (!paymentData) return {};
    const inc = paymentData.order_income || {};
    const items = paymentData.items || [];
    const item0 = items[0] || {};

    // RULE 10: field ABSENT di response ≠ 0 — undefined → TIDAK ditulis.
    const presentNum = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const numOrUndef = (v) => {
      if (!presentNum(v)) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const firstNum = (vals) => {
      for (const v of vals) {
        if (!presentNum(v)) continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return '';
    };

    const originalPrice = numOrUndef(item0.original_price);

    let sellingPrice = "";
    let productSubtotal = 0;
    let priceSourcePresent = false;

    if (items && items.length > 0) {
      const prices = [];
      let calcSubtotal = 0;
      items.forEach(it => {
        const p = (it.selling_price !== undefined && it.selling_price !== null && it.selling_price !== "")
          ? Number(it.selling_price)
          : Number(it.discounted_price || it.original_price || 0);
        const q = Number(it.quantity_purchased || it.model_quantity_purchased || it.qty || 1);
        const validP = isNaN(p) ? 0 : p;
        const validQ = isNaN(q) ? 1 : q;

        calcSubtotal += validP * validQ;

        for (let k = 0; k < validQ; k++) {
          prices.push(validP);
        }
      });

      if (prices.length === 1) {
        sellingPrice = prices[0];
      } else {
        sellingPrice = prices.join(";");
      }
      productSubtotal = calcSubtotal;
      priceSourcePresent = true;
    } else {
      // Fallback order-level HANYA jika nilai benar-benar ada di API
      const fallbackPrice = Number(inc.order_selling_price || inc.cost_of_goods_sold || 0);
      sellingPrice = isNaN(fallbackPrice) ? 0 : fallbackPrice;
      productSubtotal = sellingPrice;
      priceSourcePresent = presentNum(inc.order_selling_price) || presentNum(inc.cost_of_goods_sold);
    }

    // RULE 10 (lanjutan): nilai derived dihitung dengan presence check.
    // RULE 11: ITEM-LEVEL AGGREGATION — untuk order DIBATALKAN field level order
    // sering 0, TETAPI level item (order_income.items) memuat nilai ASLI dari API:
    // discount_from_voucher_shopee / discount_from_voucher_seller / seller_order_processing_fee.
    // Aturan: pakai level order bila ADA dan ≠ 0; bila 0/absent → jumlah level item.
    const itemSum = (prop) => {
      let s = 0, has = false;
      items.forEach(it => {
        if (!presentNum(it[prop])) return;
        const n = Number(it[prop]);
        if (Number.isFinite(n)) { s += n; has = true; }
      });
      return has ? s : '';
    };

    const vShopeeOrder = firstNum([inc.voucher_from_shopee]);
    const vSellerOrder = firstNum([inc.voucher_from_seller]);
    const vShopeeItem = itemSum('discount_from_voucher_shopee');
    const vSellerItem = itemSum('discount_from_voucher_seller');
    const vShopee = (vShopeeOrder !== '' && Number(vShopeeOrder) !== 0) ? Number(vShopeeOrder) : (vShopeeItem !== '' ? vShopeeItem : vShopeeOrder);
    const vSeller = (vSellerOrder !== '' && Number(vSellerOrder) !== 0) ? Number(vSellerOrder) : (vSellerItem !== '' ? vSellerItem : vSellerOrder);
    const voucherTotal = (vShopee === '' && vSeller === '') ? undefined : (Number(vShopee || 0) + Number(vSeller || 0));

    const txnOrder = firstNum([inc.seller_order_processing_fee, inc.seller_transaction_fee, inc.buyer_transaction_fee]);
    const txnItem = itemSum('seller_order_processing_fee');
    const txnVal = (txnOrder !== '' && Number(txnOrder) !== 0) ? Number(txnOrder) : (txnItem !== '' ? txnItem : txnOrder);
    // Biaya Komisi AMS: prefer NONZERO (order_ams_commission_fee → ads_escrow_top_up
    // → item0.ams_commission_fee); semua 0 tapi ADA → 0; semua absent → undefined.
    const amsOrderVal = firstNum([inc.order_ams_commission_fee]);
    const amsAdsVal = firstNum([inc.ads_escrow_top_up_fee_or_technical_support_fee]);
    const amsItemVal = firstNum([item0.ams_commission_fee]);
    let amsVal = '';
    if (amsOrderVal !== '' && Number(amsOrderVal) !== 0) amsVal = Number(amsOrderVal);
    else if (amsAdsVal !== '' && Number(amsAdsVal) !== 0) amsVal = Number(amsAdsVal);
    else if (amsItemVal !== '' && Number(amsItemVal) !== 0) amsVal = Number(amsItemVal);
    else if (amsOrderVal !== '' || amsAdsVal !== '' || amsItemVal !== '') amsVal = 0;
    const shopVoucherVal = firstNum([inc.coins, inc.buyer_shopee_coins]);
    const escrowVal = firstNum([inc.escrow_amount]);
    const netIncomeVal = firstNum([inc.escrow_amount_after_adjustment, inc.escrow_amount]);
    // Refund: drc_adjustable_refund dulu; bila 0/absent → seller_return_refund (negatif =
    // uang dikembalikan ke pembeli) untuk order DIBATALKAN — keduanya data ASLI dari API.
    // Bila keduanya 0 namun ADA di response → tulis 0.
    const drcRefundVal = firstNum([inc.drc_adjustable_refund]);
    const srRefundVal = firstNum([inc.seller_return_refund]);
    let refundVal = '';
    if (drcRefundVal !== '' && Number(drcRefundVal) !== 0) refundVal = Number(drcRefundVal);
    else if (srRefundVal !== '' && Number(srRefundVal) !== 0) refundVal = Number(srRefundVal);
    else if (drcRefundVal !== '' || srRefundVal !== '') refundVal = 0;

    const headerValMap = {
      'Original Price': originalPrice,
      'Selling Price': priceSourcePresent ? sellingPrice : undefined,
      'Product Subtotal': priceSourcePresent ? productSubtotal : undefined,
      'Voucher Total': voucherTotal,
      'Shopee Voucher': vShopee === '' ? undefined : vShopee,
      'Seller Voucher': vSeller === '' ? undefined : vSeller,
      'Shop Voucher': shopVoucherVal === '' ? undefined : shopVoucherVal,
      'Shipping Fee Buyer': numOrUndef(inc.buyer_paid_shipping_fee),
      'Shipping Subsidy Shopee': numOrUndef(inc.shopee_shipping_rebate),
      'Shipping Subsidy Seller': undefined, // Endpoint ini tidak menyediakan field tersebut.
      'Commission Fee': numOrUndef(inc.commission_fee),
      'Service Fee': numOrUndef(inc.service_fee),
      'Campaign Fee': numOrUndef(inc.campaign_fee),
      'Transaction Fee': txnVal === '' ? undefined : txnVal,
      'Adjustment': numOrUndef(inc.total_adjustment_amount),
      'Refund': refundVal === '' ? undefined : refundVal,
      'Other Fee': amsVal === '' ? undefined : amsVal,
      'Escrow Amount': escrowVal === '' ? undefined : escrowVal,
      'Net Income': netIncomeVal === '' ? undefined : netIncomeVal,
      'Settlement Status': presentNum(inc.order_status) ? String(inc.order_status) : undefined
    };

    const fallbackColMap = {
      27: 'Original Price',
      28: 'Selling Price',
      29: 'Product Subtotal',
      30: 'Voucher Total',
      31: 'Shopee Voucher',
      32: 'Seller Voucher',
      33: 'Shop Voucher',
      34: 'Shipping Fee Buyer',
      35: 'Shipping Subsidy Shopee',
      36: 'Shipping Subsidy Seller',
      37: 'Commission Fee',
      38: 'Service Fee',
      39: 'Campaign Fee',
      40: 'Transaction Fee',
      41: 'Adjustment',
      42: 'Refund',
      43: 'Other Fee',
      44: 'Escrow Amount',
      45: 'Net Income',
      47: 'Settlement Status'
    };

    const cols = {};
    if (Array.isArray(headers) && headers.length > 0) {
      Object.entries(headerValMap).forEach(([headerName, value]) => {
        if (value === undefined) return; // field absent di API → TIDAK ditulis
        const idx = headers.indexOf(headerName);
        if (idx >= 0) cols[idx] = value;
      });
      return cols;
    }

    Object.entries(fallbackColMap).forEach(([idx, headerName]) => {
      if (headerValMap[headerName] === undefined) return; // field absent di API → TIDAK ditulis
      cols[idx] = headerValMap[headerName];
    });
    return cols;
  }

  /**
   * Helper (fix Payment Method, CASE A): ambil payment_method dari Order Detail API.
   * Batch maks 50 per panggilan. Endpoint & mapper SAMA dengan GAS golden reference
   * (syncHistoricalPaymentMethods).
   */
  async _fetchPaymentMethods(orderSns) {
    const unique = [];
    const seen = {};
    (orderSns || []).forEach(s => {
      const sn = String(s || '').trim();
      if (sn && !seen[sn]) {
        seen[sn] = true;
        unique.push(sn);
      }
    });

    const paymentMap = {};
    let fetchedCount = 0;
    let failedBatches = 0;

    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      try {
        const res = await this.shopeeService.shopeeGet('/api/v2/order/get_order_detail', {
          order_sn_list: chunk.join(','),
          response_optional_fields: 'payment_method'
        });
        const orderList = (res.response && res.response.order_list) || [];
        orderList.forEach(o => {
          if (o.order_sn && o.payment_method) {
            paymentMap[String(o.order_sn).trim()] = String(o.payment_method).trim();
            fetchedCount++;
          }
        });
      } catch (err) {
        failedBatches++;
        console.error('[FinanceService ERROR] _fetchPaymentMethods batch failed:', err.message);
      }
    }

    return { paymentMap, fetchedCount, failedBatches };
  }

  /**
   * Helper (fix Payment Method, CASE A): tulis paymentMap ke kolom "Payment Method"
   * pada matrix SalesLedger.
   */
  _applyPaymentMethodMap(raw, headers, paymentMap) {
    if (!paymentMap || !raw || raw.length < 2) return 0;
    const pmIdx = headers.indexOf('Payment Method');
    const snIdx = headers.indexOf('Order SN');
    if (pmIdx < 0 || snIdx < 0) return 0;
    const ownerIdx = headers.indexOf('Settlement Owner');
    const ownerSemanticsActive = ownerIdx >= 0 && raw.slice(1)
      .some(row => String(row[ownerIdx] ?? '').trim() !== '');

    let updated = 0;
    for (let r = 1; r < raw.length; r++) {
      const sn = String(raw[r][snIdx] || '').trim();
      const isOwner = !ownerSemanticsActive || String(raw[r][ownerIdx] ?? '').trim().toUpperCase() === 'TRUE';
      if (sn && isOwner && paymentMap[sn]) {
        raw[r][pmIdx] = paymentMap[sn];
        updated++;
      }
    }
    return updated;
  }

  /**
   * POST resyncFinance — ambil Payment API untuk SEMUA status aktif tanpa Escrow Amount.
   * Finance dicoba sedini mungkin; hanya exclude return/cancel. Jika API belum
   * mengembalikan finance → biarkan blank, tandai WAITING, coba lagi sync berikutnya.
   */
  async resyncFinance(data) {
    console.log('[FinanceService] Mulai resync finance...');
    try {
      const { headers, raw } = await this.financeRepo.getRawSalesLedgerMatrix();
      if (!raw || raw.length <= 1) {
        return { status: 'success', processed: 0, success: 0, failed: 0, skipped: 0, message: 'SalesLedger kosong.' };
      }

      const statusIdx = headers.indexOf('Status Shopee');
      const snIdx = headers.indexOf('Order SN');
      const lmIdx = headers.indexOf('Last Modified');
      const escrowIdx = headers.indexOf('Escrow Amount');
      const syncStIdx = this._getSettlementSyncIndex(headers);

      const eligible = [];
      const seen = {};

      for (let i = 1; i < raw.length; i++) {
        const st = String(raw[i][statusIdx] || '').toUpperCase().trim();
        const osn = String(raw[i][snIdx] || '').trim();

        if (!osn || seen[osn]) continue;

        const escrowVal = String(raw[i][escrowIdx] || '').trim();
        const escrowEmpty = escrowVal === '' || Number(escrowVal) === 0;
        if (!escrowEmpty) continue;

        seen[osn] = true;
        eligible.push({ rowIdx: i + 1, orderSn: osn, statusShopee: st });
      }

      const totalEligible = eligible.length;
      console.log('[FinanceService] Eligible order count:', totalEligible);

      if (!totalEligible) {
        return { status: 'success', processed: 0, success: 0, failed: 0, skipped: 0, message: 'Tidak ada pesanan aktif tanpa data finance untuk di-resync.' };
      }

      let limit = (data && data.limit) !== undefined ? Number(data.limit) : 50;
      if (!limit || limit < 1) limit = 50;
      let offset = (data && data.offset) !== undefined ? Number(data.offset) : 0;
      if (!offset || offset < 0) offset = 0;
      const batch = eligible.slice(offset, offset + limit);
      let successCount = 0;
      let failedCount = 0;
      let waitingCount = 0;
      const failList = [];
      const nowIso = getJakartaTimeString();

      // Backfill Payment Method (fix CASE A) — endpoint & mapper SAMA dengan refresh & auto-sync.
      const pmRes = await this._fetchPaymentMethods(batch.map(b => b.orderSn));
      const pmApplied = this._applyPaymentMethodMap(raw, headers, pmRes.paymentMap);

      for (let k = 0; k < batch.length; k++) {
        const b = batch[k];
        const res = await this._fetchPaymentEscrow(b.orderSn);
        const rowData = raw[b.rowIdx - 1];

        if (res.success) {
          const incFin = (res.data && res.data.order_income) ? res.data.order_income : {};
          const hasFinance = (incFin.escrow_amount !== undefined && incFin.escrow_amount !== null && incFin.escrow_amount !== "") ||
                             (incFin.escrow_amount_after_adjustment !== undefined && incFin.escrow_amount_after_adjustment !== null && incFin.escrow_amount_after_adjustment !== "");

          if (hasFinance) {
            const cols = this._mapPaymentToLedgerCols(res.data, headers);
            Object.keys(cols).forEach(ci => {
              rowData[Number(ci)] = cols[ci];
            });
            if (syncStIdx >= 0) rowData[syncStIdx] = "SUCCESS";
            if (lmIdx >= 0) rowData[lmIdx] = nowIso;
            successCount++;
          } else {
            waitingCount++;
            if (syncStIdx >= 0) rowData[syncStIdx] = "WAITING";
            if (lmIdx >= 0) rowData[lmIdx] = nowIso;
          }
        } else {
          failedCount++;
          failList.push({ orderSn: b.orderSn, error: res.error, message: res.message });
          if (syncStIdx >= 0) rowData[syncStIdx] = "FAILED";
          if (lmIdx >= 0) rowData[lmIdx] = nowIso;
        }
      }

      if (successCount > 0 || failedCount > 0 || waitingCount > 0 || pmApplied > 0) {
        await this.financeRepo.updateSalesLedgerRows(raw);
      }

      return {
        status: 'success',
        processed: batch.length,
        success: successCount,
        failed: failedCount,
        waiting: waitingCount,
        totalEligible,
        offset,
        limit,
        nextOffset: offset + batch.length < totalEligible ? offset + batch.length : null,
        skipped: Math.max(0, totalEligible - offset - batch.length),
        pmFetched: pmRes.fetchedCount,
        pmApplied,
        failedList: failList,
        message: `Resync selesai: ${successCount} berhasil, ${failedCount} gagal` +
                 (waitingCount > 0 ? `, ${waitingCount} menunggu finance.` : '.') +
                 (offset + batch.length < totalEligible ? ` ${totalEligible - offset - batch.length} tersisa.` : '')
      };
    } catch (err) {
      console.error('[FinanceService ERROR] resyncFinance failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }

  /**
   * POST refreshFinance — ambil ulang Payment API untuk array orderSns tertentu.
   */
  async refreshFinance(data) {
    console.log('[FinanceService] Mulai refresh finance...');
    try {
      const orderSns = data && data.orderSns;
      if (!orderSns || !Array.isArray(orderSns)) {
        return { status: 'error', message: 'Parameter orderSns harus berupa array.' };
      }

      const { headers, raw } = await this.financeRepo.getRawSalesLedgerMatrix();
      if (!raw || raw.length <= 1) {
        return { status: 'error', message: 'SalesLedger belum ada atau kosong.' };
      }

      const snIdx = headers.indexOf('Order SN');
      const lmIdx = headers.indexOf('Last Modified');
      const syncStIdx = this._getSettlementSyncIndex(headers);

      const snMap = {};
      for (let i = 1; i < raw.length; i++) {
        const sn = String(raw[i][snIdx] || '').trim();
        if (sn && !snMap[sn]) {
          snMap[sn] = i + 1;
        }
      }

      const batch = orderSns.slice(0, 20);
      let successCount = 0;
      let failedCount = 0;
      let waitingCount = 0;
      const failList = [];
      const nowIso = getJakartaTimeString();

      // Backfill Payment Method (fix CASE A) — endpoint & mapper SAMA dengan resync & auto-sync.
      const pmRes = await this._fetchPaymentMethods(batch);
      const pmApplied = this._applyPaymentMethodMap(raw, headers, pmRes.paymentMap);

      for (let k = 0; k < batch.length; k++) {
        const osn = String(batch[k] || '').trim();
        if (!osn) continue;

        const res = await this._fetchPaymentEscrow(osn);
        const rowIdx = snMap[osn];

        if (res.success) {
          const incFin = (res.data && res.data.order_income) ? res.data.order_income : {};
          const hasFinance = (incFin.escrow_amount !== undefined && incFin.escrow_amount !== null && incFin.escrow_amount !== "") ||
                             (incFin.escrow_amount_after_adjustment !== undefined && incFin.escrow_amount_after_adjustment !== null && incFin.escrow_amount_after_adjustment !== "");

          if (hasFinance) {
            if (rowIdx) {
              const cols = this._mapPaymentToLedgerCols(res.data, headers);
              const rowData = raw[rowIdx - 1];
              Object.keys(cols).forEach(ci => {
                rowData[Number(ci)] = cols[ci];
              });
              if (syncStIdx >= 0) rowData[syncStIdx] = "SUCCESS";
              if (lmIdx >= 0) rowData[lmIdx] = nowIso;
            }
            successCount++;
          } else {
            waitingCount++;
            if (rowIdx) {
              const rowData = raw[rowIdx - 1];
              if (syncStIdx >= 0) rowData[syncStIdx] = "WAITING";
              if (lmIdx >= 0) rowData[lmIdx] = nowIso;
            }
          }
        } else {
          failedCount++;
          failList.push({ orderSn: osn, error: res.error, message: res.message });
          if (rowIdx) {
            const rowData = raw[rowIdx - 1];
            if (syncStIdx >= 0) rowData[syncStIdx] = "FAILED";
            if (lmIdx >= 0) rowData[lmIdx] = nowIso;
          }
        }
      }

      if (successCount > 0 || failedCount > 0 || waitingCount > 0 || pmApplied > 0) {
        await this.financeRepo.updateSalesLedgerRows(raw);
      }

      return {
        status: 'success',
        processed: batch.length,
        success: successCount,
        failed: failedCount,
        waiting: waitingCount,
        pmFetched: pmRes.fetchedCount,
        pmApplied,
        failedList: failList
      };
    } catch (err) {
      console.error('[FinanceService ERROR] refreshFinance failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }

  /**
   * GET getSalesLedgerData — untuk AI (maks 500 baris terbaru).
   */
  async getSalesLedgerData(params) {
    try {
      const rows = await this.financeRepo.getSalesLedgers();
      rows.sort((a, b) => {
        const da = parseDateString(a['Tanggal Order']) || new Date(0);
        const db = parseDateString(b['Tanggal Order']) || new Date(0);
        return db - da;
      });
      const taken = rows.slice(0, 500);
      return {
        status: 'success',
        ledgers: taken,
        summary: {
          totalBaris: rows.length,
          diambil: taken.length,
          lastSync: taken.length > 0 ? (taken[0]['Sync Time'] || '') : ''
        }
      };
    } catch (err) {
      console.error('[FinanceService ERROR] getSalesLedgerData failed:', err.message);
      return { status: 'error', message: err.toString() };
    }
  }
}
