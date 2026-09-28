// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { getConfig, toArrayBuffer, writerWasmUrl } from "./engine/config.js";
import { QRGenError } from "./errors.js";
import { resolveSymbologies, symbologyInfo, type Symbology, type SymbologyInput } from "./symbologies.js";

export interface GenerateOptions {
  /** Symbology id or alias. Default "qr". */
  symbology?: SymbologyInput;
  /** Module size in pixels (default 4). Negative values fit the symbol to that many pixels. */
  scale?: number;
  /** Error correction level for QR/Micro QR/Aztec/PDF417 ("L" | "M" | "Q" | "H" or a percentage). */
  ecLevel?: "L" | "M" | "Q" | "H" | (string & {});
  /** Encode the data as GS1 (input in HRI form: "(01)09501101530003(10)ABC"). */
  gs1?: boolean;
  /** Print the human readable text under linear barcodes. */
  hrt?: boolean;
  /** Add the quiet zone. Default true. */
  margin?: boolean;
  /** Bar / module color. Default "#000000". */
  foreground?: string;
  /** Background color, or "transparent". Default "#ffffff". */
  background?: string;
  /** Rotation in degrees. */
  rotate?: 0 | 90 | 180 | 270;
  /** Symbol version / size for 2D codes (e.g. QR version 1-40). */
  version?: number;
  /** Extra zxing-cpp creator options, e.g. "columns=6". */
  extraOptions?: string;
}

export interface GeneratedBarcode {
  symbology: Symbology;
  data: string;
  /** Standalone SVG document (no XML prolog), sized in pixels with a viewBox. */
  svg: string;
  /** PNG image (colors applied in browsers and in Node via qrgen-sdk/node). */
  png: Blob | null;
  /** Module matrix: `modules[y * width + x]` is 1 for dark, 0 for light. Excludes the quiet zone. */
  matrix: { width: number; height: number; modules: Uint8Array };
  /** Text rendering for terminals. */
  text: string;
}

type WriterOverrides = { wasmBinary: ArrayBuffer } | { locateFile: (path: string, prefix: string) => string };
let cached: { version: number; overrides: WriterOverrides } | null = null;

function prepareWriter(): void {
  const cfg = getConfig();
  if (!cached || cached.version !== cfg.version) {
    const url = writerWasmUrl();
    cached = {
      version: cfg.version,
      overrides: cfg.writerWasmBinary
        ? { wasmBinary: toArrayBuffer(cfg.writerWasmBinary) }
        : { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? url : prefix + path) },
    };
  }
  prepareZXingModule({ overrides: cached.overrides, fireImmediately: false });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Clean up zint's SVG: drop the prolog, add a viewBox, apply colors. */
export function styleSvg(svg: string, foreground = "#000000", background = "#ffffff"): string {
  let out = svg.replace(/<\?xml[^>]*>\s*/g, "").replace(/<!DOCTYPE[^>]*>\s*/g, "").replace(/<desc>[^<]*<\/desc>\s*/g, "");
  out = out.replace(/<svg([^>]*?)width="([\d.]+)" height="([\d.]+)"/, (_m, pre: string, w: string, h: string) => `<svg${pre}width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`);
  const fg = escapeAttr(foreground);
  const bg = background === "transparent" || background === "none" ? "none" : escapeAttr(background);
  out = out.replace(/fill="#000000"/gi, `fill="${fg}"`).replace(/fill="#FFFFFF"/gi, `fill="${bg}"`);
  return out.trim();
}

// GS1 DataBar is GS1 by definition; the encoder rejects an explicit "gs1" flag for it.
const IMPLICIT_GS1: ReadonlySet<Symbology> = new Set<Symbology>(["databar", "databar-expanded", "databar-limited"]);

function buildOptions(opts: GenerateOptions, symbology: Symbology): string {
  const parts: string[] = [];
  if (opts.gs1 && !IMPLICIT_GS1.has(symbology)) parts.push("gs1");
  if (opts.ecLevel) parts.push(`ecLevel=${opts.ecLevel}`);
  if (opts.version) parts.push(`version=${opts.version}`);
  if (opts.extraOptions) parts.push(opts.extraOptions);
  return parts.join(",");
}

/** Recolors a black/white PNG outside the browser (registered by qrgen-sdk/node). */
export type PngColorizer = (png: Uint8Array, foreground: string, background: string) => Uint8Array;
let pngColorizer: PngColorizer | null = null;

/** @internal Used by qrgen-sdk/node to support colored PNG output without a DOM. */
export function registerPngColorizer(fn: PngColorizer): void {
  pngColorizer = fn;
}

async function renderColoredPng(svg: string, bw: Blob | null, fg: string, bg: string): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    if (!pngColorizer || !bw) return null;
    try {
      const out = pngColorizer(new Uint8Array(await bw.arrayBuffer()), fg, bg);
      return new Blob([out as BlobPart], { type: "image/png" });
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Generate a barcode.
 *
 * ```ts
 * const { svg, png } = await generate("https://example.com", { symbology: "qr", ecLevel: "M" });
 * ```
 */
export async function generate(data: string, options: GenerateOptions = {}): Promise<GeneratedBarcode> {
  const [symbology] = resolveSymbologies(options.symbology ?? "qr");
  if (!symbology || resolveSymbologies(options.symbology ?? "qr").length !== 1) {
    throw new QRGenError("bad-request", `Unknown symbology "${String(options.symbology)}".`);
  }
  const info = symbologyInfo(symbology);
  if (!info.write) throw new QRGenError("unsupported", `${info.name} cannot be generated.`);
  if (typeof data !== "string" || data.length === 0) throw new QRGenError("bad-request", "Nothing to encode: data is empty.");
  prepareWriter();
  let result: Awaited<ReturnType<typeof writeBarcode>>;
  try {
    result = await writeBarcode(data, {
      format: info.write as never,
      scale: options.scale ?? 4,
      rotate: options.rotate ?? 0,
      addHRT: options.hrt ?? false,
      addQuietZones: options.margin ?? true,
      options: buildOptions(options, symbology),
    });
  } catch (err) {
    throw new QRGenError("engine-load-failed", `The barcode generator failed to load: ${err instanceof Error ? err.message : String(err)}`, err);
  }
  if (result.error) {
    const message = result.error.replace(/^Error \d+:\s*/, "").replace(/\s*\(retval: \d+\)$/, "");
    throw new QRGenError("bad-request", `Cannot encode as ${info.name}: ${message}`);
  }
  const fg = options.foreground ?? "#000000";
  const bg = options.background ?? "#ffffff";
  const svg = styleSvg(result.svg, fg, bg);
  const custom = fg.toLowerCase() !== "#000000" || bg.toLowerCase() !== "#ffffff";
  const png = custom ? ((await renderColoredPng(svg, result.image, fg, bg)) ?? result.image) : result.image;
  const sym = result.symbol;
  const modules = new Uint8Array(sym.width * sym.height);
  for (let i = 0; i < modules.length; i++) modules[i] = sym.data[i] === 0 ? 1 : 0;
  return { symbology, data, svg, png, matrix: { width: sym.width, height: sym.height, modules }, text: result.utf8 };
}

/** Generate a barcode and return only the SVG markup. */
export async function generateSVG(data: string, options: GenerateOptions = {}): Promise<string> {
  return (await generate(data, options)).svg;
}

/** Generate a barcode as an SVG data URL (usable as <img src>). */
export async function generateDataURL(data: string, options: GenerateOptions = {}): Promise<string> {
  const svg = await generateSVG(data, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
