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

  // Details that were already showing are redrawn as they are; only newly opened ones fade in.
  let shown = new Set();
  function render() {
    const isOpen = (id) => open.has(id) && results[id] && !running.has(id);
    const nowShown = new Set(parts.map((p) => p.id).filter(isOpen));
    const reveal = new Set([...nowShown].filter((id) => !shown.has(id)));
    shown = nowShown;
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
      const expanded = nowShown.has(p.id);
      return `<div class="hc-item">
        <div class="hc-row">
          <span class="hc-icon">${ICON[p.id]}</span>
          <div><h3>${fmt.esc(p.name)}</h3><p>${fmt.esc(desc)}</p></div>
          ${chip}
          <div class="hc-actions">
            ${r && !isRun ? `<button class="btn ghost small" data-toggle="${p.id}" aria-expanded="${expanded}">${expanded ? 'Hide details' : 'Show details'}</button>` : ''}
            <button class="btn small" data-run="${p.id}" ${isRun || isQ ? 'disabled' : ''}>${r ? 'Check again' : 'Check'}</button>
          </div>
        </div>
        ${expanded ? `<div class="hc-results${reveal.has(p.id) ? ' enter' : ''}">${r.items.map(finding).join('')}<div class="hc-meta">Took ${(r.ms / 1000).toFixed(1)} seconds.</div></div>` : ''}
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
