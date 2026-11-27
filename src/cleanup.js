// Clean up: measures the usual space hogs and clears the ones that are safe to clear.
//
// Every Cleanup item is { id, title, kind, why, action?, warn?, tool?, review?, size, files?, denied?, parts?, advice?, note? }:
//   kind 'clear'  caches Windows or apps rebuild on their own, so clearing them is safe
//        'review' your own files: we only point you there (`review` is the folder to scan)
//        'system' managed by Windows: we open the Windows tool (`tool`)
//        'info'   shown for information only
//   parts: [{ label, size }] what the size is made of
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { shell: defaultShell, asArray } = require('./shell');
const { folderSize } = require('./fs-walk');

const DAY = 24 * 3600 * 1000;

/** The folders cleanup knows about, from the environment. Tests pass their own. */
function windowsPlaces(env = process.env) {
  const home = os.homedir();
  return {
    home,
    temp: os.tmpdir(),
    local: env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    windows: env.SystemRoot || 'C:\\Windows',
    systemDrive: env.SystemDrive || 'C:',
  };
}

/**
 * Delete what's inside a folder (not the folder itself). Files in use are skipped.
 * With `olderThanMs`, only files last changed before then are deleted, at any depth; a folder is removed only once
 * it is empty, so a recently used file deep inside an old folder is kept.
 */
async function emptyFolder(p, olderThanMs = 0, now = Date.now()) {
  let removed = 0, skipped = 0;
  const cutoff = now - olderThanMs;

  async function clearIn(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { skipped++; return false; }
    let empty = true;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (olderThanMs && e.isDirectory() && !e.isSymbolicLink()) {
          // Read the folder's own age first: deleting inside it updates its timestamp.
          const old = (await fsp.lstat(full)).mtimeMs <= cutoff;
          if ((await clearIn(full)) && old) { await fsp.rmdir(full); removed++; } else empty = false;
          continue;
        }
        if (olderThanMs && (await fsp.lstat(full)).mtimeMs > cutoff) { skipped++; empty = false; continue; }
        await fsp.rm(full, { recursive: true, force: true, maxRetries: 0 });
        removed++;
      } catch {
        skipped++;
        empty = false;
      }
    }
    return empty;
  }

  await clearIn(p);
  return { removed, skipped };
}

function createCleanup({ shell = defaultShell, places = windowsPlaces(), now = Date.now } = {}) {
  const { home, temp, local, windows: WIN, systemDrive: SYS } = places;

  let sid = null;
  async function userSid() {
    if (sid) return sid;
    const r = await shell.ps('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value', 8000);
    sid = r.ok ? r.stdout.trim() || null : null;
    return sid;
  }
  async function fixedDrives() {
    const r = await shell.psJson("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID | ConvertTo-Json -Compress", 8000);
    const list = r.ok ? asArray(r.data).filter((x) => typeof x === 'string') : [];
    return list.length ? list : [SYS];
  }

  /** Measure a list of labelled folders. Folders that don't exist are left out. */
  async function measureFolders(folders) {
    const parts = await Promise.all(folders.map(async (f) => ({ ...f, ...(await folderSize(f.path)) })));
    const found = parts.filter((p) => p.exists);
    return {
      size: found.reduce((a, b) => a + b.size, 0),
      files: found.reduce((a, b) => a + b.files, 0),
      denied: found.some((p) => p.denied),
      parts: found.map((p) => ({ label: p.label, size: p.size })),
      found: found.map((p) => p.path),
    };
  }
  const folders = (list) => ({
    measure: () => measureFolders(list),
    clear: async (olderThan) => {
      let removed = 0, skipped = 0;
      for (const f of list) { const r = await emptyFolder(f.path, olderThan, now()); removed += r.removed; skipped += r.skipped; }
      return { removed, skipped };
    },
  });

  const L = (label, ...segs) => ({ label, path: path.join(...segs) });

  const ITEMS = [
    {
      id: 'recycle', title: 'Recycle Bin', kind: 'clear',
      why: 'Files you deleted earlier still take up space until the Recycle Bin is emptied.',
      action: 'Empty Recycle Bin', warn: 'Everything in the Recycle Bin will be deleted for good.',
      async measure() {
        const [s, drives] = await Promise.all([userSid(), fixedDrives()]);
        if (!s) return { size: null, note: "Couldn't read the Recycle Bin." };
        return measureFolders(drives.map((d) => L(`Drive ${d}`, d + '\\', '$Recycle.Bin', s)));
      },
      async clear() {
        const r = await shell.ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', 120000);
        return r.ok ? { removed: 1, skipped: 0 } : { removed: 0, skipped: 1 };
      },
    },
    {
      id: 'user-temp', title: 'Your temporary files', kind: 'clear', olderThan: DAY,
      why: 'Apps and installers leave scratch files here. Files from the last 24 hours are kept in case an app still needs them.',
      action: 'Clear temporary files', warn: 'Temporary files older than a day will be deleted. Files that are in use are skipped.',
      ...folders([L('Your temporary files', temp)]),
    },
    {
      id: 'win-temp', title: 'Windows temporary files', kind: 'clear', olderThan: DAY,
      why: 'Scratch space used by Windows and system installers.',
      action: 'Clear Windows temporary files', warn: 'Temporary files older than a day will be deleted. Some need administrator rights and will be skipped.',
      ...folders([L('Windows temporary files', WIN, 'Temp')]),
    },
    {
      id: 'shader', title: 'Graphics shader caches', kind: 'clear',
      why: 'Your GPU driver stores compiled shaders here. Games rebuild them, so the first launch afterwards may stutter briefly.',
      action: 'Clear shader caches', warn: 'Shader caches will be deleted. Close your games first. They are rebuilt automatically.',
      ...folders([
        L('NVIDIA', local, 'NVIDIA', 'DXCache'), L('NVIDIA', local, 'NVIDIA', 'GLCache'), L('DirectX', local, 'D3DSCache'),
        L('AMD', local, 'AMD', 'DxCache'), L('Intel', local, 'Intel', 'ShaderCache'),
      ]),
    },
    {
      id: 'browser', title: 'Browser caches', kind: 'clear',
      why: 'Copies of websites kept to load them faster. Your passwords, history and logins are not touched.',
      action: 'Clear browser caches', warn: 'Close your browsers first, or files in use will be skipped. Logins and history are kept.',
      ...folders([
        L('Chrome', local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        L('Chrome', local, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        L('Edge', local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        L('Edge', local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
        L('Brave', local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'),
      ]),
    },
    {
      id: 'dev', title: 'Developer package caches', kind: 'clear',
      why: 'Downloaded packages from npm, pip, NuGet and similar tools. They are downloaded again when a project needs them.',
      action: 'Clear package caches', warn: 'Package caches will be deleted. The next install of a project will be slower while they download again.',
      ...folders([
        L('npm', local, 'npm-cache'), L('pip', local, 'pip', 'Cache'), L('Yarn', local, 'Yarn', 'Cache'), L('pnpm', local, 'pnpm-cache'),
        L('NuGet', home, '.nuget', 'packages'), L('Gradle', home, '.gradle', 'caches'),
      ]),
    },
    {
      id: 'crash', title: 'Crash reports', kind: 'clear',
      why: 'Memory snapshots saved when an app crashed. Only useful if you are sending them to a developer.',
      action: 'Delete crash reports', warn: 'Saved crash reports will be deleted.',
      ...folders([
        L('App crash dumps', local, 'CrashDumps'),
        L('Windows error reports', local, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
        L('Windows error reports', local, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      ]),
    },
    {
      id: 'downloads', title: 'Downloads folder', kind: 'review',
      why: 'Installers and archives you already used often pile up here. Look through it before deleting anything.',
      action: 'Explore Downloads',
      async measure() {
        const m = await measureFolders([L('Downloads', home, 'Downloads')]);
        return { ...m, review: m.found[0] || null };
      },
    },
    {
      id: 'winupdate', title: 'Windows Update files', kind: 'system', tool: 'cleanmgr',
      why: 'Leftover update downloads and the previous Windows version. Windows Disk Cleanup removes them safely.',
      action: 'Open Disk Cleanup',
      ...folders([L('Update downloads', WIN, 'SoftwareDistribution', 'Download'), L('Previous Windows', SYS + '\\', 'Windows.old')]),
    },
    {
      id: 'hiber', title: 'Hibernation and page file', kind: 'info',
      why: 'Windows reserves these for sleep and memory overflow. They can only be resized in Windows settings, so we just show you how big they are.',
      async measure() {
        const r = await shell.psJson(`Get-ChildItem -Path '${SYS}\\' -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -in 'hiberfil.sys','pagefile.sys','swapfile.sys' } | Select-Object Name, Length | ConvertTo-Json -Compress`, 8000);
        const files = r.ok ? asArray(r.data) : [];
        const hiber = files.find((f) => /hiberfil/i.test(f.Name));
        return {
          size: files.reduce((a, f) => a + (f.Length || 0), 0),
          parts: files.map((f) => ({ label: f.Name, size: f.Length })),
          // Hibernation can be switched off; the page file shouldn't be.
          advice: hiber && hiber.Length > 1024 ** 3
            ? { text: 'If you never use hibernation, running “powercfg /h off” in an administrator terminal gives back this space (it also turns off Fast Startup).', size: hiber.Length }
            : null,
        };
      },
    },
  ];

  const describe = ({ measure, clear, olderThan, ...rest }) => rest;

  async function measureItem(item) {
    const m = await item.measure().catch(() => ({ size: null }));
    const { found, ...shown } = m;
    return { ...describe(item), ...shown };
  }

  /** Measures every item, calling onItem as each one finishes. Resolves once all are measured. */
  async function listAll(onItem) {
    await Promise.all(ITEMS.map(async (item) => onItem(await measureItem(item))));
  }

  /** Clears one 'clear' item by id. The UI never sends a path to delete. Returns the item re-measured plus what happened. */
  async function clear(id) {
    const item = ITEMS.find((d) => d.id === id);
    if (!item || item.kind !== 'clear') throw new Error('That item cannot be cleared automatically.');
    const before = await item.measure();
    const { removed, skipped } = await item.clear(item.olderThan || 0);
    const after = await measureItem(item);
    return { ...after, freed: Math.max(0, (before.size || 0) - (after.size || 0)), removed, skipped };
  }

  return { listAll, clear };
}

module.exports = { createCleanup, emptyFolder, windowsPlaces, ...createCleanup() };
