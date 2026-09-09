import { v4 as uuidv4 } from 'uuid';

/**
 * requestLogger - Middleware untuk merekam data transaksi request terpusat.
 * Merekam Request ID, execution/response time, user operator, endpoint, status code, dan error stack jika gagal.
 */
export function requestLogger(req, res, next) {
  req.id = uuidv4();
  req.startTime = process.hrtime();
  
  res.on('finish', () => {
    const diff = process.hrtime(req.startTime);
    const durationMs = Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
    
    const logData = {
      requestId: req.id,
      timestamp: new Date().toISOString(),
      method: req.method,
      endpoint: req.originalUrl || req.url,
      user: req.user ? req.user.email : (req.body?.user || 'Anonymous/Webhook'),
      responseTimeMs: durationMs,
      statusCode: res.statusCode,
    };

    // Logging output standar JSON (scannable & parseable oleh sistem monitoring log)
    if (res.statusCode >= 400 || (req.logError)) {
      logData.error = {
        message: req.logError?.message || 'Request failed',
        stack: req.logError?.stack || 'No stack trace available'
      };
      console.error(JSON.stringify(logData));
    } else {
      console.log(JSON.stringify(logData));
    }
  });

  next();
}
