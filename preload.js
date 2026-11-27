const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('hw', {
  staticInfo: invoke('static-info'),
  live: invoke('live'),
  drives: invoke('drives'),
  drivers: invoke('drivers'),
  netInfo: invoke('net-info'),
  netStatus: invoke('net-status'),
  speedTest: invoke('speedtest'),
  onSpeedProgress: listen('speedtest-progress'),

  scanStart: invoke('scan-start'),
  scanCancel: invoke('scan-cancel'),
  scanChildren: invoke('scan-children'),
  scanLargest: invoke('scan-largest'),
  scanTypes: invoke('scan-types'),
  onScanProgress: listen('scan-progress'),
  onScanDone: listen('scan-done'),
  pickFolder: invoke('pick-folder'),

  reveal: invoke('reveal'),
  openFolder: invoke('open-folder'),
  trash: invoke('trash'),

  cleanupList: invoke('cleanup-list'),
  cleanupClear: invoke('cleanup-clear'),
  onCleanupItem: listen('cleanup-item'),

  bluetooth: invoke('bluetooth'),
  healthRun: invoke('health-run'),
  healthIds: invoke('health-ids'),
  batteryReport: invoke('battery-report'),

  openLink: invoke('open-link'),
  openTool: invoke('open-tool'),
  isAdmin: invoke('is-admin'),
  relaunchAdmin: invoke('relaunch-admin'),
});
