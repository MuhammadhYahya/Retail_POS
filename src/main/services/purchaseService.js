import crypto from 'crypto';
import { getDb } from '../database/db.js';
import productService from './productService.js';
import { nowIso } from '../lib/colomboTime.js';

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

function mapSupplier(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReceipt(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    grnNumber: row.grn_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || null,
    status: row.status,
    receivedAt: row.received_at,
    notes: row.notes,
    totalCost: toNumber(row.total_cost),
    createdBy: row.created_by,
    postedBy: row.posted_by,
    postedAt: row.posted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

function mapItem(row) {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    variantId: row.variant_id,
    productName: row.product_name || null,
    variantName: row.variant_name || null,
    barcode: row.barcode || null,
    sku: row.sku || null,
    quantity: toNumber(row.quantity),
    unitCost: toNumber(row.unit_cost),
    lineTotal: toNumber(row.line_total),
  };
}

function nextGrnNumber(db) {
  const day = nowIso().slice(0, 10).replace(/-/g, '');
  const count = db.prepare(`
    SELECT COUNT(*) AS c FROM purchase_receipts WHERE grn_number LIKE ?
  `).get(`GRN-${day}-%`).c;
  return `GRN-${day}-${String(count + 1).padStart(4, '0')}`;
}

const purchaseService = {
  listSuppliers() {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM suppliers WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name ASC
    `).all().map(mapSupplier);
  },

  createSupplier({ name, phone = null, address = null, notes = null } = {}) {
    const db = getDb();
    const cleanName = cleanText(name);
    if (!cleanName) throw new Error('Supplier name is required.');
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO suppliers (id, name, phone, address, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      cleanName,
      phone ? cleanText(phone) : null,
      address ? cleanText(address) : null,
      notes ? cleanText(notes) : null,
      timestamp,
      timestamp
    );
    return mapSupplier(db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id));
  },

  listReceipts({ limit = 50, status = null } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 50), 1), 200);
    const rows = status
      ? db.prepare(`
          SELECT pr.*, s.name AS supplier_name
          FROM purchase_receipts pr
          LEFT JOIN suppliers s ON s.id = pr.supplier_id
          WHERE pr.deleted_at IS NULL AND pr.status = ?
          ORDER BY pr.created_at DESC
          LIMIT ?
        `).all(cleanText(status), take)
      : db.prepare(`
          SELECT pr.*, s.name AS supplier_name
          FROM purchase_receipts pr
          LEFT JOIN suppliers s ON s.id = pr.supplier_id
          WHERE pr.deleted_at IS NULL
          ORDER BY pr.created_at DESC
          LIMIT ?
        `).all(take);
    return rows.map((row) => mapReceipt(row, this.getReceiptItems(row.id)));
  },

  getReceiptItems(receiptId) {
    const db = getDb();
    return db.prepare(`
      SELECT pri.*, p.name AS product_name, pv.name AS variant_name, pv.barcode, pv.sku
      FROM purchase_receipt_items pri
      JOIN product_variants pv ON pv.id = pri.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE pri.receipt_id = ?
      ORDER BY pri.created_at ASC
    `).all(cleanText(receiptId)).map(mapItem);
  },

  getReceipt(id) {
    const db = getDb();
    const row = db.prepare(`
      SELECT pr.*, s.name AS supplier_name
      FROM purchase_receipts pr
      LEFT JOIN suppliers s ON s.id = pr.supplier_id
      WHERE pr.id = ? AND pr.deleted_at IS NULL
    `).get(cleanText(id));
    if (!row) throw new Error('GRN not found.');
    return mapReceipt(row, this.getReceiptItems(row.id));
  },

  createReceipt({ supplierId = null, notes = null, items = [], createdBy } = {}) {
    const db = getDb();
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Add at least one line to the GRN.');
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const grnNumber = nextGrnNumber(db);

    const run = db.transaction(() => {
      let totalCost = 0;
      const prepared = items.map((item) => {
        const variantId = cleanText(item.variantId);
        const quantity = toNumber(item.quantity, 0);
        const unitCost = roundMoney(Math.max(0, toNumber(item.unitCost, 0)));
        if (!variantId) throw new Error('Each line needs a variant.');
        if (quantity <= 0) throw new Error('Quantity must be greater than zero.');
        const variant = db.prepare(`
          SELECT id FROM product_variants WHERE id = ? AND deleted_at IS NULL
        `).get(variantId);
        if (!variant) throw new Error('Variant not found.');
        const lineTotal = roundMoney(quantity * unitCost);
        totalCost = roundMoney(totalCost + lineTotal);
        return { variantId, quantity, unitCost, lineTotal };
      });

      db.prepare(`
        INSERT INTO purchase_receipts (
          id, grn_number, supplier_id, status, notes, total_cost, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)
      `).run(
        id,
        grnNumber,
        supplierId ? cleanText(supplierId) : null,
        notes ? cleanText(notes) : null,
        totalCost,
        cleanText(createdBy),
        timestamp,
        timestamp
      );

      const insertItem = db.prepare(`
        INSERT INTO purchase_receipt_items (
          id, receipt_id, variant_id, quantity, unit_cost, line_total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of prepared) {
        insertItem.run(
          crypto.randomUUID(),
          id,
          line.variantId,
          line.quantity,
          line.unitCost,
          line.lineTotal,
          timestamp
        );
      }
    });

    run();
    return this.getReceipt(id);
  },

  postReceipt({ receiptId, userId }) {
    const db = getDb();
    const receipt = this.getReceipt(receiptId);
    if (receipt.status === 'posted') throw new Error('GRN is already posted.');

    const timestamp = nowIso();
    const run = db.transaction(() => {
      for (const item of receipt.items) {
        productService.recordInventoryTransaction({
          variantId: item.variantId,
          quantity: item.quantity,
          transactionType: 'purchase',
          unitCost: item.unitCost,
          referenceType: 'grn',
          referenceId: receipt.id,
          notes: `GRN ${receipt.grnNumber}`,
          createdBy: userId,
        });

        // Update cost price on variant when receiving
        db.prepare(`
          UPDATE product_variants SET cost_price = ?, updated_at = ? WHERE id = ?
        `).run(item.unitCost, timestamp, item.variantId);
      }

      db.prepare(`
        UPDATE purchase_receipts SET
          status = 'posted',
          received_at = ?,
          posted_by = ?,
          posted_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(timestamp, cleanText(userId), timestamp, timestamp, receipt.id);
    });

    run();
    return this.getReceipt(receipt.id);
  },
};

export default purchaseService;
