import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { getLatestMigrationVersion, getMigrationVersions } from '../../database/migrations/index.js';
import { ensureDir, sha256File, safeRmDir, safeUnlink } from './backupUtils.js';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl');

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const files = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const dest = path.join(destDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          ensureDir(dest);
          zipfile.readEntry();
          return;
        }
        ensureDir(path.dirname(dest));
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(streamErr);
          const writeStream = fs.createWriteStream(dest);
          readStream.pipe(writeStream);
          writeStream.on('close', () => {
            files.push(entry.fileName);
            zipfile.readEntry();
          });
          writeStream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(files));
      zipfile.on('error', reject);
    });
  });
}

function parseChecksumFile(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
    if (!match) continue;
    map.set(match[2].replace(/\\/g, '/'), match[1].toLowerCase());
  }
  return map;
}

export async function extractBackupArchive(archivePath, destDir) {
  ensureDir(destDir);
  await extractZip(archivePath, destDir);
  return destDir;
}

export async function verifyBackupArchive(archivePath, { extractDir = null } = {}) {
  if (!archivePath || !fs.existsSync(archivePath)) {
    throw new Error('Backup file was not found.');
  }

  const lower = archivePath.toLowerCase();
  if (
    !lower.endsWith('.zenbackup') &&
    !lower.endsWith('.poslybackup') &&
    !lower.endsWith('.zip') &&
    !lower.endsWith('.db')
  ) {
    throw new Error('Unsupported backup file type.');
  }

  // Legacy .db support: basic open check
  if (lower.endsWith('.db')) {
    const probe = new Database(archivePath, { readonly: true, fileMustExist: true });
    try {
      const integrity = probe.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error('Backup is corrupted. Restore cannot continue.');
      }
      return {
        legacy: true,
        valid: true,
        manifest: {
          backupId: null,
          businessName: 'Legacy database backup',
          createdAt: fs.statSync(archivePath).mtime.toISOString(),
          applicationVersion: 'unknown',
          databaseVersion: 'unknown',
          productCount: null,
          customerCount: null,
          salesCount: null,
          userCount: null,
          backupSize: fs.statSync(archivePath).size,
          encryption: { enabled: false },
        },
        extractDir: null,
      };
    } finally {
      probe.close();
    }
  }

  // Archive readable?
  try {
    const zip = await openZip(archivePath);
    zip.close();
  } catch {
    throw new Error('Backup is corrupted. Restore cannot continue.');
  }

  const workDir = extractDir || path.join(app.getPath('temp'), `zen-verify-${Date.now()}`);
  const ownsDir = !extractDir;
  if (ownsDir) ensureDir(workDir);

  try {
    await extractZip(archivePath, workDir);

    const manifestPath = path.join(workDir, 'manifest.json');
    const checksumPath = path.join(workDir, 'checksums.sha256');
    const dbPath = path.join(workDir, 'database.db');
    const versionPath = path.join(workDir, 'version.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error('Backup is corrupted. Manifest is missing.');
    }
    if (!fs.existsSync(checksumPath)) {
      throw new Error('Backup is corrupted. Checksums are missing.');
    }
    if (!fs.existsSync(dbPath)) {
      throw new Error('Backup is corrupted. Database is missing.');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const versionJson = fs.existsSync(versionPath)
      ? JSON.parse(fs.readFileSync(versionPath, 'utf8'))
      : null;

    if (manifest.encryption?.enabled) {
      throw new Error(
        'This backup is encrypted. Please update ZEN to a version that supports encrypted backups.'
      );
    }

    const expected = parseChecksumFile(fs.readFileSync(checksumPath, 'utf8'));
    for (const [rel, expectedHash] of expected.entries()) {
      const abs = path.join(workDir, rel);
      if (!fs.existsSync(abs)) {
        throw new Error('Backup is corrupted. Restore cannot continue.');
      }
      const actual = sha256File(abs);
      if (actual !== expectedHash) {
        throw new Error('Backup is corrupted. Restore cannot continue.');
      }
    }

    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = probe.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error('Backup is corrupted. Restore cannot continue.');
      }
    } finally {
      probe.close();
    }

    return {
      legacy: false,
      valid: true,
      manifest,
      versionJson,
      extractDir: workDir,
      ownsExtractDir: ownsDir,
    };
  } catch (error) {
    if (ownsDir) safeRmDir(workDir);
    throw error;
  }
}

export function checkVersionCompatibility(manifest, versionJson) {
  const backupDbVersion = versionJson?.databaseVersion || manifest?.databaseVersion;
  const known = getMigrationVersions();
  const latest = getLatestMigrationVersion();

  if (!backupDbVersion || backupDbVersion === 'unknown') {
    return { ok: true, needsMigration: true, reason: null };
  }

  // If backup version is not in known list and sorts after latest lexically as 0XX_, block as newer
  if (!known.includes(backupDbVersion)) {
    // Heuristic: numeric prefix comparison
    const backupNum = Number(String(backupDbVersion).split('_')[0]);
    const latestNum = Number(String(latest).split('_')[0]);
    if (Number.isFinite(backupNum) && Number.isFinite(latestNum) && backupNum > latestNum) {
      return {
        ok: false,
        needsMigration: false,
        reason:
        'This backup was created with a newer version of ZEN. Please update ZEN first.',
      };
    }
  }

  const appliedIndex = known.indexOf(backupDbVersion);
  const latestIndex = known.indexOf(latest);
  const needsMigration = appliedIndex >= 0 && appliedIndex < latestIndex;

  return { ok: true, needsMigration, reason: null };
}

export { extractZip, safeRmDir, safeUnlink };
