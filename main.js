// Electron desktop shell for StoryDeck (title configurable via BOARD_TITLE).
// Runs the same local SQLite server inside Electron's own Node runtime
// (Electron 43 → Node 24, which ships node:sqlite), then loads the board in a
// native window. Fully on-device: the server only binds 127.0.0.1.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import * as bundledServer from './src/server.js';
import * as bundledDb from './src/db.js';
import * as bundledKeystore from './src/ai/keystore.js';
import { chooseContentSource, markBootOk, downloadUpdate, readManifest } from './src/updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// These default to the BUNDLED content; ensureServer() may swap them for a newer
// content overlay downloaded from GitHub (see src/updater.js). Keeping them
// mutable lets a hot update change the frontend/server without a reinstall.
let createApp = bundledServer.createApp;
let HOST = bundledServer.HOST;
let PORT = bundledServer.PORT;
let backup = bundledDb.backup;
let applyConfigToEnv = bundledKeystore.applyConfigToEnv;

let mainWindow = null;
let httpServer = null;
let serverReady = false;
let activePort = PORT; // the port the server actually bound (may differ from PORT)
let userDataDir = null; // resolved at startup; used for overlay meta + updates
let bundledContentVersion = 0;

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

// Load web/ + src/ from a downloaded overlay when one is newer than the bundle;
// otherwise keep the bundled defaults. Any failure falls back to bundled so a
// bad overlay can never stop the app from starting.
async function selectContentSource() {
  userDataDir = app.getPath('userData');
  // The binary's version never changes via hot update, so always expose the
  // BUNDLED package.json version (an overlay's package.json is just an ESM stub).
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    process.env.STORYDECK_APP_VERSION = pkg.version || '0.0.0';
  } catch { /* fall back to version.js defaults */ }

  bundledContentVersion = readManifest(join(__dirname, 'content-manifest.json'))?.contentVersion ?? 0;
  process.env.STORYDECK_CONTENT_SOURCE = 'bundled';
  const source = chooseContentSource({
    bundledDir: __dirname,
    userDataDir,
    bundledVersion: bundledContentVersion,
  });
  if (!source.fromOverlay) {
    console.log(`running content v${bundledContentVersion} (bundled) · app v${process.env.STORYDECK_APP_VERSION}`);
    return;
  }
  try {
    const s = await import(pathToFileURL(join(source.dir, 'src', 'server.js')).href);
    const d = await import(pathToFileURL(join(source.dir, 'src', 'db.js')).href);
    const k = await import(pathToFileURL(join(source.dir, 'src', 'ai', 'keystore.js')).href);
    createApp = s.createApp; HOST = s.HOST; PORT = s.PORT;
    backup = d.backup; applyConfigToEnv = k.applyConfigToEnv;
    process.env.WEB_OVERLAY_DIR = join(source.dir, 'web');
    process.env.STORYDECK_CONTENT_SOURCE = 'overlay';
    console.log(`content overlay active: v${source.version} (updated from bundled v${bundledContentVersion}) · app v${process.env.STORYDECK_APP_VERSION}`);
  } catch (err) {
    console.error('content overlay failed to load, using bundled:', err.message);
    createApp = bundledServer.createApp; HOST = bundledServer.HOST; PORT = bundledServer.PORT;
    backup = bundledDb.backup; applyConfigToEnv = bundledKeystore.applyConfigToEnv;
    delete process.env.WEB_OVERLAY_DIR;
    process.env.STORYDECK_CONTENT_SOURCE = 'bundled';
  }
}

async function ensureServer() {
  if (serverReady) return;
  await selectContentSource();
  applyConfigToEnv(); // load a first-run stored API key (from userData) if present
  const dbPath = resolveDbPath();
  const { server, db } = createApp(dbPath);
  httpServer = server;
  try { backup(db); } catch (e) { /* backups are best-effort */ }
  activePort = await listenWithFallback(server, PORT, HOST);
  serverReady = true;
}

// Non-blocking: pull any newer content from GitHub for the NEXT launch.
function scheduleUpdateCheck() {
  if (process.env.STORYDECK_NO_UPDATE === '1' || !userDataDir) return;
  setTimeout(() => {
    downloadUpdate({ userDataDir, currentVersion: bundledContentVersion })
      .then((r) => {
        if (r.updated) {
          const tag = [r.appVersion ? `app v${r.appVersion}` : null, r.commit].filter(Boolean).join(' ');
          console.log(`content update staged: content v${r.version}${tag ? ` (${tag})` : ''} — applies on next launch`);
        }
      })
      .catch(() => { /* best-effort; never disrupt the session */ });
  }, 3000);
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
  // We booted successfully → clear any overlay boot-failure counter (rollback
  // only trips after repeated failed boots), then check for the next update.
  try { markBootOk(userDataDir); } catch (e) { /* best-effort */ }
  scheduleUpdateCheck();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  httpServer?.close();
  app.quit();
});
