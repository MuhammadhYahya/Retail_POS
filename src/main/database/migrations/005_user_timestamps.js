export const version = '005_user_timestamps';

export function up(db) {
  const userColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((column) => column.name);

  if (!userColumns.includes('updated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT`);
  }

  if (!userColumns.includes('created_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`);
  }

  db.prepare(`
    UPDATE users
    SET updated_at = COALESCE(updated_at, created_at)
  `).run();
}
