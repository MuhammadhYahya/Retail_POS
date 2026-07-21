import { ipcMain } from 'electron';
import saleService from '../services/saleService.js';
import irdService from '../services/irdService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export function registerSaleHandlers() {
  ipcMain.handle('sale:create', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const sale = saleService.createSale({
        cartItems: payload.cartItems || payload.items || [],
        payment: payload.payment || {},
        cashierId: session.user.id,
        notes: payload.notes,
      });

      let ird = null;
      try {
        ird = await irdService.saveForSale(sale.id);
      } catch (err) {
        console.error('[sale:create] IRD generation failed:', err.message);
      }

      writeAuditLog(`sale_create:${sale.invoiceNumber}`, session.user.id);

      return {
        success: true,
        data: {
          ...saleService.getById(sale.id),
          ird,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:getById', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return { success: true, data: saleService.getById(payload.saleId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:getByInvoice', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: saleService.getByInvoiceNumber(payload.invoiceNumber),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:listRecent', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: saleService.listRecent({
          limit: payload.limit,
          status: payload.status,
        }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:listTodayCashier', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['cashier']);
      if (!roleCheck.success) return roleCheck;
      return {
        success: true,
        data: saleService.listTodayForCashier({ cashierId: session.user.id, limit: payload.limit }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:void', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireRole(session, ['admin']);
      if (!roleCheck.success) return roleCheck;

      const sale = saleService.voidSale({
        saleId: payload.saleId,
        reason: payload.reason,
        userId: session.user.id,
      });

      writeAuditLog(`sale_void:${sale.invoiceNumber}`, session.user.id);
      return { success: true, data: sale };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:getReceipt', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const sale = saleService.getById(payload.saleId);
      if (session.user.role === 'cashier' && sale.cashierId !== session.user.id) {
        return { success: false, error: 'You can only view your own receipts.' };
      }
      const ird = irdService.getBySaleId(sale.id);
      return { success: true, data: { sale, ird } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
