/**
 * parseDateString - Mengurai string tanggal dari Google Sheets API ke objek Date JS.
 * Mendukung format: dd/MM/yyyy HH:mm:ss, yyyy-MM-dd HH:mm:ss, ISO, atau objek Date langsung.
 *
 * @param {string|Date} dateStr
 * @returns {Date|null}
 */
export function parseDateString(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  
  const str = String(dateStr).trim();
  if (!str) return null;

  // 1. Cek format ISO atau yyyy-MM-dd
  if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. Cek format dd/MM/yyyy atau dd/MM/yyyy HH:mm:ss
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (match) {
    const [_, day, month, year, hour = '0', minute = '0', second = '0'] = match;
    const d = new Date(
      Number(year),
      Number(month) - 1, // Bulan di JS adalah 0-indexed (Jan=0, Feb=1)
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // 3. Fallback standar parsing
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export default parseDateString;
