import crypto from 'crypto';
import { getDb } from '../database/db.js';
import cashSessionService from './cashSessionService.js';
import { colomboDateString, nowIso } from '../lib/colomboTime.js';

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

function mapExpense(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    expenseDate: row.expense_date,
    category: row.category,
    amount: toNumber(row.amount),
    paymentMethod: row.payment_method,
    note: row.note,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

const EXPENSE_CATEGORIES = [
  'Petty cash',
  'Transport',
  'Utilities',
  'Packaging',
  'Maintenance',
  'Staff meals',
  'Other',
];

const expenseService = {
  categories() {
    return [...EXPENSE_CATEGORIES];
  },

  create({
    category,
    amount,
    paymentMethod = 'cash',
    note = null,
    userId,
    expenseDate = null,
  } = {}) {
    const session = cashSessionService.requireOpenSession();
    const cleanCategory = cleanText(category) || 'Other';
    const value = roundMoney(toNumber(amount, 0));
    if (value <= 0) throw new Error('Expense amount must be greater than zero.');

    const method = cleanText(paymentMethod).toLowerCase() || 'cash';
    if (!['cash', 'card', 'qr'].includes(method)) {
      throw new Error('Unsupported payment method.');
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const date = expenseDate ? String(expenseDate).slice(0, 10) : colomboDateString();

    db.prepare(`
      INSERT INTO expenses (
        id, session_id, expense_date, category, amount, payment_method, note,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      session.id,
      date,
      cleanCategory,
      value,
      method,
      note ? cleanText(note) : null,
      cleanText(userId),
      timestamp,
      timestamp
    );

    return this.getById(id);
  },

  getById(id) {
    const db = getDb();
    const row = db.prepare(`
      SELECT e.*, u.display_name AS created_by_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = ? AND e.deleted_at IS NULL
    `).get(cleanText(id));
    if (!row) throw new Error('Expense not found.');
    return mapExpense(row);
  },

  list({ limit = 100, sessionId = null } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 100), 1), 500);
    const rows = sessionId
      ? db.prepare(`
          SELECT e.*, u.display_name AS created_by_name
          FROM expenses e
          LEFT JOIN users u ON u.id = e.created_by
          WHERE e.deleted_at IS NULL AND e.session_id = ?
          ORDER BY e.created_at DESC
          LIMIT ?
        `).all(cleanText(sessionId), take)
      : db.prepare(`
          SELECT e.*, u.display_name AS created_by_name
          FROM expenses e
          LEFT JOIN users u ON u.id = e.created_by
          WHERE e.deleted_at IS NULL
          ORDER BY e.created_at DESC
          LIMIT ?
        `).all(take);
    return rows.map(mapExpense);
  },

  softDelete({ expenseId, userId }) {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL
    `).get(cleanText(expenseId));
    if (!row) throw new Error('Expense not found.');
    db.prepare(`
      UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?
    `).run(nowIso(), nowIso(), row.id);
    return { id: row.id, deleted: true, deletedBy: userId };
  },
};

export default expenseService;
