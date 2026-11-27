// Runs one disk scan and answers questions about it. Lives wherever the scan runs:
// inside a worker thread in the app (worker.js), or in-process in tests (in-process.js).
//
// Messages in:  { type: 'cancel' } | { id, type: 'children' | 'largest' | 'types' | 'remove', args: [] }
// Messages out: { type: 'progress' | 'done', stats } | { id, result } | { id, error }
const { createScanTree } = require('./tree');
const { walk, realFs } = require('../fs-walk');

const QUERIES = ['children', 'largest', 'types', 'remove'];

function createScanEngine({ root, topN, fs = realFs, post, progressMs = 250, concurrency = 48 }) {
  const tree = createScanTree(root, { topN });
  let cancelled = false;

  function handle(msg) {
    if (msg.type === 'cancel') { cancelled = true; return; }
    if (!QUERIES.includes(msg.type)) { post({ id: msg.id, error: `Unknown scan question "${msg.type}".` }); return; }
    try {
      post({ id: msg.id, result: tree[msg.type](...(msg.args || [])) });
    } catch (e) {
      post({ id: msg.id, error: e.message });
    }
  }

  async function run() {
    const timer = setInterval(() => post({ type: 'progress', stats: tree.stats() }), progressMs);
    try {
      await walk(tree.root.p, tree.root, {
        fs,
        concurrency,
        isCancelled: () => cancelled,
        visit: (_dir, p) => tree.setCurrent(p),
        enter: (dir, name) => tree.addDir(dir, name),
        file: (dir, name, size) => tree.addFile(dir, name, size),
        denied: (dir) => tree.markDenied(dir),
      });
    } finally {
      clearInterval(timer);
    }
    tree.finish({ cancelled });
    post({ type: 'done', stats: tree.stats() });
  }

  return { handle, run, cancel: () => { cancelled = true; } };
}

module.exports = { createScanEngine };
