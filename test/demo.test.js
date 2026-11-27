const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemo } = require('../src/demo');
const { createHealth, CHECKS } = require('../src/health');
const { createDiskScan } = require('../src/scan');

const fastDemo = () => createDemo({ wait: async () => {} });

// The demo feeds invented facts to the real rules, so a shape mistake shows up as a check that can't finish.
test('demo: every health check finishes on the demo facts', async () => {
  const health = createHealth({ probes: fastDemo().probes });
  for (const { id } of CHECKS) {
    const r = await health.runCheck(id);
    assert.notEqual(r.status, 'error', `${id}: ${JSON.stringify(r.items)}`);
    assert.ok(r.items.length > 0, id);
  }
});

test('demo: the invented drive scans, with the largest files and every category', async () => {
  const demo = fastDemo();
  const scan = createDiskScan({ blockReason: () => null, ...demo.scan });
  const stats = await new Promise((resolve) => scan.start(demo.scanRoot, { onDone: resolve }));
  assert.ok(!stats.error, stats.error);
  const largest = await scan.largest();
  assert.ok(largest.length >= 100);
  const types = await scan.types();
  const cats = new Set(types.map((t) => t.cat || t.category));
  for (const c of ['video', 'image', 'audio', 'archive', 'setup', 'game', 'doc', 'dev']) assert.ok(cats.has(c), `missing ${c}`);
  scan.stop();
});

test('demo: live snapshots move and stay in range', async () => {
  let t = 1_000_000;
  const demo = createDemo({ now: () => t, wait: async () => {} });
  const a = await demo.methods.live();
  t += 1500;
  const b = await demo.methods.live();
  assert.notEqual(a.cpu.load, b.cpu.load);
  for (const s of [a, b]) {
    assert.ok(s.cpu.load >= 0 && s.cpu.load <= 100);
    assert.ok(s.cpu.cores.every((c) => c >= 0 && c <= 100));
    assert.ok(s.mem.percent > 0 && s.mem.percent < 100);
  }
});

test('demo: the speed test reports progress and a result', async () => {
  const demo = fastDemo();
  const phases = new Set();
  const r = await demo.speedTest((p) => phases.add(p.phase));
  assert.deepEqual([...phases], ['ping', 'download', 'upload']);
  assert.ok(r.download > r.upload && r.ping > 0);
});
