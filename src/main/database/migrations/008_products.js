import crypto from 'crypto';

export const version = '008_products';

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

function ensureUniqueIndex(db, indexName, sql) {
  const existing = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(indexName);

  if (!existing) {
    db.exec(sql);
  }
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(parent_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      brand TEXT,
      tax_rate REAL NOT NULL DEFAULT 0,
      category_id TEXT,
      image_urls_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT,
      sku TEXT NOT NULL,
      barcode TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      selling_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      track_inventory INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL,
      reference_type TEXT,
      reference_id TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_balances (
      variant_id TEXT PRIMARY KEY,
      on_hand REAL NOT NULL DEFAULT 0,
      reserved REAL NOT NULL DEFAULT 0,
      available REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );
  `);

  const productColumns = columnNames(db, 'products');
  if (!productColumns.includes('image_urls_json')) {
    db.exec(`ALTER TABLE products ADD COLUMN image_urls_json TEXT NOT NULL DEFAULT '[]'`);
  }

  const categoryColumns = columnNames(db, 'categories');
  if (!categoryColumns.includes('is_active')) {
    db.exec(`ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!categoryColumns.includes('created_at')) {
    db.exec(`ALTER TABLE categories ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`);
  }
  if (!categoryColumns.includes('updated_at')) {
    db.exec(`ALTER TABLE categories ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`);
  }
  if (!categoryColumns.includes('deleted_at')) {
    db.exec(`ALTER TABLE categories ADD COLUMN deleted_at TEXT`);
  }

  const variantColumns = columnNames(db, 'product_variants');
  if (!variantColumns.includes('attributes_json')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!variantColumns.includes('track_inventory')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN track_inventory INTEGER NOT NULL DEFAULT 1`);
  }
  if (!variantColumns.includes('is_default')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`);
  }
  if (!variantColumns.includes('is_hidden')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`);
  }
  if (!variantColumns.includes('sort_order')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  }
  if (!variantColumns.includes('is_active')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!variantColumns.includes('deleted_at')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN deleted_at TEXT`);
  }

  const inventoryColumns = columnNames(db, 'inventory_transactions');
  if (!inventoryColumns.includes('unit_cost')) {
    db.exec(`ALTER TABLE inventory_transactions ADD COLUMN unit_cost REAL`);
  }
  if (!inventoryColumns.includes('reference_type')) {
    db.exec(`ALTER TABLE inventory_transactions ADD COLUMN reference_type TEXT`);
  }
  if (!inventoryColumns.includes('reference_id')) {
    db.exec(`ALTER TABLE inventory_transactions ADD COLUMN reference_id TEXT`);
  }
  if (!inventoryColumns.includes('notes')) {
    db.exec(`ALTER TABLE inventory_transactions ADD COLUMN notes TEXT`);
  }
  if (!inventoryColumns.includes('created_by')) {
    db.exec(`ALTER TABLE inventory_transactions ADD COLUMN created_by TEXT`);
  }

  const balanceColumns = columnNames(db, 'inventory_balances');
  if (!balanceColumns.includes('reserved')) {
    db.exec(`ALTER TABLE inventory_balances ADD COLUMN reserved REAL NOT NULL DEFAULT 0`);
  }
  if (!balanceColumns.includes('available')) {
    db.exec(`ALTER TABLE inventory_balances ADD COLUMN available REAL NOT NULL DEFAULT 0`);
  }
  if (!balanceColumns.includes('updated_at')) {
    db.exec(`ALTER TABLE inventory_balances ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`);
  }

  ensureUniqueIndex(
    db,
    'idx_categories_parent_name_active',
    `CREATE UNIQUE INDEX idx_categories_parent_name_active ON categories(COALESCE(parent_id, ''), name) WHERE deleted_at IS NULL`
  );
  ensureUniqueIndex(
    db,
    'idx_product_variants_sku',
    `CREATE UNIQUE INDEX idx_product_variants_sku ON product_variants(sku) WHERE deleted_at IS NULL`
  );
  ensureUniqueIndex(
    db,
    'idx_product_variants_barcode',
    `CREATE UNIQUE INDEX idx_product_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`
  );
  ensureUniqueIndex(
    db,
    'idx_product_variants_product_id',
    `CREATE INDEX idx_product_variants_product_id ON product_variants(product_id)`
  );
  ensureUniqueIndex(
    db,
    'idx_inventory_transactions_variant_id',
    `CREATE INDEX idx_inventory_transactions_variant_id ON inventory_transactions(variant_id, created_at DESC)`
  );
  ensureUniqueIndex(
    db,
    'idx_inventory_balances_updated_at',
    `CREATE INDEX idx_inventory_balances_updated_at ON inventory_balances(updated_at DESC)`
  );

  const categoryId = crypto.randomUUID();
  const existingRootCategory = db
    .prepare(`SELECT id FROM categories WHERE name = 'Uncategorized' AND parent_id IS NULL AND deleted_at IS NULL`)
    .get();

  if (!existingRootCategory) {
    db.prepare(`
      INSERT INTO categories (id, name, parent_id, is_active, created_at, updated_at)
      VALUES (?, 'Uncategorized', NULL, 1, ?, ?)
    `).run(categoryId, new Date().toISOString(), new Date().toISOString());
  }
}
