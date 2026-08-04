import { ipcMain } from 'electron';
import purchaseService from '../services/purchaseService.js';
import { extractToken, requirePermission, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerPurchaseHandlers() {
  ipcMain.handle('supplier:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      return { success: true, data: purchaseService.listSuppliers() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('supplier:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      const data = purchaseService.createSupplier(payload);
      writeAuditLog(`supplier_create:${data.name}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('purchase:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      return {
        success: true,
        data: purchaseService.listReceipts({ limit: payload.limit, status: payload.status }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('purchase:get', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      return { success: true, data: purchaseService.getReceipt(payload.receiptId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('purchase:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      const data = purchaseService.createReceipt({
        supplierId: payload.supplierId,
        notes: payload.notes,
        items: payload.items || [],
        createdBy: session.user.id,
      });
      writeAuditLog(`grn_create:${data.grnNumber}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('purchase:post', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      const data = purchaseService.postReceipt({
        receiptId: payload.receiptId,
        userId: session.user.id,
      });
      writeAuditLog(`grn_post:${data.grnNumber}`, session.user.id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
