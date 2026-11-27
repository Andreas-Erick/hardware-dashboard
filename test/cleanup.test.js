const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCleanup, emptyFolder } = require('../src/cleanup');
const { folderSize } = require('../src/fs-walk');
const { createShell } = require('../src/shell');
const { memFs, fakeExec } = require('./helpers');

const DAY = 24 * 3600 * 1000;

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-cleanup-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(file, bytes, ageMs = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
}
const age = (p, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(p, t, t); };

test('clearing with "older than a day" keeps new files even inside old folders', async () => {
  const dir = tmp();
  write(path.join(dir, 'old.tmp'), 10, 3 * DAY);
  write(path.join(dir, 'new.tmp'), 10);
  write(path.join(dir, 'oldfolder', 'stale.log'), 10, 3 * DAY);
  write(path.join(dir, 'oldfolder', 'fresh.log'), 10);
  write(path.join(dir, 'gone', 'a', 'b.tmp'), 10, 5 * DAY);
  age(path.join(dir, 'gone', 'a'), 5 * DAY);
  age(path.join(dir, 'gone'), 5 * DAY);
  age(path.join(dir, 'oldfolder'), 3 * DAY);

  const r = await emptyFolder(dir, DAY);
  assert.ok(!fs.existsSync(path.join(dir, 'old.tmp')));
  assert.ok(fs.existsSync(path.join(dir, 'new.tmp')));
  assert.ok(!fs.existsSync(path.join(dir, 'oldfolder', 'stale.log')));
  assert.ok(fs.existsSync(path.join(dir, 'oldfolder', 'fresh.log')), 'a fresh file inside an old folder is kept');
  assert.ok(!fs.existsSync(path.join(dir, 'gone')), 'an old folder that ends up empty is removed');
  assert.equal(r.skipped, 2);
});

test('clearing without an age limit empties the folder but keeps it', async () => {
  const dir = tmp();
  write(path.join(dir, 'a', 'b.bin'), 10);
  write(path.join(dir, 'c.bin'), 10);
  const r = await emptyFolder(dir, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(r.removed, 2);
});

test('folder size skips links and reports unreadable parts and missing folders', async () => {
  const fsx = memFs({ 'C:\\c': { 'a.bin': 5, sub: { 'b.bin': 7 }, locked: null, link: '->' } });
  assert.deepEqual(await folderSize('C:\\c', { fs: fsx }), { size: 12, files: 2, exists: true, denied: true });
  assert.deepEqual(await folderSize('C:\\nothing', { fs: fsx }), { size: 0, files: 0, exists: false, denied: false });
  assert.deepEqual(await folderSize('C:\\c\\locked', { fs: fsx }), { size: 0, files: 0, exists: true, denied: true });
});

function cleanupIn(dir, rules = []) {
  const places = { home: path.join(dir, 'home'), temp: path.join(dir, 'temp'), local: path.join(dir, 'local'), windows: path.join(dir, 'win'), systemDrive: 'Z:' };
  return createCleanup({ places, shell: createShell({ exec: fakeExec(rules) }) });
}

test('items report labelled parts, and Downloads says which folder to review', async () => {
  const dir = tmp();
  write(path.join(dir, 'local', 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'x'), 3000);
  write(path.join(dir, 'local', 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache', 'y'), 1000);
  write(path.join(dir, 'home', 'Downloads', 'setup.exe'), 500);
  const items = {};
  await cleanupIn(dir).listAll((i) => { items[i.id] = i; });

  assert.equal(Object.keys(items).length, 10);
  assert.deepEqual(items.browser.parts, [{ label: 'Chrome', size: 3000 }, { label: 'Edge', size: 1000 }]);
  assert.equal(items.browser.size, 4000);
  assert.equal(items.browser.measure, undefined, 'only data crosses to the page');
  assert.equal(items.downloads.review, path.join(dir, 'home', 'Downloads'));
  assert.equal(items.shader.size, 0);
  assert.equal(items.recycle.size, null, 'no user SID from the fake shell');
});

test('clearing an item frees space and reports what was kept', async () => {
  const dir = tmp();
  write(path.join(dir, 'temp', 'old.tmp'), 4000, 2 * DAY);
  write(path.join(dir, 'temp', 'new.tmp'), 1000);
  const r = await cleanupIn(dir).clear('user-temp');
  assert.deepEqual([r.freed, r.removed, r.skipped, r.size], [4000, 1, 1, 1000]);
  await assert.rejects(cleanupIn(dir).clear('downloads'), /cannot be cleared/);
  await assert.rejects(cleanupIn(dir).clear('C:\\Windows'), /cannot be cleared/);
});

test('the hibernation item advises turning hibernation off only when the file is big', async () => {
  const dir = tmp();
  const items = {};
  await cleanupIn(dir, [{ match: 'hiberfil.sys', stdout: [{ Name: 'hiberfil.sys', Length: 6 * 1024 ** 3 }, { Name: 'pagefile.sys', Length: 2 * 1024 ** 3 }] }])
    .listAll((i) => { items[i.id] = i; });
  assert.deepEqual(items.hiber.parts.map((p) => p.label), ['hiberfil.sys', 'pagefile.sys']);
  assert.equal(items.hiber.advice.size, 6 * 1024 ** 3);
});
