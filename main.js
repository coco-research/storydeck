// Electron desktop shell for Rijul's Stories.
// Runs the same local SQLite server inside Electron's own Node runtime
// (Electron 43 → Node 24, which ships node:sqlite), then loads the board in a
// native window. Fully on-device: the server only binds 127.0.0.1.

import { app, BrowserWindow, shell } from 'electron';
import { createApp, HOST, PORT } from './src/server.js';
import { backup } from './src/db.js';

let mainWindow = null;
let httpServer = null;
let serverReady = false;

async function ensureServer() {
  if (serverReady) return;
  const { server, db } = createApp();
  httpServer = server;
  try { backup(db); } catch (e) { /* backups are best-effort */ }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });
  serverReady = true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: "Rijul's Stories",
    backgroundColor: '#f0eee6',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://${HOST}:${PORT}`);
  // Open external links (e.g. GitHub/Instagram in notes) in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    await ensureServer();
  } catch (err) {
    console.error('Failed to start local board server:', err.message);
    app.quit();
    return;
  }

  // Non-interactive self-test hook (used by the build gate).
  if (process.env.BOARD_SELFTEST === '1') {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/api/state`);
      const data = await res.json();
      console.log(`SELFTEST_OK stories=${data.stories.length} done=${data.stories.filter((s) => s.status === 'done').length}`);
    } catch (err) {
      console.log(`SELFTEST_FAIL ${err.message}`);
    }
    httpServer?.close();
    app.quit();
    return;
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  httpServer?.close();
  app.quit();
});
