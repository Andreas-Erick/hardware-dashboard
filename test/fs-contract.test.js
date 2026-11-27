// The scan and cleanup tests use memFs in place of the real filesystem. This contract runs the same
// questions against both, so the fake can't quietly drift from what Windows really answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { realFs, folderSize } = require('../src/fs-walk');
const { memFs } = require('./helpers');

// The same tree, described once: a number is a file of that size, an object a folder, '->' a link.
const SHAPE = { 'a.bin': 5, sub: { 'b.bin': 7, deeper: { 'c.bin': 11 } }, link: '->' };

function realTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-contract-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = (dir, shape) => {
    for (const [name, v] of Object.entries(shape)) {
      const p = path.join(dir, name);
      if (typeof v === 'number') fs.writeFileSync(p, Buffer.alloc(v));
      else if (v === '->') fs.symlinkSync(path.join(root, 'sub'), p, 'junction'); // junctions need no admin rights
      else { fs.mkdirSync(p); build(p, v); }
    }
  };
  build(root, SHAPE);
  return { root, fsx: realFs };
}
function fakeTree() {
  const root = path.resolve('C:\\contract');
  return { root, fsx: memFs({ [root]: SHAPE }) };
}

for (const [name, make] of [['real filesystem', realTree], ['memFs fake', fakeTree]]) {
  test(`${name}: lists folders, files and links by kind`, async () => {
    const { root, fsx } = make();
    const entries = (await fsx.list(root)).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(entries, [{ name: 'a.bin', kind: 'file' }, { name: 'link', kind: 'link' }, { name: 'sub', kind: 'dir' }]);
  });

  test(`${name}: reports file sizes and rejects missing ones with ENOENT`, async () => {
    const { root, fsx } = make();
    assert.equal(await fsx.size(path.join(root, 'sub', 'b.bin')), 7);
    await assert.rejects(fsx.size(path.join(root, 'nope.bin')), { code: 'ENOENT' });
    await assert.rejects(fsx.list(path.join(root, 'nope')), { code: 'ENOENT' });
  });

  test(`${name}: folder size counts every file once and does not follow links`, async () => {
    const { root, fsx } = make();
    assert.deepEqual(await folderSize(root, { fs: fsx }), { size: 23, files: 3, exists: true, denied: false });
  });
}
