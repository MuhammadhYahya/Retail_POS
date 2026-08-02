import { ipcMain } from 'electron';
import importExportService from '../services/importExport/index.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

function adminGate(payload = {}) {
  const token = extractToken(payload);
  const session = validateSession(token);
  if (!session.success) return { ok: false, response: session };
  const roleCheck = requireRole(session, ['admin']);
  if (!roleCheck.success) return { ok: false, response: roleCheck };
  return { ok: true, session };
}

export function registerImportExportHandlers() {
  ipcMain.handle('export:entities', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: importExportService.listEntities() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export:run', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const jobId = importExportService.createJob(payload.jobId);
      const data = await importExportService.exportData({
        entityId: payload.entityId,
        format: payload.format,
        filePath: payload.filePath,
        reportType: payload.reportType,
        date: payload.date,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        filters: payload.filters || {},
        columns: payload.columns || null,
        jobId,
      });
      writeAuditLog('export_run', gate.session.user.id, `${payload.entityId}:${payload.format}`);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('import:template', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await importExportService.downloadTemplate({ filePath: payload.filePath });
      writeAuditLog('import_template', gate.session.user.id, 'products');
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import:analyze', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await importExportService.analyzeImportFile({
        filePath: payload.filePath,
        format: payload.format,
      });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('import:fields', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: importExportService.listProductFields() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import:previewMapped', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await importExportService.previewMappedImport({
        entityId: payload.entityId || 'products',
        filePath: payload.filePath,
        format: payload.format,
        mapping: payload.mapping,
        categoryMode: payload.categoryMode || 'auto',
        supplierMode: payload.supplierMode || 'auto',
      });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('import:preview', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await importExportService.previewImport({
        entityId: payload.entityId,
        filePath: payload.filePath,
        format: payload.format,
      });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('import:run', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const jobId = importExportService.createJob(payload.jobId);
      const user = gate.session.user;
      const data = await importExportService.importData({
        entityId: payload.entityId,
        filePath: payload.filePath,
        format: payload.format,
        mode: payload.mode || 'insert',
        themePreference: payload.themePreference || null,
        jobId,
        mapping: payload.mapping || null,
        duplicateMode: payload.duplicateMode || null,
        categoryMode: payload.categoryMode || 'auto',
        supplierMode: payload.supplierMode || 'auto',
        categoriesToCreate: payload.categoriesToCreate || [],
        suppliersToCreate: payload.suppliersToCreate || [],
        autoGenerateBarcode: payload.autoGenerateBarcode !== false,
        autoGenerateSku: payload.autoGenerateSku !== false,
        userId: user.id,
        userName: user.display_name || user.username || user.displayName || null,
      });
      writeAuditLog(
        'import_run',
        user.id,
        JSON.stringify({
          entityId: payload.entityId,
          mode: payload.duplicateMode || payload.mode,
          report: data.report,
        })
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('import:cancel', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const cancelled = importExportService.cancelJob(payload.jobId);
      return { success: true, data: { cancelled } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import:history', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: importExportService.listImportHistory(payload.limit || 50) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import:errorReport', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      if (payload.historyId) {
        const rows = importExportService.getImportErrorReport(payload.historyId);
        if (payload.filePath) {
          const data = await importExportService.writeErrorReport({
            filePath: payload.filePath,
            format: payload.format || 'xlsx',
            errorReport: rows,
          });
          return { success: true, data };
        }
        return { success: true, data: { rows } };
      }
      const data = await importExportService.writeErrorReport({
        filePath: payload.filePath,
        format: payload.format || 'xlsx',
        errorReport: payload.errorReport || [],
      });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
