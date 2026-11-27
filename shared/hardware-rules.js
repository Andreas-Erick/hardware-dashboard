/*
 * Rules about hardware that both the pages and the health checks apply, so they always agree:
 * temperature thresholds, which GPUs are real, and how drivers are judged.
 * Loaded by the page (global HD_RULES) and by the main process (require).
 */
(function (root) {
  const YEAR = 365.25 * 86400000;

  // °C. "warm" is worth a look, "hot" means the part is slowing itself down (or about to).
  const TEMP = {
    cpu: { warm: 85, hot: 95 },
    gpu: { warm: 80, hot: 87 },
    disk: { warm: 60, hot: 70 },
  };
  /** 'hot' | 'warm' | 'ok', or null when there is no reading. */
  function tempLevel(part, celsius) {
    if (celsius == null || !(celsius > 0)) return null;
    const t = TEMP[part];
    return celsius >= t.hot ? 'hot' : celsius >= t.warm ? 'warm' : 'ok';
  }

  // Virtual display adapters (remote desktop, screen sharing apps) aren't hardware.
  const VIRTUAL_GPU = /virtual|remote|basic display|superdisplay|indirect/i;
  const isVirtualGpu = (name) => VIRTUAL_GPU.test(name || '');
  const shortGpuName = (name) => String(name || '').replace(/^NVIDIA GeForce /, '');

  // ---- Drivers ----
  const OLD_DRIVER_YEARS = 3;
  const isMicrosoftDriver = (d) => /^microsoft$/i.test(d.provider || '') || (!d.provider && /^microsoft$/i.test(d.maker || ''));
  const driverAgeYears = (date, now = Date.now()) => (date ? (now - new Date(date).getTime()) / YEAR : null);
  /** A hardware maker's driver that is more than three years old. Microsoft's inbox drivers don't count. */
  const isOldDriver = (d, now = Date.now()) => !isMicrosoftDriver(d) && driverAgeYears(d.date, now) >= OLD_DRIVER_YEARS;

  // Virtual adapters (VPNs, streaming, screen sharing) rarely get updates and don't affect hardware health.
  const VIRTUAL_DEVICE = /virtual|steam streaming|tailscale|wintun|tap-|vpn|wireguard|superdisplay|hyper-v|vmware|virtualbox|parsec|loopback/i;
  const IMPORTANT_CLASS = /^(DISPLAY|NET|MEDIA|BLUETOOTH|SYSTEM|HDC|SCSIADAPTER)$/i;
  const isImportantDriver = (d) => IMPORTANT_CLASS.test(d.cls || '') && !VIRTUAL_DEVICE.test(d.name || '');

  /** Where to get a newer driver: a key of the app's link list plus a button label. */
  function driverLink(d) {
    const s = `${d.provider || ''} ${d.maker || ''} ${d.name || ''}`;
    if (/nvidia/i.test(s)) return { key: 'nvidia-drivers', label: 'Get the latest NVIDIA driver' };
    if (/\bamd\b|radeon|advanced micro/i.test(s)) return { key: 'amd-drivers', label: 'Get the latest AMD driver' };
    if (/intel|killer/i.test(s)) return { key: 'intel-drivers', label: 'Check with Intel Driver Assistant' };
    return { key: 'optional-updates', label: 'Look in optional Windows updates' };
  }

  /** The drivers most people care about: graphics, the main network adapters, sound and Bluetooth. */
  function keyDrivers(all) {
    const vendor = (d) => !isMicrosoftDriver(d);
    return [
      ...all.filter((d) => d.cls === 'DISPLAY' && !isVirtualGpu(d.name)),
      ...all.filter((d) => d.cls === 'NET' && vendor(d) && /wi-?fi|wireless|ethernet|killer|realtek|gbe|lan/i.test(d.name)),
      ...all.filter((d) => d.cls === 'MEDIA' && vendor(d) && !/virtual|nvidia|hdmi|displayport|steam streaming|voicemod|vb-audio/i.test(d.name)).slice(0, 1),
      ...all.filter((d) => d.cls === 'BLUETOOTH' && vendor(d)).slice(0, 1),
    ];
  }

  const api = {
    TEMP, tempLevel, isVirtualGpu, shortGpuName,
    OLD_DRIVER_YEARS, isMicrosoftDriver, driverAgeYears, isOldDriver, isImportantDriver, driverLink, keyDrivers,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HD_RULES = api;
})(this);
