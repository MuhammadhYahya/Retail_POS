import crypto from 'crypto';
import { getDb } from '../database/db.js';
import { nowIso } from '../lib/colomboTime.js';
import { applyInventoryMovement } from './inventoryCostService.js';

function text(value) { return String(value ?? '').trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function money(value) { return Math.round((num(value) + Number.EPSILON) * 100) / 100; }

function nextNumber(db) {
  const day = nowIso().slice(0, 10).replace(/-/g, '');
  const count = db.prepare(`SELECT COUNT(*) AS c FROM purchase_returns WHERE return_number LIKE ?`).get(`PR-${day}-%`).c;
  return `PR-${day}-${String(count + 1).padStart(4, '0')}`;
}

function map(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    returnNumber: row.return_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || null,
    returnDate: row.return_date,
    reason: row.reason,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    items,
  };
}

const purchaseReturnService = {
  listReturnableReceipts({ limit = 100 } = {}) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pr.*, s.name AS supplier_name
      FROM purchase_receipts pr
      LEFT JOIN suppliers s ON s.id = pr.supplier_id
      WHERE pr.status = 'posted' AND pr.deleted_at IS NULL
      ORDER BY COALESCE(pr.posted_at, pr.created_at) DESC LIMIT ?
    `).all(Math.min(Math.max(num(limit, 100), 1), 500));
    return rows.map((receipt) => ({
      ...map(receipt),
      items: db.prepare(`
        SELECT pri.id, pri.receipt_id AS receiptId, pri.variant_id AS variantId,
          pri.quantity AS receivedQuantity, pri.unit_cost AS originalUnitCost,
          p.name AS productName, pv.name AS variantName, pv.sku,
          COALESCE((SELECT SUM(pri2.quantity) FROM purchase_return_items pri2
            WHERE pri2.receipt_item_id = pri.id), 0) AS returnedQuantity,
          COALESCE(b.on_hand, 0) AS onHand
        FROM purchase_receipt_items pri
        JOIN product_variants pv ON pv.id = pri.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN inventory_balances b ON b.variant_id = pri.variant_id
        WHERE pri.receipt_id = ?
        ORDER BY pri.created_at ASC
      `).all(receipt.id).map((item) => ({
        ...item,
        receivedQuantity: num(item.receivedQuantity),
        returnedQuantity: num(item.returnedQuantity),
        remainingQuantity: Math.max(0, num(item.receivedQuantity) - num(item.returnedQuantity)),
        onHand: num(item.onHand),
        originalUnitCost: num(item.originalUnitCost),
      })).filter((item) => item.remainingQuantity > 0),
    })).filter((receipt) => receipt.items.length > 0);
  },

  list({ limit = 50 } = {}) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pr.*, s.name AS supplier_name FROM purchase_returns pr
      LEFT JOIN suppliers s ON s.id = pr.supplier_id
      ORDER BY pr.created_at DESC LIMIT ?
    `).all(Math.min(Math.max(num(limit, 50), 1), 200));
    return rows.map((row) => map(row, db.prepare(`
      SELECT pri.*, p.name AS product_name, pv.name AS variant_name, pv.sku
      FROM purchase_return_items pri
      JOIN product_variants pv ON pv.id = pri.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE pri.return_id = ? ORDER BY pri.created_at ASC
    `).all(row.id).map((item) => ({
      id: item.id, receiptId: item.receipt_id, receiptItemId: item.receipt_item_id,
      variantId: item.variant_id, productName: item.product_name, variantName: item.variant_name,
      sku: item.sku, quantity: num(item.quantity), originalUnitCost: num(item.original_unit_cost),
      valuationUnitCost: num(item.valuation_unit_cost), lineTotal: num(item.line_total),
    }))));
  },

  create({ supplierId = null, returnDate = null, reason = null, notes = null, items = [], userId } = {}) {
    const db = getDb();
    if (!Array.isArray(items) || !items.length) throw new Error('Select at least one GRN item to return.');
    const id = crypto.randomUUID();
    const returnNumber = nextNumber(db);
    const timestamp = nowIso();
    const run = db.transaction(() => {
      const prepared = items.map((input) => {
        const receiptItemId = text(input.receiptItemId);
        const quantity = num(input.quantity);
        const row = db.prepare(`
          SELECT pri.*, pr.status AS receipt_status, pr.supplier_id
          FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          WHERE pri.id = ? AND pr.status = 'posted' AND pr.deleted_at IS NULL
        `).get(receiptItemId);
        if (!row) throw new Error('Posted GRN item not found.');
        if (quantity <= 0) throw new Error('Return quantity must be greater than zero.');
        const returned = num(db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS q FROM purchase_return_items WHERE receipt_item_id = ?`).get(receiptItemId).q);
        if (quantity > num(row.quantity) - returned + 0.0001) throw new Error('Return quantity exceeds the remaining GRN quantity.');
        const balance = num(db.prepare(`SELECT on_hand FROM inventory_balances WHERE variant_id = ?`).get(row.variant_id)?.on_hand);
        if (quantity > balance + 0.0001) throw new Error('Return quantity exceeds current stock.');
        const costing = db.prepare(`SELECT average_cost FROM inventory_costing WHERE variant_id = ?`).get(row.variant_id);
        return { ...row, quantity, returned, valuationUnitCost: num(costing?.average_cost ?? row.unit_cost), lineTotal: money(quantity * num(row.unit_cost)) };
      });
      const resolvedSupplier = supplierId || prepared[0].supplier_id || null;
      db.prepare(`
        INSERT INTO purchase_returns
          (id, return_number, supplier_id, return_date, reason, notes, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `).run(id, returnNumber, resolvedSupplier, returnDate || timestamp.slice(0, 10), reason ? text(reason) : null, notes ? text(notes) : null, text(userId), timestamp, timestamp);
      const insert = db.prepare(`
        INSERT INTO purchase_return_items
          (id, return_id, receipt_id, receipt_item_id, variant_id, quantity, original_unit_cost, valuation_unit_cost, line_total, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of prepared) {
        insert.run(crypto.randomUUID(), id, item.receipt_id, item.id, item.variant_id, item.quantity, item.unit_cost, item.valuationUnitCost, item.lineTotal, timestamp);
        applyInventoryMovement(db, {
          variantId: item.variant_id,
          quantity: item.quantity,
          transactionType: 'purchase_return',
          valuationUnitCost: item.valuationUnitCost,
          referenceType: 'purchase_return',
          referenceId: id,
          notes: `Purchase return ${returnNumber}`,
          createdBy: userId,
          timestamp,
        });
      }
    });
    run();
    return this.list({ limit: 200 }).find((row) => row.id === id) || { id, returnNumber };
  },
};

export default purchaseReturnService;
