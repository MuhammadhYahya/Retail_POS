import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

export default function PurchasesPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [sRes, pRes] = await Promise.all([
      invokeWithAuth('supplier:list'),
      invokeWithAuth('purchase:list', { limit: 30 }),
    ]);
    if (sRes.success) setSuppliers(sRes.data || []);
    if (pRes.success) setReceipts(pRes.data || []);
  };

  useEffect(() => {
    refresh();
  }, []);

  const addSupplier = async () => {
    if (!supplierName.trim()) return;
    setError('');
    const response = await invokeWithAuth('supplier:create', { name: supplierName.trim() });
    if (!response.success) {
      setError(response.error || 'Could not create supplier.');
      return;
    }
    setSupplierName('');
    setSupplierId(response.data.id);
    refresh();
  };

  const addByBarcode = async () => {
    const code = barcode.trim();
    if (!code) return;
    setError('');
    const response = await invokeWithAuth('product:lookupBarcode', { barcode: code });
    if (!response.success || !response.data) {
      setError(response.error || 'Barcode not found.');
      return;
    }
    const variant = response.data;
    const variantId = variant.id || variant.variantId;
    setLines((prev) => {
      const existing = prev.find((line) => line.variantId === variantId);
      if (existing) {
        return prev.map((line) =>
          line.variantId === variantId
            ? { ...line, quantity: Number(line.quantity) + 1 }
            : line
        );
      }
      return [
        ...prev,
        {
          variantId,
          label: `${variant.product?.name || variant.productName || 'Item'}${variant.name ? ` · ${variant.name}` : ''}`,
          barcode: variant.barcode,
          quantity: 1,
          unitCost: variant.costPrice ?? variant.cost_price ?? 0,
        },
      ];
    });
    setBarcode('');
  };

  const createAndPost = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const createRes = await invokeWithAuth('purchase:create', {
      supplierId: supplierId || null,
      notes: notes || null,
      items: lines.map((line) => ({
        variantId: line.variantId,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
      })),
    });
    if (!createRes.success) {
      setBusy(false);
      setError(createRes.error || 'Could not create GRN.');
      return;
    }
    const postRes = await invokeWithAuth('purchase:post', { receiptId: createRes.data.id });
    setBusy(false);
    if (!postRes.success) {
      setError(postRes.error || 'GRN created but post failed.');
      refresh();
      return;
    }
    setMessage(`Posted ${postRes.data.grnNumber}. Stock updated.`);
    setLines([]);
    setNotes('');
    refresh();
  };

  return (
    <AppShell title="Purchases / GRN" description="Receive supplier stock into inventory.">
      <div className="space-y-6 max-w-5xl">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>New GRN</CardTitle>
              <CardDescription>Scan barcodes, set cost, then post to stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  className={inputClassName}
                  placeholder="New supplier name"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={addSupplier}>
                  Add
                </Button>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Supplier</label>
                <select
                  className={inputClassName}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">— Optional —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  className={inputClassName}
                  placeholder="Scan barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addByBarcode())}
                />
                <Button type="button" onClick={addByBarcode}>
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {!lines.length && <p className="text-sm text-muted-foreground">No lines yet.</p>}
                {lines.map((line) => (
                  <div key={line.variantId} className="grid grid-cols-12 gap-2 items-center text-sm">
                    <div className="col-span-5 font-semibold truncate">{line.label}</div>
                    <input
                      className={`${inputClassName} col-span-2 !p-2`}
                      type="number"
                      min="0.001"
                      step="1"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.variantId === line.variantId ? { ...l, quantity: e.target.value } : l
                          )
                        )
                      }
                    />
                    <input
                      className={`${inputClassName} col-span-3 !p-2`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.variantId === line.variantId ? { ...l, unitCost: e.target.value } : l
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="col-span-2"
                      onClick={() => setLines((prev) => prev.filter((l) => l.variantId !== line.variantId))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <input
                className={inputClassName}
                placeholder="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button type="button" disabled={busy || !lines.length} onClick={createAndPost}>
                {busy ? 'Posting...' : 'Create & post GRN'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent GRNs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!receipts.length && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
              {receipts.map((r) => (
                <div key={r.id} className="border-b border-border py-2 text-sm">
                  <div className="font-semibold font-mono">{r.grnNumber}</div>
                  <div className="text-muted-foreground">
                    {r.supplierName || 'No supplier'} · {r.status} · {formatMoney(r.totalCost)} ·{' '}
                    {r.items?.length || 0} lines
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
