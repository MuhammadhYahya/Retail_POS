import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownUp,
  Barcode,
  CircleDollarSign,
  FolderTree,
  Package,
  PencilLine,
  Plus,
  Trash2,
  Boxes,
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
    ...overrides,
  };
}

function parseListText(value) {
  return String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeVariantForPayload(variant) {
  let attributes = {};
  if (variant.attributesText?.trim()) {
    attributes = JSON.parse(variant.attributesText);
  }

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
    imageUrlsText: (product.imageUrls || []).join('\n'),
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
      };
    }),
  };
}

function emptyProductForm() {
  return {
    id: null,
    name: '',
    description: '',
    brand: '',
    taxRate: '0',
    categoryId: '',
    imageUrlsText: '',
    variants: [newVariantDraft(0)],
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function categoryLabel(category) {
  if (!category) return 'Uncategorized';
  return `${'  '.repeat(category.depth || 0)}${category.name}`;
}

export default function ProductsManagement() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyProductForm());
  const [categoryForm, setCategoryForm] = useState({ name: '', parentId: '' });
  const [stockForm, setStockForm] = useState({
    variantId: '',
    quantity: '0',
    transactionType: 'adjustment',
    unitCost: '',
    notes: '',
  });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [stockTargetProduct, setStockTargetProduct] = useState(null);

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

  const openCreateProduct = () => {
    setError('');
    setForm(emptyProductForm());
    setProductDialogOpen(true);
  };

  const openEditProduct = (product) => {
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

  const handleSaveProduct = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('Product name is required.');
      return;
    }

    let variants;
    try {
      variants = form.variants.map(normalizeVariantForPayload);
    } catch (err) {
      setError('Variant attributes must be valid JSON.');
      return;
    }

    const seenSkus = new Set();
    const seenBarcodes = new Set();
    for (const variant of variants) {
      if (variant.sku) {
        if (seenSkus.has(variant.sku)) {
          setError('Each variant SKU must be unique within the product form.');
          return;
        }
        seenSkus.add(variant.sku);
      }

      if (variant.barcode) {
        if (seenBarcodes.has(variant.barcode)) {
          setError('Each variant barcode must be unique within the product form.');
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
      imageUrls: parseListText(form.imageUrlsText),
      variants,
    };

    const response = form.id
      ? await invokeWithAuth('product:update', { productId: form.id, ...payload })
      : await invokeWithAuth('product:create', payload);

    setSaving(false);

    if (response.success) {
      setProductDialogOpen(false);
      setForm(emptyProductForm());
      loadData();
    } else {
      setError(response.error || 'Failed to save product');
    }
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    setError('');

    if (!categoryForm.name.trim()) {
      setError('Category name is required.');
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
      loadData();
    } else {
      setError(response.error || 'Failed to save category');
    }
  };

  const openStockDialog = (product) => {
    setError('');
    const variant = product.defaultVariant || product.variants?.[0] || null;
    setStockTargetProduct(product);
    setStockForm({
      variantId: variant?.id || '',
      quantity: '0',
      transactionType: 'adjustment',
      unitCost: '',
      notes: '',
    });
    setStockDialogOpen(true);
  };

  const handleAdjustStock = async (event) => {
    event.preventDefault();
    setError('');

    if (!stockForm.variantId) {
      setError('Choose a variant to adjust.');
      return;
    }

    const quantity = Number(stockForm.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      setError('Enter a non-zero stock quantity.');
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
      loadData();
    } else {
      setError(response.error || 'Failed to adjust stock');
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    const response = await invokeWithAuth('product:delete', {
      productId: deleteTarget.id,
    });
    setSaving(false);

    if (response.success) {
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      loadData();
    } else {
      setError(response.error || 'Failed to delete product');
    }
  };

  const stockVariantOptions = stockTargetProduct?.variants || [];

  return (
    <AppShell title="Product Module" description="Products own shared catalog data. Variants own the sellable item.">
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

        <div className="flex flex-wrap gap-3 justify-between items-center">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              The POS should always sell variants. Hidden default variants are created for simple products.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => {
              setError('');
              setCategoryDialogOpen(true);
            }}>
              <FolderTree className="h-4 w-4 mr-2" />
              New Category
            </Button>
            <Button onClick={openCreateProduct}>
              <Plus className="h-4 w-4 mr-2" />
              New Product
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-muted-foreground text-sm">Loading products...</p>
          ) : products.length === 0 ? (
            <div className="p-10 text-center">
              <Package className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">No products yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first product, then add variants and inventory.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead>Default Variant</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const defaultVariant = product.defaultVariant || product.variants?.[0] || null;
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.brand || 'No brand'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {categoryLabel(product.category)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {(product.variants || []).map((variant) => (
                            <span
                              key={variant.id}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
                            >
                              {variant.isDefault && <span className="text-primary font-semibold">Default</span>}
                              <span>{variant.name || variant.sku}</span>
                              {variant.isHidden && <span className="text-muted-foreground">(hidden)</span>}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {defaultVariant ? (
                          <div className="space-y-1">
                            <p className="font-medium">{defaultVariant.name || defaultVariant.sku}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Barcode className="h-3 w-3" />
                              {defaultVariant.barcode || 'No barcode'}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <CircleDollarSign className="h-3 w-3" />
                              {formatCurrency(defaultVariant.sellingPrice)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">No variants</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium flex items-center gap-1">
                            <Boxes className="h-4 w-4 text-primary" />
                            {Number(product.inventoryTotal || 0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {product.variants?.length || 0} variant{(product.variants?.length || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </TableCell>
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
                              setDeleteTarget(product);
                              setDeleteDialogOpen(true);
                            }}
                            title="Delete product"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-4xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Product' : 'Create Product'}</DialogTitle>
            <DialogDescription>
              Shared data belongs to the product. Every sellable item belongs to a variant.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveProduct} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="product-name">
                  Product name
                </label>
                <input
                  id="product-name"
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="product-brand">
                  Brand
                </label>
                <input
                  id="product-brand"
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" htmlFor="product-description">
                Description
              </label>
              <textarea
                id="product-description"
                className="w-full min-h-24 p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="product-tax">
                  Tax rate
                </label>
                <input
                  id="product-tax"
                  type="number"
                  step="0.01"
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.taxRate}
                  onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="product-category">
                  Category
                </label>
                <select
                  id="product-category"
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="product-image-urls">
                  Image URLs
                </label>
                <textarea
                  id="product-image-urls"
                  className="w-full min-h-24 p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="One URL per line"
                  value={form.imageUrlsText}
                  onChange={(e) => setForm({ ...form, imageUrlsText: e.target.value })}
                />
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Variants</p>
                  <p className="text-sm text-muted-foreground">
                    Leave one variant only for a simple product. Add more variants for sizes, packs, or colors.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={addVariant}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Variant
                </Button>
              </div>

              <div className="space-y-4">
                {form.variants.map((variant, index) => (
                  <div key={variant.id} className="rounded-xl border border-border p-4 space-y-4 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">Variant {index + 1}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVariant(index)}
                        disabled={form.variants.length === 1}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium mb-2">Variant name</label>
                        <input
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.name}
                          onChange={(e) => updateVariant(index, 'name', e.target.value)}
                          placeholder="Optional override"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">SKU</label>
                        <input
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.sku}
                          onChange={(e) => updateVariant(index, 'sku', e.target.value)}
                          placeholder="Auto-generated if blank"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Barcode</label>
                        <input
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.barcode}
                          onChange={(e) => updateVariant(index, 'barcode', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Selling price</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.sellingPrice}
                          onChange={(e) => updateVariant(index, 'sellingPrice', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Cost price</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.costPrice}
                          onChange={(e) => updateVariant(index, 'costPrice', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Sort order</label>
                        <input
                          type="number"
                          className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={variant.sortOrder}
                          onChange={(e) => updateVariant(index, 'sortOrder', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium mb-2">Attributes JSON</label>
                        <textarea
                          className="w-full min-h-24 p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono text-xs"
                          value={variant.attributesText}
                          onChange={(e) => updateVariant(index, 'attributesText', e.target.value)}
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={variant.trackInventory}
                            onChange={(e) => updateVariant(index, 'trackInventory', e.target.checked)}
                          />
                          Track inventory
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={variant.isDefault}
                            onChange={(e) => updateVariant(index, 'isDefault', e.target.checked)}
                          />
                          Default variant
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={variant.isHidden}
                            onChange={(e) => updateVariant(index, 'isHidden', e.target.checked)}
                          />
                          Hidden variant
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Category</DialogTitle>
            <DialogDescription>
              Categories use a single self-referencing table, so unlimited nesting works without extra tables.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCategory} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Category name</label>
              <input
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Parent category</label>
              <select
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={categoryForm.parentId}
                onChange={(e) => setCategoryForm({ ...categoryForm, parentId: e.target.value })}
              >
                <option value="">None</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryLabel(category)}
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

      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Inventory</DialogTitle>
            <DialogDescription>
              Inventory changes are recorded as ledger entries against a variant, never the product.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdjustStock} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Variant</label>
              <select
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={stockForm.variantId}
                onChange={(e) => setStockForm({ ...stockForm, variantId: e.target.value })}
              >
                {stockVariantOptions.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name || variant.sku} {variant.barcode ? `(${variant.barcode})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-2">Transaction type</label>
                <select
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={stockForm.transactionType}
                  onChange={(e) => setStockForm({ ...stockForm, transactionType: e.target.value })}
                >
                  <option value="adjustment">Adjustment</option>
                  <option value="purchase">Purchase</option>
                  <option value="sale">Sale</option>
                  <option value="return_in">Return in</option>
                  <option value="return_out">Return out</option>
                  <option value="transfer_in">Transfer in</option>
                  <option value="transfer_out">Transfer out</option>
                  <option value="initial">Initial stock</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={stockForm.quantity}
                  onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Unit cost</label>
              <input
                type="number"
                step="0.01"
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={stockForm.unitCost}
                onChange={(e) => setStockForm({ ...stockForm, unitCost: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Notes</label>
              <textarea
                className="w-full min-h-24 p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>
              This will archive the product and all of its variants. Inventory transactions stay in the ledger.
            </DialogDescription>
          </DialogHeader>

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
    </AppShell>
  );
}
