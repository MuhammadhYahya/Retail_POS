import { defaultsForRole, serializePermissions } from '../../lib/permissions.js';

export const version = '017_user_permissions';

export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!columns.includes('permissions')) {
    db.exec(`ALTER TABLE users ADD COLUMN permissions TEXT`);
  }

  const users = db.prepare(`
    SELECT id, role, permissions
    FROM users
    WHERE deleted_at IS NULL
  `).all();

  const update = db.prepare(`
    UPDATE users
    SET permissions = ?
    WHERE id = ?
  `);

  for (const user of users) {
    if (user.role === 'admin') {
      update.run(null, user.id);
      continue;
    }

    if (user.permissions) continue;

    update.run(serializePermissions(defaultsForRole(user.role), user.role), user.id);
  }
}
