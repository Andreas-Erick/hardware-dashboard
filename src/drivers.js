// Installed drivers and devices Windows reports problems with (via PowerShell/CIM).
const { shell: defaultShell, asArray } = require('./shell');

// Device Manager error codes most people will run into, in plain words.
const PROBLEMS = {
  1: 'Not configured correctly',
  3: 'Driver may be corrupted',
  10: 'Device cannot start',
  12: 'Not enough free resources',
  14: 'Restart needed',
  18: 'Driver needs reinstalling',
  19: 'Registry information is damaged',
  21: 'Windows is removing this device',
  22: 'Device is disabled',
  24: 'Device not present or not working',
  28: 'No driver installed',
  31: 'Driver could not be loaded',
  32: 'Driver service is disabled',
  37: 'Driver failed to initialise',
  39: 'Driver is corrupted or missing',
  43: 'Windows stopped this device after it reported problems',
  45: 'Device is not connected',
  48: 'Driver blocked for compatibility',
  52: 'Driver signature could not be verified',
};

const DRIVERS = "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | Select-Object DeviceName, DeviceClass, Manufacturer, DriverProviderName, DriverVersion, IsSigned, DeviceID, @{n='Date';e={ if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } }} | ConvertTo-Json -Compress";
const PROBLEM_DEVICES = 'Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | Select-Object Name, PNPClass, ConfigManagerErrorCode, DeviceID | ConvertTo-Json -Compress';

const parseDrivers = (raw) => asArray(raw).map((x) => ({
  name: x.DeviceName,
  cls: x.DeviceClass || 'OTHER',
  maker: x.Manufacturer || '',
  provider: x.DriverProviderName || '',
  version: x.DriverVersion || '',
  date: x.Date || null,
  signed: x.IsSigned !== false,
  id: x.DeviceID,
}));

const parseProblems = (raw) => asArray(raw)
  // Code 45 (unplugged) is normal for devices you used once, so it doesn't count as a problem.
  .filter((x) => x.ConfigManagerErrorCode !== 45)
  .map((x) => ({
    name: x.Name || x.DeviceID,
    cls: x.PNPClass || '',
    code: x.ConfigManagerErrorCode,
    meaning: PROBLEMS[x.ConfigManagerErrorCode] || `Device Manager error code ${x.ConfigManagerErrorCode}`,
  }));

function createDrivers({ shell = defaultShell } = {}) {
  // Reading every driver takes PowerShell a while; the Drivers page and the health check share one read.
  let inFlight = null;
  let cache = { at: 0, data: null };

  /** { drivers, problems }. Throws a readable error when Windows doesn't return the list. */
  async function read() {
    const [d, p] = await Promise.all([shell.psJson(DRIVERS, 90000), shell.psJson(PROBLEM_DEVICES, 60000)]);
    if (!d.ok) throw new Error(d.reason === 'timeout' ? 'Windows took too long to list the drivers. Try again in a moment.' : "Windows didn't return the driver list. Try again in a moment.");
    if (!p.ok) throw new Error("Windows didn't say which devices have problems. Try again in a moment.");
    return { drivers: parseDrivers(d.data), problems: parseProblems(p.data) };
  }

  function list({ maxAge = 30000 } = {}) {
    if (cache.data && Date.now() - cache.at < maxAge) return Promise.resolve(cache.data);
    if (!inFlight) {
      inFlight = read()
        .then((data) => { cache = { at: Date.now(), data }; return data; })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return { list };
}

module.exports = { createDrivers, parseDrivers, parseProblems, PROBLEMS, ...createDrivers() };
