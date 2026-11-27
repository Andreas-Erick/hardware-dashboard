# ADR-0002: The disk scan runs in a worker behind a message engine

Status: Accepted · Date: 2026-11-27

## Context

Scanning a full drive means calling `stat` on millions of files and
keeping a tree of them in memory, so it can be explored afterwards
(children, the 300 largest files, totals per file type). On the main
process this freezes IPC: the live meters stop and the window can't
answer. The scan also has to be testable without a real disk, because
junctions, access-denied folders and hard links are exactly the cases
that break scanners.

## Options considered

- **Walk on the main process with async `fs`.** Simple, but the tree
  building and sorting are CPU work that still blocks the event loop.
- **A child process with its own Node.** Fully isolated, but it costs a
  second runtime and query results have to be serialised through stdio.
- **A `worker_threads` worker that keeps the tree and answers queries.**
  Cheap to start, it shares the libuv thread pool, and messages are
  structured-cloned.

## Decision

`src/scan/engine.js` holds one scan and speaks a small message protocol
(`progress`, `done`, `{ id, type: children | largest | types | remove }`).
It runs inside `worker.js` in the app and inside `in-process.js` in tests.
`src/scan/index.js` (`createDiskScan`) is the only module the rest of the
app sees. It takes `spawn`, `trashItem`, `blockReason` and `getDrives` as
parameters, so tests drive the real engine against an in-memory
filesystem (`test/fs-contract.test.js`, `test/scan.test.js`).

`src/scan/tree.js` is pure: no fs and no messages. The Recycle Bin rules
live apart in `trash-guard.js`, so they can be reviewed and tested on their
own.

## Consequences

- The window stays responsive during a scan, and a cancelled scan just
  ends the worker.
- The tree lives in the worker. Every query is an async round trip, and
  the answers are capped (`LIMITS`) so large folders don't flood IPC.
- Only one scan exists at a time. Starting a new one ends the previous
  worker.
- `UV_THREADPOOL_SIZE` is raised to 16 in `main.js` before any fs work,
  because the walk runs up to 48 `stat` calls at once.
