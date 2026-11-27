// Exercises the data layer without the UI: `npm run check`.
const path = require('path');
const os = require('os');
const monitor = require('../src/monitor');
const drivers = require('../src/drivers');
const network = require('../src/network');
const cleanup = require('../src/cleanup');
const Scanner = require('../src/scanner');

const gb = (b) => (b == null ? '-' : `${(b / 1024 ** 3).toFixed(2)} GB`);

(async () => {
  const t = Date.now();
  const st = await monitor.getStatic();
  console.log('static', JSON.stringify(st, null, 1).slice(0, 1500));
  await monitor.getLive();
  await new Promise((r) => setTimeout(r, 1000));
  const live = await monitor.getLive();
  console.log('live cpu', live.cpu, 'mem', gb(live.mem.used), '/', gb(live.mem.total));
  console.log('gpus', live.gpus, 'drives', live.drives, 'net', live.net, 'diskTemps', live.diskTemps, 'battery', live.battery);

  const d = await drivers.list();
  console.log('drivers', d.drivers.length, 'problems', d.problems, 'sample', d.drivers.slice(0, 2));

  const n = await network.info();
  console.log('net', JSON.stringify(n).slice(0, 800));

  const items = [];
  await cleanup.listAll((i) => items.push(i));
  for (const i of items) console.log('cleanup', i.id, gb(i.size), i.denied ? '(partly unreadable)' : '');

  const s = new Scanner();
  const root = path.join(os.homedir(), 'Documents');
  await new Promise((resolve) => s.start(root, { onProgress: () => {}, onDone: (x) => { console.log('scan done', x.files, 'files', gb(x.bytes), (x.finishedAt - x.startedAt) + 'ms'); resolve(); } }));
  const c = await s.ask({ type: 'children', path: root });
  console.log('children', c.items.slice(0, 5).map((i) => `${i.name} ${gb(i.size)} sub=${i.sub ? i.sub.length : '-'}`));
  console.log('largest', (await s.ask({ type: 'largest', limit: 3 })));
  console.log('types', (await s.ask({ type: 'types' })).slice(0, 5));
  s.stop();
  console.log('total', Date.now() - t, 'ms');
})();
