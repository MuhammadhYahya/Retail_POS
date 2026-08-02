import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { getDb, getDbPath, closeDb, reopenDb, setSkipMigrationSafetyBackup } from '../../database/db.js';
import { runMigrations, getLatestMigrationVersion } from '../../database/migrations/index.js';
import { buildBackupArchive, collectManifestStats } from './archiveBuilder.js';
import {
  verifyBackupArchive,
  checkVersionCompatibility,
  extractBackupArchive,
} from './archiveVerifier.js';
import backupHistoryService from './backupHistoryService.js';
import { copyDirRecursive, ensureDir, finishJob, createJob, cancelJob, safeRmDir, safeUnlink, sha256File, emitProgress, assertNotCancelled } from './backupUtils.js';
import { listExistingDataRoots } from './dataRootRegistry.js';

function getDefaultBackupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  ensureDir(dir);
  return dir;
}

function removeLiveDbFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    safeUnlink(`${dbPath}${suffix}`);
  }
}

function swapRestoredDatabase(extractedDbPath, liveDbPath) {
  const staging = `${liveDbPath}.restoring`;
  const backupStaging = `${liveDbPath}.pre_swap`;

  safeUnlink(staging);
  safeUnlink(`${staging}-wal`);
  safeUnlink(`${staging}-shm`);

  fs.copyFileSync(extractedDbPath, staging);

  // Move current aside if present
  if (fs.existsSync(liveDbPath)) {
    safeUnlink(backupStaging);
    fs.renameSync(liveDbPath, backupStaging);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${liveDbPath}${suffix}`)) {
        safeUnlink(`${backupStaging}${suffix}`);
        try {
          fs.renameSync(`${liveDbPath}${suffix}`, `${backupStaging}${suffix}`);
        } catch {
          safeUnlink(`${liveDbPath}${suffix}`);
        }
      }
    }
  }

  try {
    fs.renameSync(staging, liveDbPath);
    // Clean wal/shm for fresh open
    safeUnlink(`${liveDbPath}-wal`);
    safeUnlink(`${liveDbPath}-shm`);
    safeUnlink(backupStaging);
    for (const suffix of ['-wal', '-shm']) {
      safeUnlink(`${backupStaging}${suffix}`);
    }
  } catch (error) {
    // Rollback
    if (fs.existsSync(backupStaging)) {
      safeUnlink(liveDbPath);
      fs.renameSync(backupStaging, liveDbPath);
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(`${backupStaging}${suffix}`)) {
          safeUnlink(`${liveDbPath}${suffix}`);
          fs.renameSync(`${backupStaging}${suffix}`, `${liveDbPath}${suffix}`);
        }
      }
    }
    throw error;
  }
}

function restoreAssetRoots(extractDir) {
  for (const root of listExistingDataRoots()) {
    const from = path.join(extractDir, root.archivePath);
    if (!fs.existsSync(from)) continue;
    const to = root.resolveAbsolute();
    ensureDir(to);
    // Clear existing files in root then copy
    for (const entry of fs.readdirSync(to)) {
      const p = path.join(to, entry);
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    copyDirRecursive(from, to);
  }
}

function readRestoredTheme(extractDir) {
  try {
    const configPath = path.join(extractDir, 'config', 'app.json');
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.theme || null;
  } catch {
    return null;
  }
}

const backupService = {
  getDefaultBackupDir,

  createJob,
  cancelJob,

  async createBackup({
    destinationDir = null,
    type = 'manual',
    jobId = null,
    themePreference = null,
  } = {}) {
    const id = jobId || createJob();
    const dest = destinationDir || getDefaultBackupDir();

    try {
      emitProgress(id, { stage: 'Preparing...', percent: 2, channel: 'backup:progress' });

      if (!fs.existsSync(dest)) {
        try {
          ensureDir(dest);
        } catch {
          throw new Error('Backup folder is unavailable. Choose another location.');
        }
      }

      // Probe write access
      try {
        const probe = path.join(dest, `.zen-write-probe-${Date.now()}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
      } catch {
        throw new Error('Cannot write to the backup location. Check disk space and permissions.');
      }

      const result = await buildBackupArchive({
        destinationDir: dest,
        type,
        jobId: id,
        themePreference,
      });

      assertNotCancelled(id);

      // Verify before success
      emitProgress(id, { stage: 'Verifying...', percent: 85, channel: 'backup:progress' });
      let verification;
      try {
        verification = await verifyBackupArchive(result.path);
        if (verification.ownsExtractDir && verification.extractDir) {
          safeRmDir(verification.extractDir);
        }
      } catch (verifyErr) {
        safeUnlink(result.path);
        throw new Error(verifyErr.message || 'Backup verification failed.');
      }

      const checksum = sha256File(result.path);
      const history = backupHistoryService.insert({
        uuid: result.uuid,
        type,
        path: result.path,
        size: result.size,
        status: 'verified',
        checksum,
        meta: result.manifest,
      });

      emitProgress(id, { stage: 'Completed', percent: 100, channel: 'backup:progress' });

      return {
        ...result,
        checksum,
        status: 'verified',
        history,
      };
    } catch (error) {
      if (error.code === 'CANCELLED') {
        emitProgress(id, { stage: 'Cancelled', percent: 0, channel: 'backup:progress', cancelled: true });
      } else {
        emitProgress(id, {
          stage: 'Failed',
          percent: 0,
          channel: 'backup:progress',
          error: error.message,
        });
      }
      throw error;
    } finally {
      finishJob(id);
    }
  },

  async createSafetyBackup({ type = 'restore_point', destinationDir = null, themePreference = null } = {}) {
    return this.createBackup({
      destinationDir: destinationDir || getDefaultBackupDir(),
      type,
      themePreference,
    });
  },

  async verifyBackup({ backupPath }) {
    const verification = await verifyBackupArchive(backupPath);
    if (verification.ownsExtractDir && verification.extractDir) {
      safeRmDir(verification.extractDir);
    }
    return {
      valid: true,
      manifest: verification.manifest,
      versionJson: verification.versionJson,
      legacy: verification.legacy,
    };
  },

  async previewBackup({ backupPath }) {
    const verification = await verifyBackupArchive(backupPath);
    const compatibility = checkVersionCompatibility(verification.manifest, verification.versionJson);
    if (verification.ownsExtractDir && verification.extractDir) {
      safeRmDir(verification.extractDir);
    }
    if (!compatibility.ok) {
      return {
        compatible: false,
        error: compatibility.reason,
        manifest: verification.manifest,
        versionJson: verification.versionJson,
      };
    }
    return {
      compatible: true,
      needsMigration: compatibility.needsMigration,
      manifest: verification.manifest,
      versionJson: verification.versionJson,
      legacy: verification.legacy,
    };
  },

  listHistory() {
    return backupHistoryService.list();
  },

  listLocalBackups() {
    // Prefer history; also scan default dir for zen/posly backup files not yet recorded
    const history = backupHistoryService.list();
    const dir = getDefaultBackupDir();
    const isArchive = (name) => name.endsWith('.zenbackup') || name.endsWith('.poslybackup');
    const fromDisk = fs
      .readdirSync(dir)
      .filter((name) => isArchive(name) || name.endsWith('.db'))
      .map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return {
          fileName: name,
          path: fullPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          type: name.endsWith('.db') ? 'legacy' : 'manual',
          status: isArchive(name) ? 'on_disk' : 'legacy',
        };
      });

    const knownPaths = new Set(history.map((h) => h.path));
    const extras = fromDisk.filter((f) => !knownPaths.has(f.path));

    return {
      history,
      disk: fromDisk,
      extras,
    };
  },

  deleteBackup({ uuid, backupPath }) {
    let entry = null;
    if (uuid) entry = backupHistoryService.getByUuid(uuid);
    const targetPath = backupPath || entry?.path;
    if (targetPath && fs.existsSync(targetPath)) {
      safeUnlink(targetPath);
    }
    if (uuid) backupHistoryService.softDelete(uuid);
    return { deleted: true };
  },

  openBackupFolder({ backupPath = null } = {}) {
    const target = backupPath && fs.existsSync(backupPath) ? backupPath : getDefaultBackupDir();
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      shell.showItemInFolder(target);
    } else {
      ensureDir(target);
      shell.openPath(target);
    }
    return { opened: true, path: target };
  },

  pruneAutomaticBackups({ location, keep }) {
    const keepCount = Math.max(1, Number(keep) || 7);
    const rows = backupHistoryService.listAutomatic(location || null);
    const excess = rows.slice(keepCount);
    for (const row of excess) {
      if (row.path && fs.existsSync(row.path)) safeUnlink(row.path);
      backupHistoryService.softDelete(row.uuid);
    }
    return { pruned: excess.length };
  },

  /**
   * Full restore workflow. Returns { relaunch: true, theme } — caller should relaunch app.
   */
  async restoreBackup({ backupPath, themePreference = null, jobId = null }) {
    const id = jobId || createJob();
    let extractDir = null;
    let emergency = null;

    try {
      emitProgress(id, { stage: 'Verifying backup...', percent: 5, channel: 'backup:progress' });

      const verification = await verifyBackupArchive(backupPath);
      const compatibility = checkVersionCompatibility(verification.manifest, verification.versionJson);
      if (!compatibility.ok) {
        if (verification.ownsExtractDir && verification.extractDir) {
          safeRmDir(verification.extractDir);
        }
        throw new Error(compatibility.reason);
      }

      emitProgress(id, { stage: 'Creating emergency backup...', percent: 15, channel: 'backup:progress' });
      // Emergency backup of current system — always
      emergency = await this.createSafetyBackup({
        type: 'restore_point',
        themePreference,
      });

      emitProgress(id, { stage: 'Preparing restore...', percent: 35, channel: 'backup:progress' });

      // From this point cancel is not allowed
      closeDb();

      const liveDbPath = getDbPath();
      extractDir = path.join(app.getPath('temp'), `zen-restore-${Date.now()}`);
      ensureDir(extractDir);

      if (verification.legacy) {
        // Legacy .db file
        fs.copyFileSync(backupPath, path.join(extractDir, 'database.db'));
      } else if (verification.extractDir) {
        // Already extracted during verify — reuse if same process kept it
        if (verification.extractDir !== extractDir) {
          copyDirRecursive(verification.extractDir, extractDir);
          if (verification.ownsExtractDir) safeRmDir(verification.extractDir);
        }
      } else {
        await extractBackupArchive(backupPath, extractDir);
      }

      // Re-validate extracted payload
      const extractedDb = path.join(extractDir, 'database.db');
      if (!fs.existsSync(extractedDb)) {
        throw new Error('Backup is corrupted. Database is missing.');
      }

      emitProgress(id, { stage: 'Replacing data...', percent: 60, channel: 'backup:progress' });

      try {
        swapRestoredDatabase(extractedDb, liveDbPath);
        if (!verification.legacy) {
          restoreAssetRoots(extractDir);
        }
      } catch (swapErr) {
        // Attempt reopen previous DB
        try {
          reopenDb();
        } catch {
          // ignore
        }
        throw swapErr;
      }

      emitProgress(id, { stage: 'Running integrity checks...', percent: 80, channel: 'backup:progress' });

      setSkipMigrationSafetyBackup(true);
      let db;
      try {
        db = reopenDb();
      } finally {
        setSkipMigrationSafetyBackup(false);
      }

      const integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error('Restored database failed integrity check.');
      }

      runMigrations(db);

      const theme = readRestoredTheme(extractDir);

      emitProgress(id, { stage: 'Completed', percent: 100, channel: 'backup:progress' });

      return {
        restoredFrom: backupPath,
        emergencyBackup: emergency?.path || null,
        theme,
        relaunch: true,
        message: 'Restore complete. The application will restart.',
        latestMigration: getLatestMigrationVersion(),
        stats: collectManifestStats(db),
      };
    } catch (error) {
      // If DB was closed, try to reopen
      try {
        if (!getDb) {
          /* noop */
        }
        reopenDb();
      } catch {
        try {
          reopenDb();
        } catch {
          // leave closed — app may need manual recovery from emergency backup
        }
      }
      emitProgress(id, {
        stage: 'Failed',
        percent: 0,
        channel: 'backup:progress',
        error: error.message,
      });
      throw error;
    } finally {
      if (extractDir) safeRmDir(extractDir);
      finishJob(id);
    }
  },

  getBackupSettings() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
    return {
      enabled: Boolean(row.auto_backup_enabled),
      frequency: row.auto_backup_frequency || 'daily',
      time: row.auto_backup_time || '02:00',
      keep: Number(row.auto_backup_keep) || 7,
      location: row.auto_backup_location || getDefaultBackupDir(),
      lastAutoBackupAt: row.last_auto_backup_at || null,
      missedPending: Boolean(row.missed_backup_pending),
    };
  },

  updateBackupSettings(payload = {}) {
    const db = getDb();
    const current = this.getBackupSettings();
    const next = {
      enabled: payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : current.enabled ? 1 : 0,
      frequency: payload.frequency || current.frequency,
      time: payload.time || current.time,
      keep: payload.keep !== undefined ? Math.max(1, Number(payload.keep) || 7) : current.keep,
      location: payload.location !== undefined ? String(payload.location || '') : current.location,
    };

    const allowedFreq = new Set(['daily', 'every_3_days', 'weekly', 'monthly']);
    if (!allowedFreq.has(next.frequency)) {
      throw new Error('Invalid backup frequency.');
    }
    if (!/^\d{2}:\d{2}$/.test(next.time)) {
      throw new Error('Invalid backup time. Use HH:MM.');
    }

    db.prepare(`
      UPDATE settings SET
        auto_backup_enabled = ?,
        auto_backup_frequency = ?,
        auto_backup_time = ?,
        auto_backup_keep = ?,
        auto_backup_location = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      next.enabled,
      next.frequency,
      next.time,
      next.keep,
      next.location || null,
      new Date().toISOString()
    );

    return this.getBackupSettings();
  },

  markAutoBackupDone() {
    const db = getDb();
    db.prepare(`
      UPDATE settings SET
        last_auto_backup_at = ?,
        missed_backup_pending = 0,
        updated_at = ?
      WHERE id = 1
    `).run(new Date().toISOString(), new Date().toISOString());
  },

  // Legacy drive listing kept for compatibility
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
        // skip
      }
    }
    return drives;
  },
};

export default backupService;
export { getDefaultBackupDir };
