// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/** Internal whole-frame spatial association. No clock or tracker-state mutation. */
import type { Barcode, Point, Size, TrackedBarcode } from './types';

interface Geometry { x: number; y: number; limit: number }
const BARCODE_FIELDS: Array<keyof Barcode> = ['data', 'symbology', 'symbologyName', 'rawBytes', 'contentType', 'isGS1',
  'location', 'frameSize', 'orientation', 'ecLevel', 'symbologyIdentifier', 'timestamp'];

// Read caller-owned getters before planning or consuming either history.
export function snapshotBarcode<T extends Barcode>(value: T): T {
  const copy = { ...value };
  // Structural Barcode implementations can expose known fields through
  // prototype or non-enumerable getters. Spread has already read enumerable
  // own fields, so fill only missing fields to avoid reading a getter twice.
  for (const field of BARCODE_FIELDS) if (!Object.prototype.hasOwnProperty.call(copy, field)) {
    Object.defineProperty(copy, field, { value: value?.[field], enumerable: true, configurable: true, writable: true });
  }
  const point = (p: Point): Point => p && { x: p.x, y: p.y };
  const q = copy.location;
  if (q) copy.location = { topLeft: point(q.topLeft), topRight: point(q.topRight), bottomRight: point(q.bottomRight), bottomLeft: point(q.bottomLeft) };
  if (copy.frameSize) copy.frameSize = { width: copy.frameSize.width, height: copy.frameSize.height };
  return copy;
}

export function spatialSize(value: Size): Size {
  const width = value?.width, height = value?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Spatial tracking requires positive integer frame dimensions');
  }
  return { width, height };
}

export function spatialGeometry(barcode: Barcode, maxJump: number): Geometry {
  const q = barcode?.location;
  const points = q ? [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft] : [];
  if (points.length !== 4 || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new RangeError('Spatial tracking requires finite corner coordinates');
  }
  const width = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
  const height = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  // Divide before summation so a finite center does not overflow its intermediate sum.
  const x = points.reduce((sum, point) => sum + point.x / 4, 0);
  const y = points.reduce((sum, point) => sum + point.y / 4, 0);
  const limit = Math.max(width, height, 1) * maxJump;
  if (Math.max(width, height) <= 0 || ![width, height, x, y, limit].every(Number.isFinite)) {
    throw new RangeError('Spatial tracking requires a nonzero finite barcode extent and movement gate');
  }
  return { x, y, limit };
}

export function validateSpatialFrame(barcodes: readonly Barcode[], maxJump: number, frameSize?: Size): Size | null {
  let size = frameSize === undefined ? null : spatialSize(frameSize);
  for (const barcode of barcodes) {
    spatialGeometry(barcode, maxJump);
    if (typeof barcode.symbology !== 'string' || typeof barcode.data !== 'string') {
      throw new TypeError('Spatial symbology and data must be strings');
    }
    const own = spatialSize(barcode.frameSize);
    if (size && (size.width !== own.width || size.height !== own.height)) {
      throw new RangeError('Spatial records must share their source frame dimensions');
    }
    size = own;
  }
  return size;
}

// JSON arrays preserve exact string pairs, including embedded NULs and surrogate code units.
const key = (barcode: Barcode): string => JSON.stringify([barcode.symbology, barcode.data]);

export function associationWork(detections: readonly Barcode[], tracks: readonly TrackedBarcode[]): number {
  const current = new Map<string, number>(), previous = new Map<string, number>();
  for (const barcode of detections) current.set(key(barcode), (current.get(key(barcode)) ?? 0) + 1);
  for (const track of tracks) previous.set(key(track), (previous.get(key(track)) ?? 0) + 1);
  let work = 0;
  for (const [group, n] of current) {
    const m = previous.get(group) ?? 0;
    if (m > 0) work += n * n * (m + n);
  }
  return work;
}

/** Prior tracks must be supplied in numeric creation order, never lexical ID order. */
export function associateSpatial(detections: readonly Barcode[], tracks: readonly TrackedBarcode[], maxJump: number): Map<number, TrackedBarcode> {
  const groups = new Map<string, number[]>(), oldGroups = new Map<string, TrackedBarcode[]>();
  detections.forEach((barcode, index) => {
    const payload = key(barcode), indices = groups.get(payload) ?? [];
    indices.push(index);
    groups.set(payload, indices);
  });
  for (const track of tracks) {
    const payload = key(track), previous = oldGroups.get(payload) ?? [];
    previous.push(track);
    oldGroups.set(payload, previous);
  }
  const matched = new Map<number, TrackedBarcode>();
  for (const [payload, indices] of groups) {
    const previous = oldGroups.get(payload);
    if (!previous?.length) continue;
    const rows = indices.map(index => ({ index, ...spatialGeometry(detections[index]!, maxJump) }))
      .sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index);
    const oldPoints = previous.map(track => spatialGeometry(track, maxJump));
    const distances = rows.map(row => oldPoints.map(point => {
      const movement = Math.hypot(point.x - row.x, point.y - row.y);
      return movement <= row.limit ? movement : Infinity;
    }));
    const usable = previous.map((_, index) => index).filter(index => distances.some(row => Number.isFinite(row[index])));
    if (!usable.length) continue;
    if (rows.length === 1) {
      const best = usable.reduce((a, b) => distances[0]![a]! <= distances[0]![b]! ? a : b);
      matched.set(rows[0]!.index, previous[best]!);
      continue;
    }
    let scale = 1;
    for (const row of distances) for (const column of usable) if (Number.isFinite(row[column])) scale = Math.max(scale, row[column]!);
    // Real costs <= 1. An unmatched penalty above the total real-cost saving
    // maximizes eligible one-to-one associations before minimizing movement.
    const columns = usable.length + rows.length, unmatched = rows.length + 1, invalid = unmatched * unmatched;
    const cost = (row: number, column: number): number => column >= usable.length ? unmatched
      : Number.isFinite(distances[row]![usable[column]!]) ? distances[row]![usable[column]!]! / scale : invalid;
    const u = new Float64Array(rows.length + 1), v = new Float64Array(columns + 1);
    const p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
    for (let row = 1; row <= rows.length; row++) {
      p[0] = row;
      let column = 0;
      const minimum = new Float64Array(columns + 1).fill(Infinity), used = new Uint8Array(columns + 1);
      do {
        used[column] = 1;
        const active = p[column]!;
        let delta = Infinity, next = 0;
        for (let candidate = 1; candidate <= columns; candidate++) if (!used[candidate]) {
          const reduced = cost(active - 1, candidate - 1) - u[active]! - v[candidate]!;
          if (reduced < minimum[candidate]!) { minimum[candidate] = reduced; way[candidate] = column; }
          if (minimum[candidate]! < delta) { delta = minimum[candidate]!; next = candidate; }
        }
        for (let candidate = 0; candidate <= columns; candidate++) {
          if (used[candidate]) { u[p[candidate]!]! += delta; v[candidate]! -= delta; }
          else minimum[candidate]! -= delta;
        }
        column = next;
      } while (p[column] !== 0);
      do { const prior = way[column]!; p[column] = p[prior]!; column = prior; } while (column !== 0);
    }
    for (let column = 1; column <= usable.length; column++) {
      const row = p[column]! - 1;
      if (row >= 0 && Number.isFinite(distances[row]![usable[column - 1]!])) matched.set(rows[row]!.index, previous[usable[column - 1]!]!);
    }
  }
  return matched;
}
