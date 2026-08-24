import React, { useEffect, useState } from 'react';
import { Store, Printer, Percent, HardDrive, FileUp } from 'lucide-react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { invokeWithAuth } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import {
  buildThermalReceiptHtml,
  buildThermalReturnReceiptHtml,
  openReceiptFallbackWindow,
} from '../../lib/receiptHtml';
import BackupRestorePanel from './BackupRestorePanel';
import ImportExportPanel from './ImportExportPanel';
import ShopSettingsPanel from './ShopSettingsPanel';
import PrinterSettingsPanel from './PrinterSettingsPanel';
import PoliciesSettingsPanel from './PoliciesSettingsPanel';

const emptyForm = {
  shopName: '',
  shopAddress: '',
  shopPhone: '',
  currency: 'LKR',
  language: 'en',
  invoicePrefix: 'POS',
  receiptHeader: '',
  receiptFooter: '',
  returnWithinDays: 7,
  printerPort: '',
  paperWidth: 80,
  labelWidthMm: 38,
  labelHeightMm: 25,
  cashierMaxDiscountPct: 10,
  managerMaxDiscountPct: 25,
  staleDayPolicy: 'block',
};

const SETTINGS_SECTIONS = [
  { id: 'shop', label: 'Shop Details', icon: Store },
  { id: 'printer', label: 'Printing', icon: Printer },
  { id: 'policies', label: 'Sales Settings', icon: Percent },
  { id: 'backup', label: 'Backup & Restore', icon: HardDrive },
  { id: 'data', label: 'Import & Export', icon: FileUp },
];

const FORM_SECTIONS = new Set(['shop', 'printer', 'policies']);

function buildTestSale() {
  return {
    invoiceNumber: 'TEST-PRINT',
    saleDate: new Date().toISOString(),
    cashierName: 'Test',
    paymentMethod: 'cash',
    amountTendered: 100,
    changeGiven: 0,
    subtotal: 100,
    discountTotal: 0,
    total: 100,
    items: [
      {
        productName: 'Receipt test item',
        variantName: 'Variant A',
        barcode: '1234567890123',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
    ],
  };
}

function buildTestReturn() {
  return {
    returnNumber: 'RET-TEST-0001',
    invoiceNumber: 'INV-TEST-0001',
    saleDate: new Date().toISOString(),
    processedByName: 'Test',
    refundTotal: 5500,
    refundMethod: 'cash',
    reason: 'Wrong size',
    items: [
      {
        productName: 'Receipt test return item',
        variantName: 'Size 42',
        quantity: 1,
        unitRefund: 5500,
        lineRefund: 5500,
      },
    ],
  };
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('shop');
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
      const fallback = openReceiptFallbackWindow(
        buildThermalReceiptHtml({
          shop: form || {},
          sale: buildTestSale(),
          paperWidth: form.paperWidth || 80,
          autoPrint: false,
        }),
        { title: 'Printer test preview' }
      );
      setError(
        fallback.ok
          ? `${response.error || 'Test print failed.'} Opened receipt preview on screen.`
          : `${response.error || 'Test print failed.'} ${fallback.error || 'Use Print Again.'}`
      );
      return;
    }
    if (response.data?.success) {
      setMessage('Test page sent to the receipt printer.');
      return;
    }
    const fallback = openReceiptFallbackWindow(
        buildThermalReceiptHtml({
          shop: form || {},
          sale: buildTestSale(),
          paperWidth: form.paperWidth || 80,
          autoPrint: false,
        }),
      { title: 'Printer test preview' }
    );
    setError(
      fallback.ok
        ? `${response.data?.error || 'Test print failed.'} Opened receipt preview on screen.`
        : `${response.data?.error || 'Test print failed.'} ${fallback.error || 'Use Print Again.'}`
    );
  };

  const handleTestReturnPrint = async () => {
    setTestingPrint(true);
    setError('');
    setMessage('');
    setSettingsSaved(false);
    const response = await invokeWithAuth('printer:testReturnReceipt');
    setTestingPrint(false);
    if (!response.success) {
      const fallback = openReceiptFallbackWindow(
        buildThermalReturnReceiptHtml({
          shop: form || {},
          returnRecord: buildTestReturn(),
          paperWidth: form.paperWidth || 80,
          autoPrint: false,
        }),
        { title: 'Return receipt test preview' }
      );
      setError(
        fallback.ok
          ? `${response.error || 'Return test print failed.'} Opened receipt preview on screen.`
          : `${response.error || 'Return test print failed.'} ${fallback.error || 'Use Print Again.'}`
      );
      return;
    }
    if (response.data?.success) {
      setMessage('Return receipt test page sent to the receipt printer.');
      return;
    }
    const fallback = openReceiptFallbackWindow(
      buildThermalReturnReceiptHtml({
        shop: form || {},
        returnRecord: buildTestReturn(),
        paperWidth: form.paperWidth || 80,
        autoPrint: false,
      }),
      { title: 'Return receipt test preview' }
    );
    setError(
      fallback.ok
        ? `${response.data?.error || 'Return test print failed.'} Opened receipt preview on screen.`
        : `${response.data?.error || 'Return test print failed.'} ${fallback.error || 'Use Print Again.'}`
    );
  };

  const showSaveBar = FORM_SECTIONS.has(activeSection);

  const panelMessageHandlers = {
    onMessage: (msg) => {
      setError('');
      setMessage(msg);
    },
    onError: (msg) => {
      setMessage('');
      setError(msg);
    },
  };

  return (
    <AppShell
      title="Settings"
      description="Shop details, printing, sales settings, backups, and import/export."
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          className="flex gap-2 overflow-x-auto pb-1 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
          aria-label="Settings sections"
        >
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveSection(id);
                  setSettingsSaved(false);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all cursor-pointer border',
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/20 shadow-sm shadow-primary/5'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground border-transparent bg-card/50 lg:bg-transparent'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', isActive && 'scale-110')} />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 max-w-3xl space-y-6">
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

          {showSaveBar ? (
            <form onSubmit={handleSave} className="space-y-6">
              {activeSection === 'shop' && (
                <ShopSettingsPanel form={form} setForm={setForm} />
              )}
              {activeSection === 'printer' && (
                <PrinterSettingsPanel
                  form={form}
                  setForm={setForm}
                  printers={printers}
                  testingPrint={testingPrint}
                  onTestPrint={handleTestPrint}
                  onTestReturnPrint={handleTestReturnPrint}
                />
              )}
              {activeSection === 'policies' && (
                <PoliciesSettingsPanel form={form} setForm={setForm} />
              )}

              <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <div className="relative inline-flex items-center gap-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save settings'}
                  </Button>
                  {settingsSaved && (
                    <span
                      role="status"
                      className="whitespace-nowrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 shadow-sm"
                    >
                      Settings saved.
                    </span>
                  )}
                </div>
              </div>
            </form>
          ) : null}

          {activeSection === 'backup' && <BackupRestorePanel {...panelMessageHandlers} />}
          {activeSection === 'data' && <ImportExportPanel {...panelMessageHandlers} />}
        </div>
      </div>
    </AppShell>
  );
}
