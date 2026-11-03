import { spawn } from "node:child_process";
import { delimiter, join, win32 } from "node:path";
import type { Host } from "./host.ts";

/** A program and its arguments. */
export interface Command {
  command: string;
  args: string[];
}

const LINUX = [
  "google-chrome",
  "google-chrome-stable",
  "microsoft-edge",
  "chromium",
  "chromium-browser",
  "brave-browser",
];
const MAC = ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"];
/** Where Chrome and Edge install on Windows, under these folders. */
const WINDOWS = [
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["Microsoft", "Edge", "Application", "msedge.exe"],
  ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
];

/**
 * The ways to open `url` on this host, best first: a Chromium browser's app window (Chrome, Edge,
 * Chromium, Brave — a window of its own, no tabs or address bar), then a tab of the default
 * browser. On WSL, the Windows browser (WSL forwards Windows' localhost to Linux).
 * `LOCALAPP_BROWSER` names a browser to try first.
 */
export function windowCommands(url: string, host: Host): Command[] {
  const app = `--app=${url}`;
  const chosen = host.env.LOCALAPP_BROWSER;
  const commands: Command[] = chosen ? [{ command: chosen, args: [app] }] : [];
  if (host.platform === "darwin") {
    const installed = MAC.filter((name) =>
      [join("/Applications", `${name}.app`), join(host.home, "Applications", `${name}.app`)].some(host.exists)
    );
    commands.push(...installed.map((name) => ({ command: "open", args: ["-na", name, "--args", app] })));
    commands.push({ command: "open", args: [url] });
  } else if (host.platform === "win32") {
    const roots = [host.env.ProgramFiles, host.env["ProgramFiles(x86)"], host.env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root)
    );
    const found = WINDOWS.flatMap((parts) =>
      roots
        .map((root) => win32.join(root, ...parts))
        .filter(host.exists)
        .slice(0, 1)
    );
    commands.push(...found.map((command) => ({ command, args: [app] })));
    commands.push({ command: win32.join(host.env.WINDIR ?? "C:\\Windows", "explorer.exe"), args: [url] });
  } else if (host.wsl) {
    // Installed for everyone, or for one user (Chrome and Brave can be, in their AppData\Local).
    const users = host
      .list("/mnt/c/Users")
      .filter((user) => !["All Users", "Default", "Default User", "Public"].includes(user))
      .map((user) => `/mnt/c/Users/${user}/AppData/Local`);
    const roots = ["/mnt/c/Program Files", "/mnt/c/Program Files (x86)", ...users];
    const found = WINDOWS.flatMap((parts) =>
      roots
        .map((root) => join(root, ...parts))
        .filter(host.exists)
        .slice(0, 1)
    );
    commands.push(...found.map((command) => ({ command, args: [app] })));
    // By its full path: a menu entry starts with a PATH that has no Windows folders.
    commands.push({ command: "/mnt/c/Windows/explorer.exe", args: [url] });
  } else {
    const path = (host.env.PATH ?? "").split(delimiter).filter(Boolean);
    const found = LINUX.flatMap((name) =>
      path
        .map((dir) => join(dir, name))
        .filter(host.exists)
        .slice(0, 1)
    );
    commands.push(...found.map((command) => ({ command, args: [app] })));
    commands.push({ command: "xdg-open", args: [url] });
  }
  return commands;
}

/** How long a browser gets to fail (no display, a broken install) before it counts as started. */
const SETTLE_MS = 1500;

/**
 * Starts a command without waiting for it to end. False if it couldn't start, or failed right
 * away. (A browser that hands the window to its running instance ends at once — that's fine.)
 */
function start({ command, args }: Command): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      const settled = setTimeout(() => resolve(true), SETTLE_MS);
      child.once("exit", (code) => {
        clearTimeout(settled);
        // explorer.exe answers 1 even when it opened the page.
        resolve(code === 0 || /explorer\.exe$/i.test(command));
      });
    });
  });
}

/** Opens `url` the best way this host allows: what opened it, or null if nothing could. */
export async function openWindow(url: string, host: Host): Promise<Command | null> {
  for (const command of windowCommands(url, host)) if (await start(command)) return command;
  return null;
}
