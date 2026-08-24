export const version = '024_product_drafts';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function up(db) {
  addColumn(db, 'products', 'is_draft', 'INTEGER NOT NULL DEFAULT 0');
}
