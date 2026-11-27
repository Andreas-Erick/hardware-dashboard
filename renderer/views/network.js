// ---------- Internet ----------
views.network = (() => {
  const HKEY = 'hd.speedHistory';
  const readHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
  const writeHistory = (h) => { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 12))); } catch { /* storage unavailable */ } };
  let running = false;

  // Speed test results are in bits per second.
  function verdict(down) {
    const m = down / 1e6;
    if (m < 10) return 'Enough for browsing and HD video on one device. Large downloads will be slow.';
    if (m < 50) return 'Good for HD streaming and video calls on a couple of devices.';
    if (m < 250) return 'Fast. 4K streaming on several devices at once is no problem.';
    return 'Very fast. Even 100 GB game downloads finish in well under an hour.';
  }

  async function enter() {
    renderHistory();
    const n = await attempt(() => hw.netInfo());
    if (!n) return;
    const main = n.interfaces.find((i) => i.name === n.main);
    const wifi = n.wifi[0];
    const st = n.status;
    $('#net-sub').textContent = !st.online
      ? "You're offline. Check that Wi-Fi is on or the cable is plugged in, then restart your router if it still doesn't work."
      : !st.dns
        ? "Connected, but websites can't be looked up (DNS isn't answering). Try restarting your router."
        : `Online${wifi ? ` through Wi-Fi network “${wifi.ssid}”` : main ? ` through ${main.name}` : ''}. ${Math.round(st.latency)} ms to the internet.`;
    const rows = [
      ['Status', st.online ? 'Online' : 'Offline'],
      ['Response time', st.latency != null ? `${Math.round(st.latency)} ms` : '–'],
      ...(wifi ? [['Wi-Fi network', wifi.ssid], ['Signal', `${wifi.quality}%${wifi.frequency ? `, ${(wifi.frequency / 1000).toFixed(1)} GHz` : ''}`], ['Security', wifi.security || '–']] : []),
      ['Your local address', main ? main.ip4 || '–' : '–'],
      ['Router', n.gateway || '–'],
      ['DNS servers', n.dnsMain.slice(0, 4).join(', ') || '–'],
    ];
    $('#net-conn').innerHTML = rows.map(([k, v]) => `<dt>${fmt.esc(k)}</dt><dd>${fmt.esc(v)}</dd>`).join('');
    const ifs = n.interfaces.filter((i) => i.up || !i.virtual);
    $('#net-ifaces').innerHTML = ifs.map((i) => `<div class="iface">
      <div class="row-between"><b title="${fmt.esc(i.name)}">${fmt.esc(i.name)}</b>
      <span class="pills">${i.isDefault ? '<span class="pill main">In use</span>' : ''}<span class="pill ${i.up ? 'on' : 'off'}">${i.up ? 'Connected' : 'Not connected'}</span></span></div>
      <small>${[i.medium, i.virtual ? 'Virtual' : '', i.speed ? `link speed ${i.speed >= 1000 ? (i.speed / 1000).toFixed(1) + ' Gbit/s' : i.speed + ' Mbit/s'}` : '', i.ip4].filter(Boolean).map(fmt.esc).join(', ')}</small></div>`).join('');
  }

  function renderHistory() {
    const h = readHistory();
    $('#speed-history').innerHTML = h.length
      ? h.map((r) => `<div class="sh-row"><span>${fmt.ago(r.at)}</span><span><b>${fmt.bps(r.download)}</b> down</span><span><b>${fmt.bps(r.upload)}</b> up</span></div>`).join('')
      : '<p class="fine">Your results appear here so you can compare times of day.</p>';
  }

  hw.onSpeedProgress((p) => {
    const label = { ping: 'Measuring response time', download: 'Download', upload: 'Upload' }[p.phase];
    $('#sg-label').textContent = label;
    $('#sg-bar').style.cssText = fill((p.progress || 0) * 100);
    if (p.phase === 'ping' && p.ping != null) { $('#sr-ping').textContent = `${Math.round(p.ping)} ms`; $('#sr-jitter').textContent = `${p.jitter.toFixed(1)} ms`; }
    if (p.bps != null) { $('#sg-value').textContent = fmt.bps(p.bps); $('#sg-value').classList.remove('idle'); }
  });

  $('#speed-start').addEventListener('click', async () => {
    if (running) return;
    running = true;
    const b = $('#speed-start');
    b.disabled = true; b.textContent = 'Testing…';
    ['#sr-down', '#sr-up', '#sr-ping', '#sr-jitter'].forEach((s) => { $(s).textContent = '–'; });
    $('#sg-value').textContent = '0';
    $('#sg-value').classList.add('idle');
    const x = await attempt(() => hw.speedTest());
    running = false;
    b.disabled = false; b.textContent = 'Test again';
    $('#sg-bar').style.cssText = fill(0);
    $('#sg-label').textContent = 'Download';
    if (!x) return;
    $('#sg-value').textContent = fmt.bps(x.download);
    $('#sg-value').classList.remove('idle');
    $('#sr-down').textContent = `${fmt.bps(x.download)} Mbit/s`;
    $('#sr-up').textContent = `${fmt.bps(x.upload)} Mbit/s`;
    $('#sr-ping').textContent = `${Math.round(x.ping)} ms`;
    $('#sr-jitter').textContent = `${x.jitter.toFixed(1)} ms`;
    $('#speed-note').textContent = verdict(x.download);
    writeHistory([x, ...readHistory()]);
    renderHistory();
  });

  return { enter };
})();
