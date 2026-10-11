// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import * as bmp from "bmp-ts";
import { GifWriter } from "omggif";
import { generatePNG, scan, scanImage } from "../src/node";

const CASES = [["pdf417", "PDF417 reversed"], ["ean13", "5901234123457"], ["code128", "REVERSED-128"], ["databar", "(01)09521234543213"]] as const;
function encode(image: PNG, format: string): Buffer {
  if (format === "png") return PNG.sync.write(image, { colorType: 0 });
  if (format === "jpeg") return jpeg.encode(image, 100).data;
  if (format === "bmp") {
    const data = Buffer.alloc(image.data.length);
    for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = image.data[i + 2]!; data[i + 2] = image.data[i + 1]!; data[i + 3] = image.data[i]!; }
    return bmp.encode({ width: image.width, height: image.height, data }).data;
  }
  const pixels = new Uint8Array(image.width * image.height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = image.data[i * 4]! > 128 ? 1 : 0;
  const buffer = Buffer.alloc(pixels.length * 2 + 4096);
  const writer = new GifWriter(buffer, image.width, image.height, { palette: [0x000000, 0xffffff] });
  writer.addFrame(0, 0, image.width, image.height, Array.from(pixels));
  return buffer.subarray(0, writer.end());
}

describe("reversed reflectance", () => {
  for (const [symbology, data] of CASES) for (const rotate of [0, 90, 180, 270] as const) {
    it(`${symbology} rotation ${rotate}`, async () => {
      const bytes = await generatePNG(data, { symbology, rotate, scale: 4, foreground: "#ffffff", background: "#000000" });
      const original = Buffer.from(bytes);
      expect(await scan(bytes, { symbologies: [symbology] })).toMatchObject([{ symbology, data }]);
      expect(bytes).toEqual(original);
    });
  }
  for (const format of ["png", "jpeg", "bmp", "gif"]) {
    it(`decodes inverted ${format} encoded images`, async () => {
      const bytes = encode(PNG.sync.read(await generatePNG("FORMATS-128", { symbology: "code128", scale: 4, foreground: "#ffffff", background: "#000000" })), format);
      const padded = Buffer.concat([Buffer.from([7, 8]), bytes, Buffer.from([9])]);
      const input = padded.subarray(2, padded.length - 1);
      const original = Buffer.from(padded);
      for (const value of [input, input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), new Blob([input])]) {
        expect(await scanImage(value, { symbologies: ["code128"] })).toMatchObject([{ data: "FORMATS-128" }]);
      }
      expect(padded).toEqual(original);
    });
  }
  it("inverts with default and explicit all-symbology selection", async () => {
    const bytes = await generatePNG("DEFAULT-128", { symbology: "code128", foreground: "#ffffff", background: "#000000" });
    for (const options of [{}, { symbologies: "all" }]) {
      expect(await scan(bytes, options)).toMatchObject([{ data: "DEFAULT-128" }]);
    }
  });
  it("allows callers to disable inversion", async () => {
    const bytes = await generatePNG("DISABLED-128", { symbology: "code128", foreground: "#ffffff", background: "#000000" });
    expect(await scan(bytes, { symbologies: ["code128"], tryInvert: false })).toEqual([]);
  });
  it("keeps identical payloads at separate positions in a mixed-polarity image and applies the combined limit", async () => {
    const normal = PNG.sync.read(await generatePNG("SAME-128", { symbology: "code128", scale: 4 }));
    const mixed = new PNG({ width: normal.width * 2 + 80, height: normal.height + 40 });
    mixed.data.fill(128);
    for (let i = 3; i < mixed.data.length; i += 4) mixed.data[i] = 255;
    for (let y = 0; y < normal.height; y++) for (let x = 0; x < normal.width; x++) for (let c = 0; c < 4; c++) {
      const value = normal.data[(y * normal.width + x) * 4 + c]!;
      mixed.data[((y + 20) * mixed.width + x + 20) * 4 + c] = value;
      mixed.data[((y + 20) * mixed.width + x + normal.width + 60) * 4 + c] = c === 3 ? value : 255 - value;
    }
    const bytes = PNG.sync.write(mixed);
    const found = await scan(bytes, { symbologies: ["code128"], maxResults: 2 });
    expect(found).toHaveLength(2);
    expect(found.map(x => x.data)).toEqual(["SAME-128", "SAME-128"]);
    expect(found[0]!.location.topLeft.x).toBeLessThan(normal.width);
    expect(found[1]!.location.topLeft.x).toBeGreaterThan(normal.width);
    expect(await scan(bytes, { symbologies: ["code128"], maxResults: 1 })).toHaveLength(1);
  });
});
