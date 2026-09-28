// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Node.js, Bun and Deno entry: loads the engine from the local package (no network)
 * and adds file helpers.
 *
 * ```ts
 * import { scanFile, generateToFile } from "qrgen-sdk/node";
 * const codes = await scanFile("label.png");
 * await generateToFile("https://example.com", "qr.svg");
 * ```
 */
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { configure, getConfig } from "../engine/config.js";
import { generate, registerPngColorizer, type GenerateOptions, type GeneratedBarcode } from "../generator.js";
import { scanImage, type ScanImageOptions } from "../image.js";
import type { Barcode } from "../types.js";

export * from "../index.js";

let loaded = false;

/** Load the wasm binaries from node_modules. Called automatically by the helpers below. */
export function useLocalEngine(): void {
  if (loaded) return;
  const cfg = getConfig();
  const req = createRequire(import.meta.url);
  const read = (spec: string) => {
    const buf = readFileSync(req.resolve(spec));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  configure({
    readerWasmBinary: cfg.readerWasmBinary ?? read("zxing-wasm/reader/zxing_reader.wasm"),
    writerWasmBinary: cfg.writerWasmBinary ?? read("zxing-wasm/writer/zxing_writer.wasm"),
    worker: false,
  });
  loaded = true;
}

useLocalEngine();
registerPngColorizer(recolorPng);

function parseColor(c: string): [number, number, number, number] {
  const t = c.trim().toLowerCase();
  if (t === "transparent" || t === "none") return [255, 255, 255, 0];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (!m) throw new Error(`Unsupported color "${c}" (use #rgb, #rrggbb, #rrggbbaa or transparent)`);
  let h = m[1]!;
  if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Decode a (non-interlaced) PNG, map dark pixels to `fg` and light pixels to `bg`, re-encode as RGBA. */
function recolorPng(png: Uint8Array, fg: string, bg: string): Uint8Array {
  const buf = Buffer.from(png);
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (t === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      type = data[9]!;
      if (data[12] !== 0) throw new Error("interlaced PNG");
    } else if (t === "PLTE") palette = data;
    else if (t === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels || (depth !== 8 && !(depth < 8 && (type === 0 || type === 3)))) throw new Error("unsupported PNG layout");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      if (f === 1) line[i] = (line[i]! + a) & 255;
      else if (f === 2) line[i] = (line[i]! + b) & 255;
      else if (f === 3) line[i] = (line[i]! + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(lines, y * stride);
    prev = line;
  }
  const F = parseColor(fg);
  const B = parseColor(bg);
  const out = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let lum: number;
      if (depth < 8) {
        const bit = x * depth;
        const v = (lines[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        lum = type === 3 && palette ? palette[v * 3]! : (v * 255) / ((1 << depth) - 1);
      } else {
        const o = y * stride + x * channels;
        lum = type === 3 && palette ? palette[lines[o]! * 3]! : type === 2 || type === 6 ? (lines[o]! + lines[o + 1]! + lines[o + 2]!) / 3 : lines[o]!;
      }
      const c = lum < 128 ? F : B;
      c.forEach((v, i) => (out[y * (width * 4 + 1) + 1 + x * 4 + i] = v));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([buf.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(out)), chunk("IEND", Buffer.alloc(0))]);
}

/** Scan a PNG/JPEG/GIF/BMP file. */
export async function scanFile(path: string, options?: ScanImageOptions): Promise<Barcode[]> {
  useLocalEngine();
  return scanImage(new Uint8Array(await readFile(path)), options);
}

/** Scan a file path, Buffer, Uint8Array or ArrayBuffer. */
export async function scan(input: string | Uint8Array | ArrayBuffer, options?: ScanImageOptions): Promise<Barcode[]> {
  if (typeof input === "string") return scanFile(input, options);
  useLocalEngine();
  return scanImage(input, options);
}

/** Generate a barcode and return PNG bytes (honours foreground/background). */
export async function generatePNG(data: string, options?: GenerateOptions): Promise<Buffer> {
  useLocalEngine();
  const out = await generate(data, options);
  if (!out.png) throw new Error("PNG output is not available in this runtime");
  return Buffer.from(await out.png.arrayBuffer());
}

/** Generate a barcode and write it to `path` (.svg, .png or .txt, chosen by extension). */
export async function generateToFile(data: string, path: string, options?: GenerateOptions): Promise<GeneratedBarcode> {
  useLocalEngine();
  const out = await generate(data, options);
  const ext = extname(path).toLowerCase();
  if (ext === ".png") {
    if (!out.png) throw new Error("PNG output is not available in this runtime");
    await writeFile(path, Buffer.from(await out.png.arrayBuffer()));
  } else if (ext === ".txt") {
    await writeFile(path, out.text);
  } else {
    await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>\n${out.svg}\n`);
  }
  return out;
}
