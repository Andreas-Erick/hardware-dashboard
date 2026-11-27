// Connection probing shared by the Internet page, the Overview ping and the Internet health check.
const net = require('net');

/** Time a TCP handshake in ms, or null. Works the same on every Windows language, unlike parsing ping output. */
function tcpPing(host, { port = 443, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (ms) => { sock.destroy(); resolve(ms); };
    sock.setTimeout(timeout, () => done(null));
    sock.once('error', () => done(null));
    sock.once('connect', () => done(Number(process.hrtime.bigint() - start) / 1e6));
  });
}

/**
 * Summarise a series of round-trip times (null = failed attempt), in the order they were taken.
 * jitter is the mean difference between consecutive successful samples.
 */
function latencyStats(samples) {
  const ok = samples.filter((s) => s != null);
  if (!ok.length) return { count: samples.length, ok: 0, min: null, median: null, jitter: null, loss: samples.length ? 100 : 0 };
  const sorted = [...ok].sort((a, b) => a - b);
  let jitter = 0;
  for (let i = 1; i < ok.length; i++) jitter += Math.abs(ok[i] - ok[i - 1]);
  return {
    count: samples.length,
    ok: ok.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    jitter: ok.length > 1 ? jitter / (ok.length - 1) : 0,
    loss: ((samples.length - ok.length) / samples.length) * 100,
  };
}

module.exports = { tcpPing, latencyStats };
