// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import { readBarcodes, READABLE_BARCODE_FORMATS } from "zxing-wasm/reader";
import { toRawBarcodes, toReaderOptions, type DecodeParams, type RawBarcode } from "./protocol.js";

export interface Raster { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export type RasterLoader = () => Promise<Raster | null>;
// ZXing already searches both polarities for these formats. Other formats need
// an explicit pixel inversion; keep that additional decode bounded to one pass.
const NATIVE_INVERSION = new Set(["QRCode", "QRCodeModel1", "QRCodeModel2", "MicroQRCode", "RMQRCode", "DataMatrix", "Aztec", "AztecCode", "AztecRune"]);

export function invertRaster(image: Raster): Raster {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - image.data[i]!;
    data[i + 1] = 255 - image.data[i + 1]!;
    data[i + 2] = 255 - image.data[i + 2]!;
    data[i + 3] = image.data[i + 3]!;
  }
  return { width: image.width, height: image.height, data };
}

function sameDetection(a: RawBarcode, b: RawBarcode): boolean {
  if (a.format !== b.format || a.text !== b.text || a.bytes.length !== b.bytes.length || a.bytes.some((v, i) => v !== b.bytes[i])) return false;
  const box = (r: RawBarcode) => {
    const points = Object.values(r.position);
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const x = box(a), y = box(b);
  const intersection = Math.max(0, Math.min(x[2], y[2]) - Math.max(x[0], y[0])) * Math.max(0, Math.min(x[3], y[3]) - Math.max(x[1], y[1]));
  const union = (x[2] - x[0]) * (x[3] - x[1]) + (y[2] - y[0]) * (y[3] - y[1]) - intersection;
  return union > 0 ? intersection / union >= 0.5 : x.every((v, i) => Math.abs(v - y[i]!) <= 1);
}

/** One normal decode, plus at most one explicit inverted decode if capacity remains. */
export async function readWithInversion(input: Blob | ArrayBuffer | Uint8Array | ImageData, params: DecodeParams, loadRaster?: RasterLoader): Promise<RawBarcode[]> {
  const results = toRawBarcodes(await readBarcodes(input, toReaderOptions(params)));
  const limit = params.maxNumberOfSymbols;
  const selectedFormats = params.formats.length ? params.formats : READABLE_BARCODE_FORMATS;
  const formats = selectedFormats.filter(format => !NATIVE_INVERSION.has(format));
  if (!params.tryInvert || !formats.length || results.length >= limit) return results.slice(0, limit);
  let raster: Raster | null = null;
  if ("data" in input && "width" in input && "height" in input) raster = input as Raster;
  else if (loadRaster) {
    // A codec may not support every format understood by ZXing (e.g. PSD/PNM).
    // Preserve the normal-pass results when no raster fallback is available.
    try { raster = await loadRaster(); } catch { return results; }
  }
  if (!raster) return results;
  const inverted = invertRaster(raster);
  // Use the full limit so detections already seen in the first pass cannot
  // consume the remaining capacity and hide another physical barcode.
  const extra = toRawBarcodes(await readBarcodes(inverted as ImageData, toReaderOptions({ ...params, formats, tryInvert: false })));
  for (const result of extra) {
    result.isInverted = !result.isInverted;
    if (!results.some(existing => sameDetection(existing, result))) results.push(result);
    if (results.length >= limit) break;
  }
  return results;
}
