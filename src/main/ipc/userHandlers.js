import { ipcMain } from 'electron';
import userService from '../services/userService.js';
import { validateSession, requireRole, extractToken } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerUserHandlers() {
  ipcMain.handle('user:getAll', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const users = userService.getAll();
      return { success: true, data: users };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('user:create', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const {
        username,
        pin,
        role,
        displayName,
        securityQ1,
        securityA1,
        securityQ2,
        securityA2,
        email,
        phone,
      } = payload;

      const user = await userService.create({
        username,
        pin,
        role,
        displayName,
        securityQ1,
        securityA1,
        securityQ2,
        securityA2,
        email,
        phone,
      });

      writeAuditLog(`user_create:${user.username}:${user.role}`, session.user.id);
      return { success: true, data: user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('user:resetPin', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const userId = payload.userId;
      const newPin = payload.newPin;

      if (!userId) {
        return { success: false, error: 'User ID is required.' };
      }

      const target = userService.getById(userId);
      if (!target || target.deleted_at) {
        return { success: false, error: 'User not found.' };
      }

      if (target.role !== 'cashier') {
        return { success: false, error: 'Only cashier PINs can be reset from Staff Management.' };
      }

      await userService.resetPin(userId, newPin);
      writeAuditLog(`user_pin_reset:${target.username}`, session.user.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('user:delete', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const userId = payload.userId || payload;
      if (!userId) {
        return { success: false, error: 'User ID is required.' };
      }

      if (userId === session.user.id) {
        return { success: false, error: 'You cannot delete your own account.' };
      }

      const target = userService.getById(userId);
      if (!target || target.deleted_at) {
        return { success: false, error: 'User not found.' };
      }

      if (target.role === 'admin' && userService.countActiveAdmins() <= 1) {
        return { success: false, error: 'Cannot delete the last active admin.' };
      }

      userService.softDelete(userId);
      writeAuditLog(`user_delete:${target.username}`, session.user.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('user:unlock', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const userId = payload.userId || payload;
      if (!userId) {
        return { success: false, error: 'User ID is required.' };
      }

      const target = userService.getById(userId);
      if (!target || target.deleted_at) {
        return { success: false, error: 'User not found.' };
      }

      userService.unlock(userId);
      writeAuditLog(`user_unlock:${target.username}`, session.user.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
