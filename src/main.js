import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { getDb, closeDb } from './main/database/db.js';
import { migrateFromPosly } from './main/lib/migrateFromPosly.js';
import { ensureJwtSecret } from './main/lib/jwtSecret.js';
import { registerAuthHandlers } from './main/ipc/authHandlers.js';
import { registerUserHandlers } from './main/ipc/userHandlers.js';
import { registerProductHandlers } from './main/ipc/productHandlers.js';
import { registerSaleHandlers } from './main/ipc/saleHandlers.js';
import {
  registerSettingsHandlers,
  registerReportHandlers,
} from './main/ipc/settingsHandlers.js';
import { registerBackupHandlers, registerDialogHandlers } from './main/ipc/backupHandlers.js';
import { registerImportExportHandlers } from './main/ipc/importExportHandlers.js';
import { registerCashSessionHandlers } from './main/ipc/cashSessionHandlers.js';
import { registerPurchaseHandlers } from './main/ipc/purchaseHandlers.js';
import { registerReturnHandlers } from './main/ipc/returnHandlers.js';
import { registerExpenseHandlers } from './main/ipc/expenseHandlers.js';
import { registerPrinterHandlers } from './main/ipc/printerHandlers.js';
import backupScheduleService from './main/services/backup/backupScheduleService.js';
import { ensureReservedDataDirs } from './main/services/backup/dataRootRegistry.js';

if (started) {
  app.quit();
}

let mainWindow;

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', '.vite', 'renderer', 'main_window', 'logo.ico');
  }
  return path.join(app.getAppPath(), 'src', 'renderer', 'public', 'logo.ico');
}

function clearSessionStore() {
  try {
    const db = getDb();
    db.prepare('DELETE FROM sessions').run();
  } catch (error) {
    console.error('[main] Failed to clear sessions on shutdown:', error.message);
  }
}

function applyProductionMenu() {
  if (!app.isPackaged) return;
  // Hide default View/DevTools menu in packaged builds
  Menu.setApplicationMenu(null);
}

function createWindow() {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: app.isPackaged,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    clearSessionStore();
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

app.on('before-quit', () => {
  clearSessionStore();
  backupScheduleService.stopScheduler();
  try {
    closeDb();
  } catch {
    // ignore
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  migrateFromPosly();
  getDb();
  ensureJwtSecret();
  ensureReservedDataDirs();
  clearSessionStore();
  applyProductionMenu();
  registerAuthHandlers();
  registerUserHandlers();
  registerProductHandlers();
  registerSaleHandlers();
  registerSettingsHandlers();
  registerReportHandlers();
  registerBackupHandlers();
  registerDialogHandlers();
  registerImportExportHandlers();
  registerCashSessionHandlers();
  registerPurchaseHandlers();
  registerReturnHandlers();
  registerExpenseHandlers();
  registerPrinterHandlers();
  createWindow();

  // Missed scheduled backups + recurring timer
  try {
    await backupScheduleService.checkMissedAndRun();
  } catch (error) {
    console.error('[main] Missed backup check failed:', error.message);
  }
  backupScheduleService.startScheduler();
});
