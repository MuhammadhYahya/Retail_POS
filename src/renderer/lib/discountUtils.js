/** Renderer discount helpers — re-exports shared math (used by cart). */
export {
  DISCOUNT_TYPES,
  roundMoney,
  toNumber,
  normalizeDiscountType,
  computeDiscountAmount,
  discountAsPercent,
  maxDiscountPercentForRole,
  assertDiscountWithinLimit,
} from '../../shared/discountUtils.js';
