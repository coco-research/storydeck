// Render build/icon.html to build/icon.png (1024×1024, transparent corners)
// using Electron's offscreen capture. electron-builder converts this PNG into
// platform .icns/.ico automatically. Run: npx electron tools/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadFile(join(__dirname, '..', 'build', 'icon.html'));
  await new Promise((r) => setTimeout(r, 400)); // let fonts/paint settle
  const img = await win.webContents.capturePage();
  const out = join(__dirname, '..', 'build', 'icon.png');
  writeFileSync(out, img.toPNG());
  console.log(`OK ${out}`);
  app.quit();
});
