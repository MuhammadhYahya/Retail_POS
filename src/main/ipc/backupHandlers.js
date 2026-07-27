import { BrowserWindow, dialog, ipcMain, app } from 'electron';
import backupService from '../services/backup/index.js';
import backupScheduleService from '../services/backup/backupScheduleService.js';
import { progressBus } from '../services/backup/backupUtils.js';
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

function sendProgress(payload) {
  const channel = payload.channel || 'backup:progress';
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

let progressHooked = false;
function ensureProgressBridge() {
  if (progressHooked) return;
  progressHooked = true;
  progressBus.on('progress', sendProgress);
}

export function registerBackupHandlers() {
  ensureProgressBridge();

  ipcMain.handle('backup:create', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;

      const jobId = backupService.createJob(payload.jobId);
      const data = await backupService.createBackup({
        destinationDir: payload.destinationDir || null,
        type: payload.type || 'manual',
        jobId,
        themePreference: payload.themePreference || null,
      });
      writeAuditLog('backup_create', gate.session.user.id, data.uuid);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('backup:cancel', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const cancelled = backupService.cancelJob(payload.jobId);
      writeAuditLog('backup_cancel', gate.session.user.id, payload.jobId);
      return { success: true, data: { cancelled } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:list', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: backupService.listLocalBackups() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:listDrives', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: backupService.listRemovableDrives() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:history', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: backupService.listHistory() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:verify', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await backupService.verifyBackup({ backupPath: payload.backupPath });
      writeAuditLog('backup_verify', gate.session.user.id, payload.backupPath);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:preview', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await backupService.previewBackup({ backupPath: payload.backupPath });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:restore', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;

      const jobId = backupService.createJob(payload.jobId);
      const data = await backupService.restoreBackup({
        backupPath: payload.backupPath,
        themePreference: payload.themePreference || null,
        jobId,
      });
      writeAuditLog('backup_restore', gate.session.user.id, payload.backupPath);

      // Relaunch after short delay so renderer can show message
      if (data.relaunch) {
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 1200);
      }

      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:delete', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = backupService.deleteBackup({
        uuid: payload.uuid,
        backupPath: payload.backupPath,
      });
      writeAuditLog('backup_delete', gate.session.user.id, payload.uuid || payload.backupPath);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:openFolder', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = backupService.openBackupFolder({ backupPath: payload.backupPath });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:getSettings', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      return { success: true, data: backupService.getBackupSettings() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:updateSettings', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = backupService.updateBackupSettings(payload.settings || payload);
      writeAuditLog('backup_settings_update', gate.session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:runScheduled', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;
      const data = await backupScheduleService.runScheduledNow({
        themePreference: payload.themePreference || null,
      });
      writeAuditLog('backup_automatic', gate.session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

export function registerDialogHandlers() {
  ipcMain.handle('dialog:showOpen', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;

      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win || undefined, {
        title: payload.title || 'Open',
        properties: payload.properties || ['openFile'],
        filters: payload.filters || undefined,
        defaultPath: payload.defaultPath || undefined,
      });

      return {
        success: true,
        data: {
          canceled: result.canceled,
          filePaths: result.filePaths || [],
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:showSave', async (event, payload = {}) => {
    try {
      const gate = adminGate(payload);
      if (!gate.ok) return gate.response;

      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win || undefined, {
        title: payload.title || 'Save',
        defaultPath: payload.defaultPath || undefined,
        filters: payload.filters || undefined,
      });

      return {
        success: true,
        data: {
          canceled: result.canceled,
          filePath: result.filePath || null,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
