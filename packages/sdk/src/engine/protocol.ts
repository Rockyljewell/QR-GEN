import type { Quadrilateral } from "../types.js";

/** Reader parameters passed to zxing-cpp for one decode call. */
export interface DecodeParams {
  formats: string[];
  tryHarder: boolean;
  tryRotate: boolean;
  tryInvert: boolean;
  tryDownscale: boolean;
  maxNumberOfSymbols: number;
}

/** Plain, structured-clone friendly decode result (worker → main thread). */
export interface RawBarcode {
  format: string;
  text: string;
  bytes: Uint8Array;
  contentType: string;
  position: Quadrilateral;
  orientation: number;
  ecLevel: string;
  symbologyIdentifier: string;
  isMirrored: boolean;
  isInverted: boolean;
}

export type WorkerRequest =
  | { type: "init"; wasmUrl: string; wasmBinary?: ArrayBuffer }
  | { type: "decode"; id: number; width: number; height: number; buffer: ArrayBuffer; params: DecodeParams };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "init-error"; message: string }
  | { type: "result"; id: number; results: RawBarcode[] }
  | { type: "error"; id: number; message: string };

interface ZXingLikeResult {
  isValid: boolean;
  format: string;
  text: string;
  bytes: Uint8Array;
  contentType: string;
  position: Quadrilateral;
  orientation?: number;
  ecLevel?: string;
  symbologyIdentifier?: string;
  isMirrored?: boolean;
  isInverted?: boolean;
}

export function toRawBarcodes(results: readonly ZXingLikeResult[]): RawBarcode[] {
  const out: RawBarcode[] = [];
  for (const r of results) {
    if (!r.isValid) continue;
    const p = r.position;
    out.push({
      format: r.format,
      text: r.text,
      bytes: new Uint8Array(r.bytes),
      contentType: r.contentType,
      position: {
        topLeft: { x: p.topLeft.x, y: p.topLeft.y },
        topRight: { x: p.topRight.x, y: p.topRight.y },
        bottomRight: { x: p.bottomRight.x, y: p.bottomRight.y },
        bottomLeft: { x: p.bottomLeft.x, y: p.bottomLeft.y },
      },
      orientation: r.orientation ?? 0,
      ecLevel: r.ecLevel ?? "",
      symbologyIdentifier: r.symbologyIdentifier ?? "",
      isMirrored: !!r.isMirrored,
      isInverted: !!r.isInverted,
    });
  }
  return out;
}

export function toReaderOptions(params: DecodeParams) {
  return {
    formats: params.formats as never[],
    tryHarder: params.tryHarder,
    tryRotate: params.tryRotate,
    tryInvert: params.tryInvert,
    tryDownscale: params.tryDownscale,
    maxNumberOfSymbols: params.maxNumberOfSymbols,
    textMode: "HRI" as const,
  };
}
