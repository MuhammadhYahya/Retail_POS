export const AUDIT_ACTIONS = Object.freeze({
  SALE_CREATE: 'sale_create',
  SALE_VOID: 'sale_void',
  REFUND_CREATE: 'refund_create',
  PRICE_CHANGE: 'price_change',
  PRODUCT_DELETE: 'product_delete',
  STOCK_ADJUST: 'stock_adjust',
  USER_CHANGE: 'user_change',
  AUDIT_RECOVERY: 'audit_recovery',
});

export const AUDIT_FAILURE_WARNING =
  'Operation completed, but audit logging requires administrator attention.';
