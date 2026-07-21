import { ipcMain } from 'electron';
import productService from '../services/productService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';
import { writeAuditLog } from '../lib/auditLog.js';

function requireAdmin(session) {
  return requireRole(session, ['admin']);
}

export function registerProductHandlers() {
  ipcMain.handle('category:getAll', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: productService.listCategories(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('category:create', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      const category = productService.createCategory({
        name: payload.name,
        parentId: payload.parentId,
      });

      writeAuditLog(`category_create:${category.name}`, session.user.id);

      return { success: true, data: category };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('category:delete', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      productService.deleteCategory(payload.categoryId, { moveProducts: Boolean(payload.moveProducts) });
      writeAuditLog(`category_delete:${payload.categoryId}`, session.user.id);

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:getAll', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: productService.listProducts(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:getById', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: productService.getProductById(payload.productId),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:create', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      const product = productService.createProduct({ ...payload, createdBy: session.user.id });
      writeAuditLog(`product_create:${product.name}`, session.user.id);

      return { success: true, data: product };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:update', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      const product = productService.updateProduct(payload.productId, { ...payload, createdBy: session.user.id });
      writeAuditLog(`product_update:${product?.name || payload.productId}`, session.user.id);

      return { success: true, data: product };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:delete', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      productService.deleteProduct(payload.productId);
      writeAuditLog(`product_delete:${payload.productId}`, session.user.id);

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:lookupBarcode', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: productService.lookupVariantByBarcode(payload.barcode),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('inventory:adjustStock', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      const summary = productService.adjustStock({
        variantId: payload.variantId,
        quantity: payload.quantity,
        transactionType: payload.transactionType || 'adjustment',
        unitCost: payload.unitCost,
        referenceType: payload.referenceType,
        referenceId: payload.referenceId,
        notes: payload.notes,
        createdBy: session.user.id,
      });

      writeAuditLog(
        `inventory_adjust:${payload.variantId}:${payload.quantity}:${payload.transactionType || 'adjustment'}`,
        session.user.id
      );

      return { success: true, data: summary };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('inventory:getSummary', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      return {
        success: true,
        data: productService.getInventorySummary(payload.variantId),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('inventory:getHistory', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;
      return { success: true, data: productService.listInventoryHistory(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('inventory:getLowStock', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      return { success: true, data: productService.listLowStock() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('inventory:disableLowStockAlert', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;
      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;
      productService.disableLowStockAlert(payload.variantId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
