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
      l.cpu.cores.forEach((v, i) => bars[i] && bars[i].style.setProperty('--h', Math.max(0, Math.min(100, v)) / 100));
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
      b.style.cssText = fill(pct);
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
        <div class="meter ${meterClass(p)}"><i style="${fill(p)}"></i></div>
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
    whileVisible(1500, tick);
    // The ping and the Bluetooth card are only on this page.
    const onPage = (fn) => () => { if (current === 'overview') fn(); };
    pingTick(); whileVisible(10000, onPage(pingTick));
    renderBluetooth(); whileVisible(20000, onPage(renderBluetooth));
  }
  return { start, enter() { pingTick(); renderBluetooth(); } };
})();
