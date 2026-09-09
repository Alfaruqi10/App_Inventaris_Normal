/**
 * getJakartaTimeString - Mengembalikan string tanggal format YYYY-MM-DD HH:mm:ss
 * dalam zona waktu Asia/Jakarta (WIB) untuk penulisan ke Google Sheets.
 *
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getJakartaTimeString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const p = {};
  parts.forEach(part => {
    p[part.type] = part.value;
  });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export default getJakartaTimeString;
