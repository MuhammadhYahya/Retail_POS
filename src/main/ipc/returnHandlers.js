import { ipcMain } from 'electron';
import returnService from '../services/returnService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerReturnHandlers() {
  ipcMain.handle('return:lookupSale', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;

      let saleId = payload.saleId;
      if (!saleId && payload.invoiceNumber) {
        const saleService = (await import('../services/saleService.js')).default;
        const sale = saleService.getByInvoiceNumber(payload.invoiceNumber);
        saleId = sale.id;
      }
      return { success: true, data: returnService.getReturnableForSale(saleId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('return:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      // Cashiers need manager/admin for returns per plan — allow admin/manager always;
      // cashiers allowed only with approve role check: plan says "Manager PIN or no"
      // V1: admin + manager; cashier blocked for simplicity of money control
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;

      const data = returnService.createReturn({
        saleId: payload.saleId,
        items: payload.items || [],
        reason: payload.reason,
        refundMethod: payload.refundMethod,
        userId: session.user.id,
      });
      writeAuditLog(`return_create:${data.returnNumber}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('return:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;
      return { success: true, data: returnService.listRecent({ limit: payload.limit }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('return:get', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;
      return { success: true, data: returnService.getById(payload.returnId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
