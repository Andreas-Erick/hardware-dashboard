# Hardware Dashboard

A friendly Windows app for keeping an eye on your PC and finding out where your disk space went.

## Start it

Double-click the **Hardware Dashboard** icon on your Desktop (also in the Start Menu).
To recreate the shortcuts: `powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1`.
On a new machine, double-click **`Start Hardware Dashboard.cmd`** once: it installs everything and adds the shortcuts.
Requires Node.js 20 or newer. The logo lives in `renderer/logo.svg`; rebuild the icon with `npx electron scripts/make-icon.js`.

## What it shows

| Page | What you get |
| --- | --- |
| **Overview** | Live CPU load (overall and per core), RAM, GPU load, VRAM, GPU power and clock, temperatures, drive fill levels, current download/upload rate, ping, and a summary of the hardware inside the PC. |
| **Disk space** | Scan a drive or folder, then explore it as a map where tile size is disk space. Folders take the colour of what fills most of them (video, games, pictures…). Click to drill in, see the 300 largest files, or a breakdown by file type. Any item can be shown in Explorer or moved to the Recycle Bin. |
| **Clean up** | Measures the usual space hogs: Recycle Bin, temp files, GPU shader caches, browser caches, developer package caches, crash reports, Downloads, Windows Update leftovers, hibernation and page file. Caches can be cleared in one click. |
| **Drivers** | Devices Windows reports problems with, your key drivers (graphics, network, sound, Bluetooth) with age and where to update them, and a searchable list of every installed driver. |
| **Internet** | Online status, Wi-Fi network and signal, local address, router, DNS, adapters, and a speed test (download, upload, ping, jitter) with a history of earlier results. |
| **Bluetooth** | Adapter, radio on/off, driver, the Bluetooth service, and every paired device with connection state and battery level (live when connected, last known otherwise). |
| **Health check** | One check per part: processor and stability, memory, graphics, storage, battery, internet, Bluetooth and drivers. Each finding says what was found and what to do, with a button to the right Windows tool. Every page has a shortcut to its own check. |

### What the health checks look at

- **Processor and stability:** load over 4 s and the busiest apps, temperature, corrected hardware errors (WHEA), blue screens and unexpected shutdowns in the last 30 days.
- **Memory:** usage and top apps, page file, module match and speed, the last Windows Memory Diagnostic result (with a button to schedule one).
- **Graphics:** temperature, VRAM, active performance limits (heat or power), driver age, driver crashes in the last 30 days.
- **Storage:** Windows drive health, SSD wear and temperature (administrator), free space per drive, disk and file system errors, TRIM.
- **Battery:** capacity compared with new, charge cycles, charging state, a link to the full Windows battery report.
- **Internet:** connection, DNS, response time, jitter, lost connections, Wi-Fi signal and band.
- **Bluetooth:** adapter status, radio, service, devices with problems, low batteries.
- **Drivers:** devices with errors, important drivers older than three years, unsigned drivers.

## Safety

- Nothing is deleted unless you confirm it.
- Items from the disk map go to the **Recycle Bin**, so you can restore them. Windows, Program Files, ProgramData, your user folder itself and drive roots are refused.
- "Clean up" can only empty a fixed list of cache folders. Temp files newer than 24 hours and files in use are skipped.

## Good to know

- **CPU and SSD temperatures** are only shared by Windows with programs running as administrator. Use the "Restart as administrator" link on the Overview page. Some laptops don't expose a CPU sensor to Windows at all.
- **Live GPU stats** come from `nvidia-smi`, so they need an NVIDIA GPU. Other GPUs show their model and memory only.
- The **speed test** uses Cloudflare's public speed test servers (speed.cloudflare.com) and transfers roughly 100–400 MB.
- A drive scan can show **more** than the space used, because Windows stores some system files once and links them from several places, and cloud-only OneDrive files count at full size. It can also show **less**, because some system folders can't be opened without administrator rights. The map shows that gap as a striped "System and unreadable files" tile.

## Project layout

```
main.js              Electron main process, IPC, safety checks
preload.js           The small API the page is allowed to use (window.hw)
src/monitor.js       CPU, RAM, GPU, drives, temperatures, battery
src/drivers.js       Installed drivers and problem devices (via PowerShell/CIM)
src/network.js       Connection info and the speed test
src/cleanup.js       Cleanup locations, measuring and clearing
src/scanner*.js      Background disk scan (worker thread) and queries
renderer/            The interface (HTML, CSS, plain JavaScript)
scripts/smoke-test.js  `npm run check`: exercises the data layer without the UI
```
