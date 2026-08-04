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
import * as migration011 from './011_discounts.js';
import * as migration012 from './012_backup_system.js';
import * as migration013 from './013_v1_shop_loop.js';
import * as migration014 from './014_return_within_days.js';
import * as migration015 from './015_import_export.js';
import * as migration016 from './016_stale_day_policy.js';
import * as migration017 from './017_user_permissions.js';

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
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
];

export function getLatestMigrationVersion() {
  return migrations[migrations.length - 1].version;
}

export function getMigrationVersions() {
  return migrations.map((m) => m.version);
}

export function getPendingMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM _migrations')
      .all()
      .map((m) => m.version)
  );

  return migrations.filter((migration) => !applied.has(migration.version));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ beforePending?: (pending: typeof migrations) => void }} [options]
 */
export function runMigrations(db, options = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const pending = getPendingMigrations(db);

  if (pending.length > 0 && typeof options.beforePending === 'function') {
    options.beforePending(pending);
  }

  for (const migration of pending) {
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
