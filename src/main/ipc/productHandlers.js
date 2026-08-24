import { ipcMain } from 'electron';
import productService from '../services/productService.js';
import { extractToken, requirePermission, requireRole, validateSession } from '../lib/sessionAuth.js';
import { addAuditWarning, writeAuditEvent, writeAuditLog } from '../lib/auditLog.js';

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

  ipcMain.handle('category:update', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      const category = productService.updateCategory(payload.categoryId, {
        name: payload.name,
      });
      writeAuditLog(`category_update:${category.name}`, session.user.id);

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

  ipcMain.handle('product:createQuickPurchase', async (event, payload = {}) => {
    try {
      const session = validateSession(extractToken(payload));
      if (!session.success) return session;
      const permissionCheck = requirePermission(session, 'purchases');
      if (!permissionCheck.success) return permissionCheck;

      const product = productService.createProduct({
        name: payload.name,
        unit: payload.unit || 'pcs',
        hasExpiry: false,
        variants: [{
          name: payload.name,
          barcode: payload.barcode,
          name: payload.variantName || payload.name,
          attributes: payload.attributes || {},
          sellingPrice: payload.sellingPrice,
          costPrice: payload.costPrice,
          priceType: payload.priceType || 'FREE',
          trackInventory: true,
          lowStockAlert: 0,
          initialStock: 0,
          isDefault: true,
          isHidden: true,
        }],
        createdBy: session.user.id,
      });
      writeAuditLog(`quick_product_create:${product.name}`, session.user.id);
      const variant = product.defaultVariant || product.variants?.[0] || null;

      return {
        success: true,
        data: {
          productId: product.id,
          variantId: variant?.id || null,
          productName: product.name,
          variant,
          sku: variant?.sku || null,
          barcode: variant?.barcode || null,
          costPrice: variant?.costPrice ?? 0,
          sellingPrice: variant?.sellingPrice ?? 0,
          unit: product.unit || 'pcs',
          inventory: variant?.inventory || null,
        },
      };
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
      const audit = writeAuditEvent({ action: 'product_delete', entityType: 'product', entityId: payload.productId, actorUserId: session.user.id });

      return addAuditWarning({ success: true }, audit);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('product:deleteVariant', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const roleCheck = requireAdmin(session);
      if (!roleCheck.success) return roleCheck;

      productService.deleteVariant(payload.variantId);
      const audit = writeAuditEvent({ action: 'product_delete', entityType: 'variant', entityId: payload.variantId, actorUserId: session.user.id });

      return addAuditWarning({ success: true }, audit);
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

      const permCheck = requirePermission(session, 'stockAdjust');
      if (!permCheck.success) return permCheck;

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

      const audit = writeAuditEvent({
        action: 'stock_adjust', entityType: 'variant', entityId: payload.variantId,
        amount: payload.quantity, actorUserId: session.user.id,
        details: { transactionType: payload.transactionType || 'adjustment', notes: payload.notes },
      });
      return addAuditWarning({ success: true, data: summary }, audit);
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
      const permCheck = requirePermission(session, 'lowStock');
      if (!permCheck.success) return permCheck;
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
