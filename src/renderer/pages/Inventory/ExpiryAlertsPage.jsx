import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function statusLabel(status) {
  if (status === 'removed') return 'Removed from sale';
  if (status === 'discounted') return 'Discounted';
  return 'Active';
}

function statusTone(status) {
  if (status === 'removed') return 'text-muted-foreground';
  if (status === 'discounted') return 'text-amber-600';
  return 'text-emerald-600';
}

export default function ExpiryAlertsPage() {
  const [data, setData] = useState({ items: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await invokeWithAuth('purchase:expiryAlerts', { limit: 300 });
      if (response.success) setData(response.data || { items: [], summary: {} });
      else setError(response.error || 'Failed to load expiry alerts.');
    } catch (err) {
      setError(err.message || 'Failed to load expiry alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateStatus = async (item, saleStatus) => {
    setBusyId(item.id);
    setError('');
    try {
      const response = await invokeWithAuth('purchase:updateReceiptItemStatus', {
        receiptItemId: item.id,
        saleStatus,
      });
      if (!response.success) {
        setError(response.error || 'Could not update item status.');
      } else {
        await load();
      }
    } catch (err) {
      setError(err.message || 'Could not update item status.');
    } finally {
      setBusyId('');
    }
  };

  const summaryCards = [
    { label: 'Expired', value: data.summary?.expired || 0, tone: 'text-destructive' },
    { label: '7 days', value: data.summary?.sevenDays || 0, tone: 'text-destructive' },
    { label: '15 days', value: data.summary?.fifteenDays || 0, tone: 'text-amber-600' },
    { label: '30 days', value: data.summary?.thirtyDays || 0, tone: 'text-sky-600' },
  ];

  return (
    <AppShell title="Expiry Alerts" description="Monitor soon-to-expire stock. WAC stays unchanged; this screen only manages visibility.">
      <div className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {summaryCards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${card.tone}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading expiry alerts...</p>
          ) : data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipt items have expiry dates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">GRN</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Expiry</th>
                    <th className="px-3 py-2">Days Left</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <p className="font-semibold">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.variantName || 'Variant'}{item.sku ? ` - ${item.sku}` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatMoney(item.lineTotal)} - on hand {Number(item.onHand || 0)}</p>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{item.grnNumber}</td>
                      <td className="px-3 py-3">{item.batchNumber || '-'}</td>
                      <td className="px-3 py-3">{item.expiryDate || '-'}</td>
                      <td className="px-3 py-3">
                        <span className={item.daysRemaining < 0 ? 'font-semibold text-destructive' : item.daysRemaining <= 7 ? 'font-semibold text-amber-600' : 'text-foreground'}>
                          {item.daysRemaining == null ? '-' : item.daysRemaining < 0 ? `Expired ${Math.abs(item.daysRemaining)}d ago` : `${item.daysRemaining}d`}
                        </span>
                      </td>
                      <td className="px-3 py-3">{Number(item.quantity || 0)}</td>
                      <td className={`px-3 py-3 font-semibold ${statusTone(item.saleStatus)}`}>{statusLabel(item.saleStatus)}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === item.id || item.saleStatus === 'discounted'}
                            onClick={() => updateStatus(item, 'discounted')}
                          >
                            Mark Discounted
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === item.id || item.saleStatus === 'removed'}
                            onClick={() => updateStatus(item, 'removed')}
                          >
                            Remove from Sale
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === item.id || item.saleStatus === 'active'}
                            onClick={() => updateStatus(item, 'active')}
                          >
                            Restore
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
