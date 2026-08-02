import { PRODUCT_FIELDS, normalizeHeader, getFieldByKey } from './productFields.js';

/**
 * Suggest mappings from file headers → POS field keys.
 * Confidence: exact alias = 1, fuzzy contains = 0.7, export key match = 1
 */
export function suggestColumnMapping(headers = []) {
  const mapping = {};
  const usedFields = new Set();
  const suggestions = [];

  const normalizedHeaders = (headers || []).map((h, index) => ({
    raw: String(h ?? ''),
    normalized: normalizeHeader(h),
    index,
  }));

  // Pass 1: exact alias / export key matches
  for (const header of normalizedHeaders) {
    if (!header.normalized) continue;
    let best = null;
    for (const field of PRODUCT_FIELDS) {
      if (usedFields.has(field.key)) continue;
      const aliasSet = new Set([
        normalizeHeader(field.key),
        normalizeHeader(field.label),
        normalizeHeader(field.exportKey),
        ...field.aliases.map(normalizeHeader),
      ]);
      if (aliasSet.has(header.normalized)) {
        best = { field, confidence: 1, reason: 'exact' };
        break;
      }
    }
    if (best) {
      mapping[header.raw] = best.field.key;
      usedFields.add(best.field.key);
      suggestions.push({
        header: header.raw,
        field: best.field.key,
        confidence: best.confidence,
        reason: best.reason,
      });
    }
  }

  // Pass 2: fuzzy contains (e.g. "Product Selling Price LKR")
  for (const header of normalizedHeaders) {
    if (mapping[header.raw] || !header.normalized) continue;
    let best = null;
    for (const field of PRODUCT_FIELDS) {
      if (usedFields.has(field.key)) continue;
      const candidates = [
        normalizeHeader(field.key),
        normalizeHeader(field.label),
        ...field.aliases.map(normalizeHeader),
      ];
      for (const alias of candidates) {
        if (!alias || alias.length < 3) continue;
        if (header.normalized.includes(alias) || alias.includes(header.normalized)) {
          const confidence = 0.7;
          if (!best || confidence > best.confidence) {
            best = { field, confidence, reason: 'fuzzy' };
          }
        }
      }
    }
    if (best && best.confidence >= 0.7) {
      mapping[header.raw] = best.field.key;
      usedFields.add(best.field.key);
      suggestions.push({
        header: header.raw,
        field: best.field.key,
        confidence: best.confidence,
        reason: best.reason,
      });
    }
  }

  const requiredMissing = PRODUCT_FIELDS
    .filter((f) => f.required && !usedFields.has(f.key))
    .map((f) => ({ key: f.key, label: f.label }));

  const unmappedHeaders = normalizedHeaders
    .filter((h) => h.raw && !mapping[h.raw])
    .map((h) => h.raw);

  return {
    mapping,
    suggestions,
    requiredMissing,
    unmappedHeaders,
    mappedFields: [...usedFields],
  };
}

/**
 * Apply mapping to raw rows → array of objects keyed by POS field keys.
 * Unmapped columns are ignored. Values are trimmed strings (typed later).
 */
export function applyColumnMapping(rows = [], mapping = {}) {
  const entries = Object.entries(mapping || {}).filter(([, fieldKey]) => fieldKey && fieldKey !== '__ignore');
  return (rows || []).map((row, rowIndex) => {
    const mapped = { __rowNumber: rowIndex + 2 }; // Excel-style (header = 1)
    for (const [header, fieldKey] of entries) {
      if (!getFieldByKey(fieldKey)) continue;
      const value = row[header];
      mapped[fieldKey] = value == null ? '' : value;
    }
    return mapped;
  });
}

export function listMappableFields() {
  return PRODUCT_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    required: f.required,
    type: f.type,
  }));
}
