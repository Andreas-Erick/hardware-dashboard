# ADR-0004: Plain JavaScript, no framework and no build step

Status: Accepted · Date: 2026-11-27

## Context

This is a single-window, Windows-only desktop tool with seven pages and
one maintainer. It must start from a fresh clone with `npm install` and a
double-click (`Start Hardware Dashboard.cmd`), on machines that don't
have developer tools.

## Options considered

- **React or Svelte with Vite, in TypeScript.** Typed props and
  components, but it adds a bundler, a dev server, source maps and a
  build step before Electron can load anything.
- **TypeScript only, compiled by `tsc`.** Types across the IPC boundary,
  but it still needs a build step and an output folder that must not
  drift from the source.
- **CommonJS in the main process and classic `<script>` files in the
  page, with JSDoc on the module seams.**

## Decision

The main process is CommonJS run directly by Electron. The page is HTML
and CSS plus classic scripts loaded in order by `renderer/index.html`:
`core.js` (helpers, navigation, modal, toasts), then one file per page in
`renderer/views/`, then `app.js`. Each view is `{ enter(), leave() }`, and
views never call each other: they talk through `bus` events. `shared/`
holds rules both sides need (file categories, temperature limits), written
so they work as a CommonJS module and as a browser global.

## Consequences

- No build: what is in the repo is what runs, and `npm test` runs the
  source directly with `node --test`.
- No compile-time types. Module seams are documented with JSDoc, and
  behaviour is pinned by tests that use in-memory filesystems and
  recorded Windows output.
- The page scripts share one global scope, so load order matters. View
  files only assign `views.<page>`, which keeps that coupling to one line
  each.
- A strict CSP (`script-src 'self'`) is easy to keep, because nothing
  is generated or inlined.
