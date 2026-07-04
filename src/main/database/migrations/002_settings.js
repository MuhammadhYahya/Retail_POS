export const version = '002_settings';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),

      shop_name TEXT DEFAULT 'POSLY Store',
      currency TEXT DEFAULT 'LKR',
      language TEXT DEFAULT 'en',

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const settings = db
    .prepare('SELECT id FROM settings WHERE id = 1')
    .get();

  if (!settings) {
    db.prepare(`
      INSERT INTO settings
      (id, shop_name, currency, language)
      VALUES (1, ?, ?, ?)
    `).run(
      'POSLY Store',
      'LKR',
      'en'
    );
  }
}