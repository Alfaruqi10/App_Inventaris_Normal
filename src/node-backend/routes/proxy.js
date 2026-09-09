import axios from 'axios';

/**
 * featureFlagProxy - Middleware untuk merutekan request ke GAS lama jika flag modul dinonaktifkan.
 * @param {string} flagName - Nama environment variable feature flag (contoh: FLAG_DASHBOARD)
 */
export function featureFlagProxy(flagName) {
  return async (req, res, next) => {
    const isFeatureEnabled = process.env[flagName] === 'true';
    if (isFeatureEnabled) {
      // Jika flag diaktifkan (true), jalankan implementasi controller lokal Node.js
      return next();
    }

    // Jika flag dinonaktifkan (false), alihkan request secara transparan ke Google Apps Script (Shadow Routing)
    const gasUrl = process.env.OLD_GAS_WEB_APP_URL;
    if (!gasUrl) {
      return res.status(200).json({
        status: "error",
        message: "Proxy Configuration Error: OLD_GAS_WEB_APP_URL is not defined in .env"
      });
    }

    // Tentukan parameter aksi (action) dari query string atau request body
    const action = req.query.action || req.body?.action;
    
    const logPrefix = `[FeatureFlagProxy: ${flagName} = false] [Action: ${action}]`;
    console.log(`${logPrefix} Routing request to old GAS URL...`);

    try {
      // Konfigurasi request proxy ke Google Apps Script
      const proxyRequestConfig = {
        method: req.method,
        url: gasUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        maxRedirects: 5, // Mengikuti redirect script.googleusercontent.com
        validateStatus: () => true // Jangan throw error jika status code bukan 2xx (tetap salin apa adanya)
      };

      // Meneruskan parameter pencarian GET
      if (req.method === 'GET') {
        proxyRequestConfig.params = req.query;
      } else if (req.method === 'POST') {
        proxyRequestConfig.data = req.body;
        // Salin query string jika ada (misal Webhook dengan parameters)
        proxyRequestConfig.params = req.query;
      }

      const response = await axios(proxyRequestConfig);
      
      // Salin respon status dan data dari Google Apps Script ke client
      return res.status(response.status).send(response.data);

    } catch (error) {
      console.error(`${logPrefix} Proxy redirection failed:`, error.message);
      req.logError = error; // Catat di logger middleware
      
      return res.status(200).json({
        status: "error",
        message: `Proxy System Failure: Unable to forward request to Apps Script. Details: ${error.message}`
      });
    }
  };
}
