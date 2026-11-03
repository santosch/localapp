import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, win32 } from "node:path";
import { promisify } from "node:util";
import { xdg, type Host } from "./host.ts";
import { pngSize, pngToIcns, pngToIco } from "./icons.ts";

const run = promisify(execFile);

export interface InstallOptions {
  host: Host;
  /** File-safe id: the entry's file names. */
  name: string;
  /** What the menu shows. */
  title: string;
  description: string;
  /** The command that runs the app's CLI ([node, …flags, script]); the entry runs it with `open`. */
  command: readonly string[];
  /** The app's icon: a PNG (256×256 is best), and/or an SVG for Linux menus. */
  icon?: { png?: string | undefined; svg?: string | undefined } | undefined;
  /** Linux menu categories (freedesktop's), e.g. "Development;". */
  categories?: string | undefined;
  remove?: boolean | undefined;
}

export interface Installed {
  /** What was written (or removed), for the user to see. */
  paths: string[];
}

/**
 * The command with this shell's PATH: a menu starts it with a bare one, which lacks what the app
 * may run (git, gh, claude) when it lives in ~/.local/bin or a Node version manager. A package
 * manager's own folders are left out, and on WSL Windows' (the shortcut's line is limited in length).
 */
export function withPath(command: readonly string[], host: Host): string[] {
  const kept = (dir: string) =>
    dir !== "" &&
    !dir.includes("/node_modules/.bin") &&
    !dir.includes("node-gyp-bin") &&
    !(host.wsl && dir.startsWith("/mnt/"));
  const dirs = new Set((host.env.PATH ?? "").split(":").filter(kept));
  return ["/usr/bin/env", `PATH=${[...dirs].join(":")}`, ...command];
}

/**
 * A desktop entry's Exec line, as the spec asks: arguments quoted where needed (with `"`, `` ` ``,
 * `$` and `\` escaped inside the quotes), `%` doubled, then every backslash doubled again for the
 * file's own string escapes.
 */
export function desktopExec(argv: readonly string[]): string {
  return argv
    .map((arg) => {
      const escaped = arg.replace(/%/g, "%%");
      if (/^[\w@%+=:,./-]+$/.test(escaped)) return escaped;
      return `"${escaped.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
    })
    .join(" ");
}

export function desktopEntry(o: {
  title: string;
  description: string;
  exec: readonly string[];
  icon?: string;
  categories?: string | undefined;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${o.title}`,
    `Comment=${o.description}`,
    `Exec=${desktopExec(o.exec)}`,
    ...(o.icon ? [`Icon=${o.icon}`] : []),
    "Terminal=false",
    `Categories=${o.categories ?? "Utility;"}`,
    "",
  ].join("\n");
}

async function linux(o: InstallOptions): Promise<Installed> {
  const data = xdg(o.host.env.XDG_DATA_HOME) ?? join(o.host.home, ".local", "share");
  const entry = join(data, "applications", `${o.name}.desktop`);
  const icons = join(data, "icons", "hicolor");
  let icon: string | undefined;
  if (o.icon?.svg) icon = join(icons, "scalable", "apps", `${o.name}.svg`);
  else if (o.icon?.png) {
    const { width, height } = pngSize(await readFile(o.icon.png));
    icon = join(icons, `${width}x${height}`, "apps", `${o.name}.png`);
  }
  if (o.remove) {
    await Promise.all([entry, icon].filter((p): p is string => Boolean(p)).map((p) => rm(p, { force: true })));
    return { paths: [entry, ...(icon ? [icon] : [])] };
  }
  if (icon) {
    await mkdir(dirname(icon), { recursive: true });
    await writeFile(icon, await readFile((o.icon?.svg ?? o.icon?.png)!));
  }
  await mkdir(dirname(entry), { recursive: true });
  const exec = withPath([...o.command, "open"], o.host);
  await writeFile(
    entry,
    desktopEntry({ title: o.title, description: o.description, exec, categories: o.categories, ...(icon && { icon }) })
  );
  return { paths: [entry, ...(icon ? [icon] : [])] };
}

const shQuote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`;
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function infoPlist(o: { name: string; title: string; icon: boolean }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${xml(o.title)}</string>
  <key>CFBundleIdentifier</key><string>localapp.${xml(o.name)}</string>
  <key>CFBundleExecutable</key><string>${xml(o.name)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
${o.icon ? `  <key>CFBundleIconFile</key><string>${xml(o.name)}.icns</string>\n` : ""}  <key>LSUIElement</key><true/>
</dict></plist>
`;
}

/** macOS: `~/Applications/<title>.app`, which runs the app's CLI (no Dock icon of its own). */
async function mac(o: InstallOptions): Promise<Installed> {
  const app = join(o.host.home, "Applications", `${o.title}.app`);
  if (o.remove) {
    await rm(app, { recursive: true, force: true });
    return { paths: [app] };
  }
  const contents = join(app, "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  const png = o.icon?.png;
  if (png) {
    await mkdir(join(contents, "Resources"), { recursive: true });
    await writeFile(join(contents, "Resources", `${o.name}.icns`), pngToIcns(await readFile(png)));
  }
  await writeFile(join(contents, "Info.plist"), infoPlist({ name: o.name, title: o.title, icon: Boolean(png) }));
  const script = join(contents, "MacOS", o.name);
  await writeFile(
    script,
    `#!/bin/sh\nexec ${withPath([...o.command, "open"], o.host)
      .map(shQuote)
      .join(" ")}\n`
  );
  await chmod(script, 0o755);
  return { paths: [app] };
}

/** An argument on a Windows command line. */
export const winArg = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
const psQuote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** A script that runs `command` with no window at all — a shortcut can only minimize one. */
export function hiddenRunner(command: string): string {
  return `CreateObject("WScript.Shell").Run "${command.replace(/"/g, '""')}", 0, False\r\n`;
}

/**
 * The command a WSL shortcut runs: the app in the distribution, with no shell in between (`--exec`:
 * a shell would expand `$` and backticks in paths). `--wait` keeps it running while the server
 * does — WSL stops a distribution once nothing Windows started in it runs any more.
 */
export function wslCommand(distro: string, argv: readonly string[]): string {
  return ["wsl.exe", "-d", distro, "--cd", "~", "--exec", ...argv, "open", "--wait"].map(winArg).join(" ");
}

/** Runs PowerShell (from WSL or Windows) — its output's lines. */
async function powershell(lines: string[]): Promise<string[]> {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", lines.join("; ")], {
    windowsHide: true,
  });
  return stdout.trim().split(/\r?\n/);
}

/** A Windows path as WSL sees it. */
async function fromWindows(path: string): Promise<string> {
  const { stdout } = await run("wslpath", ["-u", path]);
  return stdout.trim();
}

/**
 * Windows (from WSL or Windows itself): a Start menu shortcut that runs a hidden script — no
 * console window, no taskbar entry — with the app's icon. The script and the icon live in
 * `%LOCALAPPDATA%\<name>\menu`; without its own icon a shortcut shows its target's (Windows Script Host's).
 */
async function windows(o: InstallOptions): Promise<Installed> {
  const [programs, local] = await powershell([
    "[Environment]::GetFolderPath('Programs')",
    "[Environment]::GetFolderPath('LocalApplicationData')",
  ]);
  if (!programs || !local) throw new Error("PowerShell didn't say where the Start menu is.");
  const lnk = win32.join(programs, `${o.title}.lnk`);
  // A folder of its own, inside the app's: removing it never touches the running server's record.
  const folder = win32.join(local, o.name, "menu");
  const vbs = win32.join(folder, `${o.name}.vbs`);
  const ico = win32.join(folder, `${o.name}.ico`);
  // Written from here: WSL reaches Windows' disk under /mnt.
  const here = (path: string) => (o.host.wsl ? fromWindows(path) : Promise.resolve(path));
  if (o.remove) {
    await rm(await here(folder), { recursive: true, force: true });
    await rm(await here(lnk), { force: true });
    return { paths: [lnk, folder] };
  }
  let command: string;
  if (o.host.wsl) {
    const distro = o.host.env.WSL_DISTRO_NAME;
    if (!distro) throw new Error("WSL_DISTRO_NAME isn't set, so the shortcut wouldn't know the distribution.");
    command = wslCommand(distro, withPath(o.command, o.host));
  } else {
    command = [...o.command, "open"].map(winArg).join(" ");
  }
  await mkdir(await here(folder), { recursive: true });
  await writeFile(await here(vbs), hiddenRunner(command), "latin1");
  const png = o.icon?.png;
  if (png) await writeFile(await here(ico), pngToIco(await readFile(png)));
  await powershell([
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(lnk)})`,
    `$s.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'`,
    `$s.Arguments = ${psQuote(`"${vbs}"`)}`,
    `$s.Description = ${psQuote(o.description)}`,
    ...(png ? [`$s.IconLocation = ${psQuote(`${ico},0`)}`] : []),
    "$s.Save()",
  ]);
  return { paths: [lnk, vbs, ...(png ? [ico] : [])] };
}

/** Adds the app to the system's app menu — or removes it again. */
export function install(o: InstallOptions): Promise<Installed> {
  for (const file of [o.icon?.png, o.icon?.svg])
    if (file && ![".png", ".svg"].includes(extname(file).toLowerCase()))
      return Promise.reject(new Error(`the icon must be a .png or .svg file: ${file}`));
  if (o.host.platform === "darwin") return mac(o);
  if (o.host.platform === "win32" || o.host.wsl) return windows(o);
  if (o.host.platform === "linux") return linux(o);
  return Promise.reject(new Error(`Adding to the app menu isn't supported on ${o.host.platform} yet.`));
}
