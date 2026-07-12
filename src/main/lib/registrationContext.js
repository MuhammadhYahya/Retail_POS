import { getDb } from '../database/db.js';

export function getRegistrationContext() {
  const db = getDb();

  const userCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE deleted_at IS NULL
  `).get().count;

  const adminCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE role = 'admin'
      AND is_active = 1
      AND deleted_at IS NULL
  `).get().count;

  const hasUsers = userCount > 0;
  const hasAdmin = adminCount > 0;
  const mode = hasUsers ? 'public' : 'bootstrap';

  return { mode, hasAdmin, hasUsers };
}
