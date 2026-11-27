// Health check: one check per part of the PC. Each check is a probe (gathers facts from Windows)
// followed by a rule (turns the facts into Findings). See probes.js and rules.js.
const rules = require('./rules');

/** The parts, in the order the Health page lists them. */
const CHECKS = [
  { id: 'cpu', name: 'Processor and stability', desc: 'Load, temperature, hardware errors, crashes and unexpected shutdowns' },
  { id: 'memory', name: 'Memory', desc: 'Usage, overflow memory, modules and the Windows memory test' },
  { id: 'gpu', name: 'Graphics', desc: 'Temperature, video memory, performance limits, driver age and crashes' },
  { id: 'storage', name: 'Storage', desc: 'Drive health, SSD wear, free space, disk errors and TRIM' },
  { id: 'battery', name: 'Battery', desc: 'Capacity left compared with new, charging and battery care' },
  { id: 'network', name: 'Internet', desc: 'Connection, name lookup, response time, stability and Wi-Fi signal' },
  { id: 'bluetooth', name: 'Bluetooth', desc: 'Adapter, radio, service, device problems and low batteries' },
  { id: 'drivers', name: 'Drivers', desc: 'Devices with problems, outdated drivers and unsigned drivers' },
];

/**
 * The check's overall status:
 *   'bad' / 'warn'  some finding needs attention
 *   'good'          at least one finding is healthy and none need attention
 *   'info'          the check only had information to report (e.g. no Bluetooth adapter), nothing to judge
 *   'error'         the check could not finish
 */
function rollUp(items) {
  for (const s of ['bad', 'warn', 'good']) if (items.some((i) => i.status === s)) return s;
  return 'info';
}

/** `probes` maps each check id to an async function that returns that rule's facts. */
function createHealth({ probes, now = Date.now } = {}) {
  const source = probes || require('./probes').createProbes();

  /** { id, status, items: Finding[], at, ms }. Never rejects for a known id. */
  async function runCheck(id) {
    if (!CHECKS.some((c) => c.id === id)) throw new Error('There is no health check with that name.');
    const t = now();
    let items, status;
    try {
      items = rules[id](await source[id](), now());
      status = rollUp(items);
    } catch (e) {
      items = [{ status: 'info', label: 'Check could not finish', detail: `Something went wrong while checking: ${e.message}` }];
      status = 'error';
    }
    return { id, status, items, at: now(), ms: now() - t };
  }

  return { runCheck, checks: CHECKS };
}

module.exports = { createHealth, rollUp, CHECKS };
