// Walks a folder tree off the main thread and keeps the result in memory so the UI
// can ask for any folder's contents instantly after the scan.
const { parentPort, workerData } = require('worker_threads');
const fsp = require('fs/promises');
const path = require('path');
const { category } = require('../renderer/categories.js');

const ROOT = path.resolve(workerData.root);
const DIR_CONCURRENCY = 48;
const STAT_CHUNK = 128;
const TOP_N = 300;

const stats = { files: 0, dirs: 0, bytes: 0, denied: 0, current: ROOT, startedAt: Date.now(), done: false, cancelled: false };
const exts = new Map(); // ext -> { size, count }
let top = [];
let topMin = 0;
let cancelled = false;

function mkDir(name, parent, p) {
  return { name, parent, p, size: 0, count: 0, dirs: [], files: [], denied: false };
}
const rootNode = mkDir(ROOT, null, ROOT);

function extOf(name) {
  const e = path.extname(name).toLowerCase();
  return e && e.length <= 12 ? e : '(none)';
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
  if (top.length < TOP_N || size > topMin) {
    top.push({ path: path.join(dir.p, name), size });
    if (top.length >= TOP_N * 2) trimTop();
  }
}
function trimTop() {
  top.sort((a, b) => b.size - a.size);
  if (top.length > TOP_N) top.length = TOP_N;
  topMin = top.length ? top[top.length - 1].size : 0;
}

async function processDir(dir, queue) {
  stats.current = dir.p;
  let entries;
  try {
    entries = await fsp.readdir(dir.p, { withFileTypes: true });
  } catch {
    dir.denied = true;
    stats.denied++;
    return;
  }
  const files = [];
  for (const e of entries) {
    // Junctions and symlinks point at folders we'd otherwise count twice (or loop forever).
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      const child = mkDir(e.name, dir, path.join(dir.p, e.name));
      dir.dirs.push(child);
      stats.dirs++;
      queue.push(child);
    } else if (e.isFile()) {
      files.push(e.name);
    }
  }
  for (let i = 0; i < files.length && !cancelled; i += STAT_CHUNK) {
    const chunk = files.slice(i, i + STAT_CHUNK);
    const sizes = await Promise.all(chunk.map((f) => fsp.lstat(path.join(dir.p, f)).then((s) => s.size, () => -1)));
    for (let j = 0; j < chunk.length; j++) if (sizes[j] >= 0) addFile(dir, chunk[j], sizes[j]);
  }
}

function scan() {
  const queue = [rootNode];
  let active = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (cancelled) { if (active === 0) resolve(); return; }
      while (active < DIR_CONCURRENCY && queue.length) {
        const d = queue.pop(); // depth-first keeps the queue (and memory) small
        active++;
        processDir(d, queue).finally(() => {
          active--;
          if (active === 0 && (queue.length === 0 || cancelled)) resolve();
          else pump();
        });
      }
    };
    pump();
  });
}

// ---- Queries ----
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function findDir(p) {
  const rel = path.relative(ROOT, path.resolve(p));
  if (rel === '') return rootNode;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  let n = rootNode;
  for (const seg of rel.split(path.sep)) {
    n = n.dirs.find((d) => same(d.name, seg));
    if (!n) return null;
  }
  return n;
}

// What fills a folder, by file category. Memoised; cleared whenever something is removed.
let catMemo = new WeakMap();
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
function dominant(dir) {
  let best = null, bs = 0;
  for (const [c, s] of Object.entries(catsOf(dir))) if (s > bs) { best = c; bs = s; }
  return best && dir.size ? { cat: best, share: bs / dir.size } : null;
}

function topOf(dir, limit) {
  const items = dir.dirs.map((d) => ({ name: d.name, size: d.size, isDir: true, dom: dominant(d) }));
  for (let i = 0; i < dir.files.length; i += 2) items.push({ name: dir.files[i], size: dir.files[i + 1], isDir: false });
  items.sort((a, b) => b.size - a.size);
  return items.slice(0, limit);
}

function children(p, limit = 400) {
  const dir = findDir(p);
  if (!dir) return null;
  const items = dir.dirs.map((d) => ({
    name: d.name, path: d.p, size: d.size, count: d.count, isDir: true, denied: d.denied,
    sub: topOf(d, 14), dom: dominant(d),
  }));
  for (let i = 0; i < dir.files.length; i += 2) {
    items.push({ name: dir.files[i], path: path.join(dir.p, dir.files[i]), size: dir.files[i + 1], isDir: false });
  }
  items.sort((a, b) => b.size - a.size);
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  return {
    path: dir.p,
    name: dir.parent ? dir.name : dir.p,
    parent: dir.parent ? dir.parent.p : null,
    size: dir.size,
    count: dir.count,
    denied: dir.denied,
    items: shown,
    hiddenCount: rest.length,
    hiddenSize: rest.reduce((s, x) => s + x.size, 0),
  };
}

function subtractExts(dir) {
  for (let i = 0; i < dir.files.length; i += 2) {
    const rec = exts.get(extOf(dir.files[i]));
    if (rec) { rec.size -= dir.files[i + 1]; rec.count--; }
  }
  dir.dirs.forEach(subtractExts);
}

/** Forget an item after it was moved to the Recycle Bin so the numbers stay honest. */
function remove(p) {
  const target = path.resolve(p);
  const parent = findDir(path.dirname(target));
  if (!parent) return false;
  const name = path.basename(target);
  let size = 0, count = 0;
  const di = parent.dirs.findIndex((d) => same(d.name, name));
  if (di >= 0) {
    const d = parent.dirs[di];
    size = d.size; count = d.count;
    subtractExts(d);
    parent.dirs.splice(di, 1);
  } else {
    for (let i = 0; i < parent.files.length; i += 2) {
      if (same(parent.files[i], name)) {
        size = parent.files[i + 1]; count = 1;
        const rec = exts.get(extOf(name));
        if (rec) { rec.size -= size; rec.count--; }
        parent.files.splice(i, 2);
        break;
      }
    }
  }
  for (let n = parent; n; n = n.parent) { n.size -= size; n.count -= count; }
  catMemo = new WeakMap();
  stats.bytes -= size;
  stats.files -= count;
  const low = target.toLowerCase();
  top = top.filter((t) => { const q = t.path.toLowerCase(); return q !== low && !q.startsWith(low + path.sep); });
  return true;
}

parentPort.on('message', (msg) => {
  if (msg.type === 'cancel') { cancelled = true; return; }
  let result = null;
  if (msg.type === 'children') result = children(msg.path, msg.limit);
  else if (msg.type === 'largest') { trimTop(); result = top.slice(0, msg.limit || 200); }
  else if (msg.type === 'types') {
    result = [...exts.entries()].filter(([, v]) => v.size > 0).map(([ext, v]) => ({ ext, ...v })).sort((a, b) => b.size - a.size).slice(0, 80);
  } else if (msg.type === 'remove') result = remove(msg.path);
  else if (msg.type === 'stats') result = { ...stats };
  parentPort.postMessage({ id: msg.id, result });
});

const progress = setInterval(() => parentPort.postMessage({ type: 'progress', stats: { ...stats } }), 250);

scan().then(() => {
  clearInterval(progress);
  trimTop();
  stats.done = true;
  stats.cancelled = cancelled;
  stats.finishedAt = Date.now();
  parentPort.postMessage({ type: 'done', stats: { ...stats } });
});
