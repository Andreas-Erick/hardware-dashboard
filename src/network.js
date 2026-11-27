const si = require('systeminformation');
const net = require('net');
const dns = require('dns').promises;
const { ps, psJsonArray } = require('./util');

/** Time a TCP handshake. Works the same on every Windows language, unlike parsing ping output. */
function tcpPing(host, port = 443, timeout = 3000) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (ms) => { sock.destroy(); resolve(ms); };
    sock.setTimeout(timeout, () => done(null));
    sock.once('error', () => done(null));
    sock.once('connect', () => done(Number(process.hrtime.bigint() - start) / 1e6));
  });
}

async function status() {
  // A few handshakes in a row: the first one often waits for the Wi-Fi radio to wake up.
  const seq = async (host) => { const r = []; for (let i = 0; i < 3; i++) r.push(await tcpPing(host)); return r; };
  const [a, b, resolved] = await Promise.all([
    seq('1.1.1.1'),
    seq('8.8.8.8'),
    dns.resolve4('cloudflare.com').then(() => true).catch(() => false),
  ]);
  const pings = [...a, ...b].filter((x) => x != null);
  return {
    online: pings.length > 0,
    dns: resolved,
    latency: pings.length ? Math.min(...pings) : null,
  };
}

async function info() {
  const [ifaces, gateway, wifi, dnsOut, st] = await Promise.all([
    si.networkInterfaces().catch(() => []),
    si.networkGatewayDefault().catch(() => ''),
    si.wifiConnections().catch(() => []),
    ps("Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json -Compress", 10000),
    status(),
  ]);
  const list = (Array.isArray(ifaces) ? ifaces : [ifaces])
    .filter((i) => !i.internal)
    .map((i) => ({
      name: i.ifaceName || i.iface,
      type: i.type,
      up: i.operstate === 'up',
      ip4: i.ip4,
      ip6: i.ip6,
      mac: i.mac,
      speed: i.speed,
      virtual: i.virtual,
      isDefault: i.default,
      dhcp: i.dhcp,
    }))
    .sort((x, y) => (y.isDefault - x.isDefault) || (y.up - x.up));
  const dnsServers = psJsonArray(dnsOut).map((d) => ({
    iface: d.InterfaceAlias,
    servers: Array.isArray(d.ServerAddresses) ? d.ServerAddresses : [d.ServerAddresses],
  }));
  return {
    interfaces: list,
    gateway,
    wifi: wifi.map((w) => ({ ssid: w.ssid, signal: w.quality, frequency: w.frequency, security: w.security, txRate: w.txRate })),
    dns: dnsServers,
    status: st,
  };
}

// ---- Speed test against Cloudflare's public speed test endpoints ----
const BASE = 'https://speed.cloudflare.com';

async function latencyTest(samples = 10) {
  const times = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/__down?bytes=0&r=${Math.random()}`, { cache: 'no-store' });
      await r.arrayBuffer();
      times.push(performance.now() - t0);
    } catch { /* skip failed sample */ }
  }
  if (times.length < 2) return { ping: null, jitter: null };
  const warm = times.slice(1); // the first request pays for the TLS handshake
  const sorted = [...warm].sort((a, b) => a - b);
  const ping = sorted[Math.floor(sorted.length / 2)];
  let jitter = 0;
  for (let i = 1; i < warm.length; i++) jitter += Math.abs(warm[i] - warm[i - 1]);
  return { ping, jitter: jitter / (warm.length - 1) };
}

/**
 * Run `streams` parallel workers until `seconds` pass and report bits per second.
 * The first 1.5 s are ignored so TCP slow-start doesn't drag the result down.
 */
async function throughput(kind, seconds, streams, onProgress) {
  const ctrl = new AbortController();
  const start = performance.now();
  const warmup = 1500;
  let total = 0;
  let afterWarm = 0;
  const add = (n) => {
    total += n;
    if (performance.now() - start > warmup) afterWarm += n;
  };
  const tick = setInterval(() => {
    const el = performance.now() - start;
    const bps = el > warmup ? (afterWarm * 8) / ((el - warmup) / 1000) : (total * 8) / (el / 1000);
    onProgress({ phase: kind, bps, progress: Math.min(1, el / (seconds * 1000)) });
  }, 250);
  const deadline = setTimeout(() => ctrl.abort(), seconds * 1000);
  const upload = Buffer.alloc(2 * 1024 * 1024, 0x61);

  const worker = async () => {
    while (!ctrl.signal.aborted) {
      try {
        if (kind === 'download') {
          const r = await fetch(`${BASE}/__down?bytes=50000000&r=${Math.random()}`, { signal: ctrl.signal, cache: 'no-store' });
          for await (const chunk of r.body) add(chunk.length);
        } else {
          await fetch(`${BASE}/__up`, { method: 'POST', body: upload, signal: ctrl.signal, headers: { 'content-type': 'application/octet-stream' } });
          add(upload.length);
        }
      } catch (e) {
        if (ctrl.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };
  await Promise.all(Array.from({ length: streams }, worker));
  clearTimeout(deadline);
  clearInterval(tick);
  const el = performance.now() - start;
  return el > warmup && afterWarm > 0 ? (afterWarm * 8) / ((el - warmup) / 1000) : (total * 8) / (el / 1000);
}

let running = false;
async function speedTest(onProgress) {
  if (running) throw new Error('A speed test is already running.');
  running = true;
  try {
    onProgress({ phase: 'ping', progress: 0 });
    const { ping, jitter } = await latencyTest();
    if (ping == null) throw new Error("Couldn't reach the speed test server. Check that you're online and try again.");
    onProgress({ phase: 'ping', progress: 1, ping, jitter });
    const download = await throughput('download', 10, 6, onProgress);
    const upload = await throughput('upload', 8, 4, onProgress);
    return { at: Date.now(), ping, jitter, download, upload, server: 'Cloudflare' };
  } finally {
    running = false;
  }
}

module.exports = { info, status, speedTest };
