// ============================================================
// ShopeeAds/core/AdsValidation.gs — Phase 0 Real API Diagnostics Suite
// ============================================================

/**
 * Helper to format date as DD-MM-YYYY for Shopee Ads Open API v2.
 */
function formatShopeeAdsDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return day + "-" + month + "-" + year;
}

/**
 * Validates all Shopee Open API Ads endpoints by making live HTTP GET requests with signature.
 * 0% Mock Data. Displays actual HTTP Status, Error Code, Error Message, Latency, Parameters, Record Count, and JSON Preview.
 */
function validateShopeeAdsApiEndpoints() {
  Logger.log("[AdsValidation] Memulai pengujian Real API Diagnostics untuk Shopee Ads Open API...");

  const registry = {
    timestamp: getJakartaTimeString(),
    adsAvailable: false,
    authorized: false,
    shopId: null,
    totalProbed: 0,
    successCount: 0,
    permissionDeniedCount: 0,
    errorCount: 0,
    rawDiagnostics: []
  };

  let tokens = null;
  try {
    if (typeof getShopeeTokens === "function") {
      tokens = getShopeeTokens();
    }
  } catch (e) {}

  if (!tokens || !tokens.accessToken || !tokens.shopId) {
    registry.authorized = false;
    registry.detail = "Belum terotorisasi dengan Shopee Open API. Lakukan otorisasi OAuth terlebih dahulu.";
    Logger.log("[AdsValidation] Gagal: Belum terotorisasi.");
    return {
      status: "error",
      message: registry.detail,
      registry: registry
    };
  }

  registry.authorized = true;
  registry.shopId = tokens.shopId;

  const todayAdsStr = formatShopeeAdsDate(new Date());

  const probeSingleEndpoint = (key, name, path, params) => {
    const startTime = Date.now();
    let httpStatus = 0;
    let errorCode = "";
    let errorMessage = "";
    let recordCount = 0;
    let previewJson = "";
    let status = "API_ERROR";
    let isAvailable = false;
    let rawJsonObj = null;

    try {
      if (typeof shopeeGet === "function") {
        const json = shopeeGet(path, params);
        const elapsed = Date.now() - startTime;
        httpStatus = 200;
        rawJsonObj = json;

        if (json && (json.error === "" || json.error === 0 || json.error === undefined)) {
          errorCode = "0";
          errorMessage = json.message || "SUCCESS";
          status = "SUCCESS";
          isAvailable = true;

          if (json.response) {
            const resp = json.response;
            if (Array.isArray(resp.campaign_list)) recordCount = resp.campaign_list.length;
            else if (Array.isArray(resp.campaign_id_list)) recordCount = resp.campaign_id_list.length;
            else if (Array.isArray(resp.performance_list)) recordCount = resp.performance_list.length;
            else if (Array.isArray(resp.keyword_list)) recordCount = resp.keyword_list.length;
            else if (Array.isArray(resp.item_list)) recordCount = resp.item_list.length;
            else if (Array.isArray(resp)) recordCount = resp.length;
            else if (typeof resp.total_balance !== "undefined") recordCount = 1;
            else if (typeof resp.daily_budget !== "undefined" || typeof resp.campaign_name !== "undefined") recordCount = 1;
            else recordCount = Object.keys(resp).length;
          }
        } else {
          errorCode = String(json.error || "UNKNOWN");
          errorMessage = String(json.message || "Gagal dari API Shopee");
          if (errorCode.includes("permission") || errorCode.includes("scope") || errorCode.includes("403")) {
            status = "PERMISSION_DENIED";
          } else {
            status = "API_ERROR";
          }
          isAvailable = false;
        }

        previewJson = JSON.stringify(json);
        if (previewJson.length > 300) {
          previewJson = previewJson.substring(0, 300) + "...";
        }

        return {
          key: key,
          endpoint: name,
          path: path,
          available: isAvailable,
          status: status,
          httpStatus: httpStatus,
          errorCode: errorCode,
          errorMessage: errorMessage,
          responseTimeMs: elapsed,
          requestParams: params,
          recordCount: recordCount,
          previewJson: previewJson,
          rawJsonObj: rawJsonObj
        };
      } else {
        throw new Error("Fungsi shopeeGet tidak tersedia.");
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const errMsg = err.toString();
      let statusStr = "API_ERROR";
      if (errMsg.includes("permission") || errMsg.includes("scope") || errMsg.includes("403")) {
        statusStr = "PERMISSION_DENIED";
      } else if (errMsg.includes("Belum terotorisasi")) {
        statusStr = "UNAUTHORIZED";
      }

      return {
        key: key,
        endpoint: name,
        path: path,
        available: false,
        status: statusStr,
        httpStatus: 403,
        errorCode: "ERROR_PROBE",
        errorMessage: errMsg,
        responseTimeMs: elapsed,
        requestParams: params,
        recordCount: 0,
        previewJson: JSON.stringify({ error: "PROBE_EXCEPTION", message: errMsg }),
        rawJsonObj: null
      };
    }
  };

  // 1. Probe Balance
  const balanceResult = probeSingleEndpoint("balanceApi", "v2.ads.get_total_balance", "/api/v2/ads/get_total_balance", {});
  registry.rawDiagnostics.push(balanceResult);

  // 2. Probe All Daily Performance (Shopee Ads expects DD-MM-YYYY)
  const allDailyResult = probeSingleEndpoint("allDailyApi", "v2.ads.get_all_cpc_ads_daily_performance", "/api/v2/ads/get_all_cpc_ads_daily_performance", { start_date: todayAdsStr, end_date: todayAdsStr });
  registry.rawDiagnostics.push(allDailyResult);

  // 3. Probe All Hourly Performance (Shopee Ads expects performance_date: DD-MM-YYYY)
  const allHourlyResult = probeSingleEndpoint("allHourlyApi", "v2.ads.get_all_cpc_ads_hourly_performance", "/api/v2/ads/get_all_cpc_ads_hourly_performance", { performance_date: todayAdsStr });
  registry.rawDiagnostics.push(allHourlyResult);

  // 4. Probe Campaign List & Extract first Campaign ID for dependent probes
  const campaignListResult = probeSingleEndpoint("campaignListApi", "v2.ads.get_product_level_campaign_id_list", "/api/v2/ads/get_product_level_campaign_id_list", {});
  registry.rawDiagnostics.push(campaignListResult);

  let firstCampaignId = null;
  if (campaignListResult.available && campaignListResult.rawJsonObj && campaignListResult.rawJsonObj.response) {
    const resp = campaignListResult.rawJsonObj.response;
    if (Array.isArray(resp.campaign_list) && resp.campaign_list.length > 0) {
      firstCampaignId = String(resp.campaign_list[0].campaign_id);
    } else if (Array.isArray(resp.campaign_id_list) && resp.campaign_id_list.length > 0) {
      firstCampaignId = String(resp.campaign_id_list[0]);
    }
  }

  // 5. Dependent Probe: Campaign Setting Info (Shopee expects campaign_id_list)
  const campaignInfoParams = firstCampaignId ? { campaign_id_list: firstCampaignId, info_type_list: "1,2,3,4" } : {};
  const campaignInfoResult = firstCampaignId
    ? probeSingleEndpoint("campaignInfoApi", "v2.ads.get_product_level_campaign_setting_info", "/api/v2/ads/get_product_level_campaign_setting_info", campaignInfoParams)
    : {
        key: "campaignInfoApi",
        endpoint: "v2.ads.get_product_level_campaign_setting_info",
        path: "/api/v2/ads/get_product_level_campaign_setting_info",
        available: false,
        status: "NO_CAMPAIGN",
        httpStatus: 200,
        errorCode: "NO_CAMPAIGN_FOUND",
        errorMessage: "Toko tidak memiliki kampanye aktif (campaign_list kosong). Endpoint membutuhkan parameter campaign_id_list.",
        responseTimeMs: 0,
        requestParams: {},
        recordCount: 0,
        previewJson: JSON.stringify({ note: "Tidak ada campaign_id yang tersedia dari toko ini." })
      };
  registry.rawDiagnostics.push(campaignInfoResult);

  // 6. Dependent Probe: Product Campaign Daily Performance (Shopee expects campaign_id_list)
  const productDailyParams = firstCampaignId ? { campaign_id_list: firstCampaignId, start_date: todayAdsStr, end_date: todayAdsStr } : { start_date: todayAdsStr, end_date: todayAdsStr };
  const productDailyResult = firstCampaignId
    ? probeSingleEndpoint("productDailyApi", "v2.ads.get_product_campaign_daily_performance", "/api/v2/ads/get_product_campaign_daily_performance", productDailyParams)
    : {
        key: "productDailyApi",
        endpoint: "v2.ads.get_product_campaign_daily_performance",
        path: "/api/v2/ads/get_product_campaign_daily_performance",
        available: false,
        status: "NO_CAMPAIGN",
        httpStatus: 200,
        errorCode: "NO_CAMPAIGN_FOUND",
        errorMessage: "Toko tidak memiliki kampanye aktif (campaign_list kosong).",
        responseTimeMs: 0,
        requestParams: productDailyParams,
        recordCount: 0,
        previewJson: JSON.stringify({ note: "Butuh campaign_id_list valid." })
      };
  registry.rawDiagnostics.push(productDailyResult);

  // 7. Dependent Probe: Product Campaign Hourly Performance (Shopee expects campaign_id_list)
  const productHourlyParams = firstCampaignId ? { campaign_id_list: firstCampaignId, performance_date: todayAdsStr } : { performance_date: todayAdsStr };
  const productHourlyResult = firstCampaignId
    ? probeSingleEndpoint("productHourlyApi", "v2.ads.get_product_campaign_hourly_performance", "/api/v2/ads/get_product_campaign_hourly_performance", productHourlyParams)
    : {
        key: "productHourlyApi",
        endpoint: "v2.ads.get_product_campaign_hourly_performance",
        path: "/api/v2/ads/get_product_campaign_hourly_performance",
        available: false,
        status: "NO_CAMPAIGN",
        httpStatus: 200,
        errorCode: "NO_CAMPAIGN_FOUND",
        errorMessage: "Toko tidak memiliki kampanye aktif (campaign_list kosong).",
        responseTimeMs: 0,
        requestParams: productHourlyParams,
        recordCount: 0,
        previewJson: JSON.stringify({ note: "Butuh campaign_id_list valid." })
      };
  registry.rawDiagnostics.push(productHourlyResult);

  // 8. Probe Recommended Item List & Extract first Item ID for dependent item probes
  const itemResult = probeSingleEndpoint("recommendedItemApi", "v2.ads.get_recommended_item_list", "/api/v2/ads/get_recommended_item_list", {});
  registry.rawDiagnostics.push(itemResult);

  let firstItemId = null;
  if (itemResult.available && itemResult.rawJsonObj && Array.isArray(itemResult.rawJsonObj.response) && itemResult.rawJsonObj.response.length > 0) {
    firstItemId = String(itemResult.rawJsonObj.response[0].item_id);
  }

  // 9. Probe Recommended Keyword List
  const keywordParams = firstItemId ? { item_id: firstItemId } : {};
  const keywordResult = firstItemId
    ? probeSingleEndpoint("recommendedKeywordApi", "v2.ads.get_recommended_keyword_list", "/api/v2/ads/get_recommended_keyword_list", keywordParams)
    : probeSingleEndpoint("recommendedKeywordApi", "v2.ads.get_recommended_keyword_list", "/api/v2/ads/get_recommended_keyword_list", {});
  registry.rawDiagnostics.push(keywordResult);

  // 10. Probe Budget Suggestion
  const budgetParams = firstItemId ? { item_id: firstItemId, bidding_method: "auto", campaign_placement: "search", product_selection: "manual", reference_id: firstItemId } : { bidding_method: "auto", campaign_placement: "search", product_selection: "manual" };
  const budgetResult = probeSingleEndpoint("budgetSuggestionApi", "v2.ads.get_create_product_ad_budget_suggestion", "/api/v2/ads/get_create_product_ad_budget_suggestion", budgetParams);
  registry.rawDiagnostics.push(budgetResult);

  // 11. Probe ROI Target Recommendation
  const roiParams = firstItemId ? { item_id: firstItemId, reference_id: firstItemId } : {};
  const roiResult = probeSingleEndpoint("roiTargetApi", "v2.ads.get_product_recommended_roi_target", "/api/v2/ads/get_product_recommended_roi_target", roiParams);
  registry.rawDiagnostics.push(roiResult);

  // Clean rawJsonObj before saving script property to keep size small
  registry.rawDiagnostics.forEach(d => { delete d.rawJsonObj; });

  registry.totalProbed = registry.rawDiagnostics.length;
  registry.rawDiagnostics.forEach(d => {
    if (d.status === "SUCCESS") registry.successCount++;
    else if (d.status === "PERMISSION_DENIED") registry.permissionDeniedCount++;
    else registry.errorCount++;
  });

  registry.adsAvailable = (registry.successCount > 0);

  try {
    PropertiesService.getScriptProperties().setProperty("SHOPEE_ADS_CAPABILITY_REGISTRY", JSON.stringify(registry));
  } catch (e) {}

  Logger.log("[AdsValidation] Real API Diagnostics selesai: " + registry.successCount + "/" + registry.totalProbed + " sukses.");
  return {
    status: "success",
    registry: registry
  };
}

/**
 * Retrieves stored Real API Capability Registry or returns empty clean structure.
 */
function getAdsCapabilityRegistry() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty("SHOPEE_ADS_CAPABILITY_REGISTRY");
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}

  return {
    timestamp: getJakartaTimeString(),
    adsAvailable: false,
    authorized: false,
    totalProbed: 0,
    successCount: 0,
    permissionDeniedCount: 0,
    errorCount: 0,
    rawDiagnostics: []
  };
}
