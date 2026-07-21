export const version = '010_product_fields';

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
  ensureColumn(db, 'products', 'unit', 'TEXT');
  ensureColumn(db, 'product_variants', 'low_stock_alert', 'REAL NOT NULL DEFAULT 0');
}
