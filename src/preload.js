import { contextBridge, ipcRenderer } from 'electron';

const validChannels = [
  'auth:getRegistrationContext',
  'auth:getSecurityQuestions',
  'auth:getUsers',
  'auth:requestAdminRecovery',
  'auth:login',
  'auth:register',
  'auth:logout',
  'auth:getRecoveryInfo',
  'auth:resetAdminPin',
  'auth:requestEmergencyReset',
  'auth:confirmEmergencyReset',
  'auth:setSecurityQuestions',
  'auth:getRecoveryStatus',
  'user:getAll',
  'user:create',
  'user:delete',
  'user:unlock',
  'user:resetPin',
  'category:getAll',
  'category:create',
  'category:delete',
  'product:getAll',
  'product:getById',
  'product:create',
  'product:update',
  'product:delete',
  'product:lookupBarcode',
  'inventory:adjustStock',
  'inventory:getSummary',
  'inventory:getHistory',
  'inventory:getLowStock',
  'inventory:disableLowStockAlert',
  'sale:create',
  'sale:getById',
  'sale:getByInvoice',
  'sale:listRecent',
  'sale:void',
  'sale:getReceipt',
  'settings:get',
  'settings:update',
  'report:dailySummary',
  'report:topProducts',
  'report:salesByDay',
  'backup:create',
  'backup:list',
  'backup:listDrives',
  'backup:restore',
];

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, data) => {
    if (!validChannels.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, data);
  },
});
