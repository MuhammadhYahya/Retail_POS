import { PRODUCT_FIELDS, getFieldByKey } from './productFields.js';

const FORMULA_RE = /^\s*[=+\-@]/;

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const cleaned = String(value).trim().replace(/,/g, '').replace(/%$/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function toBool(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'active', 'enabled'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'inactive', 'disabled'].includes(s)) return false;
  return null;
}

function cleanText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.formula) {
    return String(value.result ?? '').trim();
  }
  return String(value).trim();
}

function looksLikeFormula(value) {
  if (value && typeof value === 'object' && value.formula) return true;
  return FORMULA_RE.test(String(value ?? ''));
}

/**
 * Normalize a mapped row into typed values + collect issues.
 * status: valid | warning | error
 */
export function validateMappedRow(row, context = {}) {
  const {
    existingSkus = new Set(),
    existingBarcodes = new Set(),
    fileSkus = new Map(),
    fileBarcodes = new Map(),
    categoryNames = new Set(),
    supplierNames = new Set(),
    categoryMode = 'auto',
    supplierMode = 'auto',
  } = context;

  const issues = [];
  const warnings = [];
  const data = {};
  const rowNumber = row.__rowNumber || 0;

  // Blank row detection
  const significantKeys = PRODUCT_FIELDS.map((f) => f.key);
  const hasAny = significantKeys.some((k) => cleanText(row[k]));
  if (!hasAny) {
    return {
      rowNumber,
      status: 'error',
      issues: [{ code: 'BLANK_ROW', message: 'Blank row.', suggestedFix: 'Remove blank rows.' }],
      warnings: [],
      data: null,
      skip: true,
    };
  }

  for (const field of PRODUCT_FIELDS) {
    const raw = row[field.key];
    if (looksLikeFormula(raw)) {
      issues.push({
        code: 'FORMULA',
        field: field.key,
        message: `${field.label} contains an Excel formula.`,
        suggestedFix: 'Paste values only (Copy → Paste Special → Values) before importing.',
      });
    }

    if (field.type === 'text' || field.type === 'boolean') {
      let text = cleanText(raw);
      if (field.type === 'boolean') {
        const b = toBool(raw);
        if (raw != null && String(raw).trim() !== '' && b === null) {
          issues.push({
            code: 'BAD_TYPE',
            field: field.key,
            message: `${field.label} must be Yes/No or 1/0.`,
            suggestedFix: 'Use 1, 0, Yes, or No.',
          });
        }
        data[field.key] = b == null ? true : b;
        continue;
      }
      if (text.length > (field.maxLength || 500)) {
        issues.push({
          code: 'TOO_LONG',
          field: field.key,
          message: `${field.label} exceeds ${field.maxLength} characters.`,
          suggestedFix: `Shorten to ${field.maxLength} characters or less.`,
        });
        text = text.slice(0, field.maxLength);
      }
      data[field.key] = text;
    } else if (field.type === 'number') {
      const n = toNumber(raw);
      if (raw != null && String(raw).trim() !== '' && Number.isNaN(n)) {
        issues.push({
          code: 'BAD_TYPE',
          field: field.key,
          message: `${field.label} must be a number.`,
          suggestedFix: 'Enter a numeric value without currency symbols.',
        });
        data[field.key] = null;
      } else if (n != null && !Number.isNaN(n)) {
        if (field.min != null && n < field.min) {
          issues.push({
            code: 'NEGATIVE',
            field: field.key,
            message: `${field.label} cannot be negative.`,
            suggestedFix: `Use ${field.min} or greater.`,
          });
        }
        if (field.max != null && n > field.max) {
          issues.push({
            code: 'OUT_OF_RANGE',
            field: field.key,
            message: `${field.label} must be between ${field.min ?? 0} and ${field.max}.`,
            suggestedFix: `Enter a value ≤ ${field.max}.`,
          });
        }
        data[field.key] = n;
      } else {
        data[field.key] = null;
      }
    }
  }

  if (!data.productName) {
    issues.push({
      code: 'MISSING_NAME',
      field: 'productName',
      message: 'Product name is required.',
      suggestedFix: 'Fill in the Name column.',
    });
  }

  // Duplicate SKU within file
  if (data.sku) {
    const prev = fileSkus.get(data.sku.toLowerCase());
    if (prev && prev !== rowNumber) {
      issues.push({
        code: 'DUP_SKU_FILE',
        field: 'sku',
        message: `Duplicate SKU in file (also row ${prev}).`,
        suggestedFix: 'Make each SKU unique, or leave blank to auto-generate.',
      });
    } else {
      fileSkus.set(data.sku.toLowerCase(), rowNumber);
    }
    if (existingSkus.has(data.sku.toLowerCase())) {
      warnings.push({
        code: 'EXISTING_SKU',
        field: 'sku',
        message: 'SKU already exists in the shop.',
        suggestedFix: 'Choose Update / Skip / Replace in duplicate handling.',
      });
    }
  }

  // Duplicate barcode within file / DB
  if (data.barcode) {
    if (!/^[A-Za-z0-9\-_.]+$/.test(data.barcode)) {
      warnings.push({
        code: 'INVALID_BARCODE',
        field: 'barcode',
        message: 'Barcode has unusual characters.',
        suggestedFix: 'Use digits/letters only, or leave blank to auto-generate.',
      });
    }
    const prev = fileBarcodes.get(data.barcode.toLowerCase());
    if (prev && prev !== rowNumber) {
      issues.push({
        code: 'DUP_BARCODE_FILE',
        field: 'barcode',
        message: `Duplicate barcode in file (also row ${prev}).`,
        suggestedFix: 'Ensure barcodes are unique.',
      });
    } else {
      fileBarcodes.set(data.barcode.toLowerCase(), rowNumber);
    }
    if (existingBarcodes.has(data.barcode.toLowerCase())) {
      warnings.push({
        code: 'EXISTING_BARCODE',
        field: 'barcode',
        message: 'Barcode already exists in the shop.',
        suggestedFix: 'Update the existing item or change the barcode.',
      });
    }
  } else {
    warnings.push({
      code: 'EMPTY_BARCODE',
      field: 'barcode',
      message: 'Barcode is empty — will auto-generate if enabled.',
      suggestedFix: 'Provide a barcode or enable auto-generate.',
    });
  }

  if (data.sellingPrice != null && data.costPrice != null && data.sellingPrice < data.costPrice) {
    warnings.push({
      code: 'PRICE_BELOW_COST',
      field: 'sellingPrice',
      message: 'Selling price is below cost.',
      suggestedFix: 'Confirm this is intentional (promo / loss-leader).',
    });
  }

  if (data.categoryName) {
    const key = data.categoryName.toLowerCase();
    if (!categoryNames.has(key)) {
      if (categoryMode === 'ignore') {
        warnings.push({
          code: 'UNKNOWN_CATEGORY',
          field: 'categoryName',
          message: `Category "${data.categoryName}" not found — will be left blank.`,
          suggestedFix: 'Create the category first, or choose Auto-create.',
        });
      } else if (categoryMode === 'ask') {
        warnings.push({
          code: 'UNKNOWN_CATEGORY_ASK',
          field: 'categoryName',
          message: `Category "${data.categoryName}" is new.`,
          suggestedFix: 'Confirm whether to create it.',
        });
      } else {
        warnings.push({
          code: 'CATEGORY_WILL_CREATE',
          field: 'categoryName',
          message: `Category "${data.categoryName}" will be created.`,
          suggestedFix: null,
        });
      }
    }
  }

  if (data.supplierName) {
    const key = data.supplierName.toLowerCase();
    if (!supplierNames.has(key)) {
      if (supplierMode === 'ignore') {
        warnings.push({
          code: 'UNKNOWN_SUPPLIER',
          field: 'supplierName',
          message: `Supplier "${data.supplierName}" not found — will be left blank.`,
          suggestedFix: 'Create the supplier first, or choose Auto-create.',
        });
      } else if (supplierMode === 'ask') {
        warnings.push({
          code: 'UNKNOWN_SUPPLIER_ASK',
          field: 'supplierName',
          message: `Supplier "${data.supplierName}" is new.`,
          suggestedFix: 'Confirm whether to create it.',
        });
      } else {
        warnings.push({
          code: 'SUPPLIER_WILL_CREATE',
          field: 'supplierName',
          message: `Supplier "${data.supplierName}" will be created.`,
          suggestedFix: null,
        });
      }
    }
  }

  // Build attributes from size/color
  const attributes = {};
  if (data.size) attributes.size = data.size;
  if (data.color) attributes.color = data.color;
  data.attributes = attributes;
  if (!data.variantName) {
    const parts = [data.size, data.color].filter(Boolean);
    data.variantName = parts.length ? parts.join(' / ') : 'Default';
  }

  let status = 'valid';
  if (issues.length) status = 'error';
  else if (warnings.length) status = 'warning';

  return {
    rowNumber,
    status,
    issues,
    warnings,
    data,
    skip: false,
    matchHint: data.sku
      ? { by: 'sku', value: data.sku }
      : data.barcode
        ? { by: 'barcode', value: data.barcode }
        : { by: 'name', value: data.productName },
  };
}

export function validateMappedRows(rows, context = {}) {
  const fileSkus = new Map();
  const fileBarcodes = new Map();
  const results = [];
  const shared = { ...context, fileSkus, fileBarcodes };

  for (const row of rows) {
    results.push(validateMappedRow(row, shared));
  }

  const summary = {
    total: results.length,
    valid: results.filter((r) => r.status === 'valid').length,
    warning: results.filter((r) => r.status === 'warning').length,
    error: results.filter((r) => r.status === 'error').length,
    blank: results.filter((r) => r.skip).length,
  };

  return { results, summary };
}

export function buildErrorReportRows(validationResults = [], importErrors = []) {
  const rows = [];
  for (const r of validationResults) {
    for (const issue of [...(r.issues || []), ...(r.warnings || [])]) {
      if (issue.code?.includes('WILL_CREATE') || issue.code === 'EMPTY_BARCODE') continue;
      rows.push({
        row: r.rowNumber,
        severity: (r.issues || []).includes(issue) ? 'error' : 'warning',
        field: issue.field || '',
        reason: issue.message,
        suggestedFix: issue.suggestedFix || '',
        productName: r.data?.productName || '',
        sku: r.data?.sku || '',
      });
    }
  }
  for (const err of importErrors) {
    rows.push({
      row: err.row || '',
      severity: 'error',
      field: err.field || '',
      reason: err.message,
      suggestedFix: err.suggestedFix || 'Fix the row and re-import.',
      productName: err.productName || '',
      sku: err.sku || '',
    });
  }
  return rows;
}

export { toNumber, toBool, cleanText, getFieldByKey };
