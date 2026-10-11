// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { QRGenError } from "./errors.js";
import { generate, type GeneratedBarcode } from "./generator.js";

export type QRCodeEcLevel = "L" | "M" | "Q" | "H";

export interface QRCodePlanOptions {
  /** Maximum printed width, including the four-module quiet zone on every side. */
  widthMm: number;
  /** Printer dots per inch. The output uses whole dots for every module. */
  dpi: number;
  /** Required whole printer dots per module. Default 3 is a planning profile, not a scanning guarantee. */
  minDotsPerModule?: number;
  /** Default "auto": maximize dots/module, then error correction among ties. An explicit level is exact. */
  ecLevel?: QRCodeEcLevel | "auto";
  /** Minimum permitted error correction. Default M for auto; an explicit ecLevel has no implicit floor. */
  minEcLevel?: QRCodeEcLevel;
}

export interface QRCodePlanGeometry {
  version: number;
  /** Symbol width, excluding the quiet zone. */
  symbolModules: number;
  /** Quiet zone on each side, in modules. */
  quietZoneModules: 4;
  /** Symbol and quiet zones combined. */
  totalModules: number;
  dotsPerModule: number;
  /** Actual raster width, including the quiet zone. */
  widthDots: number;
  /** Actual printed width at the requested DPI, including the quiet zone. */
  widthMm: number;
  moduleMm: number;
  quietZoneMm: number;
}

export interface QRCodePlanCandidate {
  ecLevel: QRCodeEcLevel;
  /** A sub-module target can give dotsPerModule=0. Such a candidate is never rendered. */
  geometry: QRCodePlanGeometry;
  suitable: boolean;
  /** Width needed to meet minDotsPerModule with this symbol, including quiet zones. */
  minimumWidthMm: number;
}

export interface QRCodePlanDiagnostic {
  code: "physical-validation-required" | "insufficient-space" | "ecc-tradeoff" | "encoding-failed";
  severity: "info" | "warning" | "error";
  message: string;
  ecLevel?: QRCodeEcLevel;
  minimumWidthMm?: number;
}

interface QRCodePlanBase {
  target: { widthMm: number; dpi: number; availableWidthDots: number; minDotsPerModule: number };
  /** Only successfully encoded candidates, with the requested ECC floor applied. */
  candidates: QRCodePlanCandidate[];
  diagnostics: QRCodePlanDiagnostic[];
}

export type QRCodePlan = QRCodePlanBase & (
  | {
    suitable: true;
    ecLevel: QRCodeEcLevel;
    geometry: QRCodePlanGeometry;
    barcode: GeneratedBarcode;
    /** Standalone SVG with physical mm dimensions. Print at 100%, without fit-to-page scaling. */
    printSvg: string;
  }
  | { suitable: false; ecLevel: null; geometry: null; barcode: null; printSvg: null }
);

const LEVELS: readonly QRCodeEcLevel[] = ["L", "M", "Q", "H"];
const QUIET_ZONE = 4;
// Bound all encodes: probes are at most 185px, and the selected raster is at most 2048px square.
const MAX_OUTPUT_DOTS = 2048;
const MAX_INPUT_BYTES = 7089;

function badRequest(message: string): never {
  throw new QRGenError("bad-request", message);
}

function validNumber(name: string, value: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    badRequest(`${name} must be a finite number greater than 0 and at most ${max}.`);
  }
}

function validLevel(name: string, value: unknown): asserts value is QRCodeEcLevel {
  if (!LEVELS.includes(value as QRCodeEcLevel)) badRequest(`${name} must be L, M, Q, or H.`);
}

function validateData(data: string): void {
  if (typeof data !== "string" || data.length === 0) badRequest("Nothing to encode: data is empty.");
  // The current writer's string path discards an initial BOM. Refuse lossy encoding rather than normalize it.
  if (data.startsWith("\ufeff")) badRequest("A leading Unicode BOM cannot be preserved by the current QR string encoder. Remove it explicitly before planning, or use a byte-preserving encoder.");
  // Check length before any allocation; 7089 is the largest QR numeric payload, not a promise of capacity.
  if (data.length > MAX_INPUT_BYTES) badRequest(`QR planning accepts at most ${MAX_INPUT_BYTES} UTF-8 bytes.`);
  for (let i = 0; i < data.length; i++) {
    const unit = data.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = data.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) badRequest("QR data contains an unpaired Unicode surrogate.");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      badRequest("QR data contains an unpaired Unicode surrogate.");
    }
  }
  if (new TextEncoder().encode(data).length > MAX_INPUT_BYTES) {
    badRequest(`QR planning accepts at most ${MAX_INPUT_BYTES} UTF-8 bytes.`);
  }
}

function assertRendering(barcode: GeneratedBarcode, totalModules: number, scale: number): void {
  const attributes = /<svg\b([^>]*)>/.exec(barcode.svg)?.[1] ?? "";
  const width = /(?:^|\s)width="([\d.]+)"/.exec(attributes);
  const height = /(?:^|\s)height="([\d.]+)"/.exec(attributes);
  const viewBox = /(?:^|\s)viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(attributes);
  const expected = totalModules * scale;
  if (Number(width?.[1]) !== expected || Number(height?.[1]) !== expected ||
    Number(viewBox?.[1]) !== expected || Number(viewBox?.[2]) !== expected) {
    throw new QRGenError("unknown", "The QR encoder returned unexpected dimensions; the physical layout cannot be verified.");
  }
}

/**
 * Plan a standard QR code for a bounded physical label using the real encoder.
 *
 * Auto selection favors larger whole printer dots/module, then stronger ECC among ties.
 * This is a geometric policy, not a prediction of scan reliability. Validate printed samples
 * on the intended material, printer and devices. The payload is never shortened or normalized.
 * Invalid inputs and leading Unicode BOMs (lossy in the current string encoder) throw QRGenError;
 * a valid payload that cannot meet the profile returns suitable=false.
 * Target widths are bounded to 2048 printer dots to prevent unexpectedly large raster allocations.
 */
export async function planQRCode(data: string, options: QRCodePlanOptions): Promise<QRCodePlan> {
  validateData(data);
  if (!options || typeof options !== "object") badRequest("QR planning requires widthMm and dpi.");
  validNumber("widthMm", options.widthMm, 1000);
  validNumber("dpi", options.dpi, 9600);
  const minDotsPerModule = options.minDotsPerModule === undefined ? 3 : options.minDotsPerModule;
  validNumber("minDotsPerModule", minDotsPerModule, MAX_OUTPUT_DOTS);
  if (!Number.isInteger(minDotsPerModule)) badRequest("minDotsPerModule must be a positive integer.");
  const ecLevel = options.ecLevel === undefined ? "auto" : options.ecLevel;
  if (ecLevel !== "auto") validLevel("ecLevel", ecLevel);
  if (options.minEcLevel !== undefined) validLevel("minEcLevel", options.minEcLevel);
  const minimumLevel = options.minEcLevel ?? (ecLevel === "auto" ? "M" : ecLevel);
  if (ecLevel !== "auto" && LEVELS.indexOf(ecLevel) < LEVELS.indexOf(minimumLevel)) {
    badRequest("ecLevel cannot be lower than minEcLevel.");
  }
  const exactWidthDots = options.widthMm * options.dpi / 25.4;
  // Preserve exact integer boundaries despite harmless floating-point roundoff.
  const availableWidthDots = Math.floor(exactWidthDots + 4 * Number.EPSILON * Math.max(1, exactWidthDots));
  if (availableWidthDots < 1 || exactWidthDots > MAX_OUTPUT_DOTS + 4 * Number.EPSILON * MAX_OUTPUT_DOTS) {
    badRequest(`widthMm and dpi must describe a width from 1 to ${MAX_OUTPUT_DOTS} printer dots.`);
  }
  const target = { widthMm: options.widthMm, dpi: options.dpi, availableWidthDots, minDotsPerModule };
  const levels = ecLevel === "auto" ? LEVELS.slice(LEVELS.indexOf(minimumLevel)) : [ecLevel];
  const candidates: QRCodePlanCandidate[] = [];
  const diagnostics: QRCodePlanDiagnostic[] = [{
    code: "physical-validation-required", severity: "info",
    message: "This plan checks geometry, not real-world scan reliability. Print at the reported physical width without rescaling, preserve the quiet zone, and test samples on the intended material and devices.",
  }];
  let selected: QRCodePlanCandidate | undefined;
  for (const level of levels) {
    let probe: GeneratedBarcode;
    try {
      probe = await generate(data, { symbology: "qr", ecLevel: level, scale: 1, margin: true });
    } catch (error) {
      // Capacity depends on payload contents and ECC; a lower permitted level may still encode.
      // Engine/network failures must remain failures instead of looking like unsuitable labels.
      if (!(error instanceof QRGenError) || error.code !== "bad-request") throw error;
      diagnostics.push({ code: "encoding-failed", severity: "warning", ecLevel: level, message: error.message });
      continue;
    }
    const symbolModules = probe.matrix.width;
    const version = (symbolModules - 17) / 4;
    if (probe.matrix.height !== symbolModules || !Number.isInteger(version) || version < 1 || version > 40) {
      throw new QRGenError("unknown", "The QR encoder returned an unexpected symbol matrix.");
    }
    const totalModules = symbolModules + QUIET_ZONE * 2;
    assertRendering(probe, totalModules, 1);
    const dotsPerModule = Math.floor(availableWidthDots / totalModules);
    const widthDots = totalModules * dotsPerModule;
    const geometry: QRCodePlanGeometry = {
      version, symbolModules, quietZoneModules: QUIET_ZONE, totalModules, dotsPerModule, widthDots,
      widthMm: widthDots * 25.4 / options.dpi,
      moduleMm: dotsPerModule * 25.4 / options.dpi,
      quietZoneMm: QUIET_ZONE * dotsPerModule * 25.4 / options.dpi,
    };
    const candidate: QRCodePlanCandidate = {
      ecLevel: level, geometry, suitable: dotsPerModule >= minDotsPerModule,
      minimumWidthMm: totalModules * minDotsPerModule * 25.4 / options.dpi,
    };
    candidates.push(candidate);
    if (candidate.suitable && (!selected || dotsPerModule >= selected.geometry.dotsPerModule)) selected = candidate;
  }
  if (!selected) {
    const minimumWidthMm = candidates.length ? Math.min(...candidates.map((candidate) => candidate.minimumWidthMm)) : undefined;
    diagnostics.push({
      code: "insufficient-space", severity: "error", minimumWidthMm,
      message: minimumWidthMm === undefined
        ? "The payload could not be encoded at any permitted error correction level. Reduce the payload or permit a lower level."
        : `No permitted QR code fits ${minDotsPerModule} whole dots per module. Allow at least ${(Math.ceil(minimumWidthMm * 1000) / 1000).toFixed(3)} mm at ${options.dpi} DPI, increase DPI, or reduce the payload.`,
    });
    return { suitable: false, target, candidates, diagnostics, ecLevel: null, geometry: null, barcode: null, printSvg: null };
  }
  const selectedLevel = selected.ecLevel;
  const stronger = candidates.filter((candidate) => LEVELS.indexOf(candidate.ecLevel) > LEVELS.indexOf(selectedLevel));
  if (stronger.length) {
    diagnostics.push({
      code: "ecc-tradeoff", severity: "info", ecLevel: selected.ecLevel,
      message: `${selected.ecLevel} keeps ${selected.geometry.dotsPerModule} whole dots per module. Stronger error correction would use smaller modules. This geometric policy does not establish which level scans best in practice.`,
    });
  }
  const barcode = await generate(data, {
    symbology: "qr", ecLevel: selected.ecLevel, scale: selected.geometry.dotsPerModule, margin: true,
  });
  if (barcode.matrix.width !== selected.geometry.symbolModules || barcode.matrix.height !== selected.geometry.symbolModules) {
    throw new QRGenError("unknown", "The QR encoder changed the planned symbol dimensions.");
  }
  assertRendering(barcode, selected.geometry.totalModules, selected.geometry.dotsPerModule);
  const physicalWidth = `${selected.geometry.widthMm}mm`;
  const printSvg = barcode.svg.replace(/(<svg\b[^>]*\b)width="[\d.]+"/, `$1width="${physicalWidth}"`)
    .replace(/(<svg\b[^>]*\b)height="[\d.]+"/, `$1height="${physicalWidth}"`);
  return { suitable: true, target, candidates, diagnostics, ecLevel: selected.ecLevel, geometry: selected.geometry, barcode, printSvg };
}
