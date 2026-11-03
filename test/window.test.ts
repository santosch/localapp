import { describe, expect, it } from "vitest";
import { stateDir } from "../src/host.ts";
import { windowCommands } from "../src/window.ts";
import { host } from "./helpers.ts";

const URL = "http://127.0.0.1:4520/__localapp/enter?code=c";

describe("the app's window", () => {
  it("is a Chromium app window on Linux when one is on PATH, else the default browser", () => {
    expect(windowCommands(URL, host({}, ["/usr/bin/chromium", "/bin/chromium"]))).toEqual([
      { command: "/usr/bin/chromium", args: [`--app=${URL}`] },
      { command: "xdg-open", args: [URL] },
    ]);
    expect(windowCommands(URL, host())).toEqual([{ command: "xdg-open", args: [URL] }]);
  });

  it("is Windows' Chrome or Edge on WSL, by their paths, then Explorer", () => {
    const edge = "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    expect(windowCommands(URL, host({ wsl: true }, [edge, "/usr/bin/google-chrome"]))).toEqual([
      { command: edge, args: [`--app=${URL}`] },
      { command: "/mnt/c/Windows/explorer.exe", args: [URL] },
    ]);
  });

  it("finds a browser installed for one Windows user, from WSL", () => {
    const chrome = "/mnt/c/Users/me/AppData/Local/Google/Chrome/Application/chrome.exe";
    const wsl = host({ wsl: true, list: (dir) => (dir === "/mnt/c/Users" ? ["Public", "me"] : []) }, [chrome]);
    expect(windowCommands(URL, wsl)[0]).toEqual({ command: chrome, args: [`--app=${URL}`] });
  });

  it("is Chrome or Edge on Windows, wherever they're installed", () => {
    const chrome = "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const env = {
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      WINDIR: "C:\\Windows",
    };
    expect(windowCommands(URL, host({ platform: "win32", env }, [chrome]))).toEqual([
      { command: chrome, args: [`--app=${URL}`] },
      { command: "C:\\Windows\\explorer.exe", args: [URL] },
    ]);
  });

  it("opens a new app instance of Chrome on macOS", () => {
    expect(windowCommands(URL, host({ platform: "darwin" }, ["/Applications/Google Chrome.app"]))).toEqual([
      { command: "open", args: ["-na", "Google Chrome", "--args", `--app=${URL}`] },
      { command: "open", args: [URL] },
    ]);
  });

  it("tries the browser LOCALAPP_BROWSER names first", () => {
    expect(windowCommands(URL, host({ env: { LOCALAPP_BROWSER: "/opt/vivaldi" } }))[0]).toEqual({
      command: "/opt/vivaldi",
      args: [`--app=${URL}`],
    });
  });
});

describe("where an app keeps its things", () => {
  it("follows each platform's convention", () => {
    expect(stateDir("hello", host())).toBe("/home/me/.local/state/hello");
    expect(stateDir("hello", host({ env: { XDG_STATE_HOME: "/state" } }))).toBe("/state/hello");
    // Empty or relative: ignored, as the XDG spec says (else it would depend on the working folder).
    expect(stateDir("hello", host({ env: { XDG_STATE_HOME: "" } }))).toBe("/home/me/.local/state/hello");
    expect(stateDir("hello", host({ env: { XDG_STATE_HOME: "state" } }))).toBe("/home/me/.local/state/hello");
    expect(stateDir("hello", host({ platform: "darwin" }))).toBe("/home/me/Library/Application Support/hello");
    expect(stateDir("hello", host({ platform: "win32", env: { LOCALAPPDATA: "C:/Users/me/AppData/Local" } }))).toMatch(
      /^C:[/\\]Users[/\\]me[/\\]AppData[/\\]Local[/\\]hello$/
    );
  });
});
