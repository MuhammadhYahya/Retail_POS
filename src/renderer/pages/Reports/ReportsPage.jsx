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

function todayColombo() {
  const shifted = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [date, setDate] = useState(() => todayColombo());
  const [summary, setSummary] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [salesByDay, setSalesByDay] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [voidingId, setVoidingId] = useState(null);

  const load = async (selectedDate = date) => {
    setLoading(true);
    setError('');
    const fromDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000 + (5 * 60 + 30) * 60 * 1000);
    const from = fromDate.toISOString().slice(0, 10);

    const [daily, top, byDay, sales] = await Promise.all([
      invokeWithAuth('report:dailySummary', { date: selectedDate }),
      invokeWithAuth('report:topProducts', { days: 7, limit: 10 }),
      invokeWithAuth('report:salesByDay', { from, to: selectedDate }),
      invokeWithAuth('report:recentSales', { date: selectedDate, limit: 100 }),
    ]);

    setLoading(false);

    if (!daily.success) {
      setError(daily.error || 'Failed to load reports.');
      return;
    }

    setSummary(daily.data);
    setTopProducts(top.success ? top.data : []);
    setSalesByDay(byDay.success ? byDay.data : []);
    setRecentSales(sales.success ? sales.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const handleVoid = async (sale) => {
    if (sale.status === 'voided') return;
    const reason = window.prompt(`Void invoice ${sale.invoiceNumber}. Reason:`);
    if (!reason || !reason.trim()) return;
    setVoidingId(sale.id);
    setMessage('');
    setError('');
    const response = await invokeWithAuth('sale:void', { saleId: sale.id, reason: reason.trim() });
    setVoidingId(null);
    if (!response.success) {
      setError(response.error || 'Void failed.');
      return;
    }
    setMessage(`Voided ${sale.invoiceNumber}.`);
    load(date);
  };

  return (
    <AppShell title="Sales Reports" description="Daily summary, margins, voids, and who made each sale.">
      <div className="space-y-6">
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

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="report-date">
              Date (Asia/Colombo)
            </label>
            <input
              id="report-date"
              type="date"
              className={inputClassName}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => load(date)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Revenue (after discount)</CardDescription>
              <CardTitle>{formatMoney(summary?.revenue)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Original (before discount)</CardDescription>
              <CardTitle>{formatMoney(summary?.originalRevenue)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Profit after discount</CardDescription>
              <CardTitle>{formatMoney(summary?.discountedProfit)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Margin</CardDescription>
              <CardTitle>{Number(summary?.marginPct || 0).toFixed(1)}%</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Items sold</CardDescription>
              <CardTitle>{summary?.itemsSold ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Cash sales</CardDescription>
              <CardTitle>{formatMoney(summary?.cashTotal)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>VAT collected</CardDescription>
              <CardTitle>{formatMoney(summary?.vatTotal)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Discounts given</CardDescription>
              <CardTitle>{formatMoney(summary?.discountTotal)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sales log — {date}</CardTitle>
            <CardDescription>Void mistaken sales (manager/admin). Stock is restored.</CardDescription>
          </CardHeader>
          <CardContent>
            {!recentSales.length ? (
              <p className="text-sm text-muted-foreground">No sales for this date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Sold by</th>
                      <th className="px-3 py-2">Original</th>
                      <th className="px-3 py-2">Discount</th>
                      <th className="px-3 py-2">Paid</th>
                      <th className="px-3 py-2">Profit</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map((sale) => (
                      <tr key={sale.id} className="border-b border-border/50">
                        <td className="px-3 py-3 font-mono font-semibold">{sale.invoiceNumber}</td>
                        <td className="px-3 py-3">
                          {new Date(sale.saleDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-3 font-semibold">{sale.cashierName}</td>
                        <td className="px-3 py-3">{formatMoney(sale.subtotal)}</td>
                        <td className="px-3 py-3">{formatMoney(sale.discountTotal)}</td>
                        <td className="px-3 py-3 font-semibold">{formatMoney(sale.total)}</td>
                        <td className="px-3 py-3">{formatMoney(sale.discountedProfit)}</td>
                        <td className="px-3 py-3 capitalize">{sale.status}</td>
                        <td className="px-3 py-3">
                          {sale.status === 'completed' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={voidingId === sale.id}
                              onClick={() => handleVoid(sale)}
                            >
                              {voidingId === sale.id ? 'Voiding...' : 'Void'}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Last 7 days</CardTitle>
              <CardDescription>Completed sales by day</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!salesByDay.length && (
                <p className="text-sm text-muted-foreground">No sales in this range.</p>
              )}
              {salesByDay.map((row) => (
                <div key={row.date} className="flex justify-between text-sm border-b border-border py-2">
                  <span>{row.date}</span>
                  <span>
                    {row.saleCount} sales · {formatMoney(row.revenue)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top products (7 days)</CardTitle>
              <CardDescription>By quantity sold · includes margin after discount</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!topProducts.length && (
                <p className="text-sm text-muted-foreground">No product sales yet.</p>
              )}
              {topProducts.map((row) => (
                <div key={row.productId} className="flex justify-between text-sm border-b border-border py-2 gap-3">
                  <span>
                    #{row.rank} {row.productName}
                  </span>
                  <span className="text-right whitespace-nowrap">
                    {row.quantity} · {formatMoney(row.revenue)}
                    <span className="text-muted-foreground"> · {row.marginPct}% margin</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {summary && (
          <Card>
            <CardHeader>
              <CardTitle>Day detail — {summary.date}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3 text-sm">
              <p>Sales: {summary.saleCount}</p>
              <p>Voids: {summary.voidCount}</p>
              <p>Card: {formatMoney(summary.cardTotal)}</p>
              <p>QR: {formatMoney(summary.qrTotal)}</p>
              <p>Cost of goods: {formatMoney(summary.costTotal)}</p>
              <p>Profit before discount: {formatMoney(summary.originalProfit)}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
