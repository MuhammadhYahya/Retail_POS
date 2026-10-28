import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { invokeWithAuth, notifyLowStockUpdated } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import { hasPermission } from '../../lib/permissions.js';
import { isMeasuredUnit } from '../../lib/productUnits';
import {
  buildAttributeSets,
  expandNumericSizeRange,
  hydrateVariantBuilder,
  groupsFromVariants,
  newVariantGroup,
  VARIANT_AXIS_TYPES,
  VARIANT_BUILD_MODES,
} from '../../lib/productVariantOptions';
import {
  buildVariantsFromPairs,
  cleanText,
  collectProductSoftWarnings,
  emptyProductForm,
  isWithinDateRange,
  newVariantDraft,
  parseAttributes,
  prepareProductPayload,
  productMatchesSearch,
  productToForm,
  readFileAsDataUrl,
  uniquePreserveOrder,
} from './products/productFormUtils';
import { ProductCatalogView } from './products/ProductCatalogView';
import { ProductEditorDialog } from './products/ProductEditorDialog';
import { ProductManagementDialogs } from './products/ProductManagementDialogs';

export default function ProductsManagement() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canViewMargin = user?.role !== 'cashier';
  const canManageStock = hasPermission(user, 'stockAdjust');

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
      if (statusFilter === 'draft' && !product.isDraft) return false;
      if (statusFilter === 'published' && product.isDraft) return false;
      if (!isWithinDateRange(product, appliedDateRange.from, appliedDateRange.to)) return false;
      return productMatchesSearch(product, searchQuery.trim());
    });
  }, [products, selectedCategoryId, statusFilter, appliedDateRange, searchQuery]);

  const productRows = useMemo(() => filteredProducts.flatMap((product) => {
    const variants = product.variants?.length ? product.variants : [null];
    const isVariantFamily = (product.variants || []).length > 1
      || (product.variants || []).some((variant) => variant?.attributes && Object.keys(variant.attributes || {}).length > 0);
    return variants.map((variant) => ({
      product,
      variant,
      isVariantRow: isVariantFamily,
    }));
  }), [filteredProducts]);

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

  const formatPackSizeValue = (rawValue) => {
    const value = cleanText(rawValue);
    const unit = cleanText(form.unit);
    if (!value || !unit) return '';
    return `${value} ${unit}`;
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

  const addPackSizeValue = () => {
    const next = formatPackSizeValue(form.packSizePicker);
    if (!next) return;
    setDialogError('');
    setForm((prev) => ({
      ...prev,
      packSizePicker: '',
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
          packSizePicker: '',
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
        packSizePicker: '',
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
        packSizePicker: '',
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
      if (config.axisType === VARIANT_AXIS_TYPES.packSize) message = 'Add at least one pack size before building variants.';
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

  const saveProductCore = async (isDraft) => {
    setDialogError('');

    if (!cleanText(form.name)) {
      setDialogError('Product name is required.');
      return;
    }

    if (form.variantMode === 'matrix' && !form.variantRows.length) {
      setDialogError('Generate at least one variant before saving.');
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
      ? await invokeWithAuth('product:update', { productId: form.id, ...payload, isDraft })
      : await invokeWithAuth('product:create', { ...payload, isDraft });
    setSaving(false);

    if (response.success) {
      setProductDialogOpen(false);
      setForm(emptyProductForm(''));
      const baseMsg = isDraft
        ? 'Draft saved.'
        : form.id ? 'Product updated successfully.' : 'Product added successfully.';
      notifySuccess(softWarnings.length ? `${baseMsg} ${softWarnings[0]}` : baseMsg);
      loadData();
    } else {
      setDialogError(response.error || 'Failed to save product');
    }
  };

  const handleSaveProduct = async (event) => {
    event.preventDefault();
    await saveProductCore(false);
  };

  const handleSaveDraft = async () => {
    await saveProductCore(true);
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
    const nextAxisType = isMeasuredUnit(form.unit)
      ? VARIANT_AXIS_TYPES.packSize
      : VARIANT_AXIS_TYPES.sizeAndColor;
    setForm((prev) => ({
      ...prev,
      variantMode: 'matrix',
      step: 2,
      variantAxisType: isMeasuredUnit(prev.unit) ? VARIANT_AXIS_TYPES.packSize : (prev.variantAxisType || nextAxisType),
      variantRows: prev.variantRows.length
        ? prev.variantRows
        : [],
      variantGroups: prev.variantGroups?.length
        ? prev.variantGroups
        : [],
      activeGroupId: prev.activeGroupId || prev.variantGroups?.[0]?.id || '',
      packSizePicker: '',
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
      <ProductCatalogView
        isAdmin={isAdmin}
        canManageStock={canManageStock}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        selectedCategory={selectedCategory}
        breadcrumb={breadcrumb}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        dateFilterMode={dateFilterMode}
        setDateFilterMode={setDateFilterMode}
        dateFromDraft={dateFromDraft}
        setDateFromDraft={setDateFromDraft}
        dateToDraft={dateToDraft}
        setDateToDraft={setDateToDraft}
        setAppliedDateRange={setAppliedDateRange}
        success={success}
        error={error}
        childCategories={childCategories}
        products={products}
        categories={categories}
        openEditCategoryDialog={openEditCategoryDialog}
        requestDeleteCategory={requestDeleteCategory}
        openCreateProduct={openCreateProduct}
        openNewCategoryDialog={openNewCategoryDialog}
        productRows={productRows}
        loading={loading}
        filteredProducts={filteredProducts}
        openStockDialog={openStockDialog}
            openEditProduct={openEditProduct}
            requestDeleteVariant={requestDeleteVariant}
            requestDeleteProduct={requestDeleteProduct}
            canViewMargin={canViewMargin}
          />

      {isAdmin && (
        <>
          <ProductEditorDialog
            productDialogOpen={productDialogOpen}
            setProductDialogOpen={setProductDialogOpen}
            setDialogError={setDialogError}
            form={form}
            setForm={setForm}
            dialogError={dialogError}
            success={success}
            handleSaveProduct={handleSaveProduct}
            handleSaveDraft={handleSaveDraft}
            updateForm={updateForm}
            categories={categories}
            imageInputRef={imageInputRef}
            handleImageFiles={handleImageFiles}
            removeImage={removeImage}
            startSingleMode={startSingleMode}
            startMatrixMode={startMatrixMode}
            updateSingleVariant={updateSingleVariant}
            switchAxisType={switchAxisType}
            addSimpleValue={addSimpleValue}
            removeSimpleValue={removeSimpleValue}
            addPackSizeValue={addPackSizeValue}
            addSimpleSizeRange={addSimpleSizeRange}
            addVariantGroup={addVariantGroup}
            switchBuildMode={switchBuildMode}
            removeVariantGroup={removeVariantGroup}
            addSizeToActiveGroup={addSizeToActiveGroup}
            addSizeRangeToActiveGroup={addSizeRangeToActiveGroup}
            addColorToActiveGroup={addColorToActiveGroup}
            addCustomColorToActiveGroup={addCustomColorToActiveGroup}
            removeValueFromGroup={removeValueFromGroup}
            buildVariants={buildVariants}
            builderConfig={builderConfig}
            addVariantRow={addVariantRow}
            updateVariantRow={updateVariantRow}
            removeVariantRow={removeVariantRow}
            notifySuccess={notifySuccess}
            saving={saving}
            products={products}
            requestDeleteProduct={requestDeleteProduct}
          />
          <ProductManagementDialogs
            categoryDialogOpen={categoryDialogOpen}
            setCategoryDialogOpen={setCategoryDialogOpen}
            setDialogError={setDialogError}
            categoryForm={categoryForm}
            setCategoryForm={setCategoryForm}
            dialogError={dialogError}
            handleSaveCategory={handleSaveCategory}
            categories={categories}
            saving={saving}
            stockDialogOpen={stockDialogOpen}
            setStockDialogOpen={setStockDialogOpen}
            handleAdjustStock={handleAdjustStock}
            stockForm={stockForm}
            setStockForm={setStockForm}
            stockVariantOptions={stockVariantOptions}
            inventoryHistory={inventoryHistory}
            user={user}
            deleteProductDialogOpen={deleteProductDialogOpen}
            setDeleteProductDialogOpen={setDeleteProductDialogOpen}
            setDeleteTarget={setDeleteTarget}
            deleteTarget={deleteTarget}
            handleDeleteProduct={handleDeleteProduct}
            deleteCategoryDialogOpen={deleteCategoryDialogOpen}
            setDeleteCategoryDialogOpen={setDeleteCategoryDialogOpen}
            categoryDeleteTarget={categoryDeleteTarget}
            handleDeleteCategory={handleDeleteCategory}
            navigate={navigate}
          />
        </>
      )}
    </AppShell>
  );
}

