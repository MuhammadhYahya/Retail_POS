/** Renderer permissions — shared RBAC helpers + route map. */
export {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultsForRole,
  normalizePermissions,
  parsePermissions,
  hasPermission,
} from '../../shared/permissions.js';

/** Nav path → permission key. Null means always allowed for authenticated roles. */
export const PATH_PERMISSION = {
  '/day-close': 'dayClose',
  '/purchases': 'purchases',
  '/purchase-returns': 'purchaseReturns',
  '/products': 'products',
  '/labels': 'labels',
  '/returns': 'returns',
  '/expenses': 'expenses',
  '/low-stock': 'lowStock',
  '/expiry-alerts': 'lowStock',
  '/reports': 'reports',
};
