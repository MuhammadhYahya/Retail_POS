import { ipcMain } from 'electron';
import printerService from '../services/printerService.js';
import saleService from '../services/saleService.js';
import returnService from '../services/returnService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';

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
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;

      const sale = saleService.getById(payload.saleId);
      // Explicit false wins — reprints must never open the drawer.
      const openDrawer =
        payload.openDrawer === true
        && sale.paymentMethod === 'cash';
      const result = await printerService.printReceipt({
        sale,
        openDrawer,
      });
      // Bubble thermal success to top-level so callers cannot treat queue-accept as OK by mistake.
      return {
        success: Boolean(result?.success),
        data: result,
        error: result?.success ? undefined : (result?.error || 'Print failed.'),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printReturnReceipt', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager']);
      if (!roleCheck.success) return roleCheck;

      const returnRecord = returnService.getById(payload.returnId);
      const openDrawer =
        payload.openDrawer === true
        && String(returnRecord.refundMethod || '').toLowerCase() === 'cash';
      const result = await printerService.printReturnReceipt({
        returnRecord,
        openDrawer,
      });
      return {
        success: Boolean(result?.success),
        data: result,
        error: result?.success ? undefined : (result?.error || 'Print failed.'),
      };
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

  ipcMain.handle('printer:openDrawer', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) return roleCheck;
      const result = await printerService.openDrawer();
      return { success: result.success, data: result, error: result.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
