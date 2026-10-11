// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { generatePNG, scanImage } from "../src/node";

const DATA = "ENCODED-IMAGE-DIMENSIONS";
let image: PNG;
let png: Buffer;

function pnm(kind: "P5" | "P6", comments: boolean): Buffer {
  const channels = kind === "P5" ? 1 : 3;
  const pixels = Buffer.alloc(image.width * image.height * channels);
  for (let i = 0; i < image.width * image.height; i++) {
    for (let c = 0; c < channels; c++) pixels[i * channels + c] = image.data[i * 4 + c]!;
  }
  const header = comments
    ? `${kind}\t# before width\r\n ${image.width}\n# before height\n\t${image.height}\f255\n`
    : `${kind}\n${image.width} ${image.height}\n255\n`;
  return Buffer.concat([Buffer.from(header), pixels]);
}

function psd(): Buffer {
  // Version 1 RGB PSD, 8 bits/channel, uncompressed planar pixels. The color
  // mode, image resource and layer/mask sections are empty (four zero bytes each).
  const header = Buffer.alloc(40);
  header.write("8BPS");
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12);
  header.writeUInt32BE(image.height, 14);
  header.writeUInt32BE(image.width, 18);
  header.writeUInt16BE(8, 22);
  header.writeUInt16BE(3, 24);
  const pixels = Buffer.alloc(image.width * image.height * 3);
  for (let c = 0; c < 3; c++) for (let i = 0; i < image.width * image.height; i++) {
    pixels[c * image.width * image.height + i] = image.data[i * 4 + c]!;
  }
  return Buffer.concat([header, pixels]);
}

describe("encoded image dimensions", () => {
  beforeAll(async () => {
    const square = PNG.sync.read(await generatePNG(DATA, { symbology: "qr", scale: 5 }));
    image = new PNG({ width: square.width + 20, height: square.height + 10 });
    image.data.fill(255);
    for (let y = 0; y < square.height; y++) {
      square.data.copy(image.data, ((y + 5) * image.width + 10) * 4, y * square.width * 4, (y + 1) * square.width * 4);
    }
    png = PNG.sync.write(image);
  });

  for (const kind of ["P5", "P6"] as const) for (const comments of [false, true]) {
    it(`reports ${kind} dimensions${comments ? " with comments and whitespace" : ""}`, async () => {
      expect(await scanImage(pnm(kind, comments), { symbologies: ["qr"] })).toMatchObject([
        { data: DATA, frameSize: { width: image.width, height: image.height } },
      ]);
    });
  }

  it("reports dimensions of an accepted PSD image", async () => {
    expect(await scanImage(psd(), { symbologies: ["qr"] })).toMatchObject([
      { data: DATA, frameSize: { width: image.width, height: image.height } },
    ]);
  });

  it("reports JPEG Blob dimensions when its SOF follows more than 64KiB of metadata", async () => {
    const jpg = jpeg.encode(image, 100).data;
    const app2 = Buffer.alloc(60004);
    app2[0] = 0xff;
    app2[1] = 0xe2;
    app2.writeUInt16BE(60002, 2);
    const bytes = Buffer.concat([jpg.subarray(0, 2), app2, app2, jpg.subarray(2)]);
    const expected = { data: DATA, frameSize: { width: image.width, height: image.height } };
    expect(await scanImage(bytes, { symbologies: ["qr"] })).toMatchObject([expected]);
    expect(await scanImage(new Blob([bytes]), { symbologies: ["qr"] })).toMatchObject([expected]);
  });

  it("reports JPEG dimensions with marker fill bytes", async () => {
    const jpg = jpeg.encode(image, 100).data;
    const bytes = Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), jpg.subarray(2)]);
    expect(await scanImage(bytes, { symbologies: ["qr"] })).toMatchObject([
      { data: DATA, frameSize: { width: image.width, height: image.height } },
    ]);
  });

  it("reports OS/2 BMP dimensions from the 12-byte DIB header", async () => {
    const stride = (image.width * 3 + 3) & ~3;
    const bytes = Buffer.alloc(26 + stride * image.height);
    bytes.write("BM");
    bytes.writeUInt32LE(bytes.length, 2);
    bytes.writeUInt32LE(26, 10);
    bytes.writeUInt32LE(12, 14);
    bytes.writeUInt16LE(image.width, 18);
    bytes.writeUInt16LE(image.height, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt16LE(24, 24);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) for (let c = 0; c < 3; c++) {
      bytes[26 + (image.height - y - 1) * stride + x * 3 + c] = image.data[(y * image.width + x) * 4 + 2 - c]!;
    }
    expect(await scanImage(bytes, { symbologies: ["qr"] })).toMatchObject([
      { data: DATA, frameSize: { width: image.width, height: image.height } },
    ]);
  });

  it("reuses one full Blob read for header inspection and decoding", async () => {
    const blob = new Blob([new Uint8Array(png)]);
    const read = vi.spyOn(blob, "arrayBuffer");
    expect(await scanImage(blob, { symbologies: ["qr"] })).toMatchObject([{ data: DATA }]);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["PNM", Buffer.from("P6\n# truncated header\n")],
    ["PSD", Buffer.from("8BPS")],
    ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe2, 0, 2])],
  ])("preserves truncated %s empty results", async (_kind, bytes) => {
    expect(await scanImage(bytes)).toEqual([]);
  });
});
