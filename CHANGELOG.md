# Changelog

## 0.9.2 — 2026-11-24

- A server stops when idle only after that long of its own running: idle time is counted in ticks
  of its timer, not read off a clock. On macOS, Node's monotonic clock runs on while the machine
  sleeps, so a window left open over night with the lid closed found its server stopped right
  after waking.

## 0.9.1 — 2026-11-18

- The README on npm is the current one: npm and CI badges, the package name in the changelog.
  No code changes.

## 0.9.0 — 2026-11-18

First release, as [`@santosch/localapp`](https://www.npmjs.com/package/@santosch/localapp).

- `defineApp()`: a Node request handler becomes a local app with a CLI — `open` (the default),
  `serve`, `stop`, `status`, `install [--remove]`, `help`.
- One server per app, started in the background on first `open` and reused after; a lock keeps
  two launches from starting two. Found again by its record, and only if it answers as the app.
- An app window in Chrome, Edge, Chromium or Brave (`--app`), else a tab of the default browser;
  on WSL, the Windows browser.
- A per-launch key (cookie) with one-time launch codes, a Host check against DNS rebinding and an
  Origin check for changes — or `auth: false`.
- Stops when idle (`idle`, open WebSockets and `busy()` count as use) or keeps running.
- App menu entries: Linux `.desktop` (with its icon), macOS `.app` (`.icns`), Windows Start menu
  shortcuts from WSL or Windows that start hidden (no console window) with the app's own icon.
- `stop` asks the server to stop, so `close` runs on every platform; what a background server
  started stops with it (process group, or process tree on Windows).
- No runtime dependencies.
