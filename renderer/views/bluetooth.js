// ---------- Bluetooth ----------
views.bluetooth = (() => {
  let stop = null;
  const KIND = { audio: 'Headphones or speaker', keyboard: 'Keyboard', mouse: 'Mouse', controller: 'Game controller', phone: 'Phone', wearable: 'Watch or wearable', other: 'Bluetooth device' };

  function card(d) {
    return `<div class="bt-dev ${d.connected ? 'on' : ''}">
      <span class="dic">${ICON[d.kind] || ICON.other}</span>
      <b title="${fmt.esc(d.name)}">${fmt.esc(d.name)}</b>
      <small>${KIND[d.kind]}, ${d.lowEnergy ? 'Bluetooth LE' : 'Classic Bluetooth'}</small>
      <div class="bt-line"><span class="pill ${d.connected ? 'on' : 'off'}">${d.connected ? 'Connected' : 'Not connected'}</span>${battHtml(d.battery, !d.connected)}</div>
    </div>`;
  }

  function empty(sub, hint) {
    $('#bt-sub').textContent = sub;
    $('#bt-adapter').innerHTML = `<div class="bt-empty">${fmt.esc(hint)}</div>`;
    $('#bt-connected').innerHTML = ''; $('#bt-paired').innerHTML = '';
  }

  async function refresh() {
    let b;
    try { b = await hw.bluetooth(true); } catch (e) { return empty(e.message, 'Windows may still be starting its Bluetooth service.'); }
    if (!b.adapters.length) return empty('No Bluetooth adapter was found on this PC.', 'If your PC has Bluetooth, it may be switched off in the BIOS or missing a driver. Check Device Manager.');
    const a = b.adapters[0];
    const conn = b.devices.filter((d) => d.connected);
    const paired = b.devices.filter((d) => !d.connected);
    const on = !radioOff(b.radio);
    $('#bt-sub').textContent = b.radio === 'disabled'
      ? 'The Bluetooth radio is disabled. A hardware switch, flight mode or a policy may have turned it off.'
      : !on
        ? 'Bluetooth is turned off. Turn it on in Bluetooth settings to use your devices.'
        : `Bluetooth is on. ${conn.length ? `${conn.length} device${conn.length > 1 ? 's' : ''} connected` : 'Nothing connected right now'}, ${b.devices.length} paired in total.`;
    const age = fmt.age(a.date);
    $('#bt-adapter').innerHTML = `
      <span class="bt-logo ${on ? '' : 'off'}">${ICON.bluetooth}</span>
      <div><span class="k">Adapter</span><span class="v" title="${fmt.esc(a.name)}">${fmt.esc(a.name)}</span></div>
      <div><span class="k">Status</span><span class="v" style="color:${a.status !== 'OK' ? 'var(--hot)' : on ? 'var(--ok)' : 'var(--muted)'}">${a.status !== 'OK' ? 'Problem reported' : on ? 'On and working' : 'Turned off'}</span></div>
      <div><span class="k">Driver</span><span class="v">${fmt.esc(a.version || '–')}</span><span class="k">${fmt.esc(age.text)}${age.rel ? `, ${age.rel}` : ''}</span></div>
      <div><span class="k">Bluetooth service</span><span class="v">${b.service === 'Running' ? 'Running' : fmt.esc(b.service || 'Unknown')}</span></div>`;
    $('#bt-connected').innerHTML = conn.length ? conn.map(card).join('') : '<div class="bt-empty">No devices are connected right now.</div>';
    $('#bt-paired').innerHTML = paired.length ? paired.map(card).join('') : '<div class="bt-empty">Every paired device is connected.</div>';
  }

  return {
    enter() { refresh(); stop = whileVisible(10000, refresh); },
    leave() { stop(); stop = null; },
  };
})();
