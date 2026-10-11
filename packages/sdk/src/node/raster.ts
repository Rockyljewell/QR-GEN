// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import type { Raster } from "../engine/inversion.js";

// These codecs are loaded only when the Node entry needs an inverted encoded
// image. Browser and worker bundles never import this module.
export async function decodeNodeRaster(bytes: Uint8Array): Promise<Raster | null> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Bound allocation before asking any codec to expand attacker-controlled dimensions.
  const check = (width: number, height: number) => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 64_000_000) throw new Error("Image exceeds the 64 megapixel raster fallback limit");
  };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && buffer.length >= 24) {
    check(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
    const { PNG } = await import("pngjs");
    return PNG.sync.read(buffer);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = await import("jpeg-js");
    const image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 64, maxMemoryUsageInMB: 256 });
    check(image.width, image.height);
    return image;
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && buffer.length >= 10) {
    check(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
    const { GifReader } = await import("omggif");
    const image = new GifReader(buffer);
    const data = new Uint8Array(image.width * image.height * 4);
    image.decodeAndBlitFrameRGBA(0, data);
    return { width: image.width, height: image.height, data };
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && buffer.length >= 26) {
    const header = buffer.readUInt32LE(14);
    if (header === 12) check(buffer.readUInt16LE(18), buffer.readUInt16LE(20));
    else check(buffer.readInt32LE(18), Math.abs(buffer.readInt32LE(22)));
    const bmp = await import("bmp-ts");
    return bmp.decode(buffer, { toRGBA: true });
  }
  return null;
}
