// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import { readBarcodes, READABLE_BARCODE_FORMATS } from "zxing-wasm/reader";
import { toRawBarcodes, toReaderOptions, type DecodeParams, type RawBarcode } from "./protocol.js";

export interface Raster { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export type RasterLoader = () => Promise<Raster | null>;
// ZXing already searches both polarities for these formats. Other formats need
// an explicit pixel inversion, which costs a second full decode; it runs only
// when the normal pass found nothing.
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

/**
 * One normal decode. Only when it finds nothing (and `tryInvert` is on), one
 * explicit decode of an inverted copy for the requested formats ZXing does not
 * invert itself. An image mixing a normal code with a reversed-reflectance
 * linear code therefore reports the normal code only; scanning stays a single
 * pass whenever anything is found. `loadRaster` runs only for that second pass.
 */
export async function readWithInversion(input: Blob | ArrayBuffer | Uint8Array | ImageData, params: DecodeParams, loadRaster?: RasterLoader): Promise<RawBarcode[]> {
  const limit = params.maxNumberOfSymbols;
  const results = toRawBarcodes(await readBarcodes(input, toReaderOptions(params)));
  if (results.length || !params.tryInvert) return results.slice(0, limit);
  const selectedFormats = params.formats.length ? params.formats : READABLE_BARCODE_FORMATS;
  const formats = selectedFormats.filter(format => !NATIVE_INVERSION.has(format));
  if (!formats.length) return results;
  let raster: Raster | null = null;
  if ("data" in input && "width" in input && "height" in input) raster = input as Raster;
  else if (loadRaster) {
    // A codec may not support every format understood by ZXing (e.g. PSD/PNM).
    try { raster = await loadRaster(); } catch { return results; }
  }
  if (!raster) return results;
  const inverted = toRawBarcodes(await readBarcodes(invertRaster(raster) as ImageData, toReaderOptions({ ...params, formats, tryInvert: false })));
  for (const result of inverted) result.isInverted = !result.isInverted;
  return inverted.slice(0, limit);
}
