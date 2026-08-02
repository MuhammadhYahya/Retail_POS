/**
 * Nimal Stores — V1 shop-loop simulation (runs under Electron Node for better-sqlite3).
 *
 *   npx electron scripts/v1-shop-simulation.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dbPath = path.join(os.tmpdir(), `zen-nimal-${Date.now()}.db`);

let passed = 0;
let failed = 0;
const defects = [];

function ok(cond, msg, severity = 'High') {
  if (cond) {
    passed += 1;
    console.log('  PASS', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
    defects.push({ id: `SIM-${failed}`, msg, severity, status: 'open' });
  }
}

async function main() {
  console.log('Nimal Stores V1 simulation');
  console.log('DB:', dbPath);

  const { openDbAtPath, closeDb, getDb } = await import(
    pathToFileURL(path.join(root, 'src/main/database/db.js')).href
  );
  openDbAtPath(dbPath);

  const bcrypt = (await import('bcryptjs')).default;
  const { colomboDateString, colomboDayBounds } = await import(
    pathToFileURL(path.join(root, 'src/main/lib/colomboTime.js')).href
  );
  const cashSessionService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/cashSessionService.js')).href
  )).default;
  const productService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/productService.js')).href
  )).default;
  const purchaseService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/purchaseService.js')).href
  )).default;
  const saleService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/saleService.js')).href
  )).default;
  const returnService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/returnService.js')).href
  )).default;
  const expenseService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/expenseService.js')).href
  )).default;
  const settingsService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/settingsService.js')).href
  )).default;
  const reportService = (await import(
    pathToFileURL(path.join(root, 'src/main/services/reportService.js')).href
  )).default;

  const db = getDb();

  console.log('\nDay 0 — Setup');
  const adminId = crypto.randomUUID();
  const pinHash = await bcrypt.hash('1234', 10);
  db.prepare(`
    INSERT INTO users (id, username, display_name, pin_hash, role, is_active, created_at, updated_at)
    VALUES (?, 'nimal', 'Nimal Owner', ?, 'admin', 1, datetime('now'), datetime('now'))
  `).run(adminId, pinHash);

  settingsService.update({
    shopName: 'Nimal Stores',
    shopAddress: 'Colombo 05',
    shopPhone: '0112345678',
    shopTin: '123456789',
    currency: 'LKR',
    vatRate: 18,
    receiptFooter: 'Thank you — Nimal Stores',
  });

  const cat = productService.createCategory({ name: 'Grocery' });
  const products = [];
  for (let i = 1; i <= 20; i += 1) {
    const p = productService.createProduct({
      name: `Item ${i}`,
      brand: i % 2 ? 'Anchor' : 'MD',
      categoryId: cat.id,
      taxRate: 18,
      unit: 'pcs',
      variants: [
        {
          name: 'Default',
          barcode: `890100${String(i).padStart(6, '0')}`,
          sellingPrice: 100 + i * 10,
          costPrice: 70 + i * 5,
          initialStock: 0,
          trackInventory: true,
          isDefault: true,
        },
      ],
    });
    products.push(p);
  }
  ok(products.length === 20, 'Created 20 products');

  let blocked = false;
  try {
    saleService.createSale({
      cartItems: [{ variantId: products[0].variants[0].id, quantity: 1 }],
      payment: { method: 'cash', amountTendered: 1000 },
      cashierId: adminId,
      actorRole: 'admin',
    });
  } catch (e) {
    blocked = /open cash day/i.test(e.message);
  }
  ok(blocked, 'Sale blocked when cash day closed');

  cashSessionService.openDay({ userId: adminId, openingFloat: 5000 });
  ok(!!cashSessionService.getOpenSession(), 'Day opened with float 5000');

  console.log('\nDay 1 — GRN + sales + expenses');
  const supplier = purchaseService.createSupplier({ name: 'Cargills Wholesale' });
  const grnItems = products.slice(0, 10).map((p) => ({
    variantId: p.variants[0].id,
    quantity: 50,
    unitCost: p.variants[0].costPrice,
  }));
  const grn = purchaseService.createReceipt({
    supplierId: supplier.id,
    items: grnItems,
    createdBy: adminId,
  });
  purchaseService.postReceipt({ receiptId: grn.id, userId: adminId });
  const bal = productService.getInventorySummary(products[0].variants[0].id);
  ok(bal.onHand === 50, `Stock after GRN is 50 (got ${bal.onHand})`);

  let negBlocked = false;
  try {
    productService.adjustStock({
      variantId: products[0].variants[0].id,
      quantity: 9999,
      transactionType: 'sale',
      createdBy: adminId,
    });
  } catch (e) {
    negBlocked = /Insufficient stock/i.test(e.message);
  }
  ok(negBlocked, 'Negative stock adjust blocked');

  for (let i = 0; i < 40; i += 1) {
    const p = products[i % 10];
    const price = p.variants[0].sellingPrice;
    saleService.createSale({
      cartItems: [{ variantId: p.variants[0].id, quantity: 1 }],
      payment: {
        method: i % 5 === 0 ? 'card' : i % 7 === 0 ? 'qr' : 'cash',
        amountTendered: price + 500,
      },
      cashierId: adminId,
      actorRole: 'admin',
    });
  }
  ok(true, 'Completed 40 sales');

  expenseService.create({
    category: 'Transport',
    amount: 500,
    paymentMethod: 'cash',
    userId: adminId,
    note: 'Three-wheeler to market',
  });
  expenseService.create({
    category: 'Petty cash',
    amount: 200,
    paymentMethod: 'cash',
    userId: adminId,
  });

  const x = cashSessionService.getXReport();
  ok(x.cashExpenses === 700, `X-report cash expenses 700 (got ${x.cashExpenses})`);
  ok(Math.abs(x.expectedCash - (5000 + x.cashSales - x.cashRefunds - 700)) < 0.02, 'Expected cash formula holds');

  const closed = cashSessionService.closeDay({
    userId: adminId,
    countedCash: x.expectedCash,
    notes: 'Day 1 balanced',
  });
  ok(closed.zReport.variance === 0, 'Z variance 0 when counted = expected');
  ok(!cashSessionService.getOpenSession(), 'No open session after Z close');

  let doubleClose = false;
  try {
    cashSessionService.closeDay({ userId: adminId, countedCash: 0 });
  } catch (e) {
    doubleClose = /No open cash day/i.test(e.message);
  }
  ok(doubleClose, 'Double close blocked');

  console.log('\nDay 2 — Returns + edges');
  cashSessionService.openDay({ userId: adminId, openingFloat: closed.zReport.countedCash });
  const recent = saleService.listRecent({ limit: 5, status: 'completed' });
  ok(recent.length > 0, 'Have sales to return');

  const returnable = returnService.getReturnableForSale(recent[0].id);
  const retItem = returnable.items[0];
  const ret = returnService.createReturn({
    saleId: returnable.saleId,
    items: [{ saleItemId: retItem.saleItemId, quantity: 1 }],
    reason: 'Customer changed mind',
    refundMethod: 'cash',
    userId: adminId,
  });
  ok(ret.refundTotal > 0, `Return created ${ret.returnNumber}`);

  const voidTarget = saleService.listRecent({ limit: 10, status: 'completed' }).find((s) => s.id !== recent[0].id);
  if (voidTarget) {
    saleService.voidSale({ saleId: voidTarget.id, reason: 'Wrong scan', userId: adminId });
    ok(saleService.getById(voidTarget.id).status === 'voided', 'Void sale works');
  } else {
    ok(false, 'No second sale to void');
  }

  const bounds = colomboDayBounds(colomboDateString());
  ok(bounds.start.endsWith('Z') && bounds.end > bounds.start, 'Colombo day bounds valid');

  const daily = reportService.dailySummary(colomboDateString());
  ok(daily.date === colomboDateString(), 'Daily summary uses Colombo date');

  const day2x = cashSessionService.getXReport();
  cashSessionService.closeDay({
    userId: adminId,
    countedCash: day2x.expectedCash,
    notes: 'Day 2 close',
  });
  ok(!cashSessionService.getOpenSession(), 'Day 2 closed');

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  for (const t of ['cash_sessions', 'suppliers', 'purchase_receipts', 'sale_returns', 'expenses', 'z_reports']) {
    ok(tables.includes(t), `Table ${t} exists`);
  }

  closeDb();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);

  const logPath = path.join(root, 'docs/V1_SIMULATION_LOG.md');
  const lines = [
    '# V1 Simulation Log — Nimal Stores',
    '',
    `Run: ${new Date().toISOString()} (\`npx electron scripts/v1-shop-simulation.mjs\`)`,
    '',
    `**Result:** ${passed} passed, ${failed} failed`,
    '',
    '| ID | Day | Screen | Steps | Expected | Actual | Severity | Status |',
    '|----|-----|--------|-------|----------|--------|----------|--------|',
  ];
  if (!defects.length) {
    lines.push('| — | 0–2 | Full loop | Setup→GRN→sales→expense→Z→reopen→return→void→Z | Pass without Critical/High | All assertions passed | — | Pass |');
  } else {
    for (const d of defects) {
      lines.push(`| ${d.id} | sim | service | automated | pass | ${d.msg} | ${d.severity} | open |`);
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('- Headless service simulation covers money/stock/Z logic.');
  lines.push('- GUI label/receipt print and physical ESC/POS remain for shop-PC smoke.');
  lines.push('- Re-run: `npx electron scripts/v1-shop-simulation.mjs`');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  console.log('Wrote', logPath);

  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  });
});
