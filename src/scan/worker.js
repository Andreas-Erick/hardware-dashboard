// Worker-thread adapter for the scan engine: the app scans off the main thread so the window stays responsive.
const { parentPort, workerData } = require('worker_threads');
const { createScanEngine } = require('./engine');

const engine = createScanEngine({ root: workerData.root, topN: workerData.topN, post: (m) => parentPort.postMessage(m) });
parentPort.on('message', engine.handle);
// An unexpected failure is rethrown outside the promise so it ends the worker, which the disk scan reports.
engine.run().catch((e) => setImmediate(() => { throw e; }));
