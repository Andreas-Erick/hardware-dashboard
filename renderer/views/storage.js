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
        <div class="meter ${meterClass(p)}"><i style="${fill(p)}"></i></div>
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
    $$('.tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
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
    $('#crumbs').innerHTML = data.crumbs.map((x, i) => `${i ? '<span class="sep">›</span>' : ''}<button data-p="${fmt.esc(x.path)}" title="${fmt.esc(x.path)}">${fmt.esc(x.name)}</button>`).join('');
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
    if (!rows.length) { $('#largest').innerHTML = '<div class="ft-empty">No files were found in this scan.</div>'; return; }
    $('#largest').innerHTML =`<div class="ft-row head-row" style="grid-template-columns:minmax(0,1fr) 120px 80px"><span>The ${rows.length} biggest files in ${fmt.esc(state.scan.root)}</span><span class="num" style="font:inherit">Size</span><span></span></div>` +
      rows.map((f) => `<div class="ft-row"><div class="path"><b><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px;background:${colorOf(f)}"></span>${fmt.esc(f.name)}</b><small>${fmt.esc(f.path)}</small></div>
          <span class="num">${fmt.bytes(f.size)}</span>
          <span class="acts"><button class="icon-btn" data-reveal="${fmt.esc(f.path)}" title="Show in Explorer" aria-label="Show in Explorer">${ICON.reveal}</button>
          <button class="icon-btn del" data-trash="${fmt.esc(f.path)}" data-size="${f.size}" data-name="${fmt.esc(f.name)}" title="Move to Recycle Bin" aria-label="Move to Recycle Bin">${ICON.trash}</button></span></div>`).join('');
  }

  async function renderTypes() {
    const rows = (await attempt(() => hw.scanTypes())) || [];
    if (!rows.length) { $('#types').innerHTML = '<div class="ft-empty">No files were found in this scan.</div>'; return; }
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
