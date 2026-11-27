const test = require('node:test');
const assert = require('node:assert/strict');
const { registerApi, CONTRACT_CHANNEL } = require('../src/ipc');

function fakeIpcMain() {
  const handlers = {}, listeners = {};
  return {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { listeners[ch] = fn; },
    invoke: (ch, ...args) => handlers[ch]({}, ...args),
    sendSync: (ch) => { const e = {}; listeners[ch](e); return e.returnValue; },
  };
}

test('every method answers in one envelope: a value, or an error message', async () => {
  const ipc = fakeIpcMain();
  registerApi(ipc, {
    getTarget: () => null,
    events: [],
    methods: {
      add: (a, b) => a + b,
      later: async () => 'done',
      nothing: () => undefined,
      refuse: () => { throw new Error('That folder doesn\'t exist.'); },
      refuseLater: async () => { throw new Error('Too slow'); },
    },
  });
  assert.deepEqual(await ipc.invoke('hw:add', 2, 3), { ok: true, value: 5 });
  assert.deepEqual(await ipc.invoke('hw:later'), { ok: true, value: 'done' });
  assert.deepEqual(await ipc.invoke('hw:nothing'), { ok: true, value: undefined });
  assert.deepEqual(await ipc.invoke('hw:refuse'), { ok: false, error: "That folder doesn't exist." });
  assert.deepEqual(await ipc.invoke('hw:refuseLater'), { ok: false, error: 'Too slow' });
});

test('the contract lists every method and event once, with the channel the preload script uses', () => {
  const ipc = fakeIpcMain();
  registerApi(ipc, { getTarget: () => null, events: ['scanDone'], methods: { live: () => 1 } });
  assert.deepEqual(ipc.sendSync(CONTRACT_CHANNEL), {
    methods: [{ name: 'live', channel: 'hw:live' }],
    events: [{ name: 'scanDone', channel: 'hw:event:scanDone', subscribe: 'onScanDone' }],
  });
});

test('events reach a live window, are dropped for a closed one, and must be declared', () => {
  const sent = [];
  let target = { isDestroyed: () => false, send: (ch, d) => sent.push([ch, d]) };
  const emit = registerApi(fakeIpcMain(), { getTarget: () => target, events: ['scanProgress'], methods: {} });
  emit('scanProgress', { files: 1 });
  target = { isDestroyed: () => true, send: () => assert.fail('sent to a closed window') };
  emit('scanProgress', { files: 2 });
  assert.deepEqual(sent, [['hw:event:scanProgress', { files: 1 }]]);
  assert.throws(() => emit('typo', {}), /Unknown event/);
});
