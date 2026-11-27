// Builds window.hw from the contract the main process publishes (see src/ipc.js).
// Sandboxed preload scripts can only require 'electron', so the contract is fetched instead of imported.
const { contextBridge, ipcRenderer } = require('electron');

const contract = ipcRenderer.sendSync('hw:contract');
const hw = {};

for (const { name, channel } of contract.methods) {
  hw[name] = async (...args) => {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
}
for (const { channel, subscribe } of contract.events) {
  hw[subscribe] = (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  };
}

contextBridge.exposeInMainWorld('hw', hw);
