import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';

const inputClassName = 'w-full rounded-lg border border-border bg-input p-3 text-foreground';
const money = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

export default function AuditPage() {
  const [tab, setTab] = useState('voids');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [voids, setVoids] = useState([]);
  const [events, setEvents] = useState([]);
  const [failures, setFailures] = useState([]);
  const [summary, setSummary] = useState({ pendingTotal: 0 });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    const [voidResponse, eventResponse, failureResponse, summaryResponse] = await Promise.all([
      invokeWithAuth('audit:listVoidedSales', { query, from, to, minAmount, maxAmount }),
      invokeWithAuth('audit:list', { query, from, to, limit: 200 }),
      invokeWithAuth('audit:listFailures', { status: 'pending' }),
      invokeWithAuth('audit:getFailureSummary'),
    ]);
    setLoading(false);
    if (!voidResponse.success) { setError(voidResponse.error || 'Failed to load audit records.'); return; }
    setVoids(voidResponse.data || []);
    setEvents(eventResponse.success ? eventResponse.data || [] : []);
    setFailures(failureResponse.success ? failureResponse.data || [] : []);
    if (summaryResponse.success) setSummary(summaryResponse.data || { pendingTotal: 0 });
  };

  useEffect(() => { load(); }, []);

  const retry = async () => {
    setError(''); setMessage('');
    const response = await invokeWithAuth('audit:retryFailures');
    if (!response.success) { setError(response.error || 'Audit recovery failed.'); return; }
    setMessage(`Recovered ${response.data?.recovered || 0} audit event(s).`);
    load();
  };

  return (
    <AppShell title="Audit Log" description="Administrator-only review of voids, critical actions, and audit failures.">
      <div className="space-y-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
        {summary.pendingTotal > 0 && <Alert variant="destructive"><AlertDescription>Audit Logging Error: {summary.pendingTotal} event(s) require recovery.</AlertDescription></Alert>}
        <Card>
          <CardHeader><CardTitle>Audit search</CardTitle><CardDescription>Search voided sales and critical audit events. Records cannot be edited or deleted.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-6">
            <input className={inputClassName} placeholder="Invoice, user, reason" value={query} onChange={(e) => setQuery(e.target.value)} />
            <input className={inputClassName} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className={inputClassName} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <input className={inputClassName} type="number" min="0" placeholder="Min amount" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            <input className={inputClassName} type="number" min="0" placeholder="Max amount" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            <Button type="button" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Search'}</Button>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button variant={tab === 'voids' ? 'default' : 'outline'} onClick={() => setTab('voids')}>Voided Sales ({voids.length})</Button>
          <Button variant={tab === 'events' ? 'default' : 'outline'} onClick={() => setTab('events')}>All Events ({events.length})</Button>
          <Button variant={tab === 'failures' ? 'default' : 'outline'} onClick={() => setTab('failures')}>Failures ({failures.length})</Button>
          {summary.pendingTotal > 0 && <Button variant="destructive" onClick={retry}>Retry recovery</Button>}
        </div>
        <Card><CardContent className="overflow-x-auto p-0">
          {tab === 'voids' && <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Invoice</th><th className="p-3">Amount</th><th className="p-3">Cashier</th><th className="p-3">Voided by</th><th className="p-3">When</th><th className="p-3">Reason</th><th className="p-3">Status</th></tr></thead><tbody>{voids.map((row) => <tr key={row.id} className="border-b"><td className="p-3 font-semibold">{row.invoice_number}</td><td className="p-3">{money(row.total)}</td><td className="p-3">{row.cashier_name || '—'}</td><td className="p-3">{row.voided_by_name || row.voided_by_username || '—'}</td><td className="p-3">{row.voided_at || '—'}</td><td className="p-3">{row.void_reason || '—'}</td><td className="p-3">{row.status}</td></tr>)}</tbody></table>}
          {tab === 'events' && <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Action</th><th className="p-3">Reference</th><th className="p-3">User</th><th className="p-3">Amount</th><th className="p-3">When</th><th className="p-3">Details</th></tr></thead><tbody>{events.map((row) => <tr key={row.id} className="border-b"><td className="p-3">{row.action}</td><td className="p-3">{row.reference_number || row.entity_id || '—'}</td><td className="p-3">{row.display_name || row.username || '—'}</td><td className="p-3">{row.amount == null ? '—' : money(row.amount)}</td><td className="p-3">{row.created_at}</td><td className="max-w-md truncate p-3">{row.details || '—'}</td></tr>)}</tbody></table>}
          {tab === 'failures' && <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Action</th><th className="p-3">Event</th><th className="p-3">Reference</th><th className="p-3">When</th><th className="p-3">Reason</th></tr></thead><tbody>{failures.map((row) => <tr key={row.id} className="border-b"><td className="p-3">{row.action}</td><td className="p-3 font-mono text-xs">{row.event_id}</td><td className="p-3">{row.reference_number || row.entity_id || '—'}</td><td className="p-3">{row.created_at}</td><td className="p-3">{row.failure_reason}</td></tr>)}</tbody></table>}
          {((tab === 'voids' && !voids.length) || (tab === 'events' && !events.length) || (tab === 'failures' && !failures.length)) && <p className="p-8 text-center text-sm text-muted-foreground">No records found.</p>}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
