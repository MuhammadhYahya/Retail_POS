import bcryptjs from 'bcryptjs';
import crypto from 'crypto';

export const version = '006_auth_bootstrap';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const existingSecret = db
    .prepare(`SELECT value FROM app_secrets WHERE key = 'jwt_secret'`)
    .get();

  if (!existingSecret) {
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO app_secrets (key, value, created_at)
      VALUES ('jwt_secret', ?, ?)
    `).run(secret, new Date().toISOString());
  }

  const seedAdmin = db
    .prepare(`SELECT id, pin_hash FROM users WHERE username = 'admin' AND deleted_at IS NULL`)
    .get();

  if (seedAdmin) {
    const isDefaultPin = bcryptjs.compareSync('1234', seedAdmin.pin_hash);
    if (isDefaultPin) {
      // Clear FK references before removing the seed admin
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(seedAdmin.id);
      db.prepare(`UPDATE audit_log SET user_id = NULL WHERE user_id = ?`).run(seedAdmin.id);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(seedAdmin.id);
    }
  }
}
