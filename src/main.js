import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { getDb } from './main/database/db.js';

// Exit during Windows installer events.
if (started) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Secure bridge between the main and renderer processes.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load Vite dev server in development, otherwise load the built app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Open DevTools while developing.
  mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  // Initialize the SQLite database on startup.
  getDb();

  createWindow();

  // Recreate a window when the dock icon is clicked (macOS).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Keep the app running on macOS until the user quits explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});