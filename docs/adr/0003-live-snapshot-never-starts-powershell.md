# ADR-0003: The live snapshot never starts PowerShell

Status: Accepted · Date: 2026-11-27

## Context

The Overview page reads a live snapshot every 1.5 s. The obvious source,
`systeminformation`, starts PowerShell on Windows for `mem()`,
`networkStats()`, `fsSize()`, `battery()` and `cpuTemperature()`. Each
PowerShell start costs about 0.7 s of CPU, so a dashboard meant to watch
CPU load became one of the busiest processes on the machine.

## Options considered

- **Keep `systeminformation` and poll less often.** Cheaper, but the
  meters stop feeling live, and it still spikes the CPU it is measuring.
- **A native addon (PDH or WMI bindings).** Fast, but it needs a compiler
  toolchain and a rebuild for every Electron version.
- **Pick the cheapest source per value and give slow values their own
  clock.**

## Decision

`src/monitor.js` splits sources by cost:

| Value | Source | Interval |
| --- | --- | --- |
| Memory | `os.totalmem/freemem` | every tick |
| Drive sizes | `fs.statfs` | 10 s |
| Network rate | `netstat -e` counters | every tick |
| Drive list | `si.fsSize()` | 60 s |
| CPU temperature | `si.cpuTemperature()` | 10 s, 60 s if none |
| Battery | `si.battery()` | 30 s, 10 min if none |

Slow caches are stamped *before* the call, so overlapping ticks never
start a second PowerShell. The renderer polls through `whileVisible`, so
a minimised window starts nothing at all.

## Consequences

- The tick costs a few ms instead of seconds of CPU.
- `netstat -e` output is localised. `parseNetstatBytes` finds the bytes
  row by its shape (the first row with two numbers) instead of its
  label, and `test/monitor.test.js` pins this with German and English
  recordings.
- Memory "used" is `total - free`, not Windows' "in use" figure, so it
  reads slightly higher than Task Manager.
- Every time source is injected (`now`, `memory`, `statfs`, `si`), so the
  cache intervals are tested on a fake clock rather than by sleeping.
