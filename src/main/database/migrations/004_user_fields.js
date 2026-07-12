export const version = '004_user_fields';

export function up(db) {
  const userColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((column) => column.name);

  if (!userColumns.includes('display_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }

  if (!userColumns.includes('is_active')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }

  if (!userColumns.includes('failed_attempts')) {
    db.exec(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`);
  }

  if (!userColumns.includes('deleted_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT`);
  }

  // Ensure any existing user rows have sensible defaults
  db.prepare(`
    UPDATE users
    SET display_name = COALESCE(display_name, username),
        is_active = COALESCE(is_active, 1),
        failed_attempts = COALESCE(failed_attempts, 0)
  `).run();
}
