import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { app } = require('electron');
const dbPath = path.join(os.tmpdir(), `zen-wac-${Date.now()}.db`);

function assert(condition, message) {
  if (!condition) throw new Error(`WAC simulation failed: ${message}`);
}

async function run() {
  const { openDbAtPath, closeDb, getDb } = await import('../src/main/database/db.js');
  const productService = (await import('../src/main/services/productService.js')).default;
  const purchaseService = (await import('../src/main/services/purchaseService.js')).default;
  const purchaseReturnService = (await import('../src/main/services/purchaseReturnService.js')).default;
  const saleService = (await import('../src/main/services/saleService.js')).default;
  const returnService = (await import('../src/main/services/returnService.js')).default;
  const cashSessionService = (await import('../src/main/services/cashSessionService.js')).default;

  openDbAtPath(dbPath);
  const db = getDb();
  const userId = crypto.randomUUID();
  db.prepare(`INSERT INTO users (id, username, display_name, pin_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 'test', 'admin', 1, datetime('now'), datetime('now'))`)
    .run(userId, `wac-${Date.now()}`, 'WAC Test');
  const category = productService.createCategory({ name: `WAC ${Date.now()}` });
  const product = productService.createProduct({
    name: 'WAC Test Item', categoryId: category.id, unit: 'pcs',
    variants: [{ name: 'Default', sku: `WAC-${Date.now()}`, barcode: `WAC-${Date.now()}`, sellingPrice: 200, costPrice: 100 }],
  });
  const variant = product.variants[0];
  const supplier = purchaseService.createSupplier({ name: `WAC Supplier ${Date.now()}` });

  let grn = purchaseService.createReceipt({ supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 10, unitCost: 100 }], createdBy: userId });
  purchaseService.postReceipt({ receiptId: grn.id, userId });
  grn = purchaseService.createReceipt({ supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 20, unitCost: 120 }], createdBy: userId });
  purchaseService.postReceipt({ receiptId: grn.id, userId });
  let summary = productService.getInventorySummary(variant.id);
  assert(summary.onHand === 30, `expected 30 units, got ${summary.onHand}`);
  assert(Math.abs(summary.averageCost - 113.33) < 0.02, `expected WAC 113.33, got ${summary.averageCost}`);

  cashSessionService.openDay({ userId, openingFloat: 1000 });
  const sale = saleService.createSale({ cartItems: [{ variantId: variant.id, quantity: 5 }], payment: { method: 'cash', amountTendered: 1000 }, cashierId: userId, actorRole: 'admin' });
  assert(Math.abs(sale.items[0].unitCost - 113.33) < 0.02, `sale did not capture WAC: ${sale.items[0].unitCost}`);
  const customerReturn = returnService.createReturn({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }], reason: 'WAC test', refundMethod: 'cash', userId });
  summary = productService.getInventorySummary(variant.id);
  assert(summary.onHand === 26, `expected 26 after sale and customer return, got ${summary.onHand}`);
  assert(Math.abs(summary.averageCost - 113.33) < 0.02, `customer return changed WAC incorrectly: ${summary.averageCost}`);

  const returnable = purchaseReturnService.listReturnableReceipts().find((row) => row.id === grn.id);
  const supplierReturn = purchaseReturnService.create({ items: [{ receiptItemId: returnable.items[0].id, quantity: 2 }], userId });
  summary = productService.getInventorySummary(variant.id);
  assert(summary.onHand === 24, `expected 24 after supplier return, got ${summary.onHand}`);
  assert(supplierReturn.returnNumber, 'supplier return number missing');
  console.log('WAC simulation passed', JSON.stringify({ averageCost: summary.averageCost, customerReturn: customerReturn.returnNumber, supplierReturn: supplierReturn.returnNumber }));
  closeDb();
  fs.rmSync(dbPath, { force: true });
  app.exit(0);
}

app.whenReady().then(() => run().catch((error) => { console.error(error); try { fs.rmSync(dbPath, { force: true }); } catch {} app.exit(1); }));
