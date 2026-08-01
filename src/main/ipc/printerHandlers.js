import { ipcMain } from 'electron';
import printerService from '../services/printerService.js';
import saleService from '../services/saleService.js';
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
      const result = await printerService.printReceipt({
        sale,
        openDrawer: payload.openDrawer !== false && sale.paymentMethod === 'cash',
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
