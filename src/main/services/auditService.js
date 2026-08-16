import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDir, getDb } from '../database/db.js';
import { AUDIT_FAILURE_WARNING } from '../../shared/auditEvents.js';

function now() { return new Date().toISOString(); }

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

function failureFilePath() {
  return path.join(getDataDir(), 'audit_log_failures.ndjson');
}

function normalizeEvent(event = {}) {
  return {
    eventId: String(event.eventId || crypto.randomUUID()),
    action: String(event.action || 'unknown'),
    entityType: event.entityType ? String(event.entityType) : null,
    entityId: event.entityId ? String(event.entityId) : null,
    referenceNumber: event.referenceNumber ? String(event.referenceNumber) : null,
    amount: event.amount == null ? null : Number(event.amount),
    actorUserId: event.actorUserId ? String(event.actorUserId) : null,
    actorDisplayName: event.actorDisplayName ? String(event.actorDisplayName) : null,
    createdAt: event.createdAt || now(),
    details: event.details || {},
  };
}

function insertAudit(db, event) {
  db.prepare(`
    INSERT INTO audit_log (
      event_id, user_id, action, entity_type, entity_id, reference_number,
      amount, created_at, details
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_log WHERE event_id = ?
    )
  `).run(
    event.eventId,
    event.actorUserId,
    event.action,
    event.entityType,
    event.entityId,
    event.referenceNumber,
    Number.isFinite(event.amount) ? event.amount : null,
    event.createdAt,
    safeJson(event.details),
    event.eventId
  );
}

function failurePayload(event, reason, source = 'database') {
  return {
    eventId: event.eventId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    referenceNumber: event.referenceNumber,
    amount: event.amount,
    actorUserId: event.actorUserId,
    actorDisplayName: event.actorDisplayName,
    eventCreatedAt: event.createdAt,
    details: event.details,
    failureReason: String(reason || 'Unknown audit logging failure'),
    source,
    status: 'pending',
    createdAt: now(),
  };
}

function saveFailure(db, failure) {
  db.prepare(`
    INSERT INTO audit_log_failures (
      event_id, action, entity_type, entity_id, reference_number, amount,
      actor_user_id, actor_display_name, event_created_at, details,
      failure_reason, source, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(event_id) DO UPDATE SET
      failure_reason = excluded.failure_reason,
      details = excluded.details,
      source = excluded.source
  `).run(
    failure.eventId,
    failure.action,
    failure.entityType,
    failure.entityId,
    failure.referenceNumber,
    Number.isFinite(failure.amount) ? failure.amount : null,
    failure.actorUserId,
    failure.actorDisplayName,
    failure.eventCreatedAt,
    safeJson(failure.details),
    failure.failureReason,
    failure.source,
    failure.createdAt
  );
}

function appendFileFailure(failure) {
  const filePath = failureFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(failure)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs apply separately. */ }
  return filePath;
}

const auditService = {
  write(eventInput) {
    const event = normalizeEvent(eventInput);
    try {
      insertAudit(getDb(), event);
      return { success: true, eventId: event.eventId };
    } catch (auditError) {
      const failure = failurePayload(event, auditError.message);
      try {
        saveFailure(getDb(), failure);
      } catch (failureDbError) {
        failure.failureReason = `${failure.failureReason}; fallback database failed: ${failureDbError.message}`;
        failure.source = 'filesystem';
        try {
          appendFileFailure(failure);
        } catch (fileError) {
          failure.failureReason = `${failure.failureReason}; filesystem fallback failed: ${fileError.message}`;
        }
      }
      return {
        success: false,
        eventId: event.eventId,
        warning: AUDIT_FAILURE_WARNING,
        failure,
      };
    }
  },

  list({ action = '', query = '', from = '', to = '', limit = 200 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const clauses = [];
    const args = [];
    if (action) { clauses.push('a.action = ?'); args.push(action); }
    if (query) {
      clauses.push('(a.reference_number LIKE ? OR a.entity_id LIKE ? OR a.details LIKE ?)');
      const q = `%${query}%`; args.push(q, q, q);
    }
    if (from) { clauses.push('a.created_at >= ?'); args.push(`${from}T00:00:00.000Z`); }
    if (to) { clauses.push('a.created_at <= ?'); args.push(`${to}T23:59:59.999Z`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
      SELECT a.*, u.username, u.display_name
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ${where} ORDER BY a.created_at DESC LIMIT ?
    `).all(...args, take);
  },

  listVoidedSales(filters = {}) {
    const db = getDb();
    const clauses = ['s.status = \'voided\'', 's.deleted_at IS NULL'];
    const args = [];
    if (filters.query) {
      clauses.push('(s.invoice_number LIKE ? OR s.void_reason LIKE ? OR cu.display_name LIKE ? OR cu.username LIKE ? OR vu.display_name LIKE ? OR vu.username LIKE ?)');
      const q = `%${filters.query}%`; args.push(q, q, q, q, q, q);
    }
    if (filters.from) { clauses.push('s.voided_at >= ?'); args.push(`${filters.from}T00:00:00.000Z`); }
    if (filters.to) { clauses.push('s.voided_at <= ?'); args.push(`${filters.to}T23:59:59.999Z`); }
    if (filters.minAmount !== '' && filters.minAmount != null) { clauses.push('s.total >= ?'); args.push(Number(filters.minAmount)); }
    if (filters.maxAmount !== '' && filters.maxAmount != null) { clauses.push('s.total <= ?'); args.push(Number(filters.maxAmount)); }
    const take = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
    return db.prepare(`
      SELECT s.id, s.invoice_number, s.total, s.payment_method, s.status,
        s.void_reason, s.voided_at, cu.display_name AS cashier_name,
        vu.display_name AS voided_by_name, vu.username AS voided_by_username
      FROM sales s
      LEFT JOIN users cu ON cu.id = s.cashier_id
      LEFT JOIN users vu ON vu.id = s.voided_by
      WHERE ${clauses.join(' AND ')}
      ORDER BY s.voided_at DESC LIMIT ?
    `).all(...args, take);
  },

  listFailures({ status = 'pending', limit = 200 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const rows = db.prepare(`SELECT * FROM audit_log_failures WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(status, take);
    if (status !== 'pending') return rows;
    try {
      const filePath = failureFilePath();
      if (fs.existsSync(filePath)) {
        const dbEventIds = new Set(rows.map((row) => row.event_id));
        const fileRows = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
        for (const row of fileRows) {
          if (!dbEventIds.has(row.eventId)) {
            rows.push({
              id: `file:${row.eventId}`,
              event_id: row.eventId,
              action: row.action,
              entity_type: row.entityType,
              entity_id: row.entityId,
              reference_number: row.referenceNumber,
              amount: row.amount,
              actor_user_id: row.actorUserId,
              actor_display_name: row.actorDisplayName,
              event_created_at: row.eventCreatedAt,
              details: safeJson(row.details),
              failure_reason: row.failureReason,
              source: 'filesystem',
              status: 'pending',
              created_at: row.createdAt,
            });
          }
        }
      }
    } catch { /* summary and admin page remain available if the file is malformed */ }
    return rows.slice(0, take);
  },

  failureSummary() {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) AS pending FROM audit_log_failures WHERE status = 'pending'`).get();
    let filePending = 0;
    try {
      filePending = fs.existsSync(failureFilePath())
        ? fs.readFileSync(failureFilePath(), 'utf8').split('\n').filter(Boolean).length
        : 0;
    } catch { filePending = 0; }
    return { pendingDatabase: Number(row?.pending || 0), pendingFilesystem: filePending, pendingTotal: Number(row?.pending || 0) + filePending };
  },

  retryFailures() {
    const db = getDb();
    let recovered = 0;
    const rows = db.prepare(`SELECT * FROM audit_log_failures WHERE status = 'pending' ORDER BY id ASC`).all();
    for (const row of rows) {
      try {
        insertAudit(db, {
          eventId: row.event_id, actorUserId: row.actor_user_id, action: row.action,
          entityType: row.entity_type, entityId: row.entity_id, referenceNumber: row.reference_number,
          amount: row.amount, createdAt: row.event_created_at, details: JSON.parse(row.details || '{}'),
        });
        db.prepare(`UPDATE audit_log_failures SET status = 'recovered', recovered_at = ? WHERE id = ?`).run(now(), row.id);
        recovered += 1;
      } catch { /* remain pending for the next administrator retry */ }
    }
    const filePath = failureFilePath();
    if (fs.existsSync(filePath)) {
      const remaining = [];
      for (const line of fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          insertAudit(db, event);
          recovered += 1;
        } catch { remaining.push(line); }
      }
      if (remaining.length) fs.writeFileSync(filePath, `${remaining.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
      else fs.rmSync(filePath, { force: true });
    }
    return { recovered, summary: this.failureSummary() };
  },
};

export default auditService;
