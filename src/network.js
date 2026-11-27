// Connection status, connection details and the speed test.
const dns = require('dns').promises;
const { shell: defaultShell, asArray } = require('./shell');
const { tcpPing, latencyStats } = require('./net-probe');

/** What kind of link an interface is, in the words the Internet page shows. */
function describeInterface(i) {
  const name = i.ifaceName || i.iface || '';
  return {
    medium: i.type === 'wireless' ? 'Wi-Fi' : /ethernet|gbe|\blan\b/i.test(name) ? 'Cable' : '',
    virtual: Boolean(i.virtual) || /tailscale|vpn|tunnel|virtual|hyper-v/i.test(name),
  };
}

/** DNS servers of the interface in use, falling back to every server Windows lists. */
function mainDnsServers(dnsList, mainName) {
  const own = dnsList.filter((d) => !mainName || d.iface === mainName || dnsList.length === 1).flatMap((d) => d.servers);
  return [...new Set(own.length ? own : dnsList.flatMap((d) => d.servers))];
}

function createNetwork({ shell = defaultShell, si = require('systeminformation'), ping = tcpPing } = {}) {
  async function status() {
    // A few handshakes in a row: the first one often waits for the Wi-Fi radio to wake up.
    const seq = async (host) => { const r = []; for (let i = 0; i < 3; i++) r.push(await ping(host)); return r; };
    const [a, b, resolved] = await Promise.all([
      seq('1.1.1.1'),
      seq('8.8.8.8'),
      dns.resolve4('cloudflare.com').then(() => true).catch(() => false),
    ]);
    const s = latencyStats([...a, ...b]);
    return { online: s.ok > 0, dns: resolved, latency: s.min };
  }

  async function info() {
    const [ifaces, gateway, wifi, dnsOut, st] = await Promise.all([
      si.networkInterfaces().catch(() => []),
      si.networkGatewayDefault().catch(() => ''),
      si.wifiConnections().catch(() => []),
      shell.psJson('Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json -Compress', 10000),
      status(),
    ]);
    const list = asArray(ifaces)
      .filter((i) => !i.internal)
      .map((i) => ({
        name: i.ifaceName || i.iface,
        type: i.type,
        ...describeInterface(i),
        up: i.operstate === 'up',
        ip4: i.ip4,
        ip6: i.ip6,
        mac: i.mac,
        speed: i.speed,
        isDefault: i.default,
        dhcp: i.dhcp,
      }))
      .sort((x, y) => (y.isDefault - x.isDefault) || (y.up - x.up));
    const dnsServers = (dnsOut.ok ? asArray(dnsOut.data) : []).map((d) => ({ iface: d.InterfaceAlias, servers: asArray(d.ServerAddresses) }));
    const main = list.find((i) => i.isDefault) || list.find((i) => i.up) || null;
    return {
      interfaces: list,
      main: main ? main.name : null,
      gateway,
      // Wi-Fi signal strength is called `quality` (0-100) everywhere in the app.
      wifi: wifi.map((w) => ({ ssid: w.ssid, quality: w.quality, frequency: w.frequency, security: w.security, txRate: w.txRate })),
      dns: dnsServers,
      dnsMain: mainDnsServers(dnsServers, main && main.name),
      status: st,
    };
  }

  return { status, info, speedTest: createSpeedTest() };
}

// ---- Speed test against Cloudflare's public speed test endpoints. Results are in bits per second. ----
const BASE = 'https://speed.cloudflare.com';

function createSpeedTest({ fetchFn = (...a) => fetch(...a) } = {}) {
  async function latencyTest(samples = 10) {
    const times = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      try {
        const r = await fetchFn(`${BASE}/__down?bytes=0&r=${Math.random()}`, { cache: 'no-store' });
        await r.arrayBuffer();
        times.push(performance.now() - t0);
      } catch { times.push(null); }
    }
    // The first request pays for the TLS handshake.
    const s = latencyStats(times.slice(1));
    return s.ok < 2 ? { ping: null, jitter: null } : { ping: s.median, jitter: s.jitter };
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
    const rate = () => {
      const el = performance.now() - start;
      return el > warmup && afterWarm > 0 ? (afterWarm * 8) / ((el - warmup) / 1000) : (total * 8) / (el / 1000);
    };
    const tick = setInterval(() => onProgress({ phase: kind, bps: rate(), progress: Math.min(1, (performance.now() - start) / (seconds * 1000)) }), 250);
    const deadline = setTimeout(() => ctrl.abort(), seconds * 1000);
    const upload = Buffer.alloc(2 * 1024 * 1024, 0x61);

    const worker = async () => {
      while (!ctrl.signal.aborted) {
        try {
          if (kind === 'download') {
            const r = await fetchFn(`${BASE}/__down?bytes=50000000&r=${Math.random()}`, { signal: ctrl.signal, cache: 'no-store' });
            for await (const chunk of r.body) add(chunk.length);
          } else {
            await fetchFn(`${BASE}/__up`, { method: 'POST', body: upload, signal: ctrl.signal, headers: { 'content-type': 'application/octet-stream' } });
            add(upload.length);
          }
        } catch {
          if (ctrl.signal.aborted) break;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: streams }, worker));
    } finally {
      clearTimeout(deadline);
      clearInterval(tick);
    }
    return rate();
  }

  let running = false;
  /** Progress events: { phase: 'ping' | 'download' | 'upload', progress: 0..1, bps?, ping?, jitter? }. */
  return async function speedTest(onProgress) {
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
  };
}

module.exports = { createNetwork, describeInterface, mainDnsServers, ...createNetwork() };
