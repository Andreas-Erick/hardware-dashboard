/* Squarified treemap (Bruls, Huizing & van Wijk). Items: [{ value, ... }] sorted largest first. */
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const rest = items.filter((i) => i.value > 0).map((i) => ({ item: i, area: i.value * scale }));
  const out = [];
  let row = [];

  const worst = (r, len) => {
    let s = 0, mx = 0, mn = Infinity;
    for (const e of r) { s += e.area; if (e.area > mx) mx = e.area; if (e.area < mn) mn = e.area; }
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  const layout = () => {
    const s = row.reduce((a, e) => a + e.area, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const e of row) { const eh = e.area / cw; out.push({ ...e.item, x, y: cy, w: cw, h: eh }); cy += eh; }
      x += cw; w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const e of row) { const ew = e.area / rh; out.push({ ...e.item, x: cx, y, w: ew, h: rh }); cx += ew; }
      y += rh; h -= rh;
    }
    row = [];
  };

  let i = 0;
  while (i < rest.length) {
    const len = Math.min(w, h);
    const next = rest[i];
    if (!row.length || worst([...row, next], len) <= worst(row, len)) { row.push(next); i++; }
    else layout();
  }
  if (row.length) layout();
  return out;
}

/**
 * Draw one folder level as tiles. Folder tiles big enough get a second, inner level
 * so you can see what's inside before clicking.
 */
function renderTreemap(el, items, { onOpen, onReveal, colorOf, tip }) {
  el.innerHTML = '';
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H || !items.length) return;
  const frag = document.createDocumentFragment();
  const rects = squarify(items.map((it) => ({ ...it, value: it.size })), 0, 0, W, H);

  for (const r of rects) {
    const d = document.createElement('div');
    d.className = 'tm';
    if (r.unread) d.classList.add('unread');
    else if (r.isDir) d.classList.add('dir');
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${Math.max(0, r.w)}px;height:${Math.max(0, r.h)}px;--c:${colorOf(r)};background:${r.unread ? '' : colorOf(r)}`;
    const showLabel = r.w > 46 && r.h > 20;
    if (showLabel) {
      const t = document.createElement('div');
      t.className = 'tl';
      t.innerHTML = `${fmt.esc(r.name)} <small>${fmt.bytes(r.size)}</small>`;
      d.appendChild(t);
      if (r.w > 180 && r.h > 80) d.classList.add('big-label');
    }

    // Inner level: what's inside this folder.
    if (r.isDir && r.sub && r.sub.length && r.w > 70 && r.h > 56) {
      const pad = 3, top = 22;
      const rem = r.size - r.sub.reduce((s, x) => s + x.size, 0);
      const subs = [...r.sub];
      if (rem > r.size * 0.01) subs.push({ name: 'Everything else', size: rem, isDir: false, rest: true });
      const inner = squarify(subs.map((s) => ({ ...s, value: s.size })), pad, top, r.w - pad * 2, r.h - top - pad);
      for (const s of inner) {
        if (s.w < 3 || s.h < 3) continue;
        const sd = document.createElement('div');
        sd.className = 'tm inner';
        sd.style.cssText = `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;background:${s.rest ? 'rgba(15,24,32,0.18)' : colorOf(s, true)}`;
        if (s.w > 60 && s.h > 18) {
          const t = document.createElement('div');
          t.className = 'tl';
          t.style.fontWeight = '400';
          t.textContent = s.name;
          sd.appendChild(t);
        }
        sd.addEventListener('mousemove', (e) => { e.stopPropagation(); tip.show(e, `${s.name}`, `${fmt.bytes(s.size)} inside ${r.name}`); });
        d.appendChild(sd);
      }
    }

    if (!r.unread) {
      if (r.isDir) d.addEventListener('click', () => onOpen(r));
      else d.addEventListener('dblclick', () => onReveal(r));
    }
    d.addEventListener('mousemove', (e) => tip.show(e, r.name, r.unread ? r.note : `${fmt.bytes(r.size)}${r.isDir ? `, ${fmt.int(r.count)} files. Click to open.` : '. Double-click to show in Explorer.'}`));
    d.addEventListener('mouseleave', () => tip.hide());
    frag.appendChild(d);
  }
  el.appendChild(frag);
}

function makeTip() {
  const t = document.createElement('div');
  t.className = 'tm-tip';
  t.hidden = true;
  document.body.appendChild(t);
  return {
    show(e, title, body) {
      t.innerHTML = `<b>${fmt.esc(title)}</b><span>${fmt.esc(body)}</span>`;
      t.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 10);
      const y = Math.min(e.clientY + 16, window.innerHeight - t.offsetHeight - 10);
      t.style.left = `${x}px`; t.style.top = `${y}px`;
    },
    hide() { t.hidden = true; },
  };
}
