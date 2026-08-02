import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';
import {
  printReturnReceiptWithRecovery,
  REPRINT_WHEN_READY_MESSAGE,
} from '../../lib/printRecovery';

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
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [failedPrintReturnId, setFailedPrintReturnId] = useState(null);

  const refreshRecent = async () => {
    const response = await invokeWithAuth('return:list', { limit: 30 });
    if (response.success) setRecent(response.data || []);
  };

  useEffect(() => {
    refreshRecent();
    invokeWithAuth('settings:get').then((response) => {
      if (response.success) setSettings(response.data);
    });
  }, []);

  async function resolveShopSettings() {
    if (settings) return settings;
    const settingsRes = await invokeWithAuth('settings:get');
    if (settingsRes.success && settingsRes.data) {
      setSettings(settingsRes.data);
      return settingsRes.data;
    }
    return {};
  }

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
    if (!response.success) {
      setBusy(false);
      setError(response.error || 'Return failed.');
      return;
    }

    const returnRecord = response.data;
    setLookup(null);
    setInvoice('');
    setReason('');
    refreshRecent();

    try {
      const shop = await resolveShopSettings();
      // Must go through printReturnReceiptWithRecovery — never call printer IPC directly.
      const printResult = await printReturnReceiptWithRecovery({
        returnId: returnRecord.id,
        returnRecord,
        shopSettings: shop,
        openDrawer: returnRecord.refundMethod === 'cash',
        reprinted: false,
      });
      setFailedPrintReturnId(printResult.printFailed ? returnRecord.id : null);
      setMessage(
        `Return ${returnRecord.returnNumber} · refund ${formatMoney(returnRecord.refundTotal)}. ${printResult.message}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReprint = async (returnId) => {
    if (printingId || busy) return;
    setError('');
    setMessage('');
    setPrintingId(returnId);

    try {
      const getRes = await invokeWithAuth('return:get', { returnId });
      if (!getRes.success) {
        setError(getRes.error || 'Could not load return for reprint.');
        return;
      }

      const shop = await resolveShopSettings();
      // Reprint: never open cash drawer
      const printResult = await printReturnReceiptWithRecovery({
        returnId,
        returnRecord: getRes.data,
        shopSettings: shop,
        openDrawer: false,
        reprinted: true,
      });
      setFailedPrintReturnId(printResult.printFailed ? returnId : null);
      setMessage(
        printResult.ok
          ? `Return ${getRes.data.returnNumber} reprinted.`
          : printResult.message
      );
    } finally {
      setPrintingId(null);
    }
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
          <Alert variant={failedPrintReturnId ? 'destructive' : 'default'}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {failedPrintReturnId && (
          <Alert>
            <AlertDescription>
              {REPRINT_WHEN_READY_MESSAGE} Use <strong>Print Again</strong> on the return below — cash drawer will not open.
            </AlertDescription>
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
              <div key={row.id} className="flex items-center justify-between gap-3 text-sm border-b border-border py-2">
                <span className="font-mono font-semibold">
                  {row.returnNumber} · {row.invoiceNumber}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span>
                    {formatMoney(row.refundTotal)} · {row.refundMethod}
                  </span>
                  <Button
                    type="button"
                    variant={failedPrintReturnId === row.id ? 'default' : 'outline'}
                    size="sm"
                    disabled={busy || printingId === row.id}
                    onClick={() => handleReprint(row.id)}
                    className={
                      failedPrintReturnId === row.id
                        ? 'border border-amber-500 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25'
                        : undefined
                    }
                  >
                    {printingId === row.id ? 'Printing…' : 'Print Again'}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
