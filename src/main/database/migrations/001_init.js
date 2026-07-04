import bcryptjs  from 'bcryptjs';
import crypto from 'crypto'; // crypto is imported for UUID generation

export const version = '001_init';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, -- Changed to TEXT to match the user's UUID type
      action TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // 2. Check if seed admin exists
  const exists = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('admin');

  // 3. Seed the initial admin user safely if they don't exist
  if (!exists) {
    const pinHash = bcryptjs.hashSync('1234', 10);
    const userId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO users (id, username, pin_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(userId, 'admin', pinHash, 'admin');
  }
}