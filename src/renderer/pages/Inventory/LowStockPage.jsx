import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { invokeWithAuth, notifyLowStockUpdated } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';

export default function LowStockPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await invokeWithAuth('inventory:getLowStock');
      if (response.success) setItems(response.data || []);
      else setError(response.error || 'Failed to load low stock items.');
    } catch (err) {
      setError(err.message || 'Failed to load low stock items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const fillStock = (item) => {
    const params = new URLSearchParams({
      edit: item.productId,
      variantId: item.variantId || '',
      focus: 'stock',
      step: '2',
    });
    navigate(`/products?${params.toString()}`);
  };

  const disableAlert = async (item) => {
    try {
      const response = await invokeWithAuth('inventory:disableLowStockAlert', { variantId: item.variantId });
      if (!response.success) setError(response.error || 'Failed to disable low stock alert.');
      else {
        notifyLowStockUpdated();
        await load();
      }
    } catch (err) {
      setError(err.message || 'Failed to disable low stock alert.');
    }
  };

  return (
    <AppShell title="Low Stock" description="Products at or below their alert threshold.">
      <div className="space-y-6">
        {!isAdmin && <Alert><AlertDescription>Contact your admin to restock these items.</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {loading ? <p className="text-sm text-muted-foreground">Loading low stock items...</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No low stock items.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2">Product Name</th><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Current Stock</th><th className="px-3 py-2">Alert Threshold</th><th className="px-3 py-2">Status</th>{isAdmin && <th className="px-3 py-2 text-right">Actions</th>}</tr></thead><tbody>
              {items.map((item) => <tr key={item.variantId} className="border-b border-border/50"><td className="px-3 py-3 font-semibold">{item.productName}</td><td className="px-3 py-3">{item.variantName}</td><td className="px-3 py-3 font-bold text-red-600">{item.currentStock}</td><td className="px-3 py-3">{item.alertThreshold}</td><td className="px-3 py-3"><span className="font-semibold text-red-600">{item.status}</span></td>{isAdmin && <td className="flex justify-end gap-2 px-3 py-3"><Button size="sm" onClick={() => fillStock(item)}>Fill Stock</Button><Button size="sm" variant="outline" className="text-amber-600" onClick={() => disableAlert(item)}>Disable alert</Button></td>}</tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
