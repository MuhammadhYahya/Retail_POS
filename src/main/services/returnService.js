import crypto from 'crypto';
import { getDb } from '../database/db.js';
import productService from './productService.js';
import cashSessionService from './cashSessionService.js';
import { colomboDayCompact, nowIso } from '../lib/colomboTime.js';

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

function nextReturnNumber(db) {
  const day = colomboDayCompact();
  const count = db.prepare(`
    SELECT COUNT(*) AS c FROM sale_returns WHERE return_number LIKE ?
  `).get(`RET-${day}-%`).c;
  return `RET-${day}-${String(count + 1).padStart(4, '0')}`;
}

function alreadyReturnedQty(db, saleItemId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(sri.quantity), 0) AS qty
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sri.sale_item_id = ? AND sr.status = 'completed'
  `).get(saleItemId);
  return toNumber(row?.qty);
}

const returnService = {
  createReturn({
    saleId,
    items = [],
    reason = null,
    refundMethod = 'cash',
    userId,
  } = {}) {
    const db = getDb();
    const session = cashSessionService.requireOpenSession();
    const id = cleanText(saleId);
    if (!id) throw new Error('Sale ID is required.');
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Select at least one item to return.');
    }

    const method = cleanText(refundMethod).toLowerCase() || 'cash';
    if (!['cash', 'card', 'qr'].includes(method)) {
      throw new Error('Unsupported refund method.');
    }

    const sale = db.prepare(`
      SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL
    `).get(id);
    if (!sale) throw new Error('Sale not found.');
    if (sale.status !== 'completed') throw new Error('Only completed sales can be returned.');

    const saleItems = db.prepare(`
      SELECT * FROM sale_items WHERE sale_id = ?
    `).all(id);

    const byId = new Map(saleItems.map((row) => [row.id, row]));
    const timestamp = nowIso();
    const returnId = crypto.randomUUID();
    const returnNumber = nextReturnNumber(db);

    let refundTotal = 0;
    const prepared = items.map((item) => {
      const saleItemId = cleanText(item.saleItemId);
      const qty = toNumber(item.quantity, 0);
      const saleItem = byId.get(saleItemId);
      if (!saleItem) throw new Error('Invalid sale line for return.');
      if (qty <= 0) throw new Error('Return quantity must be greater than zero.');
      const already = alreadyReturnedQty(db, saleItemId);
      const remaining = toNumber(saleItem.quantity) - already;
      if (qty > remaining + 0.0001) {
        throw new Error(`Cannot return more than remaining qty for ${saleItem.product_name}.`);
      }
      const unitRefund = roundMoney(toNumber(saleItem.line_total) / toNumber(saleItem.quantity));
      const lineRefund = roundMoney(unitRefund * qty);
      refundTotal = roundMoney(refundTotal + lineRefund);
      return {
        saleItemId,
        variantId: saleItem.variant_id,
        quantity: qty,
        unitRefund,
        lineRefund,
      };
    });

    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO sale_returns (
          id, return_number, sale_id, session_id, refund_total, refund_method,
          reason, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `).run(
        returnId,
        returnNumber,
        id,
        session.id,
        refundTotal,
        method,
        reason ? cleanText(reason) : null,
        cleanText(userId),
        timestamp,
        timestamp
      );

      const insertItem = db.prepare(`
        INSERT INTO sale_return_items (
          id, return_id, sale_item_id, variant_id, quantity, unit_refund, line_refund, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of prepared) {
        insertItem.run(
          crypto.randomUUID(),
          returnId,
          line.saleItemId,
          line.variantId,
          line.quantity,
          line.unitRefund,
          line.lineRefund,
          timestamp
        );

        productService.recordInventoryTransaction({
          variantId: line.variantId,
          quantity: line.quantity,
          transactionType: 'return_in',
          referenceType: 'sale_return',
          referenceId: returnId,
          notes: `Return ${returnNumber}`,
          createdBy: userId,
        });
      }
    });

    run();
    return this.getById(returnId);
  },

  getById(id) {
    const db = getDb();
    const row = db.prepare(`
      SELECT sr.*, s.invoice_number
      FROM sale_returns sr
      JOIN sales s ON s.id = sr.sale_id
      WHERE sr.id = ?
    `).get(cleanText(id));
    if (!row) throw new Error('Return not found.');
    const items = db.prepare(`
      SELECT sri.*, si.product_name, si.variant_name
      FROM sale_return_items sri
      JOIN sale_items si ON si.id = sri.sale_item_id
      WHERE sri.return_id = ?
    `).all(row.id);
    return {
      id: row.id,
      returnNumber: row.return_number,
      saleId: row.sale_id,
      invoiceNumber: row.invoice_number,
      sessionId: row.session_id,
      refundTotal: toNumber(row.refund_total),
      refundMethod: row.refund_method,
      reason: row.reason,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      items: items.map((item) => ({
        id: item.id,
        saleItemId: item.sale_item_id,
        variantId: item.variant_id,
        productName: item.product_name,
        variantName: item.variant_name,
        quantity: toNumber(item.quantity),
        unitRefund: toNumber(item.unit_refund),
        lineRefund: toNumber(item.line_refund),
      })),
    };
  },

  listRecent({ limit = 50 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 50), 1), 200);
    return db.prepare(`
      SELECT sr.*, s.invoice_number
      FROM sale_returns sr
      JOIN sales s ON s.id = sr.sale_id
      ORDER BY sr.created_at DESC
      LIMIT ?
    `).all(take).map((row) => ({
      id: row.id,
      returnNumber: row.return_number,
      saleId: row.sale_id,
      invoiceNumber: row.invoice_number,
      refundTotal: toNumber(row.refund_total),
      refundMethod: row.refund_method,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  },

  getReturnableForSale(saleId) {
    const db = getDb();
    const sale = db.prepare(`
      SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL
    `).get(cleanText(saleId));
    if (!sale) throw new Error('Sale not found.');
    if (sale.status !== 'completed') {
      return { saleId: sale.id, invoiceNumber: sale.invoice_number, items: [] };
    }
    const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(sale.id);
    return {
      saleId: sale.id,
      invoiceNumber: sale.invoice_number,
      total: toNumber(sale.total),
      items: items.map((item) => {
        const returned = alreadyReturnedQty(db, item.id);
        const remaining = Math.max(0, toNumber(item.quantity) - returned);
        return {
          saleItemId: item.id,
          variantId: item.variant_id,
          productName: item.product_name,
          variantName: item.variant_name,
          soldQty: toNumber(item.quantity),
          returnedQty: returned,
          remainingQty: remaining,
          unitPrice: toNumber(item.unit_price),
          lineTotal: toNumber(item.line_total),
        };
      }).filter((item) => item.remainingQty > 0),
    };
  },
};

export default returnService;
