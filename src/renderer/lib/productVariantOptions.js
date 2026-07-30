/** Size, color, and custom attribute helpers for product variant builders. */

export const NUMERIC_SIZES = Array.from({ length: 50 }, (_, i) => String(i + 1));

export const CLOTHING_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

export const PRODUCT_COLORS = [
  'Black',
  'White',
  'Grey',
  'Navy',
  'Blue',
  'Red',
  'Green',
  'Yellow',
  'Orange',
  'Brown',
  'Beige',
  'Pink',
  'Purple',
  'Maroon',
  'Gold',
  'Silver',
  'Multicolor',
];

export const VARIANT_AXIS_TYPES = {
  sizeOnly: 'sizeOnly',
  colorOnly: 'colorOnly',
  sizeAndColor: 'sizeAndColor',
  custom: 'custom',
};

export const VARIANT_BUILD_MODES = {
  colorHasSizes: 'colorHasSizes',
  sizeHasColors: 'sizeHasColors',
};

function cleanLabel(value) {
  return String(value ?? '').trim();
}

function uniquePreserveOrder(items) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const key = String(item).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(String(item).trim());
  });
  return result;
}

export function slugifyAttributeKey(name) {
  const slug = cleanLabel(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'option';
}

export function detectSizeMode(sizes = []) {
  const list = (sizes || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return 'numeric';
  if (list.every((s) => CLOTHING_SIZES.includes(s))) return 'clothing';
  if (list.every((s) => /^\d+$/.test(s))) return 'numeric';
  return 'numeric';
}

export function expandNumericSizeRange(fromValue, toValue) {
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const start = Math.max(1, Math.min(50, Math.floor(Math.min(from, to))));
  const end = Math.max(1, Math.min(50, Math.floor(Math.max(from, to))));
  const sizes = [];
  for (let n = start; n <= end; n += 1) sizes.push(String(n));
  return sizes;
}

export function newVariantGroup(label = '', values = []) {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: cleanLabel(label),
    values: uniquePreserveOrder(values),
  };
}

export function attributeSetKey(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value).trim().toLowerCase()}`)
    .join('|');
}

export function variantDisplayName(attributes = {}, fallback = 'Variant') {
  const preferred = ['size', 'color', 'colour'];
  const entries = Object.entries(attributes || {}).filter(
    ([, value]) => value !== undefined && value !== null && String(value).trim()
  );
  const ordered = [
    ...preferred
      .map((key) => entries.find(([k]) => k.toLowerCase() === key))
      .filter(Boolean),
    ...entries.filter(([key]) => !preferred.includes(key.toLowerCase())),
  ];
  const name = ordered.map(([, value]) => String(value).trim()).join(' / ');
  return name || fallback;
}

/**
 * Build attribute objects from the simplified builder config.
 */
export function buildAttributeSets({
  axisType = VARIANT_AXIS_TYPES.sizeAndColor,
  buildMode = VARIANT_BUILD_MODES.colorHasSizes,
  simpleValues = [],
  groups = [],
  customAttributeName = '',
} = {}) {
  const seen = new Set();
  const sets = [];

  const push = (attributes) => {
    const cleaned = {};
    Object.entries(attributes || {}).forEach(([key, value]) => {
      const next = cleanLabel(value);
      if (next) cleaned[key] = next;
    });
    if (!Object.keys(cleaned).length) return;
    const key = attributeSetKey(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    sets.push(cleaned);
  };

  if (axisType === VARIANT_AXIS_TYPES.sizeOnly) {
    uniquePreserveOrder(simpleValues).forEach((size) => push({ size }));
    return sets;
  }

  if (axisType === VARIANT_AXIS_TYPES.colorOnly) {
    uniquePreserveOrder(simpleValues).forEach((color) => push({ color }));
    return sets;
  }

  if (axisType === VARIANT_AXIS_TYPES.custom) {
    const key = slugifyAttributeKey(customAttributeName);
    uniquePreserveOrder(simpleValues).forEach((value) => push({ [key]: value }));
    return sets;
  }

  // sizeAndColor — only assigned group pairs
  (groups || []).forEach((group) => {
    const label = cleanLabel(group?.label);
    const values = uniquePreserveOrder(group?.values || []);
    if (!label || !values.length) return;
    values.forEach((value) => {
      if (buildMode === VARIANT_BUILD_MODES.sizeHasColors) {
        push({ size: label, color: value });
      } else {
        push({ size: value, color: label });
      }
    });
  });

  return sets;
}

export function countAttributeSets(config) {
  return buildAttributeSets(config).length;
}

/** @deprecated use buildAttributeSets */
export function buildPairsFromGroups(mode, groups = []) {
  return buildAttributeSets({
    axisType: VARIANT_AXIS_TYPES.sizeAndColor,
    buildMode: mode,
    groups,
  });
}

/** @deprecated use countAttributeSets */
export function countPairsFromGroups(mode, groups = []) {
  return buildPairsFromGroups(mode, groups).length;
}

export function detectAxisTypeFromVariants(variants = []) {
  let hasSize = false;
  let hasColor = false;
  let customKey = '';

  (variants || []).forEach((variant) => {
    const attrs = variant?.attributes && typeof variant.attributes === 'object'
      ? variant.attributes
      : {};
    Object.entries(attrs).forEach(([key, value]) => {
      if (!cleanLabel(value)) return;
      const lower = key.toLowerCase();
      if (lower === 'size') hasSize = true;
      else if (lower === 'color' || lower === 'colour') hasColor = true;
      else if (!customKey) customKey = key;
    });
  });

  if (hasSize && hasColor) return { axisType: VARIANT_AXIS_TYPES.sizeAndColor, customAttributeName: '' };
  if (hasSize) return { axisType: VARIANT_AXIS_TYPES.sizeOnly, customAttributeName: '' };
  if (hasColor) return { axisType: VARIANT_AXIS_TYPES.colorOnly, customAttributeName: '' };
  if (customKey) {
    return {
      axisType: VARIANT_AXIS_TYPES.custom,
      customAttributeName: customKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    };
  }
  return { axisType: VARIANT_AXIS_TYPES.sizeAndColor, customAttributeName: '' };
}

export function simpleValuesFromVariants(variants = [], axisType = VARIANT_AXIS_TYPES.sizeOnly) {
  const values = [];
  (variants || []).forEach((variant) => {
    const attrs = variant?.attributes && typeof variant.attributes === 'object'
      ? variant.attributes
      : {};
    if (axisType === VARIANT_AXIS_TYPES.sizeOnly && attrs.size) values.push(attrs.size);
    if (axisType === VARIANT_AXIS_TYPES.colorOnly && (attrs.color || attrs.colour)) {
      values.push(attrs.color || attrs.colour);
    }
    if (axisType === VARIANT_AXIS_TYPES.custom) {
      const customEntry = Object.entries(attrs).find(
        ([key]) => !['size', 'color', 'colour'].includes(key.toLowerCase())
      );
      if (customEntry?.[1]) values.push(customEntry[1]);
    }
  });
  return uniquePreserveOrder(values);
}

/**
 * Hydrate builder groups from existing variant attributes (size+color modes).
 */
export function groupsFromVariants(variants = [], mode = VARIANT_BUILD_MODES.colorHasSizes) {
  const map = new Map();

  (variants || []).forEach((variant) => {
    const attrs = variant?.attributes && typeof variant.attributes === 'object'
      ? variant.attributes
      : {};
    const size = cleanLabel(attrs.size);
    const color = cleanLabel(attrs.color || attrs.colour);
    if (!size && !color) return;

    if (mode === VARIANT_BUILD_MODES.sizeHasColors) {
      if (!size) return;
      const key = size.toLowerCase();
      if (!map.has(key)) map.set(key, { label: size, values: [] });
      if (color) map.get(key).values.push(color);
    } else if (color) {
      const key = color.toLowerCase();
      if (!map.has(key)) map.set(key, { label: color, values: [] });
      if (size) map.get(key).values.push(size);
    }
  });

  return Array.from(map.values()).map((entry) => newVariantGroup(entry.label, entry.values));
}

export function collectSizesFromGroups(mode, groups = []) {
  if (mode === VARIANT_BUILD_MODES.sizeHasColors) {
    return uniquePreserveOrder((groups || []).map((g) => g.label).filter(Boolean));
  }
  return uniquePreserveOrder((groups || []).flatMap((g) => g.values || []));
}

export function hydrateVariantBuilder(variants = []) {
  const { axisType, customAttributeName } = detectAxisTypeFromVariants(variants);
  const buildMode = VARIANT_BUILD_MODES.colorHasSizes;

  if (axisType === VARIANT_AXIS_TYPES.sizeAndColor) {
    const groups = groupsFromVariants(variants, buildMode);
    return {
      axisType,
      buildMode,
      variantGroups: groups,
      simpleValues: [],
      customAttributeName: '',
      sizeMode: detectSizeMode(collectSizesFromGroups(buildMode, groups)),
      activeGroupId: groups[0]?.id || '',
    };
  }

  const simpleValues = simpleValuesFromVariants(variants, axisType);
  return {
    axisType,
    buildMode,
    variantGroups: [],
    simpleValues,
    customAttributeName: customAttributeName || (axisType === VARIANT_AXIS_TYPES.custom ? 'Option' : ''),
    sizeMode: detectSizeMode(axisType === VARIANT_AXIS_TYPES.sizeOnly ? simpleValues : []),
    activeGroupId: '',
  };
}
