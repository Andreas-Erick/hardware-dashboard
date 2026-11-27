const test = require('node:test');
const assert = require('node:assert/strict');
const cats = require('../shared/categories');
const R = require('../shared/hardware-rules');
const { latencyStats } = require('../src/net-probe');
const { describeInterface, mainDnsServers } = require('../src/network');

test('file categories come from one extension rule', () => {
  assert.equal(cats.category('Movie.MKV'), 'video');
  assert.equal(cats.extOf('.gitignore'), '(none)');
  assert.equal(cats.extOf('archive.'), '(none)');
  assert.equal(cats.extOf('x.reallylongextension'), '(none)');
  assert.equal(cats.category('x.reallylongextension'), 'other');
  assert.equal(cats.categoryOfExt('(none)'), 'other');
});

test('temperature levels are shared by the Overview and the health check', () => {
  assert.equal(R.tempLevel('cpu', 84), 'ok');
  assert.equal(R.tempLevel('cpu', 85), 'warm');
  assert.equal(R.tempLevel('gpu', 87), 'hot');
  assert.equal(R.tempLevel('disk', 65), 'warm');
  assert.equal(R.tempLevel('disk', 0), null);
  assert.equal(R.tempLevel('cpu', null), null);
});

test('driver rules: Microsoft drivers, age, vendor links and key drivers', () => {
  const now = new Date('2026-11-27').getTime();
  assert.equal(R.isMicrosoftDriver({ provider: '', maker: 'Microsoft' }), true);
  assert.equal(R.isOldDriver({ provider: 'Realtek', date: '2022-01-01' }, now), true);
  assert.equal(R.isOldDriver({ provider: 'Microsoft', date: '2006-01-01' }, now), false);
  assert.equal(R.isOldDriver({ provider: 'Realtek', date: null }, now), false);
  assert.equal(R.driverLink({ name: 'AMD Radeon RX 7800' }).key, 'amd-drivers');
  assert.equal(R.driverLink({ name: 'Killer Wi-Fi 6E' }).key, 'intel-drivers');
  assert.equal(R.driverLink({ name: 'Mystery device' }).key, 'optional-updates');
  const key = R.keyDrivers([
    { name: 'NVIDIA GeForce RTX 4070', cls: 'DISPLAY', provider: 'NVIDIA' },
    { name: 'Microsoft Remote Display Adapter', cls: 'DISPLAY', provider: 'Microsoft' },
    { name: 'Intel Wi-Fi 6E AX211', cls: 'NET', provider: 'Intel' },
    { name: 'Realtek Audio', cls: 'MEDIA', provider: 'Realtek' },
    { name: 'NVIDIA High Definition Audio', cls: 'MEDIA', provider: 'NVIDIA' },
  ]);
  assert.deepEqual(key.map((d) => d.name), ['NVIDIA GeForce RTX 4070', 'Intel Wi-Fi 6E AX211', 'Realtek Audio']);
});

test('latency statistics', () => {
  assert.deepEqual(latencyStats([10, null, 30, 20]), { count: 4, ok: 3, min: 10, median: 20, jitter: 15, loss: 25 });
  assert.equal(latencyStats([null]).ok, 0);
  assert.equal(latencyStats([5]).jitter, 0);
});

test('network interfaces and DNS servers are described for the Internet page', () => {
  assert.deepEqual(describeInterface({ type: 'wireless', ifaceName: 'Wi-Fi' }), { medium: 'Wi-Fi', virtual: false });
  assert.deepEqual(describeInterface({ type: 'wired', ifaceName: 'Tailscale', virtual: false }), { medium: '', virtual: true });
  assert.deepEqual(describeInterface({ type: 'wired', ifaceName: 'Ethernet 2' }), { medium: 'Cable', virtual: false });
  const dns = [{ iface: 'Wi-Fi', servers: ['192.168.1.1'] }, { iface: 'VPN', servers: ['10.0.0.1'] }];
  assert.deepEqual(mainDnsServers(dns, 'Wi-Fi'), ['192.168.1.1']);
  assert.deepEqual(mainDnsServers(dns, 'Gone'), ['192.168.1.1', '10.0.0.1']);
});
