import { getDb } from '../../database/db.js';

const backupHistoryService = {
  insert({ uuid, type, path, size, status, checksum, meta }) {
    const db = getDb();
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO backup_history (uuid, type, path, size, status, checksum, created_at, verified_at, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid,
      type,
      path,
      size ?? null,
      status,
      checksum ?? null,
      createdAt,
      status === 'verified' ? createdAt : null,
      meta ? JSON.stringify(meta) : null
    );
    return this.getByUuid(uuid);
  },

  updateStatus(uuid, status, extra = {}) {
    const db = getDb();
    const verifiedAt = status === 'verified' ? new Date().toISOString() : null;
    db.prepare(`
      UPDATE backup_history
      SET status = ?,
          verified_at = COALESCE(?, verified_at),
          checksum = COALESCE(?, checksum),
          size = COALESCE(?, size),
          meta_json = COALESCE(?, meta_json)
      WHERE uuid = ?
    `).run(
      status,
      verifiedAt,
      extra.checksum ?? null,
      extra.size ?? null,
      extra.meta ? JSON.stringify(extra.meta) : null,
      uuid
    );
    return this.getByUuid(uuid);
  },

  getByUuid(uuid) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM backup_history WHERE uuid = ?').get(uuid);
    return row ? mapRow(row) : null;
  },

  list({ limit = 100 } = {}) {
    const db = getDb();
    return db
      .prepare(`
        SELECT * FROM backup_history
        WHERE status != 'deleted'
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit)
      .map(mapRow);
  },

  softDelete(uuid) {
    const db = getDb();
    db.prepare(`UPDATE backup_history SET status = 'deleted' WHERE uuid = ?`).run(uuid);
  },

  listAutomatic(locationPrefix = null) {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT * FROM backup_history
        WHERE type = 'automatic' AND status = 'verified'
        ORDER BY created_at DESC
      `)
      .all()
      .map(mapRow);
    if (!locationPrefix) return rows;
    return rows.filter((r) => String(r.path || '').startsWith(locationPrefix));
  },
};

function mapRow(row) {
  let meta = null;
  try {
    meta = row.meta_json ? JSON.parse(row.meta_json) : null;
  } catch {
    meta = null;
  }
  return {
    id: row.id,
    uuid: row.uuid,
    type: row.type,
    path: row.path,
    size: row.size,
    status: row.status,
    checksum: row.checksum,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    meta,
  };
}

export default backupHistoryService;
