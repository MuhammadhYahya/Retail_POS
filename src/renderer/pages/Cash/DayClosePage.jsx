import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';
import { isStaleOpenSession } from '../../lib/colomboTime.js';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function printZReport(z) {
  if (!z) return;
  const html = `<!doctype html><html><head><title>Z-Report</title>
    <style>body{font-family:ui-monospace,monospace;padding:24px;max-width:420px}h1{font-size:18px}table{width:100%;border-collapse:collapse}td{padding:4px 0}.r{text-align:right}.muted{color:#666;font-size:12px}</style>
    </head><body>
    <h1>Z-Report</h1>
    <p class="muted">${z.reportDate || ''} · Session ${String(z.sessionId || '').slice(0, 8)}</p>
    <table>
      <tr><td>Opening float</td><td class="r">${formatMoney(z.openingFloat)}</td></tr>
      <tr><td>Cash sales</td><td class="r">${formatMoney(z.cashSales)}</td></tr>
      <tr><td>Card sales</td><td class="r">${formatMoney(z.cardSales)}</td></tr>
      <tr><td>QR sales</td><td class="r">${formatMoney(z.qrSales)}</td></tr>
      <tr><td>Cash refunds</td><td class="r">-${formatMoney(z.cashRefunds)}</td></tr>
      <tr><td>Cash expenses</td><td class="r">-${formatMoney(z.cashExpenses)}</td></tr>
      <tr><td><strong>Expected cash</strong></td><td class="r"><strong>${formatMoney(z.expectedCash)}</strong></td></tr>
      <tr><td>Counted cash</td><td class="r">${formatMoney(z.countedCash)}</td></tr>
      <tr><td>Variance</td><td class="r">${formatMoney(z.variance)}</td></tr>
      <tr><td>Voids</td><td class="r">${z.voidCount || 0}</td></tr>
      <tr><td>Returns</td><td class="r">${z.returnCount || 0}</td></tr>
    </table>
    <script>window.onload=()=>window.print()</script>
    </body></html>`;
  const w = window.open('', '_blank', 'width=480,height=720');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

export default function DayClosePage() {
  const [openSession, setOpenSession] = useState(null);
  const [xReport, setXReport] = useState(null);
  const [floatAmount, setFloatAmount] = useState('5000');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastZ, setLastZ] = useState(null);
  const [busy, setBusy] = useState(false);
  const staleDay = isStaleOpenSession(openSession);

  const refresh = async () => {
    setError('');
    const openRes = await invokeWithAuth('cashSession:getOpen');
    if (!openRes.success) {
      setError(openRes.error || 'Failed to load session.');
      return;
    }
    setOpenSession(openRes.data);
    if (openRes.data) {
      const xRes = await invokeWithAuth('cashSession:xReport');
      if (xRes.success) {
        setXReport(xRes.data);
        setCountedCash(String(xRes.data.expectedCash ?? ''));
      }
    } else {
      setXReport(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleOpen = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await invokeWithAuth('cashSession:open', {
      openingFloat: Number(floatAmount),
      notes: notes || null,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error || 'Could not open day.');
      return;
    }
    setMessage(`Day opened with float ${formatMoney(response.data.openingFloat)}.`);
    setNotes('');
    refresh();
  };

  const handleClose = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await invokeWithAuth('cashSession:close', {
      countedCash: Number(countedCash),
      notes: notes || null,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error || 'Could not close day.');
      return;
    }
    setLastZ(response.data.zReport);
    setMessage('Day closed. Z-report saved.');
    printZReport(response.data.zReport);
    refresh();
  };

  return (
    <AppShell title="Day Open / Close" description="Opening float, X-report, and locked Z-report.">
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

        {openSession && staleDay && (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100">
            <AlertDescription className="font-semibold">
              Yesterday&apos;s cash day is still open (opened{' '}
              {new Date(openSession.openedAt).toLocaleString()}). Close &amp; print Z for that day,
              then open today&apos;s day with float before selling.
            </AlertDescription>
          </Alert>
        )}

        {!openSession ? (
          <Card>
            <CardHeader>
              <CardTitle>Open day</CardTitle>
              <CardDescription>Count the drawer and enter opening float before sales.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Opening float (Rs.)</label>
                <input
                  className={inputClassName}
                  type="number"
                  min="0"
                  step="0.01"
                  value={floatAmount}
                  onChange={(e) => setFloatAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Notes</label>
                <input className={inputClassName} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button type="button" onClick={handleOpen} disabled={busy}>
                {busy ? 'Opening...' : 'Open cash day'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Day is open</CardTitle>
                <CardDescription>
                  Opened {new Date(openSession.openedAt).toLocaleString()} · Float{' '}
                  {formatMoney(openSession.openingFloat)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
                <p>Cash sales: {formatMoney(xReport?.cashSales)}</p>
                <p>Card sales: {formatMoney(xReport?.cardSales)}</p>
                <p>QR sales: {formatMoney(xReport?.qrSales)}</p>
                <p>Cash refunds: {formatMoney(xReport?.cashRefunds)}</p>
                <p>Cash expenses: {formatMoney(xReport?.cashExpenses)}</p>
                <p className="font-bold">Expected cash: {formatMoney(xReport?.expectedCash)}</p>
                <Button type="button" variant="outline" onClick={refresh}>
                  Refresh X-report
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Close day (Z-report)</CardTitle>
                <CardDescription>
                  {staleDay
                    ? "Count the drawer for the open day, print Z, then open today's day with float."
                    : 'Count the drawer. Variance is counted − expected.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Counted cash (Rs.)</label>
                  <input
                    className={inputClassName}
                    type="number"
                    min="0"
                    step="0.01"
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Close notes</label>
                  <input className={inputClassName} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="button" onClick={handleClose} disabled={busy}>
                  {busy ? 'Closing...' : 'Close day & print Z'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        {lastZ && (
          <Card>
            <CardHeader>
              <CardTitle>Last Z-report</CardTitle>
              <CardDescription>Variance {formatMoney(lastZ.variance)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" onClick={() => printZReport(lastZ)}>
                Print again
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
