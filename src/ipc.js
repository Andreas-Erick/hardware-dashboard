// The one contract between the window and the main process.
//
// main.js declares every method and push event once, here. The preload script asks for the contract on
// CONTRACT_CHANNEL and builds window.hw from it, so no name or channel is ever written twice.
//
// Every method resolves with its value, or rejects with an Error whose message can be shown to the user as-is.
// Over the wire that is { ok: true, value } | { ok: false, error }, because Electron prefixes the rejections it forwards.
// Push events arrive as window.hw.on<Name>(callback), which returns an unsubscribe function.
const CONTRACT_CHANNEL = 'hw:contract';

/** Wrap a handler's result (or failure) in the envelope. */
async function envelope(fn, args) {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * Register `methods` ({ name: (...args) => value }) and `events` (names) on ipcMain.
 * Returns emit(name, data), which sends a push event to `getTarget()` (a webContents) while it is alive.
 */
function registerApi(ipcMain, { methods, events, getTarget }) {
  const contract = {
    methods: Object.keys(methods).map((name) => ({ name, channel: `hw:${name}` })),
    events: events.map((name) => ({ name, channel: `hw:event:${name}`, subscribe: `on${name[0].toUpperCase()}${name.slice(1)}` })),
  };
  ipcMain.on(CONTRACT_CHANNEL, (e) => { e.returnValue = contract; });
  for (const { name, channel } of contract.methods) {
    ipcMain.handle(channel, (_e, ...args) => envelope(methods[name], args));
  }
  return function emit(name, data) {
    const ev = contract.events.find((x) => x.name === name);
    if (!ev) throw new Error(`Unknown event "${name}"`);
    const t = getTarget();
    if (t && !t.isDestroyed()) t.send(ev.channel, data);
  };
}

module.exports = { registerApi, envelope, CONTRACT_CHANNEL };
