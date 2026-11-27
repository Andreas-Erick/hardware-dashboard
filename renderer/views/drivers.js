// ---------- Drivers ----------
views.drivers = (() => {
  let all = [];
  let loaded = false;
  const CLS = {
    DISPLAY: 'Graphics', NET: 'Network', MEDIA: 'Sound', AUDIOENDPOINT: 'Audio endpoint', SYSTEM: 'System', USB: 'USB',
    HIDCLASS: 'Input device', KEYBOARD: 'Keyboard', MOUSE: 'Mouse', BLUETOOTH: 'Bluetooth', CAMERA: 'Camera', IMAGE: 'Camera',
    MONITOR: 'Monitor', DISKDRIVE: 'Disk', SCSIADAPTER: 'Storage controller', HDC: 'Storage controller', SOFTWARECOMPONENT: 'Software component',
    EXTENSION: 'Extension', BIOMETRIC: 'Fingerprint or face sign-in', PRINTQUEUE: 'Printer', PROCESSOR: 'Processor', FIRMWARE: 'Firmware',
    SECURITYDEVICES: 'Security chip', BATTERY: 'Battery', SENSOR: 'Sensor', VOLUME: 'Volume', VOLUMESNAPSHOT: 'Volume', COMPUTER: 'Computer',
    SOFTWAREDEVICE: 'Software device', USBDEVICE: 'USB device', NETSERVICE: 'Network service', PRINTER: 'Printer', SMARTCARDREADER: 'Card reader',
    UCM: 'USB-C', SDHOST: 'SD card reader', OTHER: 'Other', AUDIOPROCESSINGOBJECT: 'Audio effects', NET_ADAPTER: 'Network',
    SECURITYACCELERATOR: 'Security', WPD: 'Portable device', SMARTCARDFILTER: 'Smart card',
  };
  const clsName = (c) => CLS[(c || '').toUpperCase()] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : 'Other');

  async function load() {
    loaded = true;
    $('#dr-table').innerHTML = '<div class="skeleton">Reading drivers…</div>';
    let r;
    try { r = await hw.drivers(); } catch (e) {
      $('#dr-sub').textContent = e.message;
      $('#dr-table').innerHTML = '';
      loaded = false;
      return;
    }
    all = r.drivers;
    const vendor = all.filter((d) => !R.isMicrosoftDriver(d));
    const old = all.filter((d) => R.isOldDriver(d));
    $('#dr-sub').textContent = `${all.length} drivers installed, ${vendor.length} of them from hardware makers. ${old.length ? `${old.length} are more than three years old.` : 'None of the hardware makers’ drivers are more than three years old.'}`;

    let html = '';
    if (r.problems.length) {
      html += `<div class="dr-callout"><span class="st bad">${ICON.bad}</span><div><h3>${r.problems.length} device${r.problems.length > 1 ? 's need' : ' needs'} attention</h3>
        <ul>${r.problems.map((p) => `<li><b>${fmt.esc(p.name)}</b> <span>${fmt.esc(p.meaning)}</span></li>`).join('')}</ul>
        <p class="fine" style="margin-top:8px">Open Device Manager and right-click the device to update or reinstall its driver.</p></div></div>`;
    } else {
      html += `<div class="dr-callout"><span class="st good">${ICON.good}</span><div><h3>All devices are working</h3><span class="muted">Windows reports no driver errors.</span></div></div>`;
    }
    html += `<div class="key-drivers">${R.keyDrivers(all).map((d) => {
      const a = fmt.age(d.date);
      const link = R.driverLink(d);
      return `<div class="kd"><div class="k">${clsName(d.cls)}</div><div class="n" title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</div>
        <div class="v">${fmt.esc(d.version)}</div><div class="d ${R.isOldDriver(d) ? 'age-old' : ''}">${fmt.esc(a.text)}${a.rel ? `, ${a.rel}` : ''}</div>
        <button class="link" data-link="${link.key}">${link.label}</button></div>`;
    }).join('')}</div>`;
    $('#dr-highlights').innerHTML = html;

    const classes = [...new Set(all.map((d) => d.cls))].sort((a, b) => clsName(a).localeCompare(clsName(b)));
    $('#dr-class').innerHTML = '<option value="">All device types</option>' + classes.map((c) => `<option value="${fmt.esc(c)}">${fmt.esc(clsName(c))}</option>`).join('');
    renderTable();
  }

  function renderTable() {
    const q = $('#dr-search').value.trim().toLowerCase();
    const cls = $('#dr-class').value;
    const hideMs = $('#dr-hide-ms').checked;
    const rows = all
      .filter((d) => (!cls || d.cls === cls) && (!hideMs || !R.isMicrosoftDriver(d)))
      .filter((d) => !q || `${d.name} ${d.provider} ${d.maker} ${d.version}`.toLowerCase().includes(q))
      .sort((a, b) => clsName(a.cls).localeCompare(clsName(b.cls)) || a.name.localeCompare(b.name));
    $('#dr-table').innerHTML = `<div class="ft-row drv-row head-row"><span>Device</span><span>Type</span><span>Driver from</span><span>Version</span><span>Date</span></div>` +
      (rows.length ? rows.map((d) => {
        const a = fmt.age(d.date);
        return `<div class="ft-row drv-row"><div class="path"><b title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</b></div>
          <span style="color:var(--muted)">${fmt.esc(clsName(d.cls))}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt.esc(d.provider || d.maker)}</span>
          <span class="num">${fmt.esc(d.version)}</span>
          <span class="num ${R.isOldDriver(d) ? 'age-old' : 'age-ok'}" title="${fmt.esc(a.rel || '')}">${fmt.esc(a.text)}</span></div>`;
      }).join('') : '<div class="skeleton">No drivers match your search.</div>');
  }
  $('#dr-search').addEventListener('input', renderTable);
  $('#dr-class').addEventListener('change', renderTable);
  $('#dr-hide-ms').addEventListener('change', renderTable);
  return { enter() { if (!loaded) load(); } };
})();
