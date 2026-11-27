// Demo mode (HD_DEMO=1): a made-up PC for screenshots and trying the app without touching Windows.
//
// It replaces only the data sources. The health rules, the disk scan engine and the whole interface run
// unchanged: the rules get invented facts, and the scan walks an in-memory drive (src/mem-fs.js).
// Every value here is fictional and shaped like what the real module returns.
const path = require('path');
const { memFs } = require('./mem-fs');
const { inProcessSpawn } = require('./scan/in-process');

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const DAY = 24 * 3600 * 1000;

const GPU = 'NVIDIA GeForce RTX 4070 SUPER';
const DRIVES = [
  { mount: 'C:', type: 'NTFS', size: 2 * TB, used: 1.38 * TB },
  { mount: 'D:', type: 'NTFS', size: 4 * TB, used: 3.58 * TB },
].map((d) => ({ ...d, free: d.size - d.used }));

const STATIC = {
  hostname: 'DEMO-PC',
  system: { manufacturer: 'Example Systems', model: 'Studio Tower' },
  os: { distro: 'Microsoft Windows 11 Pro', release: '10.0.26100', build: '26100', arch: 'x64' },
  cpu: { brand: 'AMD Ryzen 7 7800X3D', cores: 8, threads: 16, baseSpeed: 4.2, maxSpeed: 5.0 },
  memory: [1, 2].map(() => ({ size: 16 * GB, type: 'DDR5', clock: 6000, maker: 'Example Memory' })),
  disks: [
    { name: 'Example NVMe SSD 2TB', type: 'SSD', size: 2 * TB, iface: 'NVMe', smart: 'Ok' },
    { name: 'Example HDD 4TB', type: 'HD', size: 4 * TB, iface: 'SATA', smart: 'Ok' },
  ],
  gpus: [{ model: GPU, vendor: 'NVIDIA', vram: 12 * GB, driver: '566.36', live: true }],
  hasBattery: false,
};

/** A smooth, repeatable wobble so the live charts move like real readings. */
const wave = (t, period, phase = 0) => Math.sin((t / period) * 2 * Math.PI + phase);
const noise = (t, k) => {
  const x = Math.sin(t * 0.0137 + k * 91.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function live(t) {
  const load = clamp(24 + 14 * wave(t, 21000) + 10 * noise(t, 1), 3, 97);
  const cores = Array.from({ length: 16 }, (_, i) => clamp(load + 22 * wave(t, 7000 + i * 900, i) + 12 * noise(t, i + 2), 1, 100));
  const memUsed = (13.8 + 1.2 * wave(t, 40000)) * GB;
  return {
    t,
    uptime: 3 * 86400 + 5 * 3600 + (t / 1000) % 3600,
    cpu: { load, cores, speed: Math.round((4.6 + 0.3 * wave(t, 9000)) * 100) / 100, temp: Math.round(58 + 6 * wave(t, 26000) + 2 * noise(t, 3)) },
    mem: { total: 32 * GB, used: memUsed, available: 32 * GB - memUsed, percent: (memUsed / (32 * GB)) * 100 },
    gpus: [{
      name: GPU,
      // nvidia-smi reports whole numbers, and power to two decimals.
      util: Math.round(clamp(38 + 30 * wave(t, 17000, 1) + 10 * noise(t, 4), 0, 100)),
      vramUsed: Math.round((5.1 + 0.6 * wave(t, 30000)) * GB),
      vramTotal: 12 * GB,
      temp: Math.round(54 + 7 * wave(t, 23000, 1)),
      power: Math.round((120 + 60 * wave(t, 17000, 1)) * 100) / 100,
      clock: Math.round(2475 + 60 * wave(t, 8000)),
      fan: Math.round(38 + 8 * wave(t, 23000, 1)),
      driver: '566.36',
    }],
    drives: DRIVES,
    diskTemps: [{ name: 'Example NVMe SSD 2TB', temp: 41 }, { name: 'Example HDD 4TB', temp: 36 }],
    net: {
      rx: Math.max(0, 2.4e6 + 2.0e6 * wave(t, 12000) + 0.8e6 * noise(t, 5)),
      tx: Math.max(0, 1.6e5 + 1.0e5 * wave(t, 15000, 2)),
    },
    battery: null,
  };
}

// ---- Drivers ----
const drv = (name, cls, provider, version, date, extra = {}) => ({
  name, cls, maker: provider, provider, version, date, signed: true, id: `DEMO\\${cls}\\${name.replace(/\W+/g, '_').toUpperCase()}`, ...extra,
});
const DRIVERS = [
  drv(GPU, 'DISPLAY', 'NVIDIA', '32.0.15.6636', '2026-10-02'),
  drv('Intel(R) Wi-Fi 6E AX211 160MHz', 'NET', 'Intel', '23.60.0.10', '2026-06-14'),
  drv('Realtek PCIe 2.5GbE Family Controller', 'NET', 'Realtek', '10.68.815.2024', '2025-08-15'),
  drv('Realtek High Definition Audio', 'MEDIA', 'Realtek Semiconductor Corp.', '6.0.9618.1', '2025-11-20'),
  drv('NVIDIA High Definition Audio', 'MEDIA', 'NVIDIA', '1.4.2.6', '2026-05-03'),
  drv('Intel(R) Wireless Bluetooth(R)', 'BLUETOOTH', 'Intel Corporation', '23.60.0.1', '2026-06-14'),
  drv('AMD SMBus', 'SYSTEM', 'Advanced Micro Devices, Inc', '5.12.0.44', '2025-03-11'),
  drv('AMD GPIO Controller', 'SYSTEM', 'Advanced Micro Devices, Inc', '2.2.0.130', '2025-03-11'),
  drv('AMD PSP 11.0 Device', 'SECURITYDEVICES', 'Advanced Micro Devices, Inc', '5.31.0.0', '2025-04-28'),
  drv('Standard NVM Express Controller', 'SCSIADAPTER', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Standard SATA AHCI Controller', 'HDC', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Example Photo Printer Series', 'PRINTQUEUE', 'Example Printing Co.', '3.1.0.4', '2021-02-09'),
  drv('USB Composite Device', 'USB', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('USB Root Hub (USB 3.0)', 'USB', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('HID Keyboard Device', 'KEYBOARD', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('HID-compliant mouse', 'MOUSE', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Generic Monitor (27" QHD)', 'MONITOR', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Example NVMe SSD 2TB', 'DISKDRIVE', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Example HDD 4TB', 'DISKDRIVE', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('AMD Ryzen 7 7800X3D 8-Core Processor', 'PROCESSOR', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('System Firmware', 'FIRMWARE', 'Example Systems', '1.28.0.0', '2026-01-17'),
  drv('Trusted Platform Module 2.0', 'SECURITYDEVICES', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Webcam HD', 'CAMERA', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Microsoft Storage Spaces Controller', 'SCSIADAPTER', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('WAN Miniport (IP)', 'NET', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Microsoft Kernel Debug Network Adapter', 'NET', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('High precision event timer', 'SYSTEM', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('PCI Express Root Complex', 'SYSTEM', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Volume Manager', 'SYSTEM', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Generic volume', 'VOLUME', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Speakers (Realtek High Definition Audio)', 'AUDIOENDPOINT', 'Microsoft', '10.0.26100.1', '2006-06-21'),
  drv('Headphones (WH Wireless)', 'AUDIOENDPOINT', 'Microsoft', '10.0.26100.1', '2006-06-21'),
];

// ---- Network and Bluetooth ----
const NET_INFO = {
  interfaces: [
    { name: 'Intel(R) Wi-Fi 6E AX211 160MHz', type: 'wireless', medium: 'Wi-Fi', virtual: false, up: true, ip4: '192.168.1.42', ip6: 'fe80::1c2b:3d4e:5f60:7182', mac: '02:00:5e:10:00:42', speed: 1201, isDefault: true, dhcp: true },
    { name: 'Realtek PCIe 2.5GbE Family Controller', type: 'wired', medium: 'Ethernet', virtual: false, up: false, ip4: '', ip6: '', mac: '02:00:5e:10:00:43', speed: null, isDefault: false, dhcp: true },
  ],
  main: 'Intel(R) Wi-Fi 6E AX211 160MHz',
  gateway: '192.168.1.1',
  wifi: [{ ssid: 'Home Network', quality: 84, frequency: 5180, security: 'WPA3-Personal', txRate: 1201 }],
  dns: [{ iface: 'Wi-Fi', servers: ['192.168.1.1'] }],
  dnsMain: ['192.168.1.1'],
};

const BLUETOOTH = {
  radio: 'on',
  service: 'Running',
  adapters: [{ name: 'Intel(R) Wireless Bluetooth(R)', status: 'OK', problem: 0, version: '23.60.0.1', date: '2026-06-14', provider: 'Intel Corporation' }],
  devices: [
    { name: 'WH Wireless Headphones', mac: '02:1A:7B:00:00:01', lowEnergy: false, status: 'OK', connected: true, battery: 80, kind: 'audio' },
    { name: 'Wireless Mouse', mac: '02:1A:7B:00:00:02', lowEnergy: true, status: 'OK', connected: true, battery: 64, kind: 'mouse' },
    { name: 'Compact Keyboard', mac: '02:1A:7B:00:00:03', lowEnergy: true, status: 'OK', connected: false, battery: 18, kind: 'keyboard' },
    { name: 'Phone', mac: '02:1A:7B:00:00:04', lowEnergy: false, status: 'OK', connected: false, battery: null, kind: 'phone' },
  ],
};

// ---- Clean up (texts match src/cleanup.js; sizes are invented) ----
const CLEANUP = [
  { id: 'recycle', title: 'Recycle Bin', kind: 'clear', why: 'Files you deleted earlier still take up space until the Recycle Bin is emptied.', action: 'Empty Recycle Bin', warn: 'Everything in the Recycle Bin will be deleted for good.', size: 2.3 * GB, files: 214, denied: false, parts: [{ label: 'Drive C:', size: 1.9 * GB }, { label: 'Drive D:', size: 0.4 * GB }] },
  { id: 'user-temp', title: 'Your temporary files', kind: 'clear', why: 'Apps and installers leave scratch files here. Files from the last 24 hours are kept in case an app still needs them.', action: 'Clear temporary files', warn: 'Temporary files older than a day will be deleted. Files that are in use are skipped.', size: 4.7 * GB, files: 18342, denied: false, parts: [{ label: 'Your temporary files', size: 4.7 * GB }] },
  { id: 'win-temp', title: 'Windows temporary files', kind: 'clear', why: 'Scratch space used by Windows and system installers.', action: 'Clear Windows temporary files', warn: 'Temporary files older than a day will be deleted. Some need administrator rights and will be skipped.', size: 0.9 * GB, files: 1204, denied: false, parts: [{ label: 'Windows temporary files', size: 0.9 * GB }] },
  { id: 'shader', title: 'Graphics shader caches', kind: 'clear', why: 'Your GPU driver stores compiled shaders here. Games rebuild them, so the first launch afterwards may stutter briefly.', action: 'Clear shader caches', warn: 'Shader caches will be deleted. Close your games first. They are rebuilt automatically.', size: 6.1 * GB, files: 288, denied: false, parts: [{ label: 'NVIDIA', size: 5.8 * GB }, { label: 'DirectX', size: 0.3 * GB }] },
  { id: 'browser', title: 'Browser caches', kind: 'clear', why: 'Copies of websites kept to load them faster. Your passwords, history and logins are not touched.', action: 'Clear browser caches', warn: 'Close your browsers first, or files in use will be skipped. Logins and history are kept.', size: 1.8 * GB, files: 6120, denied: false, parts: [{ label: 'Chrome', size: 1.1 * GB }, { label: 'Edge', size: 0.7 * GB }] },
  { id: 'dev', title: 'Developer package caches', kind: 'clear', why: 'Downloaded packages from npm, pip, NuGet and similar tools. They are downloaded again when a project needs them.', action: 'Clear package caches', warn: 'Package caches will be deleted. The next install of a project will be slower while they download again.', size: 7.4 * GB, files: 98211, denied: false, parts: [{ label: 'npm', size: 3.2 * GB }, { label: 'pip', size: 1.1 * GB }, { label: 'NuGet', size: 3.1 * GB }] },
  { id: 'crash', title: 'Crash reports', kind: 'clear', why: 'Memory snapshots saved when an app crashed. Only useful if you are sending them to a developer.', action: 'Delete crash reports', warn: 'Saved crash reports will be deleted.', size: 0.6 * GB, files: 7, denied: false, parts: [{ label: 'App crash dumps', size: 0.6 * GB }] },
  { id: 'downloads', title: 'Downloads folder', kind: 'review', why: 'Installers and archives you already used often pile up here. Look through it before deleting anything.', action: 'Explore Downloads', size: 38.2 * GB, files: 1412, denied: false, parts: [{ label: 'Downloads', size: 38.2 * GB }], review: 'C:\\Users\\Alex\\Downloads' },
  { id: 'winupdate', title: 'Windows Update files', kind: 'system', tool: 'cleanmgr', why: 'Leftover update downloads and the previous Windows version. Windows Disk Cleanup removes them safely.', action: 'Open Disk Cleanup', size: 3.4 * GB, files: 41, denied: false, parts: [{ label: 'Update downloads', size: 3.4 * GB }] },
  { id: 'hiber', title: 'Hibernation and page file', kind: 'info', why: 'Windows reserves these for sleep and memory overflow. They can only be resized in Windows settings, so we just show you how big they are.', size: 17 * GB, parts: [{ label: 'hiberfil.sys', size: 12.8 * GB }, { label: 'pagefile.sys', size: 4 * GB }, { label: 'swapfile.sys', size: 0.2 * GB }], advice: { text: 'If you never use hibernation, running “powercfg /h off” in an administrator terminal gives back this space (it also turns off Fast Startup).', size: 12.8 * GB } },
].map((i) => ({ ...i, size: Math.round(i.size), parts: i.parts.map((p) => ({ ...p, size: Math.round(p.size) })) }));

// ---- Disk scan: an invented C: drive ----
/** Deterministic pseudo-random numbers, so every demo run shows the same drive. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function buildDrive() {
  const r = rng(7);
  const MB = 1024 ** 2;
  const files = (prefix, ext, n, min, max) => {
    const o = {};
    for (let i = 1; i <= n; i++) o[`${prefix} ${String(i).padStart(3, '0')}.${ext}`] = Math.round((min + r() * (max - min)) * MB);
    return o;
  };
  const game = (pakCount, pakMb) => ({
    Content: { Paks: files('pakchunk', 'pak', pakCount, pakMb * 0.6, pakMb * 1.4) },
    Binaries: files('module', 'dll', 40, 1, 60),
    'game.exe': 180 * MB,
  });
  const years = (ext, perYear, min, max) => {
    const o = {};
    for (const y of [2022, 2023, 2024, 2025, 2026]) o[String(y)] = files(`IMG_${y}`, ext, perYear, min, max);
    return o;
  };
  return {
    'C:\\': {
      Users: {
        Alex: {
          Videos: {
            'Holiday 2025': files('clip', 'mp4', 60, 300, 2400),
            'Camera footage': files('C', 'mp4', 120, 2000, 5000),
            'Screen recordings': files('recording', 'mkv', 45, 200, 1800),
            Exports: files('edit', 'mov', 12, 2000, 9000),
          },
          Pictures: { Camera: years('jpg', 300, 3, 9), RAW: files('DSC', 'cr3', 400, 25, 35), Screenshots: files('Screenshot', 'png', 500, 0.3, 2) },
          Music: { Library: files('track', 'flac', 600, 20, 45) },
          Documents: {
            Work: files('report', 'pdf', 120, 0.2, 8), Spreadsheets: files('budget', 'xlsx', 60, 0.05, 2),
            Projects: { website: { node_modules: files('package', 'js', 900, 0.01, 0.6), src: files('page', 'ts', 80, 0.005, 0.05) } },
          },
          Downloads: { ...files('installer', 'exe', 30, 40, 900), ...files('archive', 'zip', 40, 20, 1200), ...files('ubuntu-24.04', 'iso', 2, 5600, 6200) },
          AppData: {
            Local: { Temp: files('tmp', 'tmp', 400, 0.5, 20), 'Browser Cache': files('data', 'bin', 300, 1, 8) },
            Roaming: { 'Chat App': files('cache', 'db', 30, 5, 80) },
          },
        },
        Public: files('shared', 'jpg', 20, 1, 6),
      },
      Games: {
        'Starfield Run': game(60, 2400),
        'Open Roads 4': game(70, 2000),
        'Sky Pilot': game(80, 1500),
        'Kart Racer 7': game(40, 1900),
        'Puzzle Garden': game(4, 600),
      },
      'Program Files': {
        'Office Suite': files('component', 'dll', 200, 2, 30),
        'Photo Editor': files('plugin', 'dll', 120, 5, 60),
        'Video Studio': files('codec', 'dll', 80, 10, 120),
        'NVIDIA Corporation': files('driver', 'dll', 90, 5, 80),
      },
      Windows: { System32: files('system', 'dll', 1200, 0.5, 18), WinSxS: null, SoftwareDistribution: files('update', 'cab', 20, 40, 300) },
      'Virtual Machines': { 'Linux test.vhdx': 64 * GB, 'Windows dev.vhdx': 96 * GB },
      ProgramData: { 'Package Cache': files('setup', 'msi', 60, 5, 150) },
      'System Volume Information': null,
    },
  };
}

function lookup(tree, p) {
  const abs = path.resolve(p);
  for (const [root, node] of Object.entries(tree)) {
    const rel = path.relative(path.resolve(root), abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    let n = node;
    for (const seg of rel.split(path.sep).filter(Boolean)) {
      if (!n || typeof n !== 'object' || !(seg in n)) return undefined;
      n = n[seg];
    }
    return n;
  }
  return undefined;
}

// ---- Health check facts: the real rules turn these into findings ----
function probes(now) {
  const ago = (days) => new Date(now() - days * DAY).toISOString();
  const none = { count: 0, last: null };
  return {
    cpu: async () => ({
      loadSamples: [21, 18, 26, 23],
      top: [{ name: 'chrome', cpu: 4.1, mem: 2.1 * GB }, { name: 'Code', cpu: 2.2, mem: 1.3 * GB }, { name: 'explorer', cpu: 0.6, mem: 0.2 * GB }],
      temp: 58,
      events: { whea: none, power: { count: 1, last: ago(12) }, bsod: none },
    }),
    memory: async () => ({
      mem: { total: 32 * GB, free: 18 * GB, used: 14 * GB, active: 14 * GB, available: 18 * GB, swaptotal: 4 * GB, swapused: 0.2 * GB },
      layout: [0, 1].map((i) => ({ size: 16 * GB, bank: `BANK ${i}`, type: 'DDR5', clockSpeed: 6000, formFactor: 'DIMM', manufacturer: 'Example Memory', partNum: 'EX5-6000-16G' })),
      top: [{ name: 'chrome', mem: 2.1 * GB }, { name: 'Code', mem: 1.3 * GB }, { name: 'Discord', mem: 0.6 * GB }],
      lastTest: { id: 1201, at: ago(40) },
    }),
    gpu: async () => ({
      gpus: [{ name: GPU, util: 12, vramUsed: 3.2 * GB, vramTotal: 12 * GB, temp: 49, power: 38, clock: 1050, fan: 30, driver: '566.36', throttleMask: 0 }],
      adapters: [{ name: GPU, status: 'OK', date: '2026-10-02', version: '32.0.15.6636' }],
      events: { tdr: none, nv: none },
    }),
    storage: async () => ({
      disks: [
        { Name: 'Example NVMe SSD 2TB', Media: 'SSD', Bus: 'NVMe', Health: 'Healthy', Op: 'OK', Size: 2 * TB, Wear: 4, Temp: 41, ReadErr: 0, WriteErr: 0, Hours: 3120 },
        { Name: 'Example HDD 4TB', Media: 'HDD', Bus: 'SATA', Health: 'Healthy', Op: 'OK', Size: 4 * TB, Wear: null, Temp: 36, ReadErr: 0, WriteErr: 0, Hours: 11840 },
      ],
      volumes: DRIVES,
      events: { disk: none, ntfs: none, nvme: none },
      trim: 'on',
    }),
    battery: async () => ({ battery: { hasBattery: false }, design: null, full: null }),
    network: async () => ({
      latency: { count: 12, ok: 12, min: 9.8, median: 12.4, jitter: 1.9, loss: 0 },
      dnsOk: true,
      wifi: { quality: 84, ssid: 'Home Network', frequency: 5180 },
    }),
    bluetooth: async () => BLUETOOTH,
    drivers: async () => ({ drivers: DRIVERS, problems: [] }),
  };
}

/**
 * The demo PC. `methods` overrides the matching window.hw methods in main.js; `scan` holds what the disk scan
 * needs (`spawn`, `exists`, `getDrives`, `trashItem`); `probes` feeds the health check.
 */
function createDemo({ now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const drive = buildDrive();
  const latency = () => 12 + 3 * wave(now(), 20000) + 2 * noise(now(), 9);

  async function speedTest(onProgress) {
    onProgress({ phase: 'ping', progress: 0 });
    await wait(600);
    onProgress({ phase: 'ping', progress: 1, ping: 11.6, jitter: 1.8 });
    for (const [phase, target, steps] of [['download', 412e6, 16], ['upload', 48.5e6, 12]]) {
      for (let i = 1; i <= steps; i++) {
        await wait(250);
        onProgress({ phase, progress: i / steps, bps: target * (0.85 + 0.15 * Math.min(1, i / 4)) });
      }
    }
    return { at: now(), ping: 11.6, jitter: 1.8, download: 412e6, upload: 48.5e6, server: 'Cloudflare' };
  }

  const methods = {
    staticInfo: async () => STATIC,
    live: async () => live(now()),
    drives: async () => DRIVES,
    drivers: async () => ({ drivers: DRIVERS, problems: [] }),
    netInfo: async () => ({ ...NET_INFO, status: { online: true, dns: true, latency: latency() } }),
    netStatus: async () => ({ online: true, dns: true, latency: latency() }),
    speedTest: null, // set in main.js, which owns the progress event
    bluetooth: async () => BLUETOOTH,
    cleanupList: async (onItem) => {
      for (const item of CLEANUP) { await wait(60); onItem(item); }
    },
    cleanupClear: async (id) => {
      const item = CLEANUP.find((i) => i.id === id);
      if (!item || item.kind !== 'clear') throw new Error('That item cannot be cleared automatically.');
      return { ...item, size: 0, files: 0, parts: item.parts.map((p) => ({ ...p, size: 0 })), freed: item.size, removed: item.files, skipped: 0 };
    },
    pickFolder: async () => 'C:\\Users\\Alex',
    reveal: () => {},
    isAdmin: async () => true,
    relaunchAdmin: async () => false,
    batteryReport: async () => { throw new Error('The demo PC has no battery.'); },
  };

  return {
    methods,
    speedTest,
    probes: probes(now),
    scan: {
      spawn: inProcessSpawn({ fs: memFs(drive), progressMs: 100 }),
      exists: (p) => lookup(drive, p) !== undefined,
      getDrives: async () => DRIVES,
      trashItem: async () => {},
    },
    scanRoot: 'C:\\',
  };
}

module.exports = { createDemo };
