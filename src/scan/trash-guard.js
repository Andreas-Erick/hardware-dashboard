// Safety rails for moving things from the disk map to the Recycle Bin.
const path = require('path');

const SYSTEM_NAMES = ['$recycle.bin', 'system volume information', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'recovery', 'boot'];

/**
 * `protectedTrees`: folders that may not be touched, nor anything inside them (Windows, Program Files…).
 * `protectedFolders`: folders that must stay themselves, though what's inside may go (C:\Users, your home…).
 * Returns blockReason(p, { root, running }) → a sentence explaining why p can't go, or null when it may.
 */
function createTrashGuard({ protectedTrees, protectedFolders }) {
  const trees = protectedTrees.map((p) => path.resolve(p).toLowerCase());
  const exact = protectedFolders.map((p) => path.resolve(p).toLowerCase());

  return function blockReason(p, { root, running }) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return 'That path is not valid.';
    const r = path.resolve(p);
    const low = r.toLowerCase();
    if (path.parse(r).root.toLowerCase() === low) return 'A whole drive cannot be moved to the Recycle Bin.';
    const rel = root ? path.relative(root, r) : '..';
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return 'Only items found by the current scan can be removed from here.';
    if (running) return 'Wait for the scan to finish before moving things to the Recycle Bin.';
    if (exact.includes(low)) return 'This folder belongs to Windows or your user account and has to stay.';
    for (const base of trees) {
      if (low === base || low.startsWith(base + path.sep)) {
        return 'Files under Windows, Program Files and ProgramData are managed by Windows and installers. Uninstall the app from Settings instead.';
      }
    }
    if (SYSTEM_NAMES.includes(path.basename(low))) return 'This is a Windows system item and has to stay.';
    return null;
  };
}

/** The protected folders of this Windows installation. `home` and `appData` come from Electron's app.getPath. */
function windowsProtection({ env = process.env, home, appData }) {
  return {
    protectedTrees: [
      env.SystemRoot || 'C:\\Windows',
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      env.ProgramData || 'C:\\ProgramData',
    ],
    protectedFolders: [
      path.dirname(home), // C:\Users
      home,
      appData,
      path.join(home, 'AppData'),
      path.join(home, 'AppData', 'Local'),
    ],
  };
}

module.exports = { createTrashGuard, windowsProtection };
