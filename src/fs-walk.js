// Walks a folder tree. Used by the disk scan and by Clean up to measure folders.
const fsp = require('fs/promises');
const path = require('path');

/**
 * The filesystem as the walk sees it. Tests pass an in-memory one with the same two methods.
 *   list(dir)  → [{ name, kind: 'dir' | 'file' | 'link' | 'other' }]   rejects when the folder can't be opened
 *   size(file) → bytes                                                rejects when the file is locked or gone
 */
const realFs = {
  async list(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      kind: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
    }));
  },
  async size(file) {
    return (await fsp.lstat(file)).size;
  },
};

/**
 * Visit every folder under `root`, depth-first, `concurrency` folders at a time.
 * Junctions and symlinks are skipped: they point at folders we'd otherwise count twice (or loop through forever).
 *
 * The caller keeps its own per-folder context (`ctx`), starting with `rootCtx`:
 *   enter(parentCtx, name, fullPath) → childCtx   a subfolder was found
 *   file(ctx, name, size)                         a file was measured
 *   denied(ctx, error)                            a folder couldn't be opened
 *   visit(ctx, fullPath)                          a folder is about to be read
 */
function walk(root, rootCtx, { fs = realFs, concurrency = 32, statChunk = 128, isCancelled = () => false, enter, file, denied = () => {}, visit = () => {} }) {
  const queue = [{ ctx: rootCtx, p: root }];
  let active = 0;

  async function readDir({ ctx, p }) {
    visit(ctx, p);
    let entries;
    try { entries = await fs.list(p); } catch (e) { denied(ctx, e); return; }
    const files = [];
    for (const e of entries) {
      if (e.kind === 'dir') {
        const full = path.join(p, e.name);
        queue.push({ ctx: enter(ctx, e.name, full), p: full });
      } else if (e.kind === 'file') files.push(e.name);
    }
    for (let i = 0; i < files.length && !isCancelled(); i += statChunk) {
      const chunk = files.slice(i, i + statChunk);
      const sizes = await Promise.all(chunk.map((f) => fs.size(path.join(p, f)).catch(() => -1)));
      for (let j = 0; j < chunk.length; j++) if (sizes[j] >= 0) file(ctx, chunk[j], sizes[j]);
    }
  }

  return new Promise((resolve) => {
    const pump = () => {
      if (isCancelled()) { if (active === 0) resolve(); return; }
      if (active === 0 && !queue.length) { resolve(); return; }
      while (active < concurrency && queue.length) {
        const d = queue.pop(); // depth-first keeps the queue (and memory) small
        active++;
        readDir(d).catch(() => {}).finally(() => { active--; pump(); });
      }
    };
    pump();
  });
}

/** Total size of a folder. `exists` is false when it isn't there; `denied` when some of it couldn't be read. */
async function folderSize(p, { fs = realFs } = {}) {
  let size = 0, files = 0, denied = false, rootError = null;
  await walk(p, p, {
    fs,
    enter: (_ctx, _name, full) => full,
    file: (_ctx, _name, s) => { size += s; files++; },
    denied: (ctx, e) => { denied = true; if (ctx === p) rootError = e.code || 'EACCES'; },
  });
  return { size, files, exists: rootError !== 'ENOENT' && rootError !== 'ENOTDIR', denied: denied && rootError !== 'ENOENT' };
}

module.exports = { walk, folderSize, realFs };
