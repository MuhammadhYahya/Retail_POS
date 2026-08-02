import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { runMigrations } from './migrations/index.js';

const require = createRequire(import.meta.url);

function getElectronApp() {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

let db;
let skipMigrationSafetyBackup = false;

export function getDbPath() {
  const app = getElectronApp();
  if (!app) {
    throw new Error('Electron app is not available. Use openDbAtPath() for headless runs.');
  }
  return path.join(app.getPath('userData'), 'zen.db');
}

export function getDataDir() {
  const app = getElectronApp();
  if (!app) {
    throw new Error('Electron app is not available. Use openDbAtPath() for headless runs.');
  }
  return app.getPath('userData');
}

export function setSkipMigrationSafetyBackup(value) {
  skipMigrationSafetyBackup = Boolean(value);
}

async function maybeSafetyBackupBeforeMigrations(pending) {
  if (skipMigrationSafetyBackup) return;
  if (!pending?.length) return;

  // Bootstrap: cannot use backup subsystem until 012 is applied
  if (pending.some((m) => m.version === '012_backup_system')) return;

  try {
    const { default: backupService } = await import('../services/backup/index.js');
    console.log('[db] Creating safety backup before migrations:', pending.map((p) => p.version).join(', '));
    await backupService.createSafetyBackup({ type: 'pre_upgrade' });
  } catch (error) {
    console.error('[db] Pre-migration safety backup failed:', error.message);
    throw new Error(
      `Cannot apply database updates without a safety backup: ${error.message}`
    );
  }
}

export function getDb() {
  if (db) return db;

  const dataDir = getDataDir();

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = getDbPath();

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    // Synchronous migration path; safety backup is async so we run a sync file snapshot
    // for pending migrations when backup system is available.
    runMigrations(db, {
      beforePending: (pending) => {
        if (skipMigrationSafetyBackup) return;
        if (!pending?.length) return;
        if (pending.some((m) => m.version === '012_backup_system')) return;

        // Sync safety: VACUUM INTO / backup API to pre_migration file before schema changes
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(dataDir, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const dest = path.join(backupDir, `pre_migration_${stamp}.db`);
        try {
          // better-sqlite3 backup is async; use VACUUM INTO for sync pre-migration safety
          const vacuumPath = dest.replace(/\\/g, '/').replace(/'/g, "''");
          db.exec(`VACUUM INTO '${vacuumPath}'`);
          console.log('[db] Pre-migration safety snapshot:', dest);
        } catch (error) {
          console.error('[db] Pre-migration VACUUM INTO failed:', error.message);
          throw new Error(
            `Cannot apply database updates without a safety backup: ${error.message}`
          );
        }
      },
    });
    console.log('Database successfully initialized at:', dbPath);
  } catch (error) {
    console.error('Failed to run database migrations:', error);
    throw error;
  }

  return db;
}

export function closeDb() {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // ignore
  }
  try {
    db.close();
  } catch (error) {
    console.error('[db] Failed to close database:', error.message);
  }
  db = null;
}

export function reopenDb() {
  closeDb();
  return getDb();
}

export function isDbOpen() {
  return Boolean(db);
}

/** Headless / simulation: open a specific SQLite file and run migrations (no Electron app). */
export function openDbAtPath(dbPath, { skipSafetyBackup = true } = {}) {
  if (db) closeDb();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  skipMigrationSafetyBackup = skipSafetyBackup;
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, {
    beforePending: () => {},
  });
  return db;
}

export { maybeSafetyBackupBeforeMigrations };
