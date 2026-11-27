// Runs Windows programs and PowerShell for the rest of the app.
//
// Every call resolves (never rejects) with one of:
//   { ok: true, stdout }                          run / ps / psFile
//   { ok: true, data }                            psJson / psFileJson (data is null for empty output)
//   { ok: false, reason, message }                reason: 'timeout' | 'missing' | 'denied' | 'failed'
//
// PowerShell's ConvertTo-Json quirks are handled here once: empty values arrive as {} and are turned
// into null. Use `asArray` for fields PowerShell sends as a single object when there is only one.
const { execFile } = require('child_process');
const fs = require('fs');

const PS_PRELUDE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'";
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

function classify(err, stderr) {
  if (err.code === 'ENOENT') return 'missing';
  if (err.killed || err.signal) return 'timeout';
  if (/access is denied|unauthorizedaccess|requires elevation/i.test(stderr)) return 'denied';
  return 'failed';
}

/** Empty objects (PowerShell's way of writing "nothing") become null, recursively. */
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return null;
    const o = {};
    for (const k of keys) o[k] = normalize(v[k]);
    return o;
  }
  return v;
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function parseJson(r) {
  if (!r.ok) return r;
  const text = r.stdout.trim();
  if (!text) return { ok: true, data: null };
  try {
    return { ok: true, data: normalize(JSON.parse(text)) };
  } catch {
    return { ok: false, reason: 'failed', message: 'The output was not valid JSON.' };
  }
}

/**
 * `exec` has the shape of child_process.execFile: (cmd, args, options, callback(err, stdout, stderr)).
 * Tests pass one that replays recorded output.
 */
function createShell({ exec = execFile, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  function run(cmd, args, timeout = 10000) {
    return new Promise((resolve) => {
      exec(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, stdout: String(stdout ?? '') });
        const why = classify(err, String(stderr ?? ''));
        resolve({ ok: false, reason: why, message: String(stderr || err.message || why).trim().split(/\r?\n/)[0] });
      });
    });
  }

  /** A PowerShell snippet with UTF-8 output (device names on non-English Windows contain umlauts etc.). */
  const ps = (script, timeout = 20000) => run('powershell.exe', [...PS_ARGS, '-Command', `${PS_PRELUDE}; ${script}`], timeout);

  /** A .ps1 file shipped with the app, sent as an encoded command so it works from any install location. */
  const scripts = new Map();
  function psFile(file, timeout = 30000) {
    if (!scripts.has(file)) scripts.set(file, `${PS_PRELUDE}\n${readFile(file)}`);
    const encoded = Buffer.from(scripts.get(file), 'utf16le').toString('base64');
    return run('powershell.exe', [...PS_ARGS, '-EncodedCommand', encoded], timeout);
  }

  return {
    run,
    ps,
    psFile,
    psJson: async (script, timeout) => parseJson(await ps(script, timeout)),
    psFileJson: async (file, timeout) => parseJson(await psFile(file, timeout)),
  };
}

const shell = createShell();

module.exports = { createShell, shell, asArray, normalize };
