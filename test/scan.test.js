const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiskScan } = require('../src/scan');
const { inProcessSpawn } = require('../src/scan/in-process');
const { createTrashGuard } = require('../src/scan/trash-guard');
const { createScanTree } = require('../src/scan/tree');
const { memFs } = require('./helpers');

const MB = 1024 * 1024;
const TREE = {
  'C:\\data': {
    videos: { 'a.mp4': 900 * MB, 'b.mkv': 300 * MB, 'note.txt': 1 * MB },
    mixed: { 'x.zip': 10 * MB, 'y.pdf': 10 * MB, 'z.exe': 10 * MB },
    locked: null,
    'shortcut-to-c': '->',
    'big.iso': 500 * MB,
    'readme.md': 2 * MB,
    'weird.thisextensionistoolong': 3 * MB,
  },
};

function makeScan(opts = {}) {
  const spawn = opts.spawn || inProcessSpawn({ fs: memFs(opts.tree || TREE) });
  const trashed = [];
  const scan = createDiskScan({
    spawn,
    exists: () => true,
    blockReason: opts.blockReason || createTrashGuard({ protectedTrees: ['C:\\Windows'], protectedFolders: ['C:\\Users'] }),
    trashItem: async (p) => { if (opts.trashFails) throw new Error('in use'); trashed.push(p); },
    getDrives: opts.getDrives,
    limits: opts.limits,
  });
  return { scan, trashed };
}
const scanned = (scan, root = 'C:\\data') => new Promise((resolve) => scan.start(root, { onDone: resolve }));

test('a finished scan lists a folder largest first, with crumbs and what fills each folder', async () => {
  const { scan } = makeScan();
  const done = await scanned(scan);
  assert.equal(done.done, true);
  assert.equal(done.files, 9);
  assert.equal(done.denied, 1);

  const data = await scan.children('C:\\data');
  assert.equal(data.isRoot, true);
  assert.deepEqual(data.items.map((i) => i.name), ['videos', 'big.iso', 'mixed', 'weird.thisextensionistoolong', 'readme.md', 'locked']);
  assert.ok(!data.items.some((i) => i.name === 'shortcut-to-c'), 'symlinks are skipped');
  const videos = data.items[0];
  assert.equal(videos.mostly, 'video');
  assert.equal(videos.count, 3);
  assert.equal(videos.sub[0].name, 'a.mp4');
  assert.equal(data.items.find((i) => i.name === 'mixed').mostly, null, 'a three-way split is a mixed folder');
  assert.equal(data.items.find((i) => i.name === 'locked').denied, true);
  assert.equal(data.items.find((i) => i.name === 'big.iso').cat, 'setup');

  const sub = await scan.children('C:\\DATA\\Videos');
  assert.deepEqual(sub.crumbs, [{ name: 'C:\\data', path: 'C:\\data' }, { name: 'videos', path: 'C:\\data\\videos' }]);
  assert.equal(sub.parent, 'C:\\data');
  scan.stop();
});

test('the folder listing limit hides the smallest items and says how many', async () => {
  const { scan } = makeScan({ limits: { children: 2, largest: 3 } });
  await scanned(scan);
  const data = await scan.children('C:\\data');
  assert.equal(data.items.length, 2);
  assert.equal(data.hiddenCount, 4);
  assert.equal((await scan.largest()).length, 3);
  scan.stop();
});

test('largest files and file types agree on categories, including odd extensions', async () => {
  const { scan } = makeScan();
  await scanned(scan);
  const largest = await scan.largest();
  assert.deepEqual(largest.slice(0, 2).map((f) => [f.name, f.cat]), [['a.mp4', 'video'], ['big.iso', 'setup']]);
  const types = await scan.types();
  const none = types.find((t) => t.ext === '(none)');
  assert.deepEqual([none.cat, none.count], ['other', 1]);
  assert.equal(types.find((t) => t.ext === '.mp4').cat, 'video');
  scan.stop();
});

test('moving a folder to the Recycle Bin removes it from every view and the totals', async () => {
  const { scan, trashed } = makeScan();
  const before = await scanned(scan);
  await scan.trash('C:\\data\\videos');
  assert.deepEqual(trashed, ['C:\\data\\videos']);
  const data = await scan.children('C:\\data');
  assert.ok(!data.items.some((i) => i.name === 'videos'));
  assert.equal(data.size, before.bytes - 1201 * MB);
  assert.ok(!(await scan.largest()).some((f) => f.path.startsWith('C:\\data\\videos')));
  assert.ok(!(await scan.types()).some((t) => t.ext === '.mp4'));
  await assert.rejects(scan.children('C:\\data\\videos'), /isn't part of the scan/);
  scan.stop();
});

test('removing a folder also takes its subfolders out of the folder and unreadable counts', () => {
  const t = createScanTree('C:\\d');
  const outer = t.addDir(t.root, 'outer');
  t.addFile(t.addDir(outer, 'inner'), 'f.txt', 1);
  t.markDenied(t.addDir(outer, 'closed'));
  t.addFile(t.root, 'keep.txt', 1);
  assert.deepEqual([t.stats().dirs, t.stats().denied, t.stats().files], [3, 1, 2]);
  assert.equal(t.remove('C:\\d\\outer'), true);
  assert.deepEqual([t.stats().dirs, t.stats().denied, t.stats().files, t.stats().bytes], [0, 0, 1, 1]);
  assert.equal(t.remove('C:\\d\\outer'), false, 'already gone');
  assert.equal(t.remove('C:\\d'), false, 'the scanned folder itself stays');
});

test('trash is refused outside the scan, for the scanned folder itself, and while the scan runs', async () => {
  const { scan, trashed } = makeScan();
  await assert.rejects(scan.trash('C:\\data\\big.iso'), /Only items found by the current scan/, 'nothing scanned yet');
  const finished = scanned(scan);
  await assert.rejects(scan.trash('C:\\data\\big.iso'), /Wait for the scan to finish/);
  await finished;
  await assert.rejects(scan.trash('C:\\data'), /Only items found by the current scan/);
  await assert.rejects(scan.trash('C:\\elsewhere\\x'), /Only items found by the current scan/);
  assert.deepEqual(trashed, []);
  scan.stop();
});

test('when Windows refuses to recycle an item, the scan keeps it', async () => {
  const { scan } = makeScan({ trashFails: true });
  await scanned(scan);
  await assert.rejects(scan.trash('C:\\data\\big.iso'), /couldn't move it to the Recycle Bin/);
  assert.ok((await scan.children('C:\\data')).items.some((i) => i.name === 'big.iso'));
  scan.stop();
});

test('a crashed scan reports the error, settles waiting questions and refuses new ones', async () => {
  let worker;
  const base = inProcessSpawn({ fs: memFs(TREE) });
  const spawn = (root, opts) => (worker = base(root, opts));
  const { scan } = makeScan({ spawn });
  const done = new Promise((resolve) => scan.start('C:\\data', { onDone: resolve }));
  const waiting = scan.children('C:\\data');
  worker.crash(new Error('out of memory'));
  const result = await done;
  assert.equal(result.error, 'out of memory');
  await assert.rejects(waiting, /out of memory/);
  await assert.rejects(scan.largest(), /out of memory/);
  assert.equal(scan.running, false);
});

test('at the root of a drive the listing says how the scan compares with the space Windows reports', async () => {
  const GB = 1024 ** 3;
  const tree = { 'D:\\': { 'game.pak': 40 * GB } };
  const { scan } = makeScan({ tree, getDrives: async () => [{ mount: 'D:', size: 500 * GB, used: 100 * GB }] });
  await scanned(scan, 'D:\\');
  const data = await scan.children('D:\\');
  assert.equal(data.unreadable, 60 * GB);
  assert.equal(data.overcounted, false);
  scan.stop();
});

test('starting a scan of a folder that does not exist fails with a readable message', () => {
  const scan = createDiskScan({ exists: () => false, blockReason: () => null, trashItem: async () => {} });
  assert.throws(() => scan.start('C:\\nope'), /doesn't exist/);
  assert.throws(() => scan.start('relative\\path'), /doesn't exist/);
});
