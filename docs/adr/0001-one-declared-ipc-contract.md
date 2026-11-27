# ADR-0001: One declared IPC contract with an error envelope

Status: Accepted · Date: 2026-11-27

## Context

The window is sandboxed (`contextIsolation`, `sandbox: true`, no Node
integration), so everything it can do goes through IPC to the main
process. In a typical Electron app each feature adds a channel name in
three places: `ipcMain.handle` in main, `ipcRenderer.invoke` in preload,
and the call in the page. The names drift apart, and a typo only shows up
at runtime as a silent hang or an "unknown channel".

Errors have a second problem. When a handler throws, Electron forwards
the rejection with a prefix (`Error invoking remote method 'x': ...`), so
the message can't be shown to the user as-is.

## Options considered

- **Hand-written channels in main and preload.** This is the common
  pattern. Every method is written twice, and the preload has to be
  edited for each new feature.
- **A shared module listing the channels, required by both sides.** A
  sandboxed preload can only `require('electron')`, so it can't import
  a project module without a bundler.
- **Main publishes the contract and preload builds `window.hw` from it.**
  The methods are declared once in `main.js`.

## Decision

`src/ipc.js` takes `{ methods, events }` from `main.js`. It registers a
handler per method and answers a synchronous `hw:contract` request with
the list of names and channels. `preload.js` builds `window.hw.<name>()`
and `window.hw.on<Event>()` from that list.

Each handler result is wrapped as `{ ok: true, value }` or
`{ ok: false, error }`, and preload turns the second form back into a
plain `Error(message)`. Every handler throws messages written for the
user, so the page can show `e.message` directly.

## Consequences

- Adding a capability is one line in `main.js`. The preload never changes.
- The full list of what the window can do sits in one object, which makes
  the security boundary easy to review.
- Handler messages must be readable by a user. That is a convention, and
  `test/ipc.test.js` pins the envelope.
- The contract is fetched with `sendSync` once at startup. That blocks the
  preload for one round trip, which is acceptable for a list of ~30 names.
- There are no static types across the boundary, because the project has
  no TypeScript (see [ADR-0004](0004-plain-javascript-no-build-step.md)).
