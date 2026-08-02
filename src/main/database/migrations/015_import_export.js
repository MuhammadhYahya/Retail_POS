export const version = '015_import_export';

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
  // Optional default supplier on products (used by Excel import/export round-trip)
  ensureColumn(db, 'products', 'supplier_id', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS import_history (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      file_name TEXT,
      user_id TEXT,
      user_name TEXT,
      mode TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      imported_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_report_json TEXT,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_import_history_created
      ON import_history(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_products_supplier_id
      ON products(supplier_id);
  `);
}
