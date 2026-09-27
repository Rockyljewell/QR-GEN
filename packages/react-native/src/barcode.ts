/**
 * Helpers to create and validate SPEC section 2 results. Pure TypeScript.
 */
import { resolveSymbology, symbologyName, type SymbologyId } from './symbologies';
import type { Barcode, ContentType, Point, Quadrilateral, Rect, Size, TrackedBarcode } from './types';

const CONTENT_TYPES: ReadonlySet<string> = new Set(['text', 'binary', 'gs1', 'iso15434', 'mixed', 'unknown-eci']);

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function point(v: unknown): Point {
  return isObject(v) ? { x: num(v.x), y: num(v.y) } : { x: 0, y: 0 };
}

/** A quadrilateral with every corner at the origin. */
export function emptyQuadrilateral(): Quadrilateral {
  return { topLeft: { x: 0, y: 0 }, topRight: { x: 0, y: 0 }, bottomRight: { x: 0, y: 0 }, bottomLeft: { x: 0, y: 0 } };
}

/** Converts an axis-aligned rectangle into a quadrilateral. */
export function quadrilateralFromRect(r: Rect): Quadrilateral {
  return {
    topLeft: { x: r.x, y: r.y },
    topRight: { x: r.x + r.width, y: r.y },
    bottomRight: { x: r.x + r.width, y: r.y + r.height },
    bottomLeft: { x: r.x, y: r.y + r.height },
  };
}

/** Input accepted by {@link createBarcode}: `data` and `symbology` are required. */
export type BarcodeInit = Partial<Omit<Barcode, 'symbology'>> & { data: string; symbology: SymbologyId };

/** Creates a complete SPEC result, filling defaults for every missing field. */
export function createBarcode(init: BarcodeInit): Barcode {
  return {
    data: init.data,
    symbology: init.symbology,
    symbologyName: init.symbologyName ?? symbologyName(init.symbology),
    rawBytes: init.rawBytes ?? '',
    contentType: init.contentType ?? 'text',
    isGS1: init.isGS1 ?? false,
    location: init.location ?? emptyQuadrilateral(),
    frameSize: init.frameSize ?? { width: 0, height: 0 },
    orientation: init.orientation ?? 0,
    ecLevel: init.ecLevel ?? '',
    symbologyIdentifier: init.symbologyIdentifier ?? '',
    timestamp: init.timestamp ?? Date.now(),
  };
}

/**
 * Validates and normalizes a barcode received as JSON (for example over the
 * embed bridge). Missing optional fields get SPEC defaults. Returns `null` when
 * `data` or `symbology` is missing. Symbology aliases are resolved; an unknown
 * symbology string from a newer engine is kept as-is (lowercased).
 */
export function normalizeBarcode(value: unknown): Barcode | null {
  if (!isObject(value)) return null;
  if (typeof value.data !== 'string' || typeof value.symbology !== 'string' || value.symbology === '') return null;
  const symbology = (resolveSymbology(value.symbology) ?? value.symbology.toLowerCase()) as SymbologyId;
  const loc = isObject(value.location) ? value.location : {};
  const frame = isObject(value.frameSize) ? value.frameSize : {};
  const contentType = CONTENT_TYPES.has(str(value.contentType)) ? (value.contentType as ContentType) : 'text';
  return {
    data: value.data,
    symbology,
    symbologyName: str(value.symbologyName) || symbologyName(symbology),
    rawBytes: str(value.rawBytes),
    contentType,
    isGS1: typeof value.isGS1 === 'boolean' ? value.isGS1 : contentType === 'gs1',
    location: {
      topLeft: point(loc.topLeft),
      topRight: point(loc.topRight),
      bottomRight: point(loc.bottomRight),
      bottomLeft: point(loc.bottomLeft),
    },
    frameSize: { width: num(frame.width), height: num(frame.height) } satisfies Size,
    orientation: num(value.orientation),
    ecLevel: str(value.ecLevel),
    symbologyIdentifier: str(value.symbologyIdentifier),
    timestamp: num(value.timestamp, Date.now()),
  };
}

/** Like {@link normalizeBarcode} for tracked barcodes. `id` defaults to `symbology:data`. */
export function normalizeTrackedBarcode(value: unknown): TrackedBarcode | null {
  const base = normalizeBarcode(value);
  if (!base || !isObject(value)) return null;
  return {
    ...base,
    id: typeof value.id === 'string' || typeof value.id === 'number' ? String(value.id) : `${base.symbology}:${base.data}`,
    firstSeen: num(value.firstSeen, base.timestamp),
    lastSeen: num(value.lastSeen, base.timestamp),
    count: Math.max(1, Math.floor(num(value.count, 1))),
  };
}

/** Center of a quadrilateral. */
export function quadrilateralCenter(q: Quadrilateral): Point {
  return {
    x: (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4,
    y: (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4,
  };
}

/** Axis-aligned bounding box of a quadrilateral. */
export function quadrilateralBounds(q: Quadrilateral): Rect {
  const xs = [q.topLeft.x, q.topRight.x, q.bottomRight.x, q.bottomLeft.x];
  const ys = [q.topLeft.y, q.topRight.y, q.bottomRight.y, q.bottomLeft.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
