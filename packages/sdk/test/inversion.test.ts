// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import * as bmp from "bmp-ts";
import { GifWriter } from "omggif";
import { generatePNG, scan, scanImage, SYMBOLOGIES } from "../src/node";
import { registerEncodedRasterDecoder } from "../src/image";
import { decodeNodeRaster } from "../src/node/raster";

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
  /** Two copies of SAME-128 side by side on grey; each copy normal or inverted. */
  async function pair(left: "normal" | "inverted", right: "normal" | "inverted") {
    const normal = PNG.sync.read(await generatePNG("SAME-128", { symbology: "code128", scale: 4 }));
    const image = new PNG({ width: normal.width * 2 + 80, height: normal.height + 40 });
    image.data.fill(128);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    for (let y = 0; y < normal.height; y++) for (let x = 0; x < normal.width; x++) for (let c = 0; c < 4; c++) {
      const value = normal.data[(y * normal.width + x) * 4 + c]!;
      const paint = (polarity: string) => (c === 3 || polarity === "normal" ? value : 255 - value);
      image.data[((y + 20) * image.width + x + 20) * 4 + c] = paint(left);
      image.data[((y + 20) * image.width + x + normal.width + 60) * 4 + c] = paint(right);
    }
    return { bytes: PNG.sync.write(image), codeWidth: normal.width };
  }
  it("returns only the normal code from a mixed-polarity image: the inverted pass is a fallback", async () => {
    const { bytes, codeWidth } = await pair("normal", "inverted");
    const found = await scan(bytes, { symbologies: ["code128"], maxResults: 2 });
    expect(found.map(x => x.data)).toEqual(["SAME-128"]);
    expect(found[0]!.location.topLeft.x).toBeLessThan(codeWidth);
  });
  it("keeps identical inverted payloads at separate positions and applies the limit", async () => {
    const { bytes, codeWidth } = await pair("inverted", "inverted");
    const found = await scan(bytes, { symbologies: ["code128"], maxResults: 2 });
    expect(found.map(x => x.data)).toEqual(["SAME-128", "SAME-128"]);
    const xs = found.map(x => x.location.topLeft.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(codeWidth);
    expect(xs[1]).toBeGreaterThan(codeWidth);
    expect(await scan(bytes, { symbologies: ["code128"], maxResults: 1 })).toHaveLength(1);
  });
  it("decodes encoded pixels in JS only when the normal pass found nothing", async () => {
    const decoder = vi.fn(decodeNodeRaster);
    registerEncodedRasterDecoder(decoder);
    try {
      const normal = await generatePNG("FAST-128", { symbology: "code128", scale: 4 });
      expect(await scan(normal)).toMatchObject([{ data: "FAST-128" }]);
      expect(await scan(normal, { symbologies: ["code128", "ean13"], maxResults: 10 })).toMatchObject([{ data: "FAST-128" }]);
      expect(decoder).not.toHaveBeenCalled();
      const inverted = await generatePNG("SLOW-128", { symbology: "code128", scale: 4, foreground: "#ffffff", background: "#000000" });
      expect(await scan(inverted)).toMatchObject([{ data: "SLOW-128" }]);
      expect(decoder).toHaveBeenCalledOnce();
    } finally {
      registerEncodedRasterDecoder(decodeNodeRaster);
    }
  });
  // Every writable format the explicit pass covers (all but QR, Data Matrix and Aztec,
  // which the engine inverts itself), from an image holding only the inverted code.
  const NATIVE = new Set(["qr", "micro-qr", "rmqr", "data-matrix", "aztec"]);
  for (const s of SYMBOLOGIES.filter(s => !NATIVE.has(s.id))) {
    it(`decodes an inverted-only ${s.id} image`, async () => {
      const options = { symbology: s.id, scale: 4, gs1: s.example.startsWith("(") };
      const [expected] = await scan(await generatePNG(s.example, options), { symbologies: [s.id] });
      expect(expected).toBeDefined();
      const found = await scan(await generatePNG(s.example, { ...options, foreground: "#ffffff", background: "#000000" }), { symbologies: [s.id] });
      expect(found).toMatchObject([{ symbology: s.id, data: expected!.data }]);
    });
  }
});
