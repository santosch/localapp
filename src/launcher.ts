import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Host } from "./host.ts";
import { readRecord, type ServerRecord } from "./record.ts";
import { answers, ask, isAlive, ROUTES } from "./client.ts";
import { openWindow, type Command } from "./window.ts";

export interface LauncherOptions {
  name: string;
  dir: string;
  auth: boolean;
  /** How to run the app's CLI (it must hand its arguments to localapp): [node, …flags, script]. */
  command: string[];
  host: Host;
}

/** How long a background start may take before the launcher gives up. */
const START_MS = 30_000;
/** A start lock older than this was left by a launch that died. */
const STALE_LOCK_MS = START_MS + 5_000;
/** The background server's log is started afresh past this size. */
const LOG_LIMIT = 1_000_000;

/**
 * The app's server, if one runs: its record, when the server named there answers as this app
 * (not a process id the system gave someone else since, not another program on the port).
 */
export async function running(opts: LauncherOptions): Promise<ServerRecord | null> {
  const record = await readRecord(opts.dir);
  return record && (await answers(opts.name, record)) ? record : null;
}

/** Starts `serve --background` detached, its output in a log, and waits until a server answers. */
async function startInBackground(opts: LauncherOptions): Promise<ServerRecord> {
  const logPath = join(opts.dir, "server.log");
  if (((await stat(logPath).catch(() => null))?.size ?? 0) > LOG_LIMIT) await rm(logPath, { force: true });
  const log = await open(logPath, "a", 0o600);
  const [program, ...args] = opts.command;
  let exited = false;
  const child = spawn(program!, [...args, "serve", "--background"], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  })
    .once("exit", () => (exited = true))
    .once("error", () => (exited = true));
  child.unref();
  await log.close();
  for (const deadline = Date.now() + START_MS; Date.now() < deadline && !exited; await delay(200)) {
    // Any server of the app will do: another launch may have started one at the same time.
    const record = await running(opts);
    if (record) return record;
  }
  const record = await running(opts);
  if (record) return record;
  const tail = (await readFile(logPath, "utf8").catch(() => "")).trim().split("\n").slice(-8).join("\n");
  throw new Error(`${opts.name} didn't start (its log: ${logPath}):\n${tail}`);
}

/** The running server, or one started now — by one launch at a time (a double click starts one). */
export async function ensureRunning(opts: LauncherOptions): Promise<ServerRecord> {
  const now = await running(opts);
  if (now) return now;
  await mkdir(opts.dir, { recursive: true });
  const lock = join(opts.dir, "starting.lock");
  for (const deadline = Date.now() + STALE_LOCK_MS + START_MS; Date.now() < deadline; await delay(250)) {
    const handle = await open(lock, "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return null;
    });
    if (handle) {
      try {
        return (await running(opts)) ?? (await startInBackground(opts));
      } finally {
        await handle.close();
        await rm(lock, { force: true });
      }
    }
    const record = await running(opts);
    if (record) return record;
    const age = Date.now() - ((await stat(lock).catch(() => null))?.mtimeMs ?? 0);
    if (age > STALE_LOCK_MS) await rm(lock, { force: true });
  }
  throw new Error(`${opts.name} didn't start: another launch is still starting it.`);
}

/** A link that lets one window in: a one-time code, not the key (which then never is on a command line). */
export async function launchLink(opts: LauncherOptions, record: ServerRecord, path = "/"): Promise<string> {
  const base = `http://127.0.0.1:${record.port}`;
  if (!opts.auth) return `${base}${path}`;
  const res = await ask(opts.name, record, ROUTES.launch, { method: "POST" });
  if (!res.ok) throw new Error(`${opts.name}'s server answered ${res.status} when asked to let a window in.`);
  const { code } = (await res.json()) as { code: string };
  return `${base}${ROUTES.enter}?code=${code}&to=${encodeURIComponent(path)}`;
}

export interface Opened {
  record: ServerRecord;
  /** What opened the window — null: no browser could be started. */
  window: Command | null;
  /** The link, if no window opened (valid once, for a minute). */
  link?: string;
}

/** Opens the app: its server (started if none runs) in a window of its own. */
export async function openApp(opts: LauncherOptions, path = "/"): Promise<Opened> {
  const record = await ensureRunning(opts);
  const link = await launchLink(opts, record, path);
  const window = await openWindow(link, opts.host);
  return window ? { record, window } : { record, window, link };
}

/** Stops the app's server: true if one ran. */
export async function stopApp(opts: LauncherOptions): Promise<boolean> {
  const record = await running(opts);
  if (!record) return false;
  // Asked to stop, it stops as it does when idle — its `close` runs, on every platform. (A
  // signal on Windows would end it on the spot.) One that doesn't answer gets SIGTERM.
  const asked = await ask(opts.name, record, ROUTES.stop, { method: "POST" }).then(
    (res) => res.ok,
    () => false
  );
  const gone = async (ms: number) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline && isAlive(record.pid);) await delay(100);
    return !isAlive(record.pid);
  };
  if (asked && (await gone(10_000))) return true;
  process.kill(record.pid, "SIGTERM");
  if (await gone(10_000)) return true;
  throw new Error(`${opts.name} (process ${record.pid}) didn't stop.`);
}

/** Waits while the server runs (what a WSL shortcut needs: WSL keeps a distribution up while it waits). */
export async function waitWhileRunning(record: ServerRecord): Promise<void> {
  while (isAlive(record.pid)) await delay(5000);
}
