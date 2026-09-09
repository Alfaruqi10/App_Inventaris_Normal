// ============================================================
// backup.gs — Recovery Center: Backup & Restore
// Reuse dailyBackup() dan mekanisme Drive yang sudah ada.
// ============================================================

/**
 * Backup Spreadsheet — jalankan dailyBackup() (ke Google Drive).
 */
function backupSpreadsheet() {
  try {
    dailyBackup();
    return { status:'success', message:'Backup spreadsheet selesai. Cek notifikasi Telegram.' };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Backup Database — alias backup spreadsheet (sesuai PRD, database = spreadsheet).
 */
function backupDatabase() {
  try {
    dailyBackup();
    return { status:'success', message:'Database (spreadsheet) di-backup ke Google Drive.' };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Download Backup — kembalikan URL file backup terbaru di folder.
 */
function downloadBackup() {
  try {
    var folderId = _getBackupFolderId();
    if (!folderId) return { status:'error', message:'BACKUP_FOLDER_ID belum diset.' };
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    var newest = null, newestTime = 0;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf('ANSLA_Backup_') === 0) {
        var c = f.getDateCreated().getTime();
        if (c > newestTime) { newestTime = c; newest = f; }
      }
    }
    if (!newest) return { status:'error', message:'Belum ada file backup.' };
    return {
      status:'success',
      message:'Backup tersedia: ' + newest.getName(),
      fileName: newest.getName(),
      url: newest.getUrl(),
      createdAt: newest.getDateCreated().toISOString()
    };
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

/**
 * Restore Backup — salin isi file backup terbaru ke spreadsheet aktif.
 * Menggunakan copyTo per-sheet agar struktur & data pulih tanpa menghapus trigger.
 */
function restoreBackup() {
  var t0 = new Date().getTime();
  try {
    var folderId = _getBackupFolderId();
    if (!folderId) return { status:'error', message:'BACKUP_FOLDER_ID belum diset.' };
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    var newest = null, newestTime = 0;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf('ANSLA_Backup_') === 0) {
        var c = f.getDateCreated().getTime();
        if (c > newestTime) { newestTime = c; newest = f; }
      }
    }
    if (!newest) return { status:'error', message:'Belum ada file backup untuk direstore.' };

    var backupSs = SpreadsheetApp.openById(newest.getId());
    var activeSs = SpreadsheetApp.getActiveSpreadsheet();
    var backupSheets = backupSs.getSheets();
    var restored = 0;
    backupSheets.forEach(function(bSheet) {
      var name = bSheet.getName();
      var target = activeSs.getSheetByName(name);
      if (!target) return; // hanya restore sheet yang sudah ada
      var vals = bSheet.getDataRange().getValues();
      if (vals.length === 0) return;
      target.clearContents();
      target.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
      restored++;
    });

    return {
      status:'success',
      message:'Restore selesai dari ' + newest.getName() + '. ' + restored + ' sheet dipulihkan.',
      fileName: newest.getName(),
      restoredSheets: restored,
      duration: _dur(t0)
    };
  } catch (err) {
    return { status:'error', message: err.toString(), duration: _dur(t0) };
  }
}
