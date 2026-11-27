// Test adapters: an in-memory filesystem for the folder walk and the disk scan,
// and a replaying `exec` for the shell module.
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

/**
 * fakeExec([{ match: /Get-PhysicalDisk/, stdout: '...' }, { match: 'nvidia-smi', error: 'ENOENT' }])
 * Matches against the command plus its arguments; the first rule that matches answers. Unmatched calls fail.
 */
function fakeExec(rules) {
  const calls = [];
  const exec = (cmd, args, _opts, cb) => {
    const line = [cmd, ...args].join(' ');
    // Encoded PowerShell is decoded so rules can match the script text.
    const i = args.indexOf('-EncodedCommand');
    const text = i >= 0 ? `${line} ${Buffer.from(args[i + 1], 'base64').toString('utf16le')}` : line;
    calls.push(text);
    const rule = rules.find((r) => (typeof r.match === 'string' ? text.includes(r.match) : r.match.test(text)));
    setImmediate(() => {
      if (!rule) return cb(Object.assign(new Error('no rule'), { code: 1 }), '', 'no rule');
      if (rule.error === 'ENOENT') return cb(Object.assign(new Error('not found'), { code: 'ENOENT' }), '', '');
      if (rule.error === 'timeout') return cb(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '', '');
      if (rule.error) return cb(Object.assign(new Error('failed'), { code: 1 }), '', rule.stderr || rule.error);
      cb(null, typeof rule.stdout === 'string' ? rule.stdout : JSON.stringify(rule.stdout), '');
    });
  };
  exec.calls = calls;
  return exec;
}

module.exports = { memFs, fakeExec };
