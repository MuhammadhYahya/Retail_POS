import React from 'react';
import {
  ImagePlus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { cn } from '../../../lib/utils';
import { CUSTOM_UNIT_VALUE, PRODUCT_UNITS } from '../../../lib/productUnits';
import {
  CLOTHING_SIZES,
  countAttributeSets,
  NUMERIC_SIZES,
  PRODUCT_COLORS,
  VARIANT_AXIS_TYPES,
  VARIANT_BUILD_MODES,
} from '../../../lib/productVariantOptions';
import { cleanText, inputClassName } from './productFormUtils';

export function ProductEditorDialog({
  productDialogOpen,
  setProductDialogOpen,
  setDialogError,
  form,
  setForm,
  dialogError,
  success,
  productSoftWarnings,
  handleSaveProduct,
  updateForm,
  categories,
  imageInputRef,
  handleImageFiles,
  removeImage,
  startSingleMode,
  startMatrixMode,
  updateSingleVariant,
  switchAxisType,
  addSimpleValue,
  removeSimpleValue,
  addSimpleSizeRange,
  addVariantGroup,
  switchBuildMode,
  removeVariantGroup,
  addSizeToActiveGroup,
  addSizeRangeToActiveGroup,
  addColorToActiveGroup,
  addCustomColorToActiveGroup,
  removeValueFromGroup,
  buildVariants,
  builderConfig,
  addVariantRow,
  updateVariantRow,
  removeVariantRow,
  notifySuccess,
  saving,
  products,
  requestDeleteProduct,
}) {
  return (
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

              {!dialogError && success && (
                <Alert>
                  <AlertDescription>{success}</AlertDescription>
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
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={
                                    form.pricingMode === 'different'
                                    || (!cleanText(form.quickSellingPrice) && !cleanText(form.quickCostPrice))
                                  }
                                  onClick={() => {
                                    const count = form.variantRows.length;
                                    setForm((prev) => ({
                                      ...prev,
                                      variantRows: prev.variantRows.map((row) => ({
                                        ...row,
                                        sellingPrice: prev.quickSellingPrice,
                                        costPrice: prev.quickCostPrice,
                                      })),
                                    }));
                                    setDialogError('');
                                    notifySuccess(`Prices applied to ${count} variant${count === 1 ? '' : 's'}.`);
                                  }}
                                >
                                  Apply Prices to All
                                </Button>
                              </div>
                              {form.pricingMode !== 'different' && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  All variants use the shared selling and cost prices above; they also appear on each row.
                                </p>
                              )}
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
                                    <th className="p-3 text-left">Selling</th>
                                    <th className="p-3 text-left">Cost</th>
                                    <th className="p-3 text-left">Stock</th>
                                    <th className="p-3 text-left">Low Stock</th>
                                    <th className="p-3 text-left">Barcode</th>
                                    <th className="sticky right-0 z-10 bg-muted/40 p-3 text-left shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {form.variantRows.map((variant, index) => {
                                    const singlePricing = form.pricingMode !== 'different';
                                    const sellingValue = singlePricing
                                      ? (form.quickSellingPrice || '')
                                      : variant.sellingPrice;
                                    const costValue = singlePricing
                                      ? (form.quickCostPrice || '')
                                      : variant.costPrice;
                                    return (
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
                                      <td className="p-2">
                                        <input
                                          className={cn(
                                            'w-24 rounded-lg border border-border bg-input p-2',
                                            singlePricing && 'cursor-not-allowed opacity-80'
                                          )}
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          value={sellingValue}
                                          disabled={singlePricing}
                                          readOnly={singlePricing}
                                          onChange={(e) => updateVariantRow(index, 'sellingPrice', e.target.value)}
                                        />
                                      </td>
                                      <td className="p-2">
                                        <input
                                          className={cn(
                                            'w-24 rounded-lg border border-border bg-input p-2',
                                            singlePricing && 'cursor-not-allowed opacity-80'
                                          )}
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={costValue}
                                          disabled={singlePricing}
                                          readOnly={singlePricing}
                                          onChange={(e) => updateVariantRow(index, 'costPrice', e.target.value)}
                                          data-focus="variant-cost"
                                        />
                                      </td>
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
                                    );
                                  })}
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
  );
}

