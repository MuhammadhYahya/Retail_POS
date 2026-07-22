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
import { cn } from '../../lib/utils';

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

function splitList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function deriveVariantAxes(variants = []) {
  const sizes = new Set();
  const colors = new Set();

  variants.forEach((variant) => {
    const attrs = variant.attributes || parseAttributes(variant.attributesText);
    if (attrs.size) sizes.add(String(attrs.size).trim());
    if (attrs.color) colors.add(String(attrs.color).trim());
  });

  return {
    sizes: Array.from(sizes),
    colors: Array.from(colors),
  };
}

function buildVariantMatrix(productName, axes, existingRows = []) {
  const sizes = splitList(axes.sizes);
  const colors = splitList(axes.colors);
  const combinations = [];

  if (!sizes.length && !colors.length) {
    return existingRows.length ? existingRows : [newVariantDraft(0)];
  }

  if (sizes.length && colors.length) {
    sizes.forEach((size) => {
      colors.forEach((color) => {
        combinations.push({ size, color });
      });
    });
  } else if (sizes.length) {
    sizes.forEach((size) => combinations.push({ size }));
  } else if (colors.length) {
    colors.forEach((color) => combinations.push({ color }));
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
    const name = [attributes.size, attributes.color].filter(Boolean).join(' / ') || `${productName} Variant`;

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
  const axes = isMatrix ? deriveVariantAxes(product.variants || []) : { sizes: [], colors: [] };

  return {
    id: product.id,
    step,
    name: product.name || '',
    description: product.description || '',
    brand: product.brand || '',
    unit: product.unit || '',
    taxRate: String(product.taxRate ?? 0),
    categoryId: product.categoryId || '',
    imageUrls: Array.isArray(product.imageUrls) ? [...product.imageUrls] : [],
    variantMode: isMatrix ? 'matrix' : 'single',
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
    variantAxes: axes,
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
    taxRate: '0',
    categoryId: categoryId || '',
    imageUrls: [],
    variantMode: 'single',
    singleVariant: newVariantDraft(0),
    variantAxes: { sizes: '', colors: '' },
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

function hasRequiredBarcodes(form) {
  const variants = form.variantMode === 'matrix' ? form.variantRows : [form.singleVariant];
  return variants.length > 0 && variants.every((variant) => cleanText(variant?.barcode));
}

function prepareProductPayload(form) {
  const base = {
    name: cleanText(form.name),
    description: cleanText(form.description) || undefined,
    brand: cleanText(form.brand) || undefined,
    unit: cleanText(form.unit) || undefined,
    taxRate: Number(form.taxRate || 0),
    categoryId: form.categoryId || undefined,
    imageUrls: form.imageUrls,
  };

  if (form.variantMode === 'matrix') {
    return {
      ...base,
      variants: form.variantRows.map((variant, index) => {
        const parsed = normalizeVariantForPayload({
          ...variant,
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

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogError, setDialogError] = useState('');
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
  const [categoryForm, setCategoryForm] = useState({ name: '', parentId: '' });
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
      const [productsResponse, categoriesResponse] = await Promise.all([
        invokeWithAuth('product:getAll'),
        invokeWithAuth('category:getAll'),
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
    if (loading || !isAdmin) return;

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
  }, [loading, products, searchParams, isAdmin, setSearchParams]);

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

  const openCreateProduct = (categoryId = '') => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    setForm(emptyProductForm(categoryId || selectedCategoryId || ''));
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
    setForm((prev) => ({
      ...prev,
      variantRows: prev.variantRows.filter((_, variantIndex) => variantIndex !== index),
    }));
  };

  const generateMatrix = () => {
    setForm((prev) => ({
      ...prev,
      variantRows: buildVariantMatrix(prev.name, prev.variantAxes, prev.variantRows),
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

    if (form.variantMode === 'matrix' && !form.variantRows.length) {
      setDialogError('Generate at least one variant before saving.');
      return;
    }

    if (!hasRequiredBarcodes(form)) {
      setDialogError('Barcode is required. Scan or type the product barcode.');
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

    setSaving(true);
    const response = form.id
      ? await invokeWithAuth('product:update', { productId: form.id, ...payload })
      : await invokeWithAuth('product:create', payload);
    setSaving(false);

    if (response.success) {
      setProductDialogOpen(false);
      setForm(emptyProductForm());
      notifySuccess(form.id ? 'Product updated successfully.' : 'Product added successfully.');
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
      setCategoryForm({ name: '', parentId: '' });
      notifySuccess(`Category "${response.data?.name || categoryForm.name}" created.`);
      loadData();
    } else {
      setDialogError(response.error || 'Failed to save category');
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
    const response = await invokeWithAuth('product:delete', { productId: deleteTarget.id });
    setSaving(false);

    if (response.success) {
      setDeleteProductDialogOpen(false);
      setDeleteTarget(null);
      notifySuccess('Product deleted.');
      loadData();
    } else {
      setDialogError(response.error || 'Failed to delete product');
    }
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
      name: '',
      parentId: parentId || selectedCategoryId || '',
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
        : buildVariantMatrix(prev.name, prev.variantAxes, [newVariantDraft(0)]),
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
              <span className="text-muted-foreground font-normal"> ({filteredProducts.length})</span>
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
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => {
                  const defaultVariant = product.defaultVariant || product.variants?.[0] || null;
                  const thumb = product.imageUrls?.[0];
                  return (
                    <TableRow key={product.id}>
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
                            <p className="font-medium truncate">{product.name}</p>
                            {(product.brand || (product.variants?.length || 0) > 1) && (
                              <p className="text-xs text-muted-foreground truncate">
                                {product.brand || ''}
                                {product.brand && (product.variants?.length || 0) > 1 ? ' · ' : ''}
                                {(product.variants?.length || 0) > 1 ? `${product.variants.length} variants` : ''}
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
                        <p className="font-medium flex items-center gap-1">
                          <Boxes className="h-4 w-4 text-primary" />
                          {Number(product.inventoryTotal || 0)}
                        </p>
                      </TableCell>
                      {isAdmin && (
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
                                setDialogError('');
                                setDeleteTarget(product);
                                setDeleteProductDialogOpen(true);
                              }}
                              title="Delete product"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
                  Step 1: details. Step 2: choose single pricing or variant matrix.
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
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
                        <input
                          id="product-unit"
                          className={inputClassName}
                          value={form.unit}
                          onChange={(e) => updateForm('unit', e.target.value)}
                          placeholder="e.g. pack, kg, bottle"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="product-vat">
                          VAT (%)
                        </label>
                        <input
                          id="product-vat"
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputClassName}
                          value={form.taxRate}
                          onChange={(e) => updateForm('taxRate', e.target.value)}
                        />
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
                        <p className="font-semibold">No, single price product</p>
                        <p className="text-xs text-muted-foreground">One hidden default variant is created.</p>
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
                        <p className="font-semibold">Yes, add variants</p>
                        <p className="text-xs text-muted-foreground">Sizes or colors with separate prices.</p>
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
                              min="0"
                              className={inputClassName}
                              value={form.singleVariant.sellingPrice}
                              onChange={(e) => updateSingleVariant('sellingPrice', e.target.value)}
                              placeholder="0"
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
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-stock">
                              Stock
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
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2" htmlFor="single-low-stock">
                              Low Stock Alert
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
                            {!cleanText(form.singleVariant.barcode) && <p className="mt-1 text-xs text-destructive">Barcode is required. Scan or type the product barcode.</p>}
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
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">Sizes</label>
                            <textarea
                              className={cn(inputClassName, 'min-h-24')}
                              value={form.variantAxes.sizes}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  variantAxes: { ...prev.variantAxes, sizes: e.target.value },
                                }))
                              }
                              placeholder="Small, Medium, Large"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">Colors</label>
                            <textarea
                              className={cn(inputClassName, 'min-h-24')}
                              value={form.variantAxes.colors}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  variantAxes: { ...prev.variantAxes, colors: e.target.value },
                                }))
                              }
                              placeholder="Red, Blue"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" onClick={generateMatrix}>
                            Generate matrix
                          </Button>
                          <Button type="button" variant="ghost" onClick={addVariantRow}>
                            Add variant row
                          </Button>
                        </div>

                        {form.variantRows.length > 0 ? (
                          <div className="space-y-4">
                            {form.variantRows.map((variant, index) => {
                              const skuPreview = cleanText(variant.sku);
                              return (
                                <div key={variant.id} className="rounded-xl border border-border p-4 space-y-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <input
                                        className={inputClassName}
                                        value={variant.name}
                                        onChange={(e) => updateVariantRow(index, 'name', e.target.value)}
                                        placeholder={`Variant ${index + 1}`}
                                      />
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        SKU: {skuPreview || 'Will be generated on save'}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeVariantRow(index)}
                                      disabled={form.variantRows.length === 1}
                                      title="Remove"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Selling Price (Rs.)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className={inputClassName}
                                        value={variant.sellingPrice}
                                        onChange={(e) => updateVariantRow(index, 'sellingPrice', e.target.value)}
                                        placeholder="0"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Cost Price (Rs.)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className={inputClassName}
                                        value={variant.costPrice}
                                        onChange={(e) => updateVariantRow(index, 'costPrice', e.target.value)}
                                        placeholder="0"
                                        data-focus={index === 0 ? 'variant-cost' : undefined}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Stock</label>
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        className={inputClassName}
                                        value={variant.initialStock}
                                        onChange={(e) => updateVariantRow(index, 'initialStock', e.target.value)}
                                        placeholder="0"
                                        data-focus={index === 0 ? 'variant-stock' : undefined}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Low Stock Alert</label>
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        className={inputClassName}
                                        value={variant.lowStockAlert}
                                        onChange={(e) => updateVariantRow(index, 'lowStockAlert', e.target.value)}
                                        placeholder="0"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Barcode</label>
                                      <input
                                        className={inputClassName}
                                        value={variant.barcode}
                                        onChange={(e) => updateVariantRow(index, 'barcode', e.target.value)}
                                        placeholder="Scan or type"
                                        autoComplete="off"
                                      />
                                      {!cleanText(variant.barcode) && <p className="mt-1 text-xs text-destructive">Barcode is required. Scan or type the product barcode.</p>}
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">Attributes</label>
                                      <textarea
                                        className={cn(inputClassName, 'min-h-24')}
                                        value={variant.attributesText}
                                        onChange={(e) => updateVariantRow(index, 'attributesText', e.target.value)}
                                        placeholder='{"size":"Large","color":"Red"}'
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Enter sizes/colors and click Generate matrix, or add rows manually.
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
                      <Button type="submit" disabled={saving || !hasRequiredBarcodes(form)}>
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
                <DialogTitle>New Category</DialogTitle>
                <DialogDescription>
                  Category names must be unique under the same parent (case does not matter).
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleCreateCategory} className="space-y-4">
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
                    {saving ? 'Saving...' : 'Create Category'}
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
              if (!open) setDialogError('');
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Product</DialogTitle>
                <DialogDescription>
                  This will archive {deleteTarget?.name || 'this product'} and all of its variants. Inventory transactions stay in the ledger.
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteProductDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteProduct} disabled={saving}>
                  {saving ? 'Deleting...' : 'Delete Product'}
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
