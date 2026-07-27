export const version = '012_backup_system';

function columnNames(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = columnNames(db, tableName);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function up(db) {
  ensureColumn(db, 'settings', 'auto_backup_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'settings', 'auto_backup_frequency', "TEXT NOT NULL DEFAULT 'daily'");
  ensureColumn(db, 'settings', 'auto_backup_time', "TEXT NOT NULL DEFAULT '02:00'");
  ensureColumn(db, 'settings', 'auto_backup_keep', 'INTEGER NOT NULL DEFAULT 7');
  ensureColumn(db, 'settings', 'auto_backup_location', 'TEXT');
  ensureColumn(db, 'settings', 'last_auto_backup_at', 'TEXT');
  ensureColumn(db, 'settings', 'missed_backup_pending', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn(db, 'audit_log', 'details', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      checksum TEXT,
      created_at TEXT NOT NULL,
      verified_at TEXT,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backup_history_created
      ON backup_history(created_at DESC);
  `);
}
