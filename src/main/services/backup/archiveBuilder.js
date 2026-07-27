import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createRequire } from 'module';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { getDb } from '../../database/db.js';
import { getLatestMigrationVersion } from '../../database/migrations/index.js';
import { listExistingDataRoots, ensureReservedDataDirs } from './dataRootRegistry.js';
import {
  assertNotCancelled,
  emitProgress,
  ensureDir,
  formatBackupFileName,
  sha256File,
  walkFiles,
  safeRmDir,
  safeUnlink,
} from './backupUtils.js';

const require = createRequire(import.meta.url);
const archiverModule = require('archiver');
const archiver = typeof archiverModule === 'function' ? archiverModule : archiverModule.default || archiverModule;

const BACKUP_FORMAT_VERSION = 1;

function countSafe(db, sql) {
  try {
    return db.prepare(sql).get()?.c ?? 0;
  } catch {
    return 0;
  }
}

function tableExists(db, name) {
  try {
    return Boolean(
      db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    );
  } catch {
    return false;
  }
}

export function collectManifestStats(db = getDb()) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
  return {
    businessName: settings.shop_name || 'ZEN Store',
    storeName: settings.shop_name || 'ZEN Store',
    currency: settings.currency || 'LKR',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    productCount: countSafe(db, 'SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL'),
    customerCount: tableExists(db, 'customers')
      ? countSafe(db, 'SELECT COUNT(*) AS c FROM customers WHERE deleted_at IS NULL')
      : 0,
    salesCount: countSafe(db, 'SELECT COUNT(*) AS c FROM sales WHERE deleted_at IS NULL'),
    userCount: countSafe(db, 'SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL'),
  };
}

function getAppliedDbVersion(db = getDb()) {
  try {
    const rows = db.prepare('SELECT version FROM _migrations ORDER BY applied_at DESC, version DESC').all();
    return rows[0]?.version || getLatestMigrationVersion();
  } catch {
    return getLatestMigrationVersion();
  }
}

export async function snapshotDatabase(destDbPath, jobId) {
  assertNotCancelled(jobId);
  emitProgress(jobId, { stage: 'Reading Database...', percent: 15 });

  const live = getDb();
  // Prefer SQLite Online Backup API via better-sqlite3
  await live.backup(destDbPath);

  // Sanity: open and quick-check
  const probe = new Database(destDbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`Database integrity check failed: ${integrity}`);
    }
  } finally {
    probe.close();
  }
}

function writeConfigBundle(configDir, themePreference = null) {
  ensureDir(configDir);
  const config = {
    theme: themePreference || null,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion?.() || '1.0.0',
  };
  fs.writeFileSync(path.join(configDir, 'app.json'), JSON.stringify(config, null, 2), 'utf8');
}

function createZipArchive(options) {
  if (typeof archiver === 'function') {
    return archiver('zip', options);
  }
  if (archiver?.ZipArchive) {
    return new archiver.ZipArchive(options);
  }
  throw new Error('Unsupported archiver package API.');
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = createZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Build a verified .poslybackup archive.
 */
export async function buildBackupArchive({
  destinationDir,
  type = 'manual',
  jobId,
  themePreference = null,
} = {}) {
  assertNotCancelled(jobId);
  emitProgress(jobId, { stage: 'Preparing...', percent: 5 });

  ensureReservedDataDirs();
  ensureDir(destinationDir);

  const uuid = crypto.randomUUID();
  const fileName = formatBackupFileName();
  const archivePath = path.join(destinationDir, fileName);
  const workDir = path.join(app.getPath('temp'), `posly-backup-${uuid}`);
  ensureDir(workDir);

  try {
    assertNotCancelled(jobId);

    const dbSnapshotPath = path.join(workDir, 'database.db');
    await snapshotDatabase(dbSnapshotPath, jobId);
    assertNotCancelled(jobId);

    emitProgress(jobId, { stage: 'Collecting files...', percent: 35 });

    const configDir = path.join(workDir, 'config');
    writeConfigBundle(configDir, themePreference);

    // Reserved / existing asset roots
    for (const root of listExistingDataRoots()) {
      const target = path.join(workDir, root.archivePath);
      if (root.exists) {
        ensureDir(target);
        for (const file of walkFiles(root.absolutePath)) {
          const dest = path.join(target, file.relativePath);
          ensureDir(path.dirname(dest));
          fs.copyFileSync(file.absolutePath, dest);
        }
      } else {
        ensureDir(target);
        fs.writeFileSync(path.join(target, '.poslykeep'), `Reserved: ${root.id}\n`, 'utf8');
      }
    }

    // Ensure standard empty dirs exist in archive
    for (const dir of ['assets', 'images', 'receipts', 'logs']) {
      ensureDir(path.join(workDir, dir));
      const keep = path.join(workDir, dir, '.poslykeep');
      if (!fs.existsSync(keep)) {
        fs.writeFileSync(keep, `Reserved: ${dir}\n`, 'utf8');
      }
    }

    const stats = collectManifestStats();
    const dbVersion = getAppliedDbVersion();
    const dbSize = fs.statSync(dbSnapshotPath).size;

    const versionJson = {
      applicationVersion: app.getVersion?.() || '1.0.0',
      databaseVersion: dbVersion,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      latestKnownMigration: getLatestMigrationVersion(),
    };
    fs.writeFileSync(path.join(workDir, 'version.json'), JSON.stringify(versionJson, null, 2), 'utf8');

    const filesForChecksum = walkFiles(workDir).filter(
      (f) => f.relativePath !== 'checksums.sha256' && f.relativePath !== 'manifest.json'
    );
    const checksumLines = filesForChecksum.map((f) => `${sha256File(f.absolutePath)}  ${f.relativePath}`);
    fs.writeFileSync(path.join(workDir, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, 'utf8');

    const manifest = {
      backupId: uuid,
      backupType: type,
      applicationVersion: versionJson.applicationVersion,
      databaseVersion: dbVersion,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 19),
      createdAt: new Date().toISOString(),
      computerName: os.hostname(),
      windowsUsername: os.userInfo().username,
      businessName: stats.businessName,
      storeName: stats.storeName,
      currency: stats.currency,
      timezone: stats.timezone,
      databaseSize: dbSize,
      sqliteVersion: getDb().prepare('SELECT sqlite_version() AS v').get()?.v || null,
      productCount: stats.productCount,
      customerCount: stats.customerCount,
      salesCount: stats.salesCount,
      userCount: stats.userCount,
      encryption: {
        enabled: false,
        algorithm: null,
        // Reserved for future AES-256 without changing outer archive workflow
      },
      checksum: sha256File(path.join(workDir, 'checksums.sha256')),
    };

    fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    assertNotCancelled(jobId);
    emitProgress(jobId, { stage: 'Compressing...', percent: 55 });

    const size = await zipDirectory(workDir, archivePath);
    manifest.backupSize = size;

    // Rewrite is not in zip; return size from archive stats
    const archiveStat = fs.statSync(archivePath);

    emitProgress(jobId, { stage: 'Verifying...', percent: 80 });

    return {
      uuid,
      fileName,
      path: archivePath,
      size: archiveStat.size,
      type,
      manifest: {
        ...manifest,
        backupSize: archiveStat.size,
      },
      versionJson,
      createdAt: manifest.createdAt,
    };
  } catch (error) {
    safeUnlink(archivePath);
    throw error;
  } finally {
    safeRmDir(workDir);
  }
}
