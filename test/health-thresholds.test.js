// Every health threshold, tested on both sides of its edge, so moving a limit or flipping
// `<` to `<=` turns a test red. One row per case: the facts that matter and the status expected.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/health/rules');
const { latencyStats } = require('../src/net-probe');

const GB = 1024 ** 3;
const NO_EVENTS = { count: 0, last: null };

/** The status of the one finding with this label, or 'absent' when the rule left it out. */
function statusOf(items, label) {
  const found = items.filter((i) => i.label === label);
  assert.ok(found.length <= 1, `expected at most one "${label}" finding, got ${found.length}`);
  return found.length ? found[0].status : 'absent';
}

// ---- Builders: realistic healthy facts, with only the causal input overridden per row ----
const cpuFacts = (o = {}) => ({
  loadSamples: [10], top: [], temp: 50,
  ...o,
  events: { whea: NO_EVENTS, power: NO_EVENTS, bsod: NO_EVENTS, ...o.events },
});
const memFacts = (o = {}) => ({
  mem: { total: 16 * GB, active: 4 * GB, available: 12 * GB, swaptotal: 0, swapused: 0, ...o.mem },
  layout: o.layout || [{ size: 8 * GB, clockSpeed: 3200, type: 'DDR4' }, { size: 8 * GB, clockSpeed: 3200, type: 'DDR4' }],
  top: [],
  lastTest: o.lastTest === undefined ? { id: 1201, at: '2026-10-01T00:00:00Z' } : o.lastTest,
});
const ssd = (o = {}) => ({ Name: 'SSD', Media: 'SSD', Health: 'Healthy', Op: 'OK', Size: 1000 * GB, Wear: 10, Temp: 40, ...o });
const storageFacts = (o = {}) => ({
  disks: o.disks || [ssd()],
  volumes: o.volumes || [{ mount: 'C:', size: 100 * GB, free: 50 * GB }],
  events: { disk: NO_EVENTS, ntfs: NO_EVENTS, nvme: NO_EVENTS },
  trim: 'on',
});
const batteryFacts = (full, design = 100000) => ({
  battery: { hasBattery: true, percent: 50, acConnected: false, isCharging: false }, design, full,
});
const netFacts = (samples, wifi = null) => ({ latency: latencyStats(samples), dnsOk: true, wifi });

function table(title, rows, run) {
  for (const [name, input, expected] of rows) {
    test(`${title}: ${name} → ${expected}`, () => assert.equal(run(input), expected));
  }
}

table('processor load averaged over the samples', [
  ['60%', [60], 'good'],
  ['61%', [61], 'warn'],
  ['85%', [80, 90], 'warn'],
  ['85.5%', [85.5], 'bad'],
], (loadSamples) => statusOf(rules.cpu(cpuFacts({ loadSamples })), 'Processor load'));

table('unexpected shutdowns are the ones not explained by a blue screen', [
  ['none', { power: NO_EVENTS, bsod: NO_EVENTS }, 'good'],
  ['one, caused by the one blue screen', { power: { count: 1, last: null }, bsod: { count: 1, last: null } }, 'absent'],
  ['two, one blue screen', { power: { count: 2, last: null }, bsod: { count: 1, last: null } }, 'warn'],
], (events) => statusOf(rules.cpu(cpuFacts({ events })), 'Unexpected shutdowns'));

table('memory in use', [
  ['79%', 79, 'good'],
  ['80%', 80, 'warn'],
  ['89%', 89, 'warn'],
  ['90%', 90, 'bad'],
], (pct) => statusOf(rules.memory(memFacts({ mem: { total: 100 * GB, active: pct * GB } })), 'Memory in use'));

table('page file', [
  ['no page file', [0, 0], 'absent'],
  ['80% full', [100, 80], 'good'],
  ['81% full', [100, 81], 'warn'],
], ([swaptotal, swapused]) => statusOf(rules.memory(memFacts({ mem: { swaptotal, swapused } })), 'Page file'));

table('Windows memory test result', [
  ['never run', null, 'info'],
  ['passed (event 1201)', { id: 1201, at: '2026-10-01' }, 'good'],
  ['found errors (event 1202)', { id: 1202, at: '2026-10-01' }, 'bad'],
  ['found errors (event 2002)', { id: 2002, at: '2026-10-01' }, 'bad'],
], (lastTest) => statusOf(rules.memory(memFacts({ lastTest })), 'Memory test'));

test('memory modules: a matched pair is good, a mismatched set is information', () => {
  const matched = rules.memory(memFacts());
  assert.equal(statusOf(matched, 'Memory modules'), 'good');
  assert.match(matched.find((i) => i.label === 'Memory modules').detail, /2 × 8\.0 GB DDR4 at 3200 MT\/s, a matched set/);

  const mixed = rules.memory(memFacts({ layout: [{ size: 8 * GB, clockSpeed: 3200 }, { size: 16 * GB, clockSpeed: 3200 }] }));
  assert.equal(statusOf(mixed, 'Memory modules'), 'info');
  assert.match(mixed.find((i) => i.label === 'Memory modules').detail, /8\.0 GB and 16\.0 GB/);
});

table('reserved memory is mentioned once usable memory drops below 90% of installed', [
  ['16 GB installed, 14.5 GB usable', 14.5, 'absent'],
  ['16 GB installed, 14.3 GB usable', 14.3, 'info'],
], (usable) => statusOf(rules.memory(memFacts({ mem: { total: usable * GB } })), 'Usable memory'));

table('free space on a drive', [
  ['4.9% free', 4.9, 'bad'],
  ['5% free', 5, 'warn'],
  ['11.9% free', 11.9, 'warn'],
  ['12% free', 12, 'good'],
], (pct) => statusOf(rules.storage(storageFacts({ volumes: [{ mount: 'C:', size: 100 * GB, free: pct * GB }] })), 'Free space on C:'));

table('SSD wear', [
  ['69% used', 69, 'good'],
  ['70% used', 70, 'warn'],
  ['89% used', 89, 'warn'],
  ['90% used', 90, 'bad'],
], (Wear) => statusOf(rules.storage(storageFacts({ disks: [ssd({ Wear })] })), 'SSD wear'));

table('drive health as Windows reports it', [
  ['Healthy', 'Healthy', 'good'],
  ['Warning', 'Warning', 'warn'],
  ['Unhealthy', 'Unhealthy', 'bad'],
  ['missing', undefined, 'bad'],
], (Health) => statusOf(rules.storage(storageFacts({ disks: [ssd({ Health })] })), 'SSD (1000 GB)'));

test('storage: wear that Windows hides asks for administrator rights, uncorrectable errors are bad', () => {
  const items = rules.storage(storageFacts({ disks: [ssd({ Wear: null, ReadErr: 1, WriteErr: 2 })] }));
  assert.equal(statusOf(items, 'SSD wear'), 'absent');
  assert.equal(items.find((i) => i.label === 'Wear level and temperature').action.type, 'admin');
  assert.match(items.find((i) => i.label === 'Uncorrectable errors').detail, /3 read or write errors/);
});

table('battery capacity compared with new', [
  ['59%', 59000, 'bad'],
  ['60%', 60000, 'warn'],
  ['79%', 79000, 'warn'],
  ['80%', 80000, 'good'],
], (full) => statusOf(rules.battery(batteryFacts(full)), 'Battery capacity'));

test('battery capacity never reads above 100%, even when the battery reports more than its design', () => {
  const items = rules.battery(batteryFacts(105000));
  assert.match(items.find((i) => i.label === 'Battery capacity').detail, /holds 100% of the charge/);
});

test('a PC without a battery gets a single information line', () => {
  assert.deepEqual(rules.battery({ battery: { hasBattery: false } }).map((i) => i.status), ['info']);
  assert.deepEqual(rules.battery({ battery: null }).map((i) => i.status), ['info']);
});

table('internet response time (median)', [
  ['120 ms', [120, 120, 120], 'good'],
  ['121 ms', [121, 121, 121], 'warn'],
], (samples) => statusOf(rules.network(netFacts(samples)), 'Response time'));

table('internet stability (jitter)', [
  ['30 ms', [50, 80], 'good'],
  ['31 ms', [50, 81], 'warn'],
], (samples) => statusOf(rules.network(netFacts(samples)), 'Stability (jitter)'));

table('lost test connections', [
  ['none lost', [20, 20], 'good'],
  ['one of four lost', [20, null, 20, 20], 'warn'],
], (samples) => statusOf(rules.network(netFacts(samples)), 'Lost connections'));

table('Wi-Fi signal', [
  ['39%', 39, 'warn'],
  ['40%', 40, 'good'],
], (quality) => statusOf(rules.network(netFacts([20], { quality, ssid: 'home', frequency: 5180 })), 'Wi-Fi signal'));

test('a connection that answers but cannot look up names is bad', () => {
  const items = rules.network({ latency: latencyStats([20]), dnsOk: false, wifi: null });
  assert.equal(statusOf(items, 'Internet connection'), 'good');
  assert.equal(statusOf(items, 'Name lookup (DNS)'), 'bad');
});

table('video memory in use', [
  ['90%', 90, 'good'],
  ['91%', 91, 'warn'],
], (pct) => statusOf(rules.gpu({ gpus: [{ name: 'GPU', temp: 50, vramUsed: pct * GB, vramTotal: 100 * GB }], adapters: [], events: { tdr: NO_EVENTS, nv: NO_EVENTS } }), 'Video memory'));

table('graphics driver age', [
  ['11 months old', '2025-12-27', 'good'],
  ['13 months old', '2025-10-27', 'warn'],
], (date) => {
  const items = rules.gpu({ gpus: [], adapters: [{ name: 'Radeon', status: 'OK', date, version: '1' }], events: { tdr: NO_EVENTS, nv: NO_EVENTS } }, new Date('2026-11-27').getTime());
  return statusOf(items, 'Radeon driver');
});

table('Bluetooth device batteries', [
  ['21%', 21, 'absent'],
  ['20%', 20, 'warn'],
], (battery) => statusOf(rules.bluetooth({ radio: 'on', service: 'Running', adapters: [{ name: 'BT', status: 'OK' }], devices: [{ name: 'Buds', status: 'OK', connected: true, battery }] }), 'Low battery'));
