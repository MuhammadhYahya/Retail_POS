export const version = '013_v1_shop_loop';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id TEXT PRIMARY KEY,
      opened_by TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      opening_float REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      closing_counted_cash REAL,
      expected_cash REAL,
      variance REAL,
      closed_by TEXT,
      closed_at TEXT,
      notes TEXT,
      z_report_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(opened_by) REFERENCES users(id),
      FOREIGN KEY(closed_by) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_open
      ON cash_sessions(status) WHERE status = 'open';

    CREATE TABLE IF NOT EXISTS z_reports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      report_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES cash_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id TEXT PRIMARY KEY,
      grn_number TEXT NOT NULL UNIQUE,
      supplier_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      received_at TEXT,
      notes TEXT,
      total_cost REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      posted_by TEXT,
      posted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(posted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(receipt_id) REFERENCES purchase_receipts(id),
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS sale_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT NOT NULL UNIQUE,
      sale_id TEXT NOT NULL,
      session_id TEXT,
      refund_total REAL NOT NULL DEFAULT 0,
      refund_method TEXT NOT NULL DEFAULT 'cash',
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(session_id) REFERENCES cash_sessions(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sale_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      sale_item_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_refund REAL NOT NULL DEFAULT 0,
      line_refund REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(return_id) REFERENCES sale_returns(id),
      FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      note TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(session_id) REFERENCES cash_sessions(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_session ON expenses(session_id);
    CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_status ON purchase_receipts(status);
  `);

  // Link sales to cash session when present
  const saleCols = db.prepare(`PRAGMA table_info(sales)`).all().map((c) => c.name);
  if (!saleCols.includes('session_id')) {
    db.exec(`ALTER TABLE sales ADD COLUMN session_id TEXT`);
  }
}
