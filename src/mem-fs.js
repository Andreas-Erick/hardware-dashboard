// An in-memory filesystem with the same list/size shape as realFs in fs-walk.js.
// Used by the tests and by the demo mode's disk scan (src/demo.js).
const path = require('path');

/**
 * memFs({ 'C:\\data': { 'a.mp4': 100, sub: { 'b.txt': 5 }, locked: null, link: '->' } })
 * A number is a file of that size, an object a folder, null a folder that can't be opened, '->' a symlink.
 */
function memFs(tree) {
  const lookup = (p) => {
    const abs = path.resolve(p);
    for (const [rootPath, node] of Object.entries(tree)) {
      const rel = path.relative(path.resolve(rootPath), abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      let n = node;
      for (const seg of rel.split(path.sep).filter(Boolean)) {
        if (!n || typeof n !== 'object' || !(seg in n)) return undefined;
        n = n[seg];
      }
      return n;
    }
    return undefined;
  };
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    async list(dir) {
      const n = lookup(dir);
      if (n === undefined) throw err('ENOENT');
      if (n === null) throw err('EACCES');
      if (typeof n !== 'object') throw err('ENOTDIR');
      return Object.entries(n).map(([name, v]) => ({
        name,
        kind: v === '->' ? 'link' : typeof v === 'number' ? 'file' : 'dir',
      }));
    },
    async size(file) {
      const n = lookup(file);
      if (typeof n !== 'number') throw err('ENOENT');
      return n;
    },
  };
}

module.exports = { memFs };
