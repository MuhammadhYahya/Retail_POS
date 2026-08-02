import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const MARKER_NAME = 'migration-from-posly.json';
const LEGACY_APP_FOLDER = 'posly';
const LEGACY_DB = 'posly.db';
const NEW_DB = 'zen.db';

function hasUsableDb(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return (
    fs.existsSync(path.join(dir, NEW_DB)) ||
    fs.existsSync(path.join(dir, LEGACY_DB))
  );
}

function copyFileIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * One-time copy of %APPDATA%/posly → Zen userData when the new folder has no DB yet.
 * Does not delete the old folder.
 */
export function migrateUserDataFromPosly() {
  const newRoot = app.getPath('userData');
  const oldRoot = path.join(app.getPath('appData'), LEGACY_APP_FOLDER);
  const markerPath = path.join(newRoot, MARKER_NAME);

  if (fs.existsSync(markerPath)) {
    return { skipped: true, reason: 'already_migrated' };
  }

  if (hasUsableDb(newRoot)) {
    fs.mkdirSync(newRoot, { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          migratedAt: new Date().toISOString(),
          source: null,
          note: 'Zen userData already had a database; posly copy skipped.',
        },
        null,
        2
      ),
      'utf8'
    );
    return { skipped: true, reason: 'target_has_db' };
  }

  if (!hasUsableDb(oldRoot)) {
    return { skipped: true, reason: 'no_legacy_data' };
  }

  console.log(`[migrate] Copying shop data from ${oldRoot} → ${newRoot}`);
  fs.mkdirSync(newRoot, { recursive: true });
  copyDirRecursive(oldRoot, newRoot);

  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        source: oldRoot,
        destination: newRoot,
        note: 'Copied from legacy Posly userData. Old folder was left in place.',
      },
      null,
      2
    ),
    'utf8'
  );

  return { migrated: true, source: oldRoot, destination: newRoot };
}

/**
 * Prefer zen.db; if only posly.db exists in userData, copy it (+ wal/shm) to zen.db.
 */
export function migrateDbFilenameInUserData() {
  const dataDir = app.getPath('userData');
  const zenPath = path.join(dataDir, NEW_DB);
  const poslyPath = path.join(dataDir, LEGACY_DB);

  if (fs.existsSync(zenPath)) {
    return { skipped: true, reason: 'zen_db_exists' };
  }

  if (!fs.existsSync(poslyPath)) {
    return { skipped: true, reason: 'no_posly_db' };
  }

  console.log(`[migrate] Promoting ${LEGACY_DB} → ${NEW_DB}`);
  copyFileIfExists(poslyPath, zenPath);
  copyFileIfExists(`${poslyPath}-wal`, `${zenPath}-wal`);
  copyFileIfExists(`${poslyPath}-shm`, `${zenPath}-shm`);

  return { migrated: true, from: poslyPath, to: zenPath };
}

/** Run folder + DB filename migration before getDb(). */
export function migrateFromPosly() {
  try {
    const folder = migrateUserDataFromPosly();
    const dbFile = migrateDbFilenameInUserData();
    return { folder, dbFile };
  } catch (error) {
    console.error('[migrate] Posly → Zen migration failed:', error.message);
    throw error;
  }
}
