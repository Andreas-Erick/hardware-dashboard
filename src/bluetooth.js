// Bluetooth adapter, radio and paired devices, read by bluetooth.ps1.
const path = require('path');
const { shell: defaultShell, asArray } = require('./shell');

// Windows reports a device "category"; when it doesn't, guess from the name.
function kindOf(category, name) {
  const c = `${category || ''} ${name || ''}`.toLowerCase();
  if (/headset|headphone|earbud|audio|speaker|buds|liberty|soundcore|airpods|wh-|wf-/.test(c)) return 'audio';
  if (/keyboard|k\d{3}/.test(c)) return 'keyboard';
  if (/mouse|mx master|trackpad/.test(c)) return 'mouse';
  if (/gaming|controller|gamepad|xbox|dualsense|joy-con/.test(c)) return 'controller';
  if (/phone|iphone|galaxy|pixel/.test(c)) return 'phone';
  if (/watch|band|fit/.test(c)) return 'wearable';
  return 'other';
}

const RADIO = { On: 'on', Off: 'off', Disabled: 'disabled' };

/**
 * Turn the script's output into
 * { radio: 'on' | 'off' | 'disabled' | 'unknown', service, adapters[], devices[] }.
 * `radio` is 'disabled' when the radio is switched off in hardware or by policy.
 */
function parseBluetooth(raw) {
  const devices = asArray(raw.Devices).map((d) => ({
    name: d.Name || 'Unnamed device',
    mac: d.Mac ? d.Mac.match(/../g).join(':') : null,
    lowEnergy: Boolean(d.LowEnergy),
    status: d.Status,
    connected: Boolean(d.Connected),
    battery: typeof d.Battery === 'number' ? d.Battery : null,
    kind: kindOf(d.Category, d.Name),
  })).sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
  return {
    radio: RADIO[raw.Radio] || 'unknown',
    service: raw.Service || null,
    adapters: asArray(raw.Adapters).map((a) => ({
      name: a.Name, status: a.Status, problem: a.Problem, version: a.Version, date: a.Date, provider: a.Provider,
    })),
    devices,
  };
}

function createBluetooth({ shell = defaultShell, script = path.join(__dirname, 'bluetooth.ps1') } = {}) {
  let cache = { at: 0, data: null };
  /** Throws a readable error when the information can't be read. An empty `adapters` list means no adapter. */
  async function info(force = false) {
    if (!force && cache.data && Date.now() - cache.at < 8000) return cache.data;
    const r = await shell.psFileJson(script, 30000);
    if (!r.ok || !r.data) throw new Error("Windows didn't return the Bluetooth information. Try again in a moment.");
    cache = { at: Date.now(), data: parseBluetooth(r.data) };
    return cache.data;
  }
  return { info };
}

module.exports = { createBluetooth, parseBluetooth, kindOf, ...createBluetooth() };
