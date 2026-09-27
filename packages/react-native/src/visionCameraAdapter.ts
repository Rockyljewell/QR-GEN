/**
 * Converts react-native-vision-camera `Code` objects into SPEC section 2
 * results. Pure TypeScript: the vision-camera shapes are declared
 * structurally, so this file does not import the native package.
 */
import { createBarcode, quadrilateralCenter } from './barcode';
import { orderQuadrilateral, rectContains, uprightFrameSize } from './geometry';
import { fromVisionCameraCode, type PlatformInfo, type SymbologyId } from './symbologies';
import type { Barcode, ContentType, Point, ScanArea, Size } from './types';

/** Structural copy of vision-camera's `Code`. */
export interface VisionCameraCodeLike {
  type: string;
  value?: string;
  frame?: { x: number; y: number; width: number; height: number };
  corners?: Point[];
}

/** Structural copy of vision-camera's `CodeScannerFrame`. */
export interface VisionCameraFrameLike {
  width: number;
  height: number;
}

/** Context needed to convert codes. */
export interface ConvertCodesContext {
  /** Resolved ids the caller asked for; codes outside this set are dropped. */
  requested: readonly SymbologyId[];
  /** `Platform.OS` / `Platform.Version`. */
  platform: PlatformInfo;
  /**
   * Size of the preview view. Used to decide whether the landscape sensor
   * frame must be swapped to upright. `null` keeps the frame as reported.
   */
  viewSize?: Size | null;
  /** Timestamp for the results. Default `Date.now()`. */
  timestamp?: number;
}

/**
 * Brings vision-camera coordinates into upright frame pixels.
 *
 * - iOS (AVFoundation): vision-camera multiplies the normalized metadata
 *   coordinates, which follow the preview orientation, by the sensor's
 *   landscape `videoDimensions`. Normalize by the reported frame, then scale
 *   to the upright size.
 * - Android (ML Kit): coordinates are already in the rotated (upright) image,
 *   while the reported frame is the unrotated image size, so only the size is
 *   swapped.
 */
export function toUprightPoints(points: readonly Point[], frame: Size, upright: Size, platform: PlatformInfo): Point[] {
  if (platform.os !== 'ios' || frame.width <= 0 || frame.height <= 0) return points.map((p) => ({ x: p.x, y: p.y }));
  return points.map((p) => ({ x: (p.x / frame.width) * upright.width, y: (p.y / frame.height) * upright.height }));
}

function codePoints(code: VisionCameraCodeLike): Point[] {
  if (Array.isArray(code.corners) && code.corners.length >= 4) return code.corners;
  const f = code.frame;
  if (f) {
    return [
      { x: f.x, y: f.y },
      { x: f.x + f.width, y: f.y },
      { x: f.x + f.width, y: f.y + f.height },
      { x: f.x, y: f.y + f.height },
    ];
  }
  return [];
}

const DATABAR_FIXED: ReadonlySet<SymbologyId> = new Set<SymbologyId>(['databar', 'databar-limited']);

/**
 * GS1 DataBar Omni/Limited always carry AI (01). Present them in HRI form as
 * the specification asks; other symbologies keep the engine's text.
 */
function normalizeContent(symbology: SymbologyId, data: string): { data: string; contentType: ContentType; isGS1: boolean } {
  if (DATABAR_FIXED.has(symbology)) {
    if (/^01\d{14}$/.test(data)) return { data: `(01)${data.slice(2)}`, contentType: 'gs1', isGS1: true };
    if (/^\d{14}$/.test(data)) return { data: `(01)${data}`, contentType: 'gs1', isGS1: true };
    if (/^\(01\)\d{14}$/.test(data)) return { data, contentType: 'gs1', isGS1: true };
  }
  if (symbology === 'databar-expanded' && data.startsWith('(')) return { data, contentType: 'gs1', isGS1: true };
  return { data, contentType: 'text', isGS1: false };
}

/**
 * Converts the codes of one vision-camera callback to QRGen barcodes. Codes
 * without a value, of an unknown type, or outside `requested` are dropped.
 * `location` is in upright frame pixels and `frameSize` is the upright frame.
 */
export function convertVisionCameraCodes(
  codes: readonly VisionCameraCodeLike[],
  frame: VisionCameraFrameLike,
  context: ConvertCodesContext,
): Barcode[] {
  const upright = uprightFrameSize(frame, context.viewSize);
  const timestamp = context.timestamp ?? Date.now();
  const out: Barcode[] = [];
  for (const code of codes) {
    if (typeof code.value !== 'string' || code.value.length === 0) continue;
    const mapped = fromVisionCameraCode(code.type, code.value, context.requested);
    if (!mapped) continue;
    const content = normalizeContent(mapped.symbology, mapped.data);
    const points = toUprightPoints(codePoints(code), frame, upright, context.platform);
    out.push(
      createBarcode({
        data: content.data,
        symbology: mapped.symbology,
        contentType: content.contentType,
        isGS1: content.isGS1,
        location: orderQuadrilateral(points),
        frameSize: upright,
        timestamp,
      }),
    );
  }
  return out;
}

/**
 * Applies `scanArea` and `maxResults`: drops codes whose center is outside the
 * area (normalized to the frame) and keeps the `maxResults` codes closest to
 * the center of the area.
 */
export function selectBarcodes(barcodes: readonly Barcode[], options: { scanArea?: ScanArea | null; maxResults?: number }): Barcode[] {
  let list = [...barcodes];
  const area = options.scanArea;
  const areaCenter = (b: Barcode): Point =>
    area
      ? { x: (area.x + area.width / 2) * b.frameSize.width, y: (area.y + area.height / 2) * b.frameSize.height }
      : { x: b.frameSize.width / 2, y: b.frameSize.height / 2 };
  if (area) {
    list = list.filter((b) => {
      if (b.frameSize.width <= 0 || b.frameSize.height <= 0) return true;
      const c = quadrilateralCenter(b.location);
      return rectContains(area, { x: c.x / b.frameSize.width, y: c.y / b.frameSize.height });
    });
  }
  const max = options.maxResults;
  if (typeof max === 'number' && max > 0 && list.length > max) {
    const dist = (b: Barcode) => {
      const c = quadrilateralCenter(b.location);
      const t = areaCenter(b);
      return (c.x - t.x) ** 2 + (c.y - t.y) ** 2;
    };
    list = list
      .map((b, i) => ({ b, i, d: dist(b) }))
      .sort((a, z) => a.d - z.d || a.i - z.i)
      .slice(0, max)
      .sort((a, z) => a.i - z.i)
      .map((e) => e.b);
  }
  return list;
}
