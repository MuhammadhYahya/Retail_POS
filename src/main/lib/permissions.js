export const PERMISSION_KEYS = [
  'returns',
  'purchases',
  'reports',
  'labels',
  'expenses',
  'dayClose',
  'products',
  'lowStock',
  'voidSale',
  'stockAdjust',
];

export const PERMISSION_LABELS = {
  returns: 'Returns',
  purchases: 'Purchases',
  reports: 'Reports',
  labels: 'Labels',
  expenses: 'Expenses',
  dayClose: 'Day Open/Close',
  products: 'Products',
  lowStock: 'Low Stock',
  voidSale: 'Void sale',
  stockAdjust: 'Stock adjust',
};

const ALL_ON = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true]));

const CASHIER_DEFAULTS = {
  returns: false,
  purchases: false,
  reports: false,
  labels: false,
  expenses: true,
  dayClose: true,
  products: true,
  lowStock: true,
  voidSale: false,
  stockAdjust: false,
};

export function defaultsForRole(role) {
  if (role === 'admin') return { ...ALL_ON };
  if (role === 'manager') return { ...ALL_ON };
  return { ...CASHIER_DEFAULTS };
}

export function normalizePermissions(input, fallbackRole = 'cashier') {
  const base = defaultsForRole(fallbackRole);
  if (!input || typeof input !== 'object') {
    return base;
  }

  const next = { ...base };
  for (const key of PERMISSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      next[key] = Boolean(input[key]);
    }
  }
  return next;
}

export function parsePermissions(raw, role = 'cashier') {
  if (role === 'admin') return defaultsForRole('admin');

  if (raw == null || raw === '') {
    return defaultsForRole(role);
  }

  if (typeof raw === 'object') {
    return normalizePermissions(raw, role);
  }

  try {
    return normalizePermissions(JSON.parse(String(raw)), role);
  } catch {
    return defaultsForRole(role);
  }
}

export function serializePermissions(permissions, role = 'cashier') {
  return JSON.stringify(normalizePermissions(permissions, role));
}

export function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const permissions = user.permissions || parsePermissions(null, user.role);
  return Boolean(permissions?.[key]);
}
