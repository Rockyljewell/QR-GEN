// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { fromZXingFormat, symbologyName, type Symbology } from "../symbologies.js";
import type { Barcode, ContentType, Quadrilateral, Size } from "../types.js";
import { toBase64 } from "../util.js";
import type { RawBarcode } from "./protocol.js";

const CONTENT_TYPES: Record<string, ContentType> = {
  Text: "text",
  Binary: "binary",
  Mixed: "mixed",
  GS1: "gs1",
  ISO15434: "iso15434",
  UnknownECI: "unknown-eci",
};

export interface ConvertOptions {
  frameSize: Size;
  /** Offset of the decoded region inside the full frame (ROI crop). */
  offsetX?: number;
  offsetY?: number;
  /** Scale from decoded-region pixels to full-frame pixels. */
  scale?: number;
  /** Mirror x coordinates (front camera preview). */
  mirror?: boolean;
  timestamp?: number;
  /** Only return these symbologies. */
  requested?: ReadonlySet<Symbology>;
}

function mapQuad(q: Quadrilateral, o: ConvertOptions): Quadrilateral {
  const s = o.scale ?? 1;
  const dx = o.offsetX ?? 0;
  const dy = o.offsetY ?? 0;
  const m = (p: { x: number; y: number }) => {
    const x = dx + p.x * s;
    return { x: o.mirror ? o.frameSize.width - x : x, y: dy + p.y * s };
  };
  return { topLeft: m(q.topLeft), topRight: m(q.topRight), bottomRight: m(q.bottomRight), bottomLeft: m(q.bottomLeft) };
}

// zxing-cpp's HRI text mode spells control characters as <LF>, <GS>, … (e.g. in AAMVA data).
const CONTROL_ESCAPE = /<(NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|SO|SI|DLE|DC[1-4]|NAK|SYN|ETB|CAN|EM|SUB|ESC|FS|GS|RS|US|DEL)>/;

function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  }
}

/** Compress a 12-digit UPC-A into its 8-digit UPC-E form, or undefined if it has none. */
export function compressUpcE(upca: string): string | undefined {
  if (!/^[01]\d{11}$/.test(upca)) return undefined;
  const ns = upca[0]!;
  const m = upca.slice(1, 6);
  const p = upca.slice(6, 11);
  const c = upca[11]!;
  let e: string | undefined;
  if (m.slice(3) === "00" && m[2]! <= "2" && p.startsWith("00")) e = `${m.slice(0, 2)}${p.slice(2)}${m[2]}`;
  else if (m.slice(3) === "00" && p.startsWith("000")) e = `${m.slice(0, 3)}${p.slice(3)}3`;
  else if (m[4] === "0" && p.startsWith("0000")) e = `${m.slice(0, 4)}${p[4]}4`;
  else if (p.startsWith("0000") && p[4]! >= "5") e = `${m}${p[4]}`;
  return e ? `${ns}${e}${c}` : undefined;
}

function pickSymbology(raw: RawBarcode, requested?: ReadonlySet<Symbology>): Symbology | undefined {
  let id = fromZXingFormat(raw.format);
  if (!id) return undefined;
  const has = (s: Symbology) => !requested || requested.has(s);
  // An EAN-13 with a leading zero is a UPC-A.
  if (id === "ean13" && /^0\d{12}$/.test(raw.text) && has("upca")) id = "upca";
  if (!requested) return id;
  if (id === "ean13" && /^97[89]/.test(raw.text) && requested.has("isbn") && !requested.has("ean13")) id = "isbn";
  if (id === "isbn" && !requested.has("isbn") && requested.has("ean13")) id = "ean13";
  if (id === "itf14" && !requested.has("itf14") && requested.has("itf")) id = "itf";
  if (id === "itf" && /^\d{14}$/.test(raw.text) && requested.has("itf14") && !requested.has("itf")) id = "itf14";
  if (id === "upca" && !requested.has("upca") && requested.has("ean13")) return "ean13";
  return requested.has(id) ? id : undefined;
}

export function toBarcode(raw: RawBarcode, o: ConvertOptions): Barcode | null {
  const symbology = pickSymbology(raw, o.requested);
  if (!symbology) return null;
  let data = raw.text;
  // zxing-cpp reports UPC-A/UPC-E in 13-digit EAN form. Return the conventional forms,
  // except when the caller asked for EAN-13 and got a UPC-A.
  if (symbology === "ean13" && raw.format === "UPCA" && data.length === 12) data = `0${data}`;
  if (symbology === "upca" && data.length === 13 && data.startsWith("0")) data = data.slice(1);
  if (symbology === "upce" && data.length >= 12) data = compressUpcE(data.length === 13 ? data.slice(1) : data) ?? data;
  const contentType = CONTENT_TYPES[raw.contentType] ?? "text";
  if (contentType !== "gs1" && raw.bytes.length && CONTROL_ESCAPE.test(data)) data = decodeBytes(raw.bytes);
  return {
    data,
    symbology,
    symbologyName: symbologyName(symbology),
    rawBytes: toBase64(raw.bytes),
    contentType,
    isGS1: contentType === "gs1",
    location: mapQuad(raw.position, o),
    frameSize: { width: o.frameSize.width, height: o.frameSize.height },
    orientation: raw.orientation,
    ecLevel: raw.ecLevel,
    symbologyIdentifier: raw.symbologyIdentifier,
    timestamp: o.timestamp ?? Date.now(),
  };
}

export function toBarcodes(raws: readonly RawBarcode[], o: ConvertOptions): Barcode[] {
  const out: Barcode[] = [];
  for (const r of raws) {
    const b = toBarcode(r, o);
    if (b) out.push(b);
  }
  return out;
}

/** Center point of a barcode location. */
export function center(q: Quadrilateral): { x: number; y: number } {
  return {
    x: (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4,
    y: (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4,
  };
}

/** Axis-aligned bounds of a quadrilateral. */
export function bounds(q: Quadrilateral): { x: number; y: number; width: number; height: number } {
  const xs = [q.topLeft.x, q.topRight.x, q.bottomRight.x, q.bottomLeft.x];
  const ys = [q.topLeft.y, q.topRight.y, q.bottomRight.y, q.bottomLeft.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
