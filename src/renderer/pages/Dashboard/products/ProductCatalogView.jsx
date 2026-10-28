import React from 'react';
import {
  ArrowDownUp,
  Barcode,
  Boxes,
  CalendarRange,
  ChevronRight,
  FolderTree,
  Package,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { cn } from '../../../lib/utils';
import {
  categoryDisplayName,
  formatCurrency,
  formatVariantDetails,
  inputClassName,
} from './productFormUtils';

export function ProductCatalogView({
  isAdmin,
  canManageStock,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedCategory,
  breadcrumb,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  dateFilterMode,
  setDateFilterMode,
  dateFromDraft,
  setDateFromDraft,
  dateToDraft,
  setDateToDraft,
  setAppliedDateRange,
  success,
  error,
  childCategories,
  products,
  categories,
  openEditCategoryDialog,
  requestDeleteCategory,
  openCreateProduct,
  openNewCategoryDialog,
  productRows,
  loading,
  filteredProducts,
  openStockDialog,
  openEditProduct,
  requestDeleteVariant,
  requestDeleteProduct,
  canViewMargin = true,
}) {
  // The product table carries 9 columns for admins and 6 without margin, so the
  // card/table swap point depends on how many columns are actually rendered.
  // Both class strings are written out in full so Tailwind can see them.
  const tableClass = canViewMargin ? 'hidden @6xl:block' : 'hidden @4xl:block';
  const cardsClass = canViewMargin ? '@6xl:hidden' : '@4xl:hidden';

  const renderActions = (product, defaultVariant, isVariantRow) => (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-11 w-11"
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
            className="h-11 w-11"
            onClick={() => openEditProduct(product)}
            title="Edit product"
          >
            <PencilLine className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-11 w-11"
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
  );

  const emptyState = (
    <div className="p-10 text-center">
      <Package className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
      <p className="font-bold">
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
        <Button className="mt-4 h-12 font-bold" onClick={() => openCreateProduct(selectedCategoryId || '')}>
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ---------- Header: where am I + primary actions ---------- */}
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <nav className="flex flex-wrap items-center gap-1 text-sm min-w-0 flex-1" aria-label="Category breadcrumb">
          <button
            type="button"
            className={cn(
              'rounded-md px-2 py-1 hover:bg-muted transition-colors',
              !selectedCategoryId ? 'font-bold text-primary' : 'text-muted-foreground'
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
                  selectedCategoryId === category.id ? 'font-bold text-primary' : 'text-muted-foreground'
                )}
                onClick={() => setSelectedCategoryId(category.id)}
              >
                {category.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-12 font-bold" onClick={() => openNewCategoryDialog()}>
              <FolderTree className="h-4 w-4 mr-2" />
              New Category
            </Button>
            <Button className="h-12 font-bold" onClick={() => openCreateProduct()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </div>
        )}
      </div>

      {/* ---------- One filter toolbar, wraps instead of breaking ---------- */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              className={cn(inputClassName, 'h-12 pl-10')}
              placeholder="Search name, brand, barcode, SKU, or price"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className={cn(inputClassName, 'h-12 w-auto min-w-[10rem]')}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Product status filter"
          >
            <option value="all">All products</option>
            <option value="published">Published only</option>
            <option value="draft">Drafts only</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-input px-3 h-12 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={dateFilterMode === 'single'}
                onChange={() => setDateFilterMode('single')}
              />
              Single day
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={dateFilterMode === 'range'}
                onChange={() => setDateFilterMode('range')}
              />
              Range
            </label>
          </div>

          <div className="relative">
            <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              className={cn(inputClassName, 'h-12 pl-10 tabular-nums')}
              value={dateFromDraft}
              onChange={(e) => setDateFromDraft(e.target.value)}
              aria-label={dateFilterMode === 'range' ? 'From date' : 'Date'}
            />
          </div>

          {dateFilterMode === 'range' && (
            <div className="relative">
              <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                className={cn(inputClassName, 'h-12 pl-10 tabular-nums')}
                value={dateToDraft}
                onChange={(e) => setDateToDraft(e.target.value)}
                aria-label="To date"
              />
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="h-12 font-bold"
            onClick={() =>
              setAppliedDateRange({
                from: dateFromDraft,
                to: dateFilterMode === 'range' ? dateToDraft : dateFromDraft,
              })
            }
          >
            Filter
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12"
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

      {/* ---------- Categories ---------- */}
      {childCategories.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-muted-foreground">
            {selectedCategory ? 'Subcategories' : 'Categories'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {childCategories.map((category) => {
              const productCount = products.filter((product) => product.categoryId === category.id).length;
              const childCount = categories.filter((item) => item.parentId === category.id).length;
              return (
                <div
                  key={category.id}
                  className="group relative rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(category.id)}
                    className="w-full text-left focus:outline-none focus:ring-2 focus:ring-ring rounded-lg cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold truncate">{category.name}</p>
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
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

                  {isAdmin && (
                    <div className="mt-3 flex gap-1 border-t border-border/60 pt-2">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                        title="Edit category"
                        onClick={() => openEditCategoryDialog(category)}
                      >
                        <PencilLine className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        title="Delete category"
                        onClick={() => requestDeleteCategory(category)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isAdmin && selectedCategory && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" onClick={() => openCreateProduct(selectedCategory.id)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product in {selectedCategory.name}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => openNewCategoryDialog(selectedCategory.id)}>
            <FolderTree className="h-4 w-4 mr-2" />
            Add Subcategory
          </Button>
        </div>
      )}

      {/* ---------- Products ---------- */}
      <div className="@container border border-border rounded-2xl bg-card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">
            {selectedCategory ? `Products in ${selectedCategory.name}` : 'All products'}
            <span className="text-muted-foreground font-normal tabular-nums"> ({productRows.length})</span>
          </p>
        </div>

        {loading ? (
          <p className="p-8 text-center text-muted-foreground text-sm">Loading products...</p>
        ) : filteredProducts.length === 0 ? (
          emptyState
        ) : (
          <>
            {/* Cards when the panel is narrow — no horizontal scrolling */}
            <div className={cn('divide-y divide-border/40', cardsClass)}>
              {productRows.map(({ product, variant, isVariantRow }) => {
                const defaultVariant = variant || product.defaultVariant || product.variants?.[0] || null;
                const thumb = product.imageUrls?.[0];
                const stock = Number(defaultVariant?.inventory?.onHand ?? product.inventoryTotal ?? 0);
                return (
                  <div key={`${product.id}-${defaultVariant?.id || 'product'}`} className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-12 rounded-lg border border-border bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold flex items-center gap-2">
                          <span className="truncate">
                            {product.name}
                            {isVariantRow ? ` / ${defaultVariant?.name || 'Variant'}` : ''}
                          </span>
                          {product.isDraft && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                              Draft
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {categoryDisplayName(product.category)}
                          {product.brand ? ` · ${product.brand}` : ''}
                          {isVariantRow ? ` · ${formatVariantDetails(defaultVariant)}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums">
                          {defaultVariant ? formatCurrency(defaultVariant.sellingPrice) : '—'}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums flex items-center justify-end gap-1">
                          <Boxes className="h-3.5 w-3.5 text-primary" />
                          {stock}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">{defaultVariant?.sku || '—'}</span>
                      <span className="flex items-center gap-1 font-mono">
                        <Barcode className="h-3 w-3" />
                        {defaultVariant?.barcode || 'No barcode'}
                      </span>
                      {canViewMargin && defaultVariant && (
                        <span className="tabular-nums">
                          Cost {formatCurrency(defaultVariant.costPrice)} · Margin{' '}
                          <span className={defaultVariant.marginAmount < 0 ? 'font-bold text-destructive' : 'font-semibold text-foreground'}>
                            {formatCurrency(defaultVariant.marginAmount)} ({defaultVariant.marginPct.toFixed(1)}%)
                          </span>
                        </span>
                      )}
                    </div>

                    {canManageStock && renderActions(product, defaultVariant, isVariantRow)}
                  </div>
                );
              })}
            </div>

            {/* Full table once the panel is genuinely wide enough */}
            <div className={tableClass}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>SKU / Barcode</TableHead>
                    <TableHead>Selling</TableHead>
                    {canViewMargin && <TableHead>Cost</TableHead>}
                    {canViewMargin && <TableHead>Margin</TableHead>}
                    {canViewMargin && <TableHead>Margin %</TableHead>}
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
                              <p className="font-bold truncate flex items-center gap-2">
                                <span className="truncate">
                                  {product.name}
                                  {isVariantRow ? ` / ${defaultVariant?.name || 'Variant'}` : ''}
                                </span>
                                {product.isDraft && (
                                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                                    Draft
                                  </span>
                                )}
                              </p>
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
                            <div className="space-y-1">
                              <p className="font-mono text-xs">{defaultVariant.sku || '—'}</p>
                              <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                                <Barcode className="h-3 w-3" />
                                {defaultVariant.barcode || 'No barcode'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {defaultVariant ? formatCurrency(defaultVariant.sellingPrice) : '—'}
                        </TableCell>
                        {canViewMargin && (
                          <TableCell className="tabular-nums">
                            {defaultVariant ? formatCurrency(defaultVariant.costPrice) : '—'}
                          </TableCell>
                        )}
                        {canViewMargin && (
                          <TableCell className="tabular-nums">
                            {defaultVariant ? (
                              <span className={defaultVariant.marginAmount < 0 ? 'font-bold text-destructive' : 'font-semibold'}>
                                {formatCurrency(defaultVariant.marginAmount)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                        )}
                        {canViewMargin && (
                          <TableCell className="tabular-nums">
                            {defaultVariant ? (
                              <span className={defaultVariant.marginAmount < 0 ? 'font-bold text-destructive' : 'font-semibold'}>
                                {defaultVariant.marginPct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <p className="font-semibold tabular-nums flex items-center gap-1">
                            <Boxes className="h-4 w-4 text-primary" />
                            {Number(defaultVariant?.inventory?.onHand ?? product.inventoryTotal ?? 0)}
                          </p>
                        </TableCell>
                        {canManageStock && (
                          <TableCell>
                            <div className="flex justify-end">
                              {renderActions(product, defaultVariant, isVariantRow)}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
