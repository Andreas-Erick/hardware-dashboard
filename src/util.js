const { execFile } = require('child_process');

/** Run a program and resolve with stdout, or null on any failure. Never rejects. */
function run(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** Run a PowerShell snippet with UTF-8 output (device names on non-English Windows contain umlauts etc.). */
function ps(script, timeout = 20000) {
  const wrapped = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${script}`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped], timeout);
}

/** Run a .ps1 file shipped with the app. Sent as an encoded command so it works from any install location. */
function psFile(file, timeout = 30000) {
  const body = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'\n${require('fs').readFileSync(file, 'utf8')}`;
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], timeout);
}

function psJson(out) {
  if (!out || !out.trim()) return null;
  try { return JSON.parse(out); } catch { return null; }
}

/** Parse PowerShell ConvertTo-Json output, always returning an array. */
function psJsonArray(out) {
  if (!out || !out.trim()) return [];
  try {
    const v = JSON.parse(out);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

module.exports = { run, ps, psFile, psJson, psJsonArray, asArray };
