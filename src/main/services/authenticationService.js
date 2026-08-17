import bcrypt from 'bcryptjs';
import { getDb } from '../database/db.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';

export async function verifyUserPin(user, pin) {
  return Boolean(user?.pin_hash) && bcrypt.compare(String(pin || ''), user.pin_hash);
}

export async function authenticateAdminSession(payload = {}) {
  const session = validateSession(extractToken(payload));
  if (!session.success) return session;

  const roleCheck = requireRole(session, ['admin']);
  if (!roleCheck.success) return roleCheck;

  const user = getDb().prepare(`
    SELECT * FROM users
    WHERE id = ? AND role = 'admin' AND is_active = 1 AND deleted_at IS NULL
  `).get(session.user.id);

  if (!user || !(await verifyUserPin(user, payload.pin))) {
    return { success: false, error: 'Administrator PIN is incorrect.', code: 'FORBIDDEN' };
  }

  return { success: true, session, user };
}
