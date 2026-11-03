import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll } from "vitest";
import type { Host } from "../src/host.ts";

/** A temporary folder, removed after the file's tests. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "localapp-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A host to test against: Linux unless patched, with these files present. */
export const host = (patch: Partial<Host> = {}, files: string[] = []): Host => ({
  platform: "linux",
  env: { PATH: "/usr/bin:/bin" },
  wsl: false,
  home: "/home/me",
  exists: (path) => files.includes(path),
  ...patch,
});

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real (all transparent) PNG of this size. */
export function png(width: number, height = width): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
