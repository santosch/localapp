#!/usr/bin/env node
// A whole local app: a page with a button, a little API, and localapp around it.
//
//   node example/hello/hello.js            open it (starts its server in the background)
//   node example/hello/hello.js status     is it running?
//   node example/hello/hello.js stop       stop it
//   node example/hello/hello.js install    add it to the Start menu / app menu
//
// (Run `npm run build` in the repository first: the example uses the built package.)

import { readFileSync } from "node:fs";
import { defineApp } from "localapp";

const svgIcon = readFileSync(new URL("./icon.svg", import.meta.url));
let clicks = 0;

const page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Hello, localapp</title>
    <link rel="icon" href="/icon.svg" />
    <!-- Keeps the server running while this window is open (it stops when idle). -->
    <script src="/__localapp/keepalive.js"></script>
    <style>
      body { font: 16px system-ui, sans-serif; display: grid; place-items: center; height: 100vh; margin: 0;
             background: #0f172a; color: #e2e8f0; }
      main { text-align: center; }
      button { font: inherit; padding: 0.6em 1.4em; border-radius: 8px; border: 0; background: #14b8a6; color: #04201d; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Hello from localapp</h1>
      <p>This window talks to a server on your machine that started in the background.</p>
      <p><button id="hello">Say hello</button></p>
      <p id="answer"></p>
    </main>
    <script>
      document.getElementById("hello").onclick = async () => {
        const res = await fetch("/api/hello", { method: "POST" });
        const { clicks } = await res.json();
        document.getElementById("answer").textContent = "Hello back! (" + clicks + " so far)";
      };
    </script>
  </body>
</html>`;

const app = defineApp({
  name: "localapp-hello",
  title: "Hello localapp",
  description: "The localapp example: a page with a button",
  icon: { png: new URL("./icon.png", import.meta.url), svg: new URL("./icon.svg", import.meta.url) },
  idle: "10m",
  handler(req, res) {
    if (req.method === "POST" && req.url === "/api/hello") {
      clicks += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ clicks }));
    }
    if (req.url === "/icon.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end(svgIcon);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  },
});

await app.main();
