# Glossary

The words the code and the interface share. When the UI and the code name the same thing differently, both are listed.

| Term | Meaning | In the code |
| --- | --- | --- |
| **Live snapshot** | One reading of CPU, memory, GPU, drives, temperatures, network rate and battery, taken every 1.5 s for the Overview. | `monitor.getLive()` |
| **Inside this PC** | The static hardware inventory. | `monitor.getStatic()` |
| **Drive** | A mounted volume such as `C:`. | `monitor.drives()` → `{ mount, size, used, free }` |
| **Physical disk** | The SSD or hard disk itself, with Windows' health verdict, wear and temperature. | `monitor.physicalDisks()` |
| **Disk scan** | Walking a drive or folder and keeping the tree in memory so it can be explored. The page is called "Disk space". | `src/scan` (`createDiskScan`) |
| **Scan tree** | The scanned folders and files, with sizes, the largest files and totals per file type. | `src/scan/tree.js` |
| **Category** | The kind of file (Video, Pictures, Games and app data…) that colours the disk map, decided by extension. | `shared/categories.js` |
| **Mostly** | The category that fills at least 40% of a folder. Folders without one are "Mixed folders". | `item.mostly` |
| **Trash guard** | The rules that decide what may be moved to the Recycle Bin from the disk map. | `src/scan/trash-guard.js` |
| **Cleanup item** | One place Clean up measures. Kinds: `clear` (safe to clear), `review` (your files), `system` (managed by Windows), `info`. | `src/cleanup.js` |
| **Health check** | One check per part of the PC ("part" in the UI). A check is a **probe** (facts from Windows) plus a **rule** (facts → findings). | `src/health` |
| **Finding** | One line of a health check: `{ status: good / warn / bad / info, label, detail, fix?, action? }`. | `src/health/rules.js` |
| **Check status** | A check's overall result: `good`, `warn`, `bad`, `info` (nothing to judge, e.g. no Bluetooth adapter) or `error` (the check couldn't finish). | `rollUp()` |
| **Action** | A button on a finding: open a Windows tool or link, go to a page, restart as administrator, or open the battery report. | `action.type` |
| **Wi-Fi quality** | Signal strength, 0–100%. Shown as "Signal". | `quality` |
| **Rate / bps** | Live network traffic is in bytes per second; speed test results are in bits per second. | `fmt.rate`, `fmt.bps` |
| **Internet** | The page and health check about connectivity. | `network` |
| **Demo mode** | The app running on a made-up PC (`HD_DEMO=1`, `npm run demo`), for screenshots and trying it out. Only the data sources are replaced. | `src/demo.js` |
