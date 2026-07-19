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

export default function ReportsPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [salesByDay, setSalesByDay] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (selectedDate = date) => {
    setLoading(true);
    setError('');
    const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [daily, top, byDay] = await Promise.all([
      invokeWithAuth('report:dailySummary', { date: selectedDate }),
      invokeWithAuth('report:topProducts', { days: 7, limit: 10 }),
      invokeWithAuth('report:salesByDay', { from, to: selectedDate }),
    ]);

    setLoading(false);

    if (!daily.success) {
      setError(daily.error || 'Failed to load reports.');
      return;
    }

    setSummary(daily.data);
    setTopProducts(top.success ? top.data : []);
    setSalesByDay(byDay.success ? byDay.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell title="Sales Reports" description="Daily summary and top products.">
      <div className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="report-date">
              Date
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
              <CardDescription>Today revenue</CardDescription>
              <CardTitle>{formatMoney(summary?.revenue)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Items sold</CardDescription>
              <CardTitle>{summary?.itemsSold ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Cash in hand</CardDescription>
              <CardTitle>{formatMoney(summary?.cashTotal)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>VAT collected</CardDescription>
              <CardTitle>{formatMoney(summary?.vatTotal)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

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
              <CardDescription>By quantity sold</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!topProducts.length && (
                <p className="text-sm text-muted-foreground">No product sales yet.</p>
              )}
              {topProducts.map((row) => (
                <div key={row.productId} className="flex justify-between text-sm border-b border-border py-2">
                  <span>
                    #{row.rank} {row.productName}
                  </span>
                  <span>
                    {row.quantity} · {formatMoney(row.revenue)}
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
              <p>Discounts: {formatMoney(summary.discountTotal)}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
