import React from 'react';
import {
  ArrowDownUp,
  Barcode,
  Boxes,
  CalendarRange,
  ChevronRight,
  CircleDollarSign,
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
  calculateMargin,
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
  return (
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <select
            className={cn(inputClassName, 'w-auto')}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All products</option>
            <option value="published">Published only</option>
            <option value="draft">Drafts only</option>
          </select>
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
                  {canViewMargin && <TableHead>Cost Price</TableHead>}
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
                            <p className="font-medium truncate flex items-center gap-2">
                              <span className="truncate">{product.name}{isVariantRow ? ` / ${defaultVariant?.name || 'Variant'}` : ''}</span>
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
                      {canViewMargin && (
                        <TableCell>
                          {defaultVariant ? formatCurrency(defaultVariant.costPrice) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                      )}
                      {canViewMargin && (
                        <TableCell>
                          {defaultVariant ? (
                            <span className={defaultVariant.marginAmount < 0 ? 'font-semibold text-destructive' : 'font-medium'}>
                              {formatCurrency(defaultVariant.marginAmount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      )}
                      {canViewMargin && (
                        <TableCell>
                          {defaultVariant ? (
                            <span className={defaultVariant.marginAmount < 0 ? 'font-semibold text-destructive' : 'font-medium'}>
                              {defaultVariant.marginPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      )}
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
  );
}
