import * as migration001 from './001_init.js';
import * as migration002 from './002_settings.js';
import * as migration003 from './003_sessions.js';
import * as migration004 from './004_user_fields.js';
import * as migration005 from './005_user_timestamps.js';
import * as migration006 from './006_auth_bootstrap.js';
import * as migration007 from './007_security_questions.js';
import * as migration008 from './008_products.js';
import * as migration009 from './009_sales.js';
import * as migration010 from './010_product_fields.js';

const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
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

    console.log(`Migration applied: ${migration.version}`);
  }
}
