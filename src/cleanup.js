const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { ps, psJsonArray } = require('./util');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const WIN = process.env.SystemRoot || 'C:\\Windows';
const SYS = process.env.SystemDrive || 'C:';

/** Total size of a folder. Unreadable parts are skipped and reported. */
async function folderSize(p) {
  let size = 0, files = 0, denied = false;
  const stack = [p];
  let rootOk = true;
  while (stack.length) {
    const batch = stack.splice(0, 32);
    await Promise.all(batch.map(async (dir) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (e) { if (dir === p) rootOk = e.code !== 'ENOENT' ? 'denied' : false; denied = true; return; }
      await Promise.all(entries.map(async (e) => {
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) return;
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) {
          try { size += (await fsp.lstat(full)).size; files++; } catch { /* locked or gone */ }
        }
      }));
    }));
  }
  return { size, files, exists: rootOk !== false, denied: rootOk === 'denied' || denied };
}

const DAY = 24 * 3600 * 1000;

/** Delete what's inside a folder (not the folder itself). Files in use are skipped. */
async function emptyFolder(p, olderThanMs = 0) {
  let removed = 0, skipped = 0;
  let entries;
  try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return { removed, skipped: 1 }; }
  const cutoff = Date.now() - olderThanMs;
  for (const e of entries) {
    const full = path.join(p, e.name);
    try {
      if (olderThanMs) {
        const st = await fsp.lstat(full);
        if (st.mtimeMs > cutoff) { skipped++; continue; }
      }
      await fsp.rm(full, { recursive: true, force: true, maxRetries: 0 });
      removed++;
    } catch {
      skipped++;
    }
  }
  return { removed, skipped };
}

let sid = null;
async function userSid() {
  if (sid) return sid;
  const out = await ps('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value', 8000);
  sid = out ? out.trim() : null;
  return sid;
}

async function fixedDrives() {
  const out = await ps("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID | ConvertTo-Json -Compress", 8000);
  const list = psJsonArray(out).filter((x) => typeof x === 'string');
  return list.length ? list : [SYS];
}

/**
 * Every place we know how to measure. `clear` items are caches Windows or apps rebuild on their own,
 * so emptying them is safe. `review` items hold your own files, so we only point you there.
 */
function definitions() {
  return [
    {
      id: 'recycle', title: 'Recycle Bin', kind: 'clear',
      why: 'Files you deleted earlier still take up space until the Recycle Bin is emptied.',
      action: 'Empty Recycle Bin', warn: 'Everything in the Recycle Bin will be deleted for good.',
    },
    {
      id: 'user-temp', title: 'Your temporary files', kind: 'clear', paths: [os.tmpdir()], olderThan: DAY,
      why: 'Apps and installers leave scratch files here. Files from the last 24 hours are kept in case an app still needs them.',
      action: 'Clear temporary files', warn: 'Temporary files older than a day will be deleted. Files that are in use are skipped.',
    },
    {
      id: 'win-temp', title: 'Windows temporary files', kind: 'clear', paths: [path.join(WIN, 'Temp')], olderThan: DAY,
      why: 'Scratch space used by Windows and system installers.',
      action: 'Clear Windows temporary files', warn: 'Temporary files older than a day will be deleted. Some need administrator rights and will be skipped.',
    },
    {
      id: 'shader', title: 'Graphics shader caches', kind: 'clear',
      paths: [path.join(LOCAL, 'NVIDIA', 'DXCache'), path.join(LOCAL, 'NVIDIA', 'GLCache'), path.join(LOCAL, 'D3DSCache'), path.join(LOCAL, 'AMD', 'DxCache'), path.join(LOCAL, 'Intel', 'ShaderCache')],
      why: 'Your GPU driver stores compiled shaders here. Games rebuild them, so the first launch afterwards may stutter briefly.',
      action: 'Clear shader caches', warn: 'Shader caches will be deleted. Close your games first. They are rebuilt automatically.',
    },
    {
      id: 'browser', title: 'Browser caches', kind: 'clear',
      paths: [
        path.join(LOCAL, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(LOCAL, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        path.join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        path.join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
        path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'),
      ],
      why: 'Copies of websites kept to load them faster. Your passwords, history and logins are not touched.',
      action: 'Clear browser caches', warn: 'Close your browsers first, or files in use will be skipped. Logins and history are kept.',
    },
    {
      id: 'dev', title: 'Developer package caches', kind: 'clear',
      paths: [path.join(LOCAL, 'npm-cache'), path.join(LOCAL, 'pip', 'Cache'), path.join(LOCAL, 'Yarn', 'Cache'), path.join(LOCAL, 'pnpm-cache'), path.join(os.homedir(), '.nuget', 'packages'), path.join(os.homedir(), '.gradle', 'caches')],
      why: 'Downloaded packages from npm, pip, NuGet and similar tools. They are downloaded again when a project needs them.',
      action: 'Clear package caches', warn: 'Package caches will be deleted. The next install of a project will be slower while they download again.',
    },
    {
      id: 'crash', title: 'Crash reports', kind: 'clear',
      paths: [path.join(LOCAL, 'CrashDumps'), path.join(LOCAL, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(LOCAL, 'Microsoft', 'Windows', 'WER', 'ReportQueue')],
      why: 'Memory snapshots saved when an app crashed. Only useful if you are sending them to a developer.',
      action: 'Delete crash reports', warn: 'Saved crash reports will be deleted.',
    },
    {
      id: 'downloads', title: 'Downloads folder', kind: 'review', paths: [path.join(os.homedir(), 'Downloads')],
      why: 'Installers and archives you already used often pile up here. Look through it before deleting anything.',
      action: 'Explore Downloads',
    },
    {
      id: 'winupdate', title: 'Windows Update files', kind: 'system',
      paths: [path.join(WIN, 'SoftwareDistribution', 'Download'), path.join(SYS + '\\', 'Windows.old')],
      why: 'Leftover update downloads and the previous Windows version. Windows Disk Cleanup removes them safely.',
      action: 'Open Disk Cleanup', tool: 'cleanmgr',
    },
    {
      id: 'hiber', title: 'Hibernation and page file', kind: 'info',
      why: 'Windows reserves these for sleep and memory overflow. They can only be resized in Windows settings, so we just show you how big they are.',
    },
  ];
}

async function measure(def) {
  if (def.id === 'recycle') {
    const [s, drives] = await Promise.all([userSid(), fixedDrives()]);
    if (!s) return { size: null, note: "Couldn't read the Recycle Bin." };
    const parts = await Promise.all(drives.map((d) => folderSize(path.join(d + '\\', '$Recycle.Bin', s))));
    return { size: parts.reduce((a, b) => a + b.size, 0), files: parts.reduce((a, b) => a + b.files, 0) };
  }
  if (def.id === 'hiber') {
    const out = await ps(`Get-ChildItem -Path '${SYS}\\' -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -in 'hiberfil.sys','pagefile.sys','swapfile.sys' } | Select-Object Name, Length | ConvertTo-Json -Compress`, 8000);
    const files = psJsonArray(out);
    return { size: files.reduce((a, f) => a + (f.Length || 0), 0), parts: files.map((f) => ({ name: f.Name, size: f.Length })) };
  }
  const parts = await Promise.all(def.paths.map(async (p) => ({ path: p, ...(await folderSize(p)) })));
  const found = parts.filter((p) => p.exists);
  return {
    size: found.reduce((a, b) => a + b.size, 0),
    files: found.reduce((a, b) => a + b.files, 0),
    denied: found.some((p) => p.denied),
    parts: found.map((p) => ({ path: p.path, size: p.size })),
  };
}

async function listAll(onItem) {
  const defs = definitions();
  await Promise.all(defs.map(async (d) => {
    const m = await measure(d).catch(() => ({ size: null }));
    onItem({ ...publicDef(d), ...m });
  }));
}

function publicDef(d) {
  const { olderThan, ...rest } = d;
  return rest;
}

/** Only ids from the fixed list above can be cleared. The UI never sends a path to delete. */
async function clear(id) {
  const def = definitions().find((d) => d.id === id);
  if (!def || def.kind !== 'clear') throw new Error('That item cannot be cleared automatically.');
  const before = await measure(def);
  if (id === 'recycle') {
    await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', 120000);
  } else {
    for (const p of def.paths) await emptyFolder(p, def.olderThan || 0);
  }
  const after = await measure(def);
  return {
    ...publicDef(def), ...after,
    freed: Math.max(0, (before.size || 0) - (after.size || 0)),
  };
}

module.exports = { listAll, clear, definitions };
