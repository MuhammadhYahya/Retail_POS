import crypto from 'crypto';
import { getDb } from '../database/db.js';
import productService from './productService.js';
import { nowIso } from '../lib/colomboTime.js';
import { applyInventoryMovement } from './inventoryCostService.js';

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

function normalizePriceType(value) {
  return String(value ?? '').trim().toUpperCase() === 'MRP' ? 'MRP' : 'FREE';
}

function normalizeSaleStatus(value) {
  const status = cleanText(value).toLowerCase();
  if (status === 'discounted') return 'discounted';
  if (status === 'removed') return 'removed';
  return 'active';
}

function dayDiff(dateA, dateB) {
  const a = new Date(`${String(dateA).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${String(dateB).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function isValidDateOnly(value) {
  const text = cleanText(value);
  if (!text) return false;
  return Number.isFinite(new Date(`${text.slice(0, 10)}T00:00:00Z`).getTime());
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((row) => row.name === columnName);
}

function ensurePurchaseReceiptItemColumns(db) {
  const columns = [
    ['batch_number', 'TEXT'],
    ['expiry_date', 'TEXT'],
    ['received_mrp', 'REAL'],
    ['sale_status', "TEXT NOT NULL DEFAULT 'active'"],
  ];

  for (const [column, definition] of columns) {
    if (!hasColumn(db, 'purchase_receipt_items', column)) {
      db.exec(`ALTER TABLE purchase_receipt_items ADD COLUMN ${column} ${definition}`);
    }
  }
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
    invoiceNumber: row.invoice_number || null,
    invoiceDate: row.invoice_date || null,
    receivedDate: row.received_date || null,
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
    batchNumber: row.batch_number || null,
    expiryDate: row.expiry_date || null,
    receivedMrp: row.received_mrp == null ? null : toNumber(row.received_mrp),
    saleStatus: normalizeSaleStatus(row.sale_status),
    hasExpiry: Boolean(row.has_expiry),
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

  updateSupplier({ id, name, phone = null, address = null, notes = null } = {}) {
    const db = getDb();
    const supplierId = cleanText(id);
    const cleanName = cleanText(name);
    if (!supplierId) throw new Error('Supplier is required.');
    if (!cleanName) throw new Error('Supplier name is required.');
    const timestamp = nowIso();
    const result = db.prepare(`
      UPDATE suppliers
      SET name = ?, phone = ?, address = ?, notes = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(
      cleanName,
      phone ? cleanText(phone) : null,
      address ? cleanText(address) : null,
      notes ? cleanText(notes) : null,
      timestamp,
      supplierId
    );
    if (!result.changes) throw new Error('Supplier not found.');
    return mapSupplier(db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplierId));
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
      SELECT pri.*, p.name AS product_name, pv.name AS variant_name, pv.barcode, pv.sku, p.has_expiry
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

  createReceipt({ supplierId = null, invoiceNumber = null, invoiceDate = null, receivedDate = null, notes = null, items = [], createdBy } = {}) {
    const db = getDb();
    ensurePurchaseReceiptItemColumns(db);
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Add at least one line to the GRN.');
    }
    const cleanSupplierId = cleanText(supplierId);
    const cleanInvoiceNumber = cleanText(invoiceNumber);
    const cleanInvoiceDate = cleanText(invoiceDate);
    const cleanReceivedDate = cleanText(receivedDate);
    if (!cleanSupplierId) throw new Error('Supplier is required.');
    if (!cleanInvoiceNumber) throw new Error('Invoice number is required.');
    if (!cleanInvoiceDate) throw new Error('Invoice date is required.');
    if (!isValidDateOnly(cleanInvoiceDate)) throw new Error('Invoice date must be a valid date.');
    if (cleanReceivedDate && !isValidDateOnly(cleanReceivedDate)) throw new Error('Received date must be a valid date.');
    const today = nowIso().slice(0, 10);
    if (dayDiff(cleanInvoiceDate, today) > 0) throw new Error('Invoice date cannot be in the future.');
    if (cleanReceivedDate && dayDiff(cleanReceivedDate, today) > 0) throw new Error('Received date cannot be in the future.');

    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const grnNumber = nextGrnNumber(db);

    const run = db.transaction(() => {
      let totalCost = 0;
      const prepared = items.map((item) => {
        const variantId = cleanText(item.variantId);
        const quantity = toNumber(item.quantity, 0);
        const unitCost = roundMoney(Math.max(0, toNumber(item.unitCost, 0)));
        const batchNumber = cleanText(item.batchNumber) || null;
        const expiryDate = cleanText(item.expiryDate) || null;
        const receivedMrp = item.receivedMrp == null || item.receivedMrp === ''
          ? null
          : roundMoney(Math.max(0, toNumber(item.receivedMrp, 0)));
        if (!variantId) throw new Error('Each line needs a variant.');
        if (quantity <= 0) throw new Error('Quantity must be greater than zero.');
        const variant = db.prepare(`
          SELECT pv.id, pv.name AS variant_name, p.name AS product_name, p.has_expiry
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ? AND pv.deleted_at IS NULL AND p.deleted_at IS NULL
        `).get(variantId);
        if (!variant) throw new Error('Variant not found.');
        if (variant.has_expiry && !expiryDate) {
          throw new Error(`Expiry date is required for ${variant.product_name} - ${variant.variant_name}.`);
        }
        if (variant.has_expiry && expiryDate && !isValidDateOnly(expiryDate)) {
          throw new Error(`Expiry date must be a valid date for ${variant.product_name} - ${variant.variant_name}.`);
        }
        if (variant.has_expiry && expiryDate && dayDiff(expiryDate, cleanReceivedDate || timestamp.slice(0, 10)) < 0) {
          throw new Error(`Expiry date cannot be earlier than the received date for ${variant.product_name} - ${variant.variant_name}.`);
        }
        if (normalizePriceType(item.priceType) === 'MRP') {
          if (receivedMrp == null || receivedMrp <= 0) {
            throw new Error(`MRP is required for ${variant.product_name} - ${variant.variant_name}.`);
          }
        }
        const lineTotal = roundMoney(quantity * unitCost);
        totalCost = roundMoney(totalCost + lineTotal);
        return { variantId, quantity, unitCost, lineTotal, batchNumber, expiryDate, receivedMrp, saleStatus: 'active' };
      });

      db.prepare(`
        INSERT INTO purchase_receipts (
          id, grn_number, supplier_id, status, invoice_number, invoice_date, received_date,
          notes, total_cost, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        grnNumber,
        cleanSupplierId,
        cleanInvoiceNumber,
        cleanInvoiceDate,
        cleanReceivedDate || null,
        notes ? cleanText(notes) : null,
        totalCost,
        cleanText(createdBy),
        timestamp,
        timestamp
      );

      const insertItem = db.prepare(`
        INSERT INTO purchase_receipt_items (
          id, receipt_id, variant_id, quantity, unit_cost, line_total, batch_number, expiry_date, received_mrp, sale_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of prepared) {
        insertItem.run(
          crypto.randomUUID(),
          id,
          line.variantId,
          line.quantity,
          line.unitCost,
          line.lineTotal,
          line.batchNumber,
          line.expiryDate,
          line.receivedMrp,
          line.saleStatus,
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
        applyInventoryMovement(db, {
          variantId: item.variantId,
          quantity: item.quantity,
          transactionType: 'purchase',
          unitCost: item.unitCost,
          referenceType: 'grn',
          referenceId: receipt.id,
          notes: `GRN ${receipt.grnNumber}`,
          createdBy: userId,
        });

        if (item.receivedMrp != null) {
          db.prepare(`
            UPDATE product_variants
            SET selling_price = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
          `).run(item.receivedMrp, timestamp, item.variantId);
        }

      }

      db.prepare(`
        UPDATE purchase_receipts SET
          status = 'posted',
          received_at = ?,
          received_date = COALESCE(received_date, ?),
          posted_by = ?,
          posted_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(timestamp, receipt.receivedDate || timestamp.slice(0, 10), cleanText(userId), timestamp, timestamp, receipt.id);
    });

    run();
    return this.getReceipt(receipt.id);
  },

  listExpiryAlerts({ limit = 200 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 200), 1), 500);
    const today = nowIso().slice(0, 10);
    const rows = db.prepare(`
      SELECT
        pri.id,
        pri.receipt_id,
        pri.variant_id,
        pri.quantity,
        pri.unit_cost,
        pri.line_total,
        pri.batch_number,
        pri.expiry_date,
        pri.sale_status,
        pri.created_at,
        pr.grn_number,
        pr.status AS receipt_status,
        pr.received_date,
        p.name AS product_name,
        pv.name AS variant_name,
        pv.sku,
        pv.barcode,
        p.has_expiry,
        COALESCE(b.on_hand, 0) AS on_hand
      FROM purchase_receipt_items pri
      JOIN purchase_receipts pr ON pr.id = pri.receipt_id
      JOIN product_variants pv ON pv.id = pri.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN inventory_balances b ON b.variant_id = pri.variant_id
      WHERE pr.deleted_at IS NULL
        AND pr.status = 'posted'
        AND pri.expiry_date IS NOT NULL
      ORDER BY pri.expiry_date ASC, pr.created_at ASC
      LIMIT ?
    `).all(take);

    const items = rows.map((row) => {
      const daysRemaining = dayDiff(row.expiry_date, today);
      return {
        id: row.id,
        receiptId: row.receipt_id,
        variantId: row.variant_id,
        grnNumber: row.grn_number,
        receiptStatus: row.receipt_status,
        receivedDate: row.received_date,
        productName: row.product_name,
        variantName: row.variant_name,
        sku: row.sku,
        barcode: row.barcode,
        quantity: toNumber(row.quantity),
        unitCost: toNumber(row.unit_cost),
        lineTotal: toNumber(row.line_total),
        batchNumber: row.batch_number || null,
        expiryDate: row.expiry_date,
        saleStatus: normalizeSaleStatus(row.sale_status),
        onHand: toNumber(row.on_hand),
        daysRemaining,
        alertBucket: daysRemaining === null
          ? null
          : (daysRemaining < 0
            ? 'expired'
            : daysRemaining <= 7
              ? '7'
              : daysRemaining <= 15
                ? '15'
                : daysRemaining <= 30
                  ? '30'
                  : null),
      };
    });

    return {
      today,
      summary: {
        expired: items.filter((item) => item.alertBucket === 'expired').length,
        sevenDays: items.filter((item) => item.alertBucket === '7').length,
        fifteenDays: items.filter((item) => item.alertBucket === '15').length,
        thirtyDays: items.filter((item) => item.alertBucket === '30').length,
      },
      items,
    };
  },

  updateReceiptItemStatus({ receiptItemId, saleStatus } = {}) {
    const db = getDb();
    const id = cleanText(receiptItemId);
    if (!id) throw new Error('Receipt item ID is required.');
    const nextStatus = normalizeSaleStatus(saleStatus);
    const result = db.prepare(`
      UPDATE purchase_receipt_items
      SET sale_status = ?
      WHERE id = ?
    `).run(nextStatus, id);
    if (!result.changes) throw new Error('Receipt item not found.');
    return { id, saleStatus: nextStatus };
  },
};

export default purchaseService;
