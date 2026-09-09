import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

let sheetsClient = null;

/**
 * initSheetsClient - Menghubungkan client API Google Sheets.
 * Mendukung otentikasi otomatis menggunakan kredensial CLASP lokal (.clasprc.json) atau Google Service Account JSON.
 */
export function initSheetsClient() {
  if (sheetsClient) return sheetsClient;

  // 1. Coba gunakan Service Account key file terlebih dahulu (Production / Custom GCP)
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || 'credentials/google-service-account.json';
  const absoluteKeyPath = path.resolve(keyPath);

  if (fs.existsSync(absoluteKeyPath)) {
    try {
      console.log(`[Google Auth] Menggunakan kredensial Service Account dari: ${absoluteKeyPath}`);
      const auth = new google.auth.GoogleAuth({
        keyFile: absoluteKeyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      sheetsClient = google.sheets({ version: 'v4', auth });
      console.log('[Google Auth] Google Sheets API client berhasil diinisialisasi via Service Account Key!');
      return sheetsClient;
    } catch (e) {
      console.warn('[Google Auth WARNING] Gagal menginisialisasi dengan Service Account Key:', e.message);
    }
  }

  // 2. Fallback: Kredensial CLASP lokal (.clasprc.json)
  const homeDir = os.homedir();
  const claspCredentialsPath = path.join(homeDir, '.clasprc.json');

  if (fs.existsSync(claspCredentialsPath)) {
    try {
      console.log(`[Google Auth] Menggunakan kredensial CLASP dari: ${claspCredentialsPath}`);
      const claspConfig = JSON.parse(fs.readFileSync(claspCredentialsPath, 'utf8'));
      const token = claspConfig.tokens?.default || claspConfig.token;
      
      if (!token) {
        throw new Error("Objek token/tokens.default tidak ditemukan di file .clasprc.json");
      }
      
      const oauth2Client = new google.auth.OAuth2(
        token.client_id || 'clasp-default-client-id',
        token.client_secret || 'clasp-default-client-secret'
      );
      
      oauth2Client.setCredentials({
        refresh_token: token.refresh_token,
        access_token: token.access_token
      });

      sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
      console.log('[Google Auth] Google Sheets API client berhasil diinisialisasi via CLASP User OAuth2!');
      return sheetsClient;
    } catch (e) {
      console.warn('[Google Auth WARNING] Gagal menginisialisasi dengan kredensial CLASP:', e.message);
    }
  }

  // 3. Fallback: Default Application Credentials
  console.log('[Google Auth] Mencoba inisialisasi menggunakan Default Application Credentials...');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export const getSheetsClient = () => {
  if (!sheetsClient) {
    return initSheetsClient();
  }
  return sheetsClient;
};
