import { ipcMain } from 'electron';
import auditService from '../services/auditService.js';
import { extractToken, requireRole, validateSession } from '../lib/sessionAuth.js';

function adminGate(payload) {
  const session = validateSession(extractToken(payload));
  if (!session.success) return session;
  const roleCheck = requireRole(session, ['admin']);
  return roleCheck.success ? session : roleCheck;
}

export function registerAuditHandlers() {
  ipcMain.handle('audit:list', async (event, payload = {}) => {
    try { const gate = adminGate(payload); if (!gate.success) return gate; return { success: true, data: auditService.list(payload) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('audit:listVoidedSales', async (event, payload = {}) => {
    try { const gate = adminGate(payload); if (!gate.success) return gate; return { success: true, data: auditService.listVoidedSales(payload) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('audit:listFailures', async (event, payload = {}) => {
    try { const gate = adminGate(payload); if (!gate.success) return gate; return { success: true, data: auditService.listFailures(payload) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('audit:getFailureSummary', async (event, payload = {}) => {
    try { const gate = adminGate(payload); if (!gate.success) return gate; return { success: true, data: auditService.failureSummary() }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('audit:retryFailures', async (event, payload = {}) => {
    try { const gate = adminGate(payload); if (!gate.success) return gate; return { success: true, data: auditService.retryFailures() }; }
    catch (err) { return { success: false, error: err.message }; }
  });
}
