import crypto from 'crypto';
import { getDb } from '../database/db.js';
import settingsService from './settingsService.js';

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : '';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

/** Inclusive VAT: portion of price that is tax. Rs.100 @ 18% → ~15.25 */
export function calculateInclusiveVat(amount, taxRatePercent) {
  const rate = toNumber(taxRatePercent, 0);
  const total = toNumber(amount, 0);
  if (rate <= 0 || total <= 0) return 0;
  return roundMoney((total * rate) / (100 + rate));
}

function assertTruthy(value, message) {
  if (!value) throw new Error(message);
}

function applyStockDelta(db, { variantId, delta, transactionType, referenceId, notes, createdBy, unitCost = null }) {
  const timestamp = now();
  const txnId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO inventory_transactions (
      id, variant_id, transaction_type, quantity, unit_cost,
      reference_type, reference_id, notes, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?)
  `).run(
    txnId,
    variantId,
    transactionType,
    delta,
    unitCost,
    referenceId,
    notes,
    createdBy,
    timestamp
  );

  const existing = db.prepare(`
    SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = ?
  `).get(variantId);

  const onHand = toNumber(existing?.on_hand, 0) + delta;
  const reserved = toNumber(existing?.reserved, 0);
  const available = onHand - reserved;

  if (existing) {
    db.prepare(`
      UPDATE inventory_balances
      SET on_hand = ?, available = ?, updated_at = ?
      WHERE variant_id = ?
    `).run(onHand, available, timestamp, variantId);
  } else {
    db.prepare(`
      INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `).run(variantId, onHand, available, timestamp);
  }

  return { onHand, available };
}

function loadVariantForSale(db, variantId) {
  return db.prepare(`
    SELECT
      v.id AS variant_id,
      v.product_id,
      v.name AS variant_name,
      v.sku,
      v.barcode,
      v.selling_price,
      v.cost_price,
      v.track_inventory,
      v.is_active AS variant_is_active,
      v.deleted_at AS variant_deleted_at,
      p.name AS product_name,
      p.tax_rate,
      p.is_active AS product_is_active,
      p.deleted_at AS product_deleted_at,
      COALESCE(b.available, 0) AS available
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory_balances b ON b.variant_id = v.id
    WHERE v.id = ?
  `).get(variantId);
}

function mapSaleRow(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceSeq: row.invoice_seq,
    saleDate: row.sale_date,
    cashierId: row.cashier_id,
    customerId: row.customer_id,
    subtotal: toNumber(row.subtotal),
    discountTotal: toNumber(row.discount_total),
    vatTotal: toNumber(row.vat_total),
    total: toNumber(row.total),
    paymentMethod: row.payment_method,
    amountTendered: toNumber(row.amount_tendered),
    changeGiven: toNumber(row.change_given),
    status: row.status,
    voidReason: row.void_reason,
    voidedBy: row.voided_by,
    voidedAt: row.voided_at,
    irdStatus: row.ird_status,
    irdUuid: row.ird_uuid,
    notes: row.notes,
    isSynced: Boolean(row.is_synced),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      id: item.id,
      saleId: item.sale_id,
      variantId: item.variant_id,
      productId: item.product_id,
      productName: item.product_name,
      variantName: item.variant_name,
      sku: item.sku,
      barcode: item.barcode,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unit_price),
      discountAmount: toNumber(item.discount_amount),
      taxRate: toNumber(item.tax_rate),
      vatAmount: toNumber(item.vat_amount),
      lineTotal: toNumber(item.line_total),
    })),
  };
}

function getSaleItems(db, saleId) {
  return db.prepare(`
    SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC
  `).all(saleId);
}

const saleService = {
  calculateCartTotals(cartItems = [], fallbackVatRate = 18) {
    let subtotal = 0;
    let discountTotal = 0;
    let vatTotal = 0;

    const lines = cartItems.map((item) => {
      const quantity = toNumber(item.quantity, 0);
      const unitPrice = toNumber(item.unitPrice ?? item.sellingPrice, 0);
      const discountAmount = Math.max(0, toNumber(item.discountAmount, 0));
      const taxRate = toNumber(item.taxRate, fallbackVatRate);
      const gross = roundMoney(quantity * unitPrice);
      const lineTotal = roundMoney(Math.max(0, gross - discountAmount));
      const vatAmount = calculateInclusiveVat(lineTotal, taxRate > 0 ? taxRate : 0);

      subtotal = roundMoney(subtotal + gross);
      discountTotal = roundMoney(discountTotal + discountAmount);
      vatTotal = roundMoney(vatTotal + vatAmount);

      return {
        ...item,
        quantity,
        unitPrice,
        discountAmount,
        taxRate,
        lineTotal,
        vatAmount,
      };
    });

    const total = roundMoney(subtotal - discountTotal);
    return { lines, subtotal, discountTotal, vatTotal, total };
  },

  createSale({ cartItems = [], payment = {}, cashierId, notes = null } = {}) {
    const db = getDb();
    const settings = settingsService.get();
    const cleanCashierId = cleanText(cashierId);
    assertTruthy(cleanCashierId, 'Cashier is required.');
    assertTruthy(Array.isArray(cartItems) && cartItems.length, 'Cart is empty.');

    const paymentMethod = cleanText(payment.method || payment.paymentMethod || 'cash').toLowerCase() || 'cash';
    const allowedMethods = new Set(['cash', 'card', 'qr']);
    if (!allowedMethods.has(paymentMethod)) {
      throw new Error('Unsupported payment method.');
    }

    const prepared = cartItems.map((item) => {
      const variantId = cleanText(item.variantId);
      assertTruthy(variantId, 'Each cart item needs a variant.');
      const quantity = toNumber(item.quantity, 0);
      if (quantity <= 0) throw new Error('Item quantity must be greater than zero.');
      return {
        variantId,
        quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
      };
    });

    const run = db.transaction(() => {
      const resolvedItems = prepared.map((item) => {
        const variant = loadVariantForSale(db, item.variantId);
        if (!variant || variant.variant_deleted_at || variant.product_deleted_at) {
          throw new Error('One or more products are no longer available.');
        }
        if (!variant.variant_is_active || !variant.product_is_active) {
          throw new Error(`${variant.product_name} is inactive.`);
        }

        const quantity = item.quantity;
        if (variant.track_inventory && toNumber(variant.available, 0) < quantity) {
          throw new Error(`Insufficient stock for ${variant.product_name}.`);
        }

        const unitPrice =
          item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== ''
            ? toNumber(item.unitPrice, 0)
            : toNumber(variant.selling_price, 0);
        if (unitPrice < 0) throw new Error('Unit price cannot be negative.');

        const taxRate =
          item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== ''
            ? toNumber(item.taxRate, 0)
            : toNumber(variant.tax_rate, 0);

        return {
          variantId: variant.variant_id,
          productId: variant.product_id,
          productName: variant.product_name,
          variantName: variant.variant_name || '',
          sku: variant.sku,
          barcode: variant.barcode,
          trackInventory: Boolean(variant.track_inventory),
          costPrice: toNumber(variant.cost_price, 0),
          quantity,
          unitPrice,
          discountAmount: Math.max(0, toNumber(item.discountAmount, 0)),
          taxRate,
        };
      });

      const { lines, subtotal, discountTotal, vatTotal, total } = this.calculateCartTotals(
        resolvedItems,
        settings.vatRate
      );

      const amountTendered =
        paymentMethod === 'cash'
          ? roundMoney(toNumber(payment.amountTendered ?? payment.tendered, 0))
          : total;

      if (paymentMethod === 'cash' && amountTendered + 0.001 < total) {
        throw new Error('Tendered amount is less than the total.');
      }

      const changeGiven = paymentMethod === 'cash' ? roundMoney(Math.max(0, amountTendered - total)) : 0;

      db.prepare(`
        UPDATE settings SET next_invoice_seq = next_invoice_seq + 1, updated_at = ? WHERE id = 1
      `).run(now());

      const seqRow = db.prepare('SELECT next_invoice_seq, invoice_prefix FROM settings WHERE id = 1').get();
      const invoiceSeq = toNumber(seqRow.next_invoice_seq, 1);
      const prefix = cleanText(seqRow.invoice_prefix) || 'POS';
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const invoiceNumber = `${prefix}-${day}-${String(invoiceSeq).padStart(6, '0')}`;

      const saleId = crypto.randomUUID();
      const timestamp = now();

      db.prepare(`
        INSERT INTO sales (
          id, invoice_number, invoice_seq, sale_date, cashier_id, customer_id,
          subtotal, discount_total, vat_total, total,
          payment_method, amount_tendered, change_given, status,
          ird_status, notes, is_synced, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'completed', 'none', ?, 0, ?, ?)
      `).run(
        saleId,
        invoiceNumber,
        invoiceSeq,
        timestamp,
        cleanCashierId,
        subtotal,
        discountTotal,
        vatTotal,
        total,
        paymentMethod,
        amountTendered,
        changeGiven,
        notes ? cleanText(notes) : null,
        timestamp,
        timestamp
      );

      const insertItem = db.prepare(`
        INSERT INTO sale_items (
          id, sale_id, variant_id, product_id, product_name, variant_name,
          sku, barcode, quantity, unit_price, discount_amount, tax_rate, vat_amount, line_total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        insertItem.run(
          crypto.randomUUID(),
          saleId,
          line.variantId,
          line.productId,
          line.productName,
          line.variantName || null,
          line.sku || null,
          line.barcode || null,
          line.quantity,
          line.unitPrice,
          line.discountAmount,
          line.taxRate,
          line.vatAmount,
          line.lineTotal,
          timestamp
        );

        if (line.trackInventory) {
          applyStockDelta(db, {
            variantId: line.variantId,
            delta: -Math.abs(line.quantity),
            transactionType: 'sale',
            referenceId: saleId,
            notes: `Sale ${invoiceNumber}`,
            createdBy: cleanCashierId,
            unitCost: line.costPrice,
          });
        }
      }

      return saleId;
    });

    const saleId = run();
    return this.getById(saleId);
  },

  getById(saleId) {
    const db = getDb();
    const id = cleanText(saleId);
    assertTruthy(id, 'Sale ID is required.');
    const row = db.prepare('SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!row) throw new Error('Sale not found.');
    return mapSaleRow(row, getSaleItems(db, id));
  },

  getByInvoiceNumber(invoiceNumber) {
    const db = getDb();
    const number = cleanText(invoiceNumber);
    assertTruthy(number, 'Invoice number is required.');
    const row = db.prepare(`
      SELECT * FROM sales WHERE invoice_number = ? AND deleted_at IS NULL
    `).get(number);
    if (!row) throw new Error('Sale not found.');
    return mapSaleRow(row, getSaleItems(db, row.id));
  },

  listRecent({ limit = 50, status = null } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 50), 1), 200);
    let rows;
    if (status) {
      rows = db.prepare(`
        SELECT * FROM sales
        WHERE deleted_at IS NULL AND status = ?
        ORDER BY sale_date DESC
        LIMIT ?
      `).all(cleanText(status), take);
    } else {
      rows = db.prepare(`
        SELECT * FROM sales
        WHERE deleted_at IS NULL
        ORDER BY sale_date DESC
        LIMIT ?
      `).all(take);
    }
    return rows.map((row) => mapSaleRow(row, []));
  },

  voidSale({ saleId, reason, userId }) {
    const db = getDb();
    const id = cleanText(saleId);
    const cleanUserId = cleanText(userId);
    const voidReason = cleanText(reason);
    assertTruthy(id, 'Sale ID is required.');
    assertTruthy(cleanUserId, 'User is required.');
    assertTruthy(voidReason, 'Void reason is required.');

    const run = db.transaction(() => {
      const sale = db.prepare(`
        SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL
      `).get(id);
      if (!sale) throw new Error('Sale not found.');
      if (sale.status === 'voided') throw new Error('Sale is already voided.');

      const items = getSaleItems(db, id);
      const timestamp = now();

      db.prepare(`
        UPDATE sales SET
          status = 'voided',
          void_reason = ?,
          voided_by = ?,
          voided_at = ?,
          updated_at = ?,
          is_synced = 0
        WHERE id = ?
      `).run(voidReason, cleanUserId, timestamp, timestamp, id);

      for (const item of items) {
        const variant = loadVariantForSale(db, item.variant_id);
        if (variant?.track_inventory) {
          applyStockDelta(db, {
            variantId: item.variant_id,
            delta: Math.abs(toNumber(item.quantity, 0)),
            transactionType: 'void',
            referenceId: id,
            notes: `Void ${sale.invoice_number}: ${voidReason}`,
            createdBy: cleanUserId,
            unitCost: null,
          });
        }
      }

      return id;
    });

    run();
    return this.getById(id);
  },

  updateIrdStatus(saleId, { irdStatus, irdUuid }) {
    const db = getDb();
    db.prepare(`
      UPDATE sales SET ird_status = ?, ird_uuid = ?, updated_at = ? WHERE id = ?
    `).run(irdStatus, irdUuid || null, now(), saleId);
  },
};

export default saleService;
