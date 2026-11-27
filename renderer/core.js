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

/** Plays el's exit animation (started by adding cls), then calls done. The timer covers a missed animationend. */
function playExit(el, cls, done) {
  let finished = false;
  const end = () => { if (finished) return; finished = true; el.classList.remove(cls); done(); };
  el.addEventListener('animationend', end, { once: true });
  el.classList.add(cls);
  setTimeout(end, 300);
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = `toast${err ? ' err' : ''}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => playExit(t, 'leaving', () => t.remove()), err ? 7000 : 4500);
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

let modalSeq = 0;
function confirmModal({ title, body, ok = 'OK', danger = true }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    const okBtn = $('#modal-ok');
    const cancelBtn = $('#modal-cancel');
    const back = document.activeElement;
    const token = ++modalSeq; // a modal opened while the last one is still fading out keeps it from hiding this one
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
    m.classList.remove('closing');
    m.hidden = false;
    cancelBtn.focus();
    const done = (v) => {
      document.removeEventListener('keydown', key);
      okBtn.onclick = null; cancelBtn.onclick = null; m.onclick = null;
      resolve(v);
      playExit(m, 'closing', () => {
        if (token !== modalSeq) return;
        m.hidden = true;
        if (back && back.isConnected) back.focus();
      });
    };
    // Escape cancels; Tab stays on the two buttons so focus can't wander to the page behind.
    const key = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === okBtn ? cancelBtn : okBtn).focus(); }
    };
    document.addEventListener('keydown', key);
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
  });
}

/**
 * Calls fn every ms while the window can be seen, and once more as soon as it is shown again.
 * A minimised or hidden window starts no PowerShell, pings or redraws. Returns a function that stops it.
 */
function whileVisible(ms, fn) {
  const run = () => { if (!document.hidden) fn(); };
  const id = setInterval(run, ms);
  document.addEventListener('visibilitychange', run);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', run); };
}

const meterClass = (p) => (p >= 90 ? 'full' : p >= 75 ? 'warn' : '');
/** A meter fill's --p: the share as 0..1. The CSS scales the fill with it, so updates never cause a layout. */
const fill = (p) => `--p:${Math.max(0, Math.min(100, p || 0)) / 100}`;
function setMeter(el, p) {
  el.className = `meter ${meterClass(p)}`;
  el.firstElementChild.style.cssText = fill(p);
}

