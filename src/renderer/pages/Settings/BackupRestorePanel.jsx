import React, { useCallback, useEffect, useState } from 'react';
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
import { useThemeStore } from '../../store/themeStore';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function formatBytes(size) {
  if (!size && size !== 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatType(type) {
  const map = {
    manual: 'Manual',
    automatic: 'Automatic',
    pre_upgrade: 'Pre-Upgrade',
    restore_point: 'Restore Point',
    legacy: 'Legacy',
  };
  return map[type] || type || '—';
}

export default function BackupRestorePanel({ onMessage, onError }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [history, setHistory] = useState([]);
  const [diskExtras, setDiskExtras] = useState([]);
  const [autoSettings, setAutoSettings] = useState({
    enabled: false,
    frequency: 'daily',
    time: '02:00',
    keep: 7,
    location: '',
  });
  const [entities, setEntities] = useState([]);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [allowCancel, setAllowCancel] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePath, setRestorePath] = useState('');
  const [restorePreview, setRestorePreview] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [exportEntity, setExportEntity] = useState('products');
  const [exportFormat, setExportFormat] = useState('csv');
  const [importEntity, setImportEntity] = useState('products');
  const [importFormat, setImportFormat] = useState('csv');
  const [importMode, setImportMode] = useState('insert');
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const notify = useCallback(
    (msg) => {
      onMessage?.(msg);
    },
    [onMessage]
  );
  const fail = useCallback(
    (msg) => {
      onError?.(msg);
    },
    [onError]
  );

  const load = useCallback(async () => {
    const [listRes, settingsRes, entitiesRes] = await Promise.all([
      invokeWithAuth('backup:list'),
      invokeWithAuth('backup:getSettings'),
      invokeWithAuth('export:entities'),
    ]);

    if (listRes.success) {
      setHistory(listRes.data.history || []);
      setDiskExtras(listRes.data.extras || []);
    }
    if (settingsRes.success) {
      setAutoSettings(settingsRes.data);
    }
    if (entitiesRes.success) {
      setEntities(entitiesRes.data || []);
      const firstImportable = (entitiesRes.data || []).find((e) => e.importable && e.available);
      const firstExportable = (entitiesRes.data || []).find((e) => e.exportable && e.available);
      if (firstImportable) setImportEntity(firstImportable.id);
      if (firstExportable) setExportEntity(firstExportable.id);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubBackup = subscribeProgress('backup:progress', (payload) => {
      if (jobId && payload.jobId && payload.jobId !== jobId) return;
      setProgress(payload);
      if (payload.theme && setTheme) {
        // restore may return theme via separate path
      }
    });
    const unsubImport = subscribeProgress('import:progress', (payload) => {
      if (jobId && payload.jobId && payload.jobId !== jobId) return;
      setProgress(payload);
    });
    return () => {
      unsubBackup?.();
      unsubImport?.();
    };
  }, [jobId, setTheme]);

  const pickFolder = async () => {
    const res = await invokeWithAuth('dialog:showOpen', {
      title: 'Choose backup destination',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.success || res.data.canceled) return null;
    return res.data.filePaths?.[0] || null;
  };

  const pickBackupFile = async () => {
    const res = await invokeWithAuth('dialog:showOpen', {
      title: 'Select POSLY backup',
      properties: ['openFile'],
      filters: [
        { name: 'POSLY Backup', extensions: ['poslybackup'] },
        { name: 'Legacy DB', extensions: ['db'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!res.success || res.data.canceled) return null;
    return res.data.filePaths?.[0] || null;
  };

  const handleCreateBackup = async () => {
    fail('');
    notify('');
    const destinationDir = await pickFolder();
    if (!destinationDir) return;

    const id = crypto.randomUUID();
    setJobId(id);
    setBusy(true);
    setAllowCancel(true);
    setProgress({ stage: 'Preparing...', percent: 0 });

    const response = await invokeWithAuth('backup:create', {
      destinationDir,
      type: 'manual',
      jobId: id,
      themePreference: theme,
    });

    setBusy(false);
    setAllowCancel(false);
    setJobId(null);

    if (!response.success) {
      fail(response.error || 'Backup failed.');
      setProgress(null);
      return;
    }
    notify(`Backup created and verified: ${response.data.fileName}`);
    setProgress({ stage: 'Completed', percent: 100 });
    load();
  };

  const handleCancel = async () => {
    if (!jobId || !allowCancel) return;
    await invokeWithAuth('backup:cancel', { jobId });
  };

  const openRestorePreview = async (backupPath) => {
    fail('');
    notify('');
    setRestorePath(backupPath);
    setRestorePreview(null);
    setRestoreOpen(true);
    const response = await invokeWithAuth('backup:preview', { backupPath });
    if (!response.success) {
      fail(response.error || 'Could not read backup.');
      setRestoreOpen(false);
      return;
    }
    if (!response.data.compatible) {
      fail(response.data.error || 'Incompatible backup.');
      setRestoreOpen(false);
      return;
    }
    setRestorePreview(response.data);
  };

  const handlePickAndRestore = async () => {
    const file = await pickBackupFile();
    if (!file) return;
    openRestorePreview(file);
  };

  const confirmRestore = async () => {
    if (!restorePath) return;
    setBusy(true);
    setAllowCancel(false);
    setProgress({ stage: 'Starting restore...', percent: 0 });
    const id = crypto.randomUUID();
    setJobId(id);

    const response = await invokeWithAuth('backup:restore', {
      backupPath: restorePath,
      themePreference: theme,
      jobId: id,
    });

    if (!response.success) {
      setBusy(false);
      setJobId(null);
      fail(response.error || 'Restore failed.');
      return;
    }

    if (response.data.theme) {
      setTheme(response.data.theme);
    }
    notify(response.data.message || 'Restore complete. Restarting…');
    setRestoreOpen(false);
    // App will relaunch from main process
  };

  const handleVerify = async (backupPath) => {
    fail('');
    notify('');
    setBusy(true);
    const response = await invokeWithAuth('backup:verify', { backupPath });
    setBusy(false);
    if (!response.success) {
      fail(response.error || 'Verification failed.');
      return;
    }
    notify('Backup verified successfully.');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const response = await invokeWithAuth('backup:delete', {
      uuid: deleteTarget.uuid,
      backupPath: deleteTarget.path,
    });
    setBusy(false);
    setDeleteTarget(null);
    if (!response.success) {
      fail(response.error || 'Delete failed.');
      return;
    }
    notify('Backup deleted.');
    load();
  };

  const handleOpenFolder = async (backupPath) => {
    await invokeWithAuth('backup:openFolder', { backupPath: backupPath || null });
  };

  const saveAutoSettings = async () => {
    fail('');
    notify('');
    const response = await invokeWithAuth('backup:updateSettings', { settings: autoSettings });
    if (!response.success) {
      fail(response.error || 'Failed to save automatic backup settings.');
      return;
    }
    setAutoSettings(response.data);
    notify('Automatic backup settings saved.');
  };

  const pickAutoLocation = async () => {
    const folder = await pickFolder();
    if (!folder) return;
    setAutoSettings((s) => ({ ...s, location: folder }));
  };

  const handleExport = async () => {
    fail('');
    notify('');
    const entity = entities.find((e) => e.id === exportEntity);
    const ext = exportFormat === 'excel' || exportFormat === 'xlsx' ? 'xlsx' : exportFormat;
    const saveRes = await invokeWithAuth('dialog:showSave', {
      title: 'Export data',
      defaultPath: `posly-${exportEntity}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!saveRes.success || saveRes.data.canceled || !saveRes.data.filePath) return;

    const id = crypto.randomUUID();
    setJobId(id);
    setBusy(true);
    setAllowCancel(true);
    setProgress({ stage: 'Exporting...', percent: 0 });

    const response = await invokeWithAuth('export:run', {
      entityId: exportEntity,
      format: exportFormat,
      filePath: saveRes.data.filePath,
      jobId: id,
    });

    setBusy(false);
    setAllowCancel(false);
    setJobId(null);

    if (!response.success) {
      fail(response.error || 'Export failed.');
      return;
    }
    notify(`Exported ${response.data.rowCount} ${entity?.label || 'rows'}.`);
    setProgress({ stage: 'Completed', percent: 100 });
  };

  const beginImport = async () => {
    fail('');
    notify('');
    setImportPreview(null);
    const openRes = await invokeWithAuth('dialog:showOpen', {
      title: 'Import data file',
      properties: ['openFile'],
      filters: [
        { name: 'Data files', extensions: ['csv', 'xlsx', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!openRes.success || openRes.data.canceled) return;
    const filePath = openRes.data.filePaths?.[0];
    if (!filePath) return;

    const ext = filePath.split('.').pop()?.toLowerCase();
    const format = ext === 'xlsx' ? 'xlsx' : ext === 'json' ? 'json' : 'csv';
    setImportFormat(format);
    setImportFile(filePath);
    setImportOpen(true);

    const previewRes = await invokeWithAuth('import:preview', {
      entityId: importEntity,
      filePath,
      format,
    });
    if (!previewRes.success) {
      fail(previewRes.error || 'Preview failed.');
      setImportOpen(false);
      return;
    }
    setImportPreview(previewRes.data);
  };

  const confirmImport = async () => {
    setBusy(true);
    setAllowCancel(true);
    const id = crypto.randomUUID();
    setJobId(id);
    setProgress({ stage: 'Importing...', percent: 0 });

    const response = await invokeWithAuth('import:run', {
      entityId: importEntity,
      filePath: importFile,
      format: importFormat,
      mode: importMode,
      themePreference: theme,
      jobId: id,
    });

    setBusy(false);
    setAllowCancel(false);
    setJobId(null);
    setImportOpen(false);

    if (!response.success) {
      fail(response.error || 'Import failed.');
      return;
    }
    const r = response.data.report || {};
    notify(
      `Import complete — inserted: ${r.inserted || 0}, updated: ${r.updated || 0}, skipped: ${r.skipped || 0}.`
    );
    setProgress({ stage: 'Completed', percent: 100 });
  };

  const rows = [
    ...history.map((h) => ({
      key: h.uuid,
      uuid: h.uuid,
      date: h.createdAt,
      type: h.type,
      size: h.size,
      location: h.path,
      status: h.status === 'verified' ? 'Verified' : h.status,
      path: h.path,
    })),
    ...diskExtras.map((d) => ({
      key: d.path,
      uuid: null,
      date: d.modifiedAt,
      type: d.type,
      size: d.size,
      location: d.path,
      status: d.status === 'legacy' ? 'Legacy' : 'On disk',
      path: d.path,
    })),
  ];

  const exportable = entities.filter((e) => e.exportable);
  const importable = entities.filter((e) => e.importable);

  return (
    <div className="space-y-6">
      {(busy || progress) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{progress?.stage || 'Working…'}</p>
              <span className="text-sm text-muted-foreground">{progress?.percent ?? 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progress?.percent || 0))}%` }}
              />
            </div>
            {allowCancel && (
              <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Backup & Restore</CardTitle>
          <CardDescription>
            Create a full shop backup (`.poslybackup`) or restore from a previous backup. Always verified before success.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button type="button" onClick={handleCreateBackup} disabled={busy}>
            Create Backup
          </Button>
          <Button type="button" variant="outline" onClick={handlePickAndRestore} disabled={busy}>
            Restore Backup
          </Button>
          <Button type="button" variant="outline" onClick={() => handleOpenFolder(null)} disabled={busy}>
            Open Backup Folder
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automatic Backup</CardTitle>
          <CardDescription>Scheduled backups run even if the PC was off — on next startup if a slot was missed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(autoSettings.enabled)}
              onChange={(e) => setAutoSettings((s) => ({ ...s, enabled: e.target.checked }))}
            />
            Enable automatic backup
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-2">Frequency</label>
              <select
                className={inputClassName}
                value={autoSettings.frequency}
                onChange={(e) => setAutoSettings((s) => ({ ...s, frequency: e.target.value }))}
              >
                <option value="daily">Daily</option>
                <option value="every_3_days">Every 3 Days</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Backup time</label>
              <input
                type="time"
                className={inputClassName}
                value={autoSettings.time}
                onChange={(e) => setAutoSettings((s) => ({ ...s, time: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Keep last N backups</label>
              <input
                type="number"
                min="1"
                className={inputClassName}
                value={autoSettings.keep}
                onChange={(e) => setAutoSettings((s) => ({ ...s, keep: Number(e.target.value) || 7 }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Backup location</label>
              <div className="flex gap-2">
                <input className={inputClassName} value={autoSettings.location || ''} readOnly placeholder="AppData backups folder" />
                <Button type="button" variant="outline" onClick={pickAutoLocation}>
                  Browse
                </Button>
              </div>
            </div>
          </div>
          <Button type="button" onClick={saveAutoSettings} disabled={busy}>
            Save automatic settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup History</CardTitle>
          <CardDescription>Verified backups and restore points.</CardDescription>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <p className="text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {row.date ? new Date(row.date).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>{formatType(row.type)}</TableCell>
                      <TableCell>{formatBytes(row.size)}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => openRestorePreview(row.path)} disabled={busy}>
                            Restore
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => handleVerify(row.path)} disabled={busy}>
                            Verify
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => handleOpenFolder(row.path)}>
                            Open Folder
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteTarget(row)}
                            disabled={busy}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
          <CardDescription>Selective export — not a full backup. Use Backup to protect the entire shop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-2">Data type</label>
              <select className={inputClassName} value={exportEntity} onChange={(e) => setExportEntity(e.target.value)}>
                {exportable.map((e) => (
                  <option key={e.id} value={e.id} disabled={!e.available}>
                    {e.label}{!e.available ? ' (not available)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Format</label>
              <select className={inputClassName} value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
                <option value="json">JSON</option>
                <option value="pdf">PDF (reports only)</option>
              </select>
            </div>
          </div>
          <Button type="button" onClick={handleExport} disabled={busy}>
            Export Data
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import Data</CardTitle>
          <CardDescription>Preview and validate before importing. Failed imports roll back completely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-2">Data type</label>
              <select className={inputClassName} value={importEntity} onChange={(e) => setImportEntity(e.target.value)}>
                {importable.map((e) => (
                  <option key={e.id} value={e.id} disabled={!e.available}>
                    {e.label}{!e.available ? ' (not available)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">On duplicates</label>
              <select className={inputClassName} value={importMode} onChange={(e) => setImportMode(e.target.value)}>
                <option value="insert">Insert new only</option>
                <option value="update">Update existing</option>
                <option value="skip">Skip duplicates</option>
              </select>
            </div>
          </div>
          <Button type="button" onClick={beginImport} disabled={busy}>
            Import Data
          </Button>
        </CardContent>
      </Card>

      <Dialog open={restoreOpen} onOpenChange={(open) => !busy && setRestoreOpen(open)} dismissible={!busy}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              An emergency backup of the current shop will be created first. The app will restart after restore.
            </DialogDescription>
          </DialogHeader>
          {restorePreview?.manifest ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Business:</span> {restorePreview.manifest.businessName || '—'}</p>
              <p><span className="text-muted-foreground">Created:</span> {restorePreview.manifest.createdAt || `${restorePreview.manifest.date} ${restorePreview.manifest.time}`}</p>
              <p><span className="text-muted-foreground">POSLY Version:</span> {restorePreview.manifest.applicationVersion || '—'}</p>
              <p><span className="text-muted-foreground">Database Version:</span> {restorePreview.manifest.databaseVersion || '—'}</p>
              <p><span className="text-muted-foreground">Sales:</span> {restorePreview.manifest.salesCount ?? '—'}</p>
              <p><span className="text-muted-foreground">Products:</span> {restorePreview.manifest.productCount ?? '—'}</p>
              <p><span className="text-muted-foreground">Customers:</span> {restorePreview.manifest.customerCount ?? '—'}</p>
              <p><span className="text-muted-foreground">Users:</span> {restorePreview.manifest.userCount ?? '—'}</p>
              <p><span className="text-muted-foreground">Size:</span> {formatBytes(restorePreview.manifest.backupSize)}</p>
              {restorePreview.needsMigration && (
                <Alert>
                  <AlertDescription>This backup is from an older version. Migrations will run automatically after restore.</AlertDescription>
                </Alert>
              )}
              {restorePreview.legacy && (
                <Alert>
                  <AlertDescription>Legacy `.db` backup detected. Prefer `.poslybackup` archives going forward.</AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Reading backup…</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestoreOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmRestore} disabled={busy || !restorePreview}>
              {busy ? 'Restoring…' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete backup?</DialogTitle>
            <DialogDescription>This permanently deletes the backup file from disk.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => !busy && setImportOpen(open)} dismissible={!busy}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import preview</DialogTitle>
            <DialogDescription>
              {importPreview ? `${importPreview.total} rows found.` : 'Reading file…'}
            </DialogDescription>
          </DialogHeader>
          {importPreview?.errors?.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                {importPreview.errors.length} validation issue(s). First: {importPreview.errors[0].message}
              </AlertDescription>
            </Alert>
          )}
          {importPreview?.sample?.length > 0 && (
            <pre className="text-xs max-h-40 overflow-auto rounded-lg border border-border p-3 bg-muted/40">
              {JSON.stringify(importPreview.sample, null, 2)}
            </pre>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmImport} disabled={busy || !importPreview}>
              {busy ? 'Importing…' : 'Confirm import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
