import crypto from 'crypto';
import { getDb } from '../database/db.js';

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

function normalizeLowStockAlert(value) {
  return Math.max(0, toNumber(value, 0));
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
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    attributes: parseJsonObject(row.attributes_json),
    sellingPrice: toNumber(row.selling_price),
    costPrice: toNumber(row.cost_price),
    lowStockAlert: toNumber(row.low_stock_alert),
    trackInventory: Boolean(row.track_inventory),
    isDefault: Boolean(row.is_default),
    isHidden: Boolean(row.is_hidden),
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
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
    taxRate: toNumber(row.tax_rate),
    categoryId: row.category_id || null,
    category,
    imageUrls: parseJsonArray(row.image_urls_json),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    variants,
    inventoryTotal: variants.reduce((sum, variant) => sum + toNumber(variant.inventory?.onHand), 0),
    defaultVariant: variants.find((variant) => variant.isDefault) || variants[0] || null,
  };
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
  const barcode = cleanText(variant?.barcode);
  assertTruthy(barcode, 'Barcode is required. Scan or type the product barcode.');

  return {
    id: cleanText(variant?.id) || crypto.randomUUID(),
    name: variantName,
    sku,
    barcode,
    attributesJson: JSON.stringify(normalized),
    sellingPrice: toNumber(variant?.sellingPrice ?? variant?.selling_price, 0),
    costPrice: toNumber(variant?.costPrice ?? variant?.cost_price, 0),
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

  listProducts() {
    const db = getDb();
    const products = db.prepare(`
      SELECT id, name, description, brand, unit, tax_rate, category_id, image_urls_json,
             is_active, created_at, updated_at, deleted_at
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
        product,
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
      SELECT id, name, description, brand, unit, tax_rate, category_id, image_urls_json,
             is_active, created_at, updated_at, deleted_at
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

    return normalizeProductRow(row, variants, row.category_id ? categoryMap.get(row.category_id) || null : null);
  },

  lookupVariantByBarcode(barcode) {
    const db = getDb();
    const cleanBarcode = cleanText(barcode);
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
        v.cost_price,
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
        p.tax_rate AS product_tax_rate,
        p.category_id AS product_category_id,
        p.image_urls_json AS product_image_urls_json,
        p.is_active AS product_is_active,
        p.created_at AS product_created_at,
        p.updated_at AS product_updated_at,
        p.deleted_at AS product_deleted_at
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      WHERE v.barcode = ?
        AND v.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `).get(cleanBarcode);

    if (!row) return null;

    const product = normalizeProductRow(
      {
        id: row.product_id_ref,
        name: row.product_name,
        description: row.product_description,
        brand: row.product_brand,
        unit: row.product_unit,
        tax_rate: row.product_tax_rate,
        category_id: row.product_category_id,
        image_urls_json: row.product_image_urls_json,
        is_active: row.product_is_active,
        created_at: row.product_created_at,
        updated_at: row.product_updated_at,
        deleted_at: row.product_deleted_at,
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
        if (seenBarcodes.has(variant.barcode)) {
          throw new Error(`Duplicate barcode in payload: ${variant.barcode}`);
        }
        const conflict = db.prepare(`
          SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE v.barcode = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL LIMIT 1
        `).get(variant.barcode);
        if (conflict) throw new Error(`${conflict.name} has the same barcode.`);
        seenBarcodes.add(variant.barcode);
      }
    }

    const id = crypto.randomUUID();
    const timestamp = now();
    const imageUrlsJson = JSON.stringify(parseJsonArray(payload.imageUrls || payload.imageUrlsJson));
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
          id, name, description, brand, unit, tax_rate, category_id, image_urls_json,
          is_active, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        productName,
        cleanText(payload.description) || null,
        cleanText(payload.brand) || null,
        unit,
        toNumber(payload.taxRate ?? payload.tax_rate, 0),
        categoryId,
        imageUrlsJson,
        timestamp,
        timestamp
      );

      for (const variant of normalizedVariants) {
        db.prepare(`
          INSERT INTO product_variants (
            id, product_id, name, sku, barcode, attributes_json,
            selling_price, cost_price, low_stock_alert, track_inventory, is_default,
            is_hidden, sort_order, is_active, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          variant.id,
          id,
          variant.name,
          variant.sku,
          variant.barcode,
          variant.attributesJson,
          variant.sellingPrice,
          variant.costPrice,
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
        db.prepare(`
          INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
          VALUES (?, ?, 0, ?, ?)
        `).run(variant.id, openingStock, openingStock, timestamp);

        if (openingStock > 0) {
          db.prepare(`
            INSERT INTO inventory_transactions (
              id, variant_id, transaction_type, quantity, unit_cost,
              reference_type, reference_id, notes, created_by, created_at
            )
            VALUES (?, ?, 'initial', ?, NULL, 'product', ?, 'Opening stock on create', ?, ?)
          `).run(crypto.randomUUID(), variant.id, openingStock, id, payload.createdBy || null, timestamp);
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

    const variantsInput = Array.isArray(payload.variants) ? payload.variants : null;
    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET name = ?,
            description = ?,
            brand = ?,
            unit = ?,
            tax_rate = ?,
            category_id = ?,
            image_urls_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        nextName,
        Object.prototype.hasOwnProperty.call(payload, 'description') ? (cleanText(payload.description) || null) : existing.description,
        Object.prototype.hasOwnProperty.call(payload, 'brand') ? (cleanText(payload.brand) || null) : existing.brand,
        nextUnit,
        Object.prototype.hasOwnProperty.call(payload, 'taxRate') || Object.prototype.hasOwnProperty.call(payload, 'tax_rate')
          ? toNumber(payload.taxRate ?? payload.tax_rate, 0)
          : existing.taxRate,
        nextCategoryId,
        nextImageUrlsJson,
        timestamp,
        productId
      );

      if (!variantsInput) return;

      const currentVariants = db.prepare(`
        SELECT id
        FROM product_variants
        WHERE product_id = ?
          AND deleted_at IS NULL
      `).all(productId);
      const existingVariantIds = new Set(currentVariants.map((variant) => variant.id));
      const normalizedVariants = variantsInput.length
        ? variantsInput.map((variant, index) => prepareVariantPayload(
          nextName,
          variant,
          index,
          variantsInput.length === 1
        ))
        : [prepareVariantPayload(nextName, {}, 0, true)];

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
          if (seenBarcodes.has(variant.barcode)) {
            throw new Error(`Duplicate barcode in payload: ${variant.barcode}`);
          }
          const conflict = db.prepare(`
            SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE v.barcode = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.id <> ? LIMIT 1
          `).get(variant.barcode, productId);
          if (conflict) throw new Error(`${conflict.name} has the same barcode.`);
          seenBarcodes.add(variant.barcode);
        }

        if (variant.id && existingVariantIds.has(variant.id)) {
          db.prepare(`
            UPDATE product_variants
            SET name = ?,
                sku = ?,
                barcode = ?,
                attributes_json = ?,
                selling_price = ?,
                cost_price = ?,
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
            variant.costPrice,
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
              selling_price, cost_price, low_stock_alert, track_inventory, is_default,
              is_hidden, sort_order, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            variantId,
            productId,
            variant.name,
            variant.sku,
            variant.barcode,
            variant.attributesJson,
            variant.sellingPrice,
            variant.costPrice,
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
            db.prepare(`
              INSERT INTO inventory_transactions (id, variant_id, transaction_type, quantity, unit_cost, reference_type, reference_id, notes, created_by, created_at)
              VALUES (?, ?, 'adjustment', ?, NULL, 'product_edit', ?, 'Stock updated from product edit', ?, ?)
            `).run(crypto.randomUUID(), variant.id, delta, productId, payload.createdBy || null, timestamp);
            upsertInventoryBalance(db, variant.id, delta);
          }
        }
      }

      for (const variantId of existingVariantIds) {
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

  deleteProduct(productId) {
    const db = getDb();
    const timestamp = now();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET is_active = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, productId);

      db.prepare(`
        UPDATE product_variants
        SET is_active = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE product_id = ?
      `).run(timestamp, timestamp, productId);
    });

    tx();
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
    const db = getDb();
    const cleanVariantId = cleanText(variantId);
    const cleanType = cleanText(transactionType);
    const delta = signedStockDelta(quantity, cleanType);

    assertTruthy(cleanVariantId, 'Variant ID is required.');
    assertTruthy(cleanType, 'Transaction type is required.');
    assertTruthy(delta !== 0, 'Quantity cannot be zero.');

    const variant = db.prepare(`
      SELECT id
      FROM product_variants
      WHERE id = ? AND deleted_at IS NULL
    `).get(cleanVariantId);

    if (!variant) {
      throw new Error('Variant not found.');
    }

    const id = crypto.randomUUID();
    const timestamp = now();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO inventory_transactions (
          id, variant_id, transaction_type, quantity, unit_cost,
          reference_type, reference_id, notes, created_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanVariantId,
        cleanType,
        delta,
        unitCost === null || unitCost === undefined ? null : toNumber(unitCost, null),
        referenceType || null,
        referenceId || null,
        notes || null,
        createdBy || null,
        timestamp
      );

      upsertInventoryBalance(db, cleanVariantId, delta);
    });

    wrapDbCall(() => tx());

    return this.getInventorySummary(cleanVariantId);
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

    if (!row) {
      return {
        variantId,
        onHand: 0,
        reserved: 0,
        available: 0,
        updatedAt: null,
      };
    }

    return {
      variantId: row.variant_id,
      onHand: toNumber(row.on_hand),
      reserved: toNumber(row.reserved),
      available: toNumber(row.available),
      updatedAt: row.updated_at,
    };
  },
};

export default productService;
