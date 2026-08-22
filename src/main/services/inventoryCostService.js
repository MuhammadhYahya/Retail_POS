import crypto from 'crypto';
import { getDb } from '../database/db.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function clean(value) {
  return String(value ?? '').trim();
}

export function signedDelta(quantity, type) {
  const amount = Math.abs(number(quantity));
  if (!amount) return 0;
  const outgoing = new Set(['sale', 'return_out', 'purchase_return', 'transfer_out', 'damage']);
  const normalized = clean(type).toLowerCase();
  if (outgoing.has(normalized)) return -amount;
  if (normalized === 'adjustment') return number(quantity);
  return amount;
}

/**
 * Apply one stock movement. The caller may already be inside a database
 * transaction; this function deliberately does not open another transaction.
 * Incoming movements use unitCost. Outgoing movements use the current WAC
 * unless valuationUnitCost is explicitly supplied (customer returns).
 */
export function applyInventoryMovement(db, {
  variantId,
  quantity,
  transactionType,
  unitCost = null,
  valuationUnitCost = null,
  referenceType = null,
  referenceId = null,
  notes = null,
  createdBy = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const id = clean(variantId);
  const type = clean(transactionType).toLowerCase();
  const delta = signedDelta(quantity, type);
  if (!id) throw new Error('Variant ID is required.');
  if (!type) throw new Error('Transaction type is required.');
  if (!delta) throw new Error('Quantity cannot be zero.');

  const variant = db.prepare(`
    SELECT id, cost_price FROM product_variants WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!variant) throw new Error('Variant not found.');

  const balance = db.prepare(`
    SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = ?
  `).get(id);
  const costing = db.prepare(`
    SELECT quantity, inventory_value, average_cost, is_reconciled
    FROM inventory_costing WHERE variant_id = ?
  `).get(id);
  const oldQuantity = number(costing?.quantity ?? balance?.on_hand, 0);
  const oldValue = costing
    ? number(costing.inventory_value)
    : oldQuantity * number(variant.cost_price);
  const oldAverage = oldQuantity > 0 ? oldValue / oldQuantity : number(variant.cost_price);
  const currentOnHand = number(balance?.on_hand, oldQuantity);
  const nextOnHand = currentOnHand + delta;
  if (delta < 0 && nextOnHand < -0.0001) {
    throw new Error('Insufficient stock for this adjustment.');
  }

  let movementCost;
  if (delta > 0) {
    movementCost = unitCost !== null && unitCost !== undefined
      ? number(unitCost)
      : valuationUnitCost !== null && valuationUnitCost !== undefined
        ? number(valuationUnitCost)
        : oldAverage;
  } else {
    movementCost = valuationUnitCost === null || valuationUnitCost === undefined
      ? oldAverage
      : number(valuationUnitCost);
  }
  if (movementCost < 0 || !Number.isFinite(movementCost)) throw new Error('Inventory cost must be zero or greater.');

  let nextValue = oldValue + delta * movementCost;
  let nextQuantity = oldQuantity + delta;
  if (nextQuantity <= 0.0001) {
    nextQuantity = Math.max(0, nextQuantity);
    nextValue = 0;
  }
  if (nextValue < -0.01) throw new Error('Inventory value cannot become negative.');
  nextValue = Math.max(0, round(nextValue));
  const nextAverage = nextQuantity > 0 ? round(nextValue / nextQuantity) : 0;
  const reserved = number(balance?.reserved, 0);
  const available = nextOnHand - reserved;

  db.prepare(`
    INSERT INTO inventory_transactions (
      id, variant_id, transaction_type, quantity, unit_cost,
      reference_type, reference_id, notes, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), id, type, delta, round(movementCost),
    referenceType || null, referenceId || null, notes || null, createdBy || null, timestamp
  );

  db.prepare(`
    INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(variant_id) DO UPDATE SET
      on_hand = excluded.on_hand,
      reserved = excluded.reserved,
      available = excluded.available,
      updated_at = excluded.updated_at
  `).run(id, nextOnHand, reserved, available, timestamp);

  db.prepare(`
    INSERT INTO inventory_costing
      (variant_id, quantity, inventory_value, average_cost, is_reconciled, backfill_status, backfill_notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(variant_id) DO UPDATE SET
      quantity = excluded.quantity,
      inventory_value = excluded.inventory_value,
      average_cost = excluded.average_cost,
      is_reconciled = excluded.is_reconciled,
      backfill_status = excluded.backfill_status,
      backfill_notes = excluded.backfill_notes,
      updated_at = excluded.updated_at
  `).run(
    id,
    nextQuantity,
    nextValue,
    nextAverage,
    costing?.is_reconciled ?? 1,
    costing?.is_reconciled === 0 ? 'review_required' : 'live',
    costing?.backfill_notes || null,
    timestamp
  );

  db.prepare(`UPDATE product_variants SET cost_price = ?, updated_at = ? WHERE id = ?`)
    .run(nextAverage, timestamp, id);

  return {
    variantId: id,
    quantity: nextQuantity,
    onHand: nextOnHand,
    inventoryValue: nextValue,
    averageCost: nextAverage,
    movementCost: round(movementCost),
  };
}

export function recordInventoryMovement(payload = {}) {
  const db = getDb();
  let result;
  const tx = db.transaction(() => {
    result = applyInventoryMovement(db, payload);
  });
  tx();
  return result;
}

export function getInventoryCost(variantId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM inventory_costing WHERE variant_id = ?`).get(clean(variantId));
  if (!row) return { variantId, quantity: 0, inventoryValue: 0, averageCost: 0, reconciled: true };
  return {
    variantId: row.variant_id,
    quantity: number(row.quantity),
    inventoryValue: number(row.inventory_value),
    averageCost: number(row.average_cost),
    reconciled: Boolean(row.is_reconciled),
    status: row.backfill_status || 'live',
    notes: row.backfill_notes || null,
  };
}
