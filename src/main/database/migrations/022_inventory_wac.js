import crypto from 'crypto';

export const version = '022_inventory_wac';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function n(value, fallback = 0) {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : fallback;
}

export function up(db) {
  addColumn(db, 'purchase_receipts', 'invoice_number', 'TEXT');
  addColumn(db, 'purchase_receipts', 'invoice_date', 'TEXT');
  addColumn(db, 'purchase_receipts', 'received_date', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_costing (
      variant_id TEXT PRIMARY KEY,
      quantity REAL NOT NULL DEFAULT 0,
      inventory_value REAL NOT NULL DEFAULT 0,
      average_cost REAL NOT NULL DEFAULT 0,
      is_reconciled INTEGER NOT NULL DEFAULT 1,
      backfill_status TEXT,
      backfill_notes TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT NOT NULL UNIQUE,
      supplier_id TEXT,
      return_date TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      receipt_item_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      original_unit_cost REAL NOT NULL DEFAULT 0,
      valuation_unit_cost REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(return_id) REFERENCES purchase_returns(id),
      FOREIGN KEY(receipt_id) REFERENCES purchase_receipts(id),
      FOREIGN KEY(receipt_item_id) REFERENCES purchase_receipt_items(id),
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_receipt_item
      ON purchase_return_items(receipt_item_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_variant
      ON purchase_return_items(variant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inventory_costing_status
      ON inventory_costing(is_reconciled, updated_at DESC);
  `);

  const timestamp = new Date().toISOString();
  const variants = db.prepare(`
    SELECT v.id, v.cost_price, COALESCE(b.on_hand, 0) AS balance_on_hand
    FROM product_variants v
    LEFT JOIN inventory_balances b ON b.variant_id = v.id
    WHERE v.deleted_at IS NULL
  `).all();
  const txRows = db.prepare(`
    SELECT * FROM inventory_transactions
    WHERE variant_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const insert = db.prepare(`
    INSERT INTO inventory_costing
      (variant_id, quantity, inventory_value, average_cost, is_reconciled, backfill_status, backfill_notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(variant_id) DO UPDATE SET
      quantity = excluded.quantity,
      inventory_value = excluded.inventory_value,
      average_cost = excluded.average_cost,
      is_reconciled = excluded.is_reconciled,
      backfill_status = excluded.backfill_status,
      backfill_notes = excluded.backfill_notes,
      updated_at = excluded.updated_at
  `);

  for (const variant of variants) {
    let quantity = 0;
    let value = 0;
    let usedFallback = false;
    let missingCost = false;
    for (const row of txRows.all(variant.id)) {
      const delta = n(row.quantity);
      if (!delta) continue;
      const currentAverage = quantity > 0 ? value / quantity : n(variant.cost_price);
      let unitCost = row.unit_cost === null || row.unit_cost === undefined ? null : n(row.unit_cost, null);
      if (unitCost === null || !Number.isFinite(unitCost)) {
        unitCost = n(variant.cost_price, 0);
        usedFallback = true;
        missingCost = true;
      }
      if (delta > 0) value += delta * (row.transaction_type === 'return_in' && row.unit_cost == null ? currentAverage : unitCost);
      else value += delta * currentAverage;
      quantity += delta;
      if (quantity < -0.0001) missingCost = true;
      if (quantity <= 0.0001) {
        quantity = Math.max(0, quantity);
        value = 0;
      }
    }
    const balance = n(variant.balance_on_hand);
    const mismatch = Math.abs(quantity - balance) > 0.0001;
    const reconciled = !mismatch && !missingCost;
    const notes = [
      mismatch ? `Ledger quantity ${quantity} differs from balance ${balance}.` : '',
      missingCost ? 'One or more historical movements had no unit cost; product cost_price fallback used.' : '',
    ].filter(Boolean).join(' ');
    insert.run(
      variant.id,
      balance,
      mismatch ? Math.max(0, balance * (quantity > 0 ? value / quantity : n(variant.cost_price))) : Math.max(0, value),
      mismatch ? (balance > 0 ? Math.max(0, quantity > 0 ? value / quantity : n(variant.cost_price)) : 0) : (balance > 0 ? Math.max(0, value / balance) : 0),
      reconciled ? 1 : 0,
      reconciled ? 'completed' : 'review_required',
      notes || null,
      timestamp
    );
  }
}
