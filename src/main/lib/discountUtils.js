/** Main-process discount helpers — re-exports shared math. */
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
