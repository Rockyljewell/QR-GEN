// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { bounds, center } from "./engine/convert.js";
import type { Barcode, Size, TrackedBarcode } from "./types.js";

export interface TrackerOptions {
  /** Drop a track when it has not been seen for this long (ms). Default 500. */
  timeout?: number;
  /**
   * Maximum center distance, relative to the barcode's size, for a detection to continue
   * an existing track with the same data. Default 3 (codes can move fast between frames).
   */
  maxJump?: number;
}

export interface TrackerUpdate {
  tracked: TrackedBarcode[];
  added: TrackedBarcode[];
  updated: TrackedBarcode[];
  removed: TrackedBarcode[];
}

/** Match each payload group before updating tracks, so input order cannot consume another item's only match. */
function associate(detections: readonly Barcode[], tracks: readonly TrackedBarcode[], maxJump: number): Map<number, TrackedBarcode> {
  const groups = new Map<string, number[]>();
  const oldGroups = new Map<string, TrackedBarcode[]>();
  const key = (barcode: Barcode) => JSON.stringify([barcode.symbology, barcode.data]);
  detections.forEach((barcode, index) => {
    const group = groups.get(key(barcode)) ?? [];
    group.push(index);
    groups.set(key(barcode), group);
  });
  for (const track of tracks) {
    const group = oldGroups.get(key(track)) ?? [];
    group.push(track);
    oldGroups.set(key(track), group);
  }
  const matched = new Map<number, TrackedBarcode>();
  for (const [payload, indices] of groups) {
    const previous = oldGroups.get(payload);
    if (!previous?.length) continue;
    previous.sort((a, b) => a.id - b.id);
    const rows = indices.map(index => {
      const barcode = detections[index]!;
      const box = bounds(barcode.location);
      return { index, barcode, point: center(barcode.location), limit: Math.max(box.width, box.height, 1) * maxJump };
    }).sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index);
    const oldPoints = previous.map(track => center(track.location));
    const distances = rows.map(row => previous.map((track, index) => {
      const a = row.barcode.frameSize, b = track.frameSize;
      if (a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && (a.width !== b.width || a.height !== b.height)) return Infinity;
      const point = oldPoints[index]!;
      const distance = Math.hypot(point.x - row.point.x, point.y - row.point.y);
      return distance <= row.limit ? distance : Infinity;
    }));
    const usable = previous.map((_, index) => index).filter(index => distances.some(row => Number.isFinite(row[index])));
    if (!usable.length) continue;
    // Most payloads occur once. Avoid an assignment matrix for those groups.
    if (rows.length === 1) {
      const best = usable.reduce((a, b) => distances[0]![a]! <= distances[0]![b]! ? a : b);
      matched.set(rows[0]!.index, previous[best]!);
      continue;
    }
    let scale = 1;
    for (const row of distances) for (const column of usable) if (Number.isFinite(row[column])) scale = Math.max(scale, row[column]!);
    // Rectangular Hungarian assignment. Extra columns represent unmatched
    // detections. Their penalty exceeds every possible real-distance saving,
    // so cardinality takes priority, then total movement is minimized.
    const columns = usable.length + rows.length;
    const unmatched = rows.length + 1;
    const invalid = unmatched * unmatched;
    const cost = (row: number, column: number) => column >= usable.length ? unmatched
      : Number.isFinite(distances[row]![usable[column]!]) ? distances[row]![usable[column]!]! / scale : invalid;
    const u = new Float64Array(rows.length + 1), v = new Float64Array(columns + 1);
    const p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
    for (let row = 1; row <= rows.length; row++) {
      p[0] = row;
      let column = 0;
      const minimum = new Float64Array(columns + 1).fill(Infinity);
      const used = new Uint8Array(columns + 1);
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

/**
 * Follows many barcodes across frames (batch / "MatrixScan"-style scanning).
 * Identical codes in different places (e.g. two cans of the same product) get
 * separate observed tracks.
 */
export class BarcodeTracker {
  private tracks = new Map<number, TrackedBarcode>();
  private nextId = 1;
  private frameSize: Size | null = null;
  readonly timeout: number;
  readonly maxJump: number;

  constructor(options: TrackerOptions = {}) {
    this.timeout = options.timeout ?? 500;
    this.maxJump = options.maxJump ?? 3;
  }

  get size(): number {
    return this.tracks.size;
  }

  get all(): TrackedBarcode[] {
    return [...this.tracks.values()];
  }

  update(detections: readonly Barcode[], now = Date.now()): TrackerUpdate {
    const added: TrackedBarcode[] = [];
    const updated: TrackedBarcode[] = [];
    // Expire before matching, otherwise a returning detection revives an old
    // track (including its selection and count) after an arbitrarily long gap.
    const removed: TrackedBarcode[] = [];
    const size = detections.find(d => d.frameSize.width > 0 && d.frameSize.height > 0)?.frameSize;
    if (size) {
      if (this.frameSize && (size.width !== this.frameSize.width || size.height !== this.frameSize.height)) {
        removed.push(...this.tracks.values());
        this.tracks.clear();
      }
      this.frameSize = { ...size };
    }
    for (const [id, t] of this.tracks) {
      if (now - t.lastSeen > this.timeout) {
        this.tracks.delete(id);
        removed.push(t);
      }
    }

    const matched = associate(detections, this.all, this.maxJump);
    for (const [index, d] of detections.entries()) {
      const best = matched.get(index);
      if (best) {
        const next: TrackedBarcode = { ...d, id: best.id, firstSeen: best.firstSeen, lastSeen: now, count: best.count + 1 };
        this.tracks.set(best.id, next);
        updated.push(next);
      } else {
        const t: TrackedBarcode = { ...d, id: this.nextId++, firstSeen: now, lastSeen: now, count: 1 };
        this.tracks.set(t.id, t);
        added.push(t);
      }
    }

    return { tracked: this.all, added, updated, removed };
  }

  clear(): void {
    this.tracks.clear();
    this.frameSize = null;
  }
}
