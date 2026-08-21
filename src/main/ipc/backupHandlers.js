import { BrowserWindow, dialog, ipcMain, app } from 'electron';
import fs from 'node:fs';
import backupService from '../services/backup/index.js';
import { progressBus } from '../services/backup/backupUtils.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog, writeAuditLogWithoutUserRef } from '../lib/auditLog.js';
import { closeDb, getDb, setActiveDbPath } from '../database/db.js';

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

export function registerBackupHandlers(startupState = null) {
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
      writeAuditLogWithoutUserRef('backup_restore', {
        restoredByUsername: gate.session.user.username,
        restoredFrom: payload.backupPath,
        identitySource: 'pre_restore_session',
      });
      backupService.writeStateMarker(data.stats?.userCount > 0 ? 'ACTIVE' : 'FIRST_RUN');

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

  ipcMain.handle('data:getState', () => ({ success: true, data: startupState || backupService.detectDataState() }));

  ipcMain.handle('data:useExisting', (event, payload = {}) => {
    try {
      const state = backupService.detectDataState();
      if (state.state !== 'AWAITING_CHOICE' || !fs.existsSync(state.databasePath) || !backupService.isValidZenDatabase(state.databasePath)) {
        backupService.writeStateMarker('FIRST_RUN');
        return { success: false, error: 'The existing ZEN database is missing or invalid.' };
      }
      setActiveDbPath(state.databasePath);
      closeDb();
      getDb();
      backupService.writeStateMarker('ACTIVE');
      return { success: true };
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
