import { getDb } from '../database/db.js';

export function writeAuditLog(action, userId = null, details = null) {
  try {
    const db = getDb();
    const hasDetails = db
      .prepare(`PRAGMA table_info(audit_log)`)
      .all()
      .some((c) => c.name === 'details');

    if (hasDetails) {
      db.prepare(`
        INSERT INTO audit_log (user_id, action, created_at, details)
        VALUES (?, ?, ?, ?)
      `).run(userId, action, new Date().toISOString(), details != null ? String(details) : null);
    } else {
      db.prepare(`
        INSERT INTO audit_log (user_id, action, created_at)
        VALUES (?, ?, ?)
      `).run(userId, action, new Date().toISOString());
    }
  } catch (err) {
    console.error('[auditLog] Failed to write:', err.message);
  }
}
