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
