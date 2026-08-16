export const version = '020_audit_reliability';

function columnNames(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!columnNames(db, tableName).includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function up(db) {
  ensureColumn(db, 'audit_log', 'event_id', 'TEXT');
  ensureColumn(db, 'audit_log', 'entity_type', 'TEXT');
  ensureColumn(db, 'audit_log', 'entity_id', 'TEXT');
  ensureColumn(db, 'audit_log', 'reference_number', 'TEXT');
  ensureColumn(db, 'audit_log', 'amount', 'REAL');
  ensureColumn(db, 'audit_log', 'details', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_event_id
      ON audit_log(event_id) WHERE event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
      ON audit_log(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity
      ON audit_log(entity_type, entity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      reference_number TEXT,
      amount REAL,
      actor_user_id TEXT,
      actor_display_name TEXT,
      event_created_at TEXT NOT NULL,
      details TEXT,
      failure_reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'database',
      status TEXT NOT NULL DEFAULT 'pending',
      recovered_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_failures_status_created
      ON audit_log_failures(status, created_at DESC);
  `);
}
