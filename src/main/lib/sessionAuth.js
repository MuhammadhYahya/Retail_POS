import jwt from 'jsonwebtoken';
import { getDb } from '../database/db.js';
import { getJwtSecret } from './jwtSecret.js';

export function validateSession(token) {
  if (!token) {
    return { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' };
  }

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret);
    const db = getDb();
    const now = new Date().toISOString();

    const session = db.prepare(`
      SELECT s.token, u.id, u.username, u.display_name, u.role, u.is_active, u.deleted_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
        AND s.expires_at > ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `).get(token, now);

    if (!session) {
      return { success: false, error: 'Session expired or invalid', code: 'UNAUTHORIZED' };
    }

    if (payload.userId !== session.id) {
      return { success: false, error: 'Session mismatch', code: 'UNAUTHORIZED' };
    }

    return {
      success: true,
      user: {
        id: session.id,
        username: session.username,
        display_name: session.display_name,
        role: session.role,
      },
    };
  } catch (err) {
    return { success: false, error: 'Invalid session', code: 'UNAUTHORIZED' };
  }
}

export function requireRole(session, allowedRoles) {
  if (!allowedRoles.includes(session.user.role)) {
    return { success: false, error: 'Forbidden', code: 'FORBIDDEN' };
  }
  return { success: true };
}

export function extractToken(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload._token || null;
}
