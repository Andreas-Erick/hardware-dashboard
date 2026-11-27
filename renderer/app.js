/* Hardware Dashboard: renderer. Talks to the main process only through window.hw (built in preload.js from src/ipc.js).
 * Every hw call resolves with its value or rejects with a message that can be shown to the user as-is.
 *
 * Each page is a view: { enter(), leave() }. show(id) leaves the current view and enters the next one.
 * Views don't call each other; they talk through `bus` events ('scan' a folder, something was 'trashed'). */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = { amber: css('--amber'), ice: css('--ice'), hot: css('--hot'), ok: css('--ok') };
const R = window.HD_RULES;
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  reveal: svg('M3 5h7l2 2h9v12H3zM5 9v8h14V9z'),
  trash: svg('M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7zm4 2v8h1.5v-8zm3 0v8h1.5v-8z'),
  // status marks
  good: svg('M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z'),
  warn: svg('M11 6h2v8h-2zm0 10h2v2h-2z'),
  bad: svg('M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z'),
  info: svg('M11 10h2v8h-2zm0-4h2v2h-2z'),
  // hardware parts
  cpu: svg('M9 2h2v2h2V2h2v2h2a2 2 0 012 2v2h2v2h-2v2h2v2h-2v2a2 2 0 01-2 2h-2v2h-2v-2h-2v2H9v-2H7a2 2 0 01-2-2v-2H3v-2h2v-2H3V8h2V6a2 2 0 012-2h2zm-2 4v10h10V6zm2 2h6v6H9z'),
  memory: svg('M2 7h20v9h-2v2h-2v-2h-2v2h-2v-2h-2v2H8v-2H6v2H4v-2H2zm3 2v4h2V9zm4 0v4h2V9zm4 0v4h2V9zm4 0v4h2V9z'),
  gpu: svg('M2 6h18a2 2 0 012 2v8a2 2 0 01-2 2h-6v2H4v-2H2zm12 3a3 3 0 100 6 3 3 0 000-6zM5 9v2h5V9zm0 4v2h5v-2z'),
  storage: svg('M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zm1 2v12h14V6zm9 8h3v2h-3z'),
  battery: svg('M3 7h16a1 1 0 011 1v2h2v4h-2v2a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1zm1 2v6h11V9z'),
  network: svg('M12 18a2 2 0 110 4 2 2 0 010-4zM5 12.5a10 10 0 0114 0l-1.6 1.6a7.7 7.7 0 00-10.8 0zM1.5 9a15 15 0 0121 0l-1.6 1.6a12.7 12.7 0 00-17.8 0z'),
  bluetooth: svg('M11 2h1l6 5.5-4.6 4.5 4.6 4.5L12 22h-1v-7.6l-4.3 4.2-1.4-1.4L10.6 12 5.3 6.8l1.4-1.4L11 9.6zm2 2.6v5l2.6-2.5zm0 9.8v5l2.6-2.5z'),
  drivers: svg('M7 2h10v4h3v12h-3v4H7v-4H4V6h3zm2 2v16h6V4z'),
  // Bluetooth device kinds
  audio: svg('M12 3a9 9 0 019 9v6a3 3 0 01-3 3h-2v-8h3v-1a7 7 0 00-14 0v1h3v8H6a3 3 0 01-3-3v-6a9 9 0 019-9z'),
  keyboard: svg('M3 6h18a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1zm2 3v2h2V9zm4 0v2h2V9zm4 0v2h2V9zm4 0v2h2V9zM7 14v2h10v-2z'),
  mouse: svg('M11 2v8H5V9a6 6 0 016-7zm2 0a6 6 0 016 7v1h-6zM5 12h14v3a7 7 0 01-14 0z'),
  controller: svg('M7 6h10a5 5 0 014.9 6l-1 5a2.5 2.5 0 01-4.3 1.2L14.4 16H9.6l-2.2 2.2A2.5 2.5 0 013.1 17l-1-5A5 5 0 017 6zm0 3v2H5v2h2v2h2v-2h2v-2H9V9zm9 1a1 1 0 100 2 1 1 0 000-2zm2 2a1 1 0 100 2 1 1 0 000-2z'),
  phone: svg('M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm0 3v13h10V5z'),
  wearable: svg('M9 2h6l1 4a6 6 0 010 12l-1 4H9l-1-4a6 6 0 010-12zm3 6a4 4 0 100 8 4 4 0 000-8z'),
  other: svg('M11 2h1l6 5.5-4.6 4.5 4.6 4.5L12 22h-1v-7.6l-4.3 4.2-1.4-1.4L10.6 12 5.3 6.8l1.4-1.4L11 9.6zm2 2.6v5l2.6-2.5zm0 9.8v5l2.6-2.5z'),
};
function battHtml(p, stale) {
  if (p == null) return '<span class="muted small">No battery info</span>';
  const cls = p <= 20 ? 'low' : p <= 40 ? 'mid' : '';
  return `<span class="batt ${cls}" title="${stale ? 'Last known level' : 'Battery level'}"><i style="--p:${p / 100}"></i>${p}%${stale ? '<span class="muted small" style="font-family:var(--body);font-weight:400">&nbsp;last known</span>' : ''}</span>`;
}
/** Bluetooth radio states from the main process: 'on' | 'off' | 'disabled' | 'unknown'. */
const radioOff = (radio) => radio === 'off' || radio === 'disabled';

const state = {
  static: null,
  admin: false,
  scan: { root: null, cur: null, running: false, done: null, data: null },
};

// ---------- Shared UI: events, navigation, modal, toasts ----------
const bus = (() => {
  const subs = {};
  return {
    on: (ev, fn) => (subs[ev] = subs[ev] || []).push(fn),
    emit: (ev, data) => (subs[ev] || []).forEach((fn) => fn(data)),
  };
})();

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = `toast${err ? ' err' : ''}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 7000 : 4500);
}
/** Run an hw call; on failure show its message and resolve undefined. */
async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return undefined; }
}

const views = {};
let current = 'overview';
function show(id) {
  if (!views[id]) return;
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${id}`));
  $('.main').scrollTop = 0;
  if (current !== id && views[current].leave) views[current].leave();
  current = id;
  if (views[id].enter) views[id].enter();
}
$$('.nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

async function relaunchAdmin() {
  if (!(await attempt(() => hw.relaunchAdmin()))) toast('Restart as administrator was cancelled.', true);
}
// Actions anywhere on the page, including the ones in health findings.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto],[data-link],[data-tool],[data-health],[data-admin],[data-battery-report]');
  if (!a) return;
  const d = a.dataset;
  if (d.goto) show(d.goto);
  else if (d.link) attempt(() => hw.openLink(d.link));
  else if (d.tool) attempt(() => hw.openTool(d.tool));
  else if (d.health) { show('health'); d.health === 'all' ? views.health.runAll() : views.health.run(d.health); }
  else if ('admin' in d) relaunchAdmin();
  else if ('batteryReport' in d) attempt(() => hw.batteryReport());
});

function confirmModal({ title, body, ok = 'OK', danger = true }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    const okBtn = $('#modal-ok');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
    m.hidden = false;
    $('#modal-cancel').focus();
    const done = (v) => { m.hidden = true; document.removeEventListener('keydown', key); okBtn.onclick = null; $('#modal-cancel').onclick = null; resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    okBtn.onclick = () => done(true);
    $('#modal-cancel').onclick = () => done(false);
  });
}

const meterClass = (p) => (p >= 90 ? 'full' : p >= 75 ? 'warn' : '');
function setMeter(el, p) {
  el.className = `meter ${meterClass(p)}`;
  el.firstElementChild.style.width = `${Math.max(0, Math.min(100, p))}%`;
}

// ---------- Overview ----------
// Always running: it also feeds the sidebar meters.
views.overview = (() => {
  const ro = (id) => { const el = $(id); const k = {}; $$('[data-k]', el).forEach((x) => (k[x.dataset.k] = x)); return { el, ...k }; };
  const cpu = ro('#ro-cpu'), mem = ro('#ro-mem'), gpu = ro('#ro-gpu');
  const sparks = {
    cpu: new Spark(cpu.spark, { max: 100, series: [{ color: C.amber }] }),
    mem: new Spark(mem.spark, { max: 100, series: [{ color: C.ice }] }),
    gpu: new Spark(gpu.spark, { max: 100, series: [{ color: C.amber }] }),
    net: new Spark($('#ov-net-spark'), { series: [{ color: C.ice }, { color: C.amber, fill: false }] }),
  };
  let ping = null;

  function renderStatic(s) {
    const model = [s.system.manufacturer, s.system.model].filter(Boolean).join(' ');
    $('#ov-title').textContent = s.hostname;
    $('#machine').innerHTML = `<strong>${fmt.esc(s.hostname)}</strong>${fmt.esc(model)}<br>${fmt.esc(s.os.distro)}`;
    const ram = s.memory.reduce((a, m) => a + m.size, 0);
    const ramDesc = s.memory.length ? `${fmt.gb(ram, 0)} GB ${s.memory[0].type || ''}${s.memory[0].clock ? ` at ${s.memory[0].clock} MT/s` : ''}, ${s.memory.length} module${s.memory.length > 1 ? 's' : ''}` : '–';
    const rows = [
      ['Model', model],
      ['Processor', `${s.cpu.brand}`],
      ['Cores', `${s.cpu.cores} cores, ${s.cpu.threads} threads`],
      ['Memory', ramDesc],
      ['Graphics', s.gpus.map((g) => `${g.model}${g.vram ? ` (${fmt.gb(g.vram, 0)} GB)` : ''}`).join(' and ')],
      ['Storage', s.disks.map((d) => `${d.name.replace(/_/g, ' ')}, ${fmt.bytes(d.size, 0)} ${d.iface || ''} ${d.type || ''}`.trim()).join(' and ')],
      ['Windows', `${s.os.distro.replace('Microsoft ', '')}, build ${s.os.build}`],
    ];
    $('#specs').innerHTML = rows.map(([k, v]) => `<dt>${fmt.esc(k)}</dt><dd>${fmt.esc(v)}</dd>`).join('') + '<dt>Running for</dt><dd id="uptime">–</dd>';
    cpu.cores.innerHTML = Array.from({ length: s.cpu.threads }, () => '<i></i>').join('');
  }

  function renderLive(l) {
    const s = state.static;
    if (l.cpu) {
      cpu.v.textContent = Math.round(l.cpu.load);
      cpu.meta.textContent = `${s ? s.cpu.brand.replace(/\(R\)|\(TM\)|™|®/g, '') : ''}${l.cpu.speed ? `, ${l.cpu.speed.toFixed(2)} GHz` : ''}`;
      sparks.cpu.push(l.cpu.load);
      const bars = cpu.cores.children;
      l.cpu.cores.forEach((v, i) => bars[i] && bars[i].style.setProperty('--h', `${v}%`));
      cpu.el.classList.toggle('hot', l.cpu.load >= 90);
    }
    if (l.mem) {
      mem.v.textContent = fmt.gb(l.mem.used);
      mem.meta.textContent = `of ${fmt.gb(l.mem.total, 0)} GB, ${fmt.gb(l.mem.available)} GB free`;
      setMeter(mem.meter, l.mem.percent);
      sparks.mem.push(l.mem.percent);
      mem.el.classList.toggle('hot', l.mem.percent >= 90);
    }
    const g = l.gpus[0];
    if (g) {
      gpu.v.textContent = g.util ?? '–';
      gpu.meta.textContent = `${R.shortGpuName(g.name)}${g.temp != null ? `, ${g.temp} °C` : ''}${g.power != null ? `, ${Math.round(g.power)} W` : ''}${g.clock ? `, ${g.clock} MHz` : ''}`;
      sparks.gpu.push(g.util);
      if (g.vramTotal) {
        gpu.vram.textContent = `${fmt.gb(g.vramUsed)} of ${fmt.gb(g.vramTotal, 0)} GB`;
        setMeter(gpu.vmeter, (g.vramUsed / g.vramTotal) * 100);
      }
    } else if (s && s.gpus[0]) {
      gpu.v.textContent = '–';
      gpu.meta.textContent = `${s.gpus[0].model}: live usage needs an NVIDIA GPU`;
      if (s.gpus[0].vram) gpu.vram.textContent = `${fmt.gb(s.gpus[0].vram, 0)} GB total`;
    }
    renderSide(l);
    renderTemps(l);
    renderDrives(l.drives);
    $('#ov-net').innerHTML = `
      <div><span class="k">Download</span><span class="v">${fmt.rate(l.net.rx)}</span></div>
      <div><span class="k">Upload</span><span class="v">${fmt.rate(l.net.tx)}</span></div>
      <div><span class="k">Ping</span><span class="v">${ping == null ? '–' : `${Math.round(ping)} ms`}</span></div>`;
    sparks.net.push(l.net.rx, l.net.tx);
    const up = $('#uptime'); if (up) up.textContent = fmt.duration(l.uptime);
    $('#ov-sub').textContent = `${s ? [s.system.manufacturer, s.system.model].join(' ') + ', ' : ''}on for ${fmt.duration(l.uptime)}. Updates every 1.5 seconds.`;
  }

  // Always-visible mini meters in the sidebar.
  function renderSide(l) {
    const set = (k, pct, txt) => {
      $(`[data-sl="${k}"]`).textContent = txt;
      const b = $(`[data-slb="${k}"]`);
      b.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
      b.className = meterClass(pct || 0);
    };
    if (l.cpu) set('cpu', l.cpu.load, `${Math.round(l.cpu.load)}%`);
    if (l.mem) set('mem', l.mem.percent, `${fmt.gb(l.mem.used)} GB`);
    const g = l.gpus[0];
    if (g) set('gpu', g.util, `${g.util ?? '–'}%`);
    else $('[data-sl="gpu"]').closest('.sl').hidden = true;
  }

  async function renderBluetooth() {
    const el = $('#ov-bt');
    let b;
    try { b = await hw.bluetooth(); } catch (e) { el.innerHTML = `<p class="muted small">${fmt.esc(e.message)}</p>`; return; }
    if (!b.adapters.length) { el.innerHTML = '<p class="muted small">No Bluetooth adapter found.</p>'; return; }
    if (radioOff(b.radio)) { el.innerHTML = '<p class="muted small">Bluetooth is turned off.</p><button class="mini-link" data-link="bluetooth-settings">Turn it on in settings</button>'; return; }
    const conn = b.devices.filter((d) => d.connected);
    el.innerHTML = conn.length
      ? conn.slice(0, 5).map((d) => `<div class="ov-bt-row">${ICON[d.kind] || ICON.other}<span title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</span>${d.battery != null ? battHtml(d.battery) : ''}</div>`).join('')
      : `<p class="muted small">Nothing connected right now. ${b.devices.length} paired device${b.devices.length === 1 ? '' : 's'}.</p>`;
  }

  // Same thresholds as the health check (shared/hardware-rules.js).
  function tempRow(name, part, t) {
    const level = R.tempLevel(part, t);
    if (!level) return '';
    return `<li><span>${fmt.esc(name)}</span><span class="deg ${level === 'ok' ? '' : level}">${Math.round(t)} °C</span></li>`;
  }
  function renderTemps(l) {
    let html = '';
    html += l.cpu && l.cpu.temp != null
      ? tempRow('Processor', 'cpu', l.cpu.temp)
      : '<li><span>Processor</span><span class="na">Not available</span></li>';
    for (const g of l.gpus) html += tempRow(R.shortGpuName(g.name), 'gpu', g.temp);
    for (const d of l.diskTemps) html += tempRow(d.name, 'disk', d.temp);
    if (!l.diskTemps.length) html += '<li><span>SSD</span><span class="na">Not available</span></li>';
    if (l.battery) html += `<li><span>Battery</span><span class="deg">${l.battery.percent}%</span></li>`;
    $('#temps').innerHTML = html;
    const note = $('#temp-note');
    const missing = !(l.cpu && l.cpu.temp != null) || !l.diskTemps.length;
    note.hidden = !missing;
    if (missing) {
      note.innerHTML = state.admin
        ? "Windows doesn't expose every sensor on this PC. Your laptop maker's app or HWiNFO can read them straight from the chip."
        : 'Windows only shares processor and SSD temperatures with apps running as administrator. <button class="link" data-admin>Restart as administrator</button>';
    }
  }

  function renderDrives(drives) {
    $('#ov-drives').innerHTML = drives.map((d) => {
      const p = (d.used / d.size) * 100;
      return `<div class="drive"><div class="row-between"><strong>${fmt.esc(d.mount)}</strong><span>${fmt.bytes(d.free)} free</span></div>
        <div class="meter ${meterClass(p)}"><i style="width:${p}%"></i></div>
        <small>${fmt.bytes(d.used)} used of ${fmt.bytes(d.size)}</small></div>`;
    }).join('');
  }

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try { renderLive(await hw.live()); } catch (e) { console.error(e); }
    busy = false;
  }
  async function pingTick() { try { ping = (await hw.netStatus()).latency; } catch { ping = null; } }

  function start() {
    hw.isAdmin().then((a) => (state.admin = a), () => {});
    tick();
    hw.staticInfo().then((s) => { state.static = s; renderStatic(s); }, (e) => console.error(e));
    setInterval(tick, 1500);
    pingTick(); setInterval(pingTick, 10000);
    renderBluetooth(); setInterval(renderBluetooth, 20000);
  }
  return { start };
})();

// ---------- Disk space ----------
views.storage = (() => {
  const tip = makeTip();
  let tab = 'map';

  const lighten = (hex, t) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };
  // Folders take the colour of whatever fills most of them (`mostly`), so a folder full of videos reads as video at a glance.
  const catOf = (item) => item.cat || fmt.category(item.name);
  function colorOf(item, inner) {
    const c = item.isDir ? (item.mostly ? fmt.CATS[item.mostly].color : fmt.FOLDER_COLOR) : fmt.CATS[catOf(item)].color;
    return inner ? lighten(c, 0.22) : c;
  }

  async function renderDriveCards() {
    const drives = (await attempt(() => hw.drives())) || [];
    $('#drive-row').innerHTML = drives.map((d) => {
      const p = (d.used / d.size) * 100;
      return `<div class="drive-card">
        <div class="row-between"><strong>${fmt.esc(d.mount)}</strong><span>${Math.round(p)}% full</span></div>
        <div class="meter ${meterClass(p)}"><i style="width:${p}%"></i></div>
        <small>${fmt.bytes(d.free)} free of ${fmt.bytes(d.size)}</small>
        <button class="btn small" data-scan="${fmt.esc(d.mount)}\\">Scan ${fmt.esc(d.mount)}</button>
      </div>`;
    }).join('');
    $$('[data-scan]').forEach((b) => b.addEventListener('click', () => start(b.dataset.scan)));
  }

  async function start(folder) {
    if (state.scan.running) {
      const ok = await confirmModal({ title: 'Stop the current scan?', body: 'A scan is already running. Starting a new one stops it.', ok: 'Start new scan', danger: false });
      if (!ok) return;
    }
    const root = await attempt(() => hw.scanStart(folder));
    if (!root) return;
    Object.assign(state.scan, { root, cur: root, running: true, done: null, data: null });
    $('#storage-empty').hidden = true;
    $('#explorer').hidden = true;
    $('#scan-progress').hidden = false;
    $('#sp-title').textContent = `Scanning ${root}`;
    $('#sp-stats').textContent = 'Starting…';
    $('#sp-path').textContent = '';
    show('storage');
  }
  bus.on('scan', start);

  // The scan sends progress four times a second.
  hw.onScanProgress((s) => {
    $('#sp-stats').textContent = `${fmt.bytes(s.bytes)} found in ${fmt.int(s.files)} files and ${fmt.int(s.dirs)} folders`;
    $('#sp-path').textContent = s.current;
  });
  hw.onScanDone((s) => {
    state.scan.running = false;
    state.scan.done = s;
    $('#scan-progress').hidden = true;
    if (s.error) {
      toast(`The scan stopped because of an error: ${s.error}`, true);
      $('#storage-empty').hidden = false;
      return;
    }
    $('#explorer').hidden = false;
    open(state.scan.root);
  });

  $('#scan-cancel').addEventListener('click', () => attempt(() => hw.scanCancel()));
  $('#scan-folder').addEventListener('click', async () => { const p = await attempt(() => hw.pickFolder()); if (p) start(p); });
  $('#ex-up').addEventListener('click', () => { if (state.scan.data && state.scan.data.parent) open(state.scan.data.parent); });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function setTab(t) {
    tab = t;
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t));
    if (t === 'largest') renderLargest();
    if (t === 'types') renderTypes();
    if (t === 'map') drawMap();
  }

  async function open(p) {
    const data = await attempt(() => hw.scanChildren(p));
    if (!data) return;
    state.scan.cur = data.path;
    state.scan.data = data;
    renderCrumbs(data);
    renderSummary(data);
    if (tab === 'map') drawMap(); else setTab(tab);
    renderList(data);
  }

  function renderCrumbs(data) {
    $('#crumbs').innerHTML = data.crumbs.map((x, i) => `${i ? '<span class="sep">›</span>' : ''}<button data-p="${fmt.esc(x.path)}">${fmt.esc(x.name)}</button>`).join('');
    $$('#crumbs button').forEach((b) => b.addEventListener('click', () => open(b.dataset.p)));
    $('#ex-up').disabled = !data.parent;
  }

  function renderSummary(data) {
    const s = state.scan.done || {};
    let text = `<strong>${fmt.bytes(data.size)}</strong> in ${fmt.int(data.count)} files.`;
    if (data.isRoot) {
      const secs = s.finishedAt ? ((s.finishedAt - s.startedAt) / 1000).toFixed(1) : null;
      if (secs) text += ` Scanned in ${secs} seconds.`;
      if (s.cancelled) text += ' You stopped the scan early, so some folders are missing.';
      if (s.denied) text += ` ${fmt.int(s.denied)} folders couldn't be opened without administrator rights.`;
      if (data.overcounted) {
        text += ' The total is higher than the space actually used because Windows stores some files once and links them from several places, and cloud-only OneDrive files count at full size.';
      }
    }
    $('#ex-summary').innerHTML = text;
  }

  function mapItems(data) {
    const items = data.items.filter((i) => i.size > 0).slice(0, 160);
    if (data.unreadable) {
      items.push({ name: 'System and unreadable files', size: data.unreadable, unread: true, note: `${fmt.bytes(data.unreadable)} Windows uses but won't let a normal app look into: restore points, the page file, other users' folders and similar.` });
      items.sort((a, b) => b.size - a.size);
    }
    return items;
  }

  function drawMap() {
    const data = state.scan.data;
    if (!data) return;
    renderTreemap($('#treemap'), mapItems(data), {
      colorOf,
      tip,
      onOpen: (r) => { tip.hide(); open(r.path); },
      onReveal: (r) => attempt(() => hw.reveal(r.path)),
    });
    renderLegend(data);
  }
  new ResizeObserver(() => { if (tab === 'map' && !$('#explorer').hidden) drawMap(); }).observe($('#treemap'));

  function renderLegend(data) {
    const used = new Set();
    const note = (i) => { if (i.isDir) { if (i.mostly) used.add(i.mostly); } else used.add(catOf(i)); };
    for (const i of data.items.slice(0, 160)) { note(i); if (i.sub) i.sub.forEach(note); }
    const parts = [`<span><i style="background:${fmt.FOLDER_COLOR}"></i>Mixed folders</span>`];
    for (const [k, v] of Object.entries(fmt.CATS)) if (used.has(k)) parts.push(`<span><i style="background:${v.color}"></i>${v.label}</span>`);
    $('#legend').innerHTML = parts.join('') + '<span style="margin-left:auto">Folders take the colour of what fills most of them. Click one to open it.</span>';
  }

  function itemRow(i, parentSize) {
    const pct = parentSize ? (i.size / parentSize) * 100 : 0;
    const desc = i.isDir
      ? `${i.mostly ? `Mostly ${fmt.CATS[i.mostly].label.toLowerCase()}, ` : ''}${fmt.int(i.count)} file${i.count === 1 ? '' : 's'}${i.denied ? ', some unreadable' : ''}`
      : fmt.CATS[catOf(i)].label;
    return `<div class="ex-item">
      <span class="dot" style="background:${colorOf(i)}"></span>
      <div class="nm">
        <button class="${i.isDir ? 'dir' : 'file'}" data-open="${i.isDir ? fmt.esc(i.path) : ''}" title="${fmt.esc(i.path)}">${fmt.esc(i.name)}</button>
        <small>${desc}, ${pct.toFixed(1)}%</small>
        <div class="pct"><i style="width:${pct}%"></i></div>
      </div>
      <span class="sz">${fmt.bytes(i.size)}</span>
      <span class="acts">
        <button class="icon-btn" data-reveal="${fmt.esc(i.path)}" title="Show in Explorer" aria-label="Show ${fmt.esc(i.name)} in Explorer">${ICON.reveal}</button>
        <button class="icon-btn del" data-trash="${fmt.esc(i.path)}" data-size="${i.size}" data-name="${fmt.esc(i.name)}" title="Move to Recycle Bin" aria-label="Move ${fmt.esc(i.name)} to the Recycle Bin">${ICON.trash}</button>
      </span>
    </div>`;
  }

  function renderList(data) {
    let html = data.items.map((i) => itemRow(i, data.size)).join('');
    if (data.hiddenCount > 0) html += `<div class="ex-more">${fmt.int(data.hiddenCount)} smaller items not shown.</div>`;
    if (!data.items.length) html = '<div class="ex-more">This folder is empty.</div>';
    $('#ex-list').innerHTML = html;
  }

  // One delegated handler for every list in this view.
  $('#view-storage').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o && o.dataset.open) return open(o.dataset.open);
    const r = e.target.closest('[data-reveal]');
    if (r) return attempt(() => hw.reveal(r.dataset.reveal));
    const t = e.target.closest('[data-trash]');
    if (t) return trash(t.dataset.trash, t.dataset.name, Number(t.dataset.size));
  });

  async function trash(p, name, size) {
    const big = size > 50 * 1024 ** 3;
    const ok = await confirmModal({
      title: `Move “${name}” to the Recycle Bin?`,
      body: `This frees ${fmt.bytes(size)} once you empty the Recycle Bin. Until then you can restore it.${big ? ' Items this large may not fit in the Recycle Bin; Windows then deletes them permanently.' : ''}<br><br><code>${fmt.esc(p)}</code>`,
      ok: 'Move to Recycle Bin',
    });
    if (!ok) return;
    try { await hw.trash(p); } catch (e) { return toast(e.message, true); }
    toast(`Moved “${name}” to the Recycle Bin. Empty it on the Clean up page to get the ${fmt.bytes(size)} back.`);
    bus.emit('trashed', p);
    await open(state.scan.cur);
    if (tab === 'largest') renderLargest();
  }

  async function renderLargest() {
    const rows = (await attempt(() => hw.scanLargest())) || [];
    $('#largest').innerHTML = `<div class="ft-row head-row" style="grid-template-columns:minmax(0,1fr) 120px 80px"><span>The ${rows.length} biggest files in ${fmt.esc(state.scan.root)}</span><span class="num" style="font:inherit">Size</span><span></span></div>` +
      rows.map((f) => `<div class="ft-row"><div class="path"><b><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px;background:${colorOf(f)}"></span>${fmt.esc(f.name)}</b><small>${fmt.esc(f.path)}</small></div>
          <span class="num">${fmt.bytes(f.size)}</span>
          <span class="acts"><button class="icon-btn" data-reveal="${fmt.esc(f.path)}" title="Show in Explorer" aria-label="Show in Explorer">${ICON.reveal}</button>
          <button class="icon-btn del" data-trash="${fmt.esc(f.path)}" data-size="${f.size}" data-name="${fmt.esc(f.name)}" title="Move to Recycle Bin" aria-label="Move to Recycle Bin">${ICON.trash}</button></span></div>`).join('');
  }

  async function renderTypes() {
    const rows = (await attempt(() => hw.scanTypes())) || [];
    const max = rows[0] ? rows[0].size : 1;
    $('#types').innerHTML = `<div class="ft-row types-row head-row"><span>Type</span><span>Share of scanned space</span><span class="num" style="font:inherit">Size</span><span class="num" style="font:inherit">Files</span></div>` +
      rows.map((t) => {
        const cat = fmt.CATS[t.cat];
        return `<div class="ft-row types-row"><span class="ext">${fmt.esc(t.ext === '(none)' ? 'No extension' : t.ext)}</span>
          <div><div class="bar"><i style="width:${(t.size / max) * 100}%;background:${cat.color}"></i></div><small style="color:var(--faint);font-size:12px">${fmt.esc(cat.label)}</small></div>
          <span class="num">${fmt.bytes(t.size)}</span><span class="num" style="font:inherit;color:var(--muted)">${fmt.int(t.count)}</span></div>`;
      }).join('');
  }

  return { enter: renderDriveCards };
})();

// ---------- Clean up ----------
views.cleanup = (() => {
  const items = new Map();
  let fresh = false;
  const TAG = { clear: 'Safe to clear', review: 'Your files', system: 'Managed by Windows', info: 'For information' };
  const ORDER = { clear: 0, review: 1, system: 2, info: 3 };

  // Moving something to the Recycle Bin changes its size.
  bus.on('trashed', () => { fresh = false; });

  /** "Chrome: 1.2 GB, Edge: 300 MB" from the parts each item reports. */
  function partsNote(parts) {
    const agg = new Map();
    for (const p of parts) if (p.size > 0) agg.set(p.label, (agg.get(p.label) || 0) + p.size);
    return [...agg].sort((a, b) => b[1] - a[1]).map(([n, s]) => `${n}: ${fmt.bytes(s)}`).join(', ');
  }

  function render() {
    const list = [...items.values()].sort((a, b) => (ORDER[a.kind] - ORDER[b.kind]) || (b.size || 0) - (a.size || 0));
    $('#cleanup').innerHTML = list.map((i) => {
      const sz = i.size;
      const cls = sz == null ? 'zero' : sz > 1024 ** 3 ? 'lots' : sz < 1024 ** 2 ? 'zero' : '';
      const sizeTxt = sz == null ? (i.measuring ? 'Measuring…' : 'Unknown') : fmt.bytes(sz);
      const notes = [];
      if (i.note) notes.push(i.note);
      if (i.denied) notes.push('Part of this needs administrator rights to read.');
      // Single-folder items need no breakdown; the "for information" items always show what they consist of.
      if (i.parts && (i.parts.length > 1 || i.kind === 'info')) { const n = partsNote(i.parts); if (n) notes.push(n); }
      if (i.advice) notes.push(i.advice.text.replace('this space', fmt.bytes(i.advice.size)));
      let act = '';
      if (i.kind === 'clear') act = `<button class="btn" data-clear="${i.id}" ${!sz || sz < 1024 * 1024 ? 'disabled' : ''}>${fmt.esc(i.action)}</button>`;
      else if (i.kind === 'review') act = `<button class="btn" data-review="${i.id}" ${i.review ? '' : 'disabled'}>${fmt.esc(i.action)}</button>`;
      else if (i.kind === 'system') act = `<button class="btn" data-tool="${i.tool}">${fmt.esc(i.action)}</button>`;
      return `<div class="cu-item">
        <div><h3>${fmt.esc(i.title)}<span class="tag">${TAG[i.kind]}</span></h3><p>${fmt.esc(i.why)}</p>${notes.length ? `<div class="parts">${fmt.esc(notes.join('. '))}</div>` : ''}</div>
        <div class="size ${cls}">${sizeTxt}${i.files ? `<small>${fmt.int(i.files)} files</small>` : ''}</div>
        <div class="act">${act}</div>
      </div>`;
    }).join('');
    const total = list.filter((i) => i.kind === 'clear').reduce((a, i) => a + (i.size || 0), 0);
    const pending = list.some((i) => i.measuring);
    $('#cu-sub').textContent = pending
      ? 'Measuring the usual places where space builds up…'
      : `About ${fmt.bytes(total)} can be cleared safely right now. Apps rebuild these files as needed.`;
  }

  hw.onCleanupItem((i) => { items.set(i.id, { ...i, measuring: false }); render(); });

  async function load() {
    fresh = true;
    for (const [k, v] of items) items.set(k, { ...v, measuring: true });
    if (!items.size) $('#cleanup').innerHTML = '<div class="skeleton">Measuring…</div>';
    else render();
    await attempt(() => hw.cleanupList());
    render();
  }

  $('#cleanup').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-clear]');
    if (c) {
      const i = items.get(c.dataset.clear);
      const ok = await confirmModal({ title: `${i.action}?`, body: `${fmt.esc(i.warn)}<br><br>This frees up to ${fmt.bytes(i.size)}.`, ok: i.action });
      if (!ok) return;
      c.disabled = true;
      c.textContent = 'Working…';
      let r;
      try { r = await hw.cleanupClear(i.id); } catch (err) { toast(err.message, true); render(); return; }
      items.set(i.id, { ...r, measuring: false });
      render();
      if (r.freed > 0) toast(`${i.title}: freed ${fmt.bytes(r.freed)}${r.skipped ? `. ${fmt.int(r.skipped)} items were in use or too new and were kept` : ''}.`);
      else toast(`${i.title}: nothing could be removed. ${r.skipped ? 'The files are in use or too new.' : 'There was nothing to remove.'}`, true);
    }
    const rv = e.target.closest('[data-review]');
    if (rv) {
      const i = items.get(rv.dataset.review);
      if (i.review) bus.emit('scan', i.review);
    }
  });
  $('#cu-refresh').addEventListener('click', load);
  return { enter() { if (!fresh) load(); } };
})();

// ---------- Drivers ----------
views.drivers = (() => {
  let all = [];
  let loaded = false;
  const CLS = {
    DISPLAY: 'Graphics', NET: 'Network', MEDIA: 'Sound', AUDIOENDPOINT: 'Audio endpoint', SYSTEM: 'System', USB: 'USB',
    HIDCLASS: 'Input device', KEYBOARD: 'Keyboard', MOUSE: 'Mouse', BLUETOOTH: 'Bluetooth', CAMERA: 'Camera', IMAGE: 'Camera',
    MONITOR: 'Monitor', DISKDRIVE: 'Disk', SCSIADAPTER: 'Storage controller', HDC: 'Storage controller', SOFTWARECOMPONENT: 'Software component',
    EXTENSION: 'Extension', BIOMETRIC: 'Fingerprint or face sign-in', PRINTQUEUE: 'Printer', PROCESSOR: 'Processor', FIRMWARE: 'Firmware',
    SECURITYDEVICES: 'Security chip', BATTERY: 'Battery', SENSOR: 'Sensor', VOLUME: 'Volume', VOLUMESNAPSHOT: 'Volume', COMPUTER: 'Computer',
    SOFTWAREDEVICE: 'Software device', USBDEVICE: 'USB device', NETSERVICE: 'Network service', PRINTER: 'Printer', SMARTCARDREADER: 'Card reader',
    UCM: 'USB-C', SDHOST: 'SD card reader', OTHER: 'Other', AUDIOPROCESSINGOBJECT: 'Audio effects', NET_ADAPTER: 'Network',
    SECURITYACCELERATOR: 'Security', WPD: 'Portable device', SMARTCARDFILTER: 'Smart card',
  };
  const clsName = (c) => CLS[(c || '').toUpperCase()] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : 'Other');

  async function load() {
    loaded = true;
    $('#dr-table').innerHTML = '<div class="skeleton">Reading drivers…</div>';
    let r;
    try { r = await hw.drivers(); } catch (e) {
      $('#dr-sub').textContent = e.message;
      $('#dr-table').innerHTML = '';
      loaded = false;
      return;
    }
    all = r.drivers;
    const vendor = all.filter((d) => !R.isMicrosoftDriver(d));
    const old = all.filter((d) => R.isOldDriver(d));
    $('#dr-sub').textContent = `${all.length} drivers installed, ${vendor.length} of them from hardware makers. ${old.length ? `${old.length} are more than three years old.` : 'None of the hardware makers’ drivers are more than three years old.'}`;

    let html = '';
    if (r.problems.length) {
      html += `<div class="dr-callout"><span class="st bad">${ICON.bad}</span><div><h3>${r.problems.length} device${r.problems.length > 1 ? 's need' : ' needs'} attention</h3>
        <ul>${r.problems.map((p) => `<li><b>${fmt.esc(p.name)}</b> <span>${fmt.esc(p.meaning)}</span></li>`).join('')}</ul>
        <p class="fine" style="margin-top:8px">Open Device Manager and right-click the device to update or reinstall its driver.</p></div></div>`;
    } else {
      html += `<div class="dr-callout"><span class="st good">${ICON.good}</span><div><h3>All devices are working</h3><span class="muted">Windows reports no driver errors.</span></div></div>`;
    }
    html += `<div class="key-drivers">${R.keyDrivers(all).map((d) => {
      const a = fmt.age(d.date);
      const link = R.driverLink(d);
      return `<div class="kd"><div class="k">${clsName(d.cls)}</div><div class="n" title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</div>
        <div class="v">${fmt.esc(d.version)}</div><div class="d ${R.isOldDriver(d) ? 'age-old' : ''}">${fmt.esc(a.text)}${a.rel ? `, ${a.rel}` : ''}</div>
        <button class="link" data-link="${link.key}">${link.label}</button></div>`;
    }).join('')}</div>`;
    $('#dr-highlights').innerHTML = html;

    const classes = [...new Set(all.map((d) => d.cls))].sort((a, b) => clsName(a).localeCompare(clsName(b)));
    $('#dr-class').innerHTML = '<option value="">All device types</option>' + classes.map((c) => `<option value="${fmt.esc(c)}">${fmt.esc(clsName(c))}</option>`).join('');
    renderTable();
  }

  function renderTable() {
    const q = $('#dr-search').value.trim().toLowerCase();
    const cls = $('#dr-class').value;
    const hideMs = $('#dr-hide-ms').checked;
    const rows = all
      .filter((d) => (!cls || d.cls === cls) && (!hideMs || !R.isMicrosoftDriver(d)))
      .filter((d) => !q || `${d.name} ${d.provider} ${d.maker} ${d.version}`.toLowerCase().includes(q))
      .sort((a, b) => clsName(a.cls).localeCompare(clsName(b.cls)) || a.name.localeCompare(b.name));
    $('#dr-table').innerHTML = `<div class="ft-row drv-row head-row"><span>Device</span><span>Type</span><span>Driver from</span><span>Version</span><span>Date</span></div>` +
      (rows.length ? rows.map((d) => {
        const a = fmt.age(d.date);
        return `<div class="ft-row drv-row"><div class="path"><b title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</b></div>
          <span style="color:var(--muted)">${fmt.esc(clsName(d.cls))}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt.esc(d.provider || d.maker)}</span>
          <span class="num">${fmt.esc(d.version)}</span>
          <span class="num ${R.isOldDriver(d) ? 'age-old' : 'age-ok'}" title="${fmt.esc(a.rel || '')}">${fmt.esc(a.text)}</span></div>`;
      }).join('') : '<div class="skeleton">No drivers match your search.</div>');
  }
  $('#dr-search').addEventListener('input', renderTable);
  $('#dr-class').addEventListener('change', renderTable);
  $('#dr-hide-ms').addEventListener('change', renderTable);
  return { enter() { if (!loaded) load(); } };
})();

// ---------- Internet ----------
views.network = (() => {
  const HKEY = 'hd.speedHistory';
  const readHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
  const writeHistory = (h) => { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 12))); } catch { /* storage unavailable */ } };
  let running = false;

  // Speed test results are in bits per second.
  function verdict(down) {
    const m = down / 1e6;
    if (m < 10) return 'Enough for browsing and HD video on one device. Large downloads will be slow.';
    if (m < 50) return 'Good for HD streaming and video calls on a couple of devices.';
    if (m < 250) return 'Fast. 4K streaming on several devices at once is no problem.';
    return 'Very fast. Even 100 GB game downloads finish in well under an hour.';
  }

  async function enter() {
    renderHistory();
    const n = await attempt(() => hw.netInfo());
    if (!n) return;
    const main = n.interfaces.find((i) => i.name === n.main);
    const wifi = n.wifi[0];
    const st = n.status;
    $('#net-sub').textContent = !st.online
      ? "You're offline. Check that Wi-Fi is on or the cable is plugged in, then restart your router if it still doesn't work."
      : !st.dns
        ? "Connected, but websites can't be looked up (DNS isn't answering). Try restarting your router."
        : `Online${wifi ? ` through Wi-Fi network “${wifi.ssid}”` : main ? ` through ${main.name}` : ''}. ${Math.round(st.latency)} ms to the internet.`;
    const rows = [
      ['Status', st.online ? 'Online' : 'Offline'],
      ['Response time', st.latency != null ? `${Math.round(st.latency)} ms` : '–'],
      ...(wifi ? [['Wi-Fi network', wifi.ssid], ['Signal', `${wifi.quality}%${wifi.frequency ? `, ${(wifi.frequency / 1000).toFixed(1)} GHz` : ''}`], ['Security', wifi.security || '–']] : []),
      ['Your local address', main ? main.ip4 || '–' : '–'],
      ['Router', n.gateway || '–'],
      ['DNS servers', n.dnsMain.slice(0, 4).join(', ') || '–'],
    ];
    $('#net-conn').innerHTML = rows.map(([k, v]) => `<dt>${fmt.esc(k)}</dt><dd>${fmt.esc(v)}</dd>`).join('');
    const ifs = n.interfaces.filter((i) => i.up || !i.virtual);
    $('#net-ifaces').innerHTML = ifs.map((i) => `<div class="iface">
      <div class="row-between"><b title="${fmt.esc(i.name)}">${fmt.esc(i.name)}</b>
      <span class="pills">${i.isDefault ? '<span class="pill main">In use</span>' : ''}<span class="pill ${i.up ? 'on' : 'off'}">${i.up ? 'Connected' : 'Not connected'}</span></span></div>
      <small>${[i.medium, i.virtual ? 'Virtual' : '', i.speed ? `link speed ${i.speed >= 1000 ? (i.speed / 1000).toFixed(1) + ' Gbit/s' : i.speed + ' Mbit/s'}` : '', i.ip4].filter(Boolean).map(fmt.esc).join(', ')}</small></div>`).join('');
  }

  function renderHistory() {
    const h = readHistory();
    $('#speed-history').innerHTML = h.length
      ? h.map((r) => `<div class="sh-row"><span>${fmt.ago(r.at)}</span><span><b>${fmt.bps(r.download)}</b> down</span><span><b>${fmt.bps(r.upload)}</b> up</span></div>`).join('')
      : '<p class="fine">Your results appear here so you can compare times of day.</p>';
  }

  hw.onSpeedProgress((p) => {
    const label = { ping: 'Measuring response time', download: 'Download', upload: 'Upload' }[p.phase];
    $('#sg-label').textContent = label;
    $('#sg-bar').style.width = `${(p.progress || 0) * 100}%`;
    if (p.phase === 'ping' && p.ping != null) { $('#sr-ping').textContent = `${Math.round(p.ping)} ms`; $('#sr-jitter').textContent = `${p.jitter.toFixed(1)} ms`; }
    if (p.bps != null) { $('#sg-value').textContent = fmt.bps(p.bps); $('#sg-value').classList.remove('idle'); }
  });

  $('#speed-start').addEventListener('click', async () => {
    if (running) return;
    running = true;
    const b = $('#speed-start');
    b.disabled = true; b.textContent = 'Testing…';
    ['#sr-down', '#sr-up', '#sr-ping', '#sr-jitter'].forEach((s) => { $(s).textContent = '–'; });
    $('#sg-value').textContent = '0';
    $('#sg-value').classList.add('idle');
    const x = await attempt(() => hw.speedTest());
    running = false;
    b.disabled = false; b.textContent = 'Test again';
    $('#sg-bar').style.width = '0';
    $('#sg-label').textContent = 'Download';
    if (!x) return;
    $('#sg-value').textContent = fmt.bps(x.download);
    $('#sg-value').classList.remove('idle');
    $('#sr-down').textContent = `${fmt.bps(x.download)} Mbit/s`;
    $('#sr-up').textContent = `${fmt.bps(x.upload)} Mbit/s`;
    $('#sr-ping').textContent = `${Math.round(x.ping)} ms`;
    $('#sr-jitter').textContent = `${x.jitter.toFixed(1)} ms`;
    $('#speed-note').textContent = verdict(x.download);
    writeHistory([x, ...readHistory()]);
    renderHistory();
  });

  return { enter };
})();

// ---------- Health check ----------
views.health = (() => {
  let parts = []; // [{ id, name, desc }] from the main process; the battery check only appears on PCs with one
  const KEY = 'hd.health';
  const results = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(results)); } catch { /* storage unavailable */ } };
  const running = new Set();
  const queued = new Set();
  const open = new Set();
  const CHIP = { good: 'Healthy', warn: 'Worth a look', bad: 'Needs attention', info: 'Nothing to judge', error: 'Couldn’t finish' };

  // An action button speaks the page's shared action attributes (see the document click handler).
  function actionButton(a) {
    const attr = { tool: `data-tool="${fmt.esc(a.key)}"`, link: `data-link="${fmt.esc(a.key)}"`, goto: `data-goto="${fmt.esc(a.key)}"`, admin: 'data-admin', 'battery-report': 'data-battery-report' }[a.type];
    return attr ? `<button class="btn small" ${attr}>${fmt.esc(a.label)}</button>` : '';
  }
  function finding(f) {
    return `<div class="hc-finding"><span class="st ${f.status}">${ICON[f.status]}</span><div>
      <b>${fmt.esc(f.label)}</b><p>${fmt.esc(f.detail)}</p>${f.fix ? `<p class="fix">${fmt.esc(f.fix)}</p>` : ''}${f.action ? actionButton(f.action) : ''}</div></div>`;
  }

  function render() {
    $('#hc-list').innerHTML = parts.map((p) => {
      const r = results[p.id];
      const isRun = running.has(p.id), isQ = queued.has(p.id);
      const chip = isRun ? '<span class="chip running">Checking…</span>'
        : isQ ? '<span class="chip">Waiting</span>'
        : r ? `<span class="chip ${r.status}">${CHIP[r.status]}</span>` : '<span class="chip">Not checked</span>';
      const flagged = r ? r.items.filter((i) => i.status === 'bad' || i.status === 'warn').length : 0;
      const desc = r && !isRun
        ? `${r.status === 'error' ? 'The check could not finish. ' : flagged ? `${flagged} of ${r.items.length} findings need a look. ` : r.status === 'good' ? `All ${r.items.length} checks passed. ` : ''}Checked ${fmt.ago(r.at)}.`
        : p.desc;
      const expanded = open.has(p.id) && r && !isRun;
      return `<div class="hc-item">
        <div class="hc-row">
          <span class="hc-icon">${ICON[p.id]}</span>
          <div><h3>${fmt.esc(p.name)}</h3><p>${fmt.esc(desc)}</p></div>
          ${chip}
          <div style="display:flex;gap:6px">
            ${r && !isRun ? `<button class="btn ghost small" data-toggle="${p.id}" aria-expanded="${expanded}">${expanded ? 'Hide details' : 'Show details'}</button>` : ''}
            <button class="btn small" data-run="${p.id}" ${isRun || isQ ? 'disabled' : ''}>${r ? 'Check again' : 'Check'}</button>
          </div>
        </div>
        ${expanded ? `<div class="hc-results">${r.items.map(finding).join('')}<div class="hc-meta">Took ${(r.ms / 1000).toFixed(1)} seconds.</div></div>` : ''}
      </div>`;
    }).join('');
    renderSummary();
    updateChip();
  }

  const counts = () => {
    const list = parts.map((p) => results[p.id]).filter(Boolean);
    const n = (s) => list.filter((r) => r.status === s).length;
    return { list, bad: n('bad'), warn: n('warn'), good: n('good'), unjudged: n('info') + n('error') };
  };

  function renderSummary() {
    const { list, bad, warn, good, unjudged } = counts();
    const el = $('#hc-summary');
    if (!list.length) { el.hidden = true; return; }
    el.hidden = false;
    const missing = parts.length - list.length;
    const total = list.length;
    // Ring: share of healthy parts.
    const CIRC = 2 * Math.PI * 22;
    const seg = (n, off, color) => `<circle cx="27" cy="27" r="22" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${(n / total) * CIRC} ${CIRC}" stroke-dashoffset="${-off * CIRC / total}" transform="rotate(-90 27 27)"/>`;
    const ring = `<svg class="ring" viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="none" stroke="var(--line)" stroke-width="6"/>${seg(good, 0, 'var(--ok)')}${seg(warn, good, 'var(--amber)')}${seg(bad, good + warn, 'var(--hot)')}</svg>`;
    const head = bad ? `${bad} part${bad > 1 ? 's need' : ' needs'} attention` : warn ? `${warn} part${warn > 1 ? 's are' : ' is'} worth a look` : good ? 'Your PC is in good shape' : 'Nothing could be judged yet';
    el.innerHTML = `${ring}<div><strong>${head}</strong><span>${good} of ${total} checked parts are healthy.${unjudged ? ` ${unjudged} couldn't be judged.` : ''}${missing ? ` ${missing} not checked yet.` : ''} Open a part below to see what was found and what to do.</span></div>`;
  }

  function updateChip() {
    const chip = $('#health-chip');
    const { list, bad, warn } = counts();
    let cls = 'idle', text = 'Run a health check';
    if (running.size || queued.size) { cls = 'running'; text = 'Checking your PC…'; }
    else if (list.length) {
      cls = bad ? 'bad' : warn ? 'warn' : 'good';
      text = bad ? `${bad} part${bad > 1 ? 's need' : ' needs'} attention` : warn ? `${warn} part${warn > 1 ? 's' : ''} worth a look` : 'All checked parts are healthy';
    }
    chip.className = `health-chip ${cls}`;
    $('#health-chip-text').textContent = text;
    const dot = $('#nav-health-dot');
    dot.hidden = !(bad || warn) || running.size > 0;
    dot.className = `nav-dot${bad ? ' bad' : ''}`;
  }

  async function run(id) {
    if (running.has(id)) return;
    queued.delete(id);
    running.add(id);
    open.add(id);
    render();
    const r = await attempt(() => hw.healthRun(id));
    running.delete(id);
    if (r) { results[id] = r; save(); }
    render();
  }

  async function runAll() {
    const ids = parts.map((p) => p.id).filter((id) => !running.has(id));
    ids.forEach((id) => queued.add(id));
    render();
    // Two at a time keeps the PC responsive while the checks read event logs.
    const work = [...ids];
    const lane = async () => { while (work.length) await run(work.shift()); };
    await Promise.all([lane(), lane()]);
    open.clear();
    for (const id of ids) if (results[id] && results[id].status !== 'good') open.add(id);
    render();
  }

  $('#hc-all').addEventListener('click', runAll);
  $('#hc-list').addEventListener('click', (e) => {
    const r = e.target.closest('[data-run]'); if (r) return run(r.dataset.run);
    const t = e.target.closest('[data-toggle]');
    if (t) { open.has(t.dataset.toggle) ? open.delete(t.dataset.toggle) : open.add(t.dataset.toggle); render(); }
  });

  hw.healthChecks().then((list) => { parts = list; render(); }, (e) => console.error(e));
  return { run, runAll, busy: () => running.size + queued.size > 0 };
})();

// ---------- Bluetooth ----------
views.bluetooth = (() => {
  let timer = null;
  const KIND = { audio: 'Headphones or speaker', keyboard: 'Keyboard', mouse: 'Mouse', controller: 'Game controller', phone: 'Phone', wearable: 'Watch or wearable', other: 'Bluetooth device' };

  function card(d) {
    return `<div class="bt-dev ${d.connected ? 'on' : ''}">
      <span class="dic">${ICON[d.kind] || ICON.other}</span>
      <b title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</b>
      <small>${KIND[d.kind]}, ${d.lowEnergy ? 'Bluetooth LE' : 'Classic Bluetooth'}</small>
      <div class="bt-line"><span class="pill ${d.connected ? 'on' : 'off'}">${d.connected ? 'Connected' : 'Not connected'}</span>${battHtml(d.battery, !d.connected)}</div>
    </div>`;
  }

  function empty(sub, hint) {
    $('#bt-sub').textContent = sub;
    $('#bt-adapter').innerHTML = `<div class="bt-empty">${fmt.esc(hint)}</div>`;
    $('#bt-connected').innerHTML = ''; $('#bt-paired').innerHTML = '';
  }

  async function refresh() {
    let b;
    try { b = await hw.bluetooth(true); } catch (e) { return empty(e.message, 'Windows may still be starting its Bluetooth service.'); }
    if (!b.adapters.length) return empty('No Bluetooth adapter was found on this PC.', 'If your PC has Bluetooth, it may be switched off in the BIOS or missing a driver. Check Device Manager.');
    const a = b.adapters[0];
    const conn = b.devices.filter((d) => d.connected);
    const paired = b.devices.filter((d) => !d.connected);
    const on = !radioOff(b.radio);
    $('#bt-sub').textContent = b.radio === 'disabled'
      ? 'The Bluetooth radio is disabled. A hardware switch, flight mode or a policy may have turned it off.'
      : !on
        ? 'Bluetooth is turned off. Turn it on in Bluetooth settings to use your devices.'
        : `Bluetooth is on. ${conn.length ? `${conn.length} device${conn.length > 1 ? 's' : ''} connected` : 'Nothing connected right now'}, ${b.devices.length} paired in total.`;
    const age = fmt.age(a.date);
    $('#bt-adapter').innerHTML = `
      <span class="bt-logo ${on ? '' : 'off'}">${ICON.bluetooth}</span>
      <div><span class="k">Adapter</span><span class="v" title="${fmt.esc(a.name)}">${fmt.esc(a.name)}</span></div>
      <div><span class="k">Status</span><span class="v" style="color:${a.status !== 'OK' ? 'var(--hot)' : on ? 'var(--ok)' : 'var(--muted)'}">${a.status !== 'OK' ? 'Problem reported' : on ? 'On and working' : 'Turned off'}</span></div>
      <div><span class="k">Driver</span><span class="v">${fmt.esc(a.version || '–')}</span><span class="k">${fmt.esc(age.text)}${age.rel ? `, ${age.rel}` : ''}</span></div>
      <div><span class="k">Bluetooth service</span><span class="v">${b.service === 'Running' ? 'Running' : fmt.esc(b.service || 'Unknown')}</span></div>`;
    $('#bt-connected').innerHTML = conn.length ? conn.map(card).join('') : '<div class="bt-empty">No devices are connected right now.</div>';
    $('#bt-paired').innerHTML = paired.length ? paired.map(card).join('') : '<div class="bt-empty">Every paired device is connected.</div>';
  }

  return {
    enter() { refresh(); timer = setInterval(refresh, 10000); },
    leave() { clearInterval(timer); timer = null; },
  };
})();

views.overview.start();

// A deliberately small handle for HD_CAPTURE screenshots (main.js) and the DevTools console.
window.hd = {
  show,
  scan: (folder) => bus.emit('scan', folder),
  scanRunning: () => state.scan.running,
  checkHealth: () => views.health.runAll(),
  healthRunning: () => views.health.busy(),
};
