const si = require('systeminformation');
const os = require('os');
const { run, ps, psJsonArray } = require('./util');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** NVIDIA GPUs via nvidia-smi: the only reliable live source for utilisation, VRAM and temperature on Windows. */
async function nvidiaLive() {
  const out = await run('nvidia-smi', [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.gr,fan.speed,driver_version',
    '--format=csv,noheader,nounits',
  ], 5000);
  if (!out) return [];
  return out.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, util, used, total, temp, power, clock, fan, driver] = line.split(',').map((s) => s.trim());
    const mib = 1024 * 1024;
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

let staticCache = null;
async function getStatic() {
  if (staticCache) return staticCache;
  const [cpu, system, osInfo, graphics, memLayout, diskLayout, battery] = await Promise.all([
    si.cpu(), si.system(), si.osInfo(), si.graphics().catch(() => ({ controllers: [] })),
    si.memLayout().catch(() => []), si.diskLayout().catch(() => []), si.battery().catch(() => ({})),
  ]);
  const nv = await nvidiaLive();
  const gpus = graphics.controllers
    .filter((g) => !/virtual|basic display|remote/i.test(g.model || ''))
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
  if (Date.now() - fsCache.at < 10000) return fsCache.data;
  const list = await si.fsSize().catch(() => []);
  fsCache = {
    at: Date.now(),
    data: list
      .filter((d) => d.size > 0 && /^[A-Z]:/i.test(d.mount || d.fs))
      .map((d) => ({ mount: d.mount || d.fs, type: d.type, size: d.size, used: d.used, free: d.size - d.used })),
  };
  return fsCache.data;
}

let tempCache = { at: 0, cpu: null, checked: false };
async function cpuTemp() {
  if (Date.now() - tempCache.at < 5000) return tempCache.cpu;
  const t = await si.cpuTemperature().catch(() => ({}));
  const v = num(t.main);
  tempCache = { at: Date.now(), cpu: v != null && v > 0 ? v : null, checked: true };
  return tempCache.cpu;
}

let diskTempCache = { at: 0, data: [] };
async function diskTemps() {
  if (Date.now() - diskTempCache.at < 60000) return diskTempCache.data;
  diskTempCache.at = Date.now();
  // Needs administrator rights; returns nothing otherwise.
  const out = await ps("Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue; [pscustomobject]@{ Name=$_.FriendlyName; Temp=$r.Temperature } } | ConvertTo-Json -Compress", 15000);
  diskTempCache.data = psJsonArray(out).filter((d) => d.Temp > 0).map((d) => ({ name: d.Name, temp: d.Temp }));
  return diskTempCache.data;
}

let batteryCache = { at: 0, data: null };
async function battery() {
  if (Date.now() - batteryCache.at < 15000) return batteryCache.data;
  const b = await si.battery().catch(() => null);
  batteryCache = {
    at: Date.now(),
    data: b && b.hasBattery ? { percent: b.percent, charging: b.isCharging, plugged: b.acConnected, timeLeft: b.timeRemaining } : null,
  };
  return batteryCache.data;
}

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
    t: Date.now(),
    uptime: os.uptime(),
    cpu: load && {
      load: load.currentLoad,
      cores: load.cpus.map((c) => c.load),
      speed: speed?.avg ?? null,
      temp,
    },
    mem: mem && {
      total: mem.total,
      used: mem.active,
      available: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    gpus,
    drives: fs,
    diskTemps: dtemps,
    net: { rx, tx },
    battery: batt,
  };
}

module.exports = { getStatic, getLive, drives };
