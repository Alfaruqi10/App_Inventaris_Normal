import sheetsService from '../repositories/sheets/sheetsService.js';

export class AdsService {
  constructor(adsRepository) {
    this.adsRepo = adsRepository;
  }

  /**
   * Helper untuk robustly mengubah nilai Tanggal sheet ke format YYYY-MM-DD.
   */
  _parseAdsDateToISO(val) {
    if (!val) return "";
    
    // Jika berupa Date object
    if (val instanceof Date) {
      const yyyy = val.getFullYear();
      const mm = String(val.getMonth() + 1).padStart(2, "0");
      const dd = String(val.getDate()).padStart(2, "0");
      return yyyy + "-" + mm + "-" + dd;
    }

    const s = String(val).trim();
    // Format DD-MM-YYYY
    if (s.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const p = s.split("-");
      return p[2] + "-" + p[1] + "-" + p[0];
    }
    // Format YYYY-MM-DD
    if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return s;
    }

    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return yyyy + "-" + mm + "-" + dd;
    }
    return s;
  }

  /**
   * Helper untuk mendapatkan tanggal hari ini dalam format YYYY-MM-DD.
   */
  _formatDateStr(d) {
    if (!d) return "";
    const dateObj = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return "";
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  _cleanText(val) {
    if (val === undefined || val === null) return "";
    return String(val).trim();
  }

  /**
   * Mengumpulkan mapping dan stok inventory dari database sheet.
   * ItemID -> { sku, stock, status }
   */
  async _getInventoryMappingMap() {
    const map = {};
    try {
      const mappings = await sheetsService.readSheetObjects("ShopeeMapping") || [];
      const masterRows = await sheetsService.readSheetObjects("MasterBarang") || [];
      const stockMap = {};

      masterRows.forEach(row => {
        const sku = String(row["Kode Barang"] || "").trim();
        const stock = parseInt(row["Stok Saat Ini"]) || 0;
        if (sku) {
          stockMap[sku] = stock;
        }
      });

      mappings.forEach(m => {
        const itemId = String(m.item_id || m.itemId || "").trim();
        const sku = String(m.inventory_sku || m.inventorySku || "").trim();
        if (itemId) {
          const stock = stockMap[sku] !== undefined ? stockMap[sku] : 0;
          let status = "NORMAL";
          if (stock <= 0) status = "OUT_OF_STOCK";
          else if (stock <= 5) status = "LOW_STOCK";

          map[itemId] = {
            sku: sku,
            stock: stock,
            status: status
          };
        }
      });
    } catch (e) {
      console.error("[AdsService ERROR] _getInventoryMappingMap failed:", e.message);
    }
    return map;
  }

  /**
   * GET getAdsDashboard — Saldo KPI + 13 parameter agregasi performa + Grafik deret harian.
   */
  async getAdsDashboard(params) {
    try {
      const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
      const dateTo = (params && params.dateTo) ? params.dateTo : this._formatDateStr(new Date());

      const balanceRows = await this.adsRepo.getAdsBalance() || [];
      const campaignRows = await this.adsRepo.getAdsCampaigns() || [];
      const dailyRows = await this.adsRepo.getAdsProductDaily() || [];

      // Saldo KPI
      let currentBalance = 0;
      let currency = "IDR";
      let balanceUpdatedAt = "—";
      if (balanceRows.length > 0) {
        const lastB = balanceRows[balanceRows.length - 1];
        currentBalance = parseFloat(lastB["Balance"]) || 0;
        currency = lastB["Currency"] || "IDR";
        balanceUpdatedAt = lastB["UpdatedAt"] || "—";
      }

      // Hitung KPI Kampanye (kecuali kampanye virtual "auto")
      let totalCampaigns = 0;
      let activeCampaigns = 0;
      let pausedCampaigns = 0;
      campaignRows.forEach(c => {
        const cId = this._cleanText(c["CampaignID"]);
        if (cId === "auto") return;
        totalCampaigns++;
        const st = String(c["Status"] || "").toLowerCase();
        if (st === "ongoing" || st === "active") activeCampaigns++;
        else if (st === "paused" || st === "closed" || st === "schedule") pausedCampaigns++;
      });

      // Agregasi Performa dalam Rentang Tanggal
      let totalSpend = 0;
      let totalSales = 0;
      let totalOrders = 0;
      let totalSoldQty = 0;
      let totalClicks = 0;
      let totalImpressions = 0;

      let manualSpendDebug = 0;
      let manualSalesDebug = 0;
      let autoSpendDebug = 0;
      let autoSalesDebug = 0;
      let totalClicksDebug = 0;
      let totalImpressionsDebug = 0;

      const dailyPerformanceMap = {};

      dailyRows.forEach(r => {
        const isoDate = this._parseAdsDateToISO(r["Date"]);
        if (isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
          const spend = parseFloat(r["Spend"]) || 0;
          const sales = parseFloat(r["Sales"]) || 0;
          const orders = parseInt(r["Orders"]) || 0;
          const soldQty = parseInt(r["SoldQty"]) || 0;
          const clicks = parseInt(r["Clicks"]) || 0;
          const impressions = parseInt(r["Impressions"]) || 0;

          totalSpend += spend;
          totalSales += sales;
          totalOrders += orders;
          totalSoldQty += soldQty;
          totalClicks += clicks;
          totalImpressions += impressions;

          const cId = this._cleanText(r["CampaignID"]);
          if (cId === "auto") {
            autoSpendDebug += spend;
            autoSalesDebug += sales;
          } else {
            manualSpendDebug += spend;
            manualSalesDebug += sales;
          }
          totalClicksDebug += clicks;
          totalImpressionsDebug += impressions;

          if (!dailyPerformanceMap[isoDate]) {
            dailyPerformanceMap[isoDate] = { date: isoDate, spend: 0, sales: 0, orders: 0, soldQty: 0, clicks: 0, impressions: 0 };
          }
          dailyPerformanceMap[isoDate].spend += spend;
          dailyPerformanceMap[isoDate].sales += sales;
          dailyPerformanceMap[isoDate].orders += orders;
          dailyPerformanceMap[isoDate].soldQty += soldQty;
          dailyPerformanceMap[isoDate].clicks += clicks;
          dailyPerformanceMap[isoDate].impressions += impressions;
        }
      });

      const roas = totalSpend > 0 ? (totalSales / totalSpend).toFixed(2) : "0.00";
      const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + "%" : "0.00%";
      const cpc = totalClicks > 0 ? Math.round(totalSpend / totalClicks) : 0;
      const cpm = totalImpressions > 0 ? Math.round((totalSpend / totalImpressions) * 1000) : 0;
      const acos = totalSales > 0 ? ((totalSpend / totalSales) * 100).toFixed(2) + "%" : "0.00%";

      const debugInfo = {
        campaignsFound: totalCampaigns,
        campaignsProcessed: totalCampaigns,
        manualSpend: manualSpendDebug,
        manualSales: manualSalesDebug,
        autoSpend: autoSpendDebug,
        autoSales: autoSalesDebug,
        totalSpend: totalSpend,
        totalSales: totalSales,
        totalClicks: totalClicksDebug,
        totalImpressions: totalImpressionsDebug,
        roas: roas
      };

      const chartDates = Object.keys(dailyPerformanceMap).sort();
      const chartSeries = {
        dates: chartDates,
        spend: chartDates.map(d => dailyPerformanceMap[d].spend),
        sales: chartDates.map(d => dailyPerformanceMap[d].sales),
        orders: chartDates.map(d => dailyPerformanceMap[d].orders),
        soldQty: chartDates.map(d => dailyPerformanceMap[d].soldQty),
        clicks: chartDates.map(d => dailyPerformanceMap[d].clicks),
        ctr: chartDates.map(d => dailyPerformanceMap[d].impressions > 0 ? parseFloat(((dailyPerformanceMap[d].clicks / dailyPerformanceMap[d].impressions) * 100).toFixed(2)) : 0),
        roas: chartDates.map(d => dailyPerformanceMap[d].spend > 0 ? parseFloat((dailyPerformanceMap[d].sales / dailyPerformanceMap[d].spend).toFixed(2)) : 0)
      };

      // Integrasi Inventory Stok Alert
      const mappingMap = await this._getInventoryMappingMap();
      const inventoryAlerts = [];
      let topSellingProducts = [];

      campaignRows.forEach(c => {
        const itemId = String(c["ItemID"] || "").trim();
        const campaignName = String(c["CampaignName"] || "").trim();
        const cId = String(c["CampaignID"] || "");
        if (cId === "auto") return; // Abaikan virtual kampanye auto
        
        if (itemId && mappingMap[itemId]) {
          const inv = mappingMap[itemId];
          if (inv.status === "LOW_STOCK" || inv.status === "OUT_OF_STOCK") {
            inventoryAlerts.push({
              campaignId: cId,
              campaignName: campaignName,
              sku: inv.sku,
              stock: inv.stock,
              status: inv.status
            });
          }
        }
      });

      // Top Terlaris berdasarkan Penjualan Iklan
      const productSalesMap = {};
      dailyRows.forEach(r => {
        const itemId = String(r["ItemID"] || "").trim();
        const pName = String(r["ProductName"] || "").trim();
        const cId = String(r["CampaignID"] || "");
        if (cId === "auto") return; // Lewati kampanye virtual
        
        if (itemId) {
          if (!productSalesMap[itemId]) {
            productSalesMap[itemId] = { itemId, name: pName, spend: 0, sales: 0, orders: 0, soldQty: 0 };
          }
          productSalesMap[itemId].spend += parseFloat(r["Spend"]) || 0;
          productSalesMap[itemId].sales += parseFloat(r["Sales"]) || 0;
          productSalesMap[itemId].orders += parseInt(r["Orders"]) || 0;
          productSalesMap[itemId].soldQty += parseInt(r["SoldQty"]) || 0;
        }
      });

      topSellingProducts = Object.values(productSalesMap).map(p => {
        const inv = mappingMap[p.itemId] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };
        return {
          ...p,
          sku: inv.sku,
          stock: inv.stock,
          status: inv.status,
          needRestock: (inv.status === "LOW_STOCK" || inv.status === "OUT_OF_STOCK") ? "Ya" : "Tidak"
        };
      });
      topSellingProducts.sort((a, b) => b.sales - a.sales);

      return {
        status: "success",
        dateFrom,
        dateTo,
        kpis: {
          balance: currentBalance,
          currency,
          balanceUpdatedAt,
          totalCampaigns,
          activeCampaigns,
          pausedCampaigns,
          totalSpend,
          totalSales,
          totalOrders,
          totalSoldQty,
          totalClicks,
          totalImpressions,
          roas,
          ctr,
          cpc,
          cpm,
          acos
        },
        chartSeries,
        inventoryAlerts,
        topSellingProducts: topSellingProducts.slice(0, 5),
        debugInfo
      };
    } catch (e) {
      console.error("[AdsService ERROR] getAdsDashboard failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * GET getAdsCampaigns — Daftar Manajemen Kampanye + Integrasi Stok Gudang.
   */
  async getAdsCampaigns(params) {
    try {
      const campaignRows = await this.adsRepo.getAdsCampaigns() || [];
      const dailyRows = await this.adsRepo.getAdsProductDaily() || [];
      const mappingMap = await this._getInventoryMappingMap();

      const search = (params && params.search) ? this._cleanText(params.search).toLowerCase() : "";
      const statusFilter = (params && params.status) ? this._cleanText(params.status).toUpperCase() : "";
      const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
      const dateTo = (params && params.dateTo) ? params.dateTo : this._formatDateStr(new Date());

      // Kalkulasi agregasi metrik per kampanye dalam rentang waktu terfilter
      const metricsMap = {};
      dailyRows.forEach(r => {
        const cId = this._cleanText(r["CampaignID"]);
        const isoDate = this._parseAdsDateToISO(r["Date"]);
        if (cId && isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
          if (!metricsMap[cId]) {
            metricsMap[cId] = { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
          }
          metricsMap[cId].spend += parseFloat(r["Spend"]) || 0;
          metricsMap[cId].sales += parseFloat(r["Sales"]) || 0;
          metricsMap[cId].orders += parseInt(r["Orders"]) || 0;
          metricsMap[cId].clicks += parseInt(r["Clicks"]) || 0;
          metricsMap[cId].impressions += parseInt(r["Impressions"]) || 0;
        }
      });

      const campaigns = campaignRows.map(c => {
        const cId = this._cleanText(c["CampaignID"]);
        const name = this._cleanText(c["CampaignName"]) || ("Iklan #" + cId);
        const status = this._cleanText(c["Status"]) || "unknown";
        const budget = parseFloat(c["Budget"]) || 0;
        const budgetType = this._cleanText(c["BudgetType"]) || "DAILY";
        const itemIdsStr = this._cleanText(c["ItemID"] || "");
        const firstItemId = itemIdsStr.split(",")[0] || "";

        const m = metricsMap[cId] || { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };

        const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(2) + "%" : "0.00%";
        const cpc = m.clicks > 0 ? Math.round(m.spend / m.clicks) : 0;
        const roas = m.spend > 0 ? (m.sales / m.spend).toFixed(2) : "0.00";

        // Integrasi Stok
        const inv = mappingMap[firstItemId] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };

        return {
          ShopID: this._cleanText(c["ShopID"]) || "0",
          CampaignID: cId,
          CampaignName: name,
          CampaignType: this._cleanText(c["CampaignType"]) || "SEARCH_AD",
          ItemID: itemIdsStr,
          Status: status,
          Budget: budget,
          BudgetType: budgetType,
          Spend: m.spend,
          Sales: m.sales,
          Orders: m.orders,
          Clicks: m.clicks,
          Impressions: m.impressions,
          CTR: ctr,
          CPC: cpc,
          ROAS: roas,
          InventorySKU: inv.sku,
          Stock: inv.stock,
          StockStatus: inv.status,
          CreatedTime: c["CreatedAt"] || "—",
          UpdatedTime: c["UpdatedAt"] || "—"
        };
      }).filter(c => {
        if (search && !c.CampaignName.toLowerCase().includes(search) && !c.CampaignID.toLowerCase().includes(search)) return false;
        if (statusFilter && statusFilter !== "ALL") {
          const cStatus = c.Status.toUpperCase();
          if (statusFilter === "ONGOING" && cStatus !== "ONGOING" && cStatus !== "ACTIVE") return false;
          if (statusFilter === "PAUSED" && cStatus !== "PAUSED" && cStatus !== "CLOSED") return false;
        }
        return true;
      });

      return {
        status: "success",
        campaigns
      };
    } catch (e) {
      console.error("[AdsService ERROR] getAdsCampaigns failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * GET getAdsProductPerformance — Tabel performa detail produk iklan.
   */
  async getAdsProductPerformance(params) {
    try {
      const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
      const dateTo = (params && params.dateTo) ? params.dateTo : this._formatDateStr(new Date());
      const sortBy = (params && params.sortBy) ? params.sortBy : "roas";
      const campaignFilter = (params && params.campaign) ? this._cleanText(params.campaign) : "";
      const productFilter = (params && params.product) ? this._cleanText(params.product).toLowerCase() : "";
      const statusFilter = (params && params.status) ? this._cleanText(params.status).toUpperCase() : "";

      const dailyRows = await this.adsRepo.getAdsProductDaily() || [];
      const campaignRows = await this.adsRepo.getAdsCampaigns() || [];

      // Status Kampanye Map
      const campaignStatusMap = {};
      campaignRows.forEach(c => {
        campaignStatusMap[this._cleanText(c["CampaignID"])] = this._cleanText(c["Status"]) || "unknown";
      });

      const mappingMap = await this._getInventoryMappingMap();
      const itemMap = {};

      dailyRows.forEach(r => {
        const isoDate = this._parseAdsDateToISO(r["Date"]);
        if (isoDate && isoDate >= dateFrom && isoDate <= dateTo) {
          const itemId = this._cleanText(r["ItemID"]);
          const cId = this._cleanText(r["CampaignID"]);
          const pName = this._cleanText(r["ProductName"]) || "Produk Iklan #" + itemId;

          // Filter
          if (campaignFilter && cId !== campaignFilter) return;
          if (productFilter && !pName.toLowerCase().includes(productFilter) && !itemId.includes(productFilter)) return;

          const cStatus = campaignStatusMap[cId] || "unknown";
          if (statusFilter && statusFilter !== "ALL") {
            const uStatus = cStatus.toUpperCase();
            if (statusFilter === "ONGOING" && uStatus !== "ONGOING" && uStatus !== "ACTIVE") return;
            if (statusFilter === "PAUSED" && uStatus !== "PAUSED" && uStatus !== "CLOSED") return;
          }

          const key = cId + "_" + itemId;
          if (!itemMap[key]) {
            itemMap[key] = {
              ShopID: this._cleanText(r["ShopID"]) || "0",
              CampaignID: cId,
              ItemID: itemId,
              ProductName: pName,
              Spend: 0,
              Sales: 0,
              Orders: 0,
              SoldQty: 0,
              Clicks: 0,
              Impressions: 0
            };
          }

          itemMap[key].Spend += parseFloat(r["Spend"]) || 0;
          itemMap[key].Sales += parseFloat(r["Sales"]) || 0;
          itemMap[key].Orders += parseInt(r["Orders"]) || 0;
          itemMap[key].SoldQty += parseInt(r["SoldQty"]) || 0;
          itemMap[key].Clicks += parseInt(r["Clicks"]) || 0;
          itemMap[key].Impressions += parseInt(r["Impressions"]) || 0;
        }
      });

      const products = Object.values(itemMap).map(item => {
        const ctr = item.Impressions > 0 ? ((item.Clicks / item.Impressions) * 100).toFixed(2) + "%" : "0.00%";
        const cpc = item.Clicks > 0 ? Math.round(item.Spend / item.Clicks) : 0;
        const roas = item.Spend > 0 ? (item.Sales / item.Spend).toFixed(2) : "0.00";

        // Integrasi Stok & Status Kampanye
        const inv = mappingMap[item.ItemID] || { sku: "Belum Mapped", stock: "N/A", status: "NORMAL" };
        const status = campaignStatusMap[item.CampaignID] || "unknown";

        return {
          ...item,
          CTR: ctr,
          CPC: cpc,
          ROAS: parseFloat(roas),
          InventorySKU: inv.sku,
          Stock: inv.stock,
          StockStatus: inv.status,
          Status: status
        };
      });

      // Sorting Dinamis
      products.sort((a, b) => {
        if (sortBy === "spend") return b.Spend - a.Spend;
        if (sortBy === "sales") return b.Sales - a.Sales;
        if (sortBy === "orders") return b.Orders - a.Orders;
        if (sortBy === "soldQty") return b.SoldQty - a.SoldQty;
        if (sortBy === "clicks") return b.Clicks - a.Clicks;
        if (sortBy === "ctr") return parseFloat(b.CTR) - parseFloat(a.CTR);
        return b.ROAS - a.ROAS;
      });

      return {
        status: "success",
        dateFrom,
        dateTo,
        products
      };
    } catch (e) {
      console.error("[AdsService ERROR] getAdsProductPerformance failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * POST toggleAdsCampaign — Pause / Resume Status Kampanye Iklan.
   */
  async toggleAdsCampaign(params) {
    try {
      const campaignId = (params && params.campaignId) ? this._cleanText(params.campaignId) : "";
      const newStatus = (params && params.status) ? this._cleanText(params.status).toUpperCase() : "";
      const user = (params && params.user) ? params.user : "User";

      if (!campaignId || !newStatus) {
        return { status: "error", message: "CampaignID dan Status wajib diisi." };
      }

      const { found, oldStatus } = await this.adsRepo.updateAdsCampaignStatus(campaignId, newStatus);

      if (!found) {
        return { status: "error", message: `Kampanye '${campaignId}' tidak ditemukan.` };
      }

      // Catat log audit iklan
      await this.adsRepo.logAdsAudit({
        user,
        action: "TOGGLE_STATUS",
        campaignId,
        oldValue: oldStatus,
        newValue: newStatus,
        status: "SUCCESS",
        details: "Status kampanye diubah."
      });

      return {
        status: "success",
        message: `Status Kampanye #${campaignId} berhasil diubah menjadi ${newStatus}.`
      };
    } catch (e) {
      console.error("[AdsService ERROR] toggleAdsCampaign failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * GET/POST getAdsPerformancePaged — Tabel histori performa iklan paged (SSOT Ads_Report).
   */
  async getAdsPerformancePaged(params) {
    try {
      const page = parseInt((params && params.page) || 1);
      const limit = parseInt((params && params.limit) || 25);
      const dateFrom = (params && params.dateFrom) ? params.dateFrom : "2026-06-01";
      const dateTo = (params && params.dateTo) ? params.dateTo : this._formatDateStr(new Date());
      const sortBy = (params && params.sortBy) ? params.sortBy : "date";
      const search = (params && params.search) ? this._cleanText(params.search).toLowerCase() : "";
      const jenisFilter = (params && params.jenisIklan) ? this._cleanText(params.jenisIklan) : "";
      const statusFilter = (params && params.status) ? this._cleanText(params.status).toUpperCase() : "";
      const showEmpty = (params && params.showEmpty) ? (params.showEmpty === true || params.showEmpty === "true" || params.showEmpty === "ALL") : false;

      const isoFrom = this._parseAdsDateToISO(dateFrom);
      const isoTo = this._parseAdsDateToISO(dateTo);

      let reportRows = [];
      if (typeof this.adsRepo.getAdsReport === "function") {
        reportRows = await this.adsRepo.getAdsReport() || [];
      }

      let filtered = reportRows.filter(r => {
        const rdRaw = r["ReportDate"] || r["Tanggal"] || "";
        const rdIso = this._parseAdsDateToISO(rdRaw);
        
        if (isoFrom && rdIso && rdIso < isoFrom) return false;
        if (isoTo && rdIso && rdIso > isoTo) return false;

        const spend = parseFloat(r["Spend"]) || 0;
        const sales = parseFloat(r["Sales"]) || 0;
        const clicks = parseInt(r["Clicks"]) || 0;
        const impressions = parseInt(r["Impressions"]) || 0;

        if (!showEmpty && spend === 0 && sales === 0 && clicks === 0 && impressions === 0) {
          return false;
        }

        if (search) {
          const nama = this._cleanText(r["NamaProduk"] || "").toLowerCase();
          const cName = this._cleanText(r["CampaignName"] || "").toLowerCase();
          const itemId = this._cleanText(r["ItemID"] || "").toLowerCase();
          if (!nama.includes(search) && !cName.includes(search) && !itemId.includes(search)) return false;
        }

        if (jenisFilter && jenisFilter !== "ALL") {
          const jenis = this._cleanText(r["JenisIklan"] || "");
          if (jenis !== jenisFilter) return false;
        }

        if (statusFilter && statusFilter !== "ALL") {
          const st = this._cleanText(r["StatusCampaign"] || "").toUpperCase();
          if (statusFilter === "ONGOING" && st !== "ONGOING" && st !== "ACTIVE") return false;
          if (statusFilter === "PAUSED" && st !== "PAUSED" && st !== "CLOSED") return false;
          if (statusFilter === "ENDED" && st !== "ENDED") return false;
        }

        return true;
      });

      let totalSpend = 0, totalSales = 0, totalOrders = 0, totalClicks = 0, totalImpressions = 0;
      filtered.forEach(r => {
        totalSpend += parseFloat(r["Spend"]) || 0;
        totalSales += parseFloat(r["Sales"]) || 0;
        totalOrders += parseInt(r["Orders"]) || 0;
        totalClicks += parseInt(r["Clicks"]) || 0;
        totalImpressions += parseInt(r["Impressions"]) || 0;
      });
      const totalRoas = totalSpend > 0 ? (totalSales / totalSpend).toFixed(2) : "0.00";

      filtered.sort((a, b) => {
        if (sortBy === "spend") return (parseFloat(b["Spend"]) || 0) - (parseFloat(a["Spend"]) || 0);
        if (sortBy === "sales") return (parseFloat(b["Sales"]) || 0) - (parseFloat(a["Sales"]) || 0);
        if (sortBy === "roas") return (parseFloat(b["ROAS"]) || 0) - (parseFloat(a["ROAS"]) || 0);
        if (sortBy === "orders") return (parseInt(b["Orders"]) || 0) - (parseInt(a["Orders"]) || 0);
        if (sortBy === "clicks") return (parseInt(b["Clicks"]) || 0) - (parseInt(a["Clicks"]) || 0);
        
        const dA = this._parseAdsDateToISO(a["ReportDate"] || a["Tanggal"] || "");
        const dB = this._parseAdsDateToISO(b["ReportDate"] || b["Tanggal"] || "");
        return dB.localeCompare(dA);
      });

      const totalRecords = filtered.length;
      const totalPages = Math.ceil(totalRecords / limit) || 1;
      const safePage = Math.min(Math.max(page, 1), totalPages);
      const startIdx = (safePage - 1) * limit;
      const paged = filtered.slice(startIdx, startIdx + limit);

      const items = paged.map(r => {
        const rdRaw = r["ReportDate"] || r["Tanggal"] || "";
        const rdIso = this._parseAdsDateToISO(rdRaw);
        const formattedDate = rdIso ? rdIso.split("-").reverse().join("/") : this._cleanText(rdRaw);

        return {
          ReportDate: formattedDate,
          CampaignID: this._cleanText(r["CampaignID"]),
          CampaignName: this._cleanText(r["CampaignName"]),
          JenisIklan: this._cleanText(r["JenisIklan"]) || "Individual",
          ItemID: this._cleanText(r["ItemID"]),
          NamaProduk: this._cleanText(r["NamaProduk"]),
          StatusCampaign: this._cleanText(r["StatusCampaign"]) || "ONGOING",
          Impressions: parseInt(r["Impressions"]) || 0,
          Clicks: parseInt(r["Clicks"]) || 0,
          CTR: this._cleanText(r["CTR"]) || "0.00%",
          Spend: parseFloat(r["Spend"]) || 0,
          Sales: parseFloat(r["Sales"]) || 0,
          Orders: parseInt(r["Orders"]) || 0,
          SoldQty: parseInt(r["SoldQty"]) || 0,
          ROAS: parseFloat(r["ROAS"]) || 0,
          CPC: parseFloat(r["CPC"]) || 0,
          ACOS: this._cleanText(r["ACOS"]) || "0.00%",
          CPM: parseFloat(r["CPM"]) || 0
        };
      });

      return {
        status: "success",
        page: safePage,
        limit: limit,
        totalRecords: totalRecords,
        totalPages: totalPages,
        kpi: {
          totalSpend,
          totalSales,
          totalRoas: parseFloat(totalRoas),
          totalOrders,
          totalClicks,
          totalImpressions
        },
        items
      };
    } catch (e) {
      console.error("[AdsService ERROR] getAdsPerformancePaged failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }

  /**
   * GET/POST getAdsCampaignTrend — Histori tren harian campaign/item tertentu.
   */
  async getAdsCampaignTrend(params) {
    try {
      const cId = params && params.campaignId ? this._cleanText(params.campaignId) : "";
      const itemId = params && params.itemId ? this._cleanText(params.itemId) : "";
      const limit = parseInt((params && params.limit) || 30);

      if (!cId && !itemId) {
        return { status: "error", message: "CampaignID atau ItemID wajib diisi." };
      }

      let reportRows = [];
      if (typeof this.adsRepo.getAdsReport === "function") {
        reportRows = await this.adsRepo.getAdsReport() || [];
      }

      let filtered = reportRows.filter(r => {
        if (cId && this._cleanText(r["CampaignID"]) === cId) return true;
        if (itemId && this._cleanText(r["ItemID"]) === itemId) return true;
        return false;
      });

      filtered.sort((a, b) => {
        const dA = this._parseAdsDateToISO(a["ReportDate"] || a["Tanggal"] || "");
        const dB = this._parseAdsDateToISO(b["ReportDate"] || b["Tanggal"] || "");
        return dA.localeCompare(dB);
      });

      if (filtered.length > limit) {
        filtered = filtered.slice(filtered.length - limit);
      }

      const history = filtered.map(r => {
        const rdRaw = r["ReportDate"] || r["Tanggal"] || "";
        const rdIso = this._parseAdsDateToISO(rdRaw);
        const formattedDate = rdIso ? rdIso.split("-").reverse().join("/") : this._cleanText(rdRaw);

        return {
          ReportDate: formattedDate,
          ReportDateISO: rdIso,
          Spend: parseFloat(r["Spend"]) || 0,
          Sales: parseFloat(r["Sales"]) || 0,
          Orders: parseInt(r["Orders"]) || 0,
          Clicks: parseInt(r["Clicks"]) || 0,
          Impressions: parseInt(r["Impressions"]) || 0,
          ROAS: parseFloat(r["ROAS"]) || 0,
          CTR: this._cleanText(r["CTR"]) || "0.00%",
          CPC: parseFloat(r["CPC"]) || 0
        };
      });

      return {
        status: "success",
        campaignId: cId,
        itemId,
        totalRecords: history.length,
        history
      };
    } catch (e) {
      console.error("[AdsService ERROR] getAdsCampaignTrend failed:", e.message);
      return { status: "error", message: e.toString() };
    }
  }
}
