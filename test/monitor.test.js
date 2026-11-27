const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonitor, parseNetstatBytes, counterRate } = require('../src/monitor');
const { createShell } = require('../src/shell');
const { fakeExec } = require('./helpers');

// Recorded `netstat -e` output from a German and an English Windows.
const NETSTAT_DE = `Schnittstellenstatistik

                           Empfangen           Gesendet

Bytes                    2543976462       423213711
Unicastpakete               2380293         1189402
`;
const NETSTAT_EN = 'Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                      1000000          50000\r\nUnicast packets              1234            567\r\n';

test('netstat byte counters are read in any Windows language', () => {
  assert.deepEqual(parseNetstatBytes(NETSTAT_DE), { rx: 2543976462, tx: 423213711 });
  assert.deepEqual(parseNetstatBytes(NETSTAT_EN), { rx: 1000000, tx: 50000 });
  assert.equal(parseNetstatBytes(''), null);
  assert.equal(parseNetstatBytes('Interface Statistics\n\nnothing here'), null);
});

test('network rate is bytes per second, and a wrapped counter reads as zero', () => {
  assert.deepEqual(counterRate({ rx: 1000, tx: 100, t: 0 }, { rx: 4000, tx: 400, t: 1500 }), { rx: 2000, tx: 200 });
  assert.deepEqual(counterRate({ rx: 4000, tx: 100, t: 0 }, { rx: 10, tx: 400, t: 1000 }), { rx: 0, tx: 300 });
  assert.deepEqual(counterRate(null, { rx: 1, tx: 1, t: 1 }), { rx: 0, tx: 0 });
  assert.deepEqual(counterRate({ rx: 1, tx: 1, t: 5 }, { rx: 9, tx: 9, t: 5 }), { rx: 0, tx: 0 });
});

/** A monitor whose systeminformation counts every call, on a clock the test moves. */
function rig({ battery = { hasBattery: false }, temp = {} } = {}) {
  const calls = {};
  const count = (name, value) => async () => { calls[name] = (calls[name] || 0) + 1; return value; };
  const si = {
    currentLoad: count('currentLoad', { currentLoad: 12, cpus: [{ load: 10 }, { load: 14 }] }),
    cpuCurrentSpeed: count('cpuCurrentSpeed', { avg: 3.2 }),
    fsSize: count('fsSize', [{ mount: 'C:', fs: 'C:', type: 'NTFS', size: 100, used: 40 }, { mount: '\\\\server\\share', size: 9, used: 1 }]),
    cpuTemperature: count('cpuTemperature', temp),
    battery: count('battery', battery),
    mem: count('mem', {}),
    networkStats: count('networkStats', []),
  };
  const exec = fakeExec([
    { match: 'nvidia-smi', error: 'ENOENT' },
    { match: 'Get-PhysicalDisk', stdout: '[]' },
    // Each netstat call has 3000 more bytes received and 1000 more sent than the one before.
    { match: 'netstat', get stdout() { const n = exec.calls.filter((c) => c.startsWith('netstat')).length; return `Bytes   ${n * 3000}   ${n * 1000}\n`; } },
  ]);
  let t = 1_000_000;
  const mon = createMonitor({
    si,
    shell: createShell({ exec }),
    now: () => t,
    memory: () => ({ total: 1000, free: 250 }),
    statfs: async (mount) => {
      calls.statfs = (calls.statfs || 0) + 1;
      if (mount !== 'C:') throw new Error('not a local drive');
      return { bsize: 10, blocks: 10, bfree: 4 };
    },
  });
  return { mon, calls, exec, advance: (ms) => { t += ms; } };
}

const psStarts = (exec) => exec.calls.filter((c) => c.startsWith('powershell')).length;

test('a live snapshot reads memory, drives and network without PowerShell', async () => {
  const { mon, calls, exec, advance } = rig();
  await mon.getLive();
  const firstPs = psStarts(exec);
  advance(1500);
  const l = await mon.getLive();

  assert.deepEqual(l.mem, { total: 1000, used: 750, available: 250, percent: 75 });
  assert.deepEqual(l.drives, [{ mount: 'C:', type: 'NTFS', size: 100, used: 60, free: 40 }]);
  assert.deepEqual(l.net, { rx: 2000, tx: 2000 / 3 }); // 3000 and 1000 bytes in 1.5 s
  assert.deepEqual(l.cpu, { load: 12, cores: [10, 14], speed: 3.2, temp: null });
  assert.equal(calls.mem, undefined, 'si.mem starts PowerShell on Windows');
  assert.equal(calls.networkStats, undefined, 'si.networkStats starts PowerShell on Windows');
  assert.equal(psStarts(exec), firstPs, 'the second tick starts no PowerShell');
});

test('slow sources keep their own clocks across 1.5 s ticks', async () => {
  const { mon, calls, advance } = rig({ battery: { hasBattery: true, percent: 80, isCharging: true, acConnected: true } });
  for (let i = 0; i < 40; i++) { await mon.getLive(); advance(1500); } // one minute
  assert.equal(calls.currentLoad, 40);
  assert.equal(calls.fsSize, 1, 'the drive list is made once a minute');
  assert.equal(calls.statfs, 6, 'drive sizes every 10 s, local drives only');
  assert.equal(calls.cpuTemperature, 1, 'no temperature reading: asked again after a minute');
  assert.equal(calls.battery, 2, 'a battery is read every 30 s');
});

test('a working temperature sensor is read every 10 s; no battery is asked about every 10 minutes', async () => {
  const { mon, calls, advance } = rig({ temp: { main: 55 } });
  for (let i = 0; i < 40; i++) { await mon.getLive(); advance(1500); }
  assert.equal(calls.cpuTemperature, 6);
  assert.equal(calls.battery, 1);
  assert.equal((await mon.getLive()).cpu.temp, 55);
});
