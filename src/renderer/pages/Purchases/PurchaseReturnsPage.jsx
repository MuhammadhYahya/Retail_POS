import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';

const input = 'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export default function PurchaseReturnsPage() {
  const [receipts, setReceipts] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [r, h] = await Promise.all([
      invokeWithAuth('purchaseReturn:listable'),
      invokeWithAuth('purchaseReturn:list', { limit: 30 }),
    ]);
    if (r.success) setReceipts(r.data || []);
    if (h.success) setHistory(h.data || []);
  };
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!selected) return;
    const items = (selected.items || []).map((item) => ({
      receiptItemId: item.id,
      quantity: Number(quantities[item.id] || 0),
    })).filter((item) => item.quantity > 0);
    if (!items.length) { setError('Enter a return quantity.'); return; }
    setBusy(true); setError(''); setMessage('');
    const response = await invokeWithAuth('purchaseReturn:create', { supplierId: selected.supplierId, items, reason, notes });
    setBusy(false);
    if (!response.success) { setError(response.error || 'Could not process purchase return.'); return; }
    setMessage(`Purchase return ${response.data.returnNumber} posted and stock reduced.`);
    setSelected(null); setQuantities({}); setReason(''); setNotes(''); refresh();
  };

  return (
    <AppShell title="Purchase Returns" description="Return received goods to the supplier. Returns are linked to posted GRNs.">
      <div className="space-y-6 max-w-5xl">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
        <Card>
          <CardHeader><CardTitle>Select posted GRN</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <select className={input} value={selected?.id || ''} onChange={(e) => {
              const next = receipts.find((row) => row.id === e.target.value) || null;
              setSelected(next); setQuantities({}); setError('');
            }}>
              <option value="">Choose a GRN</option>
              {receipts.map((row) => <option key={row.id} value={row.id}>{row.grnNumber} · {row.supplierName || 'No supplier'}</option>)}
            </select>
            {selected && <div className="space-y-3">
              {selected.items.map((item) => <div key={item.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                <div className="col-span-6 font-semibold">{item.productName} {item.variantName ? `· ${item.variantName}` : ''}<div className="text-xs text-muted-foreground">Received {item.receivedQuantity} · returned {item.returnedQuantity} · available {item.remainingQuantity} · on hand {item.onHand}</div></div>
                <input className={`${input} col-span-3 !p-2`} type="number" min="0" max={Math.min(item.remainingQuantity, item.onHand)} step="1" value={quantities[item.id] || ''} onChange={(e) => setQuantities((old) => ({ ...old, [item.id]: e.target.value }))} placeholder="Return qty" />
                <div className="col-span-3 text-right">Rs. {Number(item.originalUnitCost || 0).toFixed(2)} cost</div>
              </div>)}
              <div className="grid gap-3 sm:grid-cols-2"><input className={input} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /><input className={input} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <Button disabled={busy} onClick={submit}>{busy ? 'Processing...' : 'Post purchase return'}</Button>
            </div>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Recent purchase returns</CardTitle></CardHeader><CardContent className="space-y-2">
          {!history.length && <p className="text-sm text-muted-foreground">No purchase returns yet.</p>}
          {history.map((row) => <div key={row.id} className="border-b border-border py-2 text-sm"><strong>{row.returnNumber}</strong> · {row.supplierName || 'No supplier'} · {row.items?.map((item) => `${item.productName} × ${item.quantity}`).join(', ')}</div>)}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
