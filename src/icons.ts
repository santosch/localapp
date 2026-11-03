/**
 * The app's icon in the formats the menus want, made from one PNG — no image library: Windows'
 * `.ico` and macOS' `.icns` can both hold a PNG as it is, wrapped in a small header.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's width and height (from its header); throws if it isn't a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR")
    throw new Error("the icon isn't a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** A Windows icon (`.ico`) holding the PNG — what a Start menu shortcut shows. Up to 256×256. */
export function pngToIco(png: Buffer): Buffer {
  const { width, height } = pngSize(png);
  if (width > 256 || height > 256)
    throw new Error(`a Windows icon is at most 256×256 pixels, the icon is ${width}×${height}`);
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(width === 256 ? 0 : width, 6); // 0 stands for 256
  header.writeUInt8(height === 256 ? 0 : height, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18); // the image follows the header
  return Buffer.concat([header, png]);
}

/** The `.icns` entry type for a square PNG of each size. */
const ICNS_TYPES: Record<number, string> = {
  16: "icp4",
  32: "icp5",
  64: "icp6",
  128: "ic07",
  256: "ic08",
  512: "ic09",
  1024: "ic10",
};

/** A macOS icon (`.icns`) holding the PNG — what an `.app` shows. Square, 16 to 1024 pixels. */
export function pngToIcns(png: Buffer): Buffer {
  const { width, height } = pngSize(png);
  const type = ICNS_TYPES[width];
  if (width !== height || !type)
    throw new Error(`a macOS icon is square, 16, 32, 64, 128, 256, 512 or 1024 pixels; the icon is ${width}×${height}`);
  const entry = Buffer.alloc(8);
  entry.write(type, 0, "latin1");
  entry.writeUInt32BE(8 + png.length, 4);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "latin1");
  header.writeUInt32BE(8 + 8 + png.length, 4);
  return Buffer.concat([header, entry, png]);
}
