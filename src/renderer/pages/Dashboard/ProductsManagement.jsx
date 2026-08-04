import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownUp,
  Barcode,
  CalendarRange,
  ChevronRight,
  CircleDollarSign,
  FolderTree,
  ImagePlus,
  Package,
  PencilLine,
  Plus,
  Search,
  Trash2,
  Boxes,
  X,
} from 'lucide-react';
import AppShell from '../../components/layout/AppShell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth, notifyLowStockUpdated } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import { hasPermission } from '../../lib/permissions.js';
import { cn } from '../../lib/utils';
import { CUSTOM_UNIT_VALUE, PRODUCT_UNITS, resolveUnitSelectValue } from '../../lib/productUnits';
import {
  CLOTHING_SIZES,
  countAttributeSets,
  buildAttributeSets,
  detectSizeMode,
  expandNumericSizeRange,
  hydrateVariantBuilder,
  groupsFromVariants,
  newVariantGroup,
  NUMERIC_SIZES,
  PRODUCT_COLORS,
  VARIANT_AXIS_TYPES,
  VARIANT_BUILD_MODES,
  variantDisplayName,
} from '../../lib/productVariantOptions';

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
  const taxRate = Number(product.taxRate ?? 0);
  const unitValue = product.unit || '';

  return {
    id: product.id,
    step,
    name: product.name || '',
    description: product.description || '',
    brand: product.brand || '',
    unit: unitValue,
    unitSelect: resolveUnitSelectValue(unitValue),
    vatApplicable: taxRate > 0,
    taxRate: String(taxRate),
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

function emptyProductForm(categoryId = '', { defaultVatRate = 0 } = {}) {
  const rate = Number(defaultVatRate);
  const vatApplicable = Number.isFinite(rate) && rate > 0;
  return {
    id: null,
    step: 1,
    name: '',
    description: '',
    brand: '',
    unit: '',
    unitSelect: '',
    vatApplicable,
    taxRate: vatApplicable ? String(rate) : '0',
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
  const taxRate = form.vatApplicable ? Number(form.taxRate || 0) : 0;
  const base = {
    name: cleanText(form.name),
    description: cleanText(form.description) || undefined,
    brand: cleanText(form.brand) || undefined,
    unit: cleanText(form.unit) || undefined,
    taxRate: Number.isFinite(taxRate) ? taxRate : 0,
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

export default function ProductsManagement() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canManageStock = hasPermission(user, 'stockAdjust');

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [defaultVatRate, setDefaultVatRate] = useState(18);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [dateFromDraft, setDateFromDraft] = useState('');
  const [dateToDraft, setDateToDraft] = useState('');
  const [dateFilterMode, setDateFilterMode] = useState('single');
  const [appliedDateRange, setAppliedDateRange] = useState({ from: '', to: '' });
  const [pendingFocusField, setPendingFocusField] = useState(null);

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteProductDialogOpen, setDeleteProductDialogOpen] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);

  const [form, setForm] = useState(emptyProductForm());
  const [categoryForm, setCategoryForm] = useState({ id: '', name: '', parentId: '', mode: 'create' });
  const [stockForm, setStockForm] = useState({
    variantId: '',
    quantity: '',
    transactionType: 'purchase',
    unitCost: '',
    notes: '',
  });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState(null);
  const [stockTargetProduct, setStockTargetProduct] = useState(null);
  const [inventoryHistory, setInventoryHistory] = useState([]);

  const imageInputRef = useRef(null);

  const notifySuccess = (message) => {
    setSuccess(message);
    setError('');
    window.setTimeout(() => setSuccess(''), 4000);
  };

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const [productsResponse, categoriesResponse, settingsResponse] = await Promise.all([
        invokeWithAuth('product:getAll'),
        invokeWithAuth('category:getAll'),
        invokeWithAuth('settings:get'),
      ]);

      if (productsResponse.success) {
        setProducts(productsResponse.data || []);
      } else {
        setError(productsResponse.error || 'Failed to load products');
      }

      if (categoriesResponse.success) {
        setCategories(categoriesResponse.data || []);
      } else if (!productsResponse.success) {
        // keep the product error if both fail
      } else {
        setError(categoriesResponse.error || 'Failed to load categories');
      }

      if (settingsResponse.success) {
        const rate = Number(settingsResponse.data?.vatRate);
        if (Number.isFinite(rate) && rate >= 0) setDefaultVatRate(rate);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load product data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (loading || !canManageStock) return;

    const editId = searchParams.get('edit');
    if (!editId || !products.length) return;

    const product = products.find((item) => item.id === editId);
    if (!product) {
      setError('Product from low stock alert was not found.');
      setSearchParams({}, { replace: true });
      return;
    }

    const step = Number(searchParams.get('step') || 2);
    const focus = searchParams.get('focus') || 'stock';
    const variantId = searchParams.get('variantId');

    setDialogError('');
    setError('');
    const nextForm = productToForm(product, { step: step === 1 ? 1 : 2 });

    // Prefer the specific low-stock variant when opening from Fill Stock
    if (variantId && nextForm.variantMode === 'matrix') {
      const index = nextForm.variantRows.findIndex((row) => row.id === variantId);
      if (index > 0) {
        const rows = [...nextForm.variantRows];
        const [selected] = rows.splice(index, 1);
        rows.unshift(selected);
        nextForm.variantRows = rows;
      }
    }

    setForm(nextForm);
    setPendingFocusField(focus);
    setProductDialogOpen(true);
    setSearchParams({}, { replace: true });
  }, [loading, products, searchParams, canManageStock, setSearchParams]);

  useEffect(() => {
    if (!productDialogOpen || !pendingFocusField || form.step !== 2) return undefined;

    const timer = window.setTimeout(() => {
      let el = null;
      if (pendingFocusField === 'stock') {
        el = document.getElementById('single-stock')
          || document.querySelector('[data-focus="variant-stock"]');
      } else if (pendingFocusField === 'cost') {
        el = document.getElementById('single-cost-price')
          || document.querySelector('[data-focus="variant-cost"]');
      } else {
        // Default: second pricing field (cost price) on step 2
        el = document.getElementById('single-cost-price')
          || document.querySelector('[data-focus="variant-cost"]');
      }
      if (el) {
        el.focus();
        if (typeof el.select === 'function') el.select();
      }
      setPendingFocusField(null);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [productDialogOpen, pendingFocusField, form.step, form.variantMode]);

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((category) => map.set(category.id, category));
    return map;
  }, [categories]);

  const selectedCategory = selectedCategoryId ? categoryById.get(selectedCategoryId) || null : null;

  const childCategories = useMemo(() => {
    return categories.filter((category) => (category.parentId || null) === (selectedCategoryId || null));
  }, [categories, selectedCategoryId]);

  const breadcrumb = useMemo(() => {
    const trail = [];
    let current = selectedCategory;
    while (current) {
      trail.unshift(current);
      current = current.parentId ? categoryById.get(current.parentId) : null;
    }
    return trail;
  }, [selectedCategory, categoryById]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (selectedCategoryId && product.categoryId !== selectedCategoryId) return false;
      if (!isWithinDateRange(product, appliedDateRange.from, appliedDateRange.to)) return false;
      return productMatchesSearch(product, searchQuery.trim());
    });
  }, [products, selectedCategoryId, appliedDateRange, searchQuery]);

  const productRows = useMemo(() => filteredProducts.flatMap((product) => {
    const variants = product.variants?.length ? product.variants : [null];
    return variants.map((variant) => ({
      product,
      variant,
      isVariantRow: variants.length > 1,
    }));
  }), [filteredProducts]);

  const productSoftWarnings = useMemo(() => {
    if (!productDialogOpen || form.step !== 2) return [];
    return collectProductSoftWarnings(form);
  }, [productDialogOpen, form]);

  const openCreateProduct = (categoryId = '') => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    setForm(emptyProductForm(categoryId || selectedCategoryId || '', { defaultVatRate }));
    setProductDialogOpen(true);
  };

  const openEditProduct = (product, options = {}) => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    setForm(productToForm(product, { step: options.step || 1 }));
    if (options.focus) setPendingFocusField(options.focus);
    setProductDialogOpen(true);
  };

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const updateSingleVariant = (field, value) => {
    setForm((prev) => ({
      ...prev,
      singleVariant: { ...prev.singleVariant, [field]: value },
    }));
  };

  const updateVariantRow = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      variantRows: prev.variantRows.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant
      ),
    }));
  };

  const addVariantRow = () => {
    setForm((prev) => ({
      ...prev,
      variantRows: [...prev.variantRows, newVariantDraft(prev.variantRows.length, { isHidden: false })],
    }));
  };

  const removeVariantRow = (index) => {
    const row = form.variantRows[index];
    if (!row) return;
    if (form.id && row.id && form.variantRows.length <= 1) {
      setDialogError('Cannot remove the last variant. Use Delete Product instead.');
      return;
    }
    const stock = Number(row.initialStock);
    if (form.id && row.id && Number.isFinite(stock) && stock > 0) {
      setDialogError(
        `Cannot remove "${row.name || 'this variant'}" while ${stock} units remain in stock. Adjust stock to 0 first.`
      );
      return;
    }
    setDialogError('');
    setForm((prev) => ({
      ...prev,
      variantRows: prev.variantRows.filter((_, variantIndex) => variantIndex !== index),
    }));
  };

  const builderConfig = () => ({
    axisType: form.variantAxisType || VARIANT_AXIS_TYPES.sizeAndColor,
    buildMode: form.variantBuildMode || VARIANT_BUILD_MODES.colorHasSizes,
    simpleValues: form.simpleValues || [],
    groups: form.variantGroups || [],
    customAttributeName: form.customAttributeName || '',
  });

  const addSimpleValue = (value) => {
    const next = cleanText(value);
    if (!next) return;
    setForm((prev) => ({
      ...prev,
      sizePicker: '',
      colorPicker: '',
      customColor: '',
      customValuePicker: '',
      simpleValues: uniquePreserveOrder([...(prev.simpleValues || []), next]),
    }));
  };

  const removeSimpleValue = (value) => {
    setForm((prev) => ({
      ...prev,
      simpleValues: (prev.simpleValues || []).filter(
        (item) => String(item).toLowerCase() !== String(value).toLowerCase()
      ),
    }));
  };

  const addSimpleSizeRange = () => {
    const range = expandNumericSizeRange(form.sizeRangeFrom, form.sizeRangeTo);
    if (!range.length) {
      setDialogError('Enter a valid size range between 1 and 50.');
      return;
    }
    setDialogError('');
    setForm((prev) => ({
      ...prev,
      sizeRangeFrom: '',
      sizeRangeTo: '',
      simpleValues: uniquePreserveOrder([...(prev.simpleValues || []), ...range]),
    }));
  };

  const addVariantGroup = (label) => {
    const nextLabel = cleanText(label);
    if (!nextLabel) return;
    const exists = (form.variantGroups || []).some(
      (group) => String(group.label).toLowerCase() === nextLabel.toLowerCase()
    );
    if (exists) {
      setDialogError(
        form.variantBuildMode === VARIANT_BUILD_MODES.sizeHasColors
          ? `Size "${nextLabel}" is already added.`
          : `Color "${nextLabel}" is already added.`
      );
      return;
    }
    setDialogError('');
    const group = newVariantGroup(nextLabel, []);
    setForm((prev) => ({
      ...prev,
      colorPicker: '',
      customColor: '',
      sizePicker: '',
      activeGroupId: group.id,
      variantGroups: [...(prev.variantGroups || []), group],
    }));
  };

  const removeVariantGroup = (groupId) => {
    setForm((prev) => {
      const nextGroups = (prev.variantGroups || []).filter((group) => group.id !== groupId);
      return {
        ...prev,
        variantGroups: nextGroups,
        activeGroupId: prev.activeGroupId === groupId ? (nextGroups[0]?.id || '') : prev.activeGroupId,
      };
    });
  };

  const addValueToGroup = (groupId, value) => {
    const next = cleanText(value);
    if (!groupId || !next) return;
    setForm((prev) => ({
      ...prev,
      variantGroups: (prev.variantGroups || []).map((group) => (
        group.id === groupId
          ? { ...group, values: uniquePreserveOrder([...(group.values || []), next]) }
          : group
      )),
    }));
  };

  const removeValueFromGroup = (groupId, value) => {
    setForm((prev) => ({
      ...prev,
      variantGroups: (prev.variantGroups || []).map((group) => (
        group.id === groupId
          ? {
              ...group,
              values: (group.values || []).filter(
                (item) => String(item).toLowerCase() !== String(value).toLowerCase()
              ),
            }
          : group
      )),
    }));
  };

  const addSizeToActiveGroup = () => {
    if (!form.activeGroupId || !form.sizePicker) return;
    addValueToGroup(form.activeGroupId, form.sizePicker);
    updateForm('sizePicker', '');
  };

  const addSizeRangeToActiveGroup = () => {
    if (!form.activeGroupId) {
      setDialogError(
        form.variantBuildMode === VARIANT_BUILD_MODES.sizeHasColors
          ? 'Select or add a size group first.'
          : 'Select or add a color group first.'
      );
      return;
    }
    const range = expandNumericSizeRange(form.sizeRangeFrom, form.sizeRangeTo);
    if (!range.length) {
      setDialogError('Enter a valid size range between 1 and 50.');
      return;
    }
    setDialogError('');
    setForm((prev) => ({
      ...prev,
      sizeRangeFrom: '',
      sizeRangeTo: '',
      variantGroups: (prev.variantGroups || []).map((group) => (
        group.id === prev.activeGroupId
          ? { ...group, values: uniquePreserveOrder([...(group.values || []), ...range]) }
          : group
      )),
    }));
  };

  const addColorToActiveGroup = () => {
    if (!form.activeGroupId || !form.colorPicker) return;
    addValueToGroup(form.activeGroupId, form.colorPicker);
    updateForm('colorPicker', '');
  };

  const addCustomColorToActiveGroup = () => {
    const custom = cleanText(form.customColor);
    if (!form.activeGroupId || !custom) return;
    addValueToGroup(form.activeGroupId, custom);
    updateForm('customColor', '');
  };

  const switchAxisType = (axisType) => {
    setDialogError('');
    setForm((prev) => {
      const sourceVariants = (prev.variantRows || []).map((row) => ({
        attributes: parseAttributes(row.attributesText),
      }));
      const hydrated = sourceVariants.some((v) => Object.keys(v.attributes || {}).length)
        ? hydrateVariantBuilder(sourceVariants)
        : null;

      // Prefer hydrated data when switching to matching type from existing rows
      if (hydrated && hydrated.axisType === axisType) {
        return {
          ...prev,
          variantAxisType: axisType,
          variantBuildMode: hydrated.buildMode,
          variantGroups: hydrated.variantGroups,
          simpleValues: hydrated.simpleValues,
          customAttributeName: hydrated.customAttributeName,
          sizeMode: hydrated.sizeMode,
          activeGroupId: hydrated.activeGroupId,
          sizePicker: '',
          colorPicker: '',
          customColor: '',
          customValuePicker: '',
          sizeRangeFrom: '',
          sizeRangeTo: '',
        };
      }

      return {
        ...prev,
        variantAxisType: axisType,
        variantBuildMode: VARIANT_BUILD_MODES.colorHasSizes,
        variantGroups: [],
        simpleValues: [],
        customAttributeName: axisType === VARIANT_AXIS_TYPES.custom ? (prev.customAttributeName || 'Option') : '',
        activeGroupId: '',
        sizePicker: '',
        colorPicker: '',
        customColor: '',
        customValuePicker: '',
        sizeRangeFrom: '',
        sizeRangeTo: '',
      };
    });
  };

  const switchBuildMode = (mode) => {
    setForm((prev) => {
      const sourceVariants = (prev.variantRows || []).map((row) => ({
        attributes: parseAttributes(row.attributesText),
      }));
      const nextGroups = sourceVariants.some((v) => v.attributes?.size || v.attributes?.color)
        ? groupsFromVariants(sourceVariants, mode)
        : [];
      return {
        ...prev,
        variantBuildMode: mode,
        variantGroups: nextGroups,
        activeGroupId: nextGroups[0]?.id || '',
        sizePicker: '',
        colorPicker: '',
        customColor: '',
        sizeRangeFrom: '',
        sizeRangeTo: '',
      };
    });
  };

  const buildVariants = () => {
    const config = builderConfig();
    const pairs = buildAttributeSets(config);
    if (!pairs.length) {
      let message = 'Add at least one option before building variants.';
      if (config.axisType === VARIANT_AXIS_TYPES.sizeOnly) message = 'Add at least one size before building variants.';
      if (config.axisType === VARIANT_AXIS_TYPES.colorOnly) message = 'Add at least one color before building variants.';
      if (config.axisType === VARIANT_AXIS_TYPES.custom) {
        message = cleanText(form.customAttributeName)
          ? 'Add at least one custom value before building variants.'
          : 'Enter a custom field name and at least one value.';
      }
      if (config.axisType === VARIANT_AXIS_TYPES.sizeAndColor) {
        message = config.buildMode === VARIANT_BUILD_MODES.sizeHasColors
          ? 'Add at least one size group with colors before building variants.'
          : 'Add at least one color group with sizes before building variants.';
      }
      setDialogError(message);
      return;
    }
    setDialogError('');
    setForm((prev) => ({
      ...prev,
      variantRows: buildVariantsFromPairs(
        prev.name,
        buildAttributeSets({
          axisType: prev.variantAxisType,
          buildMode: prev.variantBuildMode,
          simpleValues: prev.simpleValues,
          groups: prev.variantGroups,
          customAttributeName: prev.customAttributeName,
        }),
        prev.variantRows
      ),
    }));
  };

  const handleImageFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setDialogError('');
    try {
      const allowed = files.filter((file) => file.type.startsWith('image/'));
      if (!allowed.length) {
        setDialogError('Please choose image files (JPG, PNG, WebP, or GIF).');
        return;
      }

      const oversized = allowed.find((file) => file.size > 2 * 1024 * 1024);
      if (oversized) {
        setDialogError('Each image must be 2 MB or smaller.');
        return;
      }

      const dataUrls = await Promise.all(allowed.map(readFileAsDataUrl));
      setForm((prev) => ({
        ...prev,
        imageUrls: [...prev.imageUrls, ...dataUrls.filter(Boolean)],
      }));
    } catch (err) {
      setDialogError(err.message || 'Failed to add image.');
    }
  };

  const removeImage = (index) => {
    setForm((prev) => ({
      ...prev,
      imageUrls: prev.imageUrls.filter((_, imageIndex) => imageIndex !== index),
    }));
  };

  const handleSaveProduct = async (event) => {
    event.preventDefault();
    setDialogError('');

    if (!cleanText(form.name)) {
      setDialogError('Product name is required.');
      return;
    }

    if (form.vatApplicable) {
      const rate = Number(form.taxRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        setDialogError('Enter a VAT rate greater than 0, or mark VAT as not applicable.');
        return;
      }
    }

    if (form.variantMode === 'matrix' && !form.variantRows.length) {
      setDialogError('Generate at least one variant before saving.');
      return;
    }

    const missingPriceError = findMissingPriceError(form);
    if (missingPriceError) {
      setDialogError(missingPriceError);
      return;
    }

    const invalidPriceVariant = findInvalidPriceVariant(form);
    if (invalidPriceVariant) {
      setDialogError(`Selling price cannot be lower than cost price for variant "${invalidPriceVariant.name || 'Unnamed variant'}".`);
      return;
    }

    let payload;
    try {
      payload = prepareProductPayload(form);
    } catch {
      setDialogError('Variant attributes must be valid JSON.');
      return;
    }

    const seenSkus = new Set();
    const seenBarcodes = new Set();
    for (const variant of payload.variants) {
      if (variant.sku) {
        const key = variant.sku.toLowerCase();
        if (seenSkus.has(key)) {
          setDialogError('Each variant SKU must be unique within this product.');
          return;
        }
        seenSkus.add(key);
      }
      if (variant.barcode) {
        if (seenBarcodes.has(variant.barcode)) {
          setDialogError('Each variant barcode must be unique within this product.');
          return;
        }
        seenBarcodes.add(variant.barcode);
      }
    }

    const softWarnings = collectProductSoftWarnings(form);

    setSaving(true);
    const response = form.id
      ? await invokeWithAuth('product:update', { productId: form.id, ...payload })
      : await invokeWithAuth('product:create', payload);
    setSaving(false);

    if (response.success) {
      setProductDialogOpen(false);
      setForm(emptyProductForm('', { defaultVatRate }));
      const baseMsg = form.id ? 'Product updated successfully.' : 'Product added successfully.';
      notifySuccess(softWarnings.length ? `${baseMsg} ${softWarnings[0]}` : baseMsg);
      loadData();
    } else {
      setDialogError(response.error || 'Failed to save product');
    }
  };

  const findCategoryNameConflict = (name, parentId) => {
    const trimmed = cleanText(name).toLowerCase();
    if (!trimmed) return null;
    const parentKey = parentId || null;
    return categories.find(
      (category) =>
        (category.parentId || null) === parentKey && category.name.trim().toLowerCase() === trimmed
    );
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    setDialogError('');

    if (!cleanText(categoryForm.name)) {
      setDialogError('Category name is required.');
      return;
    }

    const conflict = findCategoryNameConflict(categoryForm.name, categoryForm.parentId || null);
    if (conflict) {
      setDialogError(
        `A category named "${conflict.name}" already exists here. Names must be unique (case does not matter).`
      );
      return;
    }

    setSaving(true);
    const response = await invokeWithAuth('category:create', {
      name: cleanText(categoryForm.name),
      parentId: categoryForm.parentId || undefined,
    });
    setSaving(false);

    if (response.success) {
      setCategoryDialogOpen(false);
      setCategoryForm({ id: '', name: '', parentId: '', mode: 'create' });
      notifySuccess(`Category "${response.data?.name || categoryForm.name}" created.`);
      loadData();
    } else {
      setDialogError(response.error || 'Failed to save category');
    }
  };

  const openEditCategoryDialog = (category) => {
    if (!isAdmin) return;
    setDialogError('');
    setCategoryForm({
      id: category.id,
      name: category.name,
      parentId: category.parentId || '',
      mode: 'edit',
    });
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async (event) => {
    event.preventDefault();
    setDialogError('');

    const name = cleanText(categoryForm.name);
    if (!name) {
      setDialogError('Category name is required.');
      return;
    }

    if (categoryForm.mode === 'create') {
      await handleCreateCategory(event);
      return;
    }

    const conflict = findCategoryNameConflict(name, categoryForm.parentId || null);
    if (conflict && conflict.id !== categoryForm.id) {
      setDialogError(
        `A category named "${conflict.name}" already exists here. Names must be unique (case does not matter).`
      );
      return;
    }

    setSaving(true);
    const response = await invokeWithAuth('category:update', {
      categoryId: categoryForm.id,
      name,
    });
    setSaving(false);

    if (response.success) {
      setCategoryDialogOpen(false);
      setCategoryForm({ id: '', name: '', parentId: '', mode: 'create' });
      notifySuccess(`Category "${response.data?.name || name}" updated.`);
      await loadData();
    } else {
      setDialogError(response.error || 'Failed to update category');
    }
  };

  const openStockDialog = async (product) => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    const variant = product.defaultVariant || product.variants?.[0] || null;
    setStockTargetProduct(product);
    const historyResponse = await invokeWithAuth('inventory:getHistory', { variantId: variant?.id, limit: 10 });
    setInventoryHistory(historyResponse.success ? historyResponse.data || [] : []);
    setStockForm({
      variantId: variant?.id || '',
      quantity: '',
      transactionType: 'purchase',
      unitCost: '',
      notes: '',
    });
    setStockDialogOpen(true);
  };

  const handleAdjustStock = async (event) => {
    event.preventDefault();
    setDialogError('');

    if (!stockForm.variantId) {
      setDialogError('Choose a variant to adjust.');
      return;
    }

    const quantity = Number(stockForm.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      setDialogError('Enter a non-zero stock quantity.');
      return;
    }

    if (stockForm.transactionType !== 'adjustment' && quantity < 0) {
      setDialogError('Enter a positive quantity. Outgoing types reduce stock automatically.');
      return;
    }

    setSaving(true);
    const response = await invokeWithAuth('inventory:adjustStock', {
      variantId: stockForm.variantId,
      quantity,
      transactionType: stockForm.transactionType,
      unitCost: stockForm.unitCost.trim() ? Number(stockForm.unitCost) : undefined,
      notes: stockForm.notes.trim() || undefined,
    });
    setSaving(false);

    if (response.success) {
      setStockDialogOpen(false);
      setStockTargetProduct(null);
      setInventoryHistory([]);
      notifySuccess('Stock updated successfully.');
      notifyLowStockUpdated();
      loadData();
    } else {
      setDialogError(response.error || 'Failed to adjust stock');
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    setDialogError('');

    const response = deleteTarget.kind === 'variant'
      ? await invokeWithAuth('product:deleteVariant', { variantId: deleteTarget.variant.id })
      : await invokeWithAuth('product:delete', { productId: deleteTarget.product.id });

    setSaving(false);

    if (response.success) {
      setDeleteProductDialogOpen(false);
      setDeleteTarget(null);
      notifySuccess(deleteTarget.kind === 'variant' ? 'Variant deleted.' : 'Product deleted.');
      loadData();
    } else {
      setDialogError(response.error || 'Failed to delete');
    }
  };

  const requestDeleteProduct = (product) => {
    const stockTotal = Number(product.inventoryTotal ?? 0)
      || (product.variants || []).reduce((sum, v) => sum + Number(v.inventory?.onHand ?? 0), 0);
    setDialogError(stockTotal > 0
      ? `Cannot delete while ${stockTotal} units remain in stock. Adjust stock to 0 first.`
      : '');
    setDeleteTarget({
      kind: 'product',
      product,
      name: product.name,
      stock: stockTotal,
    });
    setDeleteProductDialogOpen(true);
  };

  const requestDeleteVariant = (product, variant) => {
    const stock = Number(variant?.inventory?.onHand ?? 0);
    const activeCount = (product.variants || []).length;
    let error = '';
    if (stock > 0) {
      error = `Cannot delete this variant while ${stock} units remain in stock. Adjust stock to 0 first.`;
    } else if (activeCount <= 1) {
      error = 'Cannot remove the last variant. Delete the product instead.';
    }
    setDialogError(error);
    setDeleteTarget({
      kind: 'variant',
      product,
      variant,
      name: `${product.name} / ${variant?.name || 'Variant'}`,
      stock,
      activeCount,
    });
    setDeleteProductDialogOpen(true);
  };

  const handleDeleteCategory = async () => {
    if (!categoryDeleteTarget) return;

    setSaving(true);
    setDialogError('');
    const response = await invokeWithAuth('category:delete', {
      categoryId: categoryDeleteTarget.id,
      moveProducts: Boolean(categoryDeleteTarget.productCount),
    });
    setSaving(false);

    if (response.success) {
      setDeleteCategoryDialogOpen(false);
      setCategoryDeleteTarget(null);
      notifySuccess('Category deleted.');
      if (selectedCategoryId === categoryDeleteTarget.id) {
        setSelectedCategoryId(categoryDeleteTarget.parentId || null);
      }
      loadData();
    } else {
      setDialogError(response.error || 'Failed to delete category');
    }
  };

  const requestDeleteCategory = (category) => {
    const productCount = products.filter((product) => product.categoryId === category.id).length;
    setDialogError('');
    setCategoryDeleteTarget({ ...category, productCount });
    if (productCount === 0) {
      handleDeleteCategoryImmediate({ ...category, productCount });
    } else {
      setDeleteCategoryDialogOpen(true);
    }
  };

  const handleDeleteCategoryImmediate = async (target) => {
    setSaving(true);
    const response = await invokeWithAuth('category:delete', { categoryId: target.id });
    setSaving(false);
    if (response.success) {
      notifySuccess('Category deleted.');
      if (selectedCategoryId === target.id) setSelectedCategoryId(target.parentId || null);
      loadData();
    } else {
      setError(response.error || 'Failed to delete category');
    }
  };

  const openNewCategoryDialog = (parentId = '') => {
    if (!isAdmin) return;
    setDialogError('');
    setCategoryForm({
      id: '',
      name: '',
      parentId: parentId || selectedCategoryId || '',
      mode: 'create',
    });
    setCategoryDialogOpen(true);
  };

  const startMatrixMode = () => {
    setForm((prev) => ({
      ...prev,
      variantMode: 'matrix',
      step: 2,
      variantRows: prev.variantRows.length
        ? prev.variantRows
        : [],
      variantGroups: prev.variantGroups?.length
        ? prev.variantGroups
        : [],
      activeGroupId: prev.activeGroupId || prev.variantGroups?.[0]?.id || '',
    }));
  };

  const startSingleMode = () => {
    setForm((prev) => ({
      ...prev,
      variantMode: 'single',
      step: 2,
      singleVariant: prev.singleVariant || newVariantDraft(0),
    }));
  };

  const stockVariantOptions = stockTargetProduct?.variants || [];

  return (
    <AppShell title={isAdmin ? 'Product Module' : 'Product Catalog'} description="Browse categories, manage products, and keep inventory up to date.">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3 justify-between items-start">
          <div className="space-y-2 min-w-0 flex-1">
            <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Category breadcrumb">
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1 hover:bg-muted transition-colors',
                  !selectedCategoryId ? 'font-semibold text-primary' : 'text-muted-foreground'
                )}
                onClick={() => setSelectedCategoryId(null)}
              >
                All categories
              </button>
              {breadcrumb.map((category) => (
                <React.Fragment key={category.id}>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-2 py-1 hover:bg-muted transition-colors truncate max-w-[12rem]',
                      selectedCategoryId === category.id ? 'font-semibold text-primary' : 'text-muted-foreground'
                    )}
                    onClick={() => setSelectedCategoryId(category.id)}
                  >
                    {category.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>
            <p className="text-sm text-muted-foreground">
              {selectedCategory
                ? `Showing products in ${selectedCategory.name}. Click a subcategory to go deeper.`
                : 'Click a category to browse its subcategories and products.'}
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openNewCategoryDialog()}>
                <FolderTree className="h-4 w-4 mr-2" />
                New Category
              </Button>
              <Button onClick={() => openCreateProduct()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_auto_1fr_1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              className={cn(inputClassName, 'pl-10')}
              placeholder="Search by name, brand, barcode, SKU, or price..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 text-sm">
            <label className="flex items-center gap-1"><input type="radio" checked={dateFilterMode === 'single'} onChange={() => setDateFilterMode('single')} /> Single</label>
            <label className="flex items-center gap-1"><input type="radio" checked={dateFilterMode === 'range'} onChange={() => setDateFilterMode('range')} /> Range</label>
          </div>
          <div className="relative">
            <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              className={cn(inputClassName, 'pl-10')}
              value={dateFilterMode === 'single' ? dateFromDraft : dateFromDraft}
              onChange={(e) => setDateFromDraft(e.target.value)}
            />
          </div>
          {dateFilterMode === 'range' ? <div className="relative">
            <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              className={cn(inputClassName, 'pl-10')}
              value={dateToDraft}
              onChange={(e) => setDateToDraft(e.target.value)}
            />
          </div> : <div />}
          <Button
            type="button"
            variant="outline"
            onClick={() => setAppliedDateRange({ from: dateFromDraft, to: dateFilterMode === 'range' ? dateToDraft : dateFromDraft })}
          >
            Filter
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDateFromDraft('');
              setDateToDraft('');
              setDateFilterMode('single');
              setAppliedDateRange({ from: '', to: '' });
            }}
          >
            Clear
          </Button>
        </div>

        {success && (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {childCategories.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {selectedCategory ? 'Subcategories' : 'Categories'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {childCategories.map((category) => {
                const productCount = products.filter((product) => product.categoryId === category.id).length;
                const childCount = categories.filter((item) => item.parentId === category.id).length;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(category.id)}
                    className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="font-medium truncate">{category.name}</p>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-md p-1 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                title="Edit category"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditCategoryDialog(category);
                                }}
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Delete category"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  requestDeleteCategory(category);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {childCount > 0
                            ? `${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}`
                            : 'No subcategories'}
                          {' · '}
                          {productCount} product{productCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isAdmin && selectedCategory && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openCreateProduct(selectedCategory.id)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product in {selectedCategory.name}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => openNewCategoryDialog(selectedCategory.id)}>
              <FolderTree className="h-4 w-4 mr-2" />
              Add Subcategory
            </Button>
          </div>
        )}

        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {selectedCategory ? `Products in ${selectedCategory.name}` : 'All products'}
              <span className="text-muted-foreground font-normal"> ({productRows.length})</span>
            </p>
          </div>

          {loading ? (
            <p className="p-8 text-center text-muted-foreground text-sm">Loading products...</p>
          ) : filteredProducts.length === 0 ? (
            <div className="p-10 text-center">
              <Package className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">
                {searchQuery.trim() ? 'No products match your search' : selectedCategory ? 'No products in this category yet' : 'No products yet'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isAdmin
                  ? selectedCategory
                    ? 'Add a product here, or open a subcategory.'
                    : 'Create a category, then add your first product.'
                  : 'Try another search or browse a different category.'}
              </p>
              {isAdmin && (
                <Button className="mt-4" onClick={() => openCreateProduct(selectedCategoryId || '')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Product
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>SKU / Barcode</TableHead>
                  <TableHead>Selling Price</TableHead>
                  <TableHead>Cost Price</TableHead>
                  <TableHead>Stock</TableHead>
                  {canManageStock && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {productRows.map(({ product, variant, isVariantRow }) => {
                  const defaultVariant = variant || product.defaultVariant || product.variants?.[0] || null;
                  const thumb = product.imageUrls?.[0];
                  return (
                    <TableRow key={`${product.id}-${defaultVariant?.id || 'product'}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-lg border border-border bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                            {thumb ? (
                              <img src={thumb} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="space-y-1 min-w-0">
                            <p className="font-medium truncate">{product.name}{isVariantRow ? ` / ${defaultVariant?.name || 'Variant'}` : ''}</p>
                            {(product.brand || isVariantRow) && (
                              <p className="text-xs text-muted-foreground truncate">
                                {product.brand || ''}
                                {product.brand && (product.variants?.length || 0) > 1 ? ' · ' : ''}
                                {isVariantRow ? formatVariantDetails(defaultVariant) : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {categoryDisplayName(product.category)}
                      </TableCell>
                      <TableCell>
                        {defaultVariant ? (
                          <div className="space-y-1 text-sm">
                            <p className="font-mono text-xs">{defaultVariant.sku || '—'}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Barcode className="h-3 w-3" />
                              {defaultVariant.barcode || 'No barcode'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {defaultVariant ? (
                          <p className="text-sm flex items-center gap-1">
                            <CircleDollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatCurrency(defaultVariant.sellingPrice)}
                          </p>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {defaultVariant ? formatCurrency(defaultVariant.costPrice) : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium flex items-center gap-1">
                          <Boxes className="h-4 w-4 text-primary" />
                          {Number(defaultVariant?.inventory?.onHand ?? product.inventoryTotal ?? 0)}
                        </p>
                      </TableCell>
                      {canManageStock && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openStockDialog(product)}
                              title="Adjust stock"
                            >
                              <ArrowDownUp className="h-4 w-4" />
                            </Button>
                            {isAdmin && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditProduct(product)}
                                  title="Edit product"
                                >
                                  <PencilLine className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    if (isVariantRow && defaultVariant) {
                                      requestDeleteVariant(product, defaultVariant);
                                    } else {
                                      requestDeleteProduct(product);
                                    }
                                  }}
                                  title={isVariantRow ? 'Delete this variant' : 'Delete product'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {isAdmin && (
        <>
          <Dialog
            open={productDialogOpen}
            onOpenChange={(open) => {
              setProductDialogOpen(open);
              if (!open) setDialogError('');
            }}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
              <DialogHeader>
                <DialogTitle>{form.id ? 'Edit Product' : 'Add Product'}</DialogTitle>
                <DialogDescription>
                  Product master: identity, prices, and barcodes. Receive stock via Purchases / GRN; print from Labels.
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              {productSoftWarnings.length > 0 && (
                <Alert>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {productSoftWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSaveProduct} className="space-y-5">
                {form.step === 1 && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" htmlFor="product-name">
                        Product name
                      </label>
                      <input
                        id="product-name"
                        className={inputClassName}
                        value={form.name}
                        onChange={(e) => updateForm('name', e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2" htmlFor="product-category">
                        Category
                      </label>
                      <select
                        id="product-category"
                        className={inputClassName}
                        value={form.categoryId}
                        onChange={(e) => updateForm('categoryId', e.target.value)}
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {`${'— '.repeat(category.depth || 0)}${category.name}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="product-unit">
                          Unit
                        </label>
                        <select
                          id="product-unit"
                          className={inputClassName}
                          value={form.unitSelect || ''}
                          onChange={(e) => {
                            const next = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              unitSelect: next,
                              unit: next === CUSTOM_UNIT_VALUE ? (PRODUCT_UNITS.includes(prev.unit) ? '' : prev.unit) : next,
                            }));
                          }}
                        >
                          <option value="">Select unit</option>
                          {PRODUCT_UNITS.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                          <option value={CUSTOM_UNIT_VALUE}>Custom…</option>
                        </select>
                        {form.unitSelect === CUSTOM_UNIT_VALUE && (
                          <input
                            className={cn(inputClassName, 'mt-2')}
                            value={form.unit}
                            onChange={(e) => updateForm('unit', e.target.value)}
                            placeholder="e.g. carton, dozen"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">VAT</label>
                        <div className="flex flex-wrap gap-3 mb-2">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              checked={Boolean(form.vatApplicable)}
                              onChange={() => setForm((prev) => ({
                                ...prev,
                                vatApplicable: true,
                                taxRate: Number(prev.taxRate) > 0 ? prev.taxRate : String(defaultVatRate),
                              }))}
                            />
                            Applicable
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              checked={!form.vatApplicable}
                              onChange={() => setForm((prev) => ({
                                ...prev,
                                vatApplicable: false,
                                taxRate: '0',
                              }))}
                            />
                            Not applicable
                          </label>
                        </div>
                        {form.vatApplicable && (
                          <input
                            id="product-vat"
                            type="number"
                            min="0.01"
                            step="0.01"
                            className={inputClassName}
                            value={form.taxRate}
                            onChange={(e) => updateForm('taxRate', e.target.value)}
                            placeholder={String(defaultVatRate)}
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2" htmlFor="product-brand">
                        Brand (optional)
                      </label>
                      <input
                        id="product-brand"
                        className={inputClassName}
                        value={form.brand}
                        onChange={(e) => updateForm('brand', e.target.value)}
                        placeholder="Anchor, Singer, Kohinoor"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2" htmlFor="product-description">
                        Description
                      </label>
                      <textarea
                        id="product-description"
                        className={cn(inputClassName, 'min-h-24')}
                        value={form.description}
                        onChange={(e) => updateForm('description', e.target.value)}
                        placeholder="Optional product notes"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Image</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                          <ImagePlus className="h-4 w-4 mr-2" />
                          Add
                        </Button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleImageFiles}
                        />
                      </div>

                      {form.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {form.imageUrls.map((url, index) => (
                            <div
                              key={`${index}-${url.slice(0, 32)}`}
                              className="relative h-20 w-20 rounded-lg border border-border overflow-hidden bg-muted/40"
                            >
                              <img src={url} alt="" className="h-full w-full object-cover" />
                              <button
                                type="button"
                                className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 border border-border"
                                onClick={() => removeImage(index)}
                                title="Remove image"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {form.step === 2 && (
                  <div className="space-y-5">
                    {form.name ? (
                      <p className="text-sm text-muted-foreground">
                        Product: <span className="font-medium text-foreground">{form.name}</span>
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={startSingleMode}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-left transition-colors',
                          form.variantMode === 'single'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card hover:bg-muted/40'
                        )}
                      >
                        <p className="font-semibold">Single product</p>
                        <p className="text-xs text-muted-foreground">One price and one default variant.</p>
                      </button>
                      <button
                        type="button"
                        onClick={startMatrixMode}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-left transition-colors',
                          form.variantMode === 'matrix'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card hover:bg-muted/40'
                        )}
                      >
                        <p className="font-semibold">Product variants</p>
                        <p className="text-xs text-muted-foreground">Generate a simple size × color table.</p>
                      </button>
                    </div>

                    {form.variantMode === 'single' ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-selling-price">
                              Selling Price (Rs.)
                            </label>
                            <input
                              id="single-selling-price"
                              type="number"
                              step="0.01"
                              min="0.01"
                              className={inputClassName}
                              value={form.singleVariant.sellingPrice}
                              onChange={(e) => updateSingleVariant('sellingPrice', e.target.value)}
                              placeholder="Required"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-cost-price">
                              Cost Price (Rs.)
                            </label>
                            <input
                              id="single-cost-price"
                              type="number"
                              step="0.01"
                              min="0"
                              className={inputClassName}
                              value={form.singleVariant.costPrice}
                              onChange={(e) => updateSingleVariant('costPrice', e.target.value)}
                              placeholder="0"
                              data-focus="variant-cost"
                              required
                            />
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                          <p>This screen is the product master (identity, prices, barcodes). Opening stock is optional.</p>
                          <p>Future inventory is normally received through <strong>Purchases / GRN</strong>. Print labels from the Labels module after stock arrives.</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-stock">
                              Opening Stock (optional)
                            </label>
                            <input
                              id="single-stock"
                              type="number"
                              step="1"
                              min="0"
                              className={inputClassName}
                              value={form.singleVariant.initialStock}
                              onChange={(e) => updateSingleVariant('initialStock', e.target.value)}
                              placeholder="0"
                              data-focus="variant-stock"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Leave 0 to receive stock later via Purchases / GRN.</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-low-stock">
                              Low Stock Level (optional)
                            </label>
                            <input
                              id="single-low-stock"
                              type="number"
                              step="1"
                              min="0"
                              className={inputClassName}
                              value={form.singleVariant.lowStockAlert}
                              onChange={(e) => updateSingleVariant('lowStockAlert', e.target.value)}
                              placeholder="0"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Empty or 0 disables low-stock alerts.</p>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-barcode">
                              Barcode
                            </label>
                            <input
                              id="single-barcode"
                              className={inputClassName}
                              value={form.singleVariant.barcode}
                              onChange={(e) => updateSingleVariant('barcode', e.target.value)}
                              placeholder="Scan or type"
                              autoComplete="off"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Optional. A barcode is generated automatically when you save.</p>
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium mb-2">SKU</label>
                            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                              {form.singleVariant.sku || 'Will be generated on save'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-border p-4 space-y-4">
                          <div>
                            <p className="text-sm font-semibold">1. What do variants differ by?</p>
                            <p className="text-xs text-muted-foreground">Pick one path — keep it simple.</p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                              { id: VARIANT_AXIS_TYPES.sizeOnly, title: 'Size only', hint: 'e.g. 40, 41, 42' },
                              { id: VARIANT_AXIS_TYPES.colorOnly, title: 'Color only', hint: 'e.g. Black, Blue' },
                              { id: VARIANT_AXIS_TYPES.sizeAndColor, title: 'Size + Color', hint: 'Assign per group' },
                              { id: VARIANT_AXIS_TYPES.custom, title: 'Custom field', hint: 'Material, Style…' },
                            ].map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => switchAxisType(option.id)}
                                className={cn(
                                  'rounded-xl border px-3 py-3 text-left transition-colors',
                                  form.variantAxisType === option.id
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border bg-card hover:bg-muted/40'
                                )}
                              >
                                <p className="text-sm font-semibold">{option.title}</p>
                                <p className="text-xs text-muted-foreground">{option.hint}</p>
                              </button>
                            ))}
                          </div>

                          {form.variantAxisType === VARIANT_AXIS_TYPES.sizeOnly && (
                            <div className="space-y-3 border-t border-border pt-4">
                              <p className="text-sm font-semibold">2. Add sizes</p>
                              <div className="flex flex-wrap gap-2 text-xs">
                                <label className="flex items-center gap-1">
                                  <input type="radio" checked={(form.sizeMode || 'numeric') === 'numeric'} onChange={() => updateForm('sizeMode', 'numeric')} />
                                  Numbers 1–50
                                </label>
                                <label className="flex items-center gap-1">
                                  <input type="radio" checked={form.sizeMode === 'clothing'} onChange={() => updateForm('sizeMode', 'clothing')} />
                                  Clothing
                                </label>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <select className={cn(inputClassName, 'max-w-xs')} value={form.sizePicker || ''} onChange={(e) => updateForm('sizePicker', e.target.value)}>
                                  <option value="">Select size</option>
                                  {(form.sizeMode === 'clothing' ? CLOTHING_SIZES : NUMERIC_SIZES)
                                    .filter((size) => !(form.simpleValues || []).includes(size))
                                    .map((size) => <option key={size} value={size}>{size}</option>)}
                                </select>
                                <Button type="button" variant="outline" disabled={!form.sizePicker} onClick={() => addSimpleValue(form.sizePicker)}>Add</Button>
                              </div>
                              {(form.sizeMode || 'numeric') === 'numeric' && (
                                <div className="flex flex-wrap items-end gap-2">
                                  <div>
                                    <label className="block text-xs font-medium mb-1">From</label>
                                    <select className={cn(inputClassName, 'w-24 !p-2')} value={form.sizeRangeFrom || ''} onChange={(e) => updateForm('sizeRangeFrom', e.target.value)}>
                                      <option value="">—</option>
                                      {NUMERIC_SIZES.map((size) => <option key={`sf-${size}`} value={size}>{size}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium mb-1">To</label>
                                    <select className={cn(inputClassName, 'w-24 !p-2')} value={form.sizeRangeTo || ''} onChange={(e) => updateForm('sizeRangeTo', e.target.value)}>
                                      <option value="">—</option>
                                      {NUMERIC_SIZES.map((size) => <option key={`st-${size}`} value={size}>{size}</option>)}
                                    </select>
                                  </div>
                                  <Button type="button" variant="outline" onClick={addSimpleSizeRange}>Add range</Button>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2 min-h-8">
                                {(form.simpleValues || []).length === 0 && <p className="text-xs text-muted-foreground">No sizes yet.</p>}
                                {(form.simpleValues || []).map((value) => (
                                  <button key={value} type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs" onClick={() => removeSimpleValue(value)}>
                                    {value}<X className="h-3 w-3" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {form.variantAxisType === VARIANT_AXIS_TYPES.colorOnly && (
                            <div className="space-y-3 border-t border-border pt-4">
                              <p className="text-sm font-semibold">2. Add colors</p>
                              <div className="flex flex-wrap gap-2">
                                <select className={cn(inputClassName, 'max-w-xs')} value={form.colorPicker || ''} onChange={(e) => updateForm('colorPicker', e.target.value)}>
                                  <option value="">Select color</option>
                                  {PRODUCT_COLORS
                                    .filter((color) => !(form.simpleValues || []).some((c) => String(c).toLowerCase() === color.toLowerCase()))
                                    .map((color) => <option key={color} value={color}>{color}</option>)}
                                </select>
                                <Button type="button" variant="outline" disabled={!form.colorPicker} onClick={() => addSimpleValue(form.colorPicker)}>Add</Button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <input
                                  className={cn(inputClassName, 'max-w-xs')}
                                  value={form.customColor || ''}
                                  onChange={(e) => updateForm('customColor', e.target.value)}
                                  placeholder="Custom color"
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSimpleValue(form.customColor); } }}
                                />
                                <Button type="button" variant="outline" disabled={!cleanText(form.customColor)} onClick={() => addSimpleValue(form.customColor)}>Add custom</Button>
                              </div>
                              <div className="flex flex-wrap gap-2 min-h-8">
                                {(form.simpleValues || []).length === 0 && <p className="text-xs text-muted-foreground">No colors yet.</p>}
                                {(form.simpleValues || []).map((value) => (
                                  <button key={value} type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs" onClick={() => removeSimpleValue(value)}>
                                    {value}<X className="h-3 w-3" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {form.variantAxisType === VARIANT_AXIS_TYPES.custom && (
                            <div className="space-y-3 border-t border-border pt-4">
                              <p className="text-sm font-semibold">2. Custom field</p>
                              <div>
                                <label className="block text-xs font-medium mb-1">Field name</label>
                                <input
                                  className={cn(inputClassName, 'max-w-sm')}
                                  value={form.customAttributeName || ''}
                                  onChange={(e) => updateForm('customAttributeName', e.target.value)}
                                  placeholder="e.g. Material, Style, Pack, Flavor"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <input
                                  className={cn(inputClassName, 'max-w-xs')}
                                  value={form.customValuePicker || ''}
                                  onChange={(e) => updateForm('customValuePicker', e.target.value)}
                                  placeholder="Add a value"
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSimpleValue(form.customValuePicker); } }}
                                />
                                <Button type="button" variant="outline" disabled={!cleanText(form.customValuePicker)} onClick={() => addSimpleValue(form.customValuePicker)}>Add value</Button>
                              </div>
                              <div className="flex flex-wrap gap-2 min-h-8">
                                {(form.simpleValues || []).length === 0 && <p className="text-xs text-muted-foreground">No values yet.</p>}
                                {(form.simpleValues || []).map((value) => (
                                  <button key={value} type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs" onClick={() => removeSimpleValue(value)}>
                                    {value}<X className="h-3 w-3" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {form.variantAxisType === VARIANT_AXIS_TYPES.sizeAndColor && (
                            <div className="space-y-4 border-t border-border pt-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm font-semibold">2. Link sizes and colors</p>
                                <div className="flex flex-wrap gap-3 text-sm">
                                  <label className="flex items-center gap-2">
                                    <input type="radio" checked={form.variantBuildMode !== VARIANT_BUILD_MODES.sizeHasColors} onChange={() => switchBuildMode(VARIANT_BUILD_MODES.colorHasSizes)} />
                                    Color → sizes
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input type="radio" checked={form.variantBuildMode === VARIANT_BUILD_MODES.sizeHasColors} onChange={() => switchBuildMode(VARIANT_BUILD_MODES.sizeHasColors)} />
                                    Size → colors
                                  </label>
                                </div>
                              </div>

                              {form.variantBuildMode !== VARIANT_BUILD_MODES.sizeHasColors ? (
                                <div className="flex flex-wrap gap-2">
                                  <select className={cn(inputClassName, 'max-w-xs')} value={form.colorPicker || ''} onChange={(e) => updateForm('colorPicker', e.target.value)}>
                                    <option value="">Add color group</option>
                                    {PRODUCT_COLORS
                                      .filter((color) => !(form.variantGroups || []).some((g) => String(g.label).toLowerCase() === color.toLowerCase()))
                                      .map((color) => <option key={color} value={color}>{color}</option>)}
                                  </select>
                                  <Button type="button" variant="outline" disabled={!form.colorPicker} onClick={() => addVariantGroup(form.colorPicker)}>Add</Button>
                                  <input
                                    className={cn(inputClassName, 'max-w-[10rem]')}
                                    value={form.customColor || ''}
                                    onChange={(e) => updateForm('customColor', e.target.value)}
                                    placeholder="Custom color"
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariantGroup(form.customColor); updateForm('customColor', ''); } }}
                                  />
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <label className="flex items-center gap-1"><input type="radio" checked={(form.sizeMode || 'numeric') === 'numeric'} onChange={() => updateForm('sizeMode', 'numeric')} /> Numbers</label>
                                    <label className="flex items-center gap-1"><input type="radio" checked={form.sizeMode === 'clothing'} onChange={() => updateForm('sizeMode', 'clothing')} /> Clothing</label>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <select className={cn(inputClassName, 'max-w-xs')} value={form.sizePicker || ''} onChange={(e) => updateForm('sizePicker', e.target.value)}>
                                      <option value="">Add size group</option>
                                      {(form.sizeMode === 'clothing' ? CLOTHING_SIZES : NUMERIC_SIZES)
                                        .filter((size) => !(form.variantGroups || []).some((g) => String(g.label) === size))
                                        .map((size) => <option key={size} value={size}>{size}</option>)}
                                    </select>
                                    <Button type="button" variant="outline" disabled={!form.sizePicker} onClick={() => addVariantGroup(form.sizePicker)}>Add</Button>
                                  </div>
                                </div>
                              )}

                              {(form.variantGroups || []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  {form.variantBuildMode === VARIANT_BUILD_MODES.sizeHasColors
                                    ? 'Add a size, then assign colors for that size only.'
                                    : 'Add a color, then assign sizes for that color only.'}
                                </p>
                              ) : (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap gap-2">
                                    {(form.variantGroups || []).map((group) => (
                                      <button
                                        key={group.id}
                                        type="button"
                                        className={cn(
                                          'rounded-full border px-3 py-1.5 text-sm',
                                          form.activeGroupId === group.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30'
                                        )}
                                        onClick={() => updateForm('activeGroupId', group.id)}
                                      >
                                        {group.label} <span className="text-xs text-muted-foreground">({(group.values || []).length})</span>
                                      </button>
                                    ))}
                                  </div>
                                  {(form.variantGroups || []).map((group) => (
                                    form.activeGroupId === group.id ? (
                                      <div key={`panel-${group.id}`} className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-sm font-semibold">
                                            {form.variantBuildMode === VARIANT_BUILD_MODES.sizeHasColors
                                              ? `Size ${group.label} colors`
                                              : `${group.label} sizes`}
                                          </p>
                                          <Button type="button" variant="ghost" size="sm" onClick={() => removeVariantGroup(group.id)}>Remove</Button>
                                        </div>
                                        {form.variantBuildMode !== VARIANT_BUILD_MODES.sizeHasColors ? (
                                          <>
                                            <div className="flex flex-wrap gap-2 text-xs">
                                              <label className="flex items-center gap-1"><input type="radio" checked={(form.sizeMode || 'numeric') === 'numeric'} onChange={() => updateForm('sizeMode', 'numeric')} /> Numbers</label>
                                              <label className="flex items-center gap-1"><input type="radio" checked={form.sizeMode === 'clothing'} onChange={() => updateForm('sizeMode', 'clothing')} /> Clothing</label>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              <select className={cn(inputClassName, 'max-w-xs')} value={form.sizePicker || ''} onChange={(e) => updateForm('sizePicker', e.target.value)}>
                                                <option value="">Select size</option>
                                                {(form.sizeMode === 'clothing' ? CLOTHING_SIZES : NUMERIC_SIZES)
                                                  .filter((size) => !(group.values || []).includes(size))
                                                  .map((size) => <option key={size} value={size}>{size}</option>)}
                                              </select>
                                              <Button type="button" variant="outline" disabled={!form.sizePicker} onClick={addSizeToActiveGroup}>Add</Button>
                                            </div>
                                            {(form.sizeMode || 'numeric') === 'numeric' && (
                                              <div className="flex flex-wrap items-end gap-2">
                                                <select className={cn(inputClassName, 'w-24 !p-2')} value={form.sizeRangeFrom || ''} onChange={(e) => updateForm('sizeRangeFrom', e.target.value)}>
                                                  <option value="">From</option>
                                                  {NUMERIC_SIZES.map((size) => <option key={`gf-${size}`} value={size}>{size}</option>)}
                                                </select>
                                                <select className={cn(inputClassName, 'w-24 !p-2')} value={form.sizeRangeTo || ''} onChange={(e) => updateForm('sizeRangeTo', e.target.value)}>
                                                  <option value="">To</option>
                                                  {NUMERIC_SIZES.map((size) => <option key={`gt-${size}`} value={size}>{size}</option>)}
                                                </select>
                                                <Button type="button" variant="outline" onClick={addSizeRangeToActiveGroup}>Add range</Button>
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            <div className="flex flex-wrap gap-2">
                                              <select className={cn(inputClassName, 'max-w-xs')} value={form.colorPicker || ''} onChange={(e) => updateForm('colorPicker', e.target.value)}>
                                                <option value="">Select color</option>
                                                {PRODUCT_COLORS
                                                  .filter((color) => !(group.values || []).some((c) => String(c).toLowerCase() === color.toLowerCase()))
                                                  .map((color) => <option key={color} value={color}>{color}</option>)}
                                              </select>
                                              <Button type="button" variant="outline" disabled={!form.colorPicker} onClick={addColorToActiveGroup}>Add</Button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              <input className={cn(inputClassName, 'max-w-xs')} value={form.customColor || ''} onChange={(e) => updateForm('customColor', e.target.value)} placeholder="Custom color" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomColorToActiveGroup(); } }} />
                                              <Button type="button" variant="outline" disabled={!cleanText(form.customColor)} onClick={addCustomColorToActiveGroup}>Add custom</Button>
                                            </div>
                                          </>
                                        )}
                                        <div className="flex flex-wrap gap-2 min-h-8">
                                          {(group.values || []).length === 0 && <p className="text-xs text-muted-foreground">Nothing assigned yet.</p>}
                                          {(group.values || []).map((value) => (
                                            <button key={value} type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs" onClick={() => removeValueFromGroup(group.id, value)}>
                                              {value}<X className="h-3 w-3" />
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" onClick={buildVariants}>
                            3. Build variants
                          </Button>
                          <Button type="button" variant="ghost" onClick={addVariantRow}>
                            Add row manually
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            {countAttributeSets(builderConfig())} variant{countAttributeSets(builderConfig()) === 1 ? '' : 's'} ready
                            . Matching rows keep prices and stock.
                          </p>
                        </div>

                        {form.variantRows.length > 0 ? (
                          <div className="space-y-4">
                            <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                              <p>Product master sets variants, prices, and barcodes. Opening stock is optional.</p>
                              <p>Receive inventory later via <strong>Purchases / GRN</strong>, then print from Labels.</p>
                            </div>
                            <div className={cn('rounded-xl border p-4', form.pricingMode === 'different' ? 'border-border bg-muted/50' : 'border-border bg-muted/20')}>
                              <div className="flex flex-wrap items-end gap-3">
                                <div>
                                  <p className="text-sm font-semibold">Pricing mode</p>
                                  <p className="text-xs text-muted-foreground">{form.pricingMode === 'different' ? 'Shared prices are locked. Edit prices in each variant row.' : 'Choose one price for all rows.'}</p>
                                </div>
                                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.pricingMode !== 'different'} onChange={() => setForm((prev) => ({ ...prev, pricingMode: 'single' }))} /> Single Price for All Variants</label>
                                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.pricingMode === 'different'} onChange={() => setForm((prev) => ({ ...prev, pricingMode: 'different' }))} /> Different Price per Variant</label>
                              </div>
                              <div className={cn('mt-3 flex flex-wrap items-end gap-3', form.pricingMode === 'different' && 'opacity-60')}>
                                <div>
                                  <label className="block text-xs font-medium mb-1">Selling Price</label>
                                  <input disabled={form.pricingMode === 'different'} className={cn(inputClassName, 'w-36', form.pricingMode === 'different' && 'cursor-not-allowed')} type="number" min="0.01" step="0.01" value={form.quickSellingPrice || ''} onChange={(e) => updateForm('quickSellingPrice', e.target.value)} placeholder="2500" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium mb-1">Cost Price</label>
                                  <input disabled={form.pricingMode === 'different'} className={cn(inputClassName, 'w-36', form.pricingMode === 'different' && 'cursor-not-allowed')} type="number" min="0" step="0.01" value={form.quickCostPrice || ''} onChange={(e) => updateForm('quickCostPrice', e.target.value)} placeholder="1800" />
                                </div>
                                <Button type="button" variant="outline" disabled={form.pricingMode === 'different'} onClick={() => setForm((prev) => ({ ...prev, variantRows: prev.variantRows.map((row) => ({ ...row, sellingPrice: prev.quickSellingPrice, costPrice: prev.quickCostPrice })) }))}>Apply Prices to All</Button>
                              </div>
                              <div className={cn('mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3', form.pricingMode === 'different' && 'opacity-60')}>
                                <div>
                                  <label className="block text-xs font-medium mb-1">Opening Stock</label>
                                  <input disabled={form.pricingMode === 'different'} className={cn(inputClassName, 'w-36', form.pricingMode === 'different' && 'cursor-not-allowed')} type="number" min="0" step="1" value={form.quickStock || ''} onChange={(e) => updateForm('quickStock', e.target.value)} placeholder="0" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium mb-1">Low Stock Level</label>
                                  <input disabled={form.pricingMode === 'different'} className={cn(inputClassName, 'w-36', form.pricingMode === 'different' && 'cursor-not-allowed')} type="number" min="0" step="1" value={form.quickLowStockAlert || ''} onChange={(e) => updateForm('quickLowStockAlert', e.target.value)} placeholder="0" />
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={form.pricingMode === 'different'}
                                  onClick={() => setForm((prev) => ({
                                    ...prev,
                                    variantRows: prev.variantRows.map((row) => ({
                                      ...row,
                                      initialStock: prev.quickStock,
                                    })),
                                  }))}
                                >
                                  Apply Stock to All
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={form.pricingMode === 'different'}
                                  onClick={() => setForm((prev) => ({
                                    ...prev,
                                    variantRows: prev.variantRows.map((row) => ({
                                      ...row,
                                      lowStockAlert: prev.quickLowStockAlert === '' ? '0' : prev.quickLowStockAlert,
                                    })),
                                  }))}
                                >
                                  Apply Low Stock to All
                                </Button>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Opening stock is optional (receive later via Purchases / GRN). Low stock empty/0 disables alerts. You can still edit each row manually.
                              </p>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-border">
                              <table className="w-full text-sm min-w-[640px]">
                                <thead className="bg-muted/40">
                                  <tr className="border-b border-border">
                                    <th className="p-3 text-left">Variant</th>
                                    {form.pricingMode === 'different' && (
                                      <>
                                        <th className="p-3 text-left">Selling</th>
                                        <th className="p-3 text-left">Cost</th>
                                      </>
                                    )}
                                    <th className="p-3 text-left">Stock</th>
                                    <th className="p-3 text-left">Low Stock</th>
                                    <th className="p-3 text-left">Barcode</th>
                                    <th className="sticky right-0 z-10 bg-muted/40 p-3 text-left shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {form.variantRows.map((variant, index) => (
                                    <tr key={variant.id} className="border-b border-border last:border-0">
                                      <td className="p-2">
                                        <input
                                          className={cn(inputClassName, 'min-w-[8rem] p-2')}
                                          value={variant.name}
                                          onChange={(e) => updateVariantRow(index, 'name', e.target.value)}
                                          placeholder={`Variant ${index + 1}`}
                                        />
                                        <div className="mt-1 text-xs text-muted-foreground">SKU: {variant.sku || 'Auto'}</div>
                                      </td>
                                      {form.pricingMode === 'different' && (
                                        <>
                                          <td className="p-2">
                                            <input className="w-24 rounded-lg border border-border bg-input p-2" type="number" min="0.01" step="0.01" value={variant.sellingPrice} onChange={(e) => updateVariantRow(index, 'sellingPrice', e.target.value)} />
                                          </td>
                                          <td className="p-2">
                                            <input className="w-24 rounded-lg border border-border bg-input p-2" type="number" min="0" step="0.01" value={variant.costPrice} onChange={(e) => updateVariantRow(index, 'costPrice', e.target.value)} data-focus="variant-cost" />
                                          </td>
                                        </>
                                      )}
                                      <td className="p-2">
                                        <input className="w-20 rounded-lg border border-border bg-input p-2" type="number" min="0" step="1" value={variant.initialStock} onChange={(e) => updateVariantRow(index, 'initialStock', e.target.value)} data-focus="variant-stock" />
                                      </td>
                                      <td className="p-2">
                                        <input className="w-20 rounded-lg border border-border bg-input p-2" type="number" min="0" step="1" value={variant.lowStockAlert} onChange={(e) => updateVariantRow(index, 'lowStockAlert', e.target.value)} />
                                      </td>
                                      <td className="p-2">
                                        <input
                                          className={cn(inputClassName, 'min-w-[8rem] p-2 text-xs')}
                                          value={variant.barcode}
                                          onChange={(e) => updateVariantRow(index, 'barcode', e.target.value)}
                                          placeholder="Scan or type"
                                          autoComplete="off"
                                        />
                                      </td>
                                      <td className="sticky right-0 z-10 bg-card p-2 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                                        <Button type="button" variant="ghost" size="sm" onClick={() => removeVariantRow(index)} disabled={form.variantRows.length === 1} title="Remove variant">
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="text-xs text-muted-foreground">Barcodes and SKUs are generated automatically when left blank. Type or scan a barcode to override.</p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Choose how variants differ, add options, then Build variants — or add a row manually.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
                    Cancel
                  </Button>
                  {form.step === 1 ? (
                    <Button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          step: 2,
                          variantMode: prev.variantMode || 'single',
                        }))
                      }
                    >
                      Next
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setForm((prev) => ({ ...prev, step: 1 }))}
                      >
                        Back
                      </Button>
                      {form.id && (
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={saving}
                          onClick={() => {
                            const product = products.find((item) => item.id === form.id);
                            if (product) {
                              setProductDialogOpen(false);
                              requestDeleteProduct(product);
                            }
                          }}
                        >
                          Delete Product
                        </Button>
                      )}
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Saving...' : form.id ? 'Update Product' : 'Create Product'}
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={categoryDialogOpen}
            onOpenChange={(open) => {
              setCategoryDialogOpen(open);
              if (!open) setDialogError('');
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{categoryForm.mode === 'edit' ? 'Edit Category' : 'New Category'}</DialogTitle>
                <DialogDescription>
                  Category names must be unique under the same parent (case does not matter).
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSaveCategory} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Category name</label>
                  <input
                    className={inputClassName}
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Parent category</label>
                  <select
                    className={inputClassName}
                    value={categoryForm.parentId}
                    onChange={(e) => setCategoryForm({ ...categoryForm, parentId: e.target.value })}
                    disabled={categoryForm.mode === 'edit'}
                  >
                    <option value="">None (top level)</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {`${'— '.repeat(category.depth || 0)}${category.name}`}
                      </option>
                    ))}
                  </select>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : categoryForm.mode === 'edit' ? 'Save Category' : 'Create Category'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={stockDialogOpen}
            onOpenChange={(open) => {
              setStockDialogOpen(open);
              if (!open) setDialogError('');
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adjust Inventory</DialogTitle>
                <DialogDescription>
                  Enter a quantity to add or remove. For Sale / Transfer out / Return out, enter a positive number and stock is reduced automatically.
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleAdjustStock} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Variant</label>
                  <select
                    className={inputClassName}
                    value={stockForm.variantId}
                    onChange={(e) => setStockForm({ ...stockForm, variantId: e.target.value })}
                  >
                    {stockVariantOptions.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.name || variant.sku} — on hand: {Number(variant.inventory?.onHand || 0)}
                        {variant.barcode ? ` (${variant.barcode})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-2">Transaction type</label>
                    <select
                      className={inputClassName}
                      value={stockForm.transactionType}
                      onChange={(e) => setStockForm({ ...stockForm, transactionType: e.target.value })}
                    >
                      <option value="purchase">Purchase (add)</option>
                      <option value="initial">Initial stock (add)</option>
                      <option value="return_in">Return in (add)</option>
                      <option value="transfer_in">Transfer in (add)</option>
                      <option value="sale">Sale (remove)</option>
                      <option value="return_out">Return out (remove)</option>
                      <option value="transfer_out">Transfer out (remove)</option>
                      <option value="adjustment">Adjustment (+/- signed)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Quantity</label>
                    <input
                      type="number"
                      step="0.01"
                      className={inputClassName}
                      value={stockForm.quantity}
                      onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                      placeholder="e.g. 10"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Unit cost (Rs.)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Rs.
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={cn(inputClassName, 'pl-10')}
                      value={stockForm.unitCost}
                      onChange={(e) => setStockForm({ ...stockForm, unitCost: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Notes</label>
                  <textarea
                    className={cn(inputClassName, 'min-h-24')}
                    value={stockForm.notes}
                    onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })}
                  />
                </div>

                {inventoryHistory.length > 0 && <div className="rounded-lg border border-border p-3"><p className="mb-2 text-sm font-semibold">Recent inventory history</p><div className="space-y-1 text-xs text-muted-foreground">{inventoryHistory.slice(0, 5).map((entry) => <div key={entry.id} className="flex justify-between gap-2"><span>{entry.transactionType} ({entry.quantity})</span><span>{entry.performedBy === user?.id ? 'You' : (entry.performerName || 'System')}</span></div>)}</div></div>}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setStockDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Record Stock Change'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={deleteProductDialogOpen}
            onOpenChange={(open) => {
              setDeleteProductDialogOpen(open);
              if (!open) {
                setDialogError('');
                setDeleteTarget(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {deleteTarget?.kind === 'variant' ? 'Delete Variant' : 'Delete Product'}
                </DialogTitle>
                <DialogDescription>
                  {deleteTarget?.kind === 'variant'
                    ? `This will archive only "${deleteTarget?.name || 'this variant'}". Other variants of the product stay active. Inventory transactions stay in the ledger.`
                    : `This will archive ${deleteTarget?.name || 'this product'} and all of its variants. Inventory transactions stay in the ledger.`}
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              {!dialogError && deleteTarget?.stock === 0 && (
                <p className="text-sm text-muted-foreground">
                  Stock is 0 — safe to archive.
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteProductDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteProduct}
                  disabled={saving || Boolean(dialogError)}
                >
                  {saving
                    ? 'Deleting...'
                    : deleteTarget?.kind === 'variant'
                      ? 'Delete Variant'
                      : 'Delete Product'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={deleteCategoryDialogOpen}
            onOpenChange={(open) => {
              setDeleteCategoryDialogOpen(open);
              if (!open) setDialogError('');
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Category</DialogTitle>
                <DialogDescription>
                  {categoryDeleteTarget?.productCount
                    ? `${categoryDeleteTarget.name} contains ${categoryDeleteTarget.productCount} product${categoryDeleteTarget.productCount === 1 ? '' : 's'}. Choose what to do with them.`
                    : `This will archive ${categoryDeleteTarget?.name || 'this category'}.`}
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteCategoryDialogOpen(false)}>
                  Cancel
                </Button>
                {categoryDeleteTarget?.productCount ? <>
                  <Button variant="outline" onClick={() => { setDeleteCategoryDialogOpen(false); navigate('/products'); }}>
                    Go to Products List
                  </Button>
                  <Button variant="destructive" onClick={handleDeleteCategory} disabled={saving}>
                    {saving ? 'Moving...' : 'Move to Uncategorized'}
                  </Button>
                </> : <Button variant="destructive" onClick={handleDeleteCategory} disabled={saving}>
                  {saving ? 'Deleting...' : 'Delete Category'}
                </Button>}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AppShell>
  );
}
