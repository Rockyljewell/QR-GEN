// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

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

function drawToImageData(source: CanvasImageSource, width: number, height: number): ImageData {
  if (!width || !height) throw new QRGenError("bad-request", "The image has no size yet (is it loaded?).");
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new QRGenError("unsupported", "Canvas 2D is not available.");
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
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
async function browserDecode(blob: Blob): Promise<ImageData | null> {
  if (!hasDOM() || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(blob);
    const d = drawToImageData(bmp, bmp.width, bmp.height);
    bmp.close?.();
    return d;
  } catch {
    return null;
  }
}

async function toDecodable(input: ImageInput): Promise<{ data: Blob | ArrayBuffer | Uint8Array | ImageData; width: number; height: number }> {
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
    if (!res.ok) throw new QRGenError("bad-request", `Could not fetch image ${input.slice(0, 80)}: HTTP ${res.status}`);
    return toDecodable(new Uint8Array(await res.arrayBuffer()));
  }
  if ((input instanceof ArrayBuffer || input instanceof Uint8Array || (typeof Blob !== "undefined" && input instanceof Blob)) && !(typeof ImageData !== "undefined" && input instanceof ImageData)) {
    const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(await (input as Blob).slice(0, 1024).arrayBuffer());
    if (!bytes.length) throw new QRGenError("bad-request", "The image is empty.");
    if (!builtinFormat(bytes)) {
      const blob = typeof Blob !== "undefined" ? (input instanceof Blob ? input : new Blob([input as BlobPart])) : null;
      const decoded = blob ? await browserDecode(blob) : null;
      if (decoded) return { data: decoded, width: decoded.width, height: decoded.height };
      throw new QRGenError("bad-request", describeUnsupported(bytes));
    }
  }
  if (typeof ImageData !== "undefined" && input instanceof ImageData) return { data: input, width: input.width, height: input.height };
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) return { data: input, width: 0, height: 0 };
  if (typeof Blob !== "undefined" && input instanceof Blob) return { data: input, width: 0, height: 0 };
  if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
    if (!input.complete) await input.decode();
    const d = drawToImageData(input, input.naturalWidth, input.naturalHeight);
    return { data: d, width: d.width, height: d.height };
  }
  if (typeof HTMLVideoElement !== "undefined" && input instanceof HTMLVideoElement) {
    const d = drawToImageData(input, input.videoWidth, input.videoHeight);
    return { data: d, width: d.width, height: d.height };
  }
  const src = input as HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
  const d = drawToImageData(src, src.width, src.height);
  return { data: d, width: d.width, height: d.height };
}

/** Image size from PNG/JPEG/GIF/BMP headers, so results carry a frameSize without decoding twice. */
function sniffSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1]!;
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
        }
        i += 2 + len;
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
  const { data, width, height } = await toDecodable(input);
  let size = { width, height };
  if (!size.width) {
    const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await (data as Blob).slice(0, 65536).arrayBuffer());
    size = sniffSize(bytes);
  }
  const params: DecodeParams = {
    formats: toZXingReadFormats(ids),
    tryHarder: options.tryHarder ?? true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: Math.max(1, Math.min(255, options.maxResults ?? 255)),
  };
  const raws = await decodeOnMainThread(data, params);
  const requested = ids.length === ALL_SYMBOLOGIES.length ? undefined : new Set(ids);
  return toBarcodes(raws, { frameSize: size, requested });
}
