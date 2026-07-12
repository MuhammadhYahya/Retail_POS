import { contextBridge, ipcRenderer } from 'electron';

const validChannels = [
  'auth:getRegistrationContext',
  'auth:getSecurityQuestions',
  'auth:getUsers',
  'auth:login',
  'auth:register',
  'auth:restore-session',
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
];

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, data) => {
    if (!validChannels.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, data);
  },
});
