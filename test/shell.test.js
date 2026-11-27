const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createShell, normalize, asArray } = require('../src/shell');
const { createDrivers } = require('../src/drivers');
const { createBluetooth } = require('../src/bluetooth');
const { parseNvidiaCsv } = require('../src/monitor');
const { fakeExec } = require('./helpers');

test('failures say why: timeout, missing program, access denied, or a plain failure', async () => {
  const sh = createShell({
    exec: fakeExec([
      { match: 'slow', error: 'timeout' },
      { match: 'nvidia-smi', error: 'ENOENT' },
      { match: 'admin', error: 'x', stderr: 'Access is denied.' },
      { match: 'broken', error: 'x', stderr: 'Something exploded\nmore detail' },
    ]),
  });
  assert.equal((await sh.ps('slow')).reason, 'timeout');
  assert.equal((await sh.run('nvidia-smi', [])).reason, 'missing');
  assert.equal((await sh.ps('admin')).reason, 'denied');
  const r = await sh.ps('broken');
  assert.deepEqual([r.ok, r.reason, r.message], [false, 'failed', 'Something exploded']);
});

test('PowerShell JSON: empty output is null, {} is null, single objects stay objects', async () => {
  const sh = createShell({ exec: fakeExec([{ match: 'empty', stdout: '  ' }, { match: 'one', stdout: '{"Name":"a","Date":{}}' }, { match: 'bad', stdout: 'oops' }]) });
  assert.deepEqual(await sh.psJson('empty'), { ok: true, data: null });
  assert.deepEqual(await sh.psJson('one'), { ok: true, data: { Name: 'a', Date: null } });
  assert.equal((await sh.psJson('bad')).ok, false);
  assert.deepEqual(normalize([{}, { a: [{}] }]), [null, { a: [null] }]);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray(null), []);
});

test('script files are sent encoded and read once', async () => {
  let reads = 0;
  const exec = fakeExec([{ match: 'Write-Output hi', stdout: 'hi' }]);
  const sh = createShell({ exec, readFile: () => { reads++; return 'Write-Output hi'; } });
  assert.equal((await sh.psFile('x.ps1')).stdout, 'hi');
  await sh.psFile('x.ps1');
  assert.equal(reads, 1);
});

test('drivers: parses one driver (PowerShell sends a lone object) and leaves out unplugged devices', async () => {
  const shell = createShell({
    exec: fakeExec([
      { match: 'Win32_PnPSignedDriver', stdout: { DeviceName: 'Realtek Audio', DeviceClass: 'MEDIA', DriverProviderName: 'Realtek', IsSigned: false, Date: '2020-01-01' } },
      { match: 'Win32_PnPEntity', stdout: [{ Name: 'Old phone', ConfigManagerErrorCode: 45 }, { Name: 'Webcam', ConfigManagerErrorCode: 28 }] },
    ]),
  });
  const r = await createDrivers({ shell }).list();
  assert.deepEqual(r.drivers.map((d) => [d.name, d.signed]), [['Realtek Audio', false]]);
  assert.deepEqual(r.problems.map((p) => [p.name, p.meaning]), [['Webcam', 'No driver installed']]);
});

test('drivers: a failed or slow query is an error, not an empty list', async () => {
  const slow = createShell({ exec: fakeExec([{ match: 'Win32_PnPSignedDriver', error: 'timeout' }, { match: 'Win32_PnPEntity', stdout: '' }]) });
  await assert.rejects(createDrivers({ shell: slow }).list(), /took too long/);
  const broken = createShell({ exec: fakeExec([{ match: 'Win32_PnPSignedDriver', stdout: '[]' }, { match: 'Win32_PnPEntity', error: 'x' }]) });
  await assert.rejects(createDrivers({ shell: broken }).list(), /which devices have problems/);
});

test('drivers: two readers at once share one PowerShell run', async () => {
  const exec = fakeExec([{ match: 'Win32_PnPSignedDriver', stdout: '[]' }, { match: 'Win32_PnPEntity', stdout: '' }]);
  const drivers = createDrivers({ shell: createShell({ exec }) });
  await Promise.all([drivers.list(), drivers.list()]);
  assert.equal(exec.calls.length, 2);
});

test('bluetooth: radio states, unnamed devices and a lone adapter', async () => {
  const shell = createShell({
    readFile: () => 'bluetooth script',
    exec: fakeExec([{
      match: 'bluetooth script',
      stdout: { Radio: 'Disabled', Service: 'Running', Adapters: { Name: 'Intel BT', Status: 'OK' }, Devices: [{ Name: null, Status: 'OK', Connected: false }, { Name: 'Buds', Mac: 'A1B2C3D4E5F6', Connected: true, Battery: 15 }] },
    }]),
  });
  const b = await createBluetooth({ shell, script: path.join('x', 'bt.ps1') }).info();
  assert.equal(b.radio, 'disabled');
  assert.equal(b.adapters.length, 1);
  assert.deepEqual(b.devices.map((d) => [d.name, d.kind, d.mac]), [['Buds', 'audio', 'A1:B2:C3:D4:E5:F6'], ['Unnamed device', 'other', null]]);
});

test('bluetooth: when PowerShell fails the error says so', async () => {
  const shell = createShell({ readFile: () => 'x', exec: fakeExec([]) });
  await assert.rejects(createBluetooth({ shell }).info(), /didn't return the Bluetooth information/);
});

test('nvidia-smi CSV', () => {
  const [g] = parseNvidiaCsv('NVIDIA GeForce RTX 4070, 35, 2048, 8188, 61, 45.2, 1800, [N/A], 566.14\r\n');
  assert.deepEqual([g.name, g.util, g.vramUsed, g.temp, g.fan, g.driver], ['NVIDIA GeForce RTX 4070', 35, 2048 * 1024 * 1024, 61, null, '566.14']);
  assert.deepEqual(parseNvidiaCsv(''), []);
});
