// ============================================================
// CommonUtils.gs - Shared Utility Functions
// Domain: Shared
// ============================================================

function cleanText(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function cleanRole(role) {
  var r = cleanText(role);
  if (r.toLowerCase() === 'admin') return 'Admin';
  return 'Kasir';
}

function cleanKategori(kategori) {
  var k = cleanText(kategori);
  if (k.toLowerCase() === 'katalog') return 'Katalog';
  if (k.toLowerCase() === 'non katalog' || k.toLowerCase() === 'non-katalog') return 'Non Katalog';
  return k || 'Katalog';
}

function isValidEmail(email) {
  var re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return re.test(String(email).toLowerCase());
}

function parseNumber(val) {
  var n = Number(val);
  return isNaN(n) ? 0 : n;
}

function parsePositiveNumber(val) {
  var n = parseNumber(val);
  return n > 0 ? n : 0;
}

function getJakartaTimeString(date) {
  var d = date ? (date instanceof Date ? date : new Date(date)) : new Date();
  return Utilities.formatDate(d, 'Asia/Jakarta', 'dd/MM/yyyy HH:mm:ss');
}

function readSheetObjects(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return [];

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var result = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var obj = {};
      var isEmpty = true;
      for (var j = 0; j < headers.length; j++) {
        var h = String(headers[j] || '').trim();
        if (h) {
          obj[h] = row[j];
          if (row[j] !== '' && row[j] !== null && row[j] !== undefined) {
            isEmpty = false;
          }
        }
      }
      if (!isEmpty) result.push(obj);
    }
    return result;
  } catch (err) {
    Logger.log('[readSheetObjects ERROR] ' + sheetName + ': ' + err.toString());
    return [];
  }
}

// writeAdsSheetRowsIdempotent is declared in ShopeeAds/core/AdsDatabase.gs

function getPropCaseInsensitive(obj, key) {
  if (!obj || !key) return undefined;
  if (obj[key] !== undefined) return obj[key];
  var lowerKey = String(key).toLowerCase();
  for (var k in obj) {
    if (String(k).toLowerCase() === lowerKey) return obj[k];
  }
  return undefined;
}

function cleanNumericValue(val) {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  var str = String(val).replace(/Rp\s*/gi, "").replace(/\./g, "").replace(/,/g, ".").trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

