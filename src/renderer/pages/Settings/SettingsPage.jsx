import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import BackupRestorePanel from './BackupRestorePanel';
import ImportExportPanel from './ImportExportPanel';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const emptyForm = {
  shopName: '',
  shopAddress: '',
  shopPhone: '',
  shopTin: '',
  currency: 'LKR',
  language: 'en',
  vatRate: 18,
  invoicePrefix: 'POS',
  receiptHeader: '',
  receiptFooter: '',
  returnWithinDays: 7,
  printerPort: '',
  paperWidth: 80,
  cashierMaxDiscountPct: 10,
  managerMaxDiscountPct: 25,
};

export default function SettingsPage() {
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [testingPrint, setTestingPrint] = useState(false);

  const load = async () => {
    setError('');
    const [settingsRes, printersRes] = await Promise.all([
      invokeWithAuth('settings:get'),
      invokeWithAuth('printer:list'),
    ]);

    if (!settingsRes.success) {
      setError(settingsRes.error || 'Failed to load settings.');
      return;
    }

    setForm({ ...emptyForm, ...settingsRes.data });
    if (printersRes.success) {
      setPrinters(printersRes.data || []);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    setSettingsSaved(false);
    const response = await invokeWithAuth('settings:update', { settings: form });
    setSaving(false);
    if (!response.success) {
      setError(response.error || 'Failed to save settings.');
      return;
    }
    setForm({ ...emptyForm, ...response.data });
    setSettingsSaved(true);
  };

  const handleTestPrint = async () => {
    setTestingPrint(true);
    setError('');
    setMessage('');
    setSettingsSaved(false);
    const response = await invokeWithAuth('printer:testPrint');
    setTestingPrint(false);
    if (!response.success) {
      setError(response.error || 'Test print failed.');
      return;
    }
    if (response.data?.success) {
      setMessage('Test page sent to the receipt printer.');
      return;
    }
    setError(response.data?.error || 'Test print failed.');
  };

  const handleTestReturnPrint = async () => {
    setTestingPrint(true);
    setError('');
    setMessage('');
    setSettingsSaved(false);
    const response = await invokeWithAuth('printer:testReturnReceipt');
    setTestingPrint(false);
    if (!response.success) {
      setError(response.error || 'Return test print failed.');
      return;
    }
    if (response.data?.success) {
      setMessage('Return receipt test page sent to the receipt printer.');
      return;
    }
    setError(response.data?.error || 'Return test print failed.');
  };

  return (
    <AppShell title="Settings" description="Shop info, tax, backups, and data import/export.">
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
            <CardTitle>Shop info</CardTitle>
            <CardDescription>Shown on receipts and invoices.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Shop name</label>
                  <input
                    className={inputClassName}
                    value={form.shopName}
                    onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <input
                    className={inputClassName}
                    value={form.shopPhone}
                    onChange={(e) => setForm({ ...form, shopPhone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Address</label>
                <input
                  className={inputClassName}
                  value={form.shopAddress}
                  onChange={(e) => setForm({ ...form, shopAddress: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">TIN / VAT number</label>
                  <input
                    className={inputClassName}
                    value={form.shopTin}
                    onChange={(e) => setForm({ ...form, shopTin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Default VAT rate (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName}
                    value={form.vatRate}
                    onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Applied to new products when VAT is marked Applicable on Add Product.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Invoice prefix</label>
                  <input
                    className={inputClassName}
                    value={form.invoicePrefix}
                    onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Currency</label>
                  <input
                    className={inputClassName}
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Language</label>
                  <select
                    className={inputClassName}
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                  >
                    <option value="en">English</option>
                    <option value="si">Sinhala</option>
                    <option value="ta">Tamil</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Receipt header</label>
                  <input
                    className={inputClassName}
                    value={form.receiptHeader}
                    onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })}
                    placeholder="Optional header line"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Receipt footer</label>
                  <input
                    className={inputClassName}
                    value={form.receiptFooter}
                    onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                    placeholder="Thank you for shopping"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Return within (days)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className={inputClassName}
                    value={form.returnWithinDays}
                    onChange={(e) => setForm({ ...form, returnWithinDays: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Returns accepted within {form.returnWithinDays || 7} days.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Receipt printer</label>
                  <select
                    className={inputClassName}
                    value={form.printerPort || ''}
                    onChange={(e) => setForm({ ...form, printerPort: e.target.value })}
                  >
                    <option value="">— Manual print dialog —</option>
                    {printers.map((printer) => (
                      <option key={printer.name} value={printer.name}>
                        {printer.name}{printer.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose <strong>Xprinter XP-80</strong> (paper width 80). Uses ESC/POS raw print.
                    Cash drawer opens automatically on cash sales when wired to the printer (RJ11).
                  </p>
                  <input
                    className={cn(inputClassName, 'mt-2')}
                    value={form.printerPort || ''}
                    onChange={(e) => setForm({ ...form, printerPort: e.target.value })}
                    placeholder="Or type name / COM3"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testingPrint || !form.printerPort}
                      onClick={handleTestPrint}
                    >
                      {testingPrint ? 'Printing test…' : 'Print test page'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testingPrint || !form.printerPort}
                      onClick={handleTestReturnPrint}
                    >
                      Test return receipt
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Paper width (mm)</label>
                  <select
                    className={inputClassName}
                    value={form.paperWidth}
                    onChange={(e) => setForm({ ...form, paperWidth: Number(e.target.value) })}
                  >
                    <option value={80}>80 (XP-80)</option>
                    <option value={58}>58</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold">Discount limits</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Maximum discount staff can apply on an item or whole bill (percent of price). Admins have no limit.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-2">Cashier max discount (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      className={inputClassName}
                      value={form.cashierMaxDiscountPct}
                      onChange={(e) => setForm({ ...form, cashierMaxDiscountPct: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Manager max discount (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      className={inputClassName}
                      value={form.managerMaxDiscountPct}
                      onChange={(e) => setForm({ ...form, managerMaxDiscountPct: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="relative inline-flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save settings'}
                </Button>
                {settingsSaved && (
                  <span
                    role="status"
                    className="absolute left-0 top-full mt-2 whitespace-nowrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 shadow-sm"
                  >
                    Settings saved.
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <BackupRestorePanel
          onMessage={(msg) => {
            setError('');
            setMessage(msg);
          }}
          onError={(msg) => {
            setMessage('');
            setError(msg);
          }}
        />

        <ImportExportPanel
          onMessage={(msg) => {
            setError('');
            setMessage(msg);
          }}
          onError={(msg) => {
            setMessage('');
            setError(msg);
          }}
        />
      </div>
    </AppShell>
  );
}
