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
        jobId,
      });
      writeAuditLog('export_run', gate.session.user.id, `${payload.entityId}:${payload.format}`);
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
      const data = await importExportService.importData({
        entityId: payload.entityId,
        filePath: payload.filePath,
        format: payload.format,
        mode: payload.mode || 'insert',
        themePreference: payload.themePreference || null,
        jobId,
      });
      writeAuditLog(
        'import_run',
        gate.session.user.id,
        JSON.stringify({
          entityId: payload.entityId,
          mode: payload.mode,
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
}
