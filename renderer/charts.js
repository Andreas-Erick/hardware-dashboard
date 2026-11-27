/* Minimal canvas sparklines: a filled line per series, sized for the device pixel ratio. */
class Spark {
  constructor(canvas, { max = null, series = [{ color: '#f4b860' }], points = 80 } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.max = max;
    this.series = series.map((s) => ({ ...s, data: [] }));
    this.points = points;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  push(...values) {
    values.forEach((v, i) => {
      const d = this.series[i].data;
      d.push(v == null ? null : v);
      if (d.length > this.points) d.shift();
    });
    this.draw();
  }
  draw() {
    const { c, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    // Resize the backing store when either side changes, or a height-only change draws stretched.
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Baseline and a faint midline so the shape has a reference.
    ctx.strokeStyle = 'rgba(142,162,178,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.setLineDash([]);

    let max = this.max;
    if (max == null) {
      max = 0;
      for (const s of this.series) for (const v of s.data) if (v > max) max = v;
      max = max * 1.15 || 1;
    }
    const step = w / (this.points - 1);
    for (const s of this.series) {
      const d = s.data;
      if (d.length < 2) continue;
      const x0 = w - (d.length - 1) * step;
      const y = (v) => h - 2 - (Math.min(v ?? 0, max) / max) * (h - 4);
      ctx.beginPath();
      d.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();
      // Mark the newest reading.
      const lx = x0 + (d.length - 1) * step, ly = y(d[d.length - 1]);
      ctx.save();
      ctx.beginPath(); ctx.arc(lx - 2, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      d.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
      if (s.fill !== false) {
        ctx.lineTo(w, h); ctx.lineTo(x0, h); ctx.closePath();
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, s.color + '55');
        g.addColorStop(1, s.color + '00');
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }
}
