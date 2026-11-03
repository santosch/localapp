// A small app for the launcher tests: run with Node (it strips the types). Its state folder and
// idle time come from the test.
import { defineApp } from "../../src/index.ts";

const app = defineApp({
  name: "localapp-test",
  dir: process.env.TEST_STATE_DIR!,
  idle: process.env.TEST_IDLE ?? "30m",
  port: Number(process.env.TEST_PORT ?? 0) || undefined,
  handler(req, res) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hello: "world", pid: process.pid, url: req.url }));
  },
});

await app.main();
