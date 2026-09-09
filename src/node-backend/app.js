import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestLogger } from './utils/logger.js';
import apiRouter from './routes/api.js';
import { initSheetsClient } from './config/google.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend cross-origin access
app.use(cors({
  origin: '*', // Di production, batas asal domain demi keamanan
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse incoming request payloads as JSON
app.use(express.json());

// Inject Centralized Logging Framework
app.use(requestLogger);

// Initialize Google APIs Sheets client on startup
try {
  initSheetsClient();
} catch (err) {
  console.error('[Startup ERROR] Failed to initialize Google Sheets API Client:', err.message);
}

// Serve static frontend files from 'dist' directory when no API 'action' is requested
app.use((req, res, next) => {
  const action = req.method === 'GET' ? req.query.action : req.body?.action;
  if (action) {
    next();
  } else {
    express.static(path.join(__dirname, '../../dist'))(req, res, next);
  }
});

// Bind REST API Dynamic Router on root path
app.use('/', apiRouter);

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Global Handler Error]', err);
  req.logError = err; // Catat detail di logging framework
  
  return res.status(200).json({
    status: "error",
    message: "Terjadi kegagalan sistem internal pada server Node.js.",
    details: err.message
  });
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` ANSLA NODE.JS BACKEND RUNNING ON PORT ${PORT}`);
  console.log(` Mode: Hybrid Sheets Database`);
  console.log(` Time: ${new Date().toISOString()}`);
  console.log(`==================================================`);
});

export default app;
