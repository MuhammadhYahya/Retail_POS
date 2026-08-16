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
  'user:updatePermissions',
  'user:delete',
  'user:unlock',
  'user:resetPin',
  'category:getAll',
  'category:create',
  'category:update',
  'category:delete',
  'product:getAll',
  'product:create',
  'product:update',
  'product:delete',
  'product:deleteVariant',
  'product:lookupBarcode',
  'inventory:adjustStock',
  'inventory:getHistory',
  'inventory:getLowStock',
  'inventory:disableLowStockAlert',
  'sale:create',
  'sale:listTodayCashier',
  'sale:void',
  'sale:getReceipt',
  'settings:get',
  'settings:update',
  'report:dailySummary',
  'report:topProducts',
  'report:salesByDay',
  'report:recentSales',
  'backup:create',
  'backup:cancel',
  'backup:list',
  'backup:verify',
  'backup:preview',
  'backup:restore',
  'backup:delete',
  'backup:openFolder',
  'backup:getSettings',
  'backup:updateSettings',
  'dialog:showOpen',
  'dialog:showSave',
  'export:entities',
  'export:run',
  'import:previewMapped',
  'import:analyze',
  'import:template',
  'import:run',
  'import:history',
  'import:errorReport',
  'cashSession:getOpen',
  'cashSession:open',
  'cashSession:xReport',
  'cashSession:close',
  'supplier:list',
  'supplier:create',
  'purchase:list',
  'purchase:create',
  'purchase:post',
  'return:lookupSale',
  'return:create',
  'return:list',
  'return:get',
  'expense:categories',
  'expense:list',
  'expense:create',
  'expense:delete',
  'printer:printReceipt',
  'printer:printReturnReceipt',
  'printer:testPrint',
  'printer:testReturnReceipt',
  'printer:list',
  'audit:list',
  'audit:listVoidedSales',
  'audit:listFailures',
  'audit:getFailureSummary',
  'audit:retryFailures',
];

const validReceiveChannels = ['backup:progress', 'import:progress'];

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, data) => {
    if (!validChannels.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, data);
  },
  on: (channel, callback) => {
    if (!validReceiveChannels.includes(channel)) {
      throw new Error(`Blocked IPC receive channel: ${channel}`);
    }
    const subscription = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  off: (channel, callback) => {
    if (!validReceiveChannels.includes(channel)) {
      throw new Error(`Blocked IPC receive channel: ${channel}`);
    }
    ipcRenderer.removeListener(channel, callback);
  },
});
