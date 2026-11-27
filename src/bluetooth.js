const path = require('path');
const { psFile, psJson, asArray } = require('./util');

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

let cache = { at: 0, data: null };
async function info(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 8000) return cache.data;
  const raw = psJson(await psFile(path.join(__dirname, 'bluetooth.ps1'), 30000));
  if (!raw) return { ok: false, adapters: [], devices: [], radio: null, service: null };
  const devices = asArray(raw.Devices).map((d) => ({
    name: d.Name,
    mac: d.Mac ? d.Mac.match(/../g).join(':') : null,
    lowEnergy: d.LowEnergy,
    status: d.Status,
    connected: Boolean(d.Connected),
    battery: typeof d.Battery === 'number' ? d.Battery : null,
    kind: kindOf(d.Category, d.Name),
  })).sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
  const data = {
    ok: true,
    radio: raw.Radio, // 'On' | 'Off' | 'Disabled' | null
    service: raw.Service,
    adapters: asArray(raw.Adapters).map((a) => ({
      name: a.Name, status: a.Status, problem: a.Problem, version: a.Version, date: a.Date, provider: a.Provider,
    })),
    devices,
  };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { info };
