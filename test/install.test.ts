import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pngToIcns } from "../src/icons.ts";
import { desktopEntry, desktopExec, hiddenRunner, infoPlist, install, withPath, wslCommand } from "../src/install.ts";
import { readRecord, recordFile, removeRecord, writeRecord } from "../src/record.ts";
import { host, png, tempDir } from "./helpers.ts";

const dir = tempDir();
const icon = join(dir, "icon.png");
writeFileSync(icon, png(256));
const svg = join(dir, "icon.svg");
writeFileSync(svg, "<svg/>");
const app = { name: "hello", title: "Hello", description: "Says hello", command: ["/usr/bin/node", "/x/hello.js"] };

describe("a Linux menu entry", () => {
  it("quotes its Exec line as the desktop entry spec asks", () => {
    expect(desktopExec(["/usr/bin/node", "--conditions=source", "/home/me/my code/bin.ts", "100%"])).toBe(
      '/usr/bin/node --conditions=source "/home/me/my code/bin.ts" 100%%'
    );
    // Quoting escapes, then the file's own: every backslash doubled.
    expect(desktopExec(['/a "b"/$c'])).toBe('"/a \\\\"b\\\\"/\\\\$c"');
  });

  // Writes real files under POSIX paths: on Linux and macOS (CI plays both), not on Windows.
  it.skipIf(process.platform === "win32")(
    "is a desktop entry and its icon, with this shell's PATH — gone again with remove",
    async () => {
      const data = join(dir, "data");
      const options = {
        ...app,
        host: host({ env: { XDG_DATA_HOME: data, PATH: "/usr/bin:/bin" } }),
        icon: { png: icon },
      };
      const { paths } = await install(options);
      expect(paths).toEqual([
        join(data, "applications", "hello.desktop"),
        join(data, "icons", "hicolor", "256x256", "apps", "hello.png"),
      ]);
      const entry = readFileSync(paths[0]!, "utf8");
      expect(entry).toBe(
        desktopEntry({
          title: "Hello",
          description: "Says hello",
          exec: withPath([...app.command, "open"], options.host),
          icon: paths[1]!,
        })
      );
      expect(entry).toContain("Exec=/usr/bin/env PATH=/usr/bin:/bin /usr/bin/node /x/hello.js open\n");
      expect(readFileSync(paths[1]!)).toEqual(readFileSync(icon));
      await install({ ...options, remove: true });
      expect(() => statSync(paths[0]!)).toThrow();
      expect(() => statSync(paths[1]!)).toThrow();
    }
  );

  it.skipIf(process.platform === "win32")("prefers an SVG icon (scalable)", async () => {
    const data = join(dir, "data-svg");
    const { paths } = await install({ ...app, host: host({ env: { XDG_DATA_HOME: data } }), icon: { png: icon, svg } });
    expect(paths[1]).toBe(join(data, "icons", "hicolor", "scalable", "apps", "hello.svg"));
  });
});

describe.skipIf(process.platform === "win32")("a macOS app", () => {
  it("is an .app in ~/Applications that runs the CLI, with the icon as .icns", async () => {
    const home = join(dir, "mac");
    const { paths } = await install({ ...app, host: host({ platform: "darwin", home }), icon: { png: icon } });
    expect(paths).toEqual([join(home, "Applications", "Hello.app")]);
    const contents = join(paths[0]!, "Contents");
    expect(readFileSync(join(contents, "Info.plist"), "utf8")).toBe(
      infoPlist({ name: "hello", title: "Hello", icon: true })
    );
    expect(readFileSync(join(contents, "Resources", "hello.icns"))).toEqual(pngToIcns(png(256)));
    const script = join(contents, "MacOS", "hello");
    expect(readFileSync(script, "utf8")).toBe(
      "#!/bin/sh\nexec '/usr/bin/env' 'PATH=/usr/bin:/bin' '/usr/bin/node' '/x/hello.js' 'open'\n"
    );
    if (process.platform !== "win32") expect(statSync(script).mode % 0o1000).toBe(0o755);
  });
});

describe("a Windows shortcut (from WSL)", () => {
  it("runs the app in the distribution with no shell between, from a script that shows no window", () => {
    const command = wslCommand("Ubuntu", ["/usr/bin/env", "PATH=/a b:/c", "/home/me/hello.js"]);
    expect(command).toBe('wsl.exe -d Ubuntu --cd ~ --exec /usr/bin/env "PATH=/a b:/c" /home/me/hello.js open --wait');
    expect(hiddenRunner(command)).toBe(
      'CreateObject("WScript.Shell").Run "wsl.exe -d Ubuntu --cd ~ --exec /usr/bin/env ""PATH=/a b:/c"" /home/me/hello.js open --wait", 0, False\r\n'
    );
  });

  it("gets this shell's PATH without a package manager's folders, nor Windows' on WSL", () => {
    const env = {
      PATH: "/repo/node_modules/.bin:/home/me/.local/bin:/usr/bin:/mnt/c/Program Files/Git/cmd:/usr/bin:/mnt/c/Windows",
    };
    expect(withPath(["node"], host({ wsl: true, env }))).toEqual([
      "/usr/bin/env",
      "PATH=/home/me/.local/bin:/usr/bin",
      "node",
    ]);
  });

  it("refuses an icon that is neither PNG nor SVG", async () => {
    await expect(install({ ...app, host: host(), icon: { png: join(dir, "icon.ico") } })).rejects.toThrow(
      /\.png or \.svg/
    );
  });
});

describe("the running server's record", () => {
  it("is only this user's to read, and only its own server removes it", async () => {
    const records = join(dir, "state");
    await writeRecord(records, { pid: 41, port: 4520, key: "secret" });
    if (process.platform !== "win32") expect(statSync(recordFile(records)).mode % 0o1000).toBe(0o600);
    expect(await readRecord(records)).toEqual({ pid: 41, port: 4520, key: "secret" });
    await removeRecord(records, 42);
    expect(await readRecord(records)).not.toBeNull();
    await removeRecord(records, 41);
    expect(await readRecord(records)).toBeNull();
  });
});
