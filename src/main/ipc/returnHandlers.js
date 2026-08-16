import { ipcMain } from 'electron';
import returnService from '../services/returnService.js';
import { extractToken, requirePermission, validateSession } from '../lib/sessionAuth.js';
import { addAuditWarning, writeAuditEvent } from '../lib/auditLog.js';

export function registerReturnHandlers() {
  ipcMain.handle('return:lookupSale', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'returns');
      if (!permCheck.success) return permCheck;

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
      const permCheck = requirePermission(session, 'returns');
      if (!permCheck.success) return permCheck;

      const data = returnService.createReturn({
        saleId: payload.saleId,
        items: payload.items || [],
        reason: payload.reason,
        refundMethod: payload.refundMethod,
        userId: session.user.id,
      });
      const audit = writeAuditEvent({
        action: 'refund_create', entityType: 'sale_return', entityId: data.id,
        referenceNumber: data.returnNumber, amount: data.refundTotal,
        actorUserId: session.user.id, actorDisplayName: session.user.display_name || session.user.username,
        details: { saleId: data.saleId, refundMethod: data.refundMethod, reason: data.reason },
      });
      return addAuditWarning({ success: true, data }, audit);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('return:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'returns');
      if (!permCheck.success) return permCheck;
      return { success: true, data: returnService.listRecent({ limit: payload.limit }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('return:get', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'returns');
      if (!permCheck.success) return permCheck;
      return { success: true, data: returnService.getById(payload.returnId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
