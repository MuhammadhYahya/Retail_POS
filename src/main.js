import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { getDb } from './main/database/db.js';
import { registerAuthHandlers } from './main/ipc/authHandlers.js';
import { registerUserHandlers } from './main/ipc/userHandlers.js';
import { registerProductHandlers } from './main/ipc/productHandlers.js';
import { registerSaleHandlers } from './main/ipc/saleHandlers.js';
import {
  registerSettingsHandlers,
  registerReportHandlers,
  registerBackupHandlers,
} from './main/ipc/settingsHandlers.js';

if (started) {
  app.quit();
}

let mainWindow;

function clearSessionStore() {
  try {
    const db = getDb();
    db.prepare('DELETE FROM sessions').run();
  } catch (error) {
    console.error('[main] Failed to clear sessions on shutdown:', error.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

app.whenReady().then(() => {
  getDb();
  registerAuthHandlers();
  registerUserHandlers();
  registerProductHandlers();
  registerSaleHandlers();
  registerSettingsHandlers();
  registerReportHandlers();
  registerBackupHandlers();
  createWindow();
});
