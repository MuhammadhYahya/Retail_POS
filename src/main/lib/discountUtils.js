export const DISCOUNT_TYPES = {
  NONE: 'none',
  FIXED: 'fixed',
  PERCENT: 'percent',
};

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDiscountType(type) {
  const value = String(type || DISCOUNT_TYPES.NONE).toLowerCase();
  if (value === DISCOUNT_TYPES.FIXED || value === DISCOUNT_TYPES.PERCENT) return value;
  return DISCOUNT_TYPES.NONE;
}

/** Compute money discount from type + value against a base amount. */
export function computeDiscountAmount(baseAmount, type, value) {
  const base = Math.max(0, toNumber(baseAmount, 0));
  const discountType = normalizeDiscountType(type);
  const discountValue = Math.max(0, toNumber(value, 0));

  if (discountType === DISCOUNT_TYPES.NONE || discountValue <= 0 || base <= 0) {
    return 0;
  }

  if (discountType === DISCOUNT_TYPES.PERCENT) {
    return roundMoney(Math.min(base, (base * Math.min(discountValue, 100)) / 100));
  }

  return roundMoney(Math.min(base, discountValue));
}

/** Discount as percent of base (for role limit checks). */
export function discountAsPercent(baseAmount, discountAmount) {
  const base = toNumber(baseAmount, 0);
  if (base <= 0) return 0;
  return roundMoney((Math.max(0, toNumber(discountAmount, 0)) / base) * 100);
}

export function maxDiscountPercentForRole(role, settings = {}) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'admin') return null; // unlimited
  if (normalized === 'manager') {
    return Math.max(0, toNumber(settings.managerMaxDiscountPct, 25));
  }
  return Math.max(0, toNumber(settings.cashierMaxDiscountPct, 10));
}

export function assertDiscountWithinLimit({ role, settings, baseAmount, discountAmount, label = 'Discount' }) {
  const maxPct = maxDiscountPercentForRole(role, settings);
  if (maxPct === null) return;

  const appliedPct = discountAsPercent(baseAmount, discountAmount);
  if (appliedPct > maxPct + 0.001) {
    throw new Error(
      `${label} exceeds your limit of ${maxPct}%. Ask a manager or admin for a larger discount.`
    );
  }
}

export function inclusiveVat(amount, taxRatePercent) {
  const rate = toNumber(taxRatePercent, 0);
  const total = toNumber(amount, 0);
  if (rate <= 0 || total <= 0) return 0;
  return roundMoney((total * rate) / (100 + rate));
}
