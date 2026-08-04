import { ipcMain } from 'electron';
import settingsService from '../services/settingsService.js';
import reportService from '../services/reportService.js';
import { extractToken, requirePermission, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      return { success: true, data: settingsService.get() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('settings:update', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const data = settingsService.update(payload.settings || payload);
      writeAuditLog('settings_update', session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

export function registerReportHandlers() {
  ipcMain.handle('report:dailySummary', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const permCheck = requirePermission(session, 'reports');
      if (!permCheck.success) return permCheck;

      return {
        success: true,
        data: reportService.dailySummary(payload.date),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:topProducts', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const permCheck = requirePermission(session, 'reports');
      if (!permCheck.success) return permCheck;

      return {
        success: true,
        data: reportService.topProducts(payload.days, payload.limit),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:salesByDay', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const permCheck = requirePermission(session, 'reports');
      if (!permCheck.success) return permCheck;

      return {
        success: true,
        data: reportService.salesByDay(payload.from, payload.to),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:recentSales', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const permCheck = requirePermission(session, 'reports');
      if (!permCheck.success) return permCheck;

      return {
        success: true,
        data: reportService.recentSales({
          date: payload.date,
          limit: payload.limit,
        }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
