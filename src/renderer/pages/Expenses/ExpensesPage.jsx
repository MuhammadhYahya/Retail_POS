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

export default function ExpensesPage() {
  const [categories, setCategories] = useState([]);
  const [list, setList] = useState([]);
  const [category, setCategory] = useState('Petty cash');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [cRes, lRes] = await Promise.all([
      invokeWithAuth('expense:categories'),
      invokeWithAuth('expense:list', { limit: 50 }),
    ]);
    if (cRes.success) {
      setCategories(cRes.data || []);
      if (cRes.data?.[0]) setCategory((prev) => prev || cRes.data[0]);
    }
    if (lRes.success) setList(lRes.data || []);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await invokeWithAuth('expense:create', {
      category,
      amount: Number(amount),
      paymentMethod,
      note: note || null,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error || 'Could not save expense.');
      return;
    }
    setMessage(`Expense saved: ${formatMoney(response.data.amount)}.`);
    setAmount('');
    setNote('');
    refresh();
  };

  return (
    <AppShell title="Expenses" description="Petty cash and shop costs for the open day (affects Z expected cash).">
      <div className="space-y-6 max-w-3xl">
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
            <CardTitle>Record expense</CardTitle>
            <CardDescription>Requires an open cash day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  className={inputClassName}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Amount (Rs.)</label>
                <input
                  className={inputClassName}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-2">Paid by</label>
                <select
                  className={inputClassName}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="qr">QR</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Note</label>
                <input className={inputClassName} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <Button type="button" disabled={busy || !amount} onClick={handleCreate}>
              {busy ? 'Saving...' : 'Save expense'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent expenses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!list.length && <p className="text-sm text-muted-foreground">No expenses yet.</p>}
            {list.map((row) => (
              <div key={row.id} className="flex justify-between text-sm border-b border-border py-2">
                <span>
                  {row.category}
                  {row.note ? ` · ${row.note}` : ''}
                </span>
                <span className="font-semibold">
                  {formatMoney(row.amount)} · {row.paymentMethod}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
