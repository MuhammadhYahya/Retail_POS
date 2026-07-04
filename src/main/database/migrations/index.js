import * as migration001 from './001_init.js';
import * as migration002 from './002_settings.js';

const migrations = [
  migration001,
  migration002,
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = db
    .prepare('SELECT version FROM _migrations')
    .all()
    .map((m) => m.version);

  for (const migration of migrations) {
    if (applied.includes(migration.version)) continue;

    const transaction = db.transaction(() => {
      migration.up(db);

      db.prepare(`
        INSERT INTO _migrations(version)
        VALUES(?)
      `).run(migration.version);
    });

    transaction();

    console.log(`✔ Migration applied: ${migration.version}`);
  }
}