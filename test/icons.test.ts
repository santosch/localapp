import { describe, expect, it } from "vitest";
import { pngSize, pngToIcns, pngToIco } from "../src/icons.ts";
import { png } from "./helpers.ts";

describe("the app's icon", () => {
  it("reads a PNG's size, and refuses what isn't one", () => {
    expect(pngSize(png(256, 128))).toEqual({ width: 256, height: 128 });
    expect(() => pngSize(Buffer.from("<svg/>"))).toThrow(/isn't a PNG/);
  });

  it("becomes a Windows icon holding the PNG as it is (256 written as 0)", () => {
    const image = png(256);
    const ico = pngToIco(image);
    expect(ico.readUInt16LE(2)).toBe(1); // an icon
    expect(ico.readUInt16LE(4)).toBe(1); // one image
    expect([ico[6], ico[7]]).toEqual([0, 0]);
    expect(ico.readUInt32LE(14)).toBe(image.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22).equals(image)).toBe(true);
    expect(pngToIco(png(48))[6]).toBe(48);
    expect(() => pngToIco(png(512))).toThrow(/at most 256×256/);
  });

  it("becomes a macOS icon with the PNG under its size's type", () => {
    const image = png(512);
    const icns = pngToIcns(image);
    expect(icns.toString("latin1", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString("latin1", 8, 12)).toBe("ic09");
    expect(icns.readUInt32BE(12)).toBe(8 + image.length);
    expect(icns.subarray(16).equals(image)).toBe(true);
    expect(() => pngToIcns(png(300))).toThrow(/square, 16, 32/);
    expect(() => pngToIcns(png(256, 128))).toThrow(/square/);
  });
});
