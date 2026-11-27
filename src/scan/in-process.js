// In-process adapter for the scan engine, with the same shape as a worker thread.
// Used by tests (with an in-memory filesystem) and anywhere a worker thread isn't wanted.
const { EventEmitter } = require('events');
const { createScanEngine } = require('./engine');

/** Returns a `spawn(root, { topN })` for createDiskScan. Messages are delivered asynchronously, as with a worker. */
function inProcessSpawn({ fs, progressMs = 20 } = {}) {
  return (root, { topN }) => {
    const em = new EventEmitter();
    let alive = true;
    const deliver = (m) => setImmediate(() => { if (alive) em.emit('message', m); });
    const engine = createScanEngine({ root, topN, fs, progressMs, post: deliver });
    setImmediate(() => engine.run().catch((e) => { if (alive) em.emit('error', e); }));
    return {
      on: (ev, fn) => em.on(ev, fn),
      postMessage: (m) => setImmediate(() => { if (alive) engine.handle(m); }),
      terminate: () => { alive = false; engine.cancel(); },
      // Tests use this to simulate a crashed worker.
      crash: (err) => em.emit('error', err),
    };
  };
}

module.exports = { inProcessSpawn };
