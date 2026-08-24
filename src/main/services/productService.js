import crypto from 'crypto';
import { getDb } from '../database/db.js';
import { applyInventoryMovement, getInventoryCost, recordInventoryMovement } from './inventoryCostService.js';

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

function normalizeLowStockAlert(value) {
  return Math.max(0, toNumber(value, 0));
}

function normalizePriceType(value) {
  return String(value ?? '').trim().toUpperCase() === 'MRP' ? 'MRP' : 'FREE';
}

function calculateMargin(sellingPrice, costPrice) {
  const selling = toNumber(sellingPrice, 0);
  const cost = toNumber(costPrice, 0);
  const marginAmount = roundMoney(selling - cost);
  const marginPct = selling > 0 ? roundMoney((marginAmount / selling) * 100) : 0;
  return { marginAmount, marginPct };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function generateSku(productName, index = 0) {
  const prefix = cleanText(productName)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 10) || 'SKU';
  const suffix = crypto.randomUUID().split('-')[0].toUpperCase();
  return `${prefix}-${index + 1}-${suffix}`;
}

function generateDailySku(db, timestamp = now(), sequenceOffset = 0) {
  const day = String(timestamp).slice(0, 10).replace(/-/g, '');
  const row = db.prepare(`
    SELECT sku
    FROM product_variants
    WHERE sku LIKE ?
    ORDER BY sku DESC
    LIMIT 1
  `).get(`PRD-${day}-%`);

  const lastSequence = row?.sku
    ? Number.parseInt(String(row.sku).slice(-4), 10) || 0
    : 0;
  const nextSequence = lastSequence + 1 + sequenceOffset;
  return `PRD-${day}-${String(nextSequence).padStart(4, '0')}`;
}

function generateBarcode() {
  return `AUTO-${Date.now()}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function normalizeCategoryRow(row, depth = 0, path = []) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id || null,
    isActive: Boolean(row.is_active),
    depth,
    path: [...path, row.name].join(' > '),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function normalizeVariantRow(row) {
  const priceType = normalizePriceType(row.price_type);
  const { marginAmount, marginPct } = calculateMargin(row.selling_price, row.cost_price);
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    attributes: parseJsonObject(row.attributes_json),
    sellingPrice: toNumber(row.selling_price),
    costPrice: toNumber(row.cost_price),
    priceType,
    lowStockAlert: toNumber(row.low_stock_alert),
    trackInventory: Boolean(row.track_inventory),
    isDefault: Boolean(row.is_default),
    isHidden: Boolean(row.is_hidden),
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    marginAmount,
    marginPct,
    inventory: {
      onHand: toNumber(row.on_hand),
      reserved: toNumber(row.reserved),
      available: toNumber(row.available),
      updatedAt: row.inventory_updated_at || null,
    },
  };
}

function normalizeProductRow(row, variants = [], category = null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    brand: row.brand,
    unit: row.unit,
    hasExpiry: Boolean(row.has_expiry),
    categoryId: row.category_id || null,
    category,
    imageUrls: parseJsonArray(row.image_urls_json),
    isActive: Boolean(row.is_active),
    isDraft: Boolean(row.is_draft),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    variants,
    expiryHistory: parseJsonArray(row.expiry_history),
    inventoryTotal: variants.reduce((sum, variant) => sum + toNumber(variant.inventory?.onHand), 0),
    defaultVariant: variants.find((variant) => variant.isDefault) || variants[0] || null,
  };
}

function mapExpiryHistoryRow(row) {
  const saleStatus = cleanText(row.sale_status).toLowerCase();
  return {
    receiptItemId: row.receipt_item_id,
    receiptId: row.receipt_id,
    grnNumber: row.grn_number,
    receiptStatus: row.receipt_status,
    variantId: row.variant_id,
    variantName: row.variant_name,
    sku: row.sku,
    batchNumber: row.batch_number || null,
    expiryDate: row.expiry_date || null,
    saleStatus: saleStatus === 'discounted' || saleStatus === 'removed' ? saleStatus : 'active',
    quantity: toNumber(row.quantity),
    unitCost: toNumber(row.unit_cost),
    lineTotal: toNumber(row.line_total),
    receivedDate: row.received_date || null,
    createdAt: row.created_at,
  };
}

function loadExpiryHistory(db, productId, limit = 12) {
  return db.prepare(`
    SELECT
      pri.id AS receipt_item_id,
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
      pv.name AS variant_name,
      pv.sku
    FROM purchase_receipt_items pri
    JOIN purchase_receipts pr ON pr.id = pri.receipt_id
    JOIN product_variants pv ON pv.id = pri.variant_id
    WHERE pr.deleted_at IS NULL
      AND pr.status = 'posted'
      AND pv.product_id = ?
      AND pri.expiry_date IS NOT NULL
    ORDER BY pri.expiry_date ASC, pr.created_at DESC
    LIMIT ?
  `).all(productId, limit).map(mapExpiryHistoryRow);
}

function getCategoryTree(rows) {
  const byParent = new Map();
  for (const row of rows) {
    const parentKey = row.parent_id || null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(row);
  }

  const output = [];
  const walk = (parentId = null, depth = 0, path = []) => {
    const children = byParent.get(parentId) || [];
    children
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((child) => {
        const normalized = normalizeCategoryRow(child, depth, path);
        output.push(normalized);
        walk(child.id, depth + 1, [...path, child.name]);
      });
  };

  walk(null, 0, []);
  return output;
}

function assertTruthy(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function friendlyDbError(err) {
  const message = String(err?.message || err || '');
  if (message.includes('idx_categories_parent_name')) {
    return 'A category with this name already exists under the same parent.';
  }
  if (message.includes('idx_product_variants_sku')) {
    return 'This SKU is already used by another product. Enter a different SKU.';
  }
  if (message.includes('idx_product_variants_barcode')) {
    return 'This barcode is already used by another product.';
  }
  if (message.includes('UNIQUE constraint failed')) {
    return 'That value is already in use. Please use a different one.';
  }
  return message || 'Something went wrong.';
}

function wrapDbCall(fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(friendlyDbError(err));
  }
}

/** Outgoing stock types expect a positive quantity in the UI and store a negative delta. */
function signedStockDelta(quantity, transactionType) {
  const amount = Math.abs(toNumber(quantity, 0));
  if (!amount) return 0;

  const outgoing = new Set(['sale', 'return_out', 'transfer_out']);
  const type = cleanText(transactionType).toLowerCase();
  if (outgoing.has(type)) return -amount;
  if (type === 'adjustment') return toNumber(quantity, 0);
  return amount;
}

function findCategoryDuplicate(db, name, parentId = null, excludeId = null) {
  const parentKey = parentId || null;
  const rows = db.prepare(`
    SELECT id, name, parent_id
    FROM categories
    WHERE deleted_at IS NULL
      AND LOWER(name) = LOWER(?)
      AND (
        (parent_id IS NULL AND ? IS NULL)
        OR parent_id = ?
      )
  `).all(name, parentKey, parentKey);

  return rows.find((row) => row.id !== excludeId) || null;
}

function assertCategoryExists(db, categoryId) {
  if (!categoryId) return;
  const category = db.prepare(`
    SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL
  `).get(categoryId);
  if (!category) {
    throw new Error('Selected category was not found.');
  }
}

function prepareVariantPayload(productName, variant, index = 0, isSimpleDefault = false) {
  const normalized = parseJsonObject(variant?.attributes || variant?.attributesJson);
  const variantName = cleanText(variant?.name) || productName;
  const sku = cleanText(variant?.sku);
  const barcode = cleanText(variant?.barcode) || generateBarcode();
  const sellingPrice = toNumber(variant?.sellingPrice ?? variant?.selling_price, 0);
  const costPrice = toNumber(variant?.costPrice ?? variant?.cost_price, 0);
  const priceType = normalizePriceType(variant?.priceType ?? variant?.price_type);
  if (costPrice < 0 || Number.isNaN(costPrice)) {
    throw new Error(`Cost price must be 0 or greater for variant "${variantName}".`);
  }

  return {
    id: cleanText(variant?.id) || crypto.randomUUID(),
    name: variantName,
    sku,
    barcode,
    attributesJson: JSON.stringify(normalized),
    sellingPrice,
    costPrice,
    priceType,
    lowStockAlert: normalizeLowStockAlert(variant?.lowStockAlert ?? variant?.low_stock_alert),
    trackInventory: variant?.trackInventory === false || variant?.track_inventory === 0 ? 0 : 1,
    isDefault: (variant?.isDefault || isSimpleDefault) ? 1 : 0,
    isHidden: (variant?.isHidden || isSimpleDefault) ? 1 : 0,
    sortOrder: toNumber(variant?.sortOrder ?? variant?.sort_order, index),
    isActive: variant?.isActive === false ? 0 : 1,
    initialStock: variant?.initialStock === undefined || variant?.initialStock === '' ? null : toNumber(variant.initialStock, null),
  };
}

function upsertInventoryBalance(db, variantId, delta) {
  const existing = db
    .prepare(`SELECT variant_id, on_hand, reserved FROM inventory_balances WHERE variant_id = ?`)
    .get(variantId);

  const currentOnHand = existing ? toNumber(existing.on_hand) : 0;
  const currentReserved = existing ? toNumber(existing.reserved) : 0;
  const nextOnHand = currentOnHand + delta;
  const nextAvailable = nextOnHand - currentReserved;
  const timestamp = now();

  if (existing) {
    db.prepare(`
      UPDATE inventory_balances
      SET on_hand = ?, available = ?, updated_at = ?
      WHERE variant_id = ?
    `).run(nextOnHand, nextAvailable, timestamp, variantId);
  } else {
    db.prepare(`
      INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `).run(variantId, nextOnHand, nextAvailable, timestamp);
  }
}

const productService = {
  listCategories() {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, name, parent_id, is_active, created_at, updated_at, deleted_at
      FROM categories
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `).all();

    return getCategoryTree(rows);
  },

  createCategory({ name, parentId = null }) {
    const db = getDb();
    const categoryName = cleanText(name);
    assertTruthy(categoryName, 'Category name is required.');

    if (parentId) {
      const parent = db.prepare(`
        SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL
      `).get(parentId);
      if (!parent) {
        throw new Error('Parent category not found.');
      }
    }

    const duplicate = findCategoryDuplicate(db, categoryName, parentId || null);
    if (duplicate) {
      throw new Error(
        `A category named "${duplicate.name}" already exists here. Category names must be unique (case does not matter).`
      );
    }

    const id = crypto.randomUUID();
    const timestamp = now();

    wrapDbCall(() => {
      db.prepare(`
        INSERT INTO categories (id, name, parent_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(id, categoryName, parentId || null, timestamp, timestamp);
    });

    return {
      id,
      name: categoryName,
      parentId: parentId || null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  },

  updateCategory(categoryId, { name } = {}) {
    const db = getDb();
    const cleanCategoryId = cleanText(categoryId);
    const categoryName = cleanText(name);
    assertTruthy(cleanCategoryId, 'Category ID is required.');
    assertTruthy(categoryName, 'Category name is required.');

    const category = db.prepare(`
      SELECT id, name, parent_id, is_active
      FROM categories
      WHERE id = ? AND deleted_at IS NULL
    `).get(cleanCategoryId);
    if (!category) throw new Error('Category not found.');

    const duplicate = findCategoryDuplicate(db, categoryName, category.parent_id, cleanCategoryId);
    if (duplicate) {
      throw new Error(
        `A category named "${duplicate.name}" already exists here. Category names must be unique (case does not matter).`
      );
    }

    const timestamp = now();
    wrapDbCall(() => {
      db.prepare(`
        UPDATE categories
        SET name = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(categoryName, timestamp, cleanCategoryId);
    });

    return {
      id: category.id,
      name: categoryName,
      parentId: category.parent_id || null,
      isActive: Boolean(category.is_active),
      updatedAt: timestamp,
    };
  },

  listProducts() {
    const db = getDb();
    const products = db.prepare(`
      SELECT id, name, description, brand, unit, category_id, image_urls_json,
             has_expiry, is_active, is_draft, created_at, updated_at, deleted_at
      FROM products
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `).all();

    const variants = db.prepare(`
      SELECT
        v.id,
        v.product_id,
        v.name,
        v.sku,
        v.barcode,
        v.attributes_json,
        v.selling_price,
        v.cost_price,
        v.price_type,
        v.low_stock_alert,
        v.track_inventory,
        v.is_default,
        v.is_hidden,
        v.sort_order,
        v.is_active,
        v.created_at,
        v.updated_at,
        v.deleted_at,
        b.on_hand,
        b.reserved,
        b.available,
        b.updated_at AS inventory_updated_at
      FROM product_variants v
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      WHERE v.deleted_at IS NULL
      ORDER BY v.sort_order ASC, v.created_at ASC
    `).all();

    const variantsByProduct = new Map();
    for (const variant of variants) {
      if (!variantsByProduct.has(variant.product_id)) {
        variantsByProduct.set(variant.product_id, []);
      }
      variantsByProduct.get(variant.product_id).push(normalizeVariantRow(variant));
    }

    const categories = this.listCategories();
    const categoryMap = new Map(categories.map((category) => [category.id, category]));

    return products.map((product) =>
      normalizeProductRow(
        {
          ...product,
          expiry_history: loadExpiryHistory(db, product.id),
        },
        variantsByProduct.get(product.id) || [],
        product.category_id ? categoryMap.get(product.category_id) || null : null
      )
    );
  },

  listLowStock() {
    const db = getDb();
    const rows = db.prepare(`
      SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.low_stock_alert,
             p.id AS product_id, p.name AS product_name,
             COALESCE(b.on_hand, 0) AS current_stock
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
        AND v.is_active = 1 AND p.is_active = 1
        AND v.track_inventory = 1
        AND v.low_stock_alert > 0
        AND COALESCE(b.on_hand, 0) <= v.low_stock_alert
      ORDER BY current_stock ASC, p.name ASC, v.name ASC
    `).all();
    return rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      variantName: row.variant_name || row.sku,
      currentStock: toNumber(row.current_stock),
      alertThreshold: toNumber(row.low_stock_alert),
      status: Number(row.current_stock) <= 0 ? 'Out of Stock' : 'Low Stock',
    }));
  },

  disableLowStockAlert(variantId) {
    const db = getDb();
    const result = db.prepare(`UPDATE product_variants SET low_stock_alert = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(now(), cleanText(variantId));
    if (!result.changes) throw new Error('Variant not found.');
    return true;
  },

  getProductById(productId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, name, description, brand, unit, category_id, image_urls_json,
             has_expiry, is_active, is_draft, created_at, updated_at, deleted_at
      FROM products
      WHERE id = ? AND deleted_at IS NULL
    `).get(productId);

    if (!row) return null;

    const variants = db.prepare(`
      SELECT
        v.id,
        v.product_id,
        v.name,
        v.sku,
        v.barcode,
        v.attributes_json,
        v.selling_price,
        v.cost_price,
        v.price_type,
        v.low_stock_alert,
        v.track_inventory,
        v.is_default,
        v.is_hidden,
        v.sort_order,
        v.is_active,
        v.created_at,
        v.updated_at,
        v.deleted_at,
        b.on_hand,
        b.reserved,
        b.available,
        b.updated_at AS inventory_updated_at
      FROM product_variants v
      LEFT JOIN inventory_balances b
        ON b.variant_id = v.id
      WHERE v.product_id = ?
        AND v.deleted_at IS NULL
      ORDER BY v.is_default DESC, v.sort_order ASC, v.created_at ASC
    `).all(productId).map(normalizeVariantRow);

    const categories = this.listCategories();
    const categoryMap = new Map(categories.map((category) => [category.id, category]));

    return normalizeProductRow(
      {
        ...row,
        expiry_history: loadExpiryHistory(db, row.id),
      },
      variants,
      row.category_id ? categoryMap.get(row.category_id) || null : null
    );
  },

  lookupVariantByBarcode(barcode) {
    const db = getDb();
    const cleanBarcode = String(barcode ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim();
    if (!cleanBarcode) return null;

    const row = db.prepare(`
      SELECT
        v.id,
        v.product_id,
        v.name,
        v.sku,
        v.barcode,
        v.attributes_json,
        v.selling_price,
        COALESCE(ic.average_cost, v.cost_price) AS cost_price,
        v.price_type,
        v.low_stock_alert,
        v.track_inventory,
        v.is_default,
        v.is_hidden,
        v.sort_order,
        v.is_active,
        v.created_at,
        v.updated_at,
        v.deleted_at,
        b.on_hand,
        b.reserved,
        b.available,
        b.updated_at AS inventory_updated_at,
        p.id AS product_id_ref,
        p.name AS product_name,
        p.description AS product_description,
        p.brand AS product_brand,
        p.unit AS product_unit,
        p.category_id AS product_category_id,
        p.image_urls_json AS product_image_urls_json,
        p.has_expiry AS product_has_expiry,
        p.is_active AS product_is_active,
        p.created_at AS product_created_at,
        p.updated_at AS product_updated_at,
        p.deleted_at AS product_deleted_at
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      LEFT JOIN inventory_costing ic ON ic.variant_id = v.id
      WHERE (lower(v.barcode) = lower(?) OR lower(v.sku) = lower(?))
        AND v.deleted_at IS NULL
        AND v.is_active = 1
        AND p.deleted_at IS NULL
        AND p.is_active = 1
      ORDER BY CASE WHEN lower(v.barcode) = lower(?) THEN 0 ELSE 1 END
      LIMIT 1
    `).get(cleanBarcode, cleanBarcode, cleanBarcode);

    if (!row) return null;

    const product = normalizeProductRow(
      {
        id: row.product_id_ref,
        name: row.product_name,
        description: row.product_description,
        brand: row.product_brand,
        unit: row.product_unit,
        category_id: row.product_category_id,
        image_urls_json: row.product_image_urls_json,
        has_expiry: row.product_has_expiry,
        is_active: row.product_is_active,
        created_at: row.product_created_at,
        updated_at: row.product_updated_at,
        deleted_at: row.product_deleted_at,
        expiry_history: loadExpiryHistory(db, row.product_id_ref),
      },
      [normalizeVariantRow(row)]
    );

    return {
      ...normalizeVariantRow(row),
      product,
    };
  },

  createProduct(payload = {}) {
    const db = getDb();
    const productName = cleanText(payload.name);
    assertTruthy(productName, 'Product name is required.');

    const categoryId = cleanText(payload.categoryId) || null;
    assertCategoryExists(db, categoryId);
    const unit = cleanText(payload.unit) || null;

    const variantsInput = Array.isArray(payload.variants) && payload.variants.length
      ? payload.variants
      : [payload.variant || {}];

    const normalizedVariants = variantsInput.map((variant, index) => prepareVariantPayload(
      productName,
      variant,
      index,
      variantsInput.length === 1
    ));

    const skuSeed = normalizedVariants.reduce((count, variant) => count + (variant.sku ? 0 : 1), 0);
    let skuIndex = 0;
    for (const variant of normalizedVariants) {
      if (!variant.sku) {
        variant.sku = generateDailySku(db, now(), skuIndex);
        skuIndex += 1;
      }
    }

    const hasDefault = normalizedVariants.some((variant) => variant.isDefault);
    if (!hasDefault && normalizedVariants.length) {
      normalizedVariants[0].isDefault = 1;
    }

    const seenSkus = new Set();
    const seenBarcodes = new Set();
    for (const variant of normalizedVariants) {
      if (seenSkus.has(variant.sku)) {
        throw new Error(`Duplicate SKU in payload: ${variant.sku}`);
      }
      seenSkus.add(variant.sku);

      if (variant.barcode) {
        const barcodeKey = variant.barcode.toLowerCase();
        if (seenBarcodes.has(barcodeKey)) {
          throw new Error(`Duplicate barcode in payload: ${variant.barcode}`);
        }
        const conflict = db.prepare(`
          SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE lower(v.barcode) = lower(?) AND v.deleted_at IS NULL AND p.deleted_at IS NULL LIMIT 1
        `).get(variant.barcode);
        if (conflict) throw new Error(`${conflict.name} has the same barcode.`);
        seenBarcodes.add(barcodeKey);
      }
    }

    const id = crypto.randomUUID();
    const timestamp = now();
    const imageUrlsJson = JSON.stringify(parseJsonArray(payload.imageUrls || payload.imageUrlsJson));
    const hasExpiry = Boolean(payload.hasExpiry);
    const initialStockByVariant = new Map();

    for (let index = 0; index < variantsInput.length; index += 1) {
      const rawStock = variantsInput[index]?.initialStock ?? variantsInput[index]?.stock;
      const stockQty = toNumber(rawStock, 0);
      if (stockQty > 0) {
        initialStockByVariant.set(normalizedVariants[index].id, stockQty);
      }
    }

    // Product-level initialStock applies to the default/first variant when creating.
    const productInitialStock = toNumber(payload.initialStock, 0);
    if (productInitialStock > 0 && normalizedVariants[0]) {
      const existing = initialStockByVariant.get(normalizedVariants[0].id) || 0;
      initialStockByVariant.set(normalizedVariants[0].id, existing + productInitialStock);
    }

    const createTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO products (
          id, name, description, brand, unit, category_id, image_urls_json,
          has_expiry, is_active, is_draft, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        id,
        productName,
        cleanText(payload.description) || null,
        cleanText(payload.brand) || null,
        unit,
        categoryId,
        imageUrlsJson,
        hasExpiry ? 1 : 0,
        payload.isDraft ? 1 : 0,
        timestamp,
        timestamp
      );

      for (const variant of normalizedVariants) {
        db.prepare(`
          INSERT INTO product_variants (
            id, product_id, name, sku, barcode, attributes_json,
            selling_price, cost_price, price_type, low_stock_alert, track_inventory, is_default,
            is_hidden, sort_order, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          variant.id,
          id,
          variant.name,
          variant.sku,
          variant.barcode,
          variant.attributesJson,
          variant.sellingPrice,
          variant.costPrice,
          variant.priceType,
          variant.lowStockAlert,
          variant.trackInventory,
          variant.isDefault,
          variant.isHidden,
          variant.sortOrder,
          variant.isActive,
          timestamp,
          timestamp
        );

        const openingStock = initialStockByVariant.get(variant.id) || 0;
        if (openingStock > 0) {
          applyInventoryMovement(db, {
            variantId: variant.id,
            quantity: openingStock,
            transactionType: 'initial',
            unitCost: variant.costPrice,
            referenceType: 'product',
            referenceId: id,
            notes: 'Opening stock on create',
            createdBy: payload.createdBy || null,
            timestamp,
          });
        } else {
          db.prepare(`
            INSERT OR IGNORE INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
            VALUES (?, 0, 0, 0, ?)
          `).run(variant.id, timestamp);
          db.prepare(`
            INSERT OR IGNORE INTO inventory_costing
              (variant_id, quantity, inventory_value, average_cost, is_reconciled, backfill_status, updated_at)
            VALUES (?, 0, 0, 0, 1, 'live', ?)
          `).run(variant.id, timestamp);
        }
      }
    });

    wrapDbCall(() => createTx());
    return this.getProductById(id);
  },

  updateProduct(productId, payload = {}) {
    const db = getDb();
    const existing = this.getProductById(productId);
    if (!existing) {
      throw new Error('Product not found.');
    }

    const timestamp = now();
    const nextName = cleanText(payload.name) || existing.name;
    const nextCategoryId = Object.prototype.hasOwnProperty.call(payload, 'categoryId')
      ? cleanText(payload.categoryId) || null
      : existing.categoryId;
    assertCategoryExists(db, nextCategoryId);
    const nextImageUrlsJson = Object.prototype.hasOwnProperty.call(payload, 'imageUrls')
      || Object.prototype.hasOwnProperty.call(payload, 'imageUrlsJson')
      ? JSON.stringify(parseJsonArray(payload.imageUrls || payload.imageUrlsJson))
      : JSON.stringify(existing.imageUrls || []);
    const nextUnit = Object.prototype.hasOwnProperty.call(payload, 'unit')
      ? cleanText(payload.unit) || null
      : existing.unit || null;
    const nextHasExpiry = Object.prototype.hasOwnProperty.call(payload, 'hasExpiry')
      ? Boolean(payload.hasExpiry)
      : Boolean(existing.hasExpiry);
    const nextIsDraft = Object.prototype.hasOwnProperty.call(payload, 'isDraft')
      ? Boolean(payload.isDraft)
      : Boolean(existing.isDraft);

    const variantsInput = Array.isArray(payload.variants) ? payload.variants : null;
    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET name = ?,
            description = ?,
            brand = ?,
            unit = ?,
            category_id = ?,
            image_urls_json = ?,
            has_expiry = ?,
            is_draft = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        nextName,
        Object.prototype.hasOwnProperty.call(payload, 'description') ? (cleanText(payload.description) || null) : existing.description,
        Object.prototype.hasOwnProperty.call(payload, 'brand') ? (cleanText(payload.brand) || null) : existing.brand,
        nextUnit,
        nextCategoryId,
        nextImageUrlsJson,
        nextHasExpiry ? 1 : 0,
        nextIsDraft ? 1 : 0,
        timestamp,
        productId
      );

      if (!variantsInput) return;

      if (!Array.isArray(variantsInput) || !variantsInput.length) {
        throw new Error('At least one variant with selling and cost prices is required.');
      }

      const currentVariants = db.prepare(`
        SELECT id
        FROM product_variants
        WHERE product_id = ?
          AND deleted_at IS NULL
      `).all(productId);
      const existingVariantIds = new Set(currentVariants.map((variant) => variant.id));
      const currentVariantMap = new Map(
        db.prepare(`
          SELECT id, selling_price, price_type
          FROM product_variants
          WHERE product_id = ?
            AND deleted_at IS NULL
        `).all(productId).map((row) => [row.id, row])
      );
      const normalizedVariants = variantsInput.map((variant, index) => prepareVariantPayload(
        nextName,
        variant,
        index,
        variantsInput.length === 1
      ));

      let skuIndex = 0;
      for (const variant of normalizedVariants) {
        if (!variant.sku) {
          variant.sku = generateDailySku(db, timestamp, skuIndex);
          skuIndex += 1;
        }
      }

      const hasDefault = normalizedVariants.some((variant) => variant.isDefault);
      if (!hasDefault && normalizedVariants.length) {
        normalizedVariants[0].isDefault = 1;
      }

      const seenSkus = new Set();
      const seenBarcodes = new Set();
      for (const variant of normalizedVariants) {
        if (seenSkus.has(variant.sku)) {
          throw new Error(`Duplicate SKU in payload: ${variant.sku}`);
        }
        seenSkus.add(variant.sku);

        if (variant.barcode) {
          const barcodeKey = variant.barcode.toLowerCase();
          if (seenBarcodes.has(barcodeKey)) {
            throw new Error(`Duplicate barcode in payload: ${variant.barcode}`);
          }
          const conflict = db.prepare(`
            SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE lower(v.barcode) = lower(?) AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.id <> ? LIMIT 1
          `).get(variant.barcode, productId);
          if (conflict) throw new Error(`${conflict.name} has the same barcode.`);
          seenBarcodes.add(barcodeKey);
        }

        if (variant.id && existingVariantIds.has(variant.id)) {
          const current = currentVariantMap.get(variant.id);
          if (normalizePriceType(current?.price_type) === 'MRP' && normalizePriceType(variant.priceType) === 'MRP') {
            const currentSelling = toNumber(current?.selling_price, 0);
            if (Math.abs(toNumber(variant.sellingPrice, 0) - currentSelling) > 0.0001) {
              throw new Error(`Selling price is locked for MRP variant "${variant.name}". Change the price type to FREE to edit it.`);
            }
          }
          db.prepare(`
            UPDATE product_variants
            SET name = ?,
                sku = ?,
                barcode = ?,
                attributes_json = ?,
                selling_price = ?,
                cost_price = COALESCE((SELECT average_cost FROM inventory_costing WHERE variant_id = ?), ?),
                price_type = ?,
                low_stock_alert = ?,
                track_inventory = ?,
                is_default = ?,
                is_hidden = ?,
                sort_order = ?,
                is_active = ?,
                deleted_at = NULL,
                updated_at = ?
            WHERE id = ?
          `).run(
            variant.name,
              variant.sku,
              variant.barcode,
              variant.attributesJson,
              variant.sellingPrice,
              variant.id,
              variant.costPrice,
              variant.priceType,
              variant.lowStockAlert,
              variant.trackInventory,
              variant.isDefault,
            variant.isHidden,
            variant.sortOrder,
            variant.isActive,
            timestamp,
            variant.id
          );
          existingVariantIds.delete(variant.id);
        } else {
          const variantId = variant.id || crypto.randomUUID();
          db.prepare(`
            INSERT INTO product_variants (
              id, product_id, name, sku, barcode, attributes_json,
              selling_price, cost_price, price_type, low_stock_alert, track_inventory, is_default,
              is_hidden, sort_order, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            variantId,
            productId,
            variant.name,
            variant.sku,
            variant.barcode,
            variant.attributesJson,
            variant.sellingPrice,
            variant.costPrice,
            variant.priceType,
            variant.lowStockAlert,
            variant.trackInventory,
            variant.isDefault,
            variant.isHidden,
            variant.sortOrder,
            variant.isActive,
            timestamp,
            timestamp
          );

          db.prepare(`
            INSERT OR IGNORE INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
            VALUES (?, 0, 0, 0, ?)
          `).run(variantId, timestamp);
        }

        if (variant.initialStock !== null && variant.id) {
          const balance = db.prepare(`SELECT on_hand FROM inventory_balances WHERE variant_id = ?`).get(variant.id);
          const delta = variant.initialStock - toNumber(balance?.on_hand, 0);
          if (delta !== 0) {
            applyInventoryMovement(db, {
              variantId: variant.id,
              quantity: delta,
              transactionType: 'adjustment',
              unitCost: variant.costPrice,
              referenceType: 'product_edit',
              referenceId: productId,
              notes: 'Stock updated from product edit',
              createdBy: payload.createdBy || null,
              timestamp,
            });
          }
        }
      }

      for (const variantId of existingVariantIds) {
        const balance = db.prepare(`
          SELECT COALESCE(on_hand, 0) AS on_hand
          FROM inventory_balances
          WHERE variant_id = ?
        `).get(variantId);
        const onHand = toNumber(balance?.on_hand, 0);
        if (onHand > 0) {
          const row = db.prepare(`SELECT name FROM product_variants WHERE id = ?`).get(variantId);
          throw new Error(
            `Cannot remove variant "${row?.name || variantId}" while ${onHand} units remain in stock. Adjust stock to 0 first.`
          );
        }
        db.prepare(`
          UPDATE product_variants
          SET is_active = 0,
              deleted_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(timestamp, timestamp, variantId);
      }
    });

    wrapDbCall(() => updateTx());
    return this.getProductById(productId);
  },

  getProductStockTotal(productId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COALESCE(SUM(b.on_hand), 0) AS total
      FROM product_variants v
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      WHERE v.product_id = ?
        AND v.deleted_at IS NULL
    `).get(productId);
    return toNumber(row?.total, 0);
  },

  getVariantStock(variantId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COALESCE(b.on_hand, 0) AS on_hand
      FROM product_variants v
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      WHERE v.id = ?
        AND v.deleted_at IS NULL
    `).get(variantId);
    return row ? toNumber(row.on_hand, 0) : 0;
  },

  deleteProduct(productId) {
    const db = getDb();
    const cleanId = cleanText(productId);
    assertTruthy(cleanId, 'Product ID is required.');

    const product = db.prepare(`
      SELECT id, name FROM products WHERE id = ? AND deleted_at IS NULL
    `).get(cleanId);
    if (!product) throw new Error('Product not found.');

    const stockTotal = this.getProductStockTotal(cleanId);
    if (stockTotal > 0) {
      throw new Error(
        `Cannot delete "${product.name}" while ${stockTotal} units remain in stock. Adjust stock to 0 (or receive returns) before archiving.`
      );
    }

    const timestamp = now();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET is_active = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, cleanId);

      db.prepare(`
        UPDATE product_variants
        SET is_active = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE product_id = ?
          AND deleted_at IS NULL
      `).run(timestamp, timestamp, cleanId);
    });

    tx();
    return true;
  },

  deleteVariant(variantId) {
    const db = getDb();
    const cleanId = cleanText(variantId);
    assertTruthy(cleanId, 'Variant ID is required.');

    const variant = db.prepare(`
      SELECT v.id, v.name, v.product_id, p.name AS product_name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
        AND v.deleted_at IS NULL
        AND p.deleted_at IS NULL
    `).get(cleanId);
    if (!variant) throw new Error('Variant not found.');

    const onHand = this.getVariantStock(cleanId);
    if (onHand > 0) {
      throw new Error(
        `Cannot delete variant "${variant.name}" while ${onHand} units remain in stock. Adjust stock to 0 first.`
      );
    }

    const activeCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM product_variants
      WHERE product_id = ?
        AND deleted_at IS NULL
    `).get(variant.product_id).count;

    if (activeCount <= 1) {
      throw new Error(
        `Cannot remove the last variant of "${variant.product_name}". Delete the product instead.`
      );
    }

    const timestamp = now();
    db.prepare(`
      UPDATE product_variants
      SET is_active = 0,
          deleted_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, cleanId);

    // Keep a default variant if we removed the previous default
    const defaultLeft = db.prepare(`
      SELECT id FROM product_variants
      WHERE product_id = ? AND deleted_at IS NULL AND is_default = 1
      LIMIT 1
    `).get(variant.product_id);
    if (!defaultLeft) {
      const next = db.prepare(`
        SELECT id FROM product_variants
        WHERE product_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
      `).get(variant.product_id);
      if (next) {
        db.prepare(`
          UPDATE product_variants SET is_default = 1, updated_at = ? WHERE id = ?
        `).run(timestamp, next.id);
      }
    }

    return true;
  },

  deleteCategory(categoryId, { moveProducts = false } = {}) {
    const db = getDb();
    const cleanCategoryId = cleanText(categoryId);
    assertTruthy(cleanCategoryId, 'Category ID is required.');

    const category = db.prepare(`
      SELECT id, name
      FROM categories
      WHERE id = ? AND deleted_at IS NULL
    `).get(cleanCategoryId);

    if (!category) {
      throw new Error('Category not found.');
    }

    const productCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE deleted_at IS NULL
        AND category_id = ?
    `).get(cleanCategoryId).count;

    if (productCount > 0 && !moveProducts) {
      throw new Error(`This category has ${productCount} products. Reassign or delete them first.`);
    }

    const childCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM categories
      WHERE deleted_at IS NULL
        AND parent_id = ?
    `).get(cleanCategoryId).count;

    if (childCount > 0) {
      throw new Error('This category has child categories. Reassign or delete them first.');
    }

    const timestamp = now();
    const tx = db.transaction(() => {
      if (productCount > 0 && moveProducts) {
        const uncategorized = db.prepare(`
          SELECT id FROM categories
          WHERE name = 'Uncategorized' AND parent_id IS NULL AND deleted_at IS NULL
          LIMIT 1
        `).get();
        if (!uncategorized || uncategorized.id === cleanCategoryId) {
          throw new Error('Uncategorized category was not found.');
        }
        db.prepare(`UPDATE products SET category_id = ?, updated_at = ? WHERE category_id = ? AND deleted_at IS NULL`)
          .run(uncategorized.id, timestamp, cleanCategoryId);
      }
      db.prepare(`
        UPDATE categories
        SET is_active = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, cleanCategoryId);
    });
    tx();

    return true;
  },

  listInventoryHistory({ variantId, limit = 50 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 50), 1), 200);
    const rows = db.prepare(`
      SELECT it.*, u.display_name AS performer_name, p.name AS product_name, v.name AS variant_name
      FROM inventory_transactions it
      JOIN product_variants v ON v.id = it.variant_id
      JOIN products p ON p.id = v.product_id
      LEFT JOIN users u ON u.id = it.created_by
      WHERE (? IS NULL OR it.variant_id = ?)
      ORDER BY it.created_at DESC
      LIMIT ?
    `).all(variantId || null, variantId || null, take);
    return rows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      productName: row.product_name,
      variantName: row.variant_name,
      transactionType: row.transaction_type,
      quantity: toNumber(row.quantity),
      unitCost: row.unit_cost === null ? null : toNumber(row.unit_cost),
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      notes: row.notes,
      performedBy: row.created_by,
      performerName: row.performer_name || null,
      createdAt: row.created_at,
    }));
  },

  recordInventoryTransaction({
    variantId,
    quantity,
    transactionType,
    unitCost = null,
    referenceType = null,
    referenceId = null,
    notes = null,
    createdBy = null,
  }) {
    const result = recordInventoryMovement({
      variantId, quantity, transactionType, unitCost,
      referenceType, referenceId, notes, createdBy,
    });
    return { ...this.getInventorySummary(variantId), inventoryValue: result.inventoryValue, averageCost: result.averageCost };
  },

  adjustStock(payload = {}) {
    return this.recordInventoryTransaction(payload);
  },

  getInventorySummary(variantId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT variant_id, on_hand, reserved, available, updated_at
      FROM inventory_balances
      WHERE variant_id = ?
    `).get(variantId);

    const cost = getInventoryCost(variantId);
    if (!row) {
      return {
        variantId,
        onHand: 0,
        reserved: 0,
        available: 0,
        updatedAt: null,
        inventoryValue: cost.inventoryValue,
        averageCost: cost.averageCost,
        costingStatus: cost.status,
      };
    }

    return {
      variantId: row.variant_id,
      onHand: toNumber(row.on_hand),
      reserved: toNumber(row.reserved),
      available: toNumber(row.available),
      updatedAt: row.updated_at,
      inventoryValue: cost.inventoryValue,
      averageCost: cost.averageCost,
      costingStatus: cost.status,
    };
  },
};

export default productService;
