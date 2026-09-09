import crypto from 'crypto';
import axios from 'axios';
import propertiesService from '../utils/properties.js';
import { getJakartaTimeString } from '../utils/dateFormatter.js';

export class ShopeeService {
  /**
   * @param {ShopeeRepository} shopeeRepository
   * @param {MasterBarangRepository} masterBarangRepository
   */
  constructor(shopeeRepository, masterBarangRepository) {
    this.shopeeRepo = shopeeRepository;
    this.masterRepo = masterBarangRepository;
    
    // Konfigurasi konstan Shopee API
    this.partnerId = Number(process.env.SHOPEE_PARTNER_ID || "2037129");
    this.redirectUrl = process.env.SHOPEE_REDIRECT_URL || "https://ansla-store.netlify.app/";
    this.baseUrl = process.env.SHOPEE_BASE_URL || "https://partner.shopeemobile.com";
  }

  /**
   * Mendapatkan Shopee Partner Key dari variable env.
   */
  getPartnerKey() {
    return process.env.SHOPEE_PARTNER_KEY || "";
  }

  /**
   * Mengambil access_token dan shop_id dari berkas propertiesService lokal.
   */
  getShopeeTokens() {
    return {
      accessToken: propertiesService.getProperty("shopee_access_token") || "",
      shopId: Number(propertiesService.getProperty("shopee_shop_id") || 0),
      refreshToken: propertiesService.getProperty("shopee_refresh_token") || "",
      expireAt: Number(propertiesService.getProperty("shopee_expire_at") || 0)
    };
  }

  /**
   * Menyimpan token Shopee ke propertiesService lokal.
   */
  saveShopeeTokens(accessToken, refreshToken, shopId, expireIn) {
    propertiesService.setProperty("shopee_access_token", accessToken);
    propertiesService.setProperty("shopee_refresh_token", refreshToken);
    propertiesService.setProperty("shopee_shop_id", String(shopId));
    propertiesService.setProperty("shopee_expire_at", String(Math.floor(Date.now() / 1000) + (expireIn || 3600)));
  }

  /**
   * Membuat tanda tangan (HMAC-SHA256) sesuai spesifikasi Shopee v2.
   */
  makeShopeeSignature(path, timestamp, accessToken = "", shopId = 0) {
    const partnerKey = this.getPartnerKey();
    const base = String(this.partnerId) + path + String(timestamp) +
      (accessToken ? accessToken : "") +
      (shopId ? String(shopId) : "");
    
    return crypto.createHmac('sha256', partnerKey)
      .update(base)
      .digest('hex');
  }

  /**
   * Memvalidasi dan mendapatkan access token aktif (auto refresh jika mendekati kedaluwarsa).
   */
  async getValidAccessToken() {
    const tokens = this.getShopeeTokens();
    if (!tokens.accessToken) {
      throw new Error("Belum terotorisasi ke Shopee. Silakan hubungkan toko terlebih dahulu.");
    }
    const now = Math.floor(Date.now() / 1000);
    // Refresh token jika sisa waktu kurang dari 5 menit (300 detik)
    if (tokens.expireAt > 0 && now >= tokens.expireAt - 300) {
      return await this.refreshShopeeAccessToken();
    }
    return tokens.accessToken;
  }

  /**
   * Melakukan refresh token ke Shopee API.
   */
  async refreshShopeeAccessToken() {
    const tokens = this.getShopeeTokens();
    if (!tokens.refreshToken) {
      throw new Error("Refresh token tidak ditemukan. Silakan lakukan otorisasi ulang.");
    }

    const path = "/api/v2/auth/access_token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.makeShopeeSignature(path, timestamp, "", 0);

    const url = `${this.baseUrl}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`;

    const payload = {
      refresh_token: tokens.refreshToken,
      shop_id: tokens.shopId,
      partner_id: this.partnerId
    };

    try {
      const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
      const data = response.data;

      if (data.error && data.error !== "") {
        throw new Error("Gagal refresh token: " + data.error + " - " + data.message);
      }

      this.saveShopeeTokens(data.access_token, data.refresh_token, tokens.shopId, data.expire_in);
      return data.access_token;
    } catch (err) {
      console.error('[ShopeeService ERROR] Failed to refresh token:', err.message);
      throw err;
    }
  }

  /**
   * Mengirim request GET bertanda tangan ke Shopee API.
   */
  async shopeeGet(path, queryParams = {}) {
    const accessToken = await this.getValidAccessToken();
    const tokens = this.getShopeeTokens();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.makeShopeeSignature(path, timestamp, accessToken, tokens.shopId);

    const params = {
      partner_id: this.partnerId,
      shop_id: tokens.shopId,
      timestamp,
      access_token: accessToken,
      sign,
      ...queryParams
    };

    const url = `${this.baseUrl}${path}`;
    try {
      const response = await axios.get(url, { params });
      const json = response.data;

      if (json.error && json.error !== "" && json.error !== "error_not_found") {
        throw new Error(`Shopee API error [${path}]: ${json.error} - ${json.message || ''}`);
      }
      return json;
    } catch (err) {
      console.error(`[ShopeeService ERROR] GET failed for ${path}:`, err.message);
      throw err;
    }
  }

  /**
   * Mengirim GET Shopee tanpa pernah me-refresh atau menyimpan token.
   *
   * Dipakai oleh audit bukti sumber yang harus fail-closed apabila token tidak
   * aman dipakai. Berbeda dari shopeeGet(), method ini tidak boleh memanggil
   * getValidAccessToken() karena jalur tersebut dapat menulis token baru.
   */
  async shopeeGetReadOnly(path, queryParams = {}) {
    const tokens = this.getShopeeTokens();
    if (!tokens.accessToken || !tokens.shopId) {
      throw new Error('Shopee read-only request rejected: access token or shop ID is unavailable.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expireAt > 0 && now >= tokens.expireAt - 300) {
      throw new Error('Shopee read-only request rejected: access token is near expiry and refresh is forbidden.');
    }

    const timestamp = now;
    const sign = this.makeShopeeSignature(path, timestamp, tokens.accessToken, tokens.shopId);
    const params = {
      partner_id: this.partnerId,
      shop_id: tokens.shopId,
      timestamp,
      access_token: tokens.accessToken,
      sign,
      ...queryParams
    };

    try {
      const response = await axios.get(`${this.baseUrl}${path}`, { params });
      const json = response.data;
      if (json.error && json.error !== '' && json.error !== 'error_not_found') {
        throw new Error(`Shopee read-only API error [${path}]: ${json.error}`);
      }
      return json;
    } catch (err) {
      throw new Error(`Shopee read-only GET failed for ${path}: ${err.message}`);
    }
  }

  /**
   * Dapatkan URL untuk memulai alur Oauth dengan Shopee.
   */
  getShopeeAuthUrl() {
    const path = "/api/v2/shop/auth_partner";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.makeShopeeSignature(path, timestamp, "", 0);
    return `${this.baseUrl}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(this.redirectUrl)}`;
  }

  /**
   * Cek status koneksi otorisasi Shopee saat ini.
   */
  checkShopeeAuth() {
    const tokens = this.getShopeeTokens();
    const isConnected = !!(tokens.accessToken && tokens.shopId);
    return {
      status: "success",
      connected: isConnected,
      shopId: tokens.shopId || null,
      expireAt: tokens.expireAt || null
    };
  }

  /**
   * Menukar authorization code hasil redirect menjadi access & refresh token.
   */
  async exchangeShopeeCode(code, shopId) {
    const path = "/api/v2/auth/token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.makeShopeeSignature(path, timestamp, "", 0);

    const payload = {
      code,
      shop_id: Number(shopId),
      partner_id: this.partnerId
    };

    const url = `${this.baseUrl}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`;

    try {
      const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
      const data = response.data;

      if (data.error && data.error !== "") {
        throw new Error(`Gagal menukar token: ${data.error} - ${data.message}`);
      }

      this.saveShopeeTokens(data.access_token, data.refresh_token, Number(shopId), data.expire_in);
      return { status: "success", message: "Otorisasi Shopee berhasil.", shopId: Number(shopId) };
    } catch (err) {
      console.error('[ShopeeService ERROR] Code exchange failed:', err.message);
      throw err;
    }
  }

  /**
   * Mengambil semua produk aktif dari toko Shopee dan meng-upsert ke sheet ShopeeProducts.
   */
  async syncShopeeProducts() {
    const tokens = this.getShopeeTokens();
    if (!tokens.accessToken || !tokens.shopId) {
      return { status: "error", message: "Belum terotorisasi ke Shopee. Silakan hubungkan toko terlebih dahulu." };
    }

    try {
      // 1. Ambil semua item_id produk aktif
      const itemIds = [];
      let offset = 0;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const listRes = await this.shopeeGet("/api/v2/product/get_item_list", {
          offset,
          page_size: pageSize,
          item_status: "NORMAL"
        });

        const items = (listRes.response && listRes.response.item) || [];
        items.forEach(i => itemIds.push(i.item_id));

        hasMore = !!(listRes.response && listRes.response.has_next_page);
        offset += pageSize;

        // Safety limit: max 500 item per sinkronisasi
        if (itemIds.length >= 500) break;
      }

      if (itemIds.length === 0) {
        return { status: "success", message: "Tidak ada produk aktif di toko.", newCount: 0, updateCount: 0 };
      }

      // 2. Ambil detail info base + list variasi untuk tiap produk
      const allProducts = [];
      const chunkSize = 50;

      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const chunk = itemIds.slice(i, i + chunkSize);
        const infoRes = await this.shopeeGet("/api/v2/product/get_item_base_info", {
          item_id_list: chunk.join(","),
          need_tax_info: false,
          need_complaint_policy: false
        });

        const itemList = (infoRes.response && infoRes.response.item_list) || [];

        for (const item of itemList) {
          const itemId = String(item.item_id);
          const itemName = item.item_name || "";

          // Tarik variasi (model)
          const modelRes = await this.shopeeGet("/api/v2/product/get_model_list", {
            item_id: item.item_id
          });

          const models = (modelRes.response && modelRes.response.model) || [];

          if (models.length === 0) {
            // Tanpa variasi
            allProducts.push({
              itemId,
              modelId: "0",
              name: itemName,
              variation: "-",
              sku: item.item_sku || ""
            });
          } else {
            models.forEach(model => {
              allProducts.push({
                itemId,
                modelId: String(model.model_id),
                name: itemName,
                variation: (model.model_name || "").trim() || "-",
                sku: model.model_sku || item.item_sku || ""
              });
            });
          }
        }
      }

      // 3. Upsert data ke sheet ShopeeProducts
      const counts = await this.shopeeRepo.upsertShopeeProducts(allProducts);

      return {
        status: "success",
        message: "Sync produk dari Shopee berhasil.",
        newCount: counts.newCount,
        updateCount: counts.updateCount,
        totalProducts: allProducts.length,
        source: "shopee_live_api"
      };
    } catch (err) {
      console.error('[ShopeeService ERROR] Product sync failed:', err.message);
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Menyimpan / Memperbarui pemetaan produk Shopee ke SKU Inventaris Lokal.
   */
  async saveShopeeMapping(data) {
    const { itemId, modelId, sellerSku, inventorySku, inventoryName, verifiedBy } = data;
    if (!itemId || !inventorySku) {
      return { status: "error", message: "Item ID dan Inventory SKU wajib diisi." };
    }

    try {
      // Periksa duplikasi SKU Inventaris di mapping lain
      const existingMappings = await this.shopeeRepo.getShopeeMappings();
      for (const m of existingMappings) {
        if (m.inventory_sku === inventorySku && !(String(m.item_id) === String(itemId) && String(m.model_id) === String(modelId))) {
          return {
            status: "error",
            message: `SKU Inventaris '${inventorySku}' sudah dipakai oleh variasi Shopee lain (${m.item_id} / ${m.model_id}). Satu SKU hanya boleh dipetakan ke satu variasi Shopee.`
          };
        }
      }

      // Cari properti variant real dari MasterBarang untuk mencocokkan nama & stok
      const masterProduct = await this.masterRepo.findByVariant(inventorySku, "", "");
      const resolvedName = masterProduct ? masterProduct.nama : (inventoryName || "");
      const resolvedWarna = masterProduct ? masterProduct.warna : "";
      const resolvedUkuran = masterProduct ? masterProduct.ukuran : "";
      const resolvedStok = masterProduct ? masterProduct.stok : 0;

      // Simpan mapping
      await this.shopeeRepo.saveShopeeMapping({
        itemId,
        modelId,
        sellerSku,
        inventorySku,
        inventoryProductName: resolvedName,
        verifiedBy: verifiedBy || "Admin"
      });

      // Update status mapping produk di ShopeeProducts
      await this.shopeeRepo.updateShopeeProductMappingStatus(itemId, modelId, "Mapped");

      // Catat log aktivitas mapping
      await this.shopeeRepo.logShopeeActivity(
        "MAPPING_PRODUK",
        "",
        inventorySku,
        "SUCCESS",
        `Produk mapped: Shopee Item ID ${itemId} / Model ID ${modelId} -> SKU ${inventorySku}`
      );

      return {
        status: "success",
        message: "Mapping berhasil disimpan.",
        inventoryName: resolvedName,
        warna: resolvedWarna,
        ukuran: resolvedUkuran,
        stok: resolvedStok
      };
    } catch (err) {
      console.error('[ShopeeService ERROR] Save mapping failed:', err.message);
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Menghapus pemetaan produk Shopee ke SKU Inventaris Lokal.
   */
  async deleteShopeeMapping(data) {
    const { itemId, modelId, callerRole } = data;
    if (String(callerRole).trim() !== "Admin") {
      return { status: "error", message: "Hanya Admin yang dapat menghapus mapping." };
    }
    if (!itemId || !modelId) {
      return { status: "error", message: "Item ID dan Model ID wajib ada." };
    }

    try {
      const deleted = await this.shopeeRepo.deleteShopeeMapping(itemId, modelId);
      if (!deleted) {
        return { status: "error", message: "Mapping tidak ditemukan." };
      }

      // Reset status mapping produk di ShopeeProducts
      await this.shopeeRepo.updateShopeeProductMappingStatus(itemId, modelId, "Belum Mapped");

      // Catat log aktivitas delete mapping
      await this.shopeeRepo.logShopeeActivity(
        "DELETE_MAPPING",
        "",
        "",
        "SUCCESS",
        `Mapping dihapus: Shopee Item ID ${itemId} / Model ID ${modelId}`
      );

      return { status: "success", message: "Mapping berhasil dihapus." };
    } catch (err) {
      console.error('[ShopeeService ERROR] Delete mapping failed:', err.message);
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Memberikan saran SKU Inventaris yang cocok untuk variasi Shopee tertentu.
   */
  async getAutoSuggestMapping(data) {
    try {
      const shopeeNama = String(data.nama_produk || '').toLowerCase();
      const shopeeVariasi = String(data.variasi || '').toLowerCase();
      const shopeeSku = String(data.seller_sku || '').toLowerCase();

      // Pecah nama variasi
      const varParts = shopeeVariasi.split(/[,\-\/]/).map(s => s.trim());
      const shopeeWarna = varParts[0] || "";
      const shopeeUkuran = varParts[1] || varParts[0] || "";

      const normalizeUkuran = s => String(s || '').toUpperCase().replace(/\s/g, "");
      const normalizeWarna = s => String(s || '').toLowerCase().replace(/\s/g, "");

      const masterProducts = await this.masterRepo.getAllProducts();
      const suggestions = [];

      for (const p of masterProducts) {
        const kode = String(p["Kode Barang"] || '').trim();
        const nama = String(p["Nama Barang"] || '').trim().toLowerCase();
        const warna = String(p["Warna"] || '').trim().toLowerCase();
        const ukuran = String(p["Ukuran"] || '').trim().toLowerCase();
        const stok = Number(p["Stok Saat Ini"] || 0);

        let score = 0;
        const reasons = [];

        // 1. Seller SKU cocok persis dengan Kode Barang
        if (shopeeSku && shopeeSku === kode.toLowerCase()) {
          score += 100;
          reasons.push("seller_sku exact match");
        }

        // 2. Kecocokan kata nama produk
        const namaWords = nama.split(/\s+/).filter(w => w.length > 2);
        const shopeeNamaWords = shopeeNama.split(/\s+/).filter(w => w.length > 2);
        const namaMatches = shopeeNamaWords.filter(w => namaWords.some(nw => nw.includes(w) || w.includes(nw)));
        if (namaMatches.length > 0) {
          score += Math.min(40, namaMatches.length * 15);
          reasons.push(`nama cocok: ${namaMatches.join(", ")}`);
        }

        // 3. Kecocokan warna
        if (shopeeWarna && normalizeWarna(warna).includes(normalizeWarna(shopeeWarna))) {
          score += 30;
          reasons.push("warna cocok");
        }

        // 4. Kecocokan ukuran
        if (shopeeUkuran && normalizeUkuran(ukuran) === normalizeUkuran(shopeeUkuran)) {
          score += 25;
          reasons.push("ukuran exact match");
        } else if (shopeeUkuran && normalizeUkuran(ukuran).includes(normalizeUkuran(shopeeUkuran))) {
          score += 10;
          reasons.push("ukuran partial match");
        }

        if (score >= 20) {
          const confidence = score >= 80 ? "High" : score >= 50 ? "Medium" : "Low";
          suggestions.push({
            kode,
            nama: p["Nama Barang"] || '',
            warna: p["Warna"] || '',
            ukuran: p["Ukuran"] || '',
            stok,
            score,
            confidence,
            reasons: reasons.join("; ")
          });
        }
      }

      suggestions.sort((a, b) => b.score - a.score);
      return { status: "success", suggestions: suggestions.slice(0, 5) };
    } catch (err) {
      console.error('[ShopeeService ERROR] Auto suggest failed:', err.message);
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * Mengambil data orders Shopee dalam rentang waktu tertentu.
   * Kueri list_order -> base_info_order (chunk 50) -> upsert ke sheet ShopeeOrders.
   */
  async syncShopeeOrders(data) {
    const tokens = this.getShopeeTokens();
    if (!tokens.accessToken || !tokens.shopId) {
      return { status: "error", message: "Belum terotorisasi ke Shopee. Silakan hubungkan toko terlebih dahulu." };
    }

    try {
      const timeFrom = Math.floor(Date.now() / 1000) - (7 * 24 * 3600); // 7 hari terakhir
      const timeTo = Math.floor(Date.now() / 1000);

      // Kueri list_order
      const orderSns = [];
      let cursor = "";
      let hasMore = true;

      while (hasMore) {
        const params = {
          time_range_field: "create_time",
          time_from: timeFrom,
          time_to: timeTo,
          page_size: 50
        };
        if (cursor) params.cursor = cursor;

        const listRes = await this.shopeeGet("/api/v2/order/get_order_list", params);
        const orders = (listRes.response && listRes.response.order_list) || [];
        orders.forEach(o => orderSns.push(o.order_sn));

        hasMore = listRes.response && listRes.response.more;
        cursor = (listRes.response && listRes.response.next_cursor) || "";
      }

      if (orderSns.length === 0) {
        return { status: "success", message: "Sync pesanan berhasil. Tidak ada pesanan baru.", newCount: 0, updateCount: 0 };
      }

      // Kueri get_order_detail
      const orderDetails = [];
      const chunkSize = 50;

      for (let i = 0; i < orderSns.length; i += chunkSize) {
        const chunk = orderSns.slice(i, i + chunkSize);
        const detailRes = await this.shopeeGet("/api/v2/order/get_order_detail", {
          order_sn_list: chunk.join(","),
          response_optional_fields: "buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,cod,payment_method,item_list"
        });

        const orderList = (detailRes.response && detailRes.response.order_list) || [];

        for (const order of orderList) {
          const itemsMap = (order.item_list || []).map(item => ({
            itemId: item.item_id,
            modelId: item.model_id,
            itemName: item.item_name,
            modelName: item.model_name,
            sku: item.model_sku || item.item_sku || "",
            qty: item.model_quantity_purchased,
            originalPrice: item.model_original_price
          }));

          const address = order.recipient_address || {};
          const fullAddress = [
            address.full_address,
            address.district,
            address.city,
            address.state,
            address.region
          ].filter(Boolean).join(", ");

          orderDetails.push({
            order_sn: order.order_sn,
            shop_id: tokens.shopId,
            buyer_username: order.buyer_username || "",
            order_status: order.order_status,
            create_time: getJakartaTimeString(new Date(order.create_time * 1000)),
            pay_time: order.pay_time ? getJakartaTimeString(new Date(order.pay_time * 1000)) : "",
            total_amount: order.total_amount || 0,
            actual_shipping_fee: order.actual_shipping_fee || 0,
            estimated_shipping_fee: order.estimated_shipping_fee || 0,
            cod: order.cod || false,
            payment_method: order.payment_method || "",
            recipient_name: address.name || "",
            recipient_phone: address.phone || "",
            recipient_address: fullAddress,
            items_json: JSON.stringify(itemsMap),
            deduct_status: "PENDING",
            deduct_error: "",
            webhook_received_at: "",
            processed_at: ""
          });
        }
      }

      // Upsert ke sheet ShopeeOrders
      const counts = await this.shopeeRepo.upsertShopeeOrders(orderDetails);

      // Tandai sinkronisasi selesai pada properties
      propertiesService.setProperty('LAST_SYNC', new Date().toISOString());

      return {
        status: "success",
        message: "Sync pesanan berhasil.",
        newCount: counts.newCount,
        updateCount: counts.updateCount,
        source: "shopee_live_api",
        newLedger: 0,
        updatedLedger: 0,
        paymentFetched: 0,
        paymentFailed: 0
      };
    } catch (err) {
      console.error('[ShopeeService ERROR] Order sync failed:', err.message);
      await this.shopeeRepo.logShopeeActivity("SYNC_ERROR", "", "", "FAILED", err.toString());
      return { status: "error", message: err.toString() };
    }
  }

  /**
   * pagination + search server-side untuk produk Shopee.
   */
  async getShopeeProductsPaged(params) {
    try {
      const page = Math.max(1, parseInt(params.page || "1", 10));
      const limit = Math.max(1, parseInt(params.limit || "12", 10));
      const search = String(params.search || "").trim().toLowerCase();

      const allProducts = await this.shopeeRepo.getShopeeProducts();
      const allMappings = await this.shopeeRepo.getShopeeMappings();

      // Buat mapping lookup
      const mappingMap = {};
      allMappings.forEach(m => {
        mappingMap[String(m.item_id) + "_" + String(m.model_id)] = m;
      });

      // Pasang status_mapping & inventory_sku
      allProducts.forEach(p => {
        const key = String(p.item_id) + "_" + String(p.model_id);
        p.status_mapping = mappingMap[key] ? "Mapped" : "Belum Mapped";
        if (mappingMap[key]) {
          p.inventory_sku = mappingMap[key].inventory_sku || "";
        }
      });

      // KPI dihitung dari SELURUH data
      let mapped = 0, unmapped = 0;
      allProducts.forEach(p => {
        if (p.status_mapping === "Mapped") mapped++; else unmapped++;
      });
      const total = allProducts.length;
      const pct = total === 0 ? 0 : Math.round((mapped / total) * 100);

      // Filter berdasarkan search
      let filtered = allProducts;
      if (search) {
        filtered = allProducts.filter(p =>
          String(p.item_id || "").toLowerCase().includes(search) ||
          String(p.nama_produk || "").toLowerCase().includes(search) ||
          String(p.variasi || "").toLowerCase().includes(search) ||
          String(p.seller_sku || "").toLowerCase().includes(search)
        );
      }

      const totalFiltered = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * limit;
      const pageProducts = filtered.slice(start, start + limit);

      return {
        status: "success",
        products: pageProducts,
        total: totalFiltered,
        page: safePage,
        totalPages,
        kpi: { total, mapped, unmapped, pct }
      };
    } catch (e) {
      console.error('[ShopeeService ERROR] Paged products failed:', e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * pagination + search + tab filtering server-side untuk order Shopee.
   */
  async getShopeeOrdersPaged(params) {
    try {
      const page = Math.max(1, parseInt(params.page || "1", 10));
      const limit = Math.max(1, parseInt(params.limit || "25", 10));
      const tab = String(params.tab || params.filter || "ALL").toUpperCase();
      
      const searchSn = String(params.searchSn || params.search || "").trim().toLowerCase();
      const searchProduct = String(params.searchProduct || "").trim().toLowerCase();
      const searchSku = String(params.searchSku || "").trim().toLowerCase();
      const filterMapping = String(params.filterMapping || "").trim().toUpperCase();
      const filterDeduction = String(params.filterDeduction || "").trim().toUpperCase();
      
      const dateFrom = params.dateFrom ? new Date(params.dateFrom + "T00:00:00") : null;
      const dateTo = params.dateTo ? new Date(params.dateTo + "T23:59:59") : null;

      const allOrders = await this.shopeeRepo.getShopeeOrders();

      const RETURN_CANCEL = ["CANCELLED", "IN_CANCEL", "TO_RETURN", "RETURNED"];
      const SHIPPED_GROUP = ["SHIPPED", "PROCESSED", "TO_CONFIRM_RECEIVE"];
      const now = Date.now();
      const DAY_MS = 86400000;

      // 1. KPI & tabCounts dari SELURUH data
      let kpiNew = 0, kpiUnpaid = 0, kpiReady = 0, kpiShipped = 0, kpiDone = 0, kpiCancel = 0, kpiReturn = 0, kpiUnmap = 0, kpiFail = 0, kpiPend = 0;
      const tabCounts = { ALL: 0, UNPAID: 0, READY_TO_SHIP: 0, SHIPPED: 0, COMPLETED: 0, RETURN_CANCEL: 0 };

      // 2. Build rows + filter sekaligus
      const filtered = [];

      for (const order of allOrders) {
        const st = String(order.order_status || "").toUpperCase();
        const ded = String(order.deduct_status || "PENDING").toUpperCase();
        const map = String(order.mapping_status || "").toUpperCase();
        const ct = order.create_time;

        // Hitung tab counts & KPI
        tabCounts.ALL++;
        if (st === "UNPAID") tabCounts.UNPAID++;
        else if (st === "READY_TO_SHIP") tabCounts.READY_TO_SHIP++;
        else if (SHIPPED_GROUP.includes(st)) tabCounts.SHIPPED++;
        else if (st === "COMPLETED") tabCounts.COMPLETED++;
        else if (RETURN_CANCEL.includes(st)) tabCounts.RETURN_CANCEL++;

        const created = ct ? new Date(ct).getTime() : 0;
        if (created && (now - created) < DAY_MS) kpiNew++;
        if (st === "UNPAID") kpiUnpaid++;
        if (st === "READY_TO_SHIP") kpiReady++;
        if (SHIPPED_GROUP.includes(st)) kpiShipped++;
        if (st === "COMPLETED") kpiDone++;
        if (st === "CANCELLED" || st === "IN_CANCEL") kpiCancel++;
        if (st === "TO_RETURN" || st === "RETURNED") kpiReturn++;
        if (map === "UNMAPPED") kpiUnmap++;
        if (ded === "FAILED") kpiFail++;
        if (ded === "PENDING" && st === "READY_TO_SHIP") kpiPend++;
        if (ded === "WAITING_APPROVAL") kpiPend++;
        if (ded === "RETURN_PENDING") kpiFail++;

        // --- Filter Tab ---
        let passTab = false;
        if (tab === "ALL") passTab = true;
        else if (tab === "UNPAID") passTab = st === "UNPAID";
        else if (tab === "READY_TO_SHIP") passTab = st === "READY_TO_SHIP";
        else if (tab === "SHIPPED") passTab = SHIPPED_GROUP.includes(st);
        else if (tab === "COMPLETED") passTab = st === "COMPLETED";
        else if (tab === "RETURN_CANCEL") passTab = RETURN_CANCEL.includes(st);
        else if (tab === "UNMAPPED") passTab = map === "UNMAPPED";
        else if (tab === "DEDUCT_FAILED") passTab = ded === "FAILED";
        else passTab = st === tab;
        
        if (!passTab) continue;

        // --- Advanced Filter ---
        if (filterMapping === "MAPPED" && map !== "MAPPED") continue;
        if (filterMapping === "UNMAPPED" && map === "MAPPED") continue;
        
        if (filterDeduction && filterDeduction !== "ALL") {
          const dedMatch = ded === filterDeduction || (filterDeduction === "DEDUCTED" && ded === "SUCCESS");
          if (!dedMatch) continue;
        }

        // --- Date Filter ---
        if (dateFrom || dateTo) {
          const d = ct ? new Date(ct) : null;
          if (!d || isNaN(d.getTime())) continue;
          if (dateFrom && d < dateFrom) continue;
          if (dateTo && d > dateTo) continue;
        }

        // --- Search ---
        const sn = String(order.order_sn || "").toLowerCase();
        const prod = String(order.product_name || "").toLowerCase();
        const sku = String(order.inventory_sku || "").toLowerCase();
        const buyer = String(order.buyer_name || "").toLowerCase();
        const vari = String(order.variation_name || "").toLowerCase();
        
        if (searchSn && !sn.includes(searchSn)) continue;
        if (searchProduct && !prod.includes(searchProduct) && !vari.includes(searchProduct) && !buyer.includes(searchProduct)) continue;
        if (searchSku && !sku.includes(searchSku)) continue;

        // Build data compatible output
        filtered.push({
          order_sn: order.order_sn || "",
          shop_id: order.shop_id || "",
          buyer_name: order.buyer_name || "",
          order_status: order.order_status || "",
          item_id: order.item_id || "",
          model_id: order.model_id || "",
          product_name: order.product_name || "",
          variation_name: order.variation_name || "",
          qty: order.qty || 1,
          amount: order.amount || 0,
          create_time: order.create_time || "",
          mapping_status: order.mapping_status || "",
          inventory_sku: order.inventory_sku || "",
          deduction_status: order.deduction_status || "PENDING",
          deducted_at: order.deducted_at || "",
          deducted_by: order.deducted_by || "",
          restocked_at: order.restocked_at || "",
          restocked_by: order.restocked_by || ""
        });
      }

      // Sort: terbaru dulu
      filtered.sort((a, b) => (b.create_time > a.create_time ? 1 : -1));

      const totalFiltered = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * limit;
      const pageOrders = filtered.slice(start, start + limit);

      return {
        status: "success",
        orders: pageOrders,
        total: totalFiltered,
        page: safePage,
        totalPages,
        tabCounts,
        kpi: {
          newOrders: kpiNew,
          unpaid: kpiUnpaid,
          readyToShip: kpiReady,
          shipped: kpiShipped,
          completed: kpiDone,
          cancelled: kpiCancel,
          returned: kpiReturn,
          unmapped: kpiUnmap,
          failed: kpiFail,
          pendingDeduct: kpiPend
        }
      };
    } catch (e) {
      console.error('[ShopeeService ERROR] Paged orders failed:', e.message);
      return { status: "error", message: e.toString() };
    }
  }
}
