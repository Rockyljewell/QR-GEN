// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * QRGen: open-source barcode, QR and ID scanning.
 *
 * - `scanImage()`: decode codes in files, blobs, canvases and URLs.
 * - `BarcodeScanner`: camera scanning with duplicate filtering, feedback and batch tracking.
 * - `generate()`: create any supported barcode as SVG/PNG.
 * - `parseContent()`, `parseGS1()`, `parseAAMVA()`: understand what was scanned.
 * - `qrgen-sdk/elements`: the `<qrgen-scanner>` / `<qrgen-barcode>` UI components.
 */
import { configure, ENGINE_VERSION } from "./engine/config.js";
import { generate, generateDataURL, generateSVG } from "./generator.js";
import { scanImage } from "./image.js";
import { parseAAMVA, parseContent, parseGS1 } from "./parsers/index.js";
import { BarcodeScanner, type BarcodeScannerOptions } from "./scanner.js";
import { ALL_SYMBOLOGIES, resolveSymbologies, SYMBOLOGIES, WRITABLE_SYMBOLOGIES } from "./symbologies.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";
export { configure, ENGINE_VERSION, type EngineConfig } from "./engine/config.js";
export { QRGenError, toQRGenError } from "./errors.js";
export * from "./types.js";
export {
  SYMBOLOGIES,
  ALL_SYMBOLOGIES,
  WRITABLE_SYMBOLOGIES,
  SYMBOLOGY_GROUPS,
  resolveSymbologies,
  toSymbology,
  symbologyInfo,
  symbologyName,
  normalizeName,
  type Symbology,
  type SymbologyGroup,
  type SymbologyInput,
  type SymbologyInfo,
} from "./symbologies.js";
export { scanImage, type ScanImageOptions, type ImageInput } from "./image.js";
export { generate, generateSVG, generateDataURL, styleSvg, type GenerateOptions, type GeneratedBarcode } from "./generator.js";
export { BarcodeScanner, type BarcodeScannerOptions, type ScannerEvents, type ScannerState, type FrameEvent } from "./scanner.js";
export { Camera, type CameraOptions, type CameraCapabilities, type Resolution } from "./camera.js";
export { Feedback, type FeedbackOptions } from "./feedback.js";
export { DuplicateFilter } from "./duplicate-filter.js";
export { BarcodeTracker, type TrackerOptions, type TrackerUpdate } from "./tracker.js";
export { center as quadCenter, bounds as quadBounds } from "./engine/convert.js";
export * from "./parsers/index.js";
export { toBase64, fromBase64 } from "./util.js";

/** Convenience namespace mirroring the other QRGen SDKs (`QRGen.scanImage(...)`, `QRGen.generate(...)`). */
export const QRGen = {
  version: VERSION,
  engineVersion: ENGINE_VERSION,
  configure,
  scanImage,
  generate,
  generateSVG,
  generateDataURL,
  parseContent,
  parseGS1,
  parseAAMVA,
  resolveSymbologies,
  symbologies: SYMBOLOGIES,
  supportedSymbologies: () => ({ read: [...ALL_SYMBOLOGIES], write: [...WRITABLE_SYMBOLOGIES] }),
  createScanner: (options?: BarcodeScannerOptions) => new BarcodeScanner(options),
} as const;

export default QRGen;
