import { initSheetsClient } from '../config/google.js';
import dotenv from 'dotenv';

dotenv.config();

async function debugDates() {
  const sheets = initSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'ShopeeOrders!A1:ZZ',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      console.log('No data found.');
      return;
    }

    const headers = rows[0];
    const colCt = headers.indexOf('create_time');
    console.log('create_time column index:', colCt);

    // Print first 15 rows with dates
    console.log('\nSample Rows:');
    for (let i = 1; i <= Math.min(15, rows.length - 1); i++) {
      const rawVal = rows[i][colCt];
      console.log(`Row ${i}: Raw='${rawVal}' | Type=${typeof rawVal}`);
    }
  } catch (err) {
    console.error('Error debugging dates:', err.message);
  }
}

debugDates();
