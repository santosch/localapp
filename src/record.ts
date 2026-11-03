import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The running server, written down so a later launch reuses it and `stop` finds it. It holds the
 * server's key, so only this user may read it (mode 0600).
 */
export interface ServerRecord {
  pid: number;
  port: number;
  /** The per-launch key the server asks for (empty when the app runs without one). */
  key: string;
}

export const recordFile = (dir: string) => join(dir, "server.json");

export async function writeRecord(dir: string, record: ServerRecord): Promise<void> {
  const path = recordFile(dir);
  await mkdir(dirname(path), { recursive: true });
  // Written aside and moved in, so a reader never sees half of it.
  const partial = `${path}.${process.pid}`;
  await writeFile(partial, JSON.stringify(record), { mode: 0o600 });
  await rename(partial, path);
}

export async function readRecord(dir: string): Promise<ServerRecord | null> {
  try {
    const { pid, port, key } = JSON.parse(await readFile(recordFile(dir), "utf8")) as Partial<ServerRecord>;
    return typeof pid === "number" && typeof port === "number" && typeof key === "string" ? { pid, port, key } : null;
  } catch {
    return null;
  }
}

/** Removes the record if it is this server's — another may have started since. */
export async function removeRecord(dir: string, pid: number): Promise<void> {
  if ((await readRecord(dir))?.pid === pid) await rm(recordFile(dir), { force: true });
}
