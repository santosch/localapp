# Changelog

## 0.1.0 — 2026-11-03

First release.

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
- No runtime dependencies.
