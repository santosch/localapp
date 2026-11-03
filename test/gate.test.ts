import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieName, ROUTES } from "../src/client.ts";
import { gate, localPath } from "../src/server.ts";

let server: Server;
let port = 0;
let launchCode: () => string;
let uses = 0;
let stops = 0;
const KEY = "the-key";
const base = () => `http://127.0.0.1:${port}`;
const signedIn = () => ({ cookie: `${cookieName("hello", port)}=${KEY}` });

beforeAll(async () => {
  const g = gate({
    name: "hello",
    key: KEY,
    port: () => port,
    auth: true,
    handler: (req, res) => res.end(`app: ${req.method} ${req.url}`),
    onUse: () => uses++,
    onStop: () => stops++,
  });
  launchCode = g.launchCode;
  server = createServer(g.request);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("the gate in front of the app", () => {
  it("lets a launch code in once, as a cookie, to a path of the app only", async () => {
    const code = launchCode();
    const res = await fetch(`${base()}${ROUTES.enter}?code=${code}&to=${encodeURIComponent("/board?x=1")}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/board?x=1");
    expect(res.headers.get("set-cookie")).toBe(
      `${cookieName("hello", port)}=${KEY}; Path=/; HttpOnly; SameSite=Strict`
    );
    // Used: gone.
    expect((await fetch(`${base()}${ROUTES.enter}?code=${code}`, { redirect: "manual" })).status).toBe(403);
    // Never a redirect elsewhere.
    const away = await fetch(`${base()}${ROUTES.enter}?code=${launchCode()}&to=//evil.example`, { redirect: "manual" });
    expect(away.headers.get("location")).toBe("/");
  });

  it("asks for the key, then hands requests to the app", async () => {
    expect((await fetch(`${base()}/`)).status).toBe(401);
    expect((await fetch(`${base()}/`, { headers: { cookie: `${cookieName("hello", port)}=wrong` } })).status).toBe(401);
    expect(await (await fetch(`${base()}/x`, { headers: signedIn() })).text()).toBe("app: GET /x");
  });

  it("answers its own routes: ping, a keep-alive script, launch codes", async () => {
    expect(await (await fetch(`${base()}${ROUTES.ping}`, { headers: signedIn() })).json()).toMatchObject({
      ok: true,
      name: "hello",
    });
    expect(await (await fetch(`${base()}${ROUTES.keepAlive}`, { headers: signedIn() })).text()).toContain(
      "setInterval"
    );
    const { code } = (await (
      await fetch(`${base()}${ROUTES.launch}`, { method: "POST", headers: signedIn() })
    ).json()) as {
      code: string;
    };
    expect(code).toMatch(/^[\w-]{20,}$/);
  });

  it("takes changes only from the app's own pages, and only requests to this machine by name", async () => {
    const post = (origin?: string) =>
      fetch(`${base()}/api`, { method: "POST", headers: { ...signedIn(), ...(origin && { origin }) } });
    expect((await post(base())).status).toBe(200);
    expect((await post()).status).toBe(200); // a CLI sends no Origin
    expect((await post("http://evil.example")).status).toBe(403);
    expect((await post("http://localhost:3000")).status).toBe(403);
    // DNS rebinding: a foreign name for 127.0.0.1.
    const { request } = await import("node:http");
    const status = await new Promise<number>((done) =>
      request(`${base()}/`, { headers: { ...signedIn(), host: "evil.example" } }, (res) =>
        done(res.statusCode ?? 0)
      ).end()
    );
    expect(status).toBe(403);
  });

  it("turns away a cookie of odd bytes instead of crashing", async () => {
    // As long as the key in characters, longer in bytes.
    const odd = `${"é".repeat(KEY.length)}`;
    const { request } = await import("node:http");
    const status = await new Promise<number>((done) =>
      request(`${base()}/`, { headers: { cookie: `${cookieName("hello", port)}=${odd}` } }, (res) =>
        done(res.statusCode ?? 0)
      ).end()
    );
    expect(status).toBe(401);
  });

  it("counts as use what got in — a window's keep-alive too, a status check's ping not", async () => {
    uses = 0;
    await fetch(`${base()}/`);
    await fetch(`${base()}${ROUTES.ping}`, { headers: signedIn() });
    expect(uses).toBe(0);
    await fetch(`${base()}${ROUTES.ping}?keepalive`, { headers: signedIn() });
    await fetch(`${base()}/page`, { headers: signedIn() });
    expect(uses).toBe(2);
  });

  it("stops when its own CLI asks (with the key, not from a page)", async () => {
    expect((await fetch(`${base()}${ROUTES.stop}`, { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(`${base()}${ROUTES.stop}`, {
          method: "POST",
          headers: { ...signedIn(), origin: "http://evil.example" },
        })
      ).status
    ).toBe(403);
    expect(stops).toBe(0);
    expect((await fetch(`${base()}${ROUTES.stop}`, { method: "POST", headers: signedIn() })).status).toBe(202);
    expect(stops).toBe(1);
  });
});

describe("where a window goes once it's let in", () => {
  it("is a path of the app, never a page elsewhere", () => {
    expect(localPath("/board?x=1#top")).toBe("/board?x=1#top");
    expect(localPath(null)).toBe("/");
    expect(localPath("//evil.example")).toBe("/");
    expect(localPath("/\\evil.example")).toBe("/");
    expect(localPath("https://evil.example/")).toBe("/");
  });
});
