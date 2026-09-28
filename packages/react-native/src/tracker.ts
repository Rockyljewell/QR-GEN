// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Batch tracker (SPEC section 4, `mode: "batch"`). Pure TypeScript.
 */
import { barcodeKey } from './duplicateFilter';
import type { Barcode, TrackedBarcode } from './types';

/** Default time after which an unseen code is dropped, in ms. */
export const DEFAULT_TRACKING_TIMEOUT = 500;

/**
 * Stable tracking id for a code: `<symbology>-<fnv1a32(data) as 8 hex digits>`.
 * The same symbology and data always give the same id, on every QRGen platform.
 */
export function trackingId(symbology: string, data: string): string {
  // FNV-1a 32 bit over the UTF-16 code units of the data.
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${symbology}-${hash.toString(16).padStart(8, '0')}`;
}

/** Result of a tracker update. */
export interface TrackerUpdate {
  /** Every code currently tracked, oldest first. */
  tracked: TrackedBarcode[];
  /** Codes seen for the first time in this update. */
  added: TrackedBarcode[];
  /** Codes dropped because they were not seen for `timeout` ms. */
  removed: TrackedBarcode[];
  /** True when anything was seen, added or removed. */
  changed: boolean;
}

/** Options for {@link BarcodeTracker}. */
export interface TrackerOptions {
  /** Drop codes not seen for this many ms. Default 500. */
  timeout?: number;
}

/**
 * Follows codes across frames. Codes are identified by symbology + data, get a
 * stable {@link trackingId}, and are dropped after `timeout` ms unseen.
 */
export class BarcodeTracker {
  readonly timeout: number;
  private items = new Map<string, TrackedBarcode>();

  constructor(options: TrackerOptions = {}) {
    const t = options.timeout;
    this.timeout = typeof t === 'number' && t >= 0 && Number.isFinite(t) ? t : DEFAULT_TRACKING_TIMEOUT;
  }

  /** Number of codes currently tracked. */
  get size(): number {
    return this.items.size;
  }

  /** Snapshot of every tracked code, oldest first. */
  get tracked(): TrackedBarcode[] {
    return [...this.items.values()];
  }

  /**
   * Feeds the codes decoded in one frame. Known codes get their location and
   * timestamp refreshed and their `count` incremented (once per frame); new
   * codes are added; codes unseen for longer than `timeout` are removed.
   */
  update(barcodes: readonly Barcode[], now: number = Date.now()): TrackerUpdate {
    const added: TrackedBarcode[] = [];
    const seenThisFrame = new Set<string>();
    for (const b of barcodes) {
      const key = barcodeKey(b);
      if (seenThisFrame.has(key)) continue;
      seenThisFrame.add(key);
      const existing = this.items.get(key);
      if (existing) {
        this.items.set(key, { ...b, id: existing.id, firstSeen: existing.firstSeen, lastSeen: now, count: existing.count + 1 });
      } else {
        const item: TrackedBarcode = { ...b, id: trackingId(b.symbology, b.data), firstSeen: now, lastSeen: now, count: 1 };
        this.items.set(key, item);
        added.push(item);
      }
    }
    const removed = this.dropStale(now);
    return { tracked: this.tracked, added, removed, changed: seenThisFrame.size > 0 || removed.length > 0 };
  }

  /** Removes codes unseen for longer than `timeout`. Call it on a timer when no frames arrive. */
  prune(now: number = Date.now()): TrackerUpdate {
    const removed = this.dropStale(now);
    return { tracked: this.tracked, added: [], removed, changed: removed.length > 0 };
  }

  /** Forgets every tracked code. */
  reset(): void {
    this.items.clear();
  }

  private dropStale(now: number): TrackedBarcode[] {
    const removed: TrackedBarcode[] = [];
    for (const [key, item] of this.items) {
      if (now - item.lastSeen > this.timeout) {
        this.items.delete(key);
        removed.push(item);
      }
    }
    return removed;
  }
}
