// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { bounds, center } from "./engine/convert.js";
import type { Barcode, TrackedBarcode } from "./types.js";

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

/**
 * Follows many barcodes across frames (batch / "MatrixScan"-style scanning).
 * Identical codes in different places (e.g. two cans of the same product) get
 * separate tracks, so counting works.
 */
export class BarcodeTracker {
  private tracks = new Map<number, TrackedBarcode>();
  private nextId = 1;
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
    const claimed = new Set<number>();

    for (const d of detections) {
      const c = center(d.location);
      const b = bounds(d.location);
      const size = Math.max(b.width, b.height, 1);
      let best: TrackedBarcode | undefined;
      let bestDist = Infinity;
      for (const t of this.tracks.values()) {
        if (claimed.has(t.id) || t.symbology !== d.symbology || t.data !== d.data) continue;
        const tc = center(t.location);
        const dist = Math.hypot(tc.x - c.x, tc.y - c.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
        }
      }
      if (best && bestDist <= size * this.maxJump) {
        claimed.add(best.id);
        const next: TrackedBarcode = { ...d, id: best.id, firstSeen: best.firstSeen, lastSeen: now, count: best.count + 1 };
        this.tracks.set(best.id, next);
        updated.push(next);
      } else {
        const t: TrackedBarcode = { ...d, id: this.nextId++, firstSeen: now, lastSeen: now, count: 1 };
        this.tracks.set(t.id, t);
        claimed.add(t.id);
        added.push(t);
      }
    }

    const removed: TrackedBarcode[] = [];
    for (const [id, t] of this.tracks) {
      if (!claimed.has(id) && now - t.lastSeen > this.timeout) {
        this.tracks.delete(id);
        removed.push(t);
      }
    }
    return { tracked: this.all, added, updated, removed };
  }

  clear(): void {
    this.tracks.clear();
  }
}
