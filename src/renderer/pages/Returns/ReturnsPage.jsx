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

export default function ReturnsPage() {
  const [invoice, setInvoice] = useState('');
  const [lookup, setLookup] = useState(null);
  const [qtyMap, setQtyMap] = useState({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshRecent = async () => {
    const response = await invokeWithAuth('return:list', { limit: 30 });
    if (response.success) setRecent(response.data || []);
  };

  useEffect(() => {
    refreshRecent();
  }, []);

  const handleLookup = async () => {
    setError('');
    setMessage('');
    setLookup(null);
    const response = await invokeWithAuth('return:lookupSale', { invoiceNumber: invoice.trim() });
    if (!response.success) {
      setError(response.error || 'Invoice not found.');
      return;
    }
    setLookup(response.data);
    const next = {};
    for (const item of response.data.items || []) {
      next[item.saleItemId] = item.remainingQty;
    }
    setQtyMap(next);
  };

  const submitReturn = async () => {
    if (!lookup) return;
    const items = (lookup.items || [])
      .map((item) => ({
        saleItemId: item.saleItemId,
        quantity: Number(qtyMap[item.saleItemId] || 0),
      }))
      .filter((item) => item.quantity > 0);

    setBusy(true);
    setError('');
    setMessage('');
    const response = await invokeWithAuth('return:create', {
      saleId: lookup.saleId,
      items,
      reason,
      refundMethod,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error || 'Return failed.');
      return;
    }
    setMessage(`Return ${response.data.returnNumber} · refund ${formatMoney(response.data.refundTotal)}.`);
    setLookup(null);
    setInvoice('');
    refreshRecent();
  };

  return (
    <AppShell title="Returns / Refunds" description="Partial or full returns against an invoice. Restores stock.">
      <div className="space-y-6 max-w-4xl">
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

        <Card>
          <CardHeader>
            <CardTitle>Find invoice</CardTitle>
            <CardDescription>Manager/admin only. Requires an open cash day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <input
                className={inputClassName}
                placeholder="Invoice number"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleLookup())}
              />
              <Button type="button" onClick={handleLookup}>
                Lookup
              </Button>
            </div>

            {lookup && (
              <div className="space-y-3">
                <p className="text-sm font-semibold">
                  {lookup.invoiceNumber} · original {formatMoney(lookup.total)}
                </p>
                {!lookup.items?.length && (
                  <p className="text-sm text-muted-foreground">Nothing left to return on this invoice.</p>
                )}
                {lookup.items?.map((item) => (
                  <div key={item.saleItemId} className="grid grid-cols-12 gap-2 items-center text-sm">
                    <div className="col-span-6">
                      {item.productName}
                      <div className="text-xs text-muted-foreground">
                        Sold {item.soldQty} · already returned {item.returnedQty} · left {item.remainingQty}
                      </div>
                    </div>
                    <input
                      className={`${inputClassName} col-span-3 !p-2`}
                      type="number"
                      min="0"
                      max={item.remainingQty}
                      step="1"
                      value={qtyMap[item.saleItemId] ?? 0}
                      onChange={(e) =>
                        setQtyMap((prev) => ({ ...prev, [item.saleItemId]: e.target.value }))
                      }
                    />
                    <div className="col-span-3 text-right">{formatMoney(item.lineTotal)}</div>
                  </div>
                ))}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-2">Refund method</label>
                    <select
                      className={inputClassName}
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value)}
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="qr">QR</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Reason</label>
                    <input
                      className={inputClassName}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="button" disabled={busy} onClick={submitReturn}>
                  {busy ? 'Processing...' : 'Process return'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent returns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!recent.length && <p className="text-sm text-muted-foreground">No returns yet.</p>}
            {recent.map((row) => (
              <div key={row.id} className="flex justify-between text-sm border-b border-border py-2">
                <span className="font-mono font-semibold">
                  {row.returnNumber} · {row.invoiceNumber}
                </span>
                <span>
                  {formatMoney(row.refundTotal)} · {row.refundMethod}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
