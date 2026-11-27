/* Formatting helpers shared by every view. */
const fmt = (() => {
  // Binary units labelled the way Windows Explorer labels them, so numbers match what people see there.
  function bytes(b, digits) {
    if (b == null || !Number.isFinite(b)) return '–';
    const u = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = Math.abs(b);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    const d = digits ?? (i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2);
    return `${b < 0 ? '-' : ''}${v.toFixed(d)} ${u[i]}`;
  }
  const gb = (b, d = 1) => (b == null ? '–' : (b / 1024 ** 3).toFixed(d));
  const pct = (v, d = 0) => (v == null ? '–' : `${v.toFixed(d)}%`);
  const int = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
  function bps(b) {
    if (b == null) return '–';
    const mbit = b / 1e6;
    return mbit >= 100 ? mbit.toFixed(0) : mbit >= 10 ? mbit.toFixed(1) : mbit.toFixed(2);
  }
  function rate(bytesPerSec) {
    if (bytesPerSec == null) return '–';
    return `${bytes(bytesPerSec)}/s`;
  }
  function duration(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} day${d > 1 ? 's' : ''} ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min`;
  }
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function age(dateStr) {
    if (!dateStr) return { text: 'Unknown date', years: null };
    const d = new Date(dateStr);
    const years = (Date.now() - d.getTime()) / (365.25 * 86400000);
    const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    let rel;
    if (years < 1 / 12) rel = 'this month';
    else if (years < 1) rel = `${Math.max(1, Math.round(years * 12))} months old`;
    else rel = `${Math.floor(years)} year${Math.floor(years) > 1 ? 's' : ''} old`;
    return { text: when, rel, years };
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const { CATS, category } = window.HD_CATS;
  const FOLDER_COLOR = '#78b2cf';

  return { bytes, gb, pct, int, bps, rate, duration, ago, age, esc, CATS, category, FOLDER_COLOR };
})();
