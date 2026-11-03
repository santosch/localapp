import { spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import { answers, cookieName, ROUTES } from "./client.ts";
import { readRecord, removeRecord, writeRecord, type ServerRecord } from "./record.ts";

/** A WebSocket (or other) upgrade, as `ws`'s `handleUpgrade` takes it. */
export type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface ServeOptions {
  name: string;
  dir: string;
  handler: RequestListener;
  upgrade?: UpgradeListener | undefined;
  /** Ask for the per-launch key (a cookie the launcher hands the window). */
  auth: boolean;
  /** Stop after this long unused (ms) — false: keep running. */
  idle: number | false;
  /** Still at work (a job running): not idle, whatever the requests say. */
  busy?: (() => boolean) | undefined;
  /** Called once the server has stopped taking requests, before the process ends. */
  close?: (() => void | Promise<void>) | undefined;
  port: number;
  /** Started by the launcher: another port when this one is taken, and what it started stops with it. */
  background: boolean;
  /** The port was asked for (`--port`): taken is an error, not a reason to pick another. */
  portGiven: boolean;
  log: (line: string) => void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** This machine by name — a page whose own name resolves to 127.0.0.1 (DNS rebinding) isn't. */
function localHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The same secret, compared in constant time — byte lengths first (a non-ASCII cookie isn't a crash). */
function sameSecret(given: string | undefined, key: string): boolean {
  if (given === undefined) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(key)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A path of this app to go to after letting a window in — never a page elsewhere (`//x`, `/\x`). */
export function localPath(to: string | null): string {
  try {
    const target = new URL(to ?? "/", "http://app.invalid");
    return target.origin === "http://app.invalid" ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

function reply(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const LAUNCH_CODE_MS = 60_000;

/** What a window loads to keep a server that stops when idle running while it's open. */
const KEEP_ALIVE_JS = `setInterval(() => fetch(${JSON.stringify(`${ROUTES.ping}?keepalive`)}, { cache: "no-store" }).catch(() => {}), 60000);\n`;

export interface Gate {
  request: RequestListener;
  allowUpgrade: (req: IncomingMessage) => boolean;
  launchCode: () => string;
}

/**
 * The gate in front of the app: only requests to this machine by name; with `auth`, only those
 * carrying the key (a cookie the window gets from a one-time launch code); changes only from the
 * app's own pages. localapp's routes (ping, launch codes, stop) are answered here. `onUse`: a
 * request that got in — what keeps the app from being idle (a status check's ping doesn't count,
 * a window's keep-alive ping does).
 */
export function gate(opts: {
  name: string;
  key: string;
  port: () => number;
  auth: boolean;
  handler: RequestListener;
  onUse?: () => void;
  onStop?: () => void;
}): Gate {
  const codes = new Map<string, number>();
  const launchCode = () => {
    const now = Date.now();
    // Codes nobody used (a window that never opened) go once they're expired.
    for (const [code, expires] of codes) if (expires < now) codes.delete(code);
    const code = randomBytes(18).toString("base64url");
    codes.set(code, now + LAUNCH_CODE_MS);
    return code;
  };
  const signedIn = (req: IncomingMessage) =>
    !opts.auth || sameSecret(cookie(req, cookieName(opts.name, opts.port())), opts.key);
  const sameOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    return !origin || origin === `http://${req.headers.host}`;
  };

  const request: RequestListener = (req, res) => {
    if (!localHost(req.headers.host)) return reply(res, 403, "unknown host");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === ROUTES.enter && req.method === "GET") {
      const code = url.searchParams.get("code") ?? "";
      const expires = codes.get(code);
      codes.delete(code);
      if (!expires || expires < Date.now())
        return reply(res, 403, `This link was used already or has expired. Open ${opts.name} again.`);
      opts.onUse?.();
      res.writeHead(303, {
        "location": localPath(url.searchParams.get("to")),
        "set-cookie": `${cookieName(opts.name, opts.port())}=${opts.key}; Path=/; HttpOnly; SameSite=Strict`,
        "cache-control": "no-store",
      });
      return res.end();
    }
    if (!signedIn(req))
      return reply(
        res,
        401,
        `<!doctype html><meta charset="utf-8"><title>${opts.name}</title><body style="font:15px system-ui;padding:3em">Open this app through <b>${opts.name}</b> — it opens a window that's let in.</body>`,
        "text/html; charset=utf-8"
      );
    const reads = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
    if (!reads && !sameOrigin(req)) return reply(res, 403, "cross-site request refused");
    if (url.pathname === ROUTES.ping) {
      if (url.searchParams.has("keepalive")) opts.onUse?.();
      return reply(res, 200, JSON.stringify({ ok: true, name: opts.name, pid: process.pid }), "application/json");
    }
    opts.onUse?.();
    if (url.pathname === ROUTES.keepAlive) return reply(res, 200, KEEP_ALIVE_JS, "text/javascript");
    if (url.pathname === ROUTES.launch && req.method === "POST")
      return reply(res, 200, JSON.stringify({ code: launchCode() }), "application/json");
    if (url.pathname === ROUTES.stop && req.method === "POST") {
      reply(res, 202, JSON.stringify({ stopping: true }), "application/json");
      return opts.onStop?.();
    }
    opts.handler(req, res);
  };
  const allowUpgrade = (req: IncomingMessage) => localHost(req.headers.host) && signedIn(req) && sameOrigin(req);
  return { request, allowUpgrade, launchCode };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((started, failed) => {
    server.once("error", failed);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", failed);
      started((server.address() as { port: number }).port);
    });
  });
}

/**
 * Ends what a background server started (tools, workers) with it. Started detached it leads its
 * own process group on Linux and macOS; on Windows, its process tree.
 */
function stopStarted(): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(process.pid)], { windowsHide: true, stdio: "ignore" });
    return;
  }
  process.removeAllListeners("SIGTERM");
  process.on("SIGTERM", () => process.exit(0));
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch {
    // Not a group leader after all: nothing else to stop.
  }
}

/**
 * Runs the app's server until it's told to stop (`stop`, SIGINT, SIGTERM — or idle, if it may stop
 * then). Writes the record a launcher finds it by, unless another server of the app runs and
 * answers: then a background start leaves (that one is used), a foreground one runs beside it.
 */
export async function serve(opts: ServeOptions): Promise<void> {
  const other = await readRecord(opts.dir);
  // A record left by a server that crashed (its process id since someone else's) doesn't count.
  const otherRuns = other !== null && (await answers(opts.name, other));
  if (otherRuns && opts.background) {
    opts.log(`${opts.name} is already running (process ${other.pid}).`);
    return;
  }
  // A new key every launch: only who holds the record (this user) or a launch code gets in.
  const key = opts.auth ? randomBytes(24).toString("base64url") : "";
  let port = opts.port;
  let lastActive = performance.now();
  let stop: (why?: string) => void = () => undefined;
  const { request, allowUpgrade, launchCode } = gate({
    name: opts.name,
    key,
    port: () => port,
    auth: opts.auth,
    handler: opts.handler,
    onUse: () => (lastActive = performance.now()),
    onStop: () => stop(),
  });
  const server = createServer(request);

  // What keeps it from being idle: requests that got in, open upgraded connections (WebSockets), busy().
  const open = new Set<Duplex>();
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!opts.upgrade || !allowUpgrade(req)) return socket.destroy();
    lastActive = performance.now();
    open.add(socket);
    socket.once("close", () => {
      open.delete(socket);
      lastActive = performance.now();
    });
    opts.upgrade(req, socket, head);
  });

  try {
    port = await listen(server, opts.port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || !opts.background || opts.portGiven) {
      throw (error as NodeJS.ErrnoException).code === "EADDRINUSE"
        ? new Error(`Port ${opts.port} is in use. Pick another with --port.`)
        : error;
    }
    port = await listen(server, 0);
  }
  const record: ServerRecord = { pid: process.pid, port, key };
  if (!otherRuns) await writeRecord(opts.dir, record);
  opts.log(`${opts.name} is running on http://127.0.0.1:${port} (process ${process.pid}).`);
  if (!opts.background && opts.auth)
    opts.log(`Open it (once, within a minute): http://127.0.0.1:${port}${ROUTES.enter}?code=${launchCode()}`);
  if (!opts.background) opts.log("Ctrl+C stops it.");

  await new Promise<void>((stopped) => {
    let stopping = false;
    stop = (why) => {
      if (stopping) return;
      stopping = true;
      if (why) opts.log(why);
      server.close(() => stopped());
      // Open keep-alive connections (a browser's) would keep close() waiting forever.
      server.closeAllConnections();
      for (const socket of open) socket.destroy();
    };
    process.once("SIGINT", () => stop());
    process.once("SIGTERM", () => stop());
    if (opts.idle !== false) {
      const idle = opts.idle;
      // A monotonic clock: time the machine was asleep isn't time idle.
      setInterval(
        () => {
          if (performance.now() - lastActive > idle && open.size === 0 && !opts.busy?.())
            stop(`${opts.name} stops: nothing has used it for a while.`);
        },
        Math.min(60_000, Math.max(200, idle / 4))
      ).unref();
    }
  });
  try {
    await opts.close?.();
  } catch (error) {
    // Still stops all the way: a record left behind, or workers left running, would be worse.
    opts.log(`${opts.name}: closing failed: ${(error as Error).message}`);
  } finally {
    await removeRecord(opts.dir, process.pid);
    opts.log(`${opts.name} has stopped.`);
    if (opts.background) stopStarted();
  }
}
