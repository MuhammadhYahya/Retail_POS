import { ipcMain } from 'electron';
import saleService from '../services/saleService.js';
import { extractToken, requirePermission, requireRole, validateSession } from '../lib/sessionAuth.js';
import { addAuditWarning, writeAuditEvent } from '../lib/auditLog.js';
import { issueInitialPrintGrant } from '../lib/initialPrintGrants.js';

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
        saleDiscount: payload.saleDiscount || {},
        actorRole: session.user.role,
      });

      const audit = writeAuditEvent({
        action: 'sale_create',
        entityType: 'sale',
        entityId: sale.id,
        referenceNumber: sale.invoiceNumber,
        amount: sale.total,
        actorUserId: session.user.id,
        actorDisplayName: session.user.display_name || session.user.username,
        createdAt: sale.createdAt,
        details: { paymentMethod: sale.paymentMethod },
      });

      return addAuditWarning({
        success: true,
        data: {
          ...saleService.getById(sale.id),
          initialPrintToken: issueInitialPrintGrant({ saleId: sale.id, userId: session.user.id }),
        },
      }, audit);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:listTodayCashier', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      const roleCheck = requireRole(session, ['cashier', 'manager', 'admin']);
      if (!roleCheck.success) return roleCheck;
      return {
        success: true,
        data: saleService.listTodayForCashier({ cashierId: session.user.id, limit: payload.limit }),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:listBillingHistory', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      return { success: true, data: saleService.listBillingHistory({ days: 30, limit: 1000 }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sale:void', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const permCheck = requirePermission(session, 'voidSale');
      if (!permCheck.success) return permCheck;

      const sale = saleService.voidSale({
        saleId: payload.saleId,
        reason: payload.reason,
        userId: session.user.id,
      });

      const audit = writeAuditEvent({
        action: 'sale_void',
        entityType: 'sale',
        entityId: sale.id,
        referenceNumber: sale.invoiceNumber,
        amount: sale.total,
        actorUserId: session.user.id,
        actorDisplayName: session.user.display_name || session.user.username,
        createdAt: sale.voidedAt,
        details: {
          reason: sale.voidReason,
          paymentMethod: sale.paymentMethod,
          restoredItems: sale.items.map((item) => ({
            variantId: item.variantId,
            productName: item.productName,
            quantity: item.quantity,
          })),
        },
      });
      return {
        success: true,
        data: sale,
        ...(audit.success ? {} : { auditWarning: audit.warning, auditEventId: audit.eventId }),
      };
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
      return { success: true, data: { sale } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
