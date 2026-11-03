import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * What localapp needs to know about the machine it runs on. Passed around instead of read from
 * `process` directly, so every platform's behaviour can be tested on any platform.
 */
export interface Host {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Linux inside WSL: the browser, the menu and the icons are Windows'. */
  wsl: boolean;
  home: string;
  exists: (path: string) => boolean;
  /** A folder's entries (none if it can't be read). */
  list: (dir: string) => string[];
}

/** Whether this is Linux running in WSL (Windows Subsystem for Linux). */
export function isWsl(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

export function thisHost(): Host {
  const list = (dir: string) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  return { platform: process.platform, env: process.env, wsl: isWsl(), home: homedir(), exists: existsSync, list };
}

/**
 * Where an app keeps its server record, log and lock, by the platform's convention:
 * `$XDG_STATE_HOME/<name>` (`~/.local/state/<name>`) on Linux, `~/Library/Application Support/<name>`
 * on macOS, `%LOCALAPPDATA%\<name>` on Windows.
 */
export function stateDir(name: string, host: Host): string {
  if (host.platform === "darwin") return join(host.home, "Library", "Application Support", name);
  if (host.platform === "win32") return join(host.env.LOCALAPPDATA ?? join(host.home, "AppData", "Local"), name);
  return join(xdg(host.env.XDG_STATE_HOME) ?? join(host.home, ".local", "state"), name);
}

/** An XDG base directory variable, if it's set to an absolute path (the spec: else it's ignored). */
export const xdg = (value: string | undefined) => (value && isAbsolute(value) ? value : undefined);
