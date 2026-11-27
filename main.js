// More libuv threads = more files measured in parallel during a disk scan. Must be set before any fs work.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const monitor = require('./src/monitor');
const drivers = require('./src/drivers');
const network = require('./src/network');
const cleanup = require('./src/cleanup');
const Scanner = require('./src/scanner');
const bluetooth = require('./src/bluetooth');
const health = require('./src/health');
const { ps, run } = require('./src/util');

app.setAppUserModelId('com.hardwaredashboard.app');
// One window only: launching the shortcut again brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

let win = null;
const scanner = new Scanner();

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#131d25',
    title: 'Hardware Dashboard',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#131d25', symbolColor: '#8ea2b2', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// ---- Safety rails for moving things to the Recycle Bin ----
const WIN = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
const PROTECTED = [
  WIN,
  (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase(),
  (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase(),
  (process.env.ProgramData || 'C:\\ProgramData').toLowerCase(),
];
const PROTECTED_EXACT = [
  path.dirname(app.getPath('home')).toLowerCase(), // C:\Users
  app.getPath('home').toLowerCase(),
  app.getPath('appData').toLowerCase(),
  path.join(app.getPath('home'), 'AppData').toLowerCase(),
  path.join(app.getPath('home'), 'AppData', 'Local').toLowerCase(),
];
function trashBlockReason(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'That path is not valid.';
  const r = path.resolve(p);
  const low = r.toLowerCase();
  if (path.parse(r).root.toLowerCase() === low) return 'A whole drive cannot be moved to the Recycle Bin.';
  if (!scanner.contains(r)) return 'Only items found by the current scan can be removed from here.';
  if (PROTECTED_EXACT.includes(low)) return 'This folder belongs to Windows or your user account and has to stay.';
  for (const base of PROTECTED) if (low === base || low.startsWith(base + path.sep)) {
    return 'Files under Windows, Program Files and ProgramData are managed by Windows and installers. Uninstall the app from Settings instead.';
  }
  const name = path.basename(low);
  if (['$recycle.bin', 'system volume information', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'recovery', 'boot'].includes(name)) {
    return 'This is a Windows system item and has to stay.';
  }
  return null;
}

// ---- IPC ----
ipcMain.handle('static-info', () => monitor.getStatic());
ipcMain.handle('live', () => monitor.getLive());
ipcMain.handle('drives', () => monitor.drives());
ipcMain.handle('drivers', () => drivers.list());
ipcMain.handle('net-info', () => network.info());
ipcMain.handle('net-status', () => network.status());
ipcMain.handle('speedtest', async () => {
  try {
    return { ok: true, result: await network.speedTest((p) => send('speedtest-progress', p)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('bluetooth', (_e, force) => bluetooth.info(Boolean(force)));
ipcMain.handle('health-run', (_e, id) => (health.ids.includes(id) ? health.runCheck(id) : null));
ipcMain.handle('health-ids', () => health.ids);
ipcMain.handle('battery-report', async () => {
  const out = path.join(app.getPath('temp'), 'hardware-dashboard-battery-report.html');
  await run('powercfg', ['/batteryreport', '/output', out], 30000);
  if (!fs.existsSync(out)) return { ok: false, error: "Windows couldn't create the battery report." };
  await shell.openPath(out);
  return { ok: true };
});

ipcMain.handle('scan-start', (_e, root) => {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !fs.existsSync(root)) {
    return { ok: false, error: "That folder doesn't exist." };
  }
  scanner.start(root, {
    onProgress: (s) => send('scan-progress', s),
    onDone: (s) => send('scan-done', s),
  });
  return { ok: true, root: scanner.root };
});
ipcMain.handle('scan-cancel', () => { scanner.cancel(); return true; });
ipcMain.handle('scan-children', (_e, p) => scanner.ask({ type: 'children', path: p }));
ipcMain.handle('scan-largest', () => scanner.ask({ type: 'largest', limit: 200 }));
ipcMain.handle('scan-types', () => scanner.ask({ type: 'types' }));
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose a folder to scan' });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('reveal', (_e, p) => { if (typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(p); });
ipcMain.handle('open-folder', (_e, p) => (typeof p === 'string' && path.isAbsolute(p) ? shell.openPath(p) : null));
ipcMain.handle('trash', async (_e, p) => {
  const why = trashBlockReason(p);
  if (why) return { ok: false, error: why };
  try {
    await shell.trashItem(path.resolve(p));
    await scanner.ask({ type: 'remove', path: p });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Windows couldn't move it to the Recycle Bin. It may be open in another app. (${e.message})` };
  }
});

ipcMain.handle('cleanup-list', async () => {
  await cleanup.listAll((item) => send('cleanup-item', item));
  return true;
});
ipcMain.handle('cleanup-clear', async (_e, id) => {
  try { return { ok: true, item: await cleanup.clear(id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

const LINKS = {
  'windows-update': 'ms-settings:windowsupdate',
  'optional-updates': 'ms-settings:windowsupdate-optionalupdates',
  'storage-settings': 'ms-settings:storagesense',
  'apps-settings': 'ms-settings:appsfeatures',
  'network-settings': 'ms-settings:network-status',
  'bluetooth-settings': 'ms-settings:bluetooth',
  'power-settings': 'ms-settings:powersleep',
  'nvidia-drivers': 'https://www.nvidia.com/en-us/geforce/drivers/',
  'amd-drivers': 'https://www.amd.com/en/support/download/drivers.html',
  'intel-drivers': 'https://www.intel.com/content/www/us/en/support/detect.html',
};
ipcMain.handle('open-link', (_e, key) => { if (LINKS[key]) shell.openExternal(LINKS[key]); });

const TOOLS = {
  devmgmt: ['mmc.exe', ['devmgmt.msc']],
  cleanmgr: ['cleanmgr.exe', []],
  taskmgr: ['taskmgr.exe', []],
  mdsched: ['mdsched.exe', []],
};
ipcMain.handle('open-tool', (_e, key) => {
  const t = TOOLS[key];
  if (t) spawn(t[0], t[1], { detached: true, stdio: 'ignore' }).unref();
});

ipcMain.handle('is-admin', async () => {
  const out = await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', 8000);
  return out ? out.trim() === 'True' : false;
});
ipcMain.handle('relaunch-admin', async () => {
  const exe = process.execPath.replace(/'/g, "''");
  const appDir = app.getAppPath().replace(/'/g, "''");
  const args = app.isPackaged ? '' : ` -ArgumentList '"${appDir}"'`;
  const out = await ps(`try { Start-Process -FilePath '${exe}'${args} -Verb RunAs -ErrorAction Stop; 'ok' } catch { 'no' }`, 60000);
  if (out && out.trim() === 'ok') app.quit();
  return out ? out.trim() === 'ok' : false;
});

// Development aid: HD_CAPTURE=<folder> saves a screenshot of every page, then quits.
async function captureAll(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    for (let i = 0; i < 5; i++) {
      try {
        win.show();
        fs.writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        return;
      } catch (e) {
        console.error(`capture ${name} failed: ${e.message}`);
        await wait(1000);
      }
    }
  };
  await wait(5000);
  await shot('overview');
  const scanRoot = process.env.HD_CAPTURE_SCAN || app.getPath('documents');
  await win.webContents.executeJavaScript(`storageView.start(${JSON.stringify(scanRoot)})`);
  await wait(2000);
  for (let i = 0; i < 600 && (await win.webContents.executeJavaScript('state.scan.running')); i++) await wait(1000);
  await wait(1500);
  await shot('storage-map');
  await win.webContents.executeJavaScript("document.querySelector('[data-tab=largest]').click()");
  await wait(1000); await shot('storage-largest');
  await win.webContents.executeJavaScript("document.querySelector('[data-tab=types]').click()");
  await wait(1000); await shot('storage-types');
  for (const v of ['bluetooth', 'cleanup', 'drivers', 'network']) {
    await win.webContents.executeJavaScript(`show('${v}')`);
    await wait(v === 'drivers' ? 10000 : 6000);
    await shot(v);
  }
  await win.webContents.executeJavaScript("show('health'); healthView.runAll()");
  await wait(2000);
  await shot('health-running');
  for (let i = 0; i < 90 && (await win.webContents.executeJavaScript("document.querySelectorAll('.chip.running, .chip:not(.good):not(.warn):not(.bad)').length")); i++) await wait(1000);
  await wait(1000);
  await shot('health');
  await win.webContents.executeJavaScript("show('overview')");
  await wait(2500);
  await shot('overview-after');
  app.quit();
}

app.whenReady().then(() => {
  createWindow();
  if (process.env.HD_CAPTURE) win.webContents.once('did-finish-load', () => captureAll(process.env.HD_CAPTURE));
});
app.on('window-all-closed', () => { scanner.stop(); app.quit(); });
