import crypto from 'crypto';
import { getDb } from '../../database/db.js';
import { tableExists } from './formatUtils.js';
import reportService from '../reportService.js';
import { importProductRows } from './productImporter.js';
import { colomboDateString, colomboDayBounds } from '../../lib/colomboTime.js';

function now() {
  return new Date().toISOString();
}

function requireTable(name) {
  if (!tableExists(name)) {
    const err = new Error(`Module not available: ${name} table does not exist yet.`);
    err.code = 'MODULE_UNAVAILABLE';
    throw err;
  }
}

/** Future modules register here with the same shape. */
const entities = [];

export function registerEntity(entity) {
  if (!entity?.id || !entity?.label) {
    throw new Error('Invalid entity registration.');
  }
  const idx = entities.findIndex((e) => e.id === entity.id);
  if (idx >= 0) entities[idx] = entity;
  else entities.push(entity);
}

export function listEntities() {
  return entities.map((e) => ({
    id: e.id,
    label: e.label,
    importable: Boolean(e.import),
    exportable: Boolean(e.export),
    formats: e.formats || ['csv', 'xlsx', 'json'],
    available: typeof e.isAvailable === 'function' ? e.isAvailable() : true,
  }));
}

export function getEntity(id) {
  const entity = entities.find((e) => e.id === id);
  if (!entity) throw new Error(`Unknown entity: ${id}`);
  if (typeof entity.isAvailable === 'function' && !entity.isAvailable()) {
    const err = new Error(`Module not available: ${entity.label}`);
    err.code = 'MODULE_UNAVAILABLE';
    throw err;
  }
  return entity;
}

// --- Built-in entities for current POSLY modules ---

registerEntity({
  id: 'categories',
  label: 'Categories',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('categories'),
  export() {
    requireTable('categories');
    const db = getDb();
    return db
      .prepare(`
        SELECT id, name, parent_id AS parentId, is_active AS isActive, created_at AS createdAt
        FROM categories
        WHERE deleted_at IS NULL
        ORDER BY name
      `)
      .all();
  },
  validate(rows) {
    const errors = [];
    rows.forEach((row, i) => {
      if (!String(row.name || row.Name || '').trim()) {
        errors.push({ row: i + 1, message: 'Category name is required.' });
      }
    });
    return errors;
  },
  preview(rows) {
    return {
      total: rows.length,
      sample: rows.slice(0, 10),
      errors: this.validate(rows).slice(0, 20),
    };
  },
  import({ rows, mode = 'insert' }) {
    requireTable('categories');
    const db = getDb();
    const report = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const findByName = db.prepare(
      `SELECT id FROM categories WHERE lower(name) = lower(?) AND deleted_at IS NULL`
    );
    const insert = db.prepare(`
      INSERT INTO categories (id, name, parent_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const update = db.prepare(`
      UPDATE categories SET name = ?, updated_at = ? WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const name = String(row.name || row.Name || '').trim();
        if (!name) {
          report.errors.push({ row: i + 1, message: 'Missing name' });
          continue;
        }
        const existing = findByName.get(name);
        if (existing) {
          if (mode === 'skip') {
            report.skipped += 1;
          } else if (mode === 'update') {
            update.run(name, now(), existing.id);
            report.updated += 1;
          } else {
            report.skipped += 1;
          }
        } else {
          if (mode === 'update') {
            report.skipped += 1;
          } else {
            insert.run(crypto.randomUUID(), name, null, now(), now());
            report.inserted += 1;
          }
        }
      }
    });
    tx();
    return report;
  },
});

registerEntity({
  id: 'products',
  label: 'Products',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('products'),
  export({ filters = {} } = {}) {
    requireTable('products');
    const db = getDb();
    const clauses = ['p.deleted_at IS NULL', 'v.deleted_at IS NULL'];
    const params = [];

    if (filters.activeOnly) {
      clauses.push('p.is_active = 1');
      clauses.push('v.is_active = 1');
    } else if (filters.inactiveOnly) {
      clauses.push('(p.is_active = 0 OR v.is_active = 0)');
    }
    if (filters.categoryName) {
      clauses.push('lower(c.name) = lower(?)');
      params.push(String(filters.categoryName).trim());
    }
    if (filters.supplierName) {
      clauses.push('lower(s.name) = lower(?)');
      params.push(String(filters.supplierName).trim());
    }
    if (filters.lowStockOnly) {
      clauses.push('COALESCE(b.on_hand, 0) <= COALESCE(v.low_stock_alert, 0)');
      clauses.push('v.low_stock_alert > 0');
    }
    if (filters.outOfStockOnly) {
      clauses.push('COALESCE(b.on_hand, 0) <= 0');
    }
    if (filters.vatOnly) {
      clauses.push('COALESCE(p.tax_rate, 0) > 0');
    }

    const hasSupplierCol = db
      .prepare(`PRAGMA table_info(products)`)
      .all()
      .some((c) => c.name === 'supplier_id');

    const supplierJoin = hasSupplierCol
      ? 'LEFT JOIN suppliers s ON s.id = p.supplier_id'
      : 'LEFT JOIN suppliers s ON 0';
    const supplierSelect = hasSupplierCol ? 's.name AS supplierName,' : 'NULL AS supplierName,';

    return db
      .prepare(`
        SELECT
          p.name AS productName,
          p.brand,
          p.description,
          p.tax_rate AS taxRate,
          p.unit,
          c.name AS categoryName,
          ${supplierSelect}
          v.name AS variantName,
          json_extract(v.attributes_json, '$.size') AS size,
          COALESCE(json_extract(v.attributes_json, '$.color'), json_extract(v.attributes_json, '$.colour')) AS color,
          v.sku,
          v.barcode,
          v.selling_price AS sellingPrice,
          v.cost_price AS costPrice,
          v.low_stock_alert AS lowStockAlert,
          COALESCE(b.on_hand, 0) AS stockOnHand,
          CASE WHEN p.is_active = 1 AND v.is_active = 1 THEN 1 ELSE 0 END AS isActive
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ${supplierJoin}
        JOIN product_variants v ON v.product_id = p.id
        LEFT JOIN inventory_balances b ON b.variant_id = v.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY p.name, v.sort_order
      `)
      .all(...params);
  },
  // Prefer wizard import via importExportService; legacy path kept for BackupRestorePanel
  validate(rows) {
    const errors = [];
    rows.forEach((row, i) => {
      const name = String(row.productName || row.name || row.Name || '').trim();
      if (!name) errors.push({ row: i + 1, message: 'Product name is required.' });
    });
    return errors;
  },
  preview(rows) {
    return {
      total: rows.length,
      sample: rows.slice(0, 10),
      errors: this.validate(rows).slice(0, 20),
    };
  },
  import({ rows, mode = 'insert' }) {
    // Thin adapter → enhanced importer with identity mapping
    const mappedRows = rows.map((row, i) => ({
      __rowNumber: i + 2,
      productName: row.productName || row.name || row.Name || '',
      sku: row.sku || row.SKU || '',
      barcode: row.barcode || '',
      costPrice: row.costPrice ?? row.cost_price ?? row.cost,
      sellingPrice: row.sellingPrice ?? row.selling_price ?? row.price,
      stockOnHand: row.stockOnHand ?? row.stock ?? row.on_hand,
      supplierName: row.supplierName || row.supplier || '',
      categoryName: row.categoryName || row.category || '',
      brand: row.brand || '',
      description: row.description || '',
      taxRate: row.taxRate ?? row.tax_rate ?? row.vat,
      lowStockAlert: row.lowStockAlert ?? row.low_stock_alert,
      unit: row.unit || '',
      variantName: row.variantName || row.variant || '',
      size: row.size || '',
      color: row.color || row.colour || '',
      isActive: row.isActive ?? row.is_active ?? 1,
    }));
    const dupMode = mode === 'update' ? 'update' : mode === 'skip' ? 'skip' : 'create';
    const result = importProductRows({
      mappedRows,
      duplicateMode: dupMode,
      categoryMode: 'auto',
      supplierMode: 'auto',
      autoGenerateBarcode: true,
      autoGenerateSku: true,
    });
    return {
      inserted: result.report.inserted,
      updated: result.report.updated,
      skipped: result.report.skipped,
      errors: result.report.errors,
    };
  },
});

registerEntity({
  id: 'inventory',
  label: 'Inventory / Stock',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('inventory_balances'),
  export() {
    requireTable('inventory_balances');
    const db = getDb();
    return db
      .prepare(`
        SELECT
          v.sku,
          v.barcode,
          p.name AS productName,
          v.name AS variantName,
          b.on_hand AS onHand,
          b.reserved,
          b.available,
          b.updated_at AS updatedAt
        FROM inventory_balances b
        JOIN product_variants v ON v.id = b.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.name
      `)
      .all();
  },
  validate(rows) {
    const errors = [];
    rows.forEach((row, i) => {
      if (!String(row.sku || '').trim()) errors.push({ row: i + 1, message: 'SKU required' });
    });
    return errors;
  },
  preview(rows) {
    return { total: rows.length, sample: rows.slice(0, 10), errors: this.validate(rows).slice(0, 20) };
  },
  import({ rows, mode = 'update' }) {
    requireTable('inventory_balances');
    const db = getDb();
    const report = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const findVariant = db.prepare(
      `SELECT id FROM product_variants WHERE sku = ? AND deleted_at IS NULL`
    );
    const upsert = db.prepare(`
      INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(variant_id) DO UPDATE SET
        on_hand = excluded.on_hand,
        available = excluded.available,
        updated_at = excluded.updated_at
    `);

    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i += 1) {
        const sku = String(rows[i].sku || '').trim();
        if (!sku) {
          report.errors.push({ row: i + 1, message: 'SKU required' });
          continue;
        }
        const variant = findVariant.get(sku);
        if (!variant) {
          report.errors.push({ row: i + 1, message: `Unknown SKU: ${sku}` });
          continue;
        }
        if (mode === 'skip') {
          report.skipped += 1;
          continue;
        }
        const onHand = Number(rows[i].onHand ?? rows[i].on_hand ?? rows[i].stock ?? 0) || 0;
        upsert.run(variant.id, onHand, onHand, now());
        report.updated += 1;
      }
    });
    tx();
    return report;
  },
});

registerEntity({
  id: 'sales',
  label: 'Sales',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('sales'),
  export() {
    requireTable('sales');
    const db = getDb();
    return db
      .prepare(`
        SELECT
          s.id,
          s.invoice_number AS invoiceNumber,
          s.sale_date AS saleDate,
          s.subtotal,
          s.vat_total AS taxTotal,
          s.total AS grandTotal,
          s.payment_method AS paymentMethod,
          s.status,
          u.username AS cashier
        FROM sales s
        LEFT JOIN users u ON u.id = s.cashier_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.sale_date DESC
        LIMIT 10000
      `)
      .all();
  },
  // Sales import is intentionally not supported (full restore covers that)
  import: null,
});

registerEntity({
  id: 'users',
  label: 'Users',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('users'),
  export() {
    requireTable('users');
    const db = getDb();
    return db
      .prepare(`
        SELECT id, username, display_name AS displayName, role, is_active AS isActive, created_at AS createdAt
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY username
      `)
      .all();
  },
  import: null, // PINs must not be imported via CSV for security
});

registerEntity({
  id: 'settings',
  label: 'Settings',
  formats: ['json'],
  isAvailable: () => tableExists('settings'),
  export() {
    requireTable('settings');
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return [row || {}];
  },
  preview(rows) {
    return { total: rows.length, sample: rows.slice(0, 1), errors: [] };
  },
  import({ rows, mode = 'update' }) {
    requireTable('settings');
    if (mode === 'skip') return { inserted: 0, updated: 0, skipped: 1, errors: [] };
    const row = rows[0];
    if (!row) return { inserted: 0, updated: 0, skipped: 0, errors: [{ row: 1, message: 'No settings row' }] };
    const db = getDb();
    db.prepare(`
      UPDATE settings SET
        shop_name = COALESCE(?, shop_name),
        shop_address = COALESCE(?, shop_address),
        shop_phone = COALESCE(?, shop_phone),
        shop_tin = COALESCE(?, shop_tin),
        currency = COALESCE(?, currency),
        language = COALESCE(?, language),
        vat_rate = COALESCE(?, vat_rate),
        invoice_prefix = COALESCE(?, invoice_prefix),
        receipt_header = COALESCE(?, receipt_header),
        receipt_footer = COALESCE(?, receipt_footer),
        updated_at = ?
      WHERE id = 1
    `).run(
      row.shop_name ?? row.shopName ?? null,
      row.shop_address ?? row.shopAddress ?? null,
      row.shop_phone ?? row.shopPhone ?? null,
      row.shop_tin ?? row.shopTin ?? null,
      row.currency ?? null,
      row.language ?? null,
      row.vat_rate ?? row.vatRate ?? null,
      row.invoice_prefix ?? row.invoicePrefix ?? null,
      row.receipt_header ?? row.receiptHeader ?? null,
      row.receipt_footer ?? row.receiptFooter ?? null,
      now()
    );
    return { inserted: 0, updated: 1, skipped: 0, errors: [] };
  },
});

registerEntity({
  id: 'reports',
  label: 'Reports',
  formats: ['pdf', 'json', 'csv', 'xlsx'],
  isAvailable: () => true,
  export({ reportType = 'dailySummary', date, dateFrom, dateTo } = {}) {
    if (reportType === 'topProducts') {
      return reportService.topProducts(30, 50);
    }
    if (reportType === 'salesByDay' || reportType === 'monthlySales') {
      const to = dateTo || date || colomboDateString();
      const from = dateFrom || (() => {
        const d = new Date(to);
        d.setDate(d.getDate() - (reportType === 'monthlySales' ? 30 : 14));
        return d.toISOString().slice(0, 10);
      })();
      return reportService.salesByDay(from, to);
    }
    if (reportType === 'vatReport') {
      const day = date || colomboDateString();
      const summary = reportService.dailySummary(day);
      return [{
        date: summary.date,
        revenue: summary.revenue,
        vatTotal: summary.vatTotal,
        saleCount: summary.saleCount,
      }];
    }
    if (reportType === 'profitReport') {
      const day = date || colomboDateString();
      const summary = reportService.dailySummary(day);
      return [{
        date: summary.date,
        revenue: summary.revenue,
        costTotal: summary.costTotal,
        profit: summary.discountedProfit,
        marginPct: summary.marginPct,
      }];
    }
    if (reportType === 'lowStock') {
      requireTable('product_variants');
      return getDb()
        .prepare(`
          SELECT
            p.name AS productName,
            v.name AS variantName,
            v.sku,
            COALESCE(b.on_hand, 0) AS stockOnHand,
            v.low_stock_alert AS lowStockAlert
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN inventory_balances b ON b.variant_id = v.id
          WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
            AND v.low_stock_alert > 0
            AND COALESCE(b.on_hand, 0) <= v.low_stock_alert
          ORDER BY COALESCE(b.on_hand, 0) ASC
        `)
        .all();
    }
    return [reportService.dailySummary(date)];
  },
  import: null,
});

registerEntity({
  id: 'suppliers',
  label: 'Suppliers',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('suppliers'),
  export({ filters = {} } = {}) {
    requireTable('suppliers');
    const db = getDb();
    const activeClause = filters.activeOnly ? 'AND is_active = 1' : filters.inactiveOnly ? 'AND is_active = 0' : '';
    return db
      .prepare(`
        SELECT id, name, phone, address, notes, is_active AS isActive, created_at AS createdAt
        FROM suppliers
        WHERE deleted_at IS NULL ${activeClause}
        ORDER BY name
      `)
      .all();
  },
  validate(rows) {
    const errors = [];
    rows.forEach((row, i) => {
      if (!String(row.name || row.Name || '').trim()) {
        errors.push({ row: i + 1, message: 'Supplier name is required.' });
      }
    });
    return errors;
  },
  preview(rows) {
    return { total: rows.length, sample: rows.slice(0, 10), errors: this.validate(rows).slice(0, 20) };
  },
  import({ rows, mode = 'insert' }) {
    requireTable('suppliers');
    const db = getDb();
    const report = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const find = db.prepare(`SELECT id FROM suppliers WHERE lower(name) = lower(?) AND deleted_at IS NULL`);
    const insert = db.prepare(`
      INSERT INTO suppliers (id, name, phone, address, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const update = db.prepare(`
      UPDATE suppliers SET phone = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?
    `);
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const name = String(row.name || row.Name || '').trim();
        if (!name) {
          report.errors.push({ row: i + 1, message: 'Missing name' });
          continue;
        }
        const existing = find.get(name);
        if (existing) {
          if (mode === 'skip' || mode === 'insert') report.skipped += 1;
          else {
            update.run(
              String(row.phone || '').trim() || null,
              String(row.address || '').trim() || null,
              String(row.notes || '').trim() || null,
              now(),
              existing.id
            );
            report.updated += 1;
          }
        } else if (mode === 'update') {
          report.skipped += 1;
        } else {
          insert.run(
            crypto.randomUUID(),
            name,
            String(row.phone || '').trim() || null,
            String(row.address || '').trim() || null,
            String(row.notes || '').trim() || null,
            now(),
            now()
          );
          report.inserted += 1;
        }
      }
    });
    tx();
    return report;
  },
});

registerEntity({
  id: 'expenses',
  label: 'Expenses',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('expenses'),
  export({ dateFrom, dateTo, filters = {} } = {}) {
    requireTable('expenses');
    const db = getDb();
    const from = dateFrom ? colomboDayBounds(dateFrom).start : null;
    const to = dateTo ? colomboDayBounds(dateTo).end : null;
    const clauses = ['deleted_at IS NULL'];
    const params = [];
    if (from) {
      clauses.push('expense_date >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('expense_date <= ?');
      params.push(to);
    }
    if (filters.category) {
      clauses.push('lower(category) = lower(?)');
      params.push(filters.category);
    }
    return db
      .prepare(`
        SELECT
          id, expense_date AS expenseDate, category, amount,
          payment_method AS paymentMethod, note, created_at AS createdAt
        FROM expenses
        WHERE ${clauses.join(' AND ')}
        ORDER BY expense_date DESC
        LIMIT 100000
      `)
      .all(...params);
  },
  import: null,
});

registerEntity({
  id: 'purchases',
  label: 'Purchases (GRN)',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('purchase_receipts'),
  export({ dateFrom, dateTo } = {}) {
    requireTable('purchase_receipts');
    const db = getDb();
    const from = dateFrom ? colomboDayBounds(dateFrom).start : null;
    const to = dateTo ? colomboDayBounds(dateTo).end : null;
    const clauses = ['pr.deleted_at IS NULL'];
    const params = [];
    if (from) {
      clauses.push('COALESCE(pr.posted_at, pr.created_at) >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('COALESCE(pr.posted_at, pr.created_at) <= ?');
      params.push(to);
    }
    return db
      .prepare(`
        SELECT
          pr.grn_number AS grnNumber,
          s.name AS supplierName,
          pr.status,
          pr.total_cost AS totalCost,
          pr.received_at AS receivedAt,
          pr.posted_at AS postedAt,
          pr.notes,
          v.sku,
          p.name AS productName,
          pri.quantity,
          pri.unit_cost AS unitCost,
          pri.line_total AS lineTotal
        FROM purchase_receipts pr
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
        LEFT JOIN purchase_receipt_items pri ON pri.receipt_id = pr.id
        LEFT JOIN product_variants v ON v.id = pri.variant_id
        LEFT JOIN products p ON p.id = v.product_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY pr.created_at DESC
        LIMIT 100000
      `)
      .all(...params);
  },
  import: null,
});

registerEntity({
  id: 'returns',
  label: 'Returns',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('sale_returns'),
  export({ dateFrom, dateTo } = {}) {
    requireTable('sale_returns');
    const db = getDb();
    const from = dateFrom ? colomboDayBounds(dateFrom).start : null;
    const to = dateTo ? colomboDayBounds(dateTo).end : null;
    const clauses = ['1=1'];
    const params = [];
    if (from) {
      clauses.push('r.created_at >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('r.created_at <= ?');
      params.push(to);
    }
    return db
      .prepare(`
        SELECT
          r.return_number AS returnNumber,
          s.invoice_number AS invoiceNumber,
          r.refund_total AS refundTotal,
          r.refund_method AS refundMethod,
          r.reason,
          r.status,
          r.created_at AS createdAt,
          v.sku,
          ri.quantity,
          ri.unit_refund AS unitRefund,
          ri.line_refund AS lineRefund
        FROM sale_returns r
        JOIN sales s ON s.id = r.sale_id
        LEFT JOIN sale_return_items ri ON ri.return_id = r.id
        LEFT JOIN product_variants v ON v.id = ri.variant_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT 100000
      `)
      .all(...params);
  },
  import: null,
});

registerEntity({
  id: 'stock_adjustments',
  label: 'Stock Adjustments',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('inventory_transactions'),
  export({ dateFrom, dateTo } = {}) {
    requireTable('inventory_transactions');
    const db = getDb();
    const from = dateFrom || null;
    const to = dateTo || null;
    const clauses = [`t.transaction_type IN ('adjustment', 'initial', 'damage', 'count')`];
    const params = [];
    if (from) {
      clauses.push('t.created_at >= ?');
      params.push(colomboDayBounds(from).start);
    }
    if (to) {
      clauses.push('t.created_at <= ?');
      params.push(colomboDayBounds(to).end);
    }
    return db
      .prepare(`
        SELECT
          t.created_at AS createdAt,
          t.transaction_type AS type,
          t.quantity,
          t.notes,
          v.sku,
          p.name AS productName,
          v.name AS variantName,
          u.username AS createdBy
        FROM inventory_transactions t
        JOIN product_variants v ON v.id = t.variant_id
        JOIN products p ON p.id = v.product_id
        LEFT JOIN users u ON u.id = t.created_by
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT 100000
      `)
      .all(...params);
  },
  import: null,
});

registerEntity({
  id: 'low_stock',
  label: 'Low Stock Report',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('product_variants'),
  export() {
    requireTable('product_variants');
    return getDb()
      .prepare(`
        SELECT
          p.name AS productName,
          v.name AS variantName,
          v.sku,
          v.barcode,
          COALESCE(b.on_hand, 0) AS stockOnHand,
          v.low_stock_alert AS lowStockAlert,
          CASE
            WHEN COALESCE(b.on_hand, 0) <= 0 THEN 'Out of stock'
            ELSE 'Low stock'
          END AS status
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN inventory_balances b ON b.variant_id = v.id
        WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
          AND v.low_stock_alert > 0
          AND COALESCE(b.on_hand, 0) <= v.low_stock_alert
        ORDER BY COALESCE(b.on_hand, 0) ASC
      `)
      .all();
  },
  import: null,
});

// Customers module is not in schema yet — stub for UI discoverability
registerEntity({
  id: 'customers',
  label: 'Customers',
  formats: ['csv', 'xlsx', 'json'],
  isAvailable: () => tableExists('customers'),
  export() {
    requireTable('customers');
    return getDb().prepare(`SELECT * FROM customers WHERE deleted_at IS NULL LIMIT 100000`).all();
  },
  import: null,
});

export default { registerEntity, listEntities, getEntity };
