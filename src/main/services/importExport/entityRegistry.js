import crypto from 'crypto';
import { getDb } from '../../database/db.js';
import { tableExists } from './formatUtils.js';
import reportService from '../reportService.js';

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
  export() {
    requireTable('products');
    const db = getDb();
    return db
      .prepare(`
        SELECT
          p.id AS productId,
          p.name AS productName,
          p.brand,
          p.tax_rate AS taxRate,
          p.unit,
          c.name AS categoryName,
          v.id AS variantId,
          v.name AS variantName,
          v.sku,
          v.barcode,
          v.selling_price AS sellingPrice,
          v.cost_price AS costPrice,
          v.track_inventory AS trackInventory,
          COALESCE(b.on_hand, 0) AS stockOnHand
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL
        LEFT JOIN inventory_balances b ON b.variant_id = v.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.name, v.sort_order
      `)
      .all();
  },
  validate(rows) {
    const errors = [];
    rows.forEach((row, i) => {
      const name = String(row.productName || row.name || row.Name || '').trim();
      const sku = String(row.sku || row.SKU || '').trim();
      if (!name) errors.push({ row: i + 1, message: 'Product name is required.' });
      if (!sku) errors.push({ row: i + 1, message: 'SKU is required.' });
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
    requireTable('products');
    const db = getDb();
    const report = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const findVariant = db.prepare(
      `SELECT id, product_id FROM product_variants WHERE sku = ? AND deleted_at IS NULL`
    );
    const findCategory = db.prepare(
      `SELECT id FROM categories WHERE lower(name) = lower(?) AND deleted_at IS NULL`
    );
    const insertProduct = db.prepare(`
      INSERT INTO products (id, name, brand, tax_rate, category_id, unit, image_urls_json, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)
    `);
    const insertVariant = db.prepare(`
      INSERT INTO product_variants (
        id, product_id, name, sku, barcode, attributes_json, selling_price, cost_price,
        track_inventory, is_default, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 1, 1, 0, 1, ?, ?)
    `);
    const insertBalance = db.prepare(`
      INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `);
    const updateVariant = db.prepare(`
      UPDATE product_variants SET
        selling_price = ?, cost_price = ?, barcode = ?, updated_at = ?
      WHERE id = ?
    `);
    const updateProduct = db.prepare(`
      UPDATE products SET name = ?, brand = ?, tax_rate = ?, updated_at = ? WHERE id = ?
    `);
    const upsertBalance = db.prepare(`
      INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(variant_id) DO UPDATE SET
        on_hand = excluded.on_hand,
        available = excluded.available,
        updated_at = excluded.updated_at
    `);

    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const productName = String(row.productName || row.name || '').trim();
        const sku = String(row.sku || '').trim();
        if (!productName || !sku) {
          report.errors.push({ row: i + 1, message: 'Name and SKU required' });
          continue;
        }
        const sellingPrice = Number(row.sellingPrice ?? row.selling_price ?? 0) || 0;
        const costPrice = Number(row.costPrice ?? row.cost_price ?? 0) || 0;
        const taxRate = Number(row.taxRate ?? row.tax_rate ?? 0) || 0;
        const brand = String(row.brand || '').trim() || null;
        const barcode = String(row.barcode || '').trim() || null;
        const stock = Number(row.stockOnHand ?? row.stock ?? row.on_hand ?? 0) || 0;
        let categoryId = null;
        const categoryName = String(row.categoryName || row.category || '').trim();
        if (categoryName) {
          const cat = findCategory.get(categoryName);
          categoryId = cat?.id || null;
        }

        const existing = findVariant.get(sku);
        if (existing) {
          if (mode === 'skip') {
            report.skipped += 1;
          } else if (mode === 'update') {
            updateVariant.run(sellingPrice, costPrice, barcode, now(), existing.id);
            updateProduct.run(productName, brand, taxRate, now(), existing.product_id);
            upsertBalance.run(existing.id, stock, stock, now());
            report.updated += 1;
          } else {
            report.skipped += 1;
          }
        } else if (mode === 'update') {
          report.skipped += 1;
        } else {
          const productId = crypto.randomUUID();
          const variantId = crypto.randomUUID();
          insertProduct.run(productId, productName, brand, taxRate, categoryId, row.unit || null, now(), now());
          insertVariant.run(
            variantId,
            productId,
            row.variantName || 'Default',
            sku,
            barcode,
            sellingPrice,
            costPrice,
            now(),
            now()
          );
          insertBalance.run(variantId, stock, stock, now());
          report.inserted += 1;
        }
      }
    });
    tx();
    return report;
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
  formats: ['pdf', 'json', 'csv'],
  isAvailable: () => true,
  export({ reportType = 'dailySummary', date } = {}) {
    if (reportType === 'topProducts') {
      return reportService.topProducts(30, 50);
    }
    if (reportType === 'salesByDay') {
      const to = date || new Date().toISOString().slice(0, 10);
      const fromDate = new Date(to);
      fromDate.setDate(fromDate.getDate() - 14);
      return reportService.salesByDay(fromDate.toISOString().slice(0, 10), to);
    }
    return [reportService.dailySummary(date)];
  },
  import: null,
});

// Placeholders for future modules — register so UI can show "coming soon"
for (const future of [
  { id: 'customers', label: 'Customers', table: 'customers' },
  { id: 'suppliers', label: 'Suppliers', table: 'suppliers' },
  { id: 'expenses', label: 'Expenses', table: 'expenses' },
  { id: 'purchase_orders', label: 'Purchase Orders', table: 'purchase_orders' },
]) {
  registerEntity({
    id: future.id,
    label: future.label,
    formats: ['csv', 'xlsx', 'json'],
    isAvailable: () => tableExists(future.table),
    export() {
      requireTable(future.table);
      return getDb().prepare(`SELECT * FROM ${future.table} LIMIT 100000`).all();
    },
    validate: () => [],
    preview(rows) {
      return { total: rows.length, sample: rows.slice(0, 10), errors: [] };
    },
    import({ rows }) {
      requireTable(future.table);
      return { inserted: 0, updated: 0, skipped: rows.length, errors: [{ row: 0, message: 'Generic import not configured for this module yet.' }] };
    },
  });
}

export default { registerEntity, listEntities, getEntity };
