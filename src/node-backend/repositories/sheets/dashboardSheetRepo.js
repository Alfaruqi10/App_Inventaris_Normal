import { DashboardRepository } from '../dashboardRepository.js';
import sheetsService from './sheetsService.js';
import { parseDateString } from '../../utils/dateParser.js';

export class DashboardSheetRepository extends DashboardRepository {
  constructor() {
    super();
    this.shopeeOrdersSheet = "ShopeeOrders";
    this.masterBarangSheet = "MasterBarang";
    this.transaksiSheet = "Transaksi";

    this.returnCancelStatuses = ["CANCELLED", "IN_CANCEL", "TO_RETURN", "RETURNED"];
    this.shippedGroupStatuses = ["SHIPPED", "PROCESSED", "TO_CONFIRM_RECEIVE"];
  }

  async getOrdersKPI(dateFromStr, dateToStr) {
    const rows = await sheetsService.readRows(this.shopeeOrdersSheet);
    if (rows.length <= 1) {
      return {
        tabCounts: { ALL: 0, UNPAID: 0, READY_TO_SHIP: 0, SHIPPED: 0, COMPLETED: 0, RETURN_CANCEL: 0 },
        kpi: { newOrders: 0, unpaid: 0, readyToShip: 0, shipped: 0, completed: 0, cancelled: 0, returned: 0, unmapped: 0, failed: 0, pendingDeduct: 0 }
      };
    }

    const headers = rows[0];
    const colSt = headers.indexOf("order_status");
    const colDed = headers.indexOf("deduction_status");
    const colMap = headers.indexOf("mapping_status");
    const colCt = headers.indexOf("create_time");

    const now = Date.now();
    const DAY_MS = 86400000;

    let kpiNew = 0, kpiUnpaid = 0, kpiReady = 0, kpiShipped = 0, kpiDone = 0, kpiCancel = 0, kpiReturn = 0;
    let kpiUnmapped = 0, kpiFailed = 0, kpiPending = 0;
    const tabCounts = { ALL: 0, UNPAID: 0, READY_TO_SHIP: 0, SHIPPED: 0, COMPLETED: 0, RETURN_CANCEL: 0 };

    // Tentukan waktu rentang jika ada filter tanggal
    let fromTime = null;
    let toTime = null;
    if (dateFromStr && dateToStr) {
      fromTime = new Date(dateFromStr + "T00:00:00").getTime();
      toTime = new Date(dateToStr + "T23:59:59").getTime();
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const ct = row[colCt];
      const parsedCt = parseDateString(ct);
      const created = parsedCt ? parsedCt.getTime() : 0;

      // Filter tanggal
      if (fromTime && toTime) {
        if (isNaN(created) || created < fromTime || created > toTime) {
          continue;
        }
      }

      const st = String(row[colSt] || "").toUpperCase();
      const ded = String(row[colDed] || "PENDING").toUpperCase();
      const map = String(row[colMap] || "").toUpperCase();

      tabCounts.ALL++;
      if (st === "UNPAID") tabCounts.UNPAID++;
      else if (st === "READY_TO_SHIP") tabCounts.READY_TO_SHIP++;
      else if (this.shippedGroupStatuses.includes(st)) tabCounts.SHIPPED++;
      else if (st === "COMPLETED") tabCounts.COMPLETED++;
      else if (this.returnCancelStatuses.includes(st)) tabCounts.RETURN_CANCEL++;

      if (created && (now - created) < DAY_MS) kpiNew++;
      if (st === "UNPAID") kpiUnpaid++;
      if (st === "READY_TO_SHIP") kpiReady++;
      if (this.shippedGroupStatuses.includes(st)) kpiShipped++;
      if (st === "COMPLETED") kpiDone++;
      if (st === "CANCELLED" || st === "IN_CANCEL") kpiCancel++;
      if (st === "TO_RETURN" || st === "RETURNED") kpiReturn++;
      if (map === "UNMAPPED") kpiUnmapped++;
      if (ded === "FAILED") kpiFailed++;
      if (ded === "PENDING" && st === "READY_TO_SHIP") kpiPending++;
      if (ded === "WAITING_APPROVAL") kpiPending++;
      if (ded === "RETURN_PENDING") kpiFailed++;
    }

    return {
      tabCounts,
      kpi: {
        newOrders: kpiNew,
        unpaid: kpiUnpaid,
        readyToShip: kpiReady,
        shipped: kpiShipped,
        completed: kpiDone,
        cancelled: kpiCancel,
        returned: kpiReturn,
        unmapped: kpiUnmapped,
        failed: kpiFailed,
        pendingDeduct: kpiPending
      }
    };
  }

  async getMasterBarangData() {
    return await sheetsService.readSheetObjects(this.masterBarangSheet);
  }

  async getTransaksiData() {
    return await sheetsService.readSheetObjects(this.transaksiSheet);
  }
}
