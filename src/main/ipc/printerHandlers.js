import { ipcMain } from 'electron';
import printerService from '../services/printerService.js';
import saleService from '../services/saleService.js';
import purchaseService from '../services/purchaseService.js';
import returnService from '../services/returnService.js';
import { extractToken, requirePermission, requireRole, validateSession } from '../lib/sessionAuth.js';
import { consumeInitialPrintGrant } from '../lib/initialPrintGrants.js';
import { writeAuditEvent } from '../lib/auditLog.js';

export function registerPrinterHandlers() {
  ipcMain.handle('printer:list', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const printers = await printerService.listPrintersAsync();
      return { success: true, data: printers };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const sale = saleService.getById(payload.saleId);
      const result = await printerService.printReceipt({
        sale,
        openDrawer: payload.openDrawer !== false && sale.paymentMethod === 'cash',
      });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printInitialReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;
      const sale = saleService.getById(payload.saleId);
      if (!consumeInitialPrintGrant(payload.initialPrintToken, { saleId: sale.id, userId: session.user.id })) {
        return { success: false, error: 'Initial receipt print authorization expired or is invalid.', code: 'FORBIDDEN' };
      }
      const result = await printerService.printReceipt({
        sale,
        openDrawer: payload.openDrawer !== false && sale.paymentMethod === 'cash',
      });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:reprintReceipt', async (event, payload = {}) => {
    let session;
    let sale;
    try {
      session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;
      sale = saleService.getById(payload.saleId);
      if (sale.status !== 'completed') return { success: false, error: 'Only completed sales can be reprinted.' };
      const result = await printerService.printReceipt({ sale, openDrawer: false });
      const audit = writeAuditEvent({
        action: 'sale_reprint',
        entityType: 'sale',
        entityId: sale.id,
        referenceNumber: sale.invoiceNumber,
        amount: sale.total,
        actorUserId: session.user.id,
        actorDisplayName: session.user.display_name || session.user.username,
        details: { success: Boolean(result?.success), error: result?.error || null },
      });
      return { success: true, data: result, ...(audit.success ? {} : { auditWarning: audit.warning }) };
    } catch (err) {
      if (session?.success && sale) {
        writeAuditEvent({
          action: 'sale_reprint', entityType: 'sale', entityId: sale.id,
          referenceNumber: sale.invoiceNumber, amount: sale.total,
          actorUserId: session.user.id,
          actorDisplayName: session.user.display_name || session.user.username,
          details: { success: false, error: err.message },
        });
      }
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printPurchaseReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;

      const receipt = purchaseService.getReceipt(payload.receiptId);
      const result = await printerService.printPurchaseReceipt({
        receipt,
        openDrawer: false,
      });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:reprintPurchaseReceipt', async (event, payload = {}) => {
    let session;
    let receipt;
    try {
      session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'purchases');
      if (!permCheck.success) return permCheck;
      receipt = purchaseService.getReceipt(payload.receiptId);
      if (receipt.status !== 'posted') {
        return { success: false, error: 'Only posted GRNs can be reprinted.' };
      }
      const result = await printerService.printPurchaseReceipt({ receipt, openDrawer: false, reprint: true });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printReturnReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permCheck = requirePermission(session, 'returns');
      if (!permCheck.success) return permCheck;

      const returnRecord = returnService.getById(payload.returnId);
      const result = await printerService.printReturnReceipt({
        returnRecord,
        openDrawer:
          payload.openDrawer !== false
          && String(returnRecord.refundMethod || '').toLowerCase() === 'cash',
      });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:testPrint', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;
      const result = await printerService.testPrint();
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:testReturnReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;
      const result = await printerService.testReturnReceipt();
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

}
