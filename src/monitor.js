// Live monitoring and the static hardware inventory ("Inside this PC").
const os = require('os');
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

const PHYSICAL_DISKS = "Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue; [pscustomobject]@{ Name=$_.FriendlyName; Media=[string]$_.MediaType; Bus=[string]$_.BusType; Health=[string]$_.HealthStatus; Op=($_.OperationalStatus -join ', '); Size=$_.Size; Wear=$r.Wear; Temp=$r.Temperature; ReadErr=$r.ReadErrorsUncorrected; WriteErr=$r.WriteErrorsUncorrected; Hours=$r.PowerOnHours } } | ConvertTo-Json -Compress";

function createMonitor({ shell = defaultShell, si = require('systeminformation'), now = Date.now } = {}) {
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
  let fsCache = { at: 0, data: [] };
  async function drives() {
    if (now() - fsCache.at < 10000) return fsCache.data;
    const list = await si.fsSize().catch(() => []);
    fsCache = {
      at: now(),
      data: list
        .filter((d) => d.size > 0 && /^[A-Z]:/i.test(d.mount || d.fs))
        .map((d) => ({ mount: d.mount || d.fs, type: d.type, size: d.size, used: d.used, free: d.size - d.used })),
    };
    return fsCache.data;
  }

  let tempCache = { at: 0, cpu: null };
  async function cpuTemp() {
    if (now() - tempCache.at < 5000) return tempCache.cpu;
    const t = await si.cpuTemperature().catch(() => ({}));
    const v = num(t.main);
    tempCache = { at: now(), cpu: v != null && v > 0 ? v : null };
    return tempCache.cpu;
  }

  let diskTempCache = { at: 0, data: [] };
  async function diskTemps() {
    if (now() - diskTempCache.at < 60000) return diskTempCache.data;
    diskTempCache.at = now(); // stamped first so overlapping ticks don't start a second PowerShell
    diskTempCache.data = (await physicalDisks()).filter((d) => d.Temp > 0).map((d) => ({ name: d.Name, temp: d.Temp }));
    return diskTempCache.data;
  }

  let batteryCache = { at: 0, data: null };
  async function battery() {
    if (now() - batteryCache.at < 15000) return batteryCache.data;
    const b = await si.battery().catch(() => null);
    batteryCache = {
      at: now(),
      data: b && b.hasBattery ? { percent: b.percent, charging: b.isCharging, plugged: b.acConnected, timeLeft: b.timeRemaining } : null,
    };
    return batteryCache.data;
  }

  /**
   * One live snapshot. `cpu`, `mem` and `battery` are null when Windows didn't answer; the arrays are always arrays.
   * `mem.percent` is the share in use, so callers don't each compute it.
   */
  async function getLive() {
    const [load, mem, speed, net, gpus, fs, temp, dtemps, batt] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.cpuCurrentSpeed().catch(() => null),
      si.networkStats('*').catch(() => []),
      nvidiaLive(),
      drives(),
      cpuTemp(),
      diskTemps(),
      battery(),
    ]);
    let rx = 0, tx = 0;
    for (const n of net) {
      if (n.operstate && n.operstate !== 'up') continue;
      rx += n.rx_sec > 0 ? n.rx_sec : 0;
      tx += n.tx_sec > 0 ? n.tx_sec : 0;
    }
    return {
      t: now(),
      uptime: os.uptime(),
      cpu: load ? { load: load.currentLoad, cores: load.cpus.map((c) => c.load), speed: speed?.avg ?? null, temp } : null,
      mem: mem ? {
        total: mem.total,
        used: mem.active,
        available: mem.available,
        percent: mem.total ? (mem.active / mem.total) * 100 : 0,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
      } : null,
      gpus,
      drives: fs,
      diskTemps: dtemps,
      net: { rx, tx },
      battery: batt,
    };
  }

  return { getStatic, getLive, drives, nvidiaLive, physicalDisks };
}

module.exports = { createMonitor, parseNvidiaCsv, ...createMonitor() };
