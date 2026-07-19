import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Barcode,
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
import { invokeWithAuth } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function newVariantDraft(index = 0, overrides = {}) {
  return {
    id: window.crypto.randomUUID(),
    name: '',
    sku: '',
    barcode: '',
    sellingPrice: '0',
    costPrice: '0',
    trackInventory: true,
    isDefault: index === 0,
    isHidden: index === 0,
    sortOrder: index,
    attributesText: '{}',
    initialStock: '',
    ...overrides,
  };
}

function normalizeVariantForPayload(variant) {
  let attributes = {};
  if (variant.attributesText?.trim()) {
    attributes = JSON.parse(variant.attributesText);
  }

  const initialStock = Number(variant.initialStock);
  return {
    id: variant.id,
    name: variant.name.trim() || undefined,
    sku: variant.sku.trim() || undefined,
    barcode: variant.barcode.trim() || undefined,
    sellingPrice: Number(variant.sellingPrice || 0),
    costPrice: Number(variant.costPrice || 0),
    trackInventory: Boolean(variant.trackInventory),
    isDefault: Boolean(variant.isDefault),
    isHidden: Boolean(variant.isHidden),
    sortOrder: Number(variant.sortOrder || 0),
    attributes,
    initialStock: Number.isFinite(initialStock) && initialStock > 0 ? initialStock : undefined,
  };
}

function productToForm(product) {
  return {
    id: product.id,
    name: product.name || '',
    description: product.description || '',
    brand: product.brand || '',
    taxRate: String(product.taxRate ?? 0),
    categoryId: product.categoryId || '',
    imageUrls: Array.isArray(product.imageUrls) ? [...product.imageUrls] : [],
    variants: (product.variants?.length ? product.variants : [null]).map((variant, index) => {
      if (!variant) return newVariantDraft(index);
      return {
        id: variant.id,
        name: variant.name || '',
        sku: variant.sku || '',
        barcode: variant.barcode || '',
        sellingPrice: String(variant.sellingPrice ?? 0),
        costPrice: String(variant.costPrice ?? 0),
        trackInventory: Boolean(variant.trackInventory),
        isDefault: Boolean(variant.isDefault),
        isHidden: Boolean(variant.isHidden),
        sortOrder: String(variant.sortOrder ?? index),
        attributesText: JSON.stringify(variant.attributes || {}, null, 2),
        initialStock: '',
      };
    }),
  };
}

function emptyProductForm(categoryId = '') {
  return {
    id: null,
    name: '',
    description: '',
    brand: '',
    taxRate: '0',
    categoryId: categoryId || '',
    imageUrls: [],
    variants: [newVariantDraft(0)],
  };
}

/** Display prices in Sri Lankan Rupees (Rs.) */
function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Rs. ${amount.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function categoryDisplayName(category) {
  if (!category) return 'Uncategorized';
  return category.path || category.name;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function productMatchesSearch(product, query) {
  if (!query) return true;
  const haystack = [
    product.name,
    product.brand,
    product.description,
    product.category?.name,
    product.category?.path,
    ...(product.variants || []).flatMap((variant) => [variant.name, variant.sku, variant.barcode]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

export default function ProductsManagement() {
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

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
  const [stockTargetProduct, setStockTargetProduct] = useState(null);

  const imageInputRef = useRef(null);
  const searchInputRef = useRef(null);

  const notifySuccess = (message) => {
    setSuccess(message);
    setError('');
    window.setTimeout(() => setSuccess(''), 4000);
  };

  const loadData = useCallback(async () => {
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
        // keep product error if both fail
      } else {
        setError(categoriesResponse.error || 'Failed to load categories');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load product data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    const query = searchQuery.trim().toLowerCase();

    return products.filter((product) => {
      if (selectedCategoryId) {
        if (product.categoryId !== selectedCategoryId) return false;
      }
      return productMatchesSearch(product, query);
    });
  }, [products, selectedCategoryId, searchQuery]);

  const openCreateProduct = (categoryId = '') => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    setForm(emptyProductForm(categoryId || selectedCategoryId || ''));
    setProductDialogOpen(true);
  };

  const openEditProduct = (product) => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    setForm(productToForm(product));
    setProductDialogOpen(true);
  };

  const updateVariant = (index, field, value) => {
    setForm((prev) => {
      const variants = prev.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant
      );
      return { ...prev, variants };
    });
  };

  const addVariant = () => {
    setForm((prev) => ({
      ...prev,
      variants: [...prev.variants, newVariantDraft(prev.variants.length, { isHidden: false, isDefault: false })],
    }));
  };

  const removeVariant = (index) => {
    setForm((prev) => {
      const variants = prev.variants.filter((_, variantIndex) => variantIndex !== index);
      return {
        ...prev,
        variants: variants.length ? variants : [newVariantDraft(0)],
      };
    });
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

    if (!form.name.trim()) {
      setDialogError('Product name is required.');
      return;
    }

    let variants;
    try {
      variants = form.variants.map(normalizeVariantForPayload);
    } catch {
      setDialogError('Variant attributes must be valid JSON.');
      return;
    }

    const seenSkus = new Set();
    const seenBarcodes = new Set();
    for (const variant of variants) {
      if (variant.sku) {
        const skuKey = variant.sku.toLowerCase();
        if (seenSkus.has(skuKey)) {
          setDialogError('Each variant SKU must be unique within this product.');
          return;
        }
        seenSkus.add(skuKey);
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

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      brand: form.brand.trim() || undefined,
      taxRate: Number(form.taxRate || 0),
      categoryId: form.categoryId || undefined,
      imageUrls: form.imageUrls,
      variants,
    };

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
    const trimmed = name.trim().toLowerCase();
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

    if (!categoryForm.name.trim()) {
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
      name: categoryForm.name.trim(),
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

  const openStockDialog = (product) => {
    if (!isAdmin) return;
    setDialogError('');
    setError('');
    const variant = product.defaultVariant || product.variants?.[0] || null;
    setStockTargetProduct(product);
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
      setDialogError('Enter a positive quantity. Outgoing types (sale, transfer out) reduce stock automatically.');
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
      notifySuccess('Stock updated successfully.');
      loadData();
    } else {
      setDialogError(response.error || 'Failed to adjust stock');
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    setDialogError('');
    const response = await invokeWithAuth('product:delete', {
      productId: deleteTarget.id,
    });
    setSaving(false);

    if (response.success) {
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      notifySuccess('Product deleted.');
      loadData();
    } else {
      setDialogError(response.error || 'Failed to delete product');
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

  const stockVariantOptions = stockTargetProduct?.variants || [];
  const pageTitle = isAdmin ? 'Product Module' : 'Product Catalog';
  const pageDescription = isAdmin
    ? 'Browse categories, manage products, and keep inventory up to date.'
    : 'Search products by name, SKU, or barcode. Browse by category.';

  return (
    <AppShell title={pageTitle} description={pageDescription}>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total products</CardDescription>
              <CardTitle className="text-3xl">{products.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total variants</CardDescription>
              <CardTitle className="text-3xl">
                {products.reduce((sum, product) => sum + (product.variants?.length || 0), 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Tracked stock</CardDescription>
              <CardTitle className="text-3xl">
                {products.reduce((sum, product) => sum + Number(product.inventoryTotal || 0), 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Categories</CardDescription>
              <CardTitle className="text-3xl">{categories.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

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
                      selectedCategoryId === category.id
                        ? 'font-semibold text-primary'
                        : 'text-muted-foreground'
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

        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="search"
            className={cn(inputClassName, 'pl-10')}
            placeholder="Search products by name, SKU, barcode, or brand..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
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
                        <p className="font-medium truncate">{category.name}</p>
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
                {searchQuery.trim()
                  ? 'No products match your search'
                  : selectedCategory
                    ? 'No products in this category yet'
                    : 'No products yet'}
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
                            <p className="text-xs text-muted-foreground truncate">
                              {product.brand || 'No brand'}
                              {(product.variants?.length || 0) > 1
                                ? ` · ${product.variants.length} variants`
                                : ''}
                            </p>
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
                                setDeleteDialogOpen(true);
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
            <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
              <DialogHeader>
                <DialogTitle>{form.id ? 'Edit Product' : 'Add Product'}</DialogTitle>
                <DialogDescription>Name, price, and stock.</DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSaveProduct} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2" htmlFor="product-name">
                    Product name
                  </label>
                  <input
                    id="product-name"
                    className={inputClassName}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {`${'— '.repeat(category.depth || 0)}${category.name}`}
                      </option>
                    ))}
                  </select>
                </div>

                {form.variants.length === 1 ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="product-price">
                          Selling price (Rs.)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            Rs.
                          </span>
                          <input
                            id="product-price"
                            type="number"
                            step="0.01"
                            min="0"
                            className={cn(inputClassName, 'pl-10')}
                            value={form.variants[0].sellingPrice}
                            onChange={(e) => updateVariant(0, 'sellingPrice', e.target.value)}
                          />
                        </div>
                      </div>
                      {!form.id && (
                        <div>
                          <label className="block text-sm font-medium mb-2" htmlFor="product-stock">
                            Stock
                          </label>
                          <input
                            id="product-stock"
                            type="number"
                            step="1"
                            min="0"
                            className={inputClassName}
                            value={form.variants[0].initialStock}
                            onChange={(e) => updateVariant(0, 'initialStock', e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="product-barcode">
                          Barcode
                        </label>
                        <input
                          id="product-barcode"
                          className={inputClassName}
                          value={form.variants[0].barcode}
                          onChange={(e) => updateVariant(0, 'barcode', e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder="Scan or type"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="product-sku">
                          SKU
                        </label>
                        <input
                          id="product-sku"
                          className={inputClassName}
                          value={form.variants[0].sku}
                          onChange={(e) => updateVariant(0, 'sku', e.target.value)}
                          placeholder="Leave blank to auto-generate"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Sizes / variants</p>
                    {form.variants.map((variant, index) => (
                      <div key={variant.id} className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            className={inputClassName}
                            value={variant.name}
                            onChange={(e) => updateVariant(index, 'name', e.target.value)}
                            placeholder={`Size / name ${index + 1}`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeVariant(index)}
                            disabled={form.variants.length === 1}
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-medium mb-1">Price (Rs.)</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                Rs.
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className={cn(inputClassName, 'pl-10')}
                                value={variant.sellingPrice}
                                onChange={(e) => updateVariant(index, 'sellingPrice', e.target.value)}
                              />
                            </div>
                          </div>
                          {!form.id && (
                            <div>
                              <label className="block text-xs font-medium mb-1">Stock</label>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                className={inputClassName}
                                value={variant.initialStock}
                                onChange={(e) => updateVariant(index, 'initialStock', e.target.value)}
                                placeholder="0"
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs font-medium mb-1">Barcode</label>
                            <input
                              className={inputClassName}
                              value={variant.barcode}
                              onChange={(e) => updateVariant(index, 'barcode', e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                              placeholder="Scan or type"
                              autoComplete="off"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">SKU</label>
                            <input
                              className={inputClassName}
                              value={variant.sku}
                              onChange={(e) => updateVariant(index, 'sku', e.target.value)}
                              placeholder="Auto if blank"
                              autoComplete="off"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <Button type="button" variant="ghost" size="sm" className="px-0" onClick={addVariant}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add size / variant
                  </Button>
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

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : form.id ? 'Update Product' : 'Create Product'}
                  </Button>
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
                  Enter a quantity to add or remove. For Sale / Transfer out / Return out, enter a positive
                  number — stock is reduced automatically.
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
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open);
              if (!open) setDialogError('');
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Product</DialogTitle>
                <DialogDescription>
                  This will archive {deleteTarget?.name || 'this product'} and all of its variants. Inventory
                  transactions stay in the ledger.
                </DialogDescription>
              </DialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteProduct} disabled={saving}>
                  {saving ? 'Deleting...' : 'Delete Product'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AppShell>
  );
}
