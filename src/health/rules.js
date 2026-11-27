// Health rules: facts in, Findings out. Pure, so every threshold can be tested with plain objects.
// A Finding is { status: 'good' | 'warn' | 'bad' | 'info', label, detail, fix?, action? }.
// An action is { type: 'tool' | 'link' | 'goto' | 'admin' | 'battery-report', key?, label }.
const R = require('../../shared/hardware-rules');

const G = (label, detail, extra) => ({ status: 'good', label, detail, ...extra });
const W = (label, detail, extra) => ({ status: 'warn', label, detail, ...extra });
const B = (label, detail, extra) => ({ status: 'bad', label, detail, ...extra });
const I = (label, detail, extra) => ({ status: 'info', label, detail, ...extra });
const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const when = (iso) => (iso ? `, most recently on ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '');
const MONTH = 30.44 * 86400000;

const TASKMGR = { type: 'tool', key: 'taskmgr', label: 'Open Task Manager' };
const DEVMGMT = { type: 'tool', key: 'devmgmt', label: 'Open Device Manager' };
const ADMIN = { type: 'admin', label: 'Restart as administrator' };

// ---------------- Processor & stability ----------------
// facts: { loadSamples: number[], top: [{ name }], temp: °C | null, events: { whea, power, bsod: { count, last } } }
function cpu({ loadSamples, top, temp, events: ev }) {
  const items = [];
  const avg = loadSamples.reduce((a, b) => a + b, 0) / loadSamples.length;
  const topTxt = top.length ? ` Busiest right now: ${top.map((t) => t.name).join(', ')}.` : '';
  if (avg > 85) items.push(B('Processor load', `Your processor averaged ${avg.toFixed(0)}% over 4 seconds, which slows everything down.${topTxt}`, { fix: 'Close apps you are not using, or look in Task Manager for a program stuck at high usage.', action: TASKMGR }));
  else if (avg > 60) items.push(W('Processor load', `Your processor averaged ${avg.toFixed(0)}% over 4 seconds. That's fine during games or exports, unusual when idle.${topTxt}`, { action: TASKMGR }));
  else items.push(G('Processor load', `Averaged ${avg.toFixed(0)}% over 4 seconds${avg < 30 ? ', plenty of headroom' : ', a normal level'}.${topTxt}`));

  const level = R.tempLevel('cpu', temp);
  if (level === 'hot') items.push(B('Processor temperature', `${Math.round(temp)} °C is at the limit where the processor slows itself down to avoid damage.`, { fix: 'Make sure the air vents are free, clean out dust, and use the laptop on a hard surface.' }));
  else if (level === 'warm') items.push(W('Processor temperature', `${Math.round(temp)} °C is hot. Fine for a short burst of heavy work, not for idle.`, { fix: 'Check that the vents are not blocked.' }));
  else if (level === 'ok') items.push(G('Processor temperature', `${Math.round(temp)} °C is a normal temperature.`));
  else items.push(I('Processor temperature', 'Windows did not share the temperature sensor. Restart Hardware Dashboard as administrator to try again.', { action: ADMIN }));

  if (ev.whea.count) items.push(W('Hardware errors', `Windows logged ${plural(ev.whea.count, 'hardware error report')} in the last 30 days${when(ev.whea.last)}. These come from the processor, memory or PCIe devices and were corrected automatically, but repeated ones can point to overheating, unstable overclocking or failing hardware.`, { fix: 'If you overclock or undervolt, go back to default settings. If errors keep appearing, run the memory test.' }));
  else items.push(G('Hardware errors', 'No hardware error reports in the last 30 days.'));
  if (ev.bsod.count) items.push(B('Crashes (blue screens)', `Windows crashed ${plural(ev.bsod.count, 'time')} in the last 30 days${when(ev.bsod.last)}.`, { fix: 'Update your graphics and chipset drivers first; they cause most blue screens. Check the Drivers page.', action: { type: 'goto', key: 'drivers', label: 'Go to Drivers' } }));
  else items.push(G('Crashes (blue screens)', 'No blue screens in the last 30 days.'));
  if (ev.power.count > ev.bsod.count) items.push(W('Unexpected shutdowns', `The PC turned off without shutting down properly ${plural(ev.power.count, 'time')} in the last 30 days${when(ev.power.last)}. This happens after a crash, a power cut, holding the power button, or overheating.`));
  else if (!ev.power.count) items.push(G('Unexpected shutdowns', 'Every shutdown in the last 30 days was a normal one.'));
  return items;
}

// ---------------- Memory ----------------
// facts: { mem: si.mem(), layout: si.memLayout(), top: [{ name, mem }], lastTest: { id, at } | null }
function memory({ mem: m, layout, top, lastTest }) {
  const items = [];
  const p = (m.active / m.total) * 100;
  const topTxt = top.length ? ` Using the most: ${top.map((t) => `${t.name} (${gb(t.mem)})`).join(', ')}.` : '';
  if (p >= 90) items.push(B('Memory in use', `${p.toFixed(0)}% of your memory is in use. Windows is moving data to the much slower disk, which makes everything sluggish.${topTxt}`, { fix: 'Close apps or browser tabs you are not using.', action: TASKMGR }));
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

  const mdsched = { type: 'tool', key: 'mdsched', label: 'Schedule a memory test' };
  const date = lastTest && new Date(lastTest.at).toLocaleDateString('en-GB');
  if (!lastTest) items.push(I('Memory test', 'No memory test has been run on this PC. It checks every memory cell for faults and takes about 15 minutes after a restart.', { action: mdsched }));
  else if (lastTest.id === 1202 || lastTest.id === 2002) items.push(B('Memory test', `The last Windows memory test (${date}) found errors. Faulty memory causes random crashes and corrupted files.`, { fix: 'Contact your PC maker about replacing the memory, or reseat it if you installed it yourself.', action: mdsched }));
  else items.push(G('Memory test', `The last Windows memory test (${date}) found no errors.`, { action: mdsched }));
  return items;
}

// ---------------- Graphics ----------------
const THROTTLE = { 0x8: 'the hardware is slowing it down', 0x20: 'it is too hot (software limit)', 0x40: 'it is too hot (hardware limit)', 0x80: 'the power supply is limiting it' };
// facts: { gpus: [{ name, temp, util, vramUsed, vramTotal, throttleMask }], adapters: [{ name, status, date, version }],
//          events: { tdr, nv: { count, last } } }
function gpu({ gpus, adapters, events: ev }, now = Date.now()) {
  const items = [];
  for (const g of gpus) {
    const name = R.shortGpuName(g.name);
    const level = R.tempLevel('gpu', g.temp);
    if (level === 'hot') items.push(B(`${name} temperature`, `${g.temp} °C is very hot. The GPU will slow down to protect itself.`, { fix: 'Clean the vents and fans, and make sure air can flow under the laptop.' }));
    else if (level === 'warm') items.push(W(`${name} temperature`, `${g.temp} °C is warm. Normal while gaming, worth watching otherwise.`));
    else if (level === 'ok') items.push(G(`${name} temperature`, `${g.temp} °C is a healthy temperature${g.util != null ? ` at ${g.util}% load` : ''}.`));
    if (g.vramTotal) {
      const vp = (g.vramUsed / g.vramTotal) * 100;
      if (vp > 90) items.push(W('Video memory', `${vp.toFixed(0)}% of the video memory is in use. Games may stutter or lower their texture quality.`, { fix: 'Close other apps that use the GPU, or lower texture settings in games.' }));
      else items.push(G('Video memory', `${gb(g.vramUsed)} of ${gb(g.vramTotal)} in use.`));
    }
    if (Number.isFinite(g.throttleMask)) {
      const why = Object.entries(THROTTLE).filter(([bit]) => g.throttleMask & Number(bit)).map(([, t]) => t);
      if (why.length) items.push(W('Performance limits', `Right now the GPU is running slower because ${why.join(' and ')}.`, { fix: 'Plug in the charger and pick a performance power mode in your laptop maker’s app. If heat is the cause, clean the vents.' }));
      else items.push(G('Performance limits', 'Nothing is holding the GPU back right now.'));
    }
  }
  if (!gpus.length) items.push(I('Live graphics data', 'Detailed GPU readings are only available for NVIDIA graphics cards.'));

  for (const v of adapters) {
    if (v.status && v.status !== 'OK') items.push(B(`${v.name}`, `Windows reports the status "${v.status}" for this graphics adapter.`, { action: DEVMGMT }));
    if (v.date) {
      const months = (now - new Date(v.date)) / MONTH;
      const { key } = R.driverLink({ name: v.name });
      if (months > 12) items.push(W(`${v.name} driver`, `Version ${v.version} is ${Math.floor(months / 12)}+ years old. Newer drivers fix bugs and speed up recent games.`, { action: { type: 'link', key, label: 'Get the latest driver' } }));
      else items.push(G(`${v.name} driver`, `Version ${v.version}, ${Math.max(1, Math.round(months))} months old.`, { action: { type: 'link', key, label: 'Check for a newer one' } }));
    }
  }

  const crashes = ev.tdr.count + ev.nv.count;
  if (crashes) items.push(W('Graphics driver crashes', `The graphics driver stopped responding ${plural(crashes, 'time')} in the last 30 days${when(ev.tdr.last || ev.nv.last)}. You may have seen the screen go black for a moment.`, { fix: 'Install the latest driver with a clean install. If it keeps happening, remove any GPU overclock.' }));
  else items.push(G('Graphics driver crashes', 'The graphics driver ran without crashing in the last 30 days.'));
  return items;
}

// ---------------- Storage ----------------
// facts: { disks: [{ Name, Media, Health, Op, Size, Wear, Temp, ReadErr, WriteErr, Hours }], volumes: [{ mount, size, free }],
//          events: { disk, ntfs, nvme: { count, last } }, trim: 'on' | 'off' | null }
function storage({ disks, volumes, events: ev, trim }) {
  const items = [];
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
    const level = R.tempLevel('disk', d.Temp);
    if (level === 'hot') items.push(W('Drive temperature', `${d.Temp} °C is hot for an SSD. It will slow down to cool off.`));
    else if (level) items.push(G('Drive temperature', `${d.Temp} °C is normal.`));
    if ((d.ReadErr || 0) + (d.WriteErr || 0) > 0) items.push(B('Uncorrectable errors', `The drive reported ${(d.ReadErr || 0) + (d.WriteErr || 0)} read or write errors it could not fix.`, { fix: 'Back up your files and contact the manufacturer.' }));
  }
  if (needAdmin) items.push(I('Wear level and temperature', 'Windows only shares SSD wear and temperature with apps running as administrator.', { action: ADMIN }));

  for (const v of volumes) {
    const free = (v.free / v.size) * 100;
    const act = { type: 'goto', key: 'storage', label: 'See what uses space' };
    if (free < 5) items.push(B(`Free space on ${v.mount}`, `Only ${gb(v.free)} (${free.toFixed(0)}%) left. Windows updates can fail and the PC slows down when a drive is this full.`, { action: act }));
    else if (free < 12) items.push(W(`Free space on ${v.mount}`, `${gb(v.free)} (${free.toFixed(0)}%) left. Try to keep at least 10–15% free.`, { action: act }));
    else items.push(G(`Free space on ${v.mount}`, `${gb(v.free)} free (${free.toFixed(0)}%).`));
  }

  const n = ev.disk.count + ev.ntfs.count + ev.nvme.count;
  if (n) items.push(W('Disk errors', `Windows logged ${plural(n, 'disk or file system error')} in the last 30 days${when(ev.disk.last || ev.ntfs.last || ev.nvme.last)}. A few after a sudden power loss are normal; a steady stream is not.`, { fix: 'Back up important files. Run “chkdsk C: /scan” in an administrator terminal to check the file system.' }));
  else items.push(G('Disk errors', 'No disk or file system errors in the last 30 days.'));

  if (trim === 'on') items.push(G('TRIM', 'TRIM is on, so Windows tells the SSD which blocks are free. This keeps it fast.'));
  else if (trim === 'off') items.push(W('TRIM', 'TRIM is turned off, which makes SSDs slower over time.', { fix: 'Run “fsutil behavior set DisableDeleteNotify 0” in an administrator terminal.' }));
  return items;
}

// ---------------- Battery ----------------
// facts: { battery: si.battery() | null, design: mWh | null, full: mWh | null }
function battery({ battery: b, design, full }) {
  if (!b || !b.hasBattery) return [I('Battery', 'This PC has no battery.')];
  const items = [];
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

// ---------------- Internet ----------------
// facts: { latency: latencyStats(), dnsOk: boolean, wifi: { quality, ssid, frequency } | null }
function network({ latency: s, dnsOk, wifi }) {
  if (!s.ok) return [B('Internet connection', "This PC can't reach the internet.", { fix: 'Check that Wi-Fi is on or the cable is plugged in, then restart your router.', action: { type: 'link', key: 'network-settings', label: 'Open network settings' } })];
  const items = [G('Internet connection', 'Connected to the internet.')];
  items.push(dnsOk ? G('Name lookup (DNS)', 'Websites can be found by name.') : B('Name lookup (DNS)', "Website names can't be looked up, so pages won't load even though you're connected.", { fix: 'Restart your router, or set the DNS server to 1.1.1.1 in network settings.' }));
  if (s.median > 120) items.push(W('Response time', `${s.median.toFixed(0)} ms is slow. Video calls and online games will feel laggy.`, { fix: 'Move closer to the router or use a cable.' }));
  else items.push(G('Response time', `${s.median.toFixed(0)} ms${s.median < 40 ? ', great for gaming and calls' : ''}.`));
  if (s.jitter > 30) items.push(W('Stability (jitter)', `Response time varies by ${s.jitter.toFixed(0)} ms between checks, which causes choppy calls and rubber-banding in games.`, { fix: 'Wi-Fi interference is the usual cause. Try the 5 GHz band or a cable.' }));
  else items.push(G('Stability (jitter)', `Steady, varying by only ${s.jitter.toFixed(0)} ms.`));
  if (s.loss > 0) items.push(W('Lost connections', `${s.loss.toFixed(0)}% of test connections failed.`, { fix: 'Restart your router. If it persists, contact your internet provider.' }));
  else items.push(G('Lost connections', `All ${s.count} test connections succeeded.`));

  if (wifi) {
    if (wifi.quality < 40) items.push(W('Wi-Fi signal', `${wifi.quality}% on “${wifi.ssid}”. A weak signal lowers speed and drops connections.`, { fix: 'Move closer to the router or remove obstacles between you.' }));
    else items.push(G('Wi-Fi signal', `${wifi.quality}% on “${wifi.ssid}”.`));
    if (wifi.frequency && wifi.frequency < 3000) items.push(I('Wi-Fi band', 'You are on the 2.4 GHz band. If your router offers 5 or 6 GHz, it is usually much faster at short range.'));
  }
  return items;
}

// ---------------- Bluetooth ----------------
// facts: bluetooth.info() — { radio, service, adapters, devices }
function bluetooth(b) {
  const settings = { type: 'link', key: 'bluetooth-settings', label: 'Open Bluetooth settings' };
  if (!b.adapters.length) return [I('Bluetooth adapter', 'No Bluetooth adapter was found.', { action: settings })];
  const items = [];
  for (const a of b.adapters) {
    if (a.status === 'OK') items.push(G(a.name, `Working${a.version ? `, driver ${a.version}` : ''}.`));
    else items.push(B(a.name, `Windows reports a problem with the Bluetooth adapter (status ${a.status}).`, { fix: 'Restart the PC. If that doesn’t help, reinstall the driver in Device Manager.', action: DEVMGMT }));
  }
  if (b.radio === 'off') items.push(W('Bluetooth radio', 'Bluetooth is turned off, so no devices can connect.', { action: settings }));
  else if (b.radio === 'disabled') items.push(W('Bluetooth radio', 'The Bluetooth radio is disabled, so no devices can connect. A hardware switch, flight mode or a policy may have turned it off.', { action: settings }));
  else if (b.radio === 'on') items.push(G('Bluetooth radio', 'Bluetooth is on.'));
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
// facts: drivers.list() — { drivers, problems }
function drivers({ drivers: all, problems }, now = Date.now()) {
  const items = [];
  if (problems.length) items.push(B('Devices with problems', problems.map((p) => `${p.name}: ${p.meaning}`).join('. ') + '.', { fix: 'Open Device Manager, right-click the device, and choose Update driver or Uninstall device and restart.', action: DEVMGMT }));
  else items.push(G('Devices with problems', 'Every device has a working driver.'));
  const vendor = all.filter((d) => !R.isMicrosoftDriver(d));
  const old = all.filter((d) => R.isOldDriver(d, now));
  const important = old.filter(R.isImportantDriver);
  if (important.length) items.push(W('Old drivers', `${plural(important.length, 'important driver')} ${important.length === 1 ? 'is' : 'are'} more than three years old: ${important.slice(0, 4).map((d) => d.name).join(', ')}${important.length > 4 ? ' and more' : ''}.`, { fix: 'Look for updates in optional Windows updates or on your PC maker’s support site.', action: { type: 'link', key: 'optional-updates', label: 'Optional Windows updates' } }));
  else if (old.length) items.push(G('Old drivers', `${plural(old.length, 'minor driver')} ${old.length === 1 ? 'is' : 'are'} more than three years old. That is normal for parts that don’t change.`));
  else items.push(G('Old drivers', 'All hardware makers’ drivers are less than three years old.'));
  const unsigned = all.filter((d) => !d.signed);
  if (unsigned.length) items.push(W('Unsigned drivers', `${plural(unsigned.length, 'driver')} ${unsigned.length === 1 ? 'is' : 'are'} not digitally signed: ${unsigned.slice(0, 3).map((d) => d.name).join(', ')}. Unsigned drivers can't be verified as coming from the maker.`));
  else items.push(G('Unsigned drivers', 'Every driver is digitally signed.'));
  items.push(I('Installed drivers', `${all.length} in total, ${vendor.length} from hardware makers.`));
  return items;
}

module.exports = { cpu, memory, gpu, storage, battery, network, bluetooth, drivers };
