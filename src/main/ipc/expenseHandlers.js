import { ipcMain } from 'electron';
import expenseService from '../services/expenseService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerExpenseHandlers() {
  ipcMain.handle('expense:categories', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      return { success: true, data: expenseService.categories() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expense:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;
      return {
        success: true,
        data: expenseService.list({ limit: payload.limit, sessionId: payload.sessionId }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expense:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;

      const data = expenseService.create({
        category: payload.category,
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        note: payload.note,
        userId: session.user.id,
        expenseDate: payload.expenseDate,
      });
      writeAuditLog(`expense_create:${data.id}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expense:delete', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;
      const data = expenseService.softDelete({
        expenseId: payload.expenseId,
        userId: session.user.id,
      });
      writeAuditLog(`expense_delete:${data.id}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
