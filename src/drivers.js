const { ps, psJsonArray } = require('./util');

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

async function list() {
  const driversOut = ps(
    "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | Select-Object DeviceName, DeviceClass, Manufacturer, DriverProviderName, DriverVersion, IsSigned, DeviceID, @{n='Date';e={ if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } }} | ConvertTo-Json -Compress",
    90000,
  );
  const problemsOut = ps(
    "Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | Select-Object Name, PNPClass, ConfigManagerErrorCode, DeviceID | ConvertTo-Json -Compress",
    60000,
  );
  const [d, p] = await Promise.all([driversOut, problemsOut]);
  const drivers = psJsonArray(d).map((x) => ({
    name: x.DeviceName,
    cls: x.DeviceClass || 'OTHER',
    maker: x.Manufacturer || '',
    provider: x.DriverProviderName || '',
    version: x.DriverVersion || '',
    date: x.Date || null,
    signed: x.IsSigned !== false,
    id: x.DeviceID,
  }));
  const problems = psJsonArray(p)
    // Code 45 (unplugged) is normal for devices you used once, so it doesn't count as a problem.
    .filter((x) => x.ConfigManagerErrorCode !== 45)
    .map((x) => ({
      name: x.Name || x.DeviceID,
      cls: x.PNPClass || '',
      code: x.ConfigManagerErrorCode,
      meaning: PROBLEMS[x.ConfigManagerErrorCode] || `Device Manager error code ${x.ConfigManagerErrorCode}`,
    }));
  return { drivers, problems, ok: d != null };
}

module.exports = { list };
