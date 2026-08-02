import { ipcMain } from 'electron';
import printerService from '../services/printerService.js';
import saleService from '../services/saleService.js';
import returnService from '../services/returnService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import {
  getPrintPipelineLogPaths,
  pipelineLog,
  resetPrintPipelineSession,
} from '../lib/printPipelineLog.js';

export function registerPrinterHandlers() {
  ipcMain.handle('printer:pipelineLog', async (_event, payload = {}) => {
    pipelineLog(payload.step || 'renderer.unknown', {
      source: 'renderer',
      ...payload.fields,
    });
    return { success: true, paths: getPrintPipelineLogPaths() };
  });

  ipcMain.handle('printer:pipelineLogPaths', async () => ({
    success: true,
    data: getPrintPipelineLogPaths(),
  }));

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
    resetPrintPipelineSession('printer:printReceipt');
    pipelineLog('ipc.printer:printReceipt.enter', {
      saleId: payload.saleId,
      openDrawerPayload: payload.openDrawer,
    });
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) {
        pipelineLog('ipc.printer:printReceipt.exit', { success: false, reason: 'session', error: session.error });
        return session;
      }
      const roleCheck = requireRole(session, ['admin', 'manager', 'cashier']);
      if (!roleCheck.success) {
        pipelineLog('ipc.printer:printReceipt.exit', { success: false, reason: 'role', error: roleCheck.error });
        return roleCheck;
      }

      const sale = saleService.getById(payload.saleId);
      // Explicit false wins — reprints must never open the drawer.
      const openDrawer =
        payload.openDrawer === true
        && sale.paymentMethod === 'cash';
      pipelineLog('ipc.printer:printReceipt.resolved', {
        saleId: sale?.id,
        invoiceNumber: sale?.invoiceNumber,
        paymentMethod: sale?.paymentMethod,
        openDrawer,
      });
      const result = await printerService.printReceipt({
        sale,
        openDrawer,
      });
      const response = {
        success: Boolean(result?.success),
        data: result,
        error: result?.success ? undefined : (result?.error || 'Print failed.'),
      };
      pipelineLog('ipc.printer:printReceipt.exit', {
        successReturnedToRenderer: response.success,
        dataSuccess: Boolean(result?.success),
        drawerOpened: Boolean(result?.drawerOpened),
        drawerPulseSent: Boolean(result?.drawerOpened),
        error: response.error || null,
        logPaths: getPrintPipelineLogPaths(),
      });
      return response;
    } catch (err) {
      pipelineLog('ipc.printer:printReceipt.exit', {
        successReturnedToRenderer: false,
        error: err.message,
      });
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
