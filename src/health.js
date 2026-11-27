// Health checks: one function per hardware part. Each returns plain-language findings:
// { status: 'good' | 'warn' | 'bad' | 'info', label, detail, fix?, action? }
const si = require('systeminformation');
const net = require('net');
const dns = require('dns').promises;
const { run, ps, psJson, psJsonArray } = require('./util');
const monitor = require('./monitor');
const bluetooth = require('./bluetooth');
const drivers = require('./drivers');

const G = (label, detail, extra) => ({ status: 'good', label, detail, ...extra });
const W = (label, detail, extra) => ({ status: 'warn', label, detail, ...extra });
const B = (label, detail, extra) => ({ status: 'bad', label, detail, ...extra });
const I = (label, detail, extra) => ({ status: 'info', label, detail, ...extra });
const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Count System event log entries from the last 30 days. Queries are constants defined below. */
async function eventCounts(queries) {
  const parts = queries.map((q) => {
    const id = q.ids ? `; Id=@(${q.ids.join(',')})` : '';
    const lvl = q.levels ? `; Level=@(${q.levels.join(',')})` : '';
    return `$h=@{LogName='System'; ProviderName='${q.provider}'; StartTime=$since${id}${lvl}}; $e=@(Get-WinEvent -FilterHashtable $h -MaxEvents 500 -ErrorAction SilentlyContinue); $o['${q.key}']=@{Count=$e.Count; Last=$(if ($e.Count) { $e[0].TimeCreated.ToString('o') })}`;
  });
  const out = await ps(`$since=(Get-Date).AddDays(-30); $o=@{}; ${parts.join('; ')}; $o | ConvertTo-Json -Compress`, 45000);
  const r = psJson(out) || {};
  const res = {};
  // PowerShell turns an empty value into {} in JSON, so only accept real strings.
  for (const q of queries) res[q.key] = { count: r[q.key]?.Count || 0, last: typeof r[q.key]?.Last === 'string' ? r[q.key].Last : null };
  return res;
}
const when = (iso) => (iso ? `, most recently on ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '');

async function topProcesses(by) {
  const p = await si.processes().catch(() => null);
  if (!p) return [];
  // Group by name so 30 browser processes count as one browser.
  const agg = new Map();
  for (const x of p.list) {
    if (!x.name || /^(system idle process|idle|system)$/i.test(x.name)) continue;
    const k = x.name.replace(/\.exe$/i, '');
    const a = agg.get(k) || { name: k, cpu: 0, mem: 0 };
    a.cpu += x.cpu || 0;
    a.mem += x.memRss ? x.memRss * 1024 : 0;
    agg.set(k, a);
  }
  return [...agg.values()].sort((a, b) => b[by] - a[by]).slice(0, 3);
}

// ---------------- Processor & stability ----------------
async function cpu() {
  const items = [];
  const samples = [];
  for (let i = 0; i < 5; i++) { const l = await si.currentLoad(); samples.push(l.currentLoad); await wait(800); }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const top = await topProcesses('cpu');
  const topTxt = top.length ? ` Busiest right now: ${top.map((t) => t.name).join(', ')}.` : '';
  if (avg > 85) items.push(B('Processor load', `Your processor averaged ${avg.toFixed(0)}% over 4 seconds, which slows everything down.${topTxt}`, { fix: 'Close apps you are not using, or look in Task Manager for a program stuck at high usage.', action: { type: 'tool', key: 'taskmgr', label: 'Open Task Manager' } }));
  else if (avg > 60) items.push(W('Processor load', `Your processor averaged ${avg.toFixed(0)}% over 4 seconds. That's fine during games or exports, unusual when idle.${topTxt}`, { action: { type: 'tool', key: 'taskmgr', label: 'Open Task Manager' } }));
  else items.push(G('Processor load', `Averaged ${avg.toFixed(0)}% over 4 seconds${avg < 30 ? ', plenty of headroom' : ', a normal level'}.${topTxt}`));

  const t = await si.cpuTemperature().catch(() => ({}));
  if (t.main > 0) {
    if (t.main >= 95) items.push(B('Processor temperature', `${Math.round(t.main)} °C is at the limit where the processor slows itself down to avoid damage.`, { fix: 'Make sure the air vents are free, clean out dust, and use the laptop on a hard surface.' }));
    else if (t.main >= 85) items.push(W('Processor temperature', `${Math.round(t.main)} °C is hot. Fine for a short burst of heavy work, not for idle.`, { fix: 'Check that the vents are not blocked.' }));
    else items.push(G('Processor temperature', `${Math.round(t.main)} °C is a normal temperature.`));
  } else {
    items.push(I('Processor temperature', 'Windows did not share the temperature sensor. Restart Hardware Dashboard as administrator to try again.', { action: { type: 'admin', label: 'Restart as administrator' } }));
  }

  const ev = await eventCounts([
    { key: 'whea', provider: 'Microsoft-Windows-WHEA-Logger' },
    { key: 'power', provider: 'Microsoft-Windows-Kernel-Power', ids: [41] },
    { key: 'bsod', provider: 'Microsoft-Windows-WER-SystemErrorReporting', ids: [1001] },
  ]);
  if (ev.whea.count) items.push(W('Hardware errors', `Windows logged ${plural(ev.whea.count, 'hardware error report')} in the last 30 days${when(ev.whea.last)}. These come from the processor, memory or PCIe devices and were corrected automatically, but repeated ones can point to overheating, unstable overclocking or failing hardware.`, { fix: 'If you overclock or undervolt, go back to default settings. If errors keep appearing, run the memory test.' }));
  else items.push(G('Hardware errors', 'No hardware error reports in the last 30 days.'));
  if (ev.bsod.count) items.push(B('Crashes (blue screens)', `Windows crashed ${plural(ev.bsod.count, 'time')} in the last 30 days${when(ev.bsod.last)}.`, { fix: 'Update your graphics and chipset drivers first; they cause most blue screens. Check the Drivers page.', action: { type: 'goto', key: 'drivers', label: 'Go to Drivers' } }));
  else items.push(G('Crashes (blue screens)', 'No blue screens in the last 30 days.'));
  if (ev.power.count > ev.bsod.count) items.push(W('Unexpected shutdowns', `The PC turned off without shutting down properly ${plural(ev.power.count, 'time')} in the last 30 days${when(ev.power.last)}. This happens after a crash, a power cut, holding the power button, or overheating.`));
  else if (!ev.power.count) items.push(G('Unexpected shutdowns', 'Every shutdown in the last 30 days was a normal one.'));
  return items;
}

// ---------------- Memory ----------------
async function memory() {
  const items = [];
  const [m, layout, top] = await Promise.all([si.mem(), si.memLayout().catch(() => []), topProcesses('mem')]);
  const p = (m.active / m.total) * 100;
  const topTxt = top.length ? ` Using the most: ${top.map((t) => `${t.name} (${gb(t.mem)})`).join(', ')}.` : '';
  if (p >= 90) items.push(B('Memory in use', `${p.toFixed(0)}% of your memory is in use. Windows is moving data to the much slower disk, which makes everything sluggish.${topTxt}`, { fix: 'Close apps or browser tabs you are not using.', action: { type: 'tool', key: 'taskmgr', label: 'Open Task Manager' } }));
  else if (p >= 80) items.push(W('Memory in use', `${p.toFixed(0)}% of your memory is in use. Opening more apps may slow things down.${topTxt}`));
  else items.push(G('Memory in use', `${p.toFixed(0)}% in use, ${gb(m.available)} free.${topTxt}`));

  if (m.swaptotal > 0) {
    const sp = (m.swapused / m.swaptotal) * 100;
    if (sp > 80) items.push(W('Page file', `The page file (overflow memory on disk) is ${sp.toFixed(0)}% full.`, { fix: 'Close memory-hungry apps. If this happens often, more RAM would help.' }));
    else items.push(G('Page file', `The overflow memory on disk is ${sp.toFixed(0)}% used.`));
  }

  if (layout.length) {
    const installed = layout.reduce((a, x) => a + x.size, 0);
    const speeds = new Set(layout.map((x) => x.clockSpeed));
    const sizes = new Set(layout.map((x) => x.size));
    if (layout.length > 1 && (speeds.size > 1 || sizes.size > 1)) items.push(I('Memory modules', `Your ${layout.length} memory modules are not identical (${[...sizes].map(gb).join(' and ')}). They work, but matched pairs are slightly faster.`));
    else items.push(G('Memory modules', `${layout.length} × ${gb(layout[0].size)} ${layout[0].type || ''}${layout[0].clockSpeed ? ` at ${layout[0].clockSpeed} MT/s` : ''}${layout.length > 1 ? ', a matched set running in dual channel' : ''}.`));
    if (m.total < installed * 0.9) items.push(I('Usable memory', `${gb(installed)} installed, ${gb(m.total)} usable. The rest is reserved for built-in graphics or hardware.`));
  }

  const last = psJsonArray(await ps("Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-MemoryDiagnostics-Results'} -MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object Id, @{n='T';e={$_.TimeCreated.ToString('o')}} | ConvertTo-Json -Compress", 20000))[0];
  const mdsched = { type: 'tool', key: 'mdsched', label: 'Schedule a memory test' };
  if (!last) items.push(I('Memory test', 'No memory test has been run on this PC. It checks every memory cell for faults and takes about 15 minutes after a restart.', { action: mdsched }));
  else if (last.Id === 1202 || last.Id === 2002) items.push(B('Memory test', `The last Windows memory test (${new Date(last.T).toLocaleDateString('en-GB')}) found errors. Faulty memory causes random crashes and corrupted files.`, { fix: 'Contact your PC maker about replacing the memory, or reseat it if you installed it yourself.', action: mdsched }));
  else items.push(G('Memory test', `The last Windows memory test (${new Date(last.T).toLocaleDateString('en-GB')}) found no errors.`, { action: mdsched }));
  return items;
}

// ---------------- Graphics ----------------
const THROTTLE = { 0x8: 'the hardware is slowing it down', 0x20: 'it is too hot (software limit)', 0x40: 'it is too hot (hardware limit)', 0x80: 'the power supply is limiting it' };
async function gpu() {
  const items = [];
  const live = (await monitor.getLive()).gpus;
  const vc = psJsonArray(await ps("Get-CimInstance Win32_VideoController | Select-Object Name, Status, @{n='Date';e={ if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } }}, DriverVersion | ConvertTo-Json -Compress", 15000))
    .filter((v) => !/virtual|remote|basic display|superdisplay/i.test(v.Name || ''));

  for (const g of live) {
    const name = g.name.replace('NVIDIA GeForce ', '');
    if (g.temp != null) {
      if (g.temp >= 87) items.push(B(`${name} temperature`, `${g.temp} °C is very hot. The GPU will slow down to protect itself.`, { fix: 'Clean the vents and fans, and make sure air can flow under the laptop.' }));
      else if (g.temp >= 80) items.push(W(`${name} temperature`, `${g.temp} °C is warm. Normal while gaming, worth watching otherwise.`));
      else items.push(G(`${name} temperature`, `${g.temp} °C is a healthy temperature${g.util != null ? ` at ${g.util}% load` : ''}.`));
    }
    if (g.vramTotal) {
      const vp = (g.vramUsed / g.vramTotal) * 100;
      if (vp > 90) items.push(W('Video memory', `${vp.toFixed(0)}% of the video memory is in use. Games may stutter or lower their texture quality.`, { fix: 'Close other apps that use the GPU, or lower texture settings in games.' }));
      else items.push(G('Video memory', `${gb(g.vramUsed)} of ${gb(g.vramTotal)} in use.`));
    }
    let reasons = await run('nvidia-smi', ['--query-gpu=clocks_event_reasons.active', '--format=csv,noheader'], 5000);
    if (!reasons || /not supported|invalid/i.test(reasons)) reasons = await run('nvidia-smi', ['--query-gpu=clocks_throttle_reasons.active', '--format=csv,noheader'], 5000);
    const mask = reasons ? parseInt(reasons.trim().split(/\r?\n/)[0], 16) : NaN;
    if (Number.isFinite(mask)) {
      const why = Object.entries(THROTTLE).filter(([bit]) => mask & Number(bit)).map(([, t]) => t);
      if (why.length) items.push(W('Performance limits', `Right now the GPU is running slower because ${why.join(' and ')}.`, { fix: 'Plug in the charger and pick a performance power mode in your laptop maker’s app. If heat is the cause, clean the vents.' }));
      else items.push(G('Performance limits', 'Nothing is holding the GPU back right now.'));
    }
  }
  if (!live.length) items.push(I('Live graphics data', 'Detailed GPU readings are only available for NVIDIA graphics cards.'));

  for (const v of vc) {
    if (v.Status && v.Status !== 'OK') items.push(B(`${v.Name}`, `Windows reports the status "${v.Status}" for this graphics adapter.`, { action: { type: 'tool', key: 'devmgmt', label: 'Open Device Manager' } }));
    if (v.Date) {
      const months = (Date.now() - new Date(v.Date)) / (30.44 * 86400000);
      const link = /nvidia/i.test(v.Name) ? 'nvidia-drivers' : /amd|radeon/i.test(v.Name) ? 'amd-drivers' : 'intel-drivers';
      if (months > 12) items.push(W(`${v.Name} driver`, `Version ${v.DriverVersion} is ${Math.floor(months / 12)}+ years old. Newer drivers fix bugs and speed up recent games.`, { action: { type: 'link', key: link, label: 'Get the latest driver' } }));
      else items.push(G(`${v.Name} driver`, `Version ${v.DriverVersion}, ${Math.max(1, Math.round(months))} months old.`, { action: { type: 'link', key: link, label: 'Check for a newer one' } }));
    }
  }

  const ev = await eventCounts([
    { key: 'tdr', provider: 'Display', ids: [4101] },
    { key: 'nv', provider: 'nvlddmkm', levels: [1, 2] },
  ]);
  const crashes = ev.tdr.count + ev.nv.count;
  if (crashes) items.push(W('Graphics driver crashes', `The graphics driver stopped responding ${plural(crashes, 'time')} in the last 30 days${when(ev.tdr.last || ev.nv.last)}. You may have seen the screen go black for a moment.`, { fix: 'Install the latest driver with a clean install. If it keeps happening, remove any GPU overclock.' }));
  else items.push(G('Graphics driver crashes', 'The graphics driver ran without crashing in the last 30 days.'));
  return items;
}

// ---------------- Storage ----------------
async function storage() {
  const items = [];
  const disks = psJsonArray(await ps("Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue; [pscustomobject]@{ Name=$_.FriendlyName; Media=[string]$_.MediaType; Bus=[string]$_.BusType; Health=[string]$_.HealthStatus; Op=($_.OperationalStatus -join ', '); Size=$_.Size; Wear=$r.Wear; Temp=$r.Temperature; ReadErr=$r.ReadErrorsUncorrected; WriteErr=$r.WriteErrorsUncorrected; Hours=$r.PowerOnHours } } | ConvertTo-Json -Compress", 30000));
  let needAdmin = false;
  for (const d of disks) {
    const label = `${d.Name} (${gb(d.Size).replace('.0 GB', ' GB')})`;
    if (d.Health === 'Healthy') items.push(G(label, `Windows reports this ${d.Media === 'SSD' ? 'SSD' : 'drive'} as healthy.${d.Op && d.Op !== 'OK' ? ` Status: ${d.Op}.` : ''}`));
    else if (d.Health === 'Warning') items.push(W(label, `Windows reports a warning for this drive (${d.Op}).`, { fix: 'Back up your important files now and consider replacing the drive.' }));
    else items.push(B(label, `Windows reports this drive as ${d.Health || 'unknown'} (${d.Op}).`, { fix: 'Back up your files immediately. The drive may fail soon.' }));
    if (d.Wear != null) {
      const left = 100 - d.Wear;
      if (d.Wear >= 90) items.push(B('SSD wear', `This SSD has used ${d.Wear}% of its rated lifespan.`, { fix: 'Plan to replace it and keep backups current.' }));
      else if (d.Wear >= 70) items.push(W('SSD wear', `This SSD has used ${d.Wear}% of its rated lifespan; about ${left}% remains.`));
      else items.push(G('SSD wear', `${left}% of the rated lifespan remains${d.Hours ? ` after ${Math.round(d.Hours).toLocaleString('en-US')} hours of use` : ''}.`));
    } else needAdmin = true;
    if (d.Temp > 0) {
      if (d.Temp >= 70) items.push(W('Drive temperature', `${d.Temp} °C is hot for an SSD. It will slow down to cool off.`));
      else items.push(G('Drive temperature', `${d.Temp} °C is normal.`));
    }
    if ((d.ReadErr || 0) + (d.WriteErr || 0) > 0) items.push(B('Uncorrectable errors', `The drive reported ${(d.ReadErr || 0) + (d.WriteErr || 0)} read or write errors it could not fix.`, { fix: 'Back up your files and contact the manufacturer.' }));
  }
  if (needAdmin) items.push(I('Wear level and temperature', 'Windows only shares SSD wear and temperature with apps running as administrator.', { action: { type: 'admin', label: 'Restart as administrator' } }));

  for (const v of await monitor.drives()) {
    const free = (v.free / v.size) * 100;
    const act = { type: 'goto', key: 'storage', label: 'See what uses space' };
    if (free < 5) items.push(B(`Free space on ${v.mount}`, `Only ${gb(v.free)} (${free.toFixed(0)}%) left. Windows updates can fail and the PC slows down when a drive is this full.`, { action: act }));
    else if (free < 12) items.push(W(`Free space on ${v.mount}`, `${gb(v.free)} (${free.toFixed(0)}%) left. Try to keep at least 10–15% free.`, { action: act }));
    else items.push(G(`Free space on ${v.mount}`, `${gb(v.free)} free (${free.toFixed(0)}%).`));
  }

  const ev = await eventCounts([
    { key: 'disk', provider: 'disk', ids: [7, 11, 51, 153] },
    { key: 'ntfs', provider: 'Ntfs', ids: [55, 98, 137] },
    { key: 'nvme', provider: 'stornvme', ids: [11] },
  ]);
  const n = ev.disk.count + ev.ntfs.count + ev.nvme.count;
  if (n) items.push(W('Disk errors', `Windows logged ${plural(n, 'disk or file system error')} in the last 30 days${when(ev.disk.last || ev.ntfs.last || ev.nvme.last)}. A few after a sudden power loss are normal; a steady stream is not.`, { fix: 'Back up important files. Run “chkdsk C: /scan” in an administrator terminal to check the file system.' }));
  else items.push(G('Disk errors', 'No disk or file system errors in the last 30 days.'));

  const trim = await run('fsutil', ['behavior', 'query', 'DisableDeleteNotify'], 5000);
  if (trim && /NTFS[^\n]*=\s*0/i.test(trim)) items.push(G('TRIM', 'TRIM is on, so Windows tells the SSD which blocks are free. This keeps it fast.'));
  else if (trim && /NTFS[^\n]*=\s*1/i.test(trim)) items.push(W('TRIM', 'TRIM is turned off, which makes SSDs slower over time.', { fix: 'Run “fsutil behavior set DisableDeleteNotify 0” in an administrator terminal.' }));
  return items;
}

// ---------------- Battery ----------------
async function battery() {
  const items = [];
  const b = await si.battery().catch(() => null);
  if (!b || !b.hasBattery) return [I('Battery', 'This PC has no battery.')];
  let design = b.designedCapacity, full = b.maxCapacity;
  if (!design || !full) {
    const w = psJson(await ps("$s=Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1; $f=Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1; @{Design=$s.DesignedCapacity; Full=$f.FullChargedCapacity} | ConvertTo-Json -Compress", 10000));
    if (w) { design = design || w.Design; full = full || w.Full; }
  }
  const report = { type: 'battery-report', label: 'Open the full battery report' };
  if (design && full) {
    const health = Math.min(100, (full / design) * 100);
    const txt = `It now holds ${health.toFixed(0)}% of the charge it held when new (${(full / 1000).toFixed(1)} of ${(design / 1000).toFixed(1)} Wh).`;
    if (health < 60) items.push(B('Battery capacity', `${txt} Expect much shorter time on battery.`, { fix: 'Your PC maker can replace the battery.', action: report }));
    else if (health < 80) items.push(W('Battery capacity', `${txt} This is normal wear after a few years.`, { action: report }));
    else items.push(G('Battery capacity', txt, { action: report }));
  } else items.push(I('Battery capacity', 'Windows did not report the battery capacity here. The full battery report has it.', { action: report }));
  if (b.cycleCount) items.push(I('Charge cycles', `${b.cycleCount} full charge cycles so far. Most laptop batteries are rated for 500–1000.`));
  items.push(I('Charging', `${b.percent}%${b.isCharging ? ', charging' : b.acConnected ? ', plugged in' : ', on battery'}${b.timeRemaining > 0 ? `, about ${Math.floor(b.timeRemaining / 60)} h ${b.timeRemaining % 60} min left` : ''}.`));
  if (b.acConnected && b.percent >= 99) items.push(I('Battery care', 'Your laptop is plugged in at full charge. If you leave it plugged in most of the time, turn on the charge limit (often 80%) in your laptop maker’s app. This makes the battery last years longer.'));
  return items;
}

// ---------------- Network ----------------
function tcpPing(host, timeout = 2500) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const s = net.connect({ host, port: 443 });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(null));
    s.once('error', () => done(null));
    s.once('connect', () => done(Number(process.hrtime.bigint() - t0) / 1e6));
  });
}
async function network() {
  const items = [];
  const pings = [];
  for (let i = 0; i < 12; i++) { pings.push(await tcpPing(i % 2 ? '1.1.1.1' : '8.8.8.8')); await wait(150); }
  const ok = pings.filter((p) => p != null);
  const resolved = await dns.resolve4('microsoft.com').then(() => true).catch(() => false);
  if (!ok.length) return [B('Internet connection', "This PC can't reach the internet.", { fix: 'Check that Wi-Fi is on or the cable is plugged in, then restart your router.', action: { type: 'link', key: 'network-settings', label: 'Open network settings' } })];
  items.push(G('Internet connection', 'Connected to the internet.'));
  items.push(resolved ? G('Name lookup (DNS)', 'Websites can be found by name.') : B('Name lookup (DNS)', "Website names can't be looked up, so pages won't load even though you're connected.", { fix: 'Restart your router, or set the DNS server to 1.1.1.1 in network settings.' }));
  const sorted = [...ok].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  let jit = 0; for (let i = 1; i < ok.length; i++) jit += Math.abs(ok[i] - ok[i - 1]);
  jit /= Math.max(1, ok.length - 1);
  const loss = ((pings.length - ok.length) / pings.length) * 100;
  if (med > 120) items.push(W('Response time', `${med.toFixed(0)} ms is slow. Video calls and online games will feel laggy.`, { fix: 'Move closer to the router or use a cable.' }));
  else items.push(G('Response time', `${med.toFixed(0)} ms${med < 40 ? ', great for gaming and calls' : ''}.`));
  if (jit > 30) items.push(W('Stability (jitter)', `Response time varies by ${jit.toFixed(0)} ms between checks, which causes choppy calls and rubber-banding in games.`, { fix: 'Wi-Fi interference is the usual cause. Try the 5 GHz band or a cable.' }));
  else items.push(G('Stability (jitter)', `Steady, varying by only ${jit.toFixed(0)} ms.`));
  if (loss > 0) items.push(W('Lost connections', `${loss.toFixed(0)}% of test connections failed.`, { fix: 'Restart your router. If it persists, contact your internet provider.' }));
  else items.push(G('Lost connections', 'All 12 test connections succeeded.'));

  const wifi = (await si.wifiConnections().catch(() => []))[0];
  if (wifi) {
    if (wifi.quality < 40) items.push(W('Wi-Fi signal', `${wifi.quality}% on “${wifi.ssid}”. A weak signal lowers speed and drops connections.`, { fix: 'Move closer to the router or remove obstacles between you.' }));
    else items.push(G('Wi-Fi signal', `${wifi.quality}% on “${wifi.ssid}”.`));
    if (wifi.frequency && wifi.frequency < 3000) items.push(I('Wi-Fi band', 'You are on the 2.4 GHz band. If your router offers 5 or 6 GHz, it is usually much faster at short range.'));
  }
  return items;
}

// ---------------- Bluetooth ----------------
async function bt() {
  const items = [];
  const b = await bluetooth.info(true);
  const settings = { type: 'link', key: 'bluetooth-settings', label: 'Open Bluetooth settings' };
  if (!b.ok || !b.adapters.length) return [I('Bluetooth adapter', 'No Bluetooth adapter was found.', { action: settings })];
  for (const a of b.adapters) {
    if (a.status === 'OK') items.push(G(a.name, `Working${a.version ? `, driver ${a.version}` : ''}.`));
    else items.push(B(a.name, `Windows reports a problem with the Bluetooth adapter (status ${a.status}).`, { fix: 'Restart the PC. If that doesn’t help, reinstall the driver in Device Manager.', action: { type: 'tool', key: 'devmgmt', label: 'Open Device Manager' } }));
  }
  if (b.radio === 'Off') items.push(W('Bluetooth radio', 'Bluetooth is turned off, so no devices can connect.', { action: settings }));
  else if (b.radio === 'On') items.push(G('Bluetooth radio', 'Bluetooth is on.'));
  if (b.service && b.service !== 'Running') items.push(B('Bluetooth service', 'The Windows Bluetooth service is not running.', { fix: 'Restart the PC to start it again.' }));
  else if (b.service) items.push(G('Bluetooth service', 'The Windows Bluetooth service is running.'));
  const broken = b.devices.filter((d) => d.status !== 'OK' && d.status !== 'Unknown');
  if (broken.length) items.push(W('Device problems', `${broken.map((d) => d.name).join(', ')} ${broken.length === 1 ? 'has' : 'have'} a problem.`, { fix: 'Remove the device in Bluetooth settings and pair it again.', action: settings }));
  const low = b.devices.filter((d) => d.connected && d.battery != null && d.battery <= 20);
  if (low.length) items.push(W('Low battery', `${low.map((d) => `${d.name} (${d.battery}%)`).join(', ')}.`, { fix: 'Charge soon to avoid it disconnecting.' }));
  const conn = b.devices.filter((d) => d.connected);
  items.push(I('Paired devices', `${plural(b.devices.length, 'device')} paired, ${conn.length} connected now${conn.length ? `: ${conn.map((d) => d.name).join(', ')}` : ''}.`));
  return items;
}

// ---------------- Drivers ----------------
async function drv() {
  const items = [];
  const r = await drivers.list();
  if (!r.ok) return [I('Drivers', "Windows didn't return the driver list. Try again in a moment.")];
  if (r.problems.length) items.push(B('Devices with problems', r.problems.map((p) => `${p.name}: ${p.meaning}`).join('. ') + '.', { fix: 'Open Device Manager, right-click the device, and choose Update driver or Uninstall device and restart.', action: { type: 'tool', key: 'devmgmt', label: 'Open Device Manager' } }));
  else items.push(G('Devices with problems', 'Every device has a working driver.'));
  const vendor = r.drivers.filter((d) => !/^microsoft$/i.test(d.provider));
  const old = vendor.filter((d) => d.date && (Date.now() - new Date(d.date)) / (365.25 * 86400000) >= 3);
  // Virtual adapters (VPNs, streaming, screen sharing) rarely get updates and don't affect hardware health.
  const VIRTUAL = /virtual|steam streaming|tailscale|wintun|tap-|vpn|wireguard|superdisplay|hyper-v|vmware|virtualbox|parsec|loopback/i;
  const important = old.filter((d) => /^(DISPLAY|NET|MEDIA|BLUETOOTH|SYSTEM|HDC|SCSIADAPTER)$/i.test(d.cls) && !VIRTUAL.test(d.name));
  if (important.length) items.push(W('Old drivers', `${plural(important.length, 'important driver')} ${important.length === 1 ? 'is' : 'are'} more than three years old: ${important.slice(0, 4).map((d) => d.name).join(', ')}${important.length > 4 ? ' and more' : ''}.`, { fix: 'Look for updates in optional Windows updates or on your PC maker’s support site.', action: { type: 'link', key: 'optional-updates', label: 'Optional Windows updates' } }));
  else if (old.length) items.push(G('Old drivers', `${plural(old.length, 'minor driver')} ${old.length === 1 ? 'is' : 'are'} more than three years old. That is normal for parts that don’t change.`));
  else items.push(G('Old drivers', 'All hardware makers’ drivers are less than three years old.'));
  const unsigned = r.drivers.filter((d) => !d.signed);
  if (unsigned.length) items.push(W('Unsigned drivers', `${plural(unsigned.length, 'driver')} ${unsigned.length === 1 ? 'is' : 'are'} not digitally signed: ${unsigned.slice(0, 3).map((d) => d.name).join(', ')}. Unsigned drivers can't be verified as coming from the maker.`));
  else items.push(G('Unsigned drivers', 'Every driver is digitally signed.'));
  items.push(I('Installed drivers', `${r.drivers.length} in total, ${vendor.length} from hardware makers.`));
  return items;
}

const CHECKS = { cpu, memory, gpu, storage, battery, network, bluetooth: bt, drivers: drv };

async function runCheck(id) {
  const fn = CHECKS[id];
  if (!fn) throw new Error('Unknown check');
  const t = Date.now();
  let items;
  try { items = await fn(); }
  catch (e) { items = [I('Check could not finish', `Something went wrong while checking: ${e.message}`)]; }
  const status = items.some((i) => i.status === 'bad') ? 'bad' : items.some((i) => i.status === 'warn') ? 'warn' : 'good';
  return { id, status, items, at: Date.now(), ms: Date.now() - t };
}

module.exports = { runCheck, ids: Object.keys(CHECKS) };
