import { resolveUnitSelectValue } from '../../../lib/productUnits';
import {
  detectSizeMode,
  hydrateVariantBuilder,
  VARIANT_AXIS_TYPES,
  VARIANT_BUILD_MODES,
  variantDisplayName,
} from '../../../lib/productVariantOptions';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Rs. ${amount.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function newVariantDraft(index = 0, overrides = {}) {
  return {
    id: window.crypto.randomUUID(),
    name: '',
    sku: '',
    barcode: '',
    sellingPrice: '',
    costPrice: '',
    lowStockAlert: '0',
    trackInventory: true,
    isDefault: index === 0,
    isHidden: index === 0,
    sortOrder: index,
    attributesText: '{}',
    initialStock: '',
    ...overrides,
  };
}

function uniquePreserveOrder(items) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const key = String(item).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function parseAttributes(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeVariantForPayload(variant) {
  let attributes = {};
  const attributesText = cleanText(variant.attributesText);
  if (attributesText) {
    try {
      attributes = parseAttributes(attributesText);
    } catch {
      throw new Error('Variant attributes must be valid JSON.');
    }
  }
  const initialStock = Number(variant.initialStock);
  const sellingPrice = Number(variant.sellingPrice);
  const costPrice = Number(variant.costPrice);
  const lowStockAlert = Number(variant.lowStockAlert);

  return {
    id: variant.id,
    name: cleanText(variant.name) || undefined,
    sku: cleanText(variant.sku) || undefined,
    barcode: cleanText(variant.barcode) || undefined,
    sellingPrice: Number.isFinite(sellingPrice) ? sellingPrice : 0,
    costPrice: Number.isFinite(costPrice) ? costPrice : 0,
    lowStockAlert: Number.isFinite(lowStockAlert) ? lowStockAlert : 0,
    trackInventory: Boolean(variant.trackInventory),
    isDefault: Boolean(variant.isDefault),
    isHidden: Boolean(variant.isHidden),
    sortOrder: Number(variant.sortOrder || 0),
    attributes,
    initialStock: Number.isFinite(initialStock) && initialStock > 0 ? initialStock : undefined,
  };
}

function variantKeyFromAttributes(attributes = {}) {
  const entries = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key}:${String(value).trim().toLowerCase()}`).join('|');
}

function buildVariantsFromPairs(productName, pairs = [], existingRows = []) {
  const combinations = Array.isArray(pairs) ? pairs : [];

  if (!combinations.length) {
    return existingRows.length ? existingRows : [newVariantDraft(0)];
  }

  const existingByKey = new Map(
    existingRows.map((row) => {
      const attrs = parseAttributes(row.attributesText);
      return [variantKeyFromAttributes(attrs), row];
    })
  );

  return combinations.map((attributes, index) => {
    const key = variantKeyFromAttributes(attributes);
    const existing = existingByKey.get(key);
    const name = variantDisplayName(attributes, `${productName} Variant`);

    if (existing) {
      return {
        ...existing,
        name: existing.name || name,
        sortOrder: String(index),
        attributesText: JSON.stringify(attributes, null, 2),
      };
    }

    return newVariantDraft(index, {
      name,
      sortOrder: String(index),
      isDefault: index === 0,
      isHidden: false,
      attributesText: JSON.stringify(attributes, null, 2),
    });
  });
}

function productToForm(product, { step = 1 } = {}) {
  const variants = product.variants?.length ? product.variants : [null];
  const isMatrix = variants.length > 1;
  const hasSharedVariantPrice = isMatrix && variants.every(
    (variant) => Number(variant.sellingPrice) === Number(variants[0].sellingPrice)
      && Number(variant.costPrice) === Number(variants[0].costPrice)
  );
  const hydrated = isMatrix
    ? hydrateVariantBuilder(product.variants || [])
    : {
        axisType: VARIANT_AXIS_TYPES.sizeAndColor,
        buildMode: VARIANT_BUILD_MODES.colorHasSizes,
        variantGroups: [],
        simpleValues: [],
        customAttributeName: '',
        sizeMode: 'numeric',
        activeGroupId: '',
      };
  const unitValue = product.unit || '';

  return {
    id: product.id,
    step,
    name: product.name || '',
    description: product.description || '',
    brand: product.brand || '',
    unit: unitValue,
    unitSelect: resolveUnitSelectValue(unitValue),
    categoryId: product.categoryId || '',
    imageUrls: Array.isArray(product.imageUrls) ? [...product.imageUrls] : [],
    variantMode: isMatrix ? 'matrix' : 'single',
    pricingMode: hasSharedVariantPrice ? 'single' : 'different',
    quickSellingPrice: isMatrix ? String(variants[0]?.sellingPrice ?? '') : '',
    quickCostPrice: isMatrix ? String(variants[0]?.costPrice ?? '') : '',
    quickStock: isMatrix ? String(variants[0]?.inventory?.onHand ?? '') : '',
    quickLowStockAlert: isMatrix ? String(variants[0]?.lowStockAlert ?? '') : '',
    sizePicker: '',
    sizeRangeFrom: '',
    sizeRangeTo: '',
    colorPicker: '',
    customColor: '',
    customValuePicker: '',
    activeGroupId: hydrated.activeGroupId,
    variantAxisType: hydrated.axisType,
    variantBuildMode: hydrated.buildMode,
    sizeMode: hydrated.sizeMode || detectSizeMode([]),
    variantGroups: hydrated.variantGroups || [],
    simpleValues: hydrated.simpleValues || [],
    customAttributeName: hydrated.customAttributeName || '',
    singleVariant: !isMatrix && variants[0]
      ? {
          id: variants[0].id,
          name: variants[0].name || '',
          sku: variants[0].sku || '',
          barcode: variants[0].barcode || '',
          sellingPrice: String(variants[0].sellingPrice ?? ''),
          costPrice: String(variants[0].costPrice ?? ''),
          lowStockAlert: String(variants[0].lowStockAlert ?? 0),
          trackInventory: Boolean(variants[0].trackInventory),
          isDefault: true,
          isHidden: Boolean(variants[0].isHidden),
          sortOrder: '0',
          attributesText: JSON.stringify(variants[0].attributes || {}, null, 2),
          initialStock: String(variants[0].inventory?.onHand ?? 0),
        }
      : newVariantDraft(0),
    variantRows: isMatrix
      ? product.variants.map((variant, index) => ({
          id: variant.id,
          name: variant.name || '',
          sku: variant.sku || '',
          barcode: variant.barcode || '',
          sellingPrice: String(variant.sellingPrice ?? ''),
          costPrice: String(variant.costPrice ?? ''),
          lowStockAlert: String(variant.lowStockAlert ?? 0),
          trackInventory: Boolean(variant.trackInventory),
          isDefault: Boolean(variant.isDefault) || index === 0,
          isHidden: Boolean(variant.isHidden),
          sortOrder: String(variant.sortOrder ?? index),
          attributesText: JSON.stringify(variant.attributes || {}, null, 2),
          initialStock: String(variant.inventory?.onHand ?? 0),
        }))
      : [],
  };
}

function emptyProductForm(categoryId = '') {
  return {
    id: null,
    step: 1,
    name: '',
    description: '',
    brand: '',
    unit: '',
    unitSelect: '',
    categoryId: categoryId || '',
    imageUrls: [],
    variantMode: 'single',
    pricingMode: 'single',
    quickSellingPrice: '',
    quickCostPrice: '',
    quickStock: '',
    quickLowStockAlert: '',
    sizePicker: '',
    sizeRangeFrom: '',
    sizeRangeTo: '',
    colorPicker: '',
    customColor: '',
    customValuePicker: '',
    activeGroupId: '',
    variantAxisType: VARIANT_AXIS_TYPES.sizeAndColor,
    variantBuildMode: VARIANT_BUILD_MODES.colorHasSizes,
    sizeMode: 'numeric',
    variantGroups: [],
    simpleValues: [],
    customAttributeName: '',
    singleVariant: newVariantDraft(0),
    variantRows: [],
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function categoryDisplayName(category) {
  if (!category) return 'Uncategorized';
  return category.path || category.name;
}

function formatVariantDetails(variant) {
  const attributes = variant?.attributes && typeof variant.attributes === 'object'
    ? variant.attributes
    : {};
  const preferredKeys = ['size', 'color', 'colour'];
  const keys = [
    ...preferredKeys.filter((key) => Object.prototype.hasOwnProperty.call(attributes, key)),
    ...Object.keys(attributes).filter((key) => !preferredKeys.includes(key)),
  ];
  const details = keys
    .map((key) => `${key.charAt(0).toUpperCase()}${key.slice(1)}: ${String(attributes[key]).trim()}`)
    .filter((detail) => !detail.endsWith(':'));

  return details.length ? details.join(' · ') : cleanText(variant?.name) || 'Variant';
}

function parseSearchQuery(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return { kind: 'empty' };

  const rangeMatch = query.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { kind: 'range', min: Math.min(min, max), max: Math.max(min, max) };
    }
  }

  const numeric = Number(query);
  if (Number.isFinite(numeric)) {
    return { kind: 'exact', value: numeric };
  }

  return { kind: 'text', value: query.toLowerCase() };
}

function productMatchesSearch(product, rawQuery) {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.kind === 'empty') return true;

  const variants = product.variants || [];

  if (parsed.kind === 'exact') {
    return variants.some((variant) => Number(variant.sellingPrice || 0) === parsed.value);
  }

  if (parsed.kind === 'range') {
    return variants.some((variant) => {
      const price = Number(variant.sellingPrice || 0);
      return price >= parsed.min && price <= parsed.max;
    });
  }

  const haystack = [
    product.name,
    product.brand,
    product.description,
    product.unit,
    product.category?.name,
    product.category?.path,
    ...variants.flatMap((variant) => [
      variant.name,
      variant.sku,
      variant.barcode,
      JSON.stringify(variant.attributes || {}),
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(parsed.value);
}

function isWithinDateRange(product, from, to) {
  if (!from && !to) return true;
  const createdDate = String(product.createdAt || '').slice(0, 10);
  if (from && createdDate < from) return false;
  if (to && createdDate > to) return false;
  return true;
}

function resolveVariantPrices(form, variant) {
  if (form.variantMode === 'matrix' && form.pricingMode === 'single') {
    return {
      sellingPrice: form.quickSellingPrice,
      costPrice: form.quickCostPrice,
    };
  }
  return {
    sellingPrice: variant?.sellingPrice,
    costPrice: variant?.costPrice,
  };
}

function resolveVariantStockFields(form, variant) {
  if (form.variantMode === 'matrix' && form.pricingMode === 'single') {
    return {
      initialStock: form.quickStock !== '' && form.quickStock != null
        ? form.quickStock
        : variant?.initialStock,
      lowStockAlert: form.quickLowStockAlert !== '' && form.quickLowStockAlert != null
        ? form.quickLowStockAlert
        : variant?.lowStockAlert,
    };
  }
  return {
    initialStock: variant?.initialStock,
    lowStockAlert: variant?.lowStockAlert,
  };
}

function getFormVariantDrafts(form) {
  return form.variantMode === 'matrix' ? form.variantRows : [form.singleVariant];
}

function findInvalidPriceVariant(form) {
  return getFormVariantDrafts(form).find((variant) => {
    const { sellingPrice, costPrice } = resolveVariantPrices(form, variant);
    const sellingRaw = cleanText(sellingPrice);
    const costRaw = cleanText(costPrice);
    if (sellingRaw === '' || costRaw === '') return false;
    const selling = Number(sellingRaw);
    const cost = Number(costRaw);
    return Number.isFinite(selling) && Number.isFinite(cost) && selling < cost;
  });
}

function findMissingPriceError(form) {
  const drafts = getFormVariantDrafts(form);
  for (const variant of drafts) {
    const label = cleanText(variant?.name) || 'Unnamed variant';
    const { sellingPrice, costPrice } = resolveVariantPrices(form, variant);
    const sellingRaw = cleanText(sellingPrice);
    const costRaw = cleanText(costPrice);
    const selling = Number(sellingRaw);
    const cost = Number(costRaw);

    if (sellingRaw === '' || !Number.isFinite(selling) || selling <= 0) {
      return form.variantMode === 'matrix' && form.pricingMode === 'single'
        ? 'Selling price is required and must be greater than 0.'
        : `Selling price is required and must be greater than 0 for variant "${label}".`;
    }
    if (costRaw === '' || !Number.isFinite(cost) || cost < 0) {
      return form.variantMode === 'matrix' && form.pricingMode === 'single'
        ? 'Cost price is required and must be 0 or greater.'
        : `Cost price is required and must be 0 or greater for variant "${label}".`;
    }
  }
  return null;
}

function collectProductSoftWarnings(form) {
  const warnings = [];
  const drafts = getFormVariantDrafts(form);
  let anyCostZero = false;
  let anyStockEmpty = false;
  let anyLowStockOff = false;

  drafts.forEach((variant) => {
    const prices = resolveVariantPrices(form, variant);
    const stockFields = resolveVariantStockFields(form, variant);
    const cost = Number(cleanText(prices.costPrice));
    const stockRaw = cleanText(stockFields.initialStock);
    const lowRaw = cleanText(stockFields.lowStockAlert);
    if (Number.isFinite(cost) && cost === 0) anyCostZero = true;
    if (stockRaw === '' || !Number.isFinite(Number(stockRaw)) || Number(stockRaw) <= 0) {
      anyStockEmpty = true;
    }
    if (lowRaw === '' || !Number.isFinite(Number(lowRaw)) || Number(lowRaw) <= 0) {
      anyLowStockOff = true;
    }
  });

  if (anyCostZero) {
    warnings.push('Cost price is 0 — profit reports will be inaccurate until you set a real cost.');
  }
  if (anyStockEmpty) {
    warnings.push('Opening stock is 0 / empty. You can receive stock later via Purchases / GRN.');
  }
  if (anyLowStockOff) {
    warnings.push('Low stock level is empty or 0 — low-stock alerts are disabled for those variants.');
  }
  return warnings;
}

function prepareProductPayload(form) {
  const base = {
    name: cleanText(form.name),
    description: cleanText(form.description) || undefined,
    brand: cleanText(form.brand) || undefined,
    unit: cleanText(form.unit) || undefined,
    categoryId: form.categoryId || undefined,
    imageUrls: form.imageUrls,
  };

  if (form.variantMode === 'matrix') {
    return {
      ...base,
      variants: form.variantRows.map((variant, index) => {
        const stockFields = resolveVariantStockFields(form, variant);
        const parsed = normalizeVariantForPayload({
          ...variant,
          ...(form.pricingMode === 'single'
            ? {
                sellingPrice: form.quickSellingPrice,
                costPrice: form.quickCostPrice,
                initialStock: stockFields.initialStock,
                lowStockAlert: stockFields.lowStockAlert,
              }
            : {}),
          sortOrder: variant.sortOrder ?? index,
        });
        return {
          ...parsed,
          isDefault: index === 0 || parsed.isDefault,
        };
      }),
    };
  }

  return {
    ...base,
    variants: [normalizeVariantForPayload({
      ...form.singleVariant,
      isDefault: true,
      isHidden: true,
      sortOrder: 0,
    })],
  };
}

export {
  inputClassName,
  formatCurrency,
  cleanText,
  newVariantDraft,
  uniquePreserveOrder,
  parseAttributes,
  normalizeVariantForPayload,
  variantKeyFromAttributes,
  buildVariantsFromPairs,
  productToForm,
  emptyProductForm,
  readFileAsDataUrl,
  categoryDisplayName,
  formatVariantDetails,
  parseSearchQuery,
  productMatchesSearch,
  isWithinDateRange,
  resolveVariantPrices,
  resolveVariantStockFields,
  getFormVariantDrafts,
  findInvalidPriceVariant,
  findMissingPriceError,
  collectProductSoftWarnings,
  prepareProductPayload,
};

