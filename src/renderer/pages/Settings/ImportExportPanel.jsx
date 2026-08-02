import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { invokeWithAuth, subscribeProgress } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { cn } from '../../lib/utils';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const WIZARD_STEPS = [
  'Select file',
  'Map columns',
  'Options',
  'Preview',
  'Import',
  'Summary',
];

function statusClass(status) {
  if (status === 'valid') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  if (status === 'warning') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  if (status === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-400';
  return 'bg-muted text-muted-foreground';
}

function detectExt(filePath) {
  const ext = String(filePath || '').split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  return 'xlsx';
}

export default function ImportExportPanel({ onMessage, onError }) {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);

  const [entities, setEntities] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);

  // Export state
  const [exportEntity, setExportEntity] = useState('products');
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [exportActiveFilter, setExportActiveFilter] = useState('all');
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportReportType, setExportReportType] = useState('dailySummary');
  const [exportLowStock, setExportLowStock] = useState(false);
  const [exportVatOnly, setExportVatOnly] = useState(false);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [filePath, setFilePath] = useState('');
  const [fileFormat, setFileFormat] = useState('xlsx');
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [duplicateMode, setDuplicateMode] = useState('create');
  const [categoryMode, setCategoryMode] = useState('auto');
  const [supplierMode, setSupplierMode] = useState('auto');
  const [autoGenerateBarcode, setAutoGenerateBarcode] = useState(true);
  const [autoGenerateSku, setAutoGenerateSku] = useState(true);
  const [categoriesToCreate, setCategoriesToCreate] = useState([]);
  const [suppliersToCreate, setSuppliersToCreate] = useState([]);
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const isAdmin = user?.role === 'admin';

  const notify = useCallback((msg) => onMessage?.(msg), [onMessage]);
  const fail = useCallback((msg) => onError?.(msg), [onError]);

  const load = useCallback(async () => {
    const [entitiesRes, historyRes] = await Promise.all([
      invokeWithAuth('export:entities'),
      invokeWithAuth('import:history', { limit: 30 }),
    ]);
    if (entitiesRes.success) {
      setEntities(entitiesRes.data || []);
      const first = (entitiesRes.data || []).find((e) => e.exportable && e.available);
      if (first) setExportEntity(first.id);
    }
    if (historyRes.success) setHistory(historyRes.data || []);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  useEffect(() => {
    const unsub = subscribeProgress('import:progress', (payload) => {
      if (jobId && payload.jobId && payload.jobId !== jobId) return;
      setProgress(payload);
    });
    return unsub;
  }, [jobId]);

  const exportable = useMemo(() => entities.filter((e) => e.exportable), [entities]);
  const selectedEntity = entities.find((e) => e.id === exportEntity);
  const needsDates = ['sales', 'expenses', 'purchases', 'returns', 'stock_adjustments', 'reports'].includes(exportEntity);
  const isReports = exportEntity === 'reports';

  const resetWizard = () => {
    setStep(0);
    setFilePath('');
    setFileFormat('xlsx');
    setAnalysis(null);
    setMapping({});
    setDuplicateMode('create');
    setCategoryMode('auto');
    setSupplierMode('auto');
    setAutoGenerateBarcode(true);
    setAutoGenerateSku(true);
    setCategoriesToCreate([]);
    setSuppliersToCreate([]);
    setPreview(null);
    setImportResult(null);
    setProgress(null);
    setJobId(null);
  };

  const openWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  const downloadTemplate = async () => {
    setBusy(true);
    setProgress(null);
    const save = await invokeWithAuth('dialog:showSave', {
      title: 'Save product import template',
      defaultPath: 'zen-product-import-template.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (!save.success || save.data?.canceled || !save.data?.filePath) {
      setBusy(false);
      return;
    }
    const res = await invokeWithAuth('import:template', { filePath: save.data.filePath });
    setBusy(false);
    if (!res.success) {
      fail(res.error || 'Failed to save template.');
      return;
    }
    notify(`Template saved to ${res.data.path}`);
  };

  const pickImportFile = async () => {
    const open = await invokeWithAuth('dialog:showOpen', {
      title: 'Select product import file',
      filters: [
        { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
      properties: ['openFile'],
    });
    if (!open.success || open.data?.canceled || !open.data?.filePaths?.[0]) return;
    const path = open.data.filePaths[0];
    setBusy(true);
    const fmt = detectExt(path);
    setFilePath(path);
    setFileFormat(fmt);
    const res = await invokeWithAuth('import:analyze', { filePath: path, format: fmt });
    setBusy(false);
    if (!res.success) {
      fail(res.error || 'Could not read file.');
      return;
    }
    setAnalysis(res.data);
    setMapping(res.data.mapping || {});
    setStep(1);
  };

  const runPreview = async () => {
    if (!filePath) return;
    if (analysis?.requiredMissing?.length) {
      const stillMissing = analysis.requiredMissing.filter(
        (f) => !Object.values(mapping).includes(f.key)
      );
      if (stillMissing.length) {
        fail(`Map required field(s): ${stillMissing.map((f) => f.label).join(', ')}`);
        return;
      }
    }
    setBusy(true);
    const res = await invokeWithAuth('import:previewMapped', {
      entityId: 'products',
      filePath,
      format: fileFormat,
      mapping,
      categoryMode,
      supplierMode,
    });
    setBusy(false);
    if (!res.success) {
      fail(res.error || 'Preview failed.');
      return;
    }
    setPreview(res.data);
    setCategoriesToCreate(res.data.unknownCategories || []);
    setSuppliersToCreate(res.data.unknownSuppliers || []);
    setStep(3);
  };

  const runImport = async () => {
    setBusy(true);
    setStep(4);
    const id = crypto.randomUUID();
    setJobId(id);
    setProgress({ stage: 'Starting…', percent: 0 });
    const res = await invokeWithAuth('import:run', {
      entityId: 'products',
      filePath,
      format: fileFormat,
      mapping,
      duplicateMode,
      categoryMode,
      supplierMode,
      categoriesToCreate: categoryMode === 'ask' ? categoriesToCreate : [],
      suppliersToCreate: supplierMode === 'ask' ? suppliersToCreate : [],
      autoGenerateBarcode,
      autoGenerateSku,
      themePreference: theme,
      jobId: id,
    });
    setBusy(false);
    if (!res.success) {
      fail(res.error || 'Import failed.');
      setStep(3);
      return;
    }
    setImportResult(res.data);
    setStep(5);
    load();
    notify(
      `Import done: ${res.data.report?.inserted || 0} new, ${res.data.report?.updated || 0} updated, ${res.data.report?.failed || 0} failed.`
    );
  };

  const downloadErrorReport = async (errorReport) => {
    const save = await invokeWithAuth('dialog:showSave', {
      title: 'Save error report',
      defaultPath: 'zen-import-errors.xlsx',
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
    });
    if (!save.success || save.data?.canceled || !save.data?.filePath) return;
    const fmt = detectExt(save.data.filePath);
    const res = await invokeWithAuth('import:errorReport', {
      filePath: save.data.filePath,
      format: fmt,
      errorReport: errorReport || [],
    });
    if (!res.success) {
      fail(res.error || 'Could not save error report.');
      return;
    }
    notify('Error report saved.');
  };

  const handleExport = async () => {
    const entity = entities.find((e) => e.id === exportEntity);
    const ext = exportFormat === 'excel' ? 'xlsx' : exportFormat;
    const save = await invokeWithAuth('dialog:showSave', {
      title: 'Export data',
      defaultPath: `zen-${exportEntity}.${ext}`,
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
    });
    if (!save.success || save.data?.canceled || !save.data?.filePath) return;

    setBusy(true);
    const id = crypto.randomUUID();
    setJobId(id);
    setProgress({ stage: 'Exporting…', percent: 5 });

    const filters = {};
    if (exportActiveFilter === 'active') filters.activeOnly = true;
    if (exportActiveFilter === 'inactive') filters.inactiveOnly = true;
    if (exportLowStock) filters.lowStockOnly = true;
    if (exportVatOnly) filters.vatOnly = true;

    const res = await invokeWithAuth('export:run', {
      entityId: exportEntity,
      format: exportFormat,
      filePath: save.data.filePath,
      reportType: isReports ? exportReportType : undefined,
      dateFrom: exportDateFrom || undefined,
      dateTo: exportDateTo || undefined,
      date: exportDateTo || exportDateFrom || undefined,
      filters,
      jobId: id,
    });
    setBusy(false);
    setProgress(null);
    if (!res.success) {
      fail(res.error || 'Export failed.');
      return;
    }
    notify(`Exported ${res.data.rowCount ?? 0} row(s) from ${entity?.label || exportEntity}.`);
  };

  if (!isAdmin) {
    return (
      <Alert>
        <AlertDescription>Only administrators can import or export shop data.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {progress && busy && (
        <Alert>
          <AlertDescription>
            {progress.stage || 'Working…'}
            {typeof progress.percent === 'number' ? ` (${progress.percent}%)` : ''}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Product Import Wizard</CardTitle>
          <CardDescription>
            Import from Excel/CSV with column mapping, validation, and duplicate handling.
            Best for migrating from paper lists or bulk price updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button type="button" onClick={openWizard} disabled={busy}>
            Start Import Wizard
          </Button>
          <Button type="button" variant="outline" onClick={downloadTemplate} disabled={busy}>
            Download Excel Template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
          <CardDescription>
            Selective export for Excel editing and reports — not a full backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-2">Data type</label>
              <select
                className={inputClassName}
                value={exportEntity}
                onChange={(e) => setExportEntity(e.target.value)}
              >
                {exportable.map((e) => (
                  <option key={e.id} value={e.id} disabled={!e.available}>
                    {e.label}
                    {!e.available ? ' (not available)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Format</label>
              <select
                className={inputClassName}
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
              >
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                {isReports && <option value="pdf">PDF</option>}
              </select>
            </div>
          </div>

          {(exportEntity === 'products' || exportEntity === 'suppliers' || exportEntity === 'inventory') && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-2">Active filter</label>
                <select
                  className={inputClassName}
                  value={exportActiveFilter}
                  onChange={(e) => setExportActiveFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
              </div>
              {exportEntity === 'products' && (
                <>
                  <label className="flex items-center gap-2 text-sm mt-8">
                    <input
                      type="checkbox"
                      checked={exportLowStock}
                      onChange={(e) => setExportLowStock(e.target.checked)}
                    />
                    Low stock only
                  </label>
                  <label className="flex items-center gap-2 text-sm mt-8">
                    <input
                      type="checkbox"
                      checked={exportVatOnly}
                      onChange={(e) => setExportVatOnly(e.target.checked)}
                    />
                    VAT items only
                  </label>
                </>
              )}
            </div>
          )}

          {isReports && (
            <div>
              <label className="block text-sm font-medium mb-2">Report type</label>
              <select
                className={inputClassName}
                value={exportReportType}
                onChange={(e) => setExportReportType(e.target.value)}
              >
                <option value="dailySummary">Daily sales summary</option>
                <option value="salesByDay">Sales by day</option>
                <option value="monthlySales">Monthly sales trend</option>
                <option value="vatReport">VAT report</option>
                <option value="profitReport">Profit report</option>
                <option value="lowStock">Low stock</option>
                <option value="topProducts">Top products</option>
              </select>
            </div>
          )}

          {needsDates && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-2">From date</label>
                <input
                  type="date"
                  className={inputClassName}
                  value={exportDateFrom}
                  onChange={(e) => setExportDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">To date</label>
                <input
                  type="date"
                  className={inputClassName}
                  value={exportDateTo}
                  onChange={(e) => setExportDateTo(e.target.value)}
                />
              </div>
            </div>
          )}

          <Button type="button" onClick={handleExport} disabled={busy || !selectedEntity?.available}>
            Export
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>Recent imports with counts and duration.</CardDescription>
        </CardHeader>
        <CardContent>
          {!history.length ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm">{row.fileName || '—'}</TableCell>
                      <TableCell className="text-sm">{row.userName || '—'}</TableCell>
                      <TableCell className="text-sm">{row.mode || '—'}</TableCell>
                      <TableCell className="text-sm">
                        +{row.importedCount}/↑{row.updatedCount}/skip {row.skippedCount}/fail {row.failedCount}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.durationMs != null ? `${(row.durationMs / 1000).toFixed(1)}s` : '—'}
                      </TableCell>
                      <TableCell>
                        {row.failedCount > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const errRes = await invokeWithAuth('import:errorReport', {
                                historyId: row.id,
                              });
                              if (!errRes.success) {
                                fail(errRes.error);
                                return;
                              }
                              await downloadErrorReport(errRes.data.rows || []);
                            }}
                          >
                            Errors
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={wizardOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setWizardOpen(open);
          if (!open) resetWizard();
        }}
        dismissible={!busy}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product Import Wizard</DialogTitle>
            <DialogDescription>
              Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step]}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1 mb-4">
            {WIZARD_STEPS.map((label, i) => (
              <span
                key={label}
                className={cn(
                  'text-xs px-2 py-1 rounded-md',
                  i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  i < step && 'bg-emerald-500/20 text-emerald-700'
                )}
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choose an Excel (.xlsx) or CSV file. Download the template first if you are starting from scratch.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={pickImportFile} disabled={busy}>
                  Select File
                </Button>
                <Button type="button" variant="outline" onClick={downloadTemplate} disabled={busy}>
                  Download Template
                </Button>
              </div>
            </div>
          )}

          {step === 1 && analysis && (
            <div className="space-y-4">
              <p className="text-sm">
                <span className="font-medium">{analysis.fileName}</span>
                {' — '}
                {analysis.rowCount} data row(s), {analysis.headers?.length || 0} columns
              </p>
              {analysis.requiredMissing?.length > 0 &&
                analysis.requiredMissing.some((f) => !Object.values(mapping).includes(f.key)) && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Required field not mapped:{' '}
                      {analysis.requiredMissing
                        .filter((f) => !Object.values(mapping).includes(f.key))
                        .map((f) => f.label)
                        .join(', ')}
                    </AlertDescription>
                  </Alert>
                )}
              <div className="overflow-x-auto max-h-72 border border-border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Excel column</TableHead>
                      <TableHead>Maps to</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(analysis.headers || []).map((header) => (
                      <TableRow key={header}>
                        <TableCell className="font-medium text-sm">{header || '(empty)'}</TableCell>
                        <TableCell>
                          <select
                            className={inputClassName}
                            value={mapping[header] || ''}
                            onChange={(e) =>
                              setMapping((prev) => ({
                                ...prev,
                                [header]: e.target.value || undefined,
                              }))
                            }
                          >
                            <option value="">— Ignore —</option>
                            {(analysis.fields || []).map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                                {f.required ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">When SKU/barcode already exists</label>
                <select
                  className={inputClassName}
                  value={duplicateMode}
                  onChange={(e) => setDuplicateMode(e.target.value)}
                >
                  <option value="create">Create new only (skip duplicates)</option>
                  <option value="update">Update existing</option>
                  <option value="skip">Skip duplicates</option>
                  <option value="replace">Replace (soft-delete old, create new)</option>
                  <option value="merge">Merge (fill blank fields only)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">Applies to all rows in this import.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-2">Unknown categories</label>
                  <select
                    className={inputClassName}
                    value={categoryMode}
                    onChange={(e) => setCategoryMode(e.target.value)}
                  >
                    <option value="auto">Auto-create</option>
                    <option value="ask">Ask / pick which to create</option>
                    <option value="ignore">Ignore (leave blank)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Unknown suppliers</label>
                  <select
                    className={inputClassName}
                    value={supplierMode}
                    onChange={(e) => setSupplierMode(e.target.value)}
                  >
                    <option value="auto">Auto-create</option>
                    <option value="ask">Ask / pick which to create</option>
                    <option value="ignore">Ignore (leave blank)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoGenerateBarcode}
                  onChange={(e) => setAutoGenerateBarcode(e.target.checked)}
                />
                Auto-generate barcode when empty
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoGenerateSku}
                  onChange={(e) => setAutoGenerateSku(e.target.checked)}
                />
                Auto-generate SKU when empty
              </label>
            </div>
          )}

          {step === 3 && preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className={cn('px-2 py-1 rounded-md', statusClass('valid'))}>
                  Valid: {preview.summary?.valid ?? 0}
                </span>
                <span className={cn('px-2 py-1 rounded-md', statusClass('warning'))}>
                  Warnings: {preview.summary?.warning ?? 0}
                </span>
                <span className={cn('px-2 py-1 rounded-md', statusClass('error'))}>
                  Errors: {preview.summary?.error ?? 0}
                </span>
                <span className="text-muted-foreground">Total: {preview.total}</span>
              </div>

              {categoryMode === 'ask' && (preview.unknownCategories || []).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Create these categories?</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.unknownCategories.map((name) => (
                      <label key={name} className="flex items-center gap-1 text-sm border border-border rounded-md px-2 py-1">
                        <input
                          type="checkbox"
                          checked={categoriesToCreate.includes(name)}
                          onChange={(e) => {
                            setCategoriesToCreate((prev) =>
                              e.target.checked ? [...prev, name] : prev.filter((n) => n !== name)
                            );
                          }}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {supplierMode === 'ask' && (preview.unknownSuppliers || []).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Create these suppliers?</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.unknownSuppliers.map((name) => (
                      <label key={name} className="flex items-center gap-1 text-sm border border-border rounded-md px-2 py-1">
                        <input
                          type="checkbox"
                          checked={suppliersToCreate.includes(name)}
                          onChange={(e) => {
                            setSuppliersToCreate((prev) =>
                              e.target.checked ? [...prev, name] : prev.filter((n) => n !== name)
                            );
                          }}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto max-h-64 border border-border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(preview.results || []).slice(0, 100).map((r) => (
                      <TableRow key={r.rowNumber}>
                        <TableCell>{r.rowNumber}</TableCell>
                        <TableCell>
                          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', statusClass(r.status))}>
                            {r.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{r.data?.productName || '—'}</TableCell>
                        <TableCell className="text-sm">{r.data?.sku || '—'}</TableCell>
                        <TableCell className="text-sm">{r.data?.sellingPrice ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                          {[...(r.issues || []), ...(r.warnings || [])]
                            .slice(0, 2)
                            .map((i) => i.message)
                            .join(' · ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Rows with errors are skipped. Valid and warning rows will import.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm font-medium">{progress?.stage || 'Importing…'}</p>
              <div className="h-2 rounded-full bg-muted overflow-hidden max-w-md mx-auto">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, progress?.percent || 5)}%` }}
                />
              </div>
            </div>
          )}

          {step === 5 && importResult && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Imported {importResult.report?.inserted || 0} · Updated {importResult.report?.updated || 0} ·
                  Skipped {importResult.report?.skipped || 0} · Failed {importResult.report?.failed || 0}
                  {importResult.durationMs != null
                    ? ` · ${(importResult.durationMs / 1000).toFixed(1)}s`
                    : ''}
                </AlertDescription>
              </Alert>
              {(importResult.report?.categoriesCreated > 0 || importResult.report?.suppliersCreated > 0) && (
                <p className="text-sm text-muted-foreground">
                  Created {importResult.report.categoriesCreated || 0} categor(ies),{' '}
                  {importResult.report.suppliersCreated || 0} supplier(s).
                  {importResult.report.barcodesGenerated
                    ? ` Generated ${importResult.report.barcodesGenerated} barcode(s).`
                    : ''}
                </p>
              )}
              {(importResult.errorReport || []).length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadErrorReport(importResult.errorReport)}
                >
                  Download Error Report
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {step < 5 && step !== 4 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (step === 0) {
                    setWizardOpen(false);
                    resetWizard();
                  } else if (step === 3) setStep(2);
                  else setStep((s) => Math.max(0, s - 1));
                }}
                disabled={busy}
              >
                {step === 0 ? 'Close' : 'Back'}
              </Button>
            )}
            {step === 1 && (
              <Button type="button" onClick={() => setStep(2)} disabled={busy}>
                Next: Options
              </Button>
            )}
            {step === 2 && (
              <Button type="button" onClick={runPreview} disabled={busy}>
                {busy ? 'Validating…' : 'Validate & Preview'}
              </Button>
            )}
            {step === 3 && (
              <Button
                type="button"
                onClick={runImport}
                disabled={
                  busy ||
                  ((preview?.summary?.valid || 0) + (preview?.summary?.warning || 0) === 0)
                }
              >
                Confirm Import
              </Button>
            )}
            {step === 5 && (
              <Button
                type="button"
                onClick={() => {
                  setWizardOpen(false);
                  resetWizard();
                }}
              >
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
