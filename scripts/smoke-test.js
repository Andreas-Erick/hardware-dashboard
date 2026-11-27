// `npm run check`: runs the data layer against this PC, without the UI, and prints what it found.
// It exits non-zero when a step fails. Behaviour is covered by `npm test`; this checks the real Windows plumbing.
const path = require('path');
const os = require('os');
const fs = require('fs');
const monitor = require('../src/monitor');
const drivers = require('../src/drivers');
const network = require('../src/network');
const cleanup = require('../src/cleanup');
const bluetooth = require('../src/bluetooth');
const { createDiskScan } = require('../src/scan');

const gb = (b) => (b == null ? '-' : `${(b / 1024 ** 3).toFixed(2)} GB`);
let failed = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)${out ? `: ${out}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

(async () => {
  await step('static info', async () => { const s = await monitor.getStatic(); return `${s.cpu.brand}, ${s.gpus.length} GPU(s), ${s.disks.length} disk(s)`; });
  await step('live snapshot', async () => {
    await monitor.getLive();
    await new Promise((r) => setTimeout(r, 1000));
    const l = await monitor.getLive();
    if (!l.cpu || !l.mem) throw new Error('no CPU or memory reading');
    return `CPU ${l.cpu.load.toFixed(0)}%, RAM ${gb(l.mem.used)} of ${gb(l.mem.total)}, ${l.drives.length} drive(s)`;
  });
  await step('drivers', async () => { const d = await drivers.list(); return `${d.drivers.length} drivers, ${d.problems.length} problem device(s)`; });
  await step('network', async () => { const n = await network.info(); return `${n.interfaces.length} interfaces, online: ${n.status.online}`; });
  await step('bluetooth', async () => { const b = await bluetooth.info(); return `${b.adapters.length} adapter(s), radio ${b.radio}, ${b.devices.length} device(s)`; });
  await step('cleanup', async () => {
    const items = [];
    await cleanup.listAll((i) => items.push(i));
    return items.map((i) => `${i.id} ${gb(i.size)}`).join(', ');
  });

  const root = process.argv[2] || path.join(os.homedir(), 'Documents');
  if (fs.existsSync(root)) {
    await step(`disk scan of ${root}`, async () => {
      const scan = createDiskScan({ blockReason: () => 'not in the smoke test', trashItem: async () => {} });
      const done = await new Promise((resolve) => scan.start(root, { onDone: resolve }));
      try {
        if (done.error) throw new Error(done.error);
        const c = await scan.children(root);
        const largest = await scan.largest();
        const types = await scan.types();
        return `${done.files} files, ${gb(done.bytes)} in ${done.finishedAt - done.startedAt} ms; ${c.items.length} items at the top, ${largest.length} largest, ${types.length} types`;
      } finally {
        scan.stop();
      }
    });
  }
  process.exit(failed ? 1 : 0);
})();
