import { getDb } from '../database/db.js';

export function writeAuditLog(action, userId = null) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (user_id, action, created_at)
      VALUES (?, ?, ?)
    `).run(userId, action, new Date().toISOString());
  } catch (err) {
    console.error('[auditLog] Failed to write:', err.message);
  }
}
