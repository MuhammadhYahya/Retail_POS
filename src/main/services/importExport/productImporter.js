import crypto from 'crypto';
import { getDb } from '../../database/db.js';
import { validateMappedRows, buildErrorReportRows, cleanText } from './validationEngine.js';

function now() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function generateDailySku(db, sequenceOffset = 0) {
  const day = now().slice(0, 10).replace(/-/g, '');
  const row = db
    .prepare(`
      SELECT sku FROM product_variants
      WHERE sku LIKE ?
      ORDER BY sku DESC LIMIT 1
    `)
    .get(`PRD-${day}-%`);
  const last = row?.sku ? Number.parseInt(String(row.sku).slice(-4), 10) || 0 : 0;
  return `PRD-${day}-${String(last + 1 + sequenceOffset).padStart(4, '0')}`;
}

function generateBarcode() {
  return `AUTO-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function loadLookupSets(db) {
  const existingSkus = new Set(
    db
      .prepare(`SELECT lower(sku) AS s FROM product_variants WHERE deleted_at IS NULL`)
      .all()
      .map((r) => r.s)
  );
  const existingBarcodes = new Set(
    db
      .prepare(`
        SELECT lower(barcode) AS b FROM product_variants
        WHERE barcode IS NOT NULL AND barcode != '' AND deleted_at IS NULL
      `)
      .all()
      .map((r) => r.b)
  );
  const categoryNames = new Set(
    db
      .prepare(`SELECT lower(name) AS n FROM categories WHERE deleted_at IS NULL`)
      .all()
      .map((r) => r.n)
  );
  const supplierNames = new Set(
    db
      .prepare(`SELECT lower(name) AS n FROM suppliers WHERE deleted_at IS NULL`)
      .all()
      .map((r) => r.n)
  );
  return { existingSkus, existingBarcodes, categoryNames, supplierNames };
}

function findVariantBySku(db, sku) {
  if (!sku) return null;
  return db
    .prepare(`
      SELECT v.id, v.product_id, v.sku, v.barcode, v.selling_price, v.cost_price,
             v.low_stock_alert, v.name AS variant_name, p.name AS product_name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.sku = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL
    `)
    .get(sku);
}

function findVariantByBarcode(db, barcode) {
  if (!barcode) return null;
  return db
    .prepare(`
      SELECT v.id, v.product_id, v.sku, v.barcode
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.barcode = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL
    `)
    .get(barcode);
}

function findProductByName(db, name) {
  if (!name) return null;
  return db
    .prepare(`
      SELECT id, name FROM products
      WHERE lower(name) = lower(?) AND deleted_at IS NULL
      LIMIT 1
    `)
    .get(name);
}

function ensureCategory(db, name, mode, cache, createdSet) {
  const cleaned = cleanText(name);
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const existing = db
    .prepare(`SELECT id FROM categories WHERE lower(name) = lower(?) AND deleted_at IS NULL`)
    .get(cleaned);
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  if (mode === 'ignore') return null;
  if (mode === 'ask' && !createdSet.has(key)) return null;
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO categories (id, name, parent_id, is_active, created_at, updated_at)
    VALUES (?, ?, NULL, 1, ?, ?)
  `).run(id, cleaned, ts, ts);
  cache.set(key, id);
  createdSet.add(key);
  return id;
}

function ensureSupplier(db, name, mode, cache, createdSet) {
  const cleaned = cleanText(name);
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const existing = db
    .prepare(`SELECT id FROM suppliers WHERE lower(name) = lower(?) AND deleted_at IS NULL`)
    .get(cleaned);
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  if (mode === 'ignore') return null;
  if (mode === 'ask' && !createdSet.has(key)) return null;
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO suppliers (id, name, phone, address, notes, is_active, created_at, updated_at)
    VALUES (?, ?, NULL, NULL, NULL, 1, ?, ?)
  `).run(id, cleaned, ts, ts);
  cache.set(key, id);
  createdSet.add(key);
  return id;
}

function softDeleteVariant(db, variantId, productId, ts) {
  db.prepare(`UPDATE product_variants SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`)
    .run(ts, ts, variantId);
  // Soft-delete product if no active variants remain
  const remaining = db
    .prepare(`SELECT COUNT(*) AS c FROM product_variants WHERE product_id = ? AND deleted_at IS NULL`)
    .get(productId);
  if (!remaining?.c) {
    db.prepare(`UPDATE products SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`)
      .run(ts, ts, productId);
  }
}

/**
 * Preview mapped product rows with validation + duplicate match hints.
 */
export function previewProductRows(mappedRows, options = {}) {
  const db = getDb();
  const lookups = loadLookupSets(db);
  const { results, summary } = validateMappedRows(mappedRows, {
    ...lookups,
    categoryMode: options.categoryMode || 'auto',
    supplierMode: options.supplierMode || 'auto',
  });

  // Attach existing match info for duplicate UI
  for (const r of results) {
    if (!r.data) continue;
    let match = null;
    if (r.data.sku) match = findVariantBySku(db, r.data.sku);
    if (!match && r.data.barcode) match = findVariantByBarcode(db, r.data.barcode);
    r.existingMatch = match
      ? {
          variantId: match.id,
          productId: match.product_id,
          sku: match.sku,
          productName: match.product_name || null,
        }
      : null;
  }

  const unknownCategories = [
    ...new Set(
      results
        .filter((r) => r.data?.categoryName)
        .map((r) => r.data.categoryName)
        .filter((name) => !lookups.categoryNames.has(name.toLowerCase()))
    ),
  ];
  const unknownSuppliers = [
    ...new Set(
      results
        .filter((r) => r.data?.supplierName)
        .map((r) => r.data.supplierName)
        .filter((name) => !lookups.supplierNames.has(name.toLowerCase()))
    ),
  ];

  return {
    summary,
    results,
    unknownCategories,
    unknownSuppliers,
    sample: results.filter((r) => !r.skip).slice(0, 50),
  };
}

/**
 * Batch import validated/mapped product rows.
 *
 * @param {object} opts
 * @param {Array} opts.mappedRows
 * @param {'create'|'update'|'skip'|'replace'|'merge'} opts.duplicateMode
 * @param {'auto'|'ask'|'ignore'} opts.categoryMode
 * @param {'auto'|'ask'|'ignore'} opts.supplierMode
 * @param {string[]} [opts.categoriesToCreate] — when categoryMode=ask
 * @param {string[]} [opts.suppliersToCreate] — when supplierMode=ask
 * @param {boolean} opts.autoGenerateBarcode
 * @param {boolean} opts.autoGenerateSku
 * @param {string|null} opts.userId
 * @param {function} [opts.onProgress]
 */
export function importProductRows({
  mappedRows = [],
  duplicateMode = 'create',
  categoryMode = 'auto',
  supplierMode = 'auto',
  categoriesToCreate = [],
  suppliersToCreate = [],
  autoGenerateBarcode = true,
  autoGenerateSku = true,
  userId = null,
  onProgress = null,
} = {}) {
  const db = getDb();
  const lookups = loadLookupSets(db);
  const askCategories = new Set((categoriesToCreate || []).map((n) => String(n).toLowerCase()));
  const askSuppliers = new Set((suppliersToCreate || []).map((n) => String(n).toLowerCase()));

  const preview = validateMappedRows(mappedRows, {
    ...lookups,
    categoryMode,
    supplierMode,
  });

  const report = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    categoriesCreated: 0,
    suppliersCreated: 0,
    barcodesGenerated: 0,
    skusGenerated: 0,
    errors: [],
  };

  const categoryCache = new Map();
  const supplierCache = new Map();
  // Preload caches
  for (const name of lookups.categoryNames) {
    const row = db.prepare(`SELECT id, name FROM categories WHERE lower(name) = ? AND deleted_at IS NULL`).get(name);
    if (row) categoryCache.set(name, row.id);
  }
  for (const name of lookups.supplierNames) {
    const row = db.prepare(`SELECT id, name FROM suppliers WHERE lower(name) = ? AND deleted_at IS NULL`).get(name);
    if (row) supplierCache.set(name, row.id);
  }

  const categoriesCreatedSet = new Set();
  const suppliersCreatedSet = new Set();
  // For ask mode, pre-mark approved names as creatable
  for (const name of askCategories) categoriesCreatedSet.add(name);
  for (const name of askSuppliers) suppliersCreatedSet.add(name);

  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, name, description, brand, unit, tax_rate, category_id, supplier_id,
      image_urls_json, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO product_variants (
      id, product_id, name, sku, barcode, attributes_json,
      selling_price, cost_price, low_stock_alert, track_inventory,
      is_default, is_hidden, sort_order, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, 1, ?, ?)
  `);
  const insertBalance = db.prepare(`
    INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `);
  const upsertBalance = db.prepare(`
    INSERT INTO inventory_balances (variant_id, on_hand, reserved, available, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(variant_id) DO UPDATE SET
      on_hand = excluded.on_hand,
      available = excluded.available,
      updated_at = excluded.updated_at
  `);
  const insertTxn = db.prepare(`
    INSERT INTO inventory_transactions (
      id, variant_id, transaction_type, quantity, unit_cost,
      reference_type, reference_id, notes, created_by, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'import', ?, ?, ?, ?)
  `);
  const updateProduct = db.prepare(`
    UPDATE products SET
      name = ?, description = ?, brand = ?, unit = ?, tax_rate = ?,
      category_id = COALESCE(?, category_id),
      supplier_id = COALESCE(?, supplier_id),
      is_active = ?, updated_at = ?
    WHERE id = ?
  `);
  const updateVariant = db.prepare(`
    UPDATE product_variants SET
      name = ?, barcode = COALESCE(?, barcode), attributes_json = ?,
      selling_price = ?, cost_price = ?, low_stock_alert = ?,
      updated_at = ?
    WHERE id = ?
  `);
  const mergeProduct = db.prepare(`
    UPDATE products SET
      name = COALESCE(NULLIF(?, ''), name),
      description = COALESCE(NULLIF(?, ''), description),
      brand = COALESCE(NULLIF(?, ''), brand),
      unit = COALESCE(NULLIF(?, ''), unit),
      tax_rate = CASE WHEN ? IS NOT NULL THEN ? ELSE tax_rate END,
      category_id = COALESCE(?, category_id),
      supplier_id = COALESCE(?, supplier_id),
      updated_at = ?
    WHERE id = ?
  `);
  const mergeVariant = db.prepare(`
    UPDATE product_variants SET
      name = COALESCE(NULLIF(?, ''), name),
      barcode = COALESCE(NULLIF(?, ''), barcode),
      attributes_json = CASE WHEN ? != '{}' THEN ? ELSE attributes_json END,
      selling_price = CASE WHEN ? IS NOT NULL THEN ? ELSE selling_price END,
      cost_price = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_price END,
      low_stock_alert = CASE WHEN ? IS NOT NULL THEN ? ELSE low_stock_alert END,
      updated_at = ?
    WHERE id = ?
  `);

  const validRows = preview.results.filter((r) => r.status !== 'error' && r.data);
  const errorRows = preview.results.filter((r) => r.status === 'error');
  for (const r of errorRows) {
    report.failed += 1;
    report.errors.push({
      row: r.rowNumber,
      message: (r.issues || []).map((i) => i.message).join('; ') || 'Validation failed',
      productName: r.data?.productName,
      sku: r.data?.sku,
      suggestedFix: (r.issues || [])[0]?.suggestedFix || '',
    });
  }

  // Group by product name for multi-variant create when no existing match
  let skuSeq = 0;
  const total = validRows.length;
  let processed = 0;

  const tx = db.transaction(() => {
    // Keep productId cache for same-name creates within this import
    const productIdByName = new Map();

    for (const rowResult of validRows) {
      const data = rowResult.data;
      const ts = now();
      processed += 1;
      if (onProgress && processed % 50 === 0) {
        onProgress({
          stage: 'Importing products...',
          percent: Math.min(95, 40 + Math.round((processed / Math.max(total, 1)) * 55)),
          processed,
          total,
        });
      }

      try {
        let existing = null;
        if (data.sku) existing = findVariantBySku(db, data.sku);
        if (!existing && data.barcode) existing = findVariantByBarcode(db, data.barcode);

        // Resolve category / supplier
        let categoryId = null;
        if (data.categoryName) {
          const catMode =
            categoryMode === 'ask' && askCategories.has(data.categoryName.toLowerCase())
              ? 'auto'
              : categoryMode;
          const before = categoriesCreatedSet.size;
          categoryId = ensureCategory(db, data.categoryName, catMode, categoryCache, categoriesCreatedSet);
          if (categoriesCreatedSet.size > before) report.categoriesCreated += 1;
        }

        let supplierId = null;
        if (data.supplierName) {
          const supMode =
            supplierMode === 'ask' && askSuppliers.has(data.supplierName.toLowerCase())
              ? 'auto'
              : supplierMode;
          const before = suppliersCreatedSet.size;
          supplierId = ensureSupplier(db, data.supplierName, supMode, supplierCache, suppliersCreatedSet);
          if (suppliersCreatedSet.size > before) report.suppliersCreated += 1;
        }

        const stock = data.stockOnHand != null ? toNumber(data.stockOnHand, 0) : null;
        const sellingPrice = data.sellingPrice != null ? toNumber(data.sellingPrice, 0) : 0;
        const costPrice = data.costPrice != null ? toNumber(data.costPrice, 0) : 0;
        const taxRate = data.taxRate != null ? toNumber(data.taxRate, 0) : 0;
        const lowStock = data.lowStockAlert != null ? Math.max(0, toNumber(data.lowStockAlert, 0)) : 0;
        const isActive = data.isActive === false ? 0 : 1;
        const attrsJson = JSON.stringify(data.attributes || {});

        if (existing) {
          if (duplicateMode === 'skip' || duplicateMode === 'create') {
            // create mode skips existing (don't invent new SKU collision)
            report.skipped += 1;
            continue;
          }

          if (duplicateMode === 'replace') {
            softDeleteVariant(db, existing.id, existing.product_id, ts);
            // fall through to insert as new
          } else if (duplicateMode === 'update') {
            updateProduct.run(
              data.productName,
              data.description || null,
              data.brand || null,
              data.unit || null,
              taxRate,
              categoryId,
              supplierId,
              isActive,
              ts,
              existing.product_id
            );
            let barcode = data.barcode || null;
            if (!barcode && autoGenerateBarcode) {
              barcode = generateBarcode();
              report.barcodesGenerated += 1;
            }
            updateVariant.run(
              data.variantName || existing.variant_name || 'Default',
              barcode,
              attrsJson,
              sellingPrice,
              costPrice,
              lowStock,
              ts,
              existing.id
            );
            if (stock != null) {
              upsertBalance.run(existing.id, stock, stock, ts);
              insertTxn.run(
                crypto.randomUUID(),
                existing.id,
                'adjustment',
                stock,
                'import',
                'Stock set via Excel import',
                userId,
                ts
              );
            }
            report.updated += 1;
            continue;
          } else if (duplicateMode === 'merge') {
            mergeProduct.run(
              data.productName,
              data.description || '',
              data.brand || '',
              data.unit || '',
              data.taxRate,
              data.taxRate,
              categoryId,
              supplierId,
              ts,
              existing.product_id
            );
            const barcode = data.barcode || null;
            mergeVariant.run(
              data.variantName || '',
              barcode || '',
              attrsJson,
              attrsJson,
              data.sellingPrice,
              data.sellingPrice,
              data.costPrice,
              data.costPrice,
              data.lowStockAlert,
              data.lowStockAlert,
              ts,
              existing.id
            );
            if (stock != null) {
              upsertBalance.run(existing.id, stock, stock, ts);
            }
            report.updated += 1;
            continue;
          }
        }

        // Insert new variant (and product if needed)
        let sku = data.sku;
        if (!sku) {
          if (!autoGenerateSku) {
            report.failed += 1;
            report.errors.push({
              row: rowResult.rowNumber,
              message: 'SKU is required when auto-generate is off.',
              productName: data.productName,
              suggestedFix: 'Provide a SKU or enable auto-generate.',
            });
            continue;
          }
          sku = generateDailySku(db, skuSeq);
          skuSeq += 1;
          report.skusGenerated += 1;
        }

        let barcode = data.barcode || null;
        if (!barcode && autoGenerateBarcode) {
          barcode = generateBarcode();
          report.barcodesGenerated += 1;
        }

        // Re-check SKU uniqueness after replace soft-delete
        const skuClash = findVariantBySku(db, sku);
        if (skuClash && duplicateMode !== 'replace') {
          report.skipped += 1;
          continue;
        }
        if (skuClash && duplicateMode === 'replace') {
          // After soft-delete, skuClash might still find if soft-delete failed — skip
          if (!skuClash.deleted_at) {
            // findVariant filters deleted_at IS NULL, so this is a different active row
            report.failed += 1;
            report.errors.push({
              row: rowResult.rowNumber,
              message: `SKU ${sku} still conflicts after replace.`,
              sku,
              productName: data.productName,
            });
            continue;
          }
        }

        const nameKey = data.productName.toLowerCase();
        let productId = productIdByName.get(nameKey);
        if (!productId) {
          const existingProduct = findProductByName(db, data.productName);
          if (existingProduct && (duplicateMode === 'update' || duplicateMode === 'merge' || duplicateMode === 'replace')) {
            productId = existingProduct.id;
          }
        }

        let isNewProduct = false;
        if (!productId) {
          productId = crypto.randomUUID();
          insertProduct.run(
            productId,
            data.productName,
            data.description || null,
            data.brand || null,
            data.unit || null,
            taxRate,
            categoryId,
            supplierId,
            isActive,
            ts,
            ts
          );
          productIdByName.set(nameKey, productId);
          isNewProduct = true;
        } else {
          productIdByName.set(nameKey, productId);
          updateProduct.run(
            data.productName,
            data.description || null,
            data.brand || null,
            data.unit || null,
            taxRate,
            categoryId,
            supplierId,
            isActive,
            ts,
            productId
          );
        }

        const variantId = crypto.randomUUID();
        const variantCount = db
          .prepare(`SELECT COUNT(*) AS c FROM product_variants WHERE product_id = ? AND deleted_at IS NULL`)
          .get(productId)?.c || 0;
        const isDefault = variantCount === 0 ? 1 : 0;

        insertVariant.run(
          variantId,
          productId,
          data.variantName || 'Default',
          sku,
          barcode,
          attrsJson,
          sellingPrice,
          costPrice,
          lowStock,
          isDefault,
          variantCount,
          ts,
          ts
        );

        const opening = stock != null ? stock : 0;
        insertBalance.run(variantId, opening, opening, ts);
        if (opening > 0) {
          insertTxn.run(
            crypto.randomUUID(),
            variantId,
            'initial',
            opening,
            'import',
            isNewProduct ? 'Opening stock on import' : 'Stock on variant import',
            userId,
            ts
          );
        }

        report.inserted += 1;
      } catch (err) {
        report.failed += 1;
        report.errors.push({
          row: rowResult.rowNumber,
          message: err.message || 'Import row failed',
          productName: data.productName,
          sku: data.sku,
          suggestedFix: 'Check for duplicate SKU/barcode and try again.',
        });
      }
    }
  });

  try {
    tx();
  } catch (err) {
    // Fatal — whole transaction rolled back
    const fatal = new Error(`Import failed and was rolled back: ${err.message}`);
    fatal.code = 'IMPORT_ROLLBACK';
    fatal.validationErrors = report.errors;
    throw fatal;
  }

  const errorReport = buildErrorReportRows(preview.results, report.errors);

  return {
    report,
    validationSummary: preview.summary,
    errorReport,
  };
}

export default {
  previewProductRows,
  importProductRows,
};
