import crypto from 'crypto';
import { getDb } from '../database/db.js';
import { colomboDateString, nowIso } from '../lib/colomboTime.js';
import settingsService from './settingsService.js';

export const STALE_DAY_BLOCK_MESSAGE =
  "Yesterday's cash day is still open. Close & print Z, then open today before continuing.";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

export function isStaleOpenSession(session) {
  if (!session) return false;
  const openedAt = session.openedAt || session.opened_at;
  if (!openedAt) return false;
  return colomboDateString(openedAt) !== colomboDateString();
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    openingFloat: toNumber(row.opening_float),
    status: row.status,
    closingCountedCash: row.closing_counted_cash == null ? null : toNumber(row.closing_counted_cash),
    expectedCash: row.expected_cash == null ? null : toNumber(row.expected_cash),
    variance: row.variance == null ? null : toNumber(row.variance),
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    notes: row.notes,
    zReport: row.z_report_json ? JSON.parse(row.z_report_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSessionSnapshot(db, session) {
  const sessionId = session.id;
  const start = session.opened_at || session.openedAt;
  const end = session.closed_at || session.closedAt || nowIso();
  const openingFloat = toNumber(session.opening_float ?? session.openingFloat);

  const sales = db.prepare(`
    SELECT
      COUNT(*) AS sale_count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END), 0) AS void_count,
      COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_sales,
      COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'card' THEN total ELSE 0 END), 0) AS card_sales,
      COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'qr' THEN total ELSE 0 END), 0) AS qr_sales
    FROM sales
    WHERE deleted_at IS NULL
      AND (
        session_id = ?
        OR (session_id IS NULL AND sale_date >= ? AND sale_date <= ?)
      )
  `).get(sessionId, start, end);

  const returns = db.prepare(`
    SELECT
      COUNT(*) AS return_count,
      COALESCE(SUM(refund_total), 0) AS refund_total,
      COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN refund_total ELSE 0 END), 0) AS cash_refunds,
      COALESCE(SUM(CASE WHEN refund_method = 'card' THEN refund_total ELSE 0 END), 0) AS card_refunds,
      COALESCE(SUM(CASE WHEN refund_method = 'qr' THEN refund_total ELSE 0 END), 0) AS qr_refunds
    FROM sale_returns
    WHERE status = 'completed'
      AND (
        session_id = ?
        OR (session_id IS NULL AND created_at >= ? AND created_at <= ?)
      )
  `).get(sessionId, start, end);

  const expenses = db.prepare(`
    SELECT
      COUNT(*) AS expense_count,
      COALESCE(SUM(amount), 0) AS expense_total,
      COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0) AS cash_expenses
    FROM expenses
    WHERE deleted_at IS NULL
      AND (
        session_id = ?
        OR (session_id IS NULL AND created_at >= ? AND created_at <= ?)
      )
  `).get(sessionId, start, end);

  const cashSales = toNumber(sales.cash_sales);
  const cashRefunds = toNumber(returns.cash_refunds);
  const cashExpenses = toNumber(expenses.cash_expenses);
  const expectedCash = roundMoney(openingFloat + cashSales - cashRefunds - cashExpenses);

  return {
    sessionId,
    reportDate: colomboDateString(start),
    openedAt: start,
    closedAt: end,
    openingFloat,
    saleCount: toNumber(sales.sale_count),
    revenue: roundMoney(toNumber(sales.revenue)),
    voidCount: toNumber(sales.void_count),
    cashSales: roundMoney(cashSales),
    cardSales: roundMoney(toNumber(sales.card_sales)),
    qrSales: roundMoney(toNumber(sales.qr_sales)),
    returnCount: toNumber(returns.return_count),
    refundTotal: roundMoney(toNumber(returns.refund_total)),
    cashRefunds: roundMoney(cashRefunds),
    cardRefunds: roundMoney(toNumber(returns.card_refunds)),
    qrRefunds: roundMoney(toNumber(returns.qr_refunds)),
    expenseCount: toNumber(expenses.expense_count),
    expenseTotal: roundMoney(toNumber(expenses.expense_total)),
    cashExpenses: roundMoney(cashExpenses),
    expectedCash,
  };
}

const cashSessionService = {
  getOpenSession() {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1
    `).get();
    return mapSession(row);
  },

  requireOpenSession() {
    const session = this.getOpenSession();
    if (!session) {
      throw new Error('No open cash day. Open the day with float cash before continuing.');
    }
    return session;
  },

  /**
   * Require an open cash day. When staleDayPolicy is 'block' and the open
   * session started on a prior Colombo calendar day, refuse posting.
   */
  assertSessionAllowsPosting() {
    const session = this.requireOpenSession();
    if (!isStaleOpenSession(session)) return session;

    const policy = settingsService.get().staleDayPolicy;
    if (policy === 'block') {
      throw new Error(STALE_DAY_BLOCK_MESSAGE);
    }
    return session;
  },

  openDay({ userId, openingFloat = 0, notes = null } = {}) {
    const db = getDb();
    const existing = this.getOpenSession();
    if (existing) {
      throw new Error('A cash day is already open. Close it before opening a new day.');
    }

    const float = roundMoney(Math.max(0, toNumber(openingFloat, 0)));
    const id = crypto.randomUUID();
    const timestamp = nowIso();

    db.prepare(`
      INSERT INTO cash_sessions (
        id, opened_by, opened_at, opening_float, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(id, cleanText(userId), timestamp, float, notes ? cleanText(notes) : null, timestamp, timestamp);

    return this.getById(id);
  },

  getById(id) {
    const db = getDb();
    return mapSession(db.prepare(`SELECT * FROM cash_sessions WHERE id = ?`).get(cleanText(id)));
  },

  getXReport(sessionId = null) {
    const db = getDb();
    const session = sessionId ? this.getById(sessionId) : this.getOpenSession();
    if (!session) throw new Error('No open cash session.');
    return buildSessionSnapshot(db, session);
  },

  closeDay({ userId, countedCash, notes = null } = {}) {
    const db = getDb();
    const open = this.getOpenSession();
    if (!open) throw new Error('No open cash day to close.');

    const counted = roundMoney(toNumber(countedCash, 0));
    if (counted < 0) throw new Error('Counted cash cannot be negative.');

    const timestamp = nowIso();
    let zPayload = null;

    const run = db.transaction(() => {
      const row = db.prepare(`SELECT * FROM cash_sessions WHERE id = ?`).get(open.id);
      const snapshot = buildSessionSnapshot(db, { ...row, closed_at: timestamp });
      const variance = roundMoney(counted - snapshot.expectedCash);
      zPayload = {
        ...snapshot,
        countedCash: counted,
        variance,
        closedBy: cleanText(userId),
        closedAt: timestamp,
        notes: notes ? cleanText(notes) : null,
      };

      db.prepare(`
        UPDATE cash_sessions SET
          status = 'closed',
          closing_counted_cash = ?,
          expected_cash = ?,
          variance = ?,
          closed_by = ?,
          closed_at = ?,
          notes = COALESCE(?, notes),
          z_report_json = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        counted,
        snapshot.expectedCash,
        variance,
        cleanText(userId),
        timestamp,
        notes ? cleanText(notes) : null,
        JSON.stringify(zPayload),
        timestamp,
        open.id
      );

      const zId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO z_reports (id, session_id, report_date, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(zId, open.id, snapshot.reportDate, JSON.stringify(zPayload), timestamp);
    });

    run();
    return { session: this.getById(open.id), zReport: zPayload };
  },

  listRecent({ limit = 20 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 20), 1), 100);
    return db.prepare(`
      SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT ?
    `).all(take).map(mapSession);
  },

  getZReport(sessionId) {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM z_reports WHERE session_id = ?`).get(cleanText(sessionId));
    if (!row) {
      const session = this.getById(sessionId);
      return session?.zReport || null;
    }
    return JSON.parse(row.payload_json);
  },

  /** Helper for other services attaching sales to the open day */
  getOpenSessionIdOrNull() {
    return this.getOpenSession()?.id || null;
  },
};

export default cashSessionService;
