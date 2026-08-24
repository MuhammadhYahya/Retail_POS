/** Premade units of measure for product master forms. */
export const PRODUCT_UNITS = [
  'pcs',
  'pair',
  'kg',
  'g',
  'l',
  'ml',
  'm',
  'box',
  'pack',
  'bottle',
];

export const CUSTOM_UNIT_VALUE = '__custom__';
export const MEASURED_UNITS = ['kg', 'g', 'l', 'ml', 'm'];

export function isMeasuredUnit(unit) {
  return MEASURED_UNITS.includes(String(unit || '').trim());
}

export function resolveUnitSelectValue(unit) {
  const value = String(unit || '').trim();
  if (!value) return '';
  if (PRODUCT_UNITS.includes(value)) return value;
  return CUSTOM_UNIT_VALUE;
}
