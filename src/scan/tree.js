// The scanned folder tree, kept in memory so any folder's contents can be listed instantly after the scan.
// Pure: no filesystem access. The scan engine fills it; queries read it.
const path = require('path');
const { extOf, categoryOfExt, category } = require('../../shared/categories');

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// A folder "is mostly" a category when that category fills at least this share of it.
const MOSTLY = 0.4;

function createScanTree(rootPath, { topN = 300 } = {}) {
  const ROOT = path.resolve(rootPath);
  // files is a flat [name, size, name, size, ...] array: a drive has millions of them.
  const mkDir = (name, parent, p) => ({ name, parent, p, size: 0, count: 0, dirs: [], files: [], denied: false });
  const root = mkDir(ROOT, null, ROOT);
  const stats = { files: 0, dirs: 0, bytes: 0, denied: 0, current: ROOT, startedAt: Date.now(), done: false, cancelled: false };
  const exts = new Map(); // ext -> { size, count }
  let top = [];
  let topMin = 0;
  let catMemo = new WeakMap();

  // ---- Filling ----
  function addDir(parent, name) {
    const child = mkDir(name, parent, path.join(parent.p, name));
    parent.dirs.push(child);
    stats.dirs++;
    return child;
  }
  function addFile(dir, name, size) {
    dir.files.push(name, size);
    for (let n = dir; n; n = n.parent) { n.size += size; n.count++; }
    stats.files++;
    stats.bytes += size;
    const e = extOf(name);
    const rec = exts.get(e) || { size: 0, count: 0 };
    rec.size += size; rec.count++;
    exts.set(e, rec);
    if (top.length < topN || size > topMin) {
      top.push({ path: path.join(dir.p, name), size });
      if (top.length >= topN * 2) trimTop();
    }
  }
  function markDenied(dir) {
    if (!dir.denied) { dir.denied = true; stats.denied++; }
  }
  function trimTop() {
    top.sort((a, b) => b.size - a.size);
    if (top.length > topN) top.length = topN;
    topMin = top.length ? top[top.length - 1].size : 0;
  }
  function finish({ cancelled = false } = {}) {
    trimTop();
    Object.assign(stats, { done: true, cancelled, finishedAt: Date.now() });
  }

  // ---- Queries ----
  function findDir(p) {
    const rel = path.relative(ROOT, path.resolve(p));
    if (rel === '') return root;
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    let n = root;
    for (const seg of rel.split(path.sep)) {
      n = n.dirs.find((d) => same(d.name, seg));
      if (!n) return null;
    }
    return n;
  }

  // What fills a folder, by file category. Memoised; cleared whenever something is removed.
  function catsOf(dir) {
    let m = catMemo.get(dir);
    if (m) return m;
    m = {};
    for (let i = 0; i < dir.files.length; i += 2) {
      const c = category(dir.files[i]);
      m[c] = (m[c] || 0) + dir.files[i + 1];
    }
    for (const d of dir.dirs) for (const [c, s] of Object.entries(catsOf(d))) m[c] = (m[c] || 0) + s;
    catMemo.set(dir, m);
    return m;
  }
  /** The category that fills most of a folder, or null when it's a mix (or mostly "other"). */
  function mostly(dir) {
    if (!dir.size) return null;
    let best = null, bs = 0;
    for (const [c, s] of Object.entries(catsOf(dir))) if (s > bs) { best = c; bs = s; }
    return best && best !== 'other' && bs / dir.size >= MOSTLY ? best : null;
  }

  const fileItem = (dir, i) => ({ name: dir.files[i], size: dir.files[i + 1], isDir: false, cat: category(dir.files[i]) });
  function topOf(dir, limit) {
    const items = dir.dirs.map((d) => ({ name: d.name, size: d.size, isDir: true, mostly: mostly(d) }));
    for (let i = 0; i < dir.files.length; i += 2) items.push(fileItem(dir, i));
    items.sort((a, b) => b.size - a.size);
    return items.slice(0, limit);
  }

  /**
   * One folder's contents, largest first. Folders carry `sub` (their 14 largest items, for the map's inner level)
   * and `mostly` (the category that fills them, or null). Returns null for a path outside the tree.
   */
  function children(p, limit = 200) {
    const dir = findDir(p);
    if (!dir) return null;
    const items = dir.dirs.map((d) => ({
      name: d.name, path: d.p, size: d.size, count: d.count, isDir: true, denied: d.denied,
      sub: topOf(d, 14), mostly: mostly(d),
    }));
    for (let i = 0; i < dir.files.length; i += 2) items.push({ ...fileItem(dir, i), path: path.join(dir.p, dir.files[i]) });
    items.sort((a, b) => b.size - a.size);
    const rest = items.slice(limit);
    const crumbs = [];
    for (let n = dir; n; n = n.parent) crumbs.unshift({ name: n.parent ? n.name : n.p, path: n.p });
    return {
      path: dir.p,
      name: dir.parent ? dir.name : dir.p,
      parent: dir.parent ? dir.parent.p : null,
      isRoot: !dir.parent,
      crumbs,
      size: dir.size,
      count: dir.count,
      denied: dir.denied,
      items: items.slice(0, limit),
      hiddenCount: rest.length,
      hiddenSize: rest.reduce((s, x) => s + x.size, 0),
    };
  }

  function largest(limit = topN) {
    trimTop();
    return top.slice(0, limit).map((t) => ({ ...t, name: path.basename(t.path), cat: category(path.basename(t.path)) }));
  }

  function types(limit = 80) {
    return [...exts.entries()]
      .filter(([, v]) => v.size > 0)
      .map(([ext, v]) => ({ ext, cat: categoryOfExt(ext), ...v }))
      .sort((a, b) => b.size - a.size)
      .slice(0, limit);
  }

  function forgetExts(dir) {
    for (let i = 0; i < dir.files.length; i += 2) {
      const rec = exts.get(extOf(dir.files[i]));
      if (rec) { rec.size -= dir.files[i + 1]; rec.count--; }
    }
    dir.dirs.forEach(forgetExts);
  }
  function countDirs(dir) {
    let dirs = 0, denied = dir.denied ? 1 : 0;
    for (const d of dir.dirs) { const c = countDirs(d); dirs += 1 + c.dirs; denied += c.denied; }
    return { dirs, denied };
  }

  /** Forget an item after it was moved to the Recycle Bin so the numbers stay honest. Returns false if unknown. */
  function remove(p) {
    const target = path.resolve(p);
    const parent = findDir(path.dirname(target));
    if (!parent || target === ROOT) return false;
    const name = path.basename(target);
    let size = 0, count = 0;
    const di = parent.dirs.findIndex((d) => same(d.name, name));
    if (di >= 0) {
      const d = parent.dirs[di];
      const c = countDirs(d);
      size = d.size; count = d.count;
      forgetExts(d);
      parent.dirs.splice(di, 1);
      stats.dirs -= 1 + c.dirs;
      stats.denied -= c.denied;
    } else {
      const fi = parent.files.findIndex((x, i) => i % 2 === 0 && same(x, name));
      if (fi < 0) return false;
      size = parent.files[fi + 1]; count = 1;
      const rec = exts.get(extOf(name));
      if (rec) { rec.size -= size; rec.count--; }
      parent.files.splice(fi, 2);
    }
    for (let n = parent; n; n = n.parent) { n.size -= size; n.count -= count; }
    catMemo = new WeakMap();
    stats.bytes -= size;
    stats.files -= count;
    const low = target.toLowerCase();
    top = top.filter((t) => { const q = t.path.toLowerCase(); return q !== low && !q.startsWith(low + path.sep); });
    return true;
  }

  return {
    root,
    addDir, addFile, markDenied, finish,
    setCurrent: (p) => { stats.current = p; },
    stats: () => ({ ...stats }),
    children, largest, types, remove,
  };
}

module.exports = { createScanTree, MOSTLY };
