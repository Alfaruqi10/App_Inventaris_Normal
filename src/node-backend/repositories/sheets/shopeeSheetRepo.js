import { ShopeeRepository } from '../shopeeRepository.js';
import sheetsService from './sheetsService.js';
import { getJakartaTimeString } from '../../utils/dateFormatter.js';

export class ShopeeSheetRepository extends ShopeeRepository {
  constructor() {
    super();
    this.productsSheet = "ShopeeProducts";
    this.mappingSheet = "ShopeeMapping";
    this.ordersSheet = "ShopeeOrders";
    this.logsSheet = "ShopeeLogs";
    this.notificationsSheet = "ShopeeNotifications";
  }

  async getShopeeProducts() {
    return await sheetsService.readSheetObjects(this.productsSheet);
  }

  async getShopeeMappings() {
    return await sheetsService.readSheetObjects(this.mappingSheet);
  }

  async getShopeeOrders() {
    return await sheetsService.readSheetObjects(this.ordersSheet);
  }

  async getShopeeLogs() {
    return await sheetsService.readSheetObjects(this.logsSheet);
  }

  async getShopeeNotifications() {
    return await sheetsService.readSheetObjects(this.notificationsSheet);
  }

  /**
   * Menghapus mapping Shopee berdasarkan item_id dan model_id.
   */
  async deleteShopeeMapping(itemId, modelId) {
    const rows = await sheetsService.readRows(this.mappingSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const mapItemIdx = headers.indexOf("item_id");
    const mapModelIdx = headers.indexOf("model_id");

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][mapItemIdx]) === String(itemId) && String(rows[i][mapModelIdx]) === String(modelId)) {
        await sheetsService.deleteRow(this.mappingSheet, i + 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Memperbarui status pemetaan ("Mapped" / "Belum Mapped") di lembar ShopeeProducts.
   */
  async updateShopeeProductMappingStatus(itemId, modelId, statusVal) {
    const rows = await sheetsService.readRows(this.productsSheet);
    if (rows.length <= 1) return false;

    const headers = rows[0];
    const itemCol = headers.indexOf("item_id");
    const modelCol = headers.indexOf("model_id");
    const statusCol = headers.indexOf("status_mapping");
    const updatedCol = headers.indexOf("updated_at");

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][itemCol]) === String(itemId) && String(rows[i][modelCol]) === String(modelId)) {
        if (statusCol >= 0) {
          await sheetsService.updateCell(this.productsSheet, i + 1, statusCol + 1, statusVal);
        }
        if (updatedCol >= 0) {
          await sheetsService.updateCell(this.productsSheet, i + 1, updatedCol + 1, getJakartaTimeString());
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Menyimpan / Meng-upsert mapping Shopee ke lembar ShopeeMapping.
   */
  async saveShopeeMapping(mappingObj) {
    const rows = await sheetsService.readRows(this.mappingSheet);
    let headers = rows[0] || [];
    
    if (headers.length === 0) {
      // Default headers jika lembar mapping masih kosong
      headers = [
        "item_id", "model_id", "seller_sku", "inventory_sku", 
        "inventory_product_name", "mapping_status", 
        "verified_by", "verified_at", "created_at", "updated_at"
      ];
      await sheetsService.appendRow(this.mappingSheet, headers);
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const mapItemIdx = colIdx["item_id"];
    const mapModelIdx = colIdx["model_id"];

    // Cari apakah sudah ada baris pemetaan yang sama
    let foundRowIndex = -1;
    let oldCreatedAt = null;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][mapItemIdx]) === String(mappingObj.itemId) && 
          String(rows[i][mapModelIdx]) === String(mappingObj.modelId)) {
        foundRowIndex = i + 1;
        oldCreatedAt = rows[i][colIdx["created_at"]];
        break;
      }
    }

    // Bangun baris mapping
    const now = getJakartaTimeString();
    const newRow = new Array(headers.length).fill("");
    
    const set = (colName, val) => {
      if (colIdx[colName] !== undefined) newRow[colIdx[colName]] = val;
    };

    set("item_id", mappingObj.itemId);
    set("model_id", mappingObj.modelId);
    set("seller_sku", mappingObj.sellerSku || "");
    set("inventory_sku", mappingObj.inventorySku);
    set("inventory_product_name", mappingObj.inventoryProductName);
    set("mapping_status", "MAPPED");
    set("verified_by", mappingObj.verifiedBy || "Admin");
    set("verified_at", now);
    set("created_at", oldCreatedAt || now);
    set("updated_at", now);

    if (foundRowIndex > 0) {
      // Update range baris existing
      await sheetsService.updateRange(this.mappingSheet, `A${foundRowIndex}`, [newRow]);
    } else {
      // Append baris baru
      await sheetsService.appendRow(this.mappingSheet, newRow);
    }
    return true;
  }

  /**
   * Menyimpan / Meng-upsert hasil sinkronisasi produk dari Shopee ke lembar ShopeeProducts.
   */
  async upsertShopeeProducts(allProducts) {
    const rows = await sheetsService.readRows(this.productsSheet);
    let headers = rows[0] || [];

    if (headers.length === 0) {
      headers = ["item_id", "model_id", "nama_produk", "variasi", "seller_sku", "status_mapping", "created_at", "updated_at"];
      await sheetsService.appendRow(this.productsSheet, headers);
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const itemIdIdx = colIdx["item_id"];
    const modelIdIdx = colIdx["model_id"];

    // Ambil data mapping saat ini untuk menentukan status mapping produk
    const mappingRows = await sheetsService.readRows(this.mappingSheet);
    const mappingHeaders = mappingRows[0] || [];
    const mapItemIdx = mappingHeaders.indexOf("item_id");
    const mapModelIdx = mappingHeaders.indexOf("model_id");
    const mappedSet = new Set();
    for (let i = 1; i < mappingRows.length; i++) {
      mappedSet.add(String(mappingRows[i][mapItemIdx]) + "_" + String(mappingRows[i][mapModelIdx]));
    }

    // Bangun map lookup dari data ShopeeProducts yang ada
    const existingMap = {};
    for (let i = 1; i < rows.length; i++) {
      const key = String(rows[i][itemIdIdx]) + "_" + String(rows[i][modelIdIdx]);
      existingMap[key] = { rowIndex: i + 1, createdAt: rows[i][colIdx["created_at"]] };
    }

    let newCount = 0;
    let updateCount = 0;
    const now = getJakartaTimeString();

    for (const item of allProducts) {
      const key = item.itemId + "_" + item.modelId;
      const isMapped = mappedSet.has(key);
      const statusMapping = isMapped ? "Mapped" : "Belum Mapped";

      const newRow = new Array(headers.length).fill("");
      const set = (colName, val) => {
        if (colIdx[colName] !== undefined) newRow[colIdx[colName]] = val;
      };

      set("item_id", item.itemId);
      set("model_id", item.modelId);
      set("nama_produk", item.name);
      set("variasi", item.variation);
      set("seller_sku", item.sku);
      set("status_mapping", statusMapping);

      const existing = existingMap[key];
      if (existing) {
        set("created_at", existing.createdAt);
        set("updated_at", now);
        await sheetsService.updateRange(this.productsSheet, `A${existing.rowIndex}`, [newRow]);
        updateCount++;
      } else {
        set("created_at", now);
        set("updated_at", now);
        await sheetsService.appendRow(this.productsSheet, newRow);
        newCount++;
      }
    }

    return { newCount, updateCount };
  }

  /**
   * Menyimpan logs aktivitas Shopee ke lembar ShopeeLogs.
   */
  async logShopeeActivity(type, orderSn, sku, status, message) {
    const rows = await sheetsService.readRows(this.logsSheet);
    if (rows.length === 0) {
      await sheetsService.appendRow(this.logsSheet, ["Timestamp", "Type", "Order SN", "SKU", "Status", "Message"]);
    }
    const row = [
      getJakartaTimeString(),
      type,
      orderSn || "",
      sku || "",
      status || "",
      message || ""
    ];
    await sheetsService.appendRow(this.logsSheet, row);
  }

  /**
   * Meng-upsert hasil sinkronisasi order dari Shopee ke lembar ShopeeOrders.
   */
  async upsertShopeeOrders(ordersList) {
    const rows = await sheetsService.readRows(this.ordersSheet);
    let headers = rows[0] || [];

    if (headers.length === 0) {
      // Default headers sesuai SHOPEE_ORDERS_HEADERS di Apps Script
      headers = [
        "order_sn", "shop_id", "buyer_username", "order_status",
        "create_time", "pay_time", "total_amount", "actual_shipping_fee",
        "estimated_shipping_fee", "cod", "payment_method", "recipient_name",
        "recipient_phone", "recipient_address", "items_json", "deduct_status",
        "deduct_error", "webhook_received_at", "processed_at", "escrow_amount",
        "seller_co_op_voucher", "buyer_co_op_voucher", "escrow_json", "escrow_fetched_at"
      ];
      await sheetsService.appendRow(this.ordersSheet, headers);
    }

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const orderSnIdx = colIdx["order_sn"];
    const existingMap = {};
    for (let i = 1; i < rows.length; i++) {
      existingMap[String(rows[i][orderSnIdx])] = i + 1; // row number (1-indexed)
    }

    let newCount = 0;
    let updateCount = 0;

    for (const order of ordersList) {
      const row = new Array(headers.length).fill("");
      const set = (colName, val) => {
        if (colIdx[colName] !== undefined) row[colIdx[colName]] = val;
      };

      // Map fields ke index kolom
      set("order_sn", order.order_sn);
      set("shop_id", order.shop_id);
      set("buyer_username", order.buyer_username);
      set("order_status", order.order_status);
      set("create_time", order.create_time);
      set("pay_time", order.pay_time || "");
      set("total_amount", order.total_amount);
      set("actual_shipping_fee", order.actual_shipping_fee || 0);
      set("estimated_shipping_fee", order.estimated_shipping_fee || 0);
      set("cod", order.cod ? "ya" : "tidak");
      set("payment_method", order.payment_method || "");
      set("recipient_name", order.recipient_name || "");
      set("recipient_phone", order.recipient_phone || "");
      set("recipient_address", order.recipient_address || "");
      set("items_json", order.items_json);
      set("deduct_status", order.deduct_status || "PENDING");
      set("deduct_error", order.deduct_error || "");
      set("webhook_received_at", order.webhook_received_at || "");
      set("processed_at", order.processed_at || "");
      set("escrow_amount", order.escrow_amount || 0);
      set("seller_co_op_voucher", order.seller_co_op_voucher || 0);
      set("buyer_co_op_voucher", order.buyer_co_op_voucher || 0);
      set("escrow_json", order.escrow_json || "");
      set("escrow_fetched_at", order.escrow_fetched_at || "");

      const existingRow = existingMap[order.order_sn];
      if (existingRow) {
        // Preservasi webhook_received_at dan detail escrow jika sudah ada
        const oldRow = rows[existingRow - 1];
        if (colIdx["webhook_received_at"] !== undefined && !order.webhook_received_at) {
          set("webhook_received_at", oldRow[colIdx["webhook_received_at"]]);
        }
        if (colIdx["escrow_amount"] !== undefined && !order.escrow_amount) {
          set("escrow_amount", oldRow[colIdx["escrow_amount"]]);
          set("escrow_json", oldRow[colIdx["escrow_json"]]);
          set("escrow_fetched_at", oldRow[colIdx["escrow_fetched_at"]]);
        }
        
        await sheetsService.updateRange(this.ordersSheet, `A${existingRow}`, [row]);
        updateCount++;
      } else {
        await sheetsService.appendRow(this.ordersSheet, row);
        newCount++;
      }
    }

    return { newCount, updateCount };
  }
}
