import { SystemHealthRepository } from '../systemHealthRepository.js';
import sheetsService from './sheetsService.js';
import { parseDateString } from '../../utils/dateParser.js';

export class SystemHealthSheetRepository extends SystemHealthRepository {
  constructor() {
    super();
    this.shopeeOrdersSheet = "ShopeeOrders";
    this.salesLedgerSheet = "SalesLedger";
    this.shopeeProductsSheet = "ShopeeProducts";
    this.shopeeLogsSheet = "ShopeeLogs";
    this.kpiSnapshotSheet = "KPISnapshot";

    this.approvalTriggerStatuses = ["READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"];
  }

  async getPendingOrdersCount() {
    const rows = await sheetsService.readRows(this.shopeeOrdersSheet);
    if (rows.length <= 1) return 0;

    const headers = rows[0];
    const colDeduction = headers.indexOf("deduction_status");
    const colStatus = headers.indexOf("order_status");

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const deductStatus = String(row[colDeduction] || 'PENDING').toUpperCase();
      const orderStatus = String(row[colStatus] || '').toUpperCase();

      if (deductStatus === 'PENDING' && this.approvalTriggerStatuses.includes(orderStatus)) {
        count++;
      }
    }
    return count;
  }

  async getDuplicateOrdersCount() {
    // 1. Cek duplikat di ShopeeOrders
    const orderRows = await sheetsService.readRows(this.shopeeOrdersSheet);
    let orderDuplicates = 0;
    if (orderRows.length > 1) {
      const headers = orderRows[0];
      const colSn = headers.indexOf("order_sn");
      const seen = new Set();
      for (let i = 1; i < orderRows.length; i++) {
        const sn = String(orderRows[i][colSn] || '').trim();
        if (!sn) continue;
        if (seen.has(sn)) {
          orderDuplicates++;
        } else {
          seen.add(sn);
        }
      }
    }

    // 2. Cek duplikat di SalesLedger
    const ledgerRows = await sheetsService.readRows(this.salesLedgerSheet);
    let ledgerDuplicates = 0;
    if (ledgerRows.length > 1) {
      const headers = ledgerRows[0];
      const colSn = headers.indexOf("Order SN");
      const seen = new Set();
      for (let i = 1; i < ledgerRows.length; i++) {
        const sn = String(ledgerRows[i][colSn] || '').trim();
        if (!sn) continue;
        if (seen.has(sn)) {
          ledgerDuplicates++;
        } else {
          seen.add(sn);
        }
      }
    }

    return orderDuplicates + ledgerDuplicates;
  }

  async getMissingSettlementsCount() {
    const rows = await sheetsService.readRows(this.salesLedgerSheet);
    if (rows.length <= 1) return 0;

    const headers = rows[0];
    const colStatus = headers.indexOf("Status Shopee");
    const colEscrow = headers.indexOf("Escrow Amount");

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = String(row[colStatus] || '').toUpperCase();
      const escrow = row[colEscrow];
      const hasEscrow = escrow !== undefined && escrow !== null && escrow !== '' && Number(escrow) !== 0;

      if ((status === 'COMPLETED' || status === 'TO_CONFIRM_RECEIVE') && !hasEscrow) {
        count++;
      }
    }
    return count;
  }

  async getLedgerRowCount() {
    const rows = await sheetsService.readRows(this.salesLedgerSheet);
    return Math.max(0, rows.length - 1);
  }

  async getMappedProductsPercent() {
    const rows = await sheetsService.readRows(this.shopeeProductsSheet);
    if (rows.length <= 1) return 0;

    const headers = rows[0];
    const colMapping = headers.indexOf("status_mapping");

    let mapped = 0;
    let unmapped = 0;

    for (let i = 1; i < rows.length; i++) {
      const status = String(rows[i][colMapping] || '').toUpperCase();
      if (status === 'MAPPED') {
        mapped++;
      } else {
        unmapped++;
      }
    }

    const total = mapped + unmapped;
    return total > 0 ? Math.round((mapped / total) * 100) : 0;
  }

  async getKpiStatus() {
    const rows = await sheetsService.readRows(this.kpiSnapshotSheet);
    return rows.length > 1 ? 'Tersedia' : 'Belum dihitung';
  }

  async getWebhookStatsToday() {
    const rows = await sheetsService.readRows(this.shopeeLogsSheet);
    
    // Tgl Jakarta (dd/MM/yyyy)
    const todayStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date()).replace(/\//g, '/'); // ensure standard format

    let totalHariIni = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let lastEvent = '-';
    let lastEventTime = '-';

    if (rows.length > 1) {
      const headers = rows[0];
      const colTs = headers.indexOf("timestamp");
      const colEv = headers.indexOf("event_type");
      const colSt = headers.indexOf("status");

      // Loop dari baris teratas ke terbawah untuk cari log terbaru
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const tsVal = row[colTs];
        if (!tsVal) continue;

        const rowDate = parseDateString(tsVal);
        if (!rowDate) continue;

        const rowDateStr = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }).format(rowDate).replace(/\//g, '/');

        const evType = String(row[colEv] || '');
        const status = String(row[colSt] || '');

        if (rowDateStr === todayStr && (evType === "WEBHOOK_RECEIVED" || evType === "WEBHOOK_TEST")) {
          totalHariIni++;
          if (status === "INFO" || status === "SUCCESS") {
            totalSuccess++;
          } else {
            totalFailed++;
          }
        }

        // Simpan event terakhir (paling bawah di sheet adalah paling baru)
        lastEvent = evType || '-';
        lastEventTime = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(rowDate);
      }
    }

    return {
      totalHariIni,
      totalSuccess,
      totalFailed,
      lastEvent,
      lastEventTime
    };
  }
}
