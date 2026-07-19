import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { getDb } from '../database/db.js';

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDbPath() {
  return path.join(app.getPath('userData'), 'posly.db');
}

function getBackupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  ensureDir(dir);
  return dir;
}

function checkpointDb() {
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // DB may be closed during restore prep
  }
}

function copyDbFiles(sourceDbPath, destDbPath) {
  fs.copyFileSync(sourceDbPath, destDbPath);
  for (const suffix of ['-wal', '-shm']) {
    const src = `${sourceDbPath}${suffix}`;
    const dest = `${destDbPath}${suffix}`;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }
}

const backupService = {
  listRemovableDrives() {
    if (process.platform !== 'win32') return [];
    const drives = [];
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const root = `${letter}:\\`;
      try {
        if (fs.existsSync(root)) {
          drives.push({ letter, path: root });
        }
      } catch {
        // skip inaccessible
      }
    }
    return drives;
  },

  createBackup({ usbPath = null } = {}) {
    checkpointDb();
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database file was not found.');
    }

    const fileName = `posly_backup_${nowStamp()}.db`;
    const localDir = getBackupDir();
    const localPath = path.join(localDir, fileName);
    copyDbFiles(dbPath, localPath);

    let usbFilePath = null;
    if (usbPath) {
      const targetDir = path.join(usbPath, 'POSLY_Backups');
      ensureDir(targetDir);
      usbFilePath = path.join(targetDir, fileName);
      copyDbFiles(dbPath, usbFilePath);
    }

    const hash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');

    return {
      fileName,
      localPath,
      usbPath: usbFilePath,
      checksum: hash,
      createdAt: new Date().toISOString(),
    };
  },

  listLocalBackups() {
    const dir = getBackupDir();
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return {
          fileName: name,
          path: fullPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  },

  restoreBackup({ backupPath }) {
    const source = String(backupPath || '').trim();
    if (!source || !fs.existsSync(source)) {
      throw new Error('Backup file was not found.');
    }
    if (!source.toLowerCase().endsWith('.db')) {
      throw new Error('Backup file must be a .db file.');
    }

    checkpointDb();
    const dbPath = getDbPath();
    const safety = path.join(getBackupDir(), `pre_restore_${nowStamp()}.db`);
    if (fs.existsSync(dbPath)) {
      copyDbFiles(dbPath, safety);
    }

    copyDbFiles(source, dbPath);

    return {
      restoredFrom: source,
      safetyBackup: safety,
      message: 'Database restored. Restart the app to reload.',
    };
  },
};

export default backupService;
