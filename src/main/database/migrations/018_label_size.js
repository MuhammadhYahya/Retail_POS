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

export const version = '018_label_size';

export function up(db) {
  // Default 38×25 mm matches common XP-365B price labels (1.5" × 1").
  ensureColumn(db, 'settings', 'label_width_mm', 'REAL NOT NULL DEFAULT 38');
  ensureColumn(db, 'settings', 'label_height_mm', 'REAL NOT NULL DEFAULT 25');
}
