import React, { useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';
import { buildLabelPrintHtml } from '../../lib/labelHtml';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const qtyInputClassName =
  'w-20 p-2 rounded-lg bg-input border border-border text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function defaultLabelQty(stockQty) {
  return Math.max(1, Number(stockQty) || 0);
}

function clampLabelQty(value) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function printLabels(labels, { widthMm = 38, heightMm = 25 } = {}) {
  const html = buildLabelPrintHtml({
    labels,
    widthMm,
    heightMm,
    autoPrint: true,
  });
  const w = window.open('', '_blank', 'width=480,height=720');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

export default function LabelsPage() {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  /** @type {[Record<string, number>, Function]} selected[variantId] = label qty */
  const [selected, setSelected] = useState({});
  const [error, setError] = useState('');
  const [labelWidthMm, setLabelWidthMm] = useState(38);
  const [labelHeightMm, setLabelHeightMm] = useState(25);

  useEffect(() => {
    (async () => {
      const [productsRes, settingsRes] = await Promise.all([
        invokeWithAuth('product:getAll'),
        invokeWithAuth('settings:get'),
      ]);
      if (!productsRes.success) {
        setError(productsRes.error || 'Failed to load products.');
        return;
      }
      setProducts(productsRes.data || []);
      if (settingsRes.success && settingsRes.data) {
        if (Number.isFinite(Number(settingsRes.data.labelWidthMm))) {
          setLabelWidthMm(Number(settingsRes.data.labelWidthMm));
        }
        if (Number.isFinite(Number(settingsRes.data.labelHeightMm))) {
          setLabelHeightMm(Number(settingsRes.data.labelHeightMm));
        }
      }
    })();
  }, []);

  const variants = useMemo(() => {
    const rows = [];
    for (const product of products) {
      for (const variant of product.variants || []) {
        if (!variant.barcode) continue;
        rows.push({
          key: variant.id,
          productName: product.name,
          variantName: variant.name,
          barcode: variant.barcode,
          price: variant.sellingPrice,
          stockQty: Number(variant.inventory?.onHand) || 0,
        });
      }
    }
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.productName.toLowerCase().includes(q) ||
        (row.variantName || '').toLowerCase().includes(q) ||
        row.barcode.toLowerCase().includes(q)
    );
  }, [products, query]);

  const selectedRows = variants
    .filter((row) => selected[row.key] != null)
    .map((row) => ({
      name: row.variantName ? `${row.productName} (${row.variantName})` : row.productName,
      price: row.price,
      barcode: row.barcode,
      qty: clampLabelQty(selected[row.key]),
    }));

  const selectedProductCount = selectedRows.length;
  const totalLabelCount = selectedRows.reduce((sum, row) => sum + row.qty, 0);

  const labelsToPrint = selectedRows.flatMap((row) =>
    Array.from({ length: row.qty }, () => ({
      name: row.name,
      price: row.price,
      barcode: row.barcode,
    }))
  );

  return (
    <AppShell title="Barcode Labels" description="Select variants and print price labels.">
      <div className="space-y-6 max-w-5xl">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Print labels</CardTitle>
            <CardDescription>
              {selectedProductCount} products · {totalLabelCount} labels · {labelWidthMm}×{labelHeightMm} mm
              (one label per page; name, Rs. price, Code128 barcode). Match Windows XP-365B Preferences to this
              size; print at 100% scale.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <input
                className={`${inputClassName} max-w-md`}
                placeholder="Search name or barcode"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = { ...selected };
                  for (const row of variants) {
                    next[row.key] = defaultLabelQty(row.stockQty);
                  }
                  setSelected(next);
                }}
              >
                Select filtered
              </Button>
              <Button type="button" variant="outline" onClick={() => setSelected({})}>
                Clear
              </Button>
              <Button
                type="button"
                disabled={!totalLabelCount}
                onClick={() =>
                  printLabels(labelsToPrint, {
                    widthMm: labelWidthMm,
                    heightMm: labelHeightMm,
                  })
                }
              >
                Print labels
              </Button>
            </div>

            <div className="max-h-[480px] overflow-y-auto border border-border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2"> </th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((row) => {
                    const isSelected = selected[row.key] != null;
                    return (
                      <tr key={row.key} className="border-b border-border/50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelected((prev) => {
                                const next = { ...prev };
                                if (e.target.checked) {
                                  next[row.key] = defaultLabelQty(row.stockQty);
                                } else {
                                  delete next[row.key];
                                }
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {row.productName}
                          {row.variantName ? ` · ${row.variantName}` : ''}
                        </td>
                        <td className="px-3 py-2 font-mono">{row.barcode}</td>
                        <td className="px-3 py-2">{formatMoney(row.price)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <input
                              type="number"
                              min={1}
                              className={qtyInputClassName}
                              disabled={!isSelected}
                              value={isSelected ? selected[row.key] : ''}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setSelected((prev) => ({
                                  ...prev,
                                  [row.key]: raw === '' ? '' : clampLabelQty(raw),
                                }));
                              }}
                              onBlur={() => {
                                if (!isSelected) return;
                                setSelected((prev) => ({
                                  ...prev,
                                  [row.key]: clampLabelQty(prev[row.key]),
                                }));
                              }}
                            />
                            <span className="text-xs text-muted-foreground">
                              Stock: {row.stockQty}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
