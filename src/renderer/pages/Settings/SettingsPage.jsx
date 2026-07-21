import React, { useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { invokeWithAuth } from '../../lib/ipc';

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
  paperWidth: 80,
};

export default function SettingsPage() {
  const [form, setForm] = useState(emptyForm);
  const [backups, setBackups] = useState([]);
  const [drives, setDrives] = useState([]);
  const [usbPath, setUsbPath] = useState('');
  const [message, setMessage] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError('');
    const [settingsRes, backupRes, driveRes] = await Promise.all([
      invokeWithAuth('settings:get'),
      invokeWithAuth('backup:list'),
      invokeWithAuth('backup:listDrives'),
    ]);

    if (!settingsRes.success) {
      setError(settingsRes.error || 'Failed to load settings.');
      return;
    }

    setForm({ ...emptyForm, ...settingsRes.data });
    setBackups(backupRes.success ? backupRes.data : []);
    setDrives(driveRes.success ? driveRes.data : []);
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

  const handleBackup = async () => {
    setError('');
    setMessage('');
    const response = await invokeWithAuth('backup:create', {
      usbPath: usbPath || undefined,
    });
    if (!response.success) {
      setError(response.error || 'Backup failed.');
      return;
    }
    setMessage(`Backup created: ${response.data.fileName}`);
    load();
  };

  const handleRestore = async (backupPath) => {
    if (!window.confirm('Restore this backup? The app should be restarted afterward.')) return;
    setError('');
    setMessage('');
    const response = await invokeWithAuth('backup:restore', { backupPath });
    if (!response.success) {
      setError(response.error || 'Restore failed.');
      return;
    }
    setMessage(response.data.message || 'Restore complete. Restart the app.');
  };

  return (
    <AppShell title="Settings" description="Shop info, tax, and backups.">
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
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Receipt footer</label>
                <input
                  className={inputClassName}
                  value={form.receiptFooter}
                  onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                  placeholder="Thank you for shopping"
                />
              </div>
              <div className="relative inline-flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save settings'}
                </Button>
                {settingsSaved && <span role="status" className="absolute left-0 top-full mt-2 whitespace-nowrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 shadow-sm">Settings saved.</span>}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backup</CardTitle>
            <CardDescription>Copy the local database to AppData and optionally a USB drive.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">USB / drive path (optional)</label>
              <select
                className={inputClassName}
                value={usbPath}
                onChange={(e) => setUsbPath(e.target.value)}
              >
                <option value="">AppData only</option>
                {drives.map((drive) => (
                  <option key={drive.letter} value={drive.path}>
                    {drive.letter}: ({drive.path})
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" onClick={handleBackup}>
              Backup now
            </Button>

            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium">Local backups</p>
              {!backups.length && (
                <p className="text-sm text-muted-foreground">No backups yet.</p>
              )}
              {backups.map((backup) => (
                <div
                  key={backup.path}
                  className="flex items-center justify-between gap-3 border border-border rounded-lg p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{backup.fileName}</p>
                    <p className="text-muted-foreground text-xs">{backup.modifiedAt}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleRestore(backup.path)}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
