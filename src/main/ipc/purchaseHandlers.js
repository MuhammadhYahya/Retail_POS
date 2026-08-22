import { ipcMain } from 'electron';
import purchaseService from '../services/purchaseService.js';
import purchaseReturnService from '../services/purchaseReturnService.js';
import { extractToken, requirePermission, validateSession } from '../lib/sessionAuth.js';
import { addAuditWarning, writeAuditEvent, writeAuditLog } from '../lib/auditLog.js';

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

  ipcMain.handle('purchase:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      const data = purchaseService.createReceipt({
        supplierId: payload.supplierId,
        invoiceNumber: payload.invoiceNumber,
        invoiceDate: payload.invoiceDate,
        receivedDate: payload.receivedDate,
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
      const audit = writeAuditEvent({ action: 'purchase_post', entityType: 'purchase_receipt', entityId: data.id, referenceNumber: data.grnNumber, amount: data.total, actorUserId: session.user.id });
      return addAuditWarning({ success: true, data }, audit);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('purchaseReturn:listable', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchaseReturns');
      if (!permCheck.success) return permCheck;
      return { success: true, data: purchaseReturnService.listReturnableReceipts(payload) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('purchaseReturn:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchaseReturns');
      if (!permCheck.success) return permCheck;
      return { success: true, data: purchaseReturnService.list(payload) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('purchaseReturn:create', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchaseReturns');
      if (!permCheck.success) return permCheck;
      const data = purchaseReturnService.create({ ...payload, userId: session.user.id });
      writeAuditLog(`purchase_return_create:${data.returnNumber}`, session.user.id);
      return { success: true, data };
    } catch (err) { return { success: false, error: err.message }; }
  });
}
