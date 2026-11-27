// Test adapters: an in-memory filesystem for the folder walk and the disk scan (src/mem-fs.js),
// and a replaying `exec` for the shell module.
const { memFs } = require('../src/mem-fs');

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
