export const version = '023_phase1_expiry_margin_pricing';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function up(db) {
  addColumn(db, 'products', 'has_expiry', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'product_variants', 'price_type', "TEXT NOT NULL DEFAULT 'FREE'");
  addColumn(db, 'purchase_receipt_items', 'batch_number', 'TEXT');
  addColumn(db, 'purchase_receipt_items', 'expiry_date', 'TEXT');
  addColumn(db, 'purchase_receipt_items', 'received_mrp', 'REAL');
  addColumn(db, 'purchase_receipt_items', 'sale_status', "TEXT NOT NULL DEFAULT 'active'");
}
