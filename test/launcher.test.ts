import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readRecord, writeRecord } from "../src/record.ts";
import { isAlive } from "../src/client.ts";
import { tempDir } from "./helpers.ts";

const run = promisify(execFile);
const APP = fileURLToPath(new URL("./fixtures/app.ts", import.meta.url));
/** A "browser" that opens nothing and succeeds — no windows in tests. */
const NO_BROWSER = fileURLToPath(new URL("./fixtures/no-browser.sh", import.meta.url));
const root = tempDir();
let n = 0;
/** Each test its own app state, so servers never meet. */
const freshDir = () => join(root, `state-${++n}`);
let started: number[] = [];

async function cli(dir: string, args: string[], env: Record<string, string> = {}) {
  const result = await run(process.execPath, [APP, ...args], {
    env: { ...process.env, TEST_STATE_DIR: dir, LOCALAPP_BROWSER: NO_BROWSER, ...env },
    timeout: 40_000,
  }).catch((error: { code: number; stdout: string; stderr: string }) => error);
  const record = await readRecord(dir);
  if (record) started.push(record.pid);
  return { code: "code" in result && typeof result.code === "number" ? result.code : 0, ...result };
}

afterEach(() => {
  for (const pid of started) if (isAlive(pid)) process.kill(pid, "SIGTERM");
  started = [];
});

// The launcher runs a real server in the background (on Windows the stand-in browser, a shell script, can't run).
describe.skipIf(process.platform === "win32")("the launcher", () => {
  it("starts the server in the background once, reuses it, and stops it", async () => {
    const dir = freshDir();
    const first = await cli(dir, ["open"]);
    expect(first.stderr).toContain("localapp-test is open");
    const record = await readRecord(dir);
    expect(record && isAlive(record.pid)).toBe(true);
    // Open again: the same server.
    await cli(dir, ["open"]);
    expect((await readRecord(dir))?.pid).toBe(record?.pid);
    const status = await cli(dir, ["status"]);
    expect(status.stderr).toContain(`running at http://127.0.0.1:${record?.port}`);
    expect((await cli(dir, ["stop"])).stderr).toContain("Stopped localapp-test.");
    expect(isAlive(record!.pid)).toBe(false);
    expect(await readRecord(dir)).toBeNull();
    const after = await cli(dir, ["status"]);
    expect(after.code).toBe(1);
    expect(after.stderr).toContain("isn't running");
  });

  it("runs the app's close when asked to stop", async () => {
    const dir = freshDir();
    const closed = join(dir, "closed.txt");
    await cli(dir, ["open"], { TEST_CLOSED_FILE: closed });
    await cli(dir, ["stop"]);
    expect(readFileSync(closed, "utf8")).toBe("closed");
  });

  it("starts anyway when a server crashed and its process id is someone else's now", async () => {
    const dir = freshDir();
    // This test's own process: alive, but not the app.
    await writeRecord(dir, { pid: process.pid, port: 1, key: "stale" });
    const opened = await cli(dir, ["open"]);
    expect(opened.stderr).toContain("localapp-test is open");
    expect((await readRecord(dir))?.pid).not.toBe(process.pid);
  });

  it("lets a printed one-time link in once, with the key as a cookie", async () => {
    const dir = freshDir();
    const { stdout } = await cli(dir, ["open", "--print"]);
    const link = stdout.trim();
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/__localapp\/enter\?code=/);
    const enter = await fetch(link, { redirect: "manual" });
    expect(enter.status).toBe(303);
    const cookie = enter.headers.get("set-cookie")!.split(";")[0]!;
    const page = await fetch(new URL("/hi", link), { headers: { cookie } });
    expect(await page.json()).toMatchObject({ hello: "world", url: "/hi" });
    expect((await fetch(link, { redirect: "manual" })).status).toBe(403);
  });

  it("starts one server when launched twice at once", async () => {
    const dir = freshDir();
    await Promise.all([cli(dir, ["open"]), cli(dir, ["open"]), cli(dir, ["open"])]);
    const pids = new Set(started);
    expect(pids.size).toBe(1);
  });

  it("stops by itself when idle, and removes its record", async () => {
    const dir = freshDir();
    await cli(dir, ["open"], { TEST_IDLE: "1s" });
    const record = await readRecord(dir);
    expect(record).not.toBeNull();
    for (let i = 0; i < 40 && isAlive(record!.pid); i++) await delay(100);
    expect(isAlive(record!.pid)).toBe(false);
    expect(await readRecord(dir)).toBeNull();
  });

  it("takes another port in the background when its own is taken", async () => {
    const { createServer } = await import("node:http");
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const dir = freshDir();
      await cli(dir, ["open"], { TEST_PORT: String(taken) });
      const record = await readRecord(dir);
      expect(record?.port).not.toBe(taken);
      // In the foreground, a port asked for that is taken is an error.
      const foreground = await cli(freshDir(), ["serve", "--port", String(taken)]);
      expect(foreground.code).toBe(1);
      expect(foreground.stderr).toContain(`Port ${taken} is in use`);
    } finally {
      blocker.close();
    }
  });

  it("says what it can do", async () => {
    const { stdout } = await cli(freshDir(), ["help"]);
    expect(stdout).toContain("install [--remove]");
    const unknown = await cli(freshDir(), ["frobnicate"]);
    expect(unknown.code).toBe(2);
  });
});
