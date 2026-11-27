// Live monitoring and the static hardware inventory ("Inside this PC").
const os = require('os');
const fs = require('fs');
const { shell: defaultShell, asArray } = require('./shell');
const { isVirtualGpu } = require('../shared/hardware-rules');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output. */
function parseNvidiaCsv(out) {
  if (!out) return [];
  const mib = 1024 * 1024;
  return out.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, util, used, total, temp, power, clock, fan, driver] = line.split(',').map((s) => s.trim());
    return {
      name,
      util: num(util),
      vramUsed: num(used) != null ? num(used) * mib : null,
      vramTotal: num(total) != null ? num(total) * mib : null,
      temp: num(temp),
      power: num(power),
      clock: num(clock),
      fan: num(fan),
      driver,
    };
  });
}

/**
 * Total bytes received and sent from `netstat -e`. The bytes row is the first row with two numbers in every
 * Windows language ("Bytes", "Octets", ...), so it is found by shape rather than by its label.
 */
function parseNetstatBytes(out) {
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\S.*?\s(\d+)\s+(\d+)\s*$/);
    if (m) return { rx: Number(m[1]), tx: Number(m[2]) };
  }
  return null;
}

/** Bytes per second between two { rx, tx, t } counter readings. A counter that went backwards (it wrapped) reads as 0. */
function counterRate(prev, cur) {
  if (!prev || !cur || cur.t <= prev.t) return { rx: 0, tx: 0 };
  const s = (cur.t - prev.t) / 1000;
  const rate = (a, b) => (a >= b ? (a - b) / s : 0);
  return { rx: rate(cur.rx, prev.rx), tx: rate(cur.tx, prev.tx) };
}

const PHYSICAL_DISKS = "Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue; [pscustomobject]@{ Name=$_.FriendlyName; Media=[string]$_.MediaType; Bus=[string]$_.BusType; Health=[string]$_.HealthStatus; Op=($_.OperationalStatus -join ', '); Size=$_.Size; Wear=$r.Wear; Temp=$r.Temperature; ReadErr=$r.ReadErrorsUncorrected; WriteErr=$r.WriteErrorsUncorrected; Hours=$r.PowerOnHours } } | ConvertTo-Json -Compress";

// The live snapshot runs every 1.5 s, so it must not start PowerShell: each start costs about 0.7 s of CPU, and
// systeminformation's Windows mem(), networkStats(), fsSize(), battery() and cpuTemperature() all start one or more.
// Fast sources (os, statfs, netstat) are read every tick; the PowerShell-backed ones run on slow clocks.
function createMonitor({
  shell = defaultShell,
  si = require('systeminformation'),
  now = Date.now,
  memory = () => ({ total: os.totalmem(), free: os.freemem() }),
  statfs = (mount) => fs.promises.statfs(`${mount}\\`),
} = {}) {
  /** NVIDIA GPUs via nvidia-smi: the only reliable live source for utilisation, VRAM and temperature on Windows. */
  async function nvidiaLive() {
    const r = await shell.run('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.gr,fan.speed,driver_version',
      '--format=csv,noheader,nounits',
    ], 5000);
    return r.ok ? parseNvidiaCsv(r.stdout) : [];
  }

  /** Physical disks with Windows' health verdict. Wear and temperature need administrator rights. */
  async function physicalDisks() {
    const r = await shell.psJson(PHYSICAL_DISKS, 30000);
    return r.ok ? asArray(r.data) : [];
  }

  let staticCache = null;
  async function getStatic() {
    if (staticCache) return staticCache;
    const [cpu, system, osInfo, graphics, memLayout, diskLayout, battery] = await Promise.all([
      si.cpu(), si.system(), si.osInfo(), si.graphics().catch(() => ({ controllers: [] })),
      si.memLayout().catch(() => []), si.diskLayout().catch(() => []), si.battery().catch(() => ({})),
    ]);
    const nv = await nvidiaLive();
    const gpus = graphics.controllers
      .filter((g) => !isVirtualGpu(g.model))
      .map((g) => {
        const live = nv.find((n) => (g.model || '').includes(n.name) || n.name.includes(g.model || '---'));
        return {
          model: g.model,
          vendor: g.vendor,
          // AdapterRAM from WMI caps at 4 GB, so prefer nvidia-smi's number when we have one.
          vram: live?.vramTotal ?? (g.vram ? g.vram * 1024 * 1024 : null),
          driver: live?.driver ?? g.driverVersion ?? null,
          live: Boolean(live),
        };
      });
    staticCache = {
      hostname: os.hostname(),
      system: { manufacturer: system.manufacturer, model: system.model },
      os: { distro: osInfo.distro, release: osInfo.release, build: osInfo.build, arch: osInfo.arch },
      cpu: {
        brand: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        cores: cpu.physicalCores,
        threads: cpu.cores,
        baseSpeed: cpu.speed,
        maxSpeed: cpu.speedMax,
      },
      memory: memLayout.map((m) => ({ size: m.size, type: m.type, clock: m.clockSpeed, maker: m.manufacturer })),
      disks: diskLayout.map((d) => ({ name: d.name, type: d.type, size: d.size, iface: d.interfaceType, smart: d.smartStatus })),
      gpus,
      hasBattery: Boolean(battery.hasBattery),
    };
    return staticCache;
  }

  // Values that change slowly are refreshed on their own, slower clocks.
  // Which drives exist needs PowerShell, so that list is refreshed every minute; their sizes come from statfs, which is instant.
  let driveList = { at: -Infinity, data: [] };
  async function listDrives() {
    if (now() - driveList.at < 60000) return driveList.data;
    const list = await si.fsSize().catch(() => null);
    if (list) {
      driveList = {
        at: now(),
        data: list.filter((d) => d.size > 0 && /^[A-Z]:/i.test(d.mount || d.fs)).map((d) => ({ mount: d.mount || d.fs, type: d.type })),
      };
    }
    return driveList.data;
  }

  let fsCache = { at: -Infinity, data: [] };
  async function drives() {
    if (now() - fsCache.at < 10000) return fsCache.data;
    const sized = await Promise.all((await listDrives()).map(async ({ mount, type }) => {
      try {
        const s = await statfs(mount);
        const size = s.blocks * s.bsize, free = s.bfree * s.bsize;
        return { mount, type, size, used: size - free, free };
      } catch {
        return null; // unplugged since the list was made
      }
    }));
    fsCache = { at: now(), data: sized.filter((d) => d && d.size > 0) };
    return fsCache.data;
  }

  // Most PCs only share the CPU temperature with administrators, so without a reading it is asked for rarely.
  let tempCache = { at: -Infinity, cpu: null };
  async function cpuTemp() {
    if (now() - tempCache.at < (tempCache.cpu == null ? 60000 : 10000)) return tempCache.cpu;
    tempCache.at = now(); // stamped first so overlapping ticks don't start a second PowerShell
    const t = await si.cpuTemperature().catch(() => ({}));
    const v = num(t.main);
    tempCache.cpu = v != null && v > 0 ? v : null;
    return tempCache.cpu;
  }

  let diskTempCache = { at: -Infinity, data: [] };
  async function diskTemps() {
    if (now() - diskTempCache.at < 60000) return diskTempCache.data;
    diskTempCache.at = now(); // stamped first so overlapping ticks don't start a second PowerShell
    diskTempCache.data = (await physicalDisks()).filter((d) => d.Temp > 0).map((d) => ({ name: d.Name, temp: d.Temp }));
    return diskTempCache.data;
  }

  // A battery reading starts PowerShell three times. PCs without a battery are asked again every 10 minutes.
  let batteryCache = { at: -Infinity, data: null };
  async function battery() {
    if (now() - batteryCache.at < (batteryCache.data ? 30000 : 600000)) return batteryCache.data;
    batteryCache.at = now(); // stamped first so overlapping ticks don't start a second PowerShell
    const b = await si.battery().catch(() => null);
    batteryCache.data = b && b.hasBattery ? { percent: b.percent, charging: b.isCharging, plugged: b.acConnected, timeLeft: b.timeRemaining } : null;
    return batteryCache.data;
  }

  // Network rate from the byte counters in `netstat -e`, a native tool that answers in about 10 ms.
  let netPrev = null;
  async function netRate() {
    const r = await shell.run('netstat', ['-e'], 5000);
    const bytes = r.ok ? parseNetstatBytes(r.stdout) : null;
    if (!bytes) return { rx: 0, tx: 0 };
    const cur = { ...bytes, t: now() };
    const rate = counterRate(netPrev, cur);
    netPrev = cur;
    return rate;
  }

  /**
   * One live snapshot. `cpu`, `mem` and `battery` are null when Windows didn't answer; the arrays are always arrays.
   * `mem.percent` is the share in use, so callers don't each compute it.
   */
  async function getLive() {
    const [load, speed, net, gpus, drv, temp, dtemps, batt] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.cpuCurrentSpeed().catch(() => null),
      netRate(),
      nvidiaLive(),
      drives(),
      cpuTemp(),
      diskTemps(),
      battery(),
    ]);
    const m = memory();
    return {
      t: now(),
      uptime: os.uptime(),
      cpu: load ? { load: load.currentLoad, cores: load.cpus.map((c) => c.load), speed: speed?.avg ?? null, temp } : null,
      mem: m.total ? {
        total: m.total,
        used: m.total - m.free,
        available: m.free,
        percent: ((m.total - m.free) / m.total) * 100,
      } : null,
      gpus,
      drives: drv,
      diskTemps: dtemps,
      net,
      battery: batt,
    };
  }

  return { getStatic, getLive, drives, nvidiaLive, physicalDisks };
}

module.exports = { createMonitor, parseNvidiaCsv, parseNetstatBytes, counterRate, ...createMonitor() };
