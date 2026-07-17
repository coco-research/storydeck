// Electron desktop shell for StoryDeck (title configurable via BOARD_TITLE).
// Runs the same local SQLite server inside Electron's own Node runtime
// (Electron 43 → Node 24, which ships node:sqlite), then loads the board in a
// native window. Fully on-device: the server only binds 127.0.0.1.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { createApp, HOST, PORT } from './src/server.js';
import { backup } from './src/db.js';
import { applyConfigToEnv } from './src/ai/keystore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let httpServer = null;
let serverReady = false;
let activePort = PORT; // the port the server actually bound (may differ from PORT)

// Choose a writable DB location. The packaged app bundle (app.asar) is READ-ONLY,
// so we must never let the DB resolve to a path inside it. `db.js` freezes its
// default path at import time, BEFORE this runs — so we pass the resolved path
// straight to createApp() instead of relying on process.env.DB_PATH.
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH; // explicit override wins
  // Treat "packaged" broadly: app.isPackaged, or running from inside an .asar.
  const packaged = app.isPackaged || __dirname.includes('.asar');
  if (packaged) return join(app.getPath('userData'), 'todo.db');
  return undefined; // dev (unpackaged): let db.js use the repo data/private dir
}

// Bind the preferred port, falling back to any free port if it's taken, so a
// stray server (or a second copy of the app) can never make us fail to launch.
function listenWithFallback(server, preferred, host) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, allowFallback) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && allowFallback) {
          tryPort(0, false); // 0 → OS picks any available port
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    };
    tryPort(preferred, true);
  });
}

async function ensureServer() {
  if (serverReady) return;
  applyConfigToEnv(); // load a first-run stored API key (from userData) if present
  const dbPath = resolveDbPath();
  const { server, db } = createApp(dbPath);
  httpServer = server;
  try { backup(db); } catch (e) { /* backups are best-effort */ }
  activePort = await listenWithFallback(server, PORT, HOST);
  serverReady = true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: (process.env.BOARD_TITLE || 'StoryDeck').trim(),
    backgroundColor: '#1d2021', // gruvbox-dark, matches the retro default (no cream flash)
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://${HOST}:${activePort}`);
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
    // Surface the failure instead of quitting silently, so a packaged app never
    // just "installs and won't open" with no explanation.
    if (process.env.BOARD_SELFTEST !== '1') {
      try {
        dialog.showErrorBox(
          'StoryDeck could not start',
          `The local board server failed to start:\n\n${err.message}\n\n` +
          `Your data is safe. If this keeps happening, please report it.`,
        );
      } catch (e) { /* dialog is best-effort */ }
    } else {
      console.log(`SELFTEST_FAIL ${err.message}`);
    }
    app.quit();
    return;
  }

  // Non-interactive self-test hook (used by the build gate).
  if (process.env.BOARD_SELFTEST === '1') {
    try {
      const res = await fetch(`http://${HOST}:${activePort}/api/state`);
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
