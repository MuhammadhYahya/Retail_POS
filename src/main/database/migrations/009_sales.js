export const version = '009_sales';

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
  ensureColumn(db, 'settings', 'shop_address', 'TEXT');
  ensureColumn(db, 'settings', 'shop_phone', 'TEXT');
  ensureColumn(db, 'settings', 'shop_tin', 'TEXT');
  ensureColumn(db, 'settings', 'vat_rate', 'REAL NOT NULL DEFAULT 18');
  ensureColumn(db, 'settings', 'next_invoice_seq', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'settings', 'invoice_prefix', "TEXT NOT NULL DEFAULT 'POS'");
  ensureColumn(db, 'settings', 'receipt_header', 'TEXT');
  ensureColumn(db, 'settings', 'receipt_footer', 'TEXT');
  ensureColumn(db, 'settings', 'printer_port', 'TEXT');
  ensureColumn(db, 'settings', 'paper_width', 'INTEGER NOT NULL DEFAULT 80');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      invoice_seq INTEGER NOT NULL,
      sale_date TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      customer_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      vat_total REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      amount_tendered REAL NOT NULL DEFAULT 0,
      change_given REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      void_reason TEXT,
      voided_by TEXT,
      voided_at TEXT,
      ird_status TEXT NOT NULL DEFAULT 'none',
      ird_uuid TEXT,
      notes TEXT,
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(cashier_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_name TEXT,
      sku TEXT,
      barcode TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(variant_id) REFERENCES product_variants(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS ird_invoices (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL UNIQUE,
      invoice_uuid TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      qr_data TEXT,
      status TEXT NOT NULL DEFAULT 'generated',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sale_id) REFERENCES sales(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_cashier_id ON sales(cashier_id);
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_sales_is_synced ON sales(is_synced);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_variant_id ON sale_items(variant_id);
  `);
}
