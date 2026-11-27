// Disk scan: scan a drive or folder in the background, then explore it and move items to the Recycle Bin.
// One scan at a time. Queries reject with a readable message when there is nothing to answer from.
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

// How much each query returns. The largest-files list is also how many files the scan keeps track of.
const LIMITS = { children: 200, largest: 300 };

const isDriveRoot = (p) => /^[A-Z]:\\?$/i.test(p);

const workerSpawn = (root, { topN }) => new Worker(path.join(__dirname, 'worker.js'), { workerData: { root, topN } });

/**
 * spawn(root, { topN }) → something shaped like a worker thread: on('message' | 'error' | 'exit'), postMessage, terminate.
 * blockReason(p, { root, running }) → why p may not be moved to the Recycle Bin, or null (see trash-guard.js).
 * trashItem(p) moves a file or folder to the Recycle Bin. getDrives() lists drives as { mount, size, used }.
 */
function createDiskScan({ spawn = workerSpawn, blockReason, trashItem, getDrives = async () => [], exists = fs.existsSync, limits = LIMITS }) {
  let worker = null;
  let root = null;
  let running = false;
  let lastStats = null;
  let failure = null;
  let seq = 0;
  const pending = new Map();

  function settleAll(error) {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  }

  function stop() {
    const w = worker;
    worker = null;
    running = false;
    if (w) w.terminate();
    settleAll(new Error('The scan was replaced by a new one.'));
  }

  /** Starts a new scan, stopping any running one. Returns the resolved root folder. */
  function start(folder, { onProgress = () => {}, onDone = () => {} } = {}) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || !exists(folder)) throw new Error("That folder doesn't exist.");
    stop();
    root = path.resolve(folder);
    running = true;
    lastStats = null;
    failure = null;
    const w = spawn(root, { topN: limits.largest });
    worker = w;

    const fail = (message) => {
      if (w !== worker) return;
      worker = null;
      running = false;
      failure = `The scan stopped because of an error: ${message}`;
      settleAll(new Error(failure));
      onDone({ ...(lastStats || {}), done: true, error: message });
    };
    w.on('message', (m) => {
      if (w !== worker) return;
      if (m.type === 'progress') { lastStats = m.stats; onProgress(m.stats); }
      else if (m.type === 'done') { lastStats = m.stats; running = false; onDone(m.stats); }
      else if (pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
      }
    });
    w.on('error', (err) => fail(String((err && err.message) || err)));
    w.on('exit', (code) => fail(`the scan ended unexpectedly (code ${code}).`));
    return root;
  }

  function ask(type, ...args) {
    if (!worker) return Promise.reject(new Error(failure || 'Scan a drive or folder first.'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, args });
    });
  }

  /**
   * A folder's contents (see tree.js children()). At the root of a drive scan it also says how the total compares with
   * the drive: `unreadable` is space Windows uses that the scan couldn't see; `overcounted` means the scan found more
   * than the drive uses (hard links, cloud-only OneDrive files).
   */
  async function children(p) {
    const data = await ask('children', p, limits.children);
    if (!data) throw new Error("That folder isn't part of the scan any more.");
    if (data.isRoot && isDriveRoot(data.path)) {
      const d = (await getDrives()).find((x) => x.mount.toUpperCase() === data.path.slice(0, 2).toUpperCase());
      if (d) {
        const missing = d.used - data.size;
        data.unreadable = missing > d.size * 0.01 ? missing : 0;
        data.overcounted = data.size > d.used * 1.03;
      }
    }
    return data;
  }

  /** Moves p to the Recycle Bin and forgets it in the scan. Rejects with the reason when that isn't allowed. */
  async function trash(p) {
    const why = blockReason(p, { root: worker ? root : null, running });
    if (why) throw new Error(why);
    try {
      await trashItem(path.resolve(p));
    } catch (e) {
      throw new Error(`Windows couldn't move it to the Recycle Bin. It may be open in another app. (${e.message})`);
    }
    await ask('remove', p);
  }

  /** True if p lies inside the scanned folder (or is the folder itself). */
  function contains(p) {
    if (!root || typeof p !== 'string') return false;
    const rel = path.relative(root, path.resolve(p));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  return {
    start,
    cancel: () => { if (worker) worker.postMessage({ type: 'cancel' }); },
    stop,
    children,
    largest: () => ask('largest', limits.largest),
    types: () => ask('types'),
    trash,
    contains,
    get root() { return root; },
    get running() { return running; },
  };
}

module.exports = { createDiskScan, LIMITS };
