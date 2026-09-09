import AsyncLock from 'async-lock';

export class DeductionService {
  /**
   * @param {DeductionRepository} deductionRepository
   * @param {ShopeeRepository} shopeeRepository
   * @param {TelegramService} telegramService
   */
  constructor(deductionRepository, shopeeRepository, telegramService) {
    this.deductionRepo = deductionRepository;
    this.shopeeRepo = shopeeRepository;
    this.telegramService = telegramService;
    this.lock = new AsyncLock();
  }

  /**
   * Ambil data stok master berdasarkan SKU.
   */
  async getStockBySku(sku) {
    return await this.deductionRepo.getStockBySku(sku);
  }

  /**
   * Menyetujui pemotongan stok untuk satu item order (Thread-safe per SKU).
   */
  async approveDeduction(context) {
    const t0 = Date.now();
    const orderSn = String(context.orderSn || "").trim();
    const itemId = String(context.itemId || "").trim();
    const modelId = String(context.modelId || "").trim();
    const productName = String(context.productName || "").trim();
    const variationName = String(context.variationName || "").trim();
    const qty = Number(context.qty) || 1;
    const approvedBy = String(context.approvedBy || "Admin").trim();
    const source = String(context.source || "SingleApprove").trim();
    const suppressTelegram = !!context.suppressTelegram;
    const callerRole = String(context.callerRole || "").trim();

    if (callerRole !== "Admin") {
      return {
        status: "error",
        success: false,
        message: "Hanya Admin yang dapat menyetujui deduction.",
        duration: Date.now() - t0
      };
    }

    if (!orderSn) {
      return {
        status: "error",
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "orderSn tidak boleh kosong.",
        orderSn: "",
        duration: Date.now() - t0
      };
    }

    // 1. Dapatkan mapping barang untuk mencari SKU Inventaris
    const mappings = await this.shopeeRepo.getShopeeMappings();
    const mapping = mappings.find(m => 
      String(m.item_id || m.itemId).trim() === itemId && 
      String(m.model_id || m.modelId).trim() === modelId
    );

    if (!mapping || !mapping.inventory_sku) {
      await this.shopeeRepo.logShopeeActivity("ORDER_UNMAPPED", orderSn, "", "FAILED", "Produk belum dimapping: " + productName);
      return {
        status: "error",
        success: false,
        code: "MAPPING_REQUIRED",
        message: "Produk belum dimapping ke SKU inventaris.",
        orderSn,
        duration: Date.now() - t0
      };
    }

    const sku = mapping.inventory_sku;

    // 2. Kunci eksekusi per SKU secara konkuren
    return await this.lock.acquire(sku, async () => {
      // Dapatkan data order shopee
      const orders = await this.shopeeRepo.getShopeeOrders();
      const order = orders.find(o => 
        String(o.order_sn).trim() === orderSn &&
        (itemId ? String(o.item_id).trim() === itemId : true) &&
        (modelId ? String(o.model_id).trim() === modelId : true)
      );

      if (!order) {
        return {
          status: "error",
          success: false,
          code: "ORDER_NOT_FOUND",
          message: "Order tidak ditemukan: " + orderSn,
          orderSn,
          duration: Date.now() - t0
        };
      }

      // Validasi status deduction saat ini
      const currentStatus = String(order.deduct_status || order.deduction_status || "").toUpperCase();
      if (currentStatus !== "WAITING_APPROVAL") {
        let code = "INVALID_STATUS";
        let msg = "Status deduction tidak valid untuk approval: " + currentStatus;
        
        if (currentStatus === "DEDUCTED" || currentStatus === "SUCCESS") {
          code = "ALREADY_APPROVED";
          msg = "Order sudah disetujui sebelumnya (Approved).";
        } else if (currentStatus === "SKIPPED") {
          code = "SKIPPED";
          msg = "Order dalam status SKIPPED.";
        } else if (currentStatus === "HISTORICAL") {
          code = "HISTORICAL";
          msg = "Order dalam status HISTORICAL.";
        }

        return {
          status: "error",
          success: false,
          code,
          message: msg,
          orderSn,
          duration: Date.now() - t0
        };
      }

      // 3. Eksekusi pemotongan stok (MasterBarang + Transaksi)
      try {
        const deductResult = await this.deductionRepo.deductStock(sku, qty, orderSn, productName, variationName);

        // Update status order ke DEDUCTED
        await this.deductionRepo.updateDeductionStatus(orderSn, itemId, modelId, "DEDUCTED", { approvedBy });

        // Log aktivitas Shopee
        await this.shopeeRepo.logShopeeActivity("APPROVE_DEDUCTION", orderSn, sku, "SUCCESS",
          `Source: ${source} | Disetujui oleh: ${approvedBy} | SKU: ${sku} | Qty: ${qty}`
        );

        // Kirim Telegram
        if (!suppressTelegram) {
          const nowFormatted = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
          const text = `📦 <b>STOCK DEDUCTED</b>\n\n` +
                       `Order SN:\n${orderSn}\n\n` +
                       `SKU:\n${sku}\n\n` +
                       `Qty:\n-${qty}\n\n` +
                       `Sisa Stok:\n${deductResult.currentStock}\n\n` +
                       `Source:\n${source}\n\n` +
                       `Admin:\n${approvedBy}\n\n` +
                       `Waktu:\n${nowFormatted}`;
          await this.telegramService.broadcastTelegram({ message: text });
        }

        return {
          success: true,
          code: "SUCCESS",
          message: "Deduction berhasil disetujui.",
          orderSn,
          inventory_sku: sku,
          currentStock: deductResult.currentStock,
          duration: Date.now() - t0
        };

      } catch (err) {
        const reason = err.message;
        const nextStatus = "FAILED";

        await this.deductionRepo.updateDeductionStatus(orderSn, itemId, modelId, nextStatus);
        await this.shopeeRepo.logShopeeActivity("APPROVE_DEDUCTION_FAILED", orderSn, sku, "FAILED",
          `${reason} | Source: ${source} | Admin: ${approvedBy}`
        );

        let code = "STOCK_FAILED";
        let message = "Deduction gagal.";

        if (reason === "OUT_OF_STOCK") {
          code = "STOCK_FAILED";
          const currentStockData = await this.getStockBySku(sku);
          message = "Stok tidak mencukupi. Stok saat ini: " + (currentStockData.stock || 0);

          if (!suppressTelegram) {
            const text = `🚨 <b>STOK TIDAK CUKUP</b>\n\nOrder:\n${orderSn}\n\nSKU:\n${sku}\n\nStok:\n${currentStockData.stock}\n\nDiminta:\n${qty}`;
            await this.telegramService.broadcastTelegram({ message: text });
          }
        }

        return {
          success: false,
          code,
          message,
          orderSn,
          duration: Date.now() - t0
        };
      }
    });
  }

  /**
   * Menyetujui bulk pemotongan stok.
   */
  async bulkApproveDeduction(data) {
    const { items, approvedBy, source, suppressTelegram } = data;
    if (!items || items.length === 0) {
      return { status: "error", message: "Tidak ada order yang dipilih." };
    }

    let success = 0;
    let failed = 0;
    const results = [];

    for (const item of items) {
      const res = await this.approveDeduction({
        orderSn: item.orderSn,
        itemId: item.itemId,
        modelId: item.modelId,
        productName: item.productName,
        variationName: item.variationName,
        qty: item.qty,
        approvedBy,
        source: source || "BulkApprove",
        suppressTelegram: suppressTelegram !== undefined ? suppressTelegram : true // Default true untuk bulk
      });

      results.push(res);
      if (res.success) {
        success++;
      } else {
        failed++;
      }
    }

    return {
      status: "success",
      message: `Bulk approval selesai. Sukses: ${success}, Gagal: ${failed}`,
      success,
      failed,
      results
    };
  }

  /**
   * Validasi data skip.
   */
  validateSkip(orderSn, reason, note, skipType, callerRole) {
    if (callerRole !== "Admin" && callerRole !== "Owner") {
      return { valid: false, message: "Hanya Owner/Admin yang dapat skip/undo deduction." };
    }
    if (!orderSn) {
      return { valid: false, message: "Order SN tidak boleh kosong." };
    }
    if (!reason) {
      return { valid: false, message: "Alasan wajib dipilih." };
    }
    if (reason === "OTHER" && String(note || "").trim().length < 10) {
      return { valid: false, message: "Catatan minimal 10 karakter untuk alasan 'Lainnya'." };
    }
    return { valid: true };
  }

  /**
   * Melakukan skip status deduction.
   */
  async skipDeduction(data) {
    const { orderSn, reason, note, skipType, skippedBy, callerRole } = data;
    const cleanSn = String(orderSn || "").trim();

    const val = this.validateSkip(cleanSn, reason, note, skipType, callerRole);
    if (!val.valid) {
      return { status: "error", message: val.message };
    }

    // Ambil detail order
    const orders = await this.shopeeRepo.getShopeeOrders();
    const orderItems = orders.filter(o => String(o.order_sn).trim().toUpperCase() === cleanSn.toUpperCase());

    if (orderItems.length === 0) {
      return { status: "error", message: "Order tidak ditemukan di database: " + cleanSn };
    }

    // Cek jika ada baris yang sudah ter-deduct
    for (const item of orderItems) {
      const currentStatus = String(item.deduct_status || item.deduction_status || "").toUpperCase();
      if (currentStatus === "DEDUCTED" || currentStatus === "SUCCESS") {
        return { 
          status: "error", 
          message: `Order ${cleanSn} sudah di-deduct, tidak bisa di-skip. Gunakan Restock/Undo jika perlu.` 
        };
      }
    }

    const newStatus = skipType === "HISTORICAL" ? "HISTORICAL" : "SKIPPED";
    const oldStatus = String(orderItems[0].deduct_status || orderItems[0].deduction_status || "PENDING").toUpperCase();

    // Update semua baris matching
    await this.deductionRepo.updateDeductionStatus(cleanSn, null, null, newStatus, {
      reason,
      note,
      skippedBy
    });

    // Logging audit
    await this.deductionRepo.logAudit(cleanSn, "SKIP_DEDUCTION", oldStatus, newStatus, reason, note, skippedBy);
    await this.shopeeRepo.logShopeeActivity("SKIP_DEDUCTION", cleanSn, "", newStatus, `Reason: ${reason} | By: ${skippedBy}`);

    return {
      status: "success",
      message: `Order ${cleanSn} berhasil di-skip (${orderItems.length} baris).`,
      newStatus,
      reason
    };
  }

  /**
   * Melakukan bulk skip status deduction.
   */
  async bulkSkipDeduction(data) {
    const { orderSns, reason, note, skipType, skippedBy, callerRole } = data;
    if (!orderSns || orderSns.length === 0) {
      return { status: "error", message: "Tidak ada order yang dipilih." };
    }
    if (!reason) {
      return { status: "error", message: "Alasan wajib dipilih." };
    }

    let success = 0;
    let failed = 0;
    const errors = [];
    const failedSns = [];

    for (const sn of orderSns) {
      try {
        const res = await this.skipDeduction({
          orderSn: sn,
          reason,
          note,
          skipType,
          skippedBy,
          callerRole
        });

        if (res.status === "success") {
          success++;
        } else {
          failed++;
          failedSns.push(sn);
          errors.push(`${sn}: ${res.message}`);
        }
      } catch (e) {
        failed++;
        failedSns.push(sn);
        errors.push(`${sn}: ${e.message}`);
      }
    }

    return {
      status: "success",
      message: `Bulk skip selesai. Berhasil: ${success}, Gagal: ${failed}`,
      success,
      failed,
      failedSns,
      errors
    };
  }

  /**
   * Membatalkan status skip/historical kembali ke PENDING.
   */
  async undoSkip(data) {
    const { orderSn, undoBy, callerRole } = data;
    if (callerRole !== "Admin" && callerRole !== "Owner") {
      return { status: "error", message: "Hanya Owner/Admin yang dapat undo skip." };
    }

    const cleanSn = String(orderSn || "").trim();
    if (!cleanSn) {
      return { status: "error", message: "Order SN tidak boleh kosong." };
    }

    const orders = await this.shopeeRepo.getShopeeOrders();
    const orderItems = orders.filter(o => String(o.order_sn).trim().toUpperCase() === cleanSn.toUpperCase());

    if (orderItems.length === 0) {
      return { status: "error", message: "Order tidak ditemukan: " + cleanSn };
    }

    const oldStatus = String(orderItems[0].deduct_status || orderItems[0].deduction_status || "").toUpperCase();
    const oldReason = String(orderItems[0].skip_reason || "");

    if (oldStatus !== "SKIPPED" && oldStatus !== "HISTORICAL") {
      return { status: "error", message: `Order ${cleanSn} tidak berstatus SKIPPED/HISTORICAL.` };
    }

    // Reset status ke PENDING
    await this.deductionRepo.updateDeductionStatus(cleanSn, null, null, "PENDING");

    // Logging audit
    await this.deductionRepo.logAudit(cleanSn, "UNDO_SKIP", oldStatus, "PENDING", oldReason, "Undo by admin", undoBy);
    await this.shopeeRepo.logShopeeActivity("UNDO_SKIP", cleanSn, "", "PENDING", `Reason: ${oldReason} | By: ${undoBy}`);

    return {
      status: "success",
      message: `Skip berhasil di-undo (${orderItems.length} baris). Status kembali ke PENDING.`,
      newStatus: "PENDING"
    };
  }

  /**
   * Mengulang (Retry) deduction yang gagal.
   */
  async retryDeduction(data) {
    const { orderSn, itemId, modelId, productName, variationName, qty, callerRole } = data;
    if (callerRole !== "Admin" && callerRole !== "Owner") {
      return { status: "error", message: "Hanya Admin/Owner." };
    }
    if (!orderSn || !itemId) {
      return { status: "error", message: "orderSn dan itemId wajib ada." };
    }

    const approvedBy = callerRole;
    const res = await this.approveDeduction({
      orderSn,
      itemId,
      modelId,
      productName,
      variationName,
      qty: Number(qty) || 1,
      approvedBy,
      source: "RetryDeduction",
      suppressTelegram: false
    });

    if (res.success) {
      // Khusus untuk retryDeduction, Apps Script mengupdate status ke SUCCESS
      await this.deductionRepo.updateDeductionStatus(orderSn, itemId, modelId, "SUCCESS", { approvedBy });
      return {
        status: "success",
        message: "SUCCESS",
        inventory_sku: res.inventory_sku,
        currentStock: res.currentStock
      };
    } else {
      return {
        status: "error",
        message: res.message
      };
    }
  }
}
