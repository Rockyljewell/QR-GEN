// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { Raster } from "./engine/inversion.js";
import { decodeOnMainThread } from "./engine/decoder.js";
import { toBarcodes } from "./engine/convert.js";
import type { DecodeParams } from "./engine/protocol.js";
import { QRGenError } from "./errors.js";
import { ALL_SYMBOLOGIES, resolveSymbologies, toZXingReadFormats, type SymbologyInput } from "./symbologies.js";
import type { Barcode } from "./types.js";

export interface ScanImageOptions {
  /** Symbology ids, aliases or groups. Default: all. */
  symbologies?: SymbologyInput[] | string;
  /** Maximum number of codes to return. Default 255. */
  maxResults?: number;
  /** Spend more CPU to find damaged, tiny or rotated codes. Default true. */
  tryHarder?: boolean;
  /** Search reversed-reflectance barcodes. Default true; may add one decode pass. */
  tryInvert?: boolean;
}

export type ImageInput =
  | Blob
  | File
  | ArrayBuffer
  | Uint8Array
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas
  | string;

function hasDOM(): boolean {
  return typeof document !== "undefined";
}

/** Drawn pixels, plus the same pixels composited on black when the source has transparency. */
interface Drawn { image: ImageData; onBlack?: ImageData }

function drawToImageData(source: CanvasImageSource, width: number, height: number): Drawn {
  if (!width || !height) throw new QRGenError("bad-request", "The image has no size yet (is it loaded?).");
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new QRGenError("unsupported", "Canvas 2D is not available.");
  ctx.drawImage(source, 0, 0, width, height);
  const raw = ctx.getImageData(0, 0, width, height);
  const d = raw.data;
  let i = 3;
  while (i < d.length && d[i] === 255) i += 4;
  if (i >= d.length) return { image: raw };
  // Canvas discards RGB under zero alpha. Composite on white so transparent quiet
  // zones of dark codes remain readable, matching Python images. Light codes on
  // transparency vanish on white, so also keep a composite on black.
  const white = new Uint8ClampedArray(d.length);
  const black = new Uint8ClampedArray(d.length);
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3]!;
    for (let c = p; c < p + 3; c++) {
      black[c] = (d[c]! * a) / 255;
      white[c] = black[c]! + 255 - a;
    }
    white[p + 3] = black[p + 3] = 255;
  }
  return { image: new ImageData(white, width, height), onBlack: new ImageData(black, width, height) };
}

/** Formats the built-in (stb_image) decoder understands, identified by magic bytes. */
function builtinFormat(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b[0] === 0x50 && b[1]! >= 0x31 && b[1]! <= 0x36) return "pnm";
  if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) return "psd";
  return null;
}

function describeUnsupported(b: Uint8Array): string {
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "SVG images are not supported; render them to PNG first";
  if (head.startsWith("%PDF")) return "PDF files are not supported; convert the page to PNG first";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "WebP is only supported in browsers; convert it to PNG or JPEG in Node.js";
  return "Unsupported or corrupt image (use PNG, JPEG, GIF, BMP or PNM)";
}

/** In browsers, decode any format the browser supports (WebP, AVIF, HEIC…) through createImageBitmap. */
type EncodedRasterDecoder = (bytes: Uint8Array) => Promise<Raster | null>;
let encodedRasterDecoder: EncodedRasterDecoder | null = null;
/** Internal runtime adapter registered only by qrgen-sdk/node. */
export function registerEncodedRasterDecoder(decoder: EncodedRasterDecoder): void { encodedRasterDecoder = decoder; }

async function browserDecode(blob: Blob): Promise<Drawn | null> {
  if (!hasDOM() || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(blob);
    try { return drawToImageData(bmp, bmp.width, bmp.height); }
    finally { bmp.close?.(); }
  } catch {
    return null;
  }
}

async function toDecodable(input: ImageInput): Promise<{ data: Uint8Array | ImageData; width: number; height: number; onBlack?: ImageData }> {
  if (typeof input === "string") {
    const isUrl = input.startsWith("data:") || /^(https?:|blob:)/.test(input);
    if (!hasDOM() && !isUrl) {
      throw new QRGenError("bad-request", `"${input.slice(0, 80)}" is not a URL. In Node.js use scanFile(path) from qrgen-sdk/node.`);
    }
    let res: Response;
    try {
      res = await fetch(input);
    } catch (err) {
      throw new QRGenError("bad-request", `Could not fetch image ${input.slice(0, 80)}: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (!res.ok) {
      // A rejected response can still be streaming; release its connection.
      try { await res.body?.cancel(); } catch { /* Preserve the HTTP error. */ }
      throw new QRGenError("bad-request", `Could not fetch image ${input.slice(0, 80)}: HTTP ${res.status}`);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch (err) {
      throw new QRGenError("bad-request", `Could not read image response ${input.slice(0, 80)}: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    return toDecodable(new Uint8Array(bytes));
  }
  if ((input instanceof ArrayBuffer || input instanceof Uint8Array || (typeof Blob !== "undefined" && input instanceof Blob)) && !(typeof ImageData !== "undefined" && input instanceof ImageData)) {
    let bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(await (input as Blob).slice(0, 1024).arrayBuffer());
    if (!bytes.length) throw new QRGenError("bad-request", "The image is empty.");
    // Normalize browser images once so both polarities share the same EXIF
    // orientation, pixels, and actual frame dimensions.
    const blob = typeof Blob !== "undefined" ? (input instanceof Blob ? input : new Blob([input as BlobPart])) : null;
    const decoded = blob ? await browserDecode(blob) : null;
    if (decoded) return { data: decoded.image, width: decoded.image.width, height: decoded.image.height, onBlack: decoded.onBlack };
    if (!builtinFormat(bytes)) throw new QRGenError("bad-request", describeUnsupported(bytes));
    // The SOF of a JPEG can follow arbitrarily many metadata segments. Reuse
    // one full Blob read for header inspection, ZXing and any raster fallback.
    if (typeof Blob !== "undefined" && input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer());
    return { data: bytes, width: 0, height: 0 };
  }
  if (typeof ImageData !== "undefined" && input instanceof ImageData) return { data: input, width: input.width, height: input.height };
  if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
    if (!input.complete) await input.decode();
    const { image: d, onBlack } = drawToImageData(input, input.naturalWidth, input.naturalHeight);
    return { data: d, width: d.width, height: d.height, onBlack };
  }
  if (typeof HTMLVideoElement !== "undefined" && input instanceof HTMLVideoElement) {
    const { image: d, onBlack } = drawToImageData(input, input.videoWidth, input.videoHeight);
    return { data: d, width: d.width, height: d.height, onBlack };
  }
  const src = input as HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
  const { image: d, onBlack } = drawToImageData(src, src.width, src.height);
  return { data: d, width: d.width, height: d.height, onBlack };
}

/** Image size from supported encoded headers, without a second pixel decode. */
function sniffSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      if (dv.getUint32(14, true) === 12) return { width: dv.getUint16(18, true), height: dv.getUint16(20, true) };
      return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
    }
    if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) {
      return { width: dv.getUint32(18), height: dv.getUint32(14) };
    }
    if (bytes[0] === 0x50 && (bytes[1] === 0x35 || bytes[1] === 0x36)) {
      let i = 2;
      const number = () => {
        while (i < bytes.length) {
          const c = bytes[i]!;
          if (c === 0x23) {
            while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
          } else if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) i++;
          else break;
        }
        const start = i;
        let value = 0;
        while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) value = value * 10 + bytes[i++]! - 0x30;
        return i > start && Number.isSafeInteger(value) ? value : 0;
      };
      return { width: number(), height: number() };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i++] !== 0xff) continue;
        while (bytes[i] === 0xff) i++; // Legal fill bytes before a marker.
        const marker = bytes[i++];
        if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
        if (i + 2 > bytes.length) break;
        const len = dv.getUint16(i);
        if (len < 2 || i + len > bytes.length) break;
        if (len >= 8 && marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: dv.getUint16(i + 5), height: dv.getUint16(i + 3) };
        }
        i += len;
      }
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

/**
 * Scan barcodes in an image: a File from an <input type="file">, a Blob, image bytes,
 * a URL, an <img>, <canvas>, <video> frame, ImageBitmap or ImageData.
 *
 * ```ts
 * const barcodes = await scanImage(fileInput.files[0], { symbologies: ["qr", "ean13"] });
 * ```
 */
export async function scanImage(input: ImageInput, options: ScanImageOptions = {}): Promise<Barcode[]> {
  const ids = resolveSymbologies(options.symbologies);
  const { data, width, height, onBlack } = await toDecodable(input);
  let size = { width, height };
  if (!size.width && data instanceof Uint8Array) size = sniffSize(data);
  const params: DecodeParams = {
    formats: toZXingReadFormats(ids),
    tryHarder: options.tryHarder ?? true,
    tryRotate: true,
    tryInvert: options.tryInvert ?? true,
    tryDownscale: true,
    maxNumberOfSymbols: Math.max(1, Math.min(255, options.maxResults ?? 255)),
  };
  let raws = await decodeOnMainThread(data, params, async () => {
    return encodedRasterDecoder && data instanceof Uint8Array ? encodedRasterDecoder(data) : null;
  });
  // Only when nothing was found on white: light modules on a transparent background.
  if (!raws.length && onBlack) raws = await decodeOnMainThread(onBlack, params);
  const requested = ids.length === ALL_SYMBOLOGIES.length ? undefined : new Set(ids);
  return toBarcodes(raws, { frameSize: size, requested });
}
