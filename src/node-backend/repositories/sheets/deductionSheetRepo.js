import { DeductionRepository } from '../deductionRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class DeductionSheetRepository extends DeductionRepository {
  constructor() {
    super();
    this.masterSheet = "MasterBarang";
    this.transactionSheet = "Transaksi";
    this.ordersSheet = "ShopeeOrders";
    this.auditSheet = "DeductionAudit";
  }

  async getStockBySku(sku) {
    const rows = await sheetsService.readRows(this.masterSheet);
    if (rows.length <= 1) return { found: false, stock: 0 };

    const headers = rows[0];
    const kodeIdx = headers.indexOf("Kode Barang");
    const stokIdx = headers.indexOf("Stok Saat Ini");
    const namaIdx = headers.indexOf("Nama Barang");
    const warnaIdx = headers.indexOf("Warna");
    const ukuranIdx = headers.indexOf("Ukuran");

    if (kodeIdx < 0 || stokIdx < 0) {
      throw new Error("Header MasterBarang tidak valid.");
    }

    const cleanSku = String(sku).trim();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][kodeIdx] || "").trim() === cleanSku) {
        return {
          found: true,
          sku: cleanSku,
          stock: Number(rows[i][stokIdx] || 0),
          nama: String(rows[i][namaIdx] || ""),
          warna: String(rows[i][warnaIdx] || ""),
          ukuran: String(rows[i][ukuranIdx] || "")
        };
      }
    }

    return { found: false, sku: cleanSku, stock: 0 };
  }

  async deductStock(sku, qty, orderSn, productName, variationName) {
    const rows = await sheetsService.readRows(this.masterSheet);
    if (rows.length <= 1) throw new Error("SKU_NOT_FOUND");

    const headers = rows[0];
    const kodeIdx = headers.indexOf("Kode Barang");
    const stokIdx = headers.indexOf("Stok Saat Ini");
    const updatedIdx = headers.indexOf("Updated At");

    if (kodeIdx < 0 || stokIdx < 0) {
      throw new Error("Header MasterBarang tidak valid.");
    }

    const cleanSku = String(sku).trim();
    let targetRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][kodeIdx] || "").trim() === cleanSku) {
        targetRowIndex = i + 1;
        break;
      }
    }

    if (targetRowIndex < 0) {
      throw new Error("SKU_NOT_FOUND");
    }

    const currentStock = Number(rows[targetRowIndex - 1][stokIdx] || 0);
    if (currentStock < qty) {
      throw new Error("OUT_OF_STOCK");
    }

    const stokBaru = currentStock - qty;
    const now = getJakartaTimeString();

    // 1. Catat Transaksi KELUAR
    const transRows = await sheetsService.readRows(this.transactionSheet);
    let transHeaders = transRows[0] || [];
    if (transHeaders.length === 0) {
      transHeaders = [
        "Tanggal", "Jenis", "Kode Barang", "Nama Barang", "Warna", "Ukuran", 
        "Tahun", "Jumlah", "Stok Akhir", "Tujuan Keluar", "Keterangan", "Petugas", "Petugas Email"
      ];
      await sheetsService.appendRow(this.transactionSheet, transHeaders);
    }

    // Format row: [Tanggal, Jenis, Kode Barang, Nama Barang, Warna, Ukuran, Tahun, Jumlah, Stok Akhir, Tujuan Keluar, Keterangan, Petugas, Petugas Email]
    const transRow = [
      now,
      "KELUAR",
      cleanSku,
      productName || "",
      "",
      variationName || "",
      "",
      qty,
      stokBaru,
      "Shopee Order",
      "Shopee Order Deduction — " + orderSn,
      "Admin",
      ""
    ];

    let transRowInsertedNumber = -1;
    try {
      await sheetsService.appendRow(this.transactionSheet, transRow);
      // Baca baris terakhir untuk dapat id/indeks rollback
      const currentTransRows = await sheetsService.readRows(this.transactionSheet);
      transRowInsertedNumber = currentTransRows.length;
    } catch (err) {
      throw new Error("TRANSACTION_WRITE_FAILED");
    }

    // 2. Potong stok di MasterBarang
    try {
      await sheetsService.updateCell(this.masterSheet, targetRowIndex, stokIdx + 1, stokBaru);
      if (updatedIdx >= 0) {
        await sheetsService.updateCell(this.masterSheet, targetRowIndex, updatedIdx + 1, now);
      }
    } catch (stockErr) {
      // Rollback Transaksi
      console.warn(`[DeductionSheetRepository] Potong stok gagal, rollback transaksi baris ${transRowInsertedNumber}`);
      try {
        if (transRowInsertedNumber > 1) {
          await sheetsService.deleteRow(this.transactionSheet, transRowInsertedNumber);
        }
      } catch (rollbackErr) {
        console.error(`[DeductionSheetRepository ERROR] Rollback transaksi gagal: ${rollbackErr.message}`);
      }
      throw new Error("STOCK_WRITE_FAILED");
    }

    return { status: "SUCCESS", inventory_sku: cleanSku, currentStock: stokBaru };
  }

  async updateDeductionStatus(orderSn, itemId, modelId, status, details = {}) {
    const rows = await sheetsService.readRows(this.ordersSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const snIdx = headers.indexOf("order_sn");
    const dcIdx = headers.indexOf("deduction_status");
    const daIdx = headers.indexOf("deducted_at");
    const dbIdx = headers.indexOf("deducted_by");
    const srIdx = headers.indexOf("skip_reason");
    const snoteIdx = headers.indexOf("skip_note");
    const sbIdx = headers.indexOf("skipped_by");
    const saIdx = headers.indexOf("skipped_at");
    const itIdx = headers.indexOf("item_id");
    const mdIdx = headers.indexOf("model_id");

    const cleanSn = String(orderSn).trim();
    let updated = false;

    for (let i = 1; i < rows.length; i++) {
      const matchSn = String(rows[i][snIdx] || "").trim() === cleanSn;
      let matchItem = true;

      if (itemId || modelId) {
        const rowIid = String(rows[i][itIdx] || "").trim();
        const rowMid = String(rows[i][mdIdx] || "").trim();
        matchItem = (rowIid === String(itemId).trim()) && (rowMid === String(modelId).trim());
      }

      if (matchSn && matchItem) {
        const rowNum = i + 1;
        
        // Update deduction status
        if (dcIdx >= 0) {
          await sheetsService.updateCell(this.ordersSheet, rowNum, dcIdx + 1, status);
        }

        if (status === "DEDUCTED" || status === "SUCCESS") {
          if (daIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, daIdx + 1, getJakartaTimeString());
          if (dbIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, dbIdx + 1, details.approvedBy || "Admin");
        } 
        else if (status === "SKIPPED" || status === "HISTORICAL") {
          if (srIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, srIdx + 1, details.reason || "");
          if (snoteIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, snoteIdx + 1, details.note || "");
          if (sbIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, sbIdx + 1, details.skippedBy || "Admin");
          if (saIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, saIdx + 1, getJakartaTimeString());
        }
        else if (status === "PENDING") {
          // Clear skip details
          if (srIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, srIdx + 1, "");
          if (snoteIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, snoteIdx + 1, "");
          if (sbIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, sbIdx + 1, "");
          if (saIdx >= 0) await sheetsService.updateCell(this.ordersSheet, rowNum, saIdx + 1, "");
        }

        updated = true;
      }
    }

    return updated;
  }

  async logAudit(orderSn, action, oldStatus, newStatus, reason, note, user) {
    try {
      const rows = await sheetsService.readRows(this.auditSheet);
      let headers = rows[0] || [];

      if (headers.length === 0) {
        headers = [
          "Timestamp", "Order SN", "Action", "Old Status", 
          "New Status", "Reason", "Note", "User", "Ext1"
        ];
        await sheetsService.appendRow(this.auditSheet, headers);
      }

      const newRow = [
        getJakartaTimeString(),
        orderSn,
        action,
        oldStatus,
        newStatus,
        reason || "",
        note || "",
        user || "System",
        ""
      ];

      await sheetsService.appendRow(this.auditSheet, newRow);
      return true;
    } catch (e) {
      console.error("[DeductionSheetRepository ERROR] Gagal menulis audit log:", e.message);
      return false;
    }
  }
}
