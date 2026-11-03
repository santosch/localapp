import type { RequestListener } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stateDir, thisHost, type Host } from "./host.ts";
import { install, type Installed } from "./install.ts";
import { ask } from "./client.ts";
import {
  ensureRunning,
  launchLink,
  openApp,
  running,
  stopApp,
  waitWhileRunning,
  type LauncherOptions,
  type Opened,
} from "./launcher.ts";
import type { ServerRecord } from "./record.ts";
import { serve, type UpgradeListener } from "./server.ts";

export type { Host } from "./host.ts";
export type { Installed } from "./install.ts";
export type { Opened } from "./launcher.ts";
export type { ServerRecord } from "./record.ts";
export type { UpgradeListener } from "./server.ts";
export type { Command } from "./window.ts";

/** What a local app is: its name, its request handler, and how it should live. */
export interface AppConfig {
  /** File-safe id: lowercase letters, digits, `-`, `_`, `.` — its files, its menu entry. */
  name: string;
  /** What menus and messages call it (default: `name`). */
  title?: string;
  /** A line about it, for the menu entry. */
  description?: string;
  /** The app: a Node request listener — plain `http`, Express, Hono's `getRequestListener`, … */
  handler: RequestListener;
  /** WebSocket upgrades (e.g. `ws`'s `handleUpgrade` with `noServer: true`); an open one keeps the app from being idle. */
  upgrade?: UpgradeListener;
  /**
   * The port it prefers (default: one derived from `name`, so each app has its own). Started in the
   * background, it takes any free port when this one is taken.
   */
  port?: number;
  /** Stop after this long without being used: ms, or "90s", "30m", "2h". `false`: keep running. Default "30m". */
  idle?: number | string | false;
  /** Still at work (a job running): not idle, whatever the requests say. */
  busy?: () => boolean;
  /** Ask for a per-launch key that only the app's own windows (and its CLI) have. Default true. */
  auth?: boolean;
  /** Its icon for the app menu: a PNG (256×256 is best) — and an SVG, which Linux menus prefer. */
  icon?: { png?: string | URL; svg?: string | URL };
  /** Linux menu categories (freedesktop's), e.g. "Development;". Default "Utility;". */
  categories?: string;
  /** Called when the server stops, before the process ends (close a database, flush a log). */
  close?: () => void | Promise<void>;
  /** How to run this app's CLI: [program, …args]. Default: this process's (node, its flags, the script). */
  command?: string[];
  /** Where its record, log and lock live (default: the platform's state folder for `name`). */
  dir?: string;
}

/** A running app, as its launcher and CLI see it. */
export interface Status {
  pid: number;
  port: number;
  url: string;
}

export interface LocalApp {
  readonly name: string;
  /** Runs the CLI: `open` (the default), `serve`, `stop`, `status`, `install [--remove]`, `help`. Its exit code. */
  run(argv?: string[]): Promise<number>;
  /** `run` with this process's arguments, then exits with its code. For a `bin` script. */
  main(): Promise<never>;
  /** Opens the app in a window — its server started first if none runs. */
  open(path?: string): Promise<Opened>;
  /** Runs the server in this process until it stops. */
  serve(options?: { port?: number; background?: boolean }): Promise<void>;
  /** Stops the running server: whether one ran. */
  stop(): Promise<boolean>;
  /** The running server, or null. */
  status(): Promise<Status | null>;
  /** Adds the app to the system's app menu (or removes it). */
  install(options?: { remove?: boolean }): Promise<Installed>;
  /** A request to the running server, with its key — for the app's own CLI commands. Starts it if needed. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** Durations as "90s", "30m", "2h" (or ms). */
export function parseDuration(value: number | string): number {
  if (typeof value === "number") return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s*$/.exec(value);
  if (!match) throw new Error(`not a duration: "${value}" (use e.g. "90s", "30m", "2h")`);
  return Number(match[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"];
}

/** A port of the app's own, from its name — stable, and unlikely to meet another app's. */
export function defaultPort(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 2 ** 32;
  return 41_000 + (hash % 8_000);
}

const pathOf = (file: string | URL | undefined) => (file instanceof URL ? fileURLToPath(file) : file);

const USAGE = (name: string) => `Usage: ${name} [command]

  open [--print] [--wait]   open ${name} in a window, starting it if it isn't running (the default)
                            --print: print a one-time link instead of opening a window
                            --wait:  keep running while the server does
  serve [--port N]          run the server here, in the foreground
  stop                      stop the running server
  status                    whether it runs, and where
  install [--remove]        add ${name} to the app menu (or remove it)
  help                      this text
`;

export function defineApp(config: AppConfig): LocalApp {
  const { name } = config;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name))
    throw new Error(`the app's name must be lowercase letters, digits, ".", "_" or "-": "${name}"`);
  const title = config.title ?? name;
  const auth = config.auth ?? true;
  const idle = config.idle === false ? false : parseDuration(config.idle ?? "30m");
  const host: Host = thisHost();
  const dir = config.dir ?? stateDir(name, host);
  const command = config.command ?? [process.execPath, ...process.execArgv, process.argv[1]!];
  const launcher: LauncherOptions = { name, dir, auth, command, host };
  const urlOf = (record: ServerRecord) => `http://127.0.0.1:${record.port}`;

  const app: LocalApp = {
    name,
    open: (path = "/") => openApp(launcher, path),
    serve: (options = {}) =>
      serve({
        name,
        dir,
        handler: config.handler,
        upgrade: config.upgrade,
        auth,
        idle: options.background ? idle : false,
        busy: config.busy,
        close: config.close,
        port: options.port ?? config.port ?? defaultPort(name),
        portGiven: options.port !== undefined,
        background: options.background ?? false,
        log: (line) => console.error(line),
      }),
    stop: () => stopApp(launcher),
    async status() {
      const record = await running(launcher);
      return record && { pid: record.pid, port: record.port, url: urlOf(record) };
    },
    install: (options = {}) =>
      install({
        host,
        name,
        title,
        description: config.description ?? title,
        command,
        icon: { png: pathOf(config.icon?.png), svg: pathOf(config.icon?.svg) },
        categories: config.categories,
        remove: options.remove,
      }),
    async fetch(path, init) {
      return ask(name, await ensureRunning(launcher), path, { signal: AbortSignal.timeout(30_000), ...init });
    },
    async run(argv = process.argv.slice(2)) {
      const [sub = "open", ...rest] = argv;
      const say = (line: string) => console.error(line);
      try {
        switch (sub) {
          case "open": {
            const { values } = parseArgs({
              args: rest,
              options: { print: { type: "boolean", default: false }, wait: { type: "boolean", default: false } },
            });
            if (values.print) {
              const record = await ensureRunning(launcher);
              console.log(await launchLink(launcher, record));
              return 0;
            }
            const opened = await app.open();
            say(
              opened.window
                ? `${title} is open. ${idle === false ? "It keeps running" : "It stops when idle"} — or stop it with: ${name} stop`
                : `No browser could be started. Open (once, within a minute): ${opened.link}`
            );
            if (values.wait) await waitWhileRunning(opened.record);
            return 0;
          }
          case "serve": {
            const { values } = parseArgs({
              args: rest,
              options: { port: { type: "string" }, background: { type: "boolean", default: false } },
            });
            const port = values.port === undefined ? undefined : Number(values.port);
            if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535))
              throw new Error(`--port must be a port number, got "${values.port}"`);
            await app.serve({ ...(port !== undefined && { port }), background: values.background });
            return 0;
          }
          case "stop":
            say((await app.stop()) ? `Stopped ${title}.` : `${title} isn't running.`);
            return 0;
          case "status": {
            const status = await app.status();
            say(status ? `${title} is running at ${status.url} (process ${status.pid}).` : `${title} isn't running.`);
            return status ? 0 : 1;
          }
          case "install": {
            const { values } = parseArgs({ args: rest, options: { remove: { type: "boolean", default: false } } });
            const { paths } = await app.install({ remove: values.remove });
            say(
              values.remove
                ? `Removed ${title} from the app menu (${paths.join(", ")}).`
                : `Added ${title} to the app menu: ${paths.join(", ")}\nIt runs ${name} as this shell does — install again after moving it or changing Node.`
            );
            return 0;
          }
          case "help":
          case "--help":
          case "-h":
            console.log(USAGE(name));
            return 0;
          default:
            say(`Unknown command "${sub}".\n\n${USAGE(name)}`);
            return 2;
        }
      } catch (error) {
        say(`${name}: ${(error as Error).message}`);
        return 1;
      }
    },
    async main() {
      process.exit(await app.run());
    },
  };
  return app;
}
