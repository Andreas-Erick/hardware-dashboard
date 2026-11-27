// renderer/format.js is a plain browser script, so it is loaded the way the page loads it:
// into a context that already has the categories script's global.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFmt() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  vm.runInContext(read('shared/categories.js'), ctx);
  return vm.runInContext(`${read('renderer/format.js')}\nfmt`, ctx);
}
const fmt = loadFmt();

test('sizes use the units Windows Explorer shows, switching at 1024', () => {
  const rows = [
    [0, '0 bytes'],
    [1023, '1023 bytes'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [10 * 1024, '10.0 KB'],
    [100 * 1024, '100 KB'],
    [1024 ** 3, '1.00 GB'],
    [5 * 1024 ** 4, '5.00 TB'],
    [3 * 1024 ** 5, '3072 TB'],
    [-2048, '-2.00 KB'],
  ];
  for (const [b, text] of rows) assert.equal(fmt.bytes(b), text, `${b} bytes`);
});

test('sizes honour a fixed number of digits and show a dash when there is no number', () => {
  assert.equal(fmt.bytes(1536, 0), '2 KB');
  assert.equal(fmt.bytes(null), '–');
  assert.equal(fmt.bytes(NaN), '–');
  assert.equal(fmt.bytes(Infinity), '–');
  assert.equal(fmt.rate(2048), '2.00 KB/s');
  assert.equal(fmt.rate(null), '–');
});

test('speed test results are megabits with fewer decimals as they grow', () => {
  assert.equal(fmt.bps(5_430_000), '5.43');
  assert.equal(fmt.bps(10_000_000), '10.0');
  assert.equal(fmt.bps(99_940_000), '99.9');
  assert.equal(fmt.bps(100_000_000), '100');
  assert.equal(fmt.bps(null), '–');
});

test('uptime reads in the largest unit that applies', () => {
  assert.equal(fmt.duration(59), '0 min');
  assert.equal(fmt.duration(3599), '59 min');
  assert.equal(fmt.duration(3600), '1 h 0 min');
  assert.equal(fmt.duration(86400), '1 day 0 h');
  assert.equal(fmt.duration(2 * 86400 + 5 * 3600), '2 days 5 h');
});

test('text placed in the page is escaped', () => {
  assert.equal(fmt.esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(fmt.esc(null), '');
});
