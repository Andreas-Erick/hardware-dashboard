const { Worker } = require('worker_threads');
const path = require('path');

/** Owns the background scan worker and forwards questions to it. One scan at a time. */
class Scanner {
  constructor() {
    this.worker = null;
    this.root = null;
    this.pending = new Map();
    this.seq = 0;
    this.lastStats = null;
  }

  start(root, { onProgress, onDone }) {
    this.stop();
    this.root = path.resolve(root);
    this.lastStats = null;
    const w = new Worker(path.join(__dirname, 'scanner-worker.js'), { workerData: { root: this.root } });
    this.worker = w;
    w.on('message', (m) => {
      if (w !== this.worker) return;
      if (m.type === 'progress') { this.lastStats = m.stats; onProgress(m.stats); }
      else if (m.type === 'done') { this.lastStats = m.stats; onDone(m.stats); }
      else if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      }
    });
    w.on('error', (err) => {
      if (w !== this.worker) return;
      onDone({ ...(this.lastStats || {}), done: true, error: String(err && err.message || err) });
    });
  }

  ask(msg) {
    if (!this.worker) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...msg, id });
    });
  }

  cancel() {
    if (this.worker) this.worker.postMessage({ type: 'cancel' });
  }

  stop() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
  }

  /** True if p lies inside the scanned folder (and isn't the folder itself). */
  contains(p) {
    if (!this.root) return false;
    const rel = path.relative(this.root, path.resolve(p));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
}

module.exports = Scanner;
