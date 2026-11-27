// Health probes: gather the facts each health rule needs from this PC.
// This is the only part of a health check that talks to Windows; tests replace it with plain objects.
const dnsPromises = require('dns').promises;
const { asArray } = require('../shell');
const { isVirtualGpu } = require('../../shared/hardware-rules');
const { tcpPing, latencyStats } = require('../net-probe');

/** PowerShell that counts System event log entries from the last 30 days. Queries are constants in this file. */
function eventCountScript(queries) {
  const parts = queries.map((q) => {
    const id = q.ids ? `; Id=@(${q.ids.join(',')})` : '';
    const lvl = q.levels ? `; Level=@(${q.levels.join(',')})` : '';
    return `$h=@{LogName='System'; ProviderName='${q.provider}'; StartTime=$since${id}${lvl}}; $e=@(Get-WinEvent -FilterHashtable $h -MaxEvents 500 -ErrorAction SilentlyContinue); $o['${q.key}']=@{Count=$e.Count; Last=$(if ($e.Count) { $e[0].TimeCreated.ToString('o') })}`;
  });
  return `$since=(Get-Date).AddDays(-30); $o=@{}; ${parts.join('; ')}; $o | ConvertTo-Json -Compress`;
}
/** { key: { count, last } } for every query, with zero for anything PowerShell left out. */
function parseEventCounts(data, queries) {
  const res = {};
  for (const q of queries) {
    const r = (data && data[q.key]) || {};
    res[q.key] = { count: r.Count || 0, last: typeof r.Last === 'string' ? r.Last : null };
  }
  return res;
}

/** Parse `fsutil behavior query DisableDeleteNotify`: 'on', 'off', or null when unknown. */
function parseTrim(out) {
  if (!out) return null;
  if (/NTFS[^\n]*=\s*0/i.test(out)) return 'on';
  if (/NTFS[^\n]*=\s*1/i.test(out)) return 'off';
  return null;
}

/** The three apps using the most of `by` ('cpu' | 'mem'), grouped by name so 30 browser processes count as one. */
function topProcesses(list, by) {
  const agg = new Map();
  for (const x of list) {
    if (!x.name || /^(system idle process|idle|system)$/i.test(x.name)) continue;
    const k = x.name.replace(/\.exe$/i, '');
    const a = agg.get(k) || { name: k, cpu: 0, mem: 0 };
    a.cpu += x.cpu || 0;
    a.mem += x.memRss ? x.memRss * 1024 : 0;
    agg.set(k, a);
  }
  return [...agg.values()].sort((a, b) => b[by] - a[by]).slice(0, 3);
}

function createProbes({
  shell = require('../shell').shell,
  si = require('systeminformation'),
  monitor = require('../monitor'),
  bluetooth = require('../bluetooth'),
  drivers = require('../drivers'),
  ping = (host) => tcpPing(host, { timeout: 2500 }),
  resolveDns = (host) => dnsPromises.resolve4(host),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const events = async (queries) => {
    const r = await shell.psJson(eventCountScript(queries), 45000);
    return parseEventCounts(r.ok ? r.data : null, queries);
  };
  const processes = async (by) => {
    const p = await si.processes().catch(() => null);
    return p ? topProcesses(p.list, by) : [];
  };

  return {
    async cpu() {
      const loadSamples = [];
      for (let i = 0; i < 5; i++) { loadSamples.push((await si.currentLoad()).currentLoad); await wait(800); }
      const [top, t, ev] = await Promise.all([
        processes('cpu'),
        si.cpuTemperature().catch(() => ({})),
        events([
          { key: 'whea', provider: 'Microsoft-Windows-WHEA-Logger' },
          { key: 'power', provider: 'Microsoft-Windows-Kernel-Power', ids: [41] },
          { key: 'bsod', provider: 'Microsoft-Windows-WER-SystemErrorReporting', ids: [1001] },
        ]),
      ]);
      return { loadSamples, top, temp: t.main > 0 ? t.main : null, events: ev };
    },

    async memory() {
      const [mem, layout, top, last] = await Promise.all([
        si.mem(),
        si.memLayout().catch(() => []),
        processes('mem'),
        shell.psJson("Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-MemoryDiagnostics-Results'} -MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object Id, @{n='T';e={$_.TimeCreated.ToString('o')}} | ConvertTo-Json -Compress", 20000),
      ]);
      const e = last.ok ? asArray(last.data)[0] : null;
      return { mem, layout, top, lastTest: e ? { id: e.Id, at: e.T } : null };
    },

    async gpu() {
      const [live, vc] = await Promise.all([
        monitor.nvidiaLive(),
        shell.psJson("Get-CimInstance Win32_VideoController | Select-Object Name, Status, @{n='Date';e={ if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } }}, DriverVersion | ConvertTo-Json -Compress", 15000),
      ]);
      let masks = [];
      if (live.length) {
        let r = await shell.run('nvidia-smi', ['--query-gpu=clocks_event_reasons.active', '--format=csv,noheader'], 5000);
        if (!r.ok || /not supported|invalid/i.test(r.stdout)) r = await shell.run('nvidia-smi', ['--query-gpu=clocks_throttle_reasons.active', '--format=csv,noheader'], 5000);
        if (r.ok) masks = r.stdout.trim().split(/\r?\n/).map((l) => parseInt(l, 16));
      }
      const ev = await events([
        { key: 'tdr', provider: 'Display', ids: [4101] },
        { key: 'nv', provider: 'nvlddmkm', levels: [1, 2] },
      ]);
      return {
        gpus: live.map((g, i) => ({ ...g, throttleMask: masks[i] })),
        adapters: (vc.ok ? asArray(vc.data) : [])
          .filter((v) => !isVirtualGpu(v.Name))
          .map((v) => ({ name: v.Name, status: v.Status, date: v.Date, version: v.DriverVersion })),
        events: ev,
      };
    },

    async storage() {
      const [disks, volumes, ev, trim] = await Promise.all([
        monitor.physicalDisks(),
        monitor.drives(),
        events([
          { key: 'disk', provider: 'disk', ids: [7, 11, 51, 153] },
          { key: 'ntfs', provider: 'Ntfs', ids: [55, 98, 137] },
          { key: 'nvme', provider: 'stornvme', ids: [11] },
        ]),
        shell.run('fsutil', ['behavior', 'query', 'DisableDeleteNotify'], 5000),
      ]);
      return { disks, volumes, events: ev, trim: parseTrim(trim.ok ? trim.stdout : null) };
    },

    async battery() {
      const b = await si.battery().catch(() => null);
      let design = b && b.designedCapacity, full = b && b.maxCapacity;
      if (b && b.hasBattery && (!design || !full)) {
        const w = await shell.psJson("$s=Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1; $f=Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1; @{Design=$s.DesignedCapacity; Full=$f.FullChargedCapacity} | ConvertTo-Json -Compress", 10000);
        if (w.ok && w.data) { design = design || w.data.Design; full = full || w.data.Full; }
      }
      return { battery: b, design: design || null, full: full || null };
    },

    async network() {
      const samples = [];
      for (let i = 0; i < 12; i++) { samples.push(await ping(i % 2 ? '1.1.1.1' : '8.8.8.8')); await wait(150); }
      const [dnsOk, wifi] = await Promise.all([
        resolveDns('microsoft.com').then(() => true, () => false),
        si.wifiConnections().catch(() => []),
      ]);
      const w = wifi[0];
      return { latency: latencyStats(samples), dnsOk, wifi: w ? { quality: w.quality, ssid: w.ssid, frequency: w.frequency } : null };
    },

    bluetooth: () => bluetooth.info(true),
    drivers: () => drivers.list(),
  };
}

module.exports = { createProbes, eventCountScript, parseEventCounts, parseTrim, topProcesses };
