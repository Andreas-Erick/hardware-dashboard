const test = require('node:test');
const assert = require('node:assert/strict');
const { createHealth, rollUp } = require('../src/health');
const rules = require('../src/health/rules');
const { createProbes, eventCountScript, parseEventCounts, parseTrim } = require('../src/health/probes');
const { createShell } = require('../src/shell');
const { latencyStats } = require('../src/net-probe');
const { fakeExec } = require('./helpers');

const NO_EVENTS = { count: 0, last: null };
const GB = 1024 ** 3;
const statuses = (items, label) => items.filter((i) => i.label === label).map((i) => i.status);

test('a check that crashes is reported as unfinished, never as healthy', async () => {
  const health = createHealth({ probes: { cpu: async () => { throw new Error('WMI is not answering'); } } });
  const r = await health.runCheck('cpu');
  assert.equal(r.status, 'error');
  assert.match(r.items[0].detail, /WMI is not answering/);
});

test('a check with only information to report is not called healthy', async () => {
  const health = createHealth({ probes: { bluetooth: async () => ({ radio: 'unknown', service: null, adapters: [], devices: [] }) } });
  assert.equal((await health.runCheck('bluetooth')).status, 'info');
  assert.equal(rollUp([{ status: 'info' }, { status: 'good' }]), 'good');
  assert.equal(rollUp([{ status: 'good' }, { status: 'warn' }, { status: 'bad' }]), 'bad');
});

test('unknown checks are refused', async () => {
  await assert.rejects(createHealth({ probes: {} }).runCheck('toaster'), /no health check/);
});

test('processor temperature uses the shared thresholds', () => {
  const facts = (temp) => ({ loadSamples: [10, 12], top: [], temp, events: { whea: NO_EVENTS, power: NO_EVENTS, bsod: NO_EVENTS } });
  assert.deepEqual(statuses(rules.cpu(facts(70)), 'Processor temperature'), ['good']);
  assert.deepEqual(statuses(rules.cpu(facts(85)), 'Processor temperature'), ['warn']);
  assert.deepEqual(statuses(rules.cpu(facts(95)), 'Processor temperature'), ['bad']);
  assert.deepEqual(statuses(rules.cpu(facts(null)), 'Processor temperature'), ['info']);
});

test('processor load and crash history', () => {
  const ev = { whea: NO_EVENTS, power: { count: 2, last: '2026-11-01T10:00:00Z' }, bsod: { count: 1, last: '2026-11-01T10:00:00Z' } };
  const items = rules.cpu({ loadSamples: [90, 95], top: [{ name: 'chrome' }], temp: null, events: ev });
  assert.deepEqual(statuses(items, 'Processor load'), ['bad']);
  assert.match(items.find((i) => i.label === 'Processor load').detail, /chrome/);
  assert.deepEqual(statuses(items, 'Crashes (blue screens)'), ['bad']);
  assert.deepEqual(statuses(items, 'Unexpected shutdowns'), ['warn']);
});

test('storage: wear, temperature, free space and TRIM', () => {
  const items = rules.storage({
    disks: [{ Name: 'Samsung SSD', Media: 'SSD', Health: 'Healthy', Op: 'OK', Size: 1000 * GB, Wear: 92, Temp: 72 }],
    volumes: [{ mount: 'C:', size: 100 * GB, free: 3 * GB }, { mount: 'D:', size: 100 * GB, free: 50 * GB }],
    events: { disk: NO_EVENTS, ntfs: NO_EVENTS, nvme: NO_EVENTS },
    trim: 'off',
  });
  assert.deepEqual(statuses(items, 'SSD wear'), ['bad']);
  assert.deepEqual(statuses(items, 'Drive temperature'), ['warn']);
  assert.deepEqual(statuses(items, 'Free space on C:'), ['bad']);
  assert.deepEqual(statuses(items, 'Free space on D:'), ['good']);
  assert.deepEqual(statuses(items, 'TRIM'), ['warn']);
  assert.equal(statuses(items, 'Wear level and temperature').length, 0, 'no admin note when wear was readable');
});

test('internet: slow, jittery and lossy connections are flagged', () => {
  const items = rules.network({ latency: latencyStats([150, null, 200, 140, 260]), dnsOk: true, wifi: { quality: 30, ssid: 'home', frequency: 2412 } });
  assert.deepEqual(statuses(items, 'Response time'), ['warn']);
  assert.deepEqual(statuses(items, 'Stability (jitter)'), ['warn']);
  assert.deepEqual(statuses(items, 'Lost connections'), ['warn']);
  assert.deepEqual(statuses(items, 'Wi-Fi signal'), ['warn']);
  assert.deepEqual(statuses(items, 'Wi-Fi band'), ['info']);
  assert.deepEqual(rules.network({ latency: latencyStats([null, null]), dnsOk: false, wifi: null }).map((i) => i.status), ['bad']);
});

test('bluetooth: a disabled radio is a warning, like a radio that is off', () => {
  const b = { radio: 'disabled', service: 'Running', adapters: [{ name: 'Intel BT', status: 'OK' }], devices: [] };
  assert.deepEqual(statuses(rules.bluetooth(b), 'Bluetooth radio'), ['warn']);
});

test('drivers: old important drivers are flagged, Microsoft and virtual ones are not', () => {
  const now = new Date('2026-11-27').getTime();
  const d = (name, cls, provider, date) => ({ name, cls, provider, maker: '', date, signed: true });
  const items = rules.drivers({
    drivers: [
      d('Realtek Audio', 'MEDIA', 'Realtek', '2020-01-01'),
      d('Generic USB Hub', 'USB', 'Microsoft', '2006-06-21'),
      d('Tailscale Tunnel', 'NET', 'Tailscale', '2019-01-01'),
    ],
    problems: [],
  }, now);
  const old = items.find((i) => i.label === 'Old drivers');
  assert.equal(old.status, 'warn');
  assert.match(old.detail, /1 important driver is/);
  assert.match(old.detail, /Realtek Audio/);
});

test('graphics: driver age and the link to the maker', () => {
  const now = new Date('2026-11-27').getTime();
  const items = rules.gpu({
    gpus: [{ name: 'NVIDIA GeForce RTX 4070', temp: 88, util: 99, vramUsed: 7.5 * GB, vramTotal: 8 * GB, throttleMask: 0x20 }],
    adapters: [{ name: 'NVIDIA GeForce RTX 4070', status: 'OK', date: '2024-01-01', version: '546.33' }],
    events: { tdr: NO_EVENTS, nv: NO_EVENTS },
  }, now);
  assert.deepEqual(statuses(items, 'RTX 4070 temperature'), ['bad']);
  assert.deepEqual(statuses(items, 'Video memory'), ['warn']);
  assert.match(items.find((i) => i.label === 'Performance limits').detail, /too hot/);
  const drv = items.find((i) => i.label.endsWith('driver'));
  assert.equal(drv.status, 'warn');
  assert.equal(drv.action.key, 'nvidia-drivers');
});

test('battery capacity', () => {
  const items = rules.battery({ battery: { hasBattery: true, percent: 100, acConnected: true, isCharging: false }, design: 60000, full: 33000 });
  assert.deepEqual(statuses(items, 'Battery capacity'), ['bad']);
  assert.deepEqual(statuses(items, 'Battery care'), ['info']);
});

test('event log counts are read through the shell, and missing values count as zero', async () => {
  const queries = [{ key: 'whea', provider: 'WHEA' }, { key: 'bsod', provider: 'WER', ids: [1001] }];
  assert.match(eventCountScript(queries), /ProviderName='WER'; StartTime=\$since; Id=@\(1001\)/);
  // PowerShell writes an empty Last as {}, which the shell turns into null.
  assert.deepEqual(parseEventCounts({ whea: { Count: 3, Last: '2026-11-02T00:00:00Z' }, bsod: { Count: 0, Last: null } }, queries), {
    whea: { count: 3, last: '2026-11-02T00:00:00Z' },
    bsod: { count: 0, last: null },
  });
  assert.deepEqual(parseEventCounts(null, queries).whea, { count: 0, last: null });
});

test('TRIM state from fsutil', () => {
  assert.equal(parseTrim('NTFS DisableDeleteNotify = 0  (Allows TRIM operations to be sent to the storage device)'), 'on');
  assert.equal(parseTrim('NTFS DisableDeleteNotify = 1'), 'off');
  assert.equal(parseTrim(null), null);
});

test('the storage probe gathers facts from recorded Windows output', async () => {
  const shell = createShell({
    exec: fakeExec([
      { match: 'Get-WinEvent', stdout: { disk: { Count: 2, Last: {} }, ntfs: { Count: 0, Last: {} }, nvme: { Count: 0, Last: {} } } },
      { match: 'fsutil', stdout: 'NTFS DisableDeleteNotify = 0' },
    ]),
  });
  const probes = createProbes({
    shell,
    si: {},
    monitor: { physicalDisks: async () => [{ Name: 'SSD', Health: 'Healthy', Size: GB }], drives: async () => [] },
  });
  const facts = await probes.storage();
  assert.deepEqual(facts.events.disk, { count: 2, last: null });
  assert.equal(facts.trim, 'on');
  const items = rules.storage(facts);
  assert.deepEqual(statuses(items, 'Disk errors'), ['warn']);
});
