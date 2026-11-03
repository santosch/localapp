import type { ServerRecord } from "./record.ts";

/** localapp's own routes, beside the app's. */
export const ROUTES = {
  ping: "/__localapp/ping",
  launch: "/__localapp/launch",
  enter: "/__localapp/enter",
  stop: "/__localapp/stop",
  keepAlive: "/__localapp/keepalive.js",
} as const;

/** The cookie the key travels in: by port too, since cookies don't tell ports (or apps) apart. */
export const cookieName = (name: string, port: number) => `localapp-${name.replace(/[^\w-]/g, "_")}-${port}`;

/** Whether a process lives (one of another user's counts too). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A request to the recorded server, with its key — as the app's window would send it. */
export function ask(name: string, record: ServerRecord, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (record.key) headers.set("cookie", `${cookieName(name, record.port)}=${record.key}`);
  return fetch(`http://127.0.0.1:${record.port}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(2000),
  });
}

/**
 * Whether the recorded server runs and answers as this app — not a process id the system gave
 * someone else since, not another program on the port.
 */
export async function answers(name: string, record: ServerRecord): Promise<boolean> {
  if (!isAlive(record.pid)) return false;
  try {
    const res = await ask(name, record, ROUTES.ping);
    const body = (await res.json()) as { ok?: unknown; name?: unknown; pid?: unknown };
    return res.ok && body.ok === true && body.name === name && body.pid === record.pid;
  } catch {
    return false;
  }
}
