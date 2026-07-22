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

export const version = '011_discounts';

export function up(db) {
  ensureColumn(db, 'settings', 'cashier_max_discount_pct', 'REAL NOT NULL DEFAULT 10');
  ensureColumn(db, 'settings', 'manager_max_discount_pct', 'REAL NOT NULL DEFAULT 25');

  ensureColumn(db, 'sales', 'sale_discount_type', "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'sales', 'sale_discount_value', 'REAL NOT NULL DEFAULT 0');

  ensureColumn(db, 'sale_items', 'discount_type', "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'sale_items', 'discount_value', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'sale_items', 'unit_cost', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'sale_items', 'original_line_total', 'REAL NOT NULL DEFAULT 0');
}
