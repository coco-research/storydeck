// Headless screenshot capture via Electron's bundled Chromium.
// Config via env: SHOT_URL, SHOT_OUT, SHOT_VIEW (board|dash|list), SHOT_THEME (gruvbox|amber|green).
// Dismisses the boot overlay and forces the requested view/theme before capturing.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');

const URL = process.env.SHOT_URL;
const OUT = process.env.SHOT_OUT;
const VIEW = process.env.SHOT_VIEW || 'board';
const THEME = process.env.SHOT_THEME || 'gruvbox';
const W = Number(process.env.SHOT_W || 1440);
const H = Number(process.env.SHOT_H || 1000);

app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    await win.loadURL(URL);
    await sleep(1900); // let the app fetch state + render
    await win.webContents.executeJavaScript(`(function(){
      var b = document.getElementById('boot'); if (b) { b.style.display='none'; b.style.opacity='0'; }
      try { document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)}); } catch(e){}
      try { document.documentElement.setAttribute('data-view', ${JSON.stringify(VIEW)}); } catch(e){}
      try { if (typeof setTheme==='function') setTheme(${JSON.stringify(THEME)}); } catch(e){}
      try { if (typeof setView==='function') setView(${JSON.stringify(VIEW)}); } catch(e){}
      try { if (${JSON.stringify(process.env.SHOT_DENSITY || '')} && typeof setDensity==='function') setDensity(${JSON.stringify(process.env.SHOT_DENSITY || '')}); } catch(e){}
      try { if (${JSON.stringify(process.env.SHOT_AI || '')} && typeof aiAppend==='function') {
        aiAppend('user','add a story to chase finance on the OneTrust PO, urgent, CR07');
        aiAppend('ai','done — created it and flagged it urgent.');
        aiAppend('act','+ #72 [TODO] !! Chase finance on the OneTrust PO · CR07 · 1pts');
        aiAppend('user','how many stories are in progress?');
        aiAppend('ai','6 stories are in progress right now.');
      } } catch(e){}
      try { if (${JSON.stringify(process.env.SHOT_EDIT || '')} && typeof openEditStory==='function') openEditStory(Number(${JSON.stringify(process.env.SHOT_EDIT || '')})); } catch(e){}
      try { if (${JSON.stringify(process.env.SHOT_MODAL || '')}==='aikey' && typeof openAiKeyModal==='function') openAiKeyModal(); } catch(e){}
      try { if (${JSON.stringify(process.env.SHOT_MODAL || '')}==='help' && typeof openShortcutsHelp==='function') openShortcutsHelp(); } catch(e){}
      window.scrollTo(0,0);
      return document.body ? document.body.scrollHeight : 0;
    })();`);
    await sleep(450);
    const img = await win.webContents.capturePage();
    writeFileSync(OUT, img.toPNG());
    process.stdout.write('OK ' + OUT + '\n');
  } catch (err) {
    process.stderr.write('SHOT_ERR ' + (err && err.message) + '\n');
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
