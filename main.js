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
const bluetooth = require('./src/bluetooth');
const { createHealth } = require('./src/health');
const { createDiskScan } = require('./src/scan');
const { createTrashGuard, windowsProtection } = require('./src/scan/trash-guard');
const { shell: winShell } = require('./src/shell');
const { registerApi } = require('./src/ipc');

// HD_DEMO=1 runs on a made-up PC (src/demo.js), with its own profile so no real history shows up.
const demo = process.env.HD_DEMO ? require('./src/demo').createDemo() : null;
if (demo) app.setPath('userData', path.join(app.getPath('temp'), 'hardware-dashboard-demo'));

app.setAppUserModelId('com.hardwaredashboard.app');
// One window only: launching the shortcut again brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

let win = null;

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

const health = createHealth(demo ? { probes: demo.probes } : {});
const scan = createDiskScan({
  blockReason: createTrashGuard(windowsProtection({ home: app.getPath('home'), appData: app.getPath('appData') })),
  trashItem: (p) => shell.trashItem(p),
  getDrives: () => monitor.drives(),
  ...(demo ? demo.scan : {}),
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
const TOOLS = {
  devmgmt: ['mmc.exe', ['devmgmt.msc']],
  cleanmgr: ['cleanmgr.exe', []],
  taskmgr: ['taskmgr.exe', []],
  mdsched: ['mdsched.exe', []],
};

// ---- Everything the window can ask for (window.hw.<name>) and every event it can listen to ----
const methods = {
  staticInfo: () => monitor.getStatic(),
  live: () => monitor.getLive(),
  drives: () => monitor.drives(),
  drivers: () => drivers.list(),
  netInfo: () => network.info(),
  netStatus: () => network.status(),
  speedTest: () => network.speedTest((p) => emit('speedProgress', p)),
  bluetooth: (force) => bluetooth.info(Boolean(force)),

  // The battery check is only offered on PCs that have one.
  healthChecks: async () => {
    const { hasBattery } = await methods.staticInfo();
    return health.checks.filter((c) => c.id !== 'battery' || hasBattery);
  },
  healthRun: (id) => health.runCheck(id),
  async batteryReport() {
    const out = path.join(app.getPath('temp'), 'hardware-dashboard-battery-report.html');
    await winShell.run('powercfg', ['/batteryreport', '/output', out], 30000);
    if (!fs.existsSync(out)) throw new Error("Windows couldn't create the battery report.");
    const err = await shell.openPath(out);
    if (err) throw new Error(`The battery report was saved but couldn't be opened: ${err}`);
  },

  scanStart: (root) => scan.start(root, {
    onProgress: (s) => emit('scanProgress', s),
    onDone: (s) => emit('scanDone', s),
  }),
  scanCancel: () => scan.cancel(),
  scanChildren: (p) => scan.children(p),
  scanLargest: () => scan.largest(),
  scanTypes: () => scan.types(),
  async pickFolder() {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose a folder to scan' });
    return r.canceled ? null : r.filePaths[0];
  },
  reveal(p) {
    if (!scan.contains(p)) throw new Error('Only items found by the current scan can be shown from here.');
    shell.showItemInFolder(path.resolve(p));
  },
  trash: (p) => scan.trash(p),

  cleanupList: () => cleanup.listAll((item) => emit('cleanupItem', item)),
  cleanupClear: (id) => cleanup.clear(id),

  openLink(key) {
    if (!LINKS[key]) throw new Error(`Unknown link "${key}".`);
    return shell.openExternal(LINKS[key]);
  },
  openTool(key) {
    const t = TOOLS[key];
    if (!t) throw new Error(`Unknown tool "${key}".`);
    spawn(t[0], t[1], { detached: true, stdio: 'ignore' }).unref();
  },
  async isAdmin() {
    const r = await winShell.ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', 8000);
    return r.ok && r.stdout.trim() === 'True';
  },
  /** Resolves false when the user declined the Windows prompt; the app quits when it worked. */
  async relaunchAdmin() {
    const exe = process.execPath.replace(/'/g, "''");
    const appDir = app.getAppPath().replace(/'/g, "''");
    const args = app.isPackaged ? '' : ` -ArgumentList '"${appDir}"'`;
    const r = await winShell.ps(`try { Start-Process -FilePath '${exe}'${args} -Verb RunAs -ErrorAction Stop; 'ok' } catch { 'no' }`, 60000);
    const ok = r.ok && r.stdout.trim() === 'ok';
    if (ok) app.quit();
    return ok;
  },
};
if (demo) {
  Object.assign(methods, demo.methods, {
    speedTest: () => demo.speedTest((p) => emit('speedProgress', p)),
    cleanupList: () => demo.methods.cleanupList((item) => emit('cleanupItem', item)),
  });
}
const emit = registerApi(ipcMain, {
  getTarget: () => win && win.webContents,
  events: ['speedProgress', 'scanProgress', 'scanDone', 'cleanupItem'],
  methods,
});

// Development aid: HD_CAPTURE=<folder> saves a screenshot of every page, then quits.
// It drives the page only through window.hd (see the end of renderer/app.js).
async function captureAll(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
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
  const scanRoot = process.env.HD_CAPTURE_SCAN || (demo ? demo.scanRoot : app.getPath('documents'));
  await js(`hd.scan(${JSON.stringify(scanRoot)})`);
  await wait(2000);
  for (let i = 0; i < 600 && (await js('hd.scanRunning()')); i++) await wait(1000);
  await wait(1500);
  await shot('storage-map');
  await js("document.querySelector('[data-tab=largest]').click()");
  await wait(1000); await shot('storage-largest');
  await js("document.querySelector('[data-tab=types]').click()");
  await wait(1000); await shot('storage-types');
  for (const v of ['bluetooth', 'cleanup', 'drivers', 'network']) {
    await js(`hd.show('${v}')`);
    await wait(v === 'drivers' ? 10000 : 6000);
    // The demo's speed test is simulated and quick, so its screenshot can show a result.
    if (demo && v === 'network') { await js("document.querySelector('#speed-start').click()"); await wait(9000); }
    await shot(v);
  }
  await js("hd.show('health'); hd.checkHealth()");
  await wait(2000);
  await shot('health-running');
  for (let i = 0; i < 120 && (await js('hd.healthRunning()')); i++) await wait(1000);
  await wait(1000);
  await shot('health');
  await js("hd.show('overview')");
  await wait(2500);
  await shot('overview-after');
  app.quit();
}

app.whenReady().then(() => {
  createWindow();
  if (process.env.HD_CAPTURE) win.webContents.once('did-finish-load', () => captureAll(process.env.HD_CAPTURE));
});
app.on('window-all-closed', () => { scan.stop(); app.quit(); });
