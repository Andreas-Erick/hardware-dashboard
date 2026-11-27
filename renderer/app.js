// Starts the dashboard once core.js and every view in views/ have loaded (see the script order in index.html).

views.overview.start();

// A deliberately small handle for HD_CAPTURE screenshots (main.js) and the DevTools console.
window.hd = {
  show,
  scan: (folder) => bus.emit('scan', folder),
  scanRunning: () => state.scan.running,
  checkHealth: () => views.health.runAll(),
  healthRunning: () => views.health.busy(),
};
