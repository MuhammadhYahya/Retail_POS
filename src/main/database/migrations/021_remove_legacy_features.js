export const version = '021_remove_legacy_features';

function dropColumnIfPresent(db, table, column) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
  if (exists) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

export function up(db) {
  // These columns were informational only; sale totals are already stored independently.
  for (const column of ['shop_tin', 'vat_rate']) dropColumnIfPresent(db, 'settings', column);
  for (const column of ['tax_rate']) dropColumnIfPresent(db, 'products', column);
  for (const column of ['tax_rate', 'vat_amount']) dropColumnIfPresent(db, 'sale_items', column);
  for (const column of ['vat_total', 'ird_status', 'ird_uuid']) dropColumnIfPresent(db, 'sales', column);
  db.exec('DROP TABLE IF EXISTS ird_invoices');
}
