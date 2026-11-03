# localapp

**Run a Node web app as a local app** — a server that starts in the background the first time
you open it, an app window in the browser you already have, and an entry in the Start menu.
No Electron, no bundled Chromium, no runtime dependencies.

```js
import { defineApp } from "localapp";

const app = defineApp({
  name: "hello",
  handler: (req, res) => res.end("Hello from a local app!"),
});

await app.main();
```

```sh
$ hello            # starts the server in the background, opens an app window
$ hello            # again: reuses the running server, opens another window
$ hello stop       # stops it — from any shell
$ hello install    # adds "hello" to the Start menu / app menu
```

## Why

Many tools ship a local web UI — dashboards, review tools, dev tools, personal hubs. Most of
them say "open http://localhost:3000" and leave the rest to you: a terminal that has to stay
open, a tab among fifty others, a port that's taken, a second server when you start it twice,
and anything else on your machine (or any web page in your browser) that can talk to it.

Electron solves the window, but ships a whole browser per app. localapp does the small part in
between, with what's already there:

- **One server, started once.** The first `open` starts it in the background; later ones find
  it again (by a record of its process and port — and only if it answers as your app) and reuse
  it. Two launches at once start one server, not two.
- **A window of its own.** Chrome, Edge, Chromium or Brave in app mode (`--app`): no tabs, no
  address bar, its own taskbar entry. Without one, a tab of the default browser. On WSL, the
  Windows browser.
- **In the menu.** `install` adds the app to the Windows Start menu (also from WSL), the Linux
  app menu or `~/Applications` on macOS — with its icon, and on Windows without a console window.
- **Stops when idle — or keeps going.** By default the server stops after 30 minutes nobody used
  it; an open window keeps it running. A daemon can say `idle: false`.
- **Only for you.** The server listens on 127.0.0.1 only and, by default, asks for a key that only
  the windows it opens get (see [Security](#security)).

## Install

```sh
npm install localapp
```

Node 22 or newer. For app windows: a Chromium browser (Chrome, Edge, Chromium, Brave) — without
one the app opens in a tab of your default browser.

## Getting started

Write your app as a Node request handler — plain `http`, or anything that gives you one
(Express's `app`, Hono's `getRequestListener(app.fetch)`, …) — and hand the command line to
localapp:

```js
#!/usr/bin/env node
// bin/hello.js
import { defineApp } from "localapp";
import express from "express";

const web = express();
web.get("/", (req, res) => res.send(`<script src="/__localapp/keepalive.js"></script><h1>Hello!</h1>`));

const app = defineApp({
  name: "hello",
  title: "Hello",
  description: "Says hello",
  icon: { png: new URL("../icon.png", import.meta.url), svg: new URL("../icon.svg", import.meta.url) },
  handler: web,
});

await app.main();
```

```json
{ "bin": { "hello": "./bin/hello.js" } }
```

That's it: `hello` now opens, `hello stop` stops, `hello install` adds a menu entry.

> The background server is started by running your CLI again with `serve --background`, so the
> script must hand its arguments to localapp (`app.main()` or `app.run(argv)`). If it's started
> some other way, pass `command`.

A complete example — a page with a button and a small API — is in
[`example/hello`](example/hello/hello.js):

```sh
npm install && npm run build
node example/hello/hello.js          # opens it
node example/hello/hello.js install  # adds "Hello localapp" to your menu
```

## The command line your app gets

| Command | |
|---|---|
| `open` (the default) | Opens the app in a window, starting its server if none runs. `--print`: print a one-time link instead of opening a window (for SSH, scripts). `--wait`: keep running while the server does. |
| `serve [--port N]` | Runs the server in the foreground (Ctrl+C stops it) and prints a one-time link. |
| `stop` | Stops the running server. |
| `status` | Whether it runs, and where (exit code 1 if not). |
| `install [--remove]` | Adds the app to the system's app menu — or removes it again. |
| `help` | The usage text. |

Want commands of your own? Handle them yourself and call `app.run(argv)` for the rest — or use
the [API](#api) directly.

## Configuration

```ts
defineApp({
  name: "hello",                // required: lowercase letters, digits, ".", "_", "-"
  handler: (req, res) => {},    // required: a Node request listener
  title: "Hello",               // what menus and messages call it (default: name)
  description: "Says hello",    // a line for the menu entry
  port: 4520,                   // the port it prefers (default: one derived from the name)
  idle: "30m",                  // stop after this long unused — ms, "90s", "30m", "2h" — or false
  busy: () => jobs.running > 0, // still at work: not idle, whatever the requests say
  auth: true,                   // ask for the per-launch key (default true)
  upgrade: (req, socket, head) => {}, // WebSocket upgrades (see below)
  icon: { png: "icon.png", svg: "icon.svg" }, // for the menu entries
  categories: "Development;",   // Linux menu categories (default "Utility;")
  close: async () => {},        // called when the server stops
  command: ["node", "bin.js"],  // how to run your CLI (default: how this process was started)
  dir: "/some/where",           // its record, log and lock (default: see below)
});
```

**Ports.** Each app gets a stable default port derived from its name, so links and bookmarks
keep working. When that port is taken, a background start takes any free one instead (the
launcher finds it through the record); `serve --port N` insists on N.

**Icons.** Give a PNG — 256×256 is best — and, if you have one, an SVG. Linux menus use the SVG
(else the PNG), macOS gets an `.icns` and Windows an `.ico`, both made from the PNG (no image
library: both formats can hold a PNG as it is). Without an icon, a Windows shortcut shows Windows
Script Host's icon (it's what the shortcut runs to stay hidden).

**WebSockets.** Pass `upgrade` and handle the upgrade there — with [`ws`](https://github.com/websockets/ws):

```js
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ noServer: true });
defineApp({
  // …
  upgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
});
```

Upgrades pass the same checks as requests, and an open connection keeps the app from being idle.

## Staying alive, and stopping

A server started by `open` stops after `idle` without being used. Requests count, open
WebSocket connections count, and `busy()` can hold it. An open window counts if it asks now and
then — the easiest way is the script localapp serves:

```html
<script src="/__localapp/keepalive.js"></script>
```

It pings the server once a minute while the window is open (browsers slow down timers in
background tabs, but one a minute still gets through). Time the machine was asleep doesn't count
as idle.

When the server stops — idle, `stop`, Ctrl+C, SIGTERM — localapp closes it (also the browser's
open keep-alive connections, which would otherwise keep it waiting), calls `close`, removes the
record, and — when it was started in the background — stops its whole process group, so tools it
started (git, workers) stop with it.

A daemon that should keep running sets `idle: false`. (`serve` in the foreground never stops by
itself.)

## Security

Your app runs on your machine, but other things do too — and every web page in your browser can
send requests to `localhost`. localapp's defaults:

- The server listens on **127.0.0.1** only: nothing on the network can reach it.
- **Host check:** only requests addressed to `localhost`, `127.0.0.1` or `[::1]` are answered — a
  page whose own name resolves to 127.0.0.1 (DNS rebinding) is turned away.
- **A key per launch** (`auth: true`): every start makes a random key, kept in the server's
  record (readable by you only). A window gets in through a **one-time launch code** (valid once,
  for a minute) that the server swaps for the key as an `HttpOnly`, `SameSite=Strict` cookie — so
  the key itself is never on a command line. Requests without it get a 401.
- **Origin check:** requests that change things (anything but GET, HEAD and OPTIONS) and
  WebSocket upgrades are refused when they come from another page's origin.

What it doesn't protect against: programs running as your user — they can read the record (and
anything else of yours). Your app's own CLI commands can talk to its server with
[`app.fetch()`](#api), which adds the key.

With `auth: false` the Host and Origin checks stay; anything on your machine (a script, another
app) can then use the server without a key — which a daemon that other tools talk to may want.

## API

`defineApp(config)` returns:

| | |
|---|---|
| `main()` | Runs the CLI with `process.argv` and exits with its code. |
| `run(argv?)` | Runs the CLI; resolves to its exit code. |
| `open(path?)` | Opens a window (starting the server if needed): `{ record, window, link? }`. |
| `serve({ port?, background? })` | Runs the server in this process until it stops. |
| `stop()` | Stops the running server; whether one ran. |
| `status()` | `{ pid, port, url }` of the running server, or `null`. |
| `install({ remove? })` | Adds the app to the menu (or removes it); what it wrote. |
| `fetch(path, init?)` | A request to the running server with its key (starts it if needed) — for your CLI. |

## Platforms

| Platform | Server, `open`, `stop` | App window | Menu entry | Tested |
|---|---|---|---|---|
| Linux | ✅ | Chrome, Chromium, Edge, Brave on `PATH`; else `xdg-open` | `~/.local/share/applications` + icon | ✅ CI, and by hand |
| WSL 2 | ✅ | Windows' Chrome, Edge, Brave; else Explorer | Windows Start menu, hidden, with icon | ✅ by hand (Windows 11) |
| Windows | ✅ | Chrome, Edge, Brave; else Explorer | Start menu, hidden, with icon | ⚠️ CI only, not by hand yet |
| macOS | ✅ | `open -na` Chrome, Edge, Chromium, Brave; else `open` | `~/Applications/<Title>.app` with `.icns` | ⚠️ CI only, not by hand yet |

**Does it work on your machine — or not?** Please [open an issue](https://github.com/santosch/localapp/issues)
and say what you ran it on, what you expected and what happened. Reports from macOS and native
Windows are especially welcome, and **pull requests that improve platform support are very
welcome** — other browsers, Flatpak/Snap browsers, other desktop environments, …

Notes:

- **WSL:** WSL stops a distribution's processes once nothing Windows started is running in it.
  So the Start menu shortcut runs `open --wait`: it waits, invisibly (through a small `.vbs`
  that `wscript.exe` runs with no window), while the server runs, and ends with it. WSL 2
  forwards `localhost` to Windows, so the Windows browser reaches the server in Linux.
- **Menu entries** run your CLI the way the shell you ran `install` in does — the same Node, the
  same `PATH` (a menu starts programs with a bare one, which would miss `~/.local/bin` or a
  Node version manager). Run `install` again after moving the app or changing Node.
- **`LOCALAPP_BROWSER`** names a browser to try first (a path or a command; it gets
  `--app=<url>`).

## Where things are

Each app keeps its server record (`server.json`, mode 0600), the background server's log
(`server.log`) and a start lock in

- Linux: `$XDG_STATE_HOME/<name>` (`~/.local/state/<name>`)
- macOS: `~/Library/Application Support/<name>`
- Windows: `%LOCALAPPDATA%\<name>`

— or in `dir`. Menu entries: see [Platforms](#platforms); on Windows the hidden launcher script
and the icon live in `%LOCALAPPDATA%\<name>` too.

## Development

```sh
npm install
npm run check   # types, lint (oxlint, type-aware), format (oxfmt), tests
npm run build   # → dist/
```

The tests include real launches: a test app started in the background, launched three times at
once, stopped when idle, pushed to another port — with a stand-in browser, so no windows open.

## License

[MIT](LICENSE)
