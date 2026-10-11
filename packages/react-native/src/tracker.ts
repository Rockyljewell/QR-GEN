// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Batch tracker (SPEC section 4, `mode: "batch"`). Pure TypeScript.
 */
import { barcodeKey } from './duplicateFilter';
import { associateSpatial, associationWork, snapshotBarcode, spatialSize, validateSpatialFrame } from './spatialAssociation';
import { DurationClock } from './durationClock';
import type { DurationSample } from './durationClock';
import type { Barcode, Size, TrackedBarcode } from './types';

/** Default time after which an unseen code is dropped, in ms. */
export const DEFAULT_TRACKING_TIMEOUT = 500;

/**
 * Deterministic base tracking id for a code: `<symbology>-<fnv1a32(data) as 8 hex digits>`.
 * Trackers append a suffix on hash collision to keep active IDs unique.
 * The same symbology and data give the same base on platforms using this scheme.
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
  /** Codes dropped after `timeout` ms unseen or a spatial frame-size change. */
  removed: TrackedBarcode[];
  /** True when anything was seen, added or removed. */
  changed: boolean;
}

/** Options for {@link BarcodeTracker}. */
export interface TrackerOptions {
  /** Drop codes not seen for this many ms. Default 500. */
  timeout?: number;
  /** Separate equal-payload observations by position. Default false. */
  spatial?: boolean;
  /** Spatial center-distance gate relative to the detection's size. Default 3. */
  maxJump?: number;
  /** Positive integer assignment-work limit. Default 250,000; not a time guarantee. */
  maxAssociationWork?: number;
}

function spatialTime(sample: DurationSample): void {
  if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.elapsed)) throw new RangeError('Spatial tracking requires finite epoch and elapsed clocks');
}

/**
 * Follows codes across frames. Default payload mode groups by symbology + data
 * and derives IDs from {@link trackingId}. Optional spatial mode uses fresh opaque
 * IDs and whole-frame gated one-to-one association: most matches, then least
 * total center movement. Tracks describe observations, not confirmed quantities
 * or persistent physical identity. Unseen tracks expire after `timeout` ms.
 * Omitted time uses monotonic durations while result timestamps remain epoch
 * milliseconds. Explicit time is an injected clock; transitions preserve timestamp age.
 */
export class BarcodeTracker {
  readonly timeout: number;
  private items = new Map<string, TrackedBarcode>();
  private activeIds = new Set<string>();
  private readonly spatialPolicy: boolean;
  private readonly jumpPolicy: number;
  private readonly workPolicy: number;
  private spatialFrameSize: Size | null = null;
  private nextSpatialId = 1;
  private lastObserved = new Map<string, number>();
  private clock = new DurationClock();

  constructor(options: TrackerOptions = {}) {
    const t = options.timeout;
    this.timeout = typeof t === 'number' && t >= 0 && Number.isFinite(t) ? t : DEFAULT_TRACKING_TIMEOUT;
    const spatialOption = options.spatial, jumpOption = options.maxJump, workOption = options.maxAssociationWork;
    const spatial = spatialOption === undefined ? false : spatialOption;
    const jump = jumpOption === undefined ? 3 : jumpOption;
    const work = workOption === undefined ? 250_000 : workOption;
    if (typeof spatial !== 'boolean') throw new TypeError('spatial must be a boolean');
    if (typeof jump !== 'number' || !Number.isFinite(jump) || jump < 0) throw new RangeError('maxJump must be finite and nonnegative');
    if (!Number.isSafeInteger(work) || work <= 0) throw new RangeError('maxAssociationWork must be a positive safe integer');
    this.spatialPolicy = spatial;
    this.jumpPolicy = jump;
    this.workPolicy = work;
  }

  /** Construction-only tracking policy. */
  get spatial(): boolean { return this.spatialPolicy; }
  /** Construction-only movement gate. */
  get maxJump(): number { return this.jumpPolicy; }
  /** Construction-only conservative assignment-work budget. */
  get maxAssociationWork(): number { return this.workPolicy; }

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
   * Spatial records require usable corners and consistent positive integer source
   * dimensions. `frameSize` detects coordinate-space changes on empty frames;
   * default payload mode ignores it. Clear on same-size source changes.
   * Invalid or over-budget spatial input leaves state unchanged. Work sums
   * `n*n*(m+n)` over exact-payload groups with `m > 0` surviving prior tracks;
   * new-only groups require no assignment. Raise the budget explicitly for larger
   * offline workloads; this is not a latency or memory guarantee.
   */
  update(barcodes: readonly Barcode[], now?: number, frameSize?: Size): TrackerUpdate {
    if (this.spatial) return this.updateSpatial(barcodes, now, frameSize);
    const sample = this.clock.preview(now);
    const items = new Map(this.items), activeIds = new Set(this.activeIds);
    const observed = new Map(this.elapsedHistory(sample));
    const removed = this.dropStale(sample.elapsed, items, activeIds, observed);
    const added: TrackedBarcode[] = [];
    const seenThisFrame = new Set<string>();
    for (const b of barcodes) {
      const key = barcodeKey(b);
      if (seenThisFrame.has(key)) continue;
      seenThisFrame.add(key);
      const existing = items.get(key);
      if (existing) {
        items.set(key, { ...b, id: existing.id, firstSeen: existing.firstSeen, lastSeen: sample.timestamp, count: existing.count + 1 });
      } else {
        const item: TrackedBarcode = { ...b, id: this.allocateId(trackingId(b.symbology, b.data), activeIds), firstSeen: sample.timestamp, lastSeen: sample.timestamp, count: 1 };
        items.set(key, item);
        added.push(item);
      }
      observed.set(key, sample.elapsed);
    }
    this.items = items;
    this.activeIds = activeIds;
    this.lastObserved = observed;
    this.clock.commit(sample);
    return { tracked: this.tracked, added, removed, changed: seenThisFrame.size > 0 || removed.length > 0 };
  }

  /** Removes codes unseen for longer than `timeout`. Call it on a timer when no frames arrive. */
  prune(now?: number): TrackerUpdate {
    if (this.spatial) return this.updateSpatial([], now);
    const sample = this.clock.preview(now);
    const items = new Map(this.items), activeIds = new Set(this.activeIds);
    const observed = new Map(this.elapsedHistory(sample));
    const removed = this.dropStale(sample.elapsed, items, activeIds, observed);
    this.items = items;
    this.activeIds = activeIds;
    this.lastObserved = observed;
    this.clock.commit(sample);
    return { tracked: this.tracked, added: [], removed, changed: removed.length > 0 };
  }

  /** Forgets every tracked code. */
  reset(): void {
    this.items.clear();
    this.activeIds.clear();
    this.spatialFrameSize = null;
    this.lastObserved.clear();
    this.clock.reset();
  }

  private updateSpatial(barcodes: readonly Barcode[], value: number | undefined, frameSize?: Size): TrackerUpdate {
    const detections = Array.from(barcodes, snapshotBarcode);
    const size = validateSpatialFrame(detections, this.maxJump, frameSize === undefined ? undefined : spatialSize(frameSize));
    const retained = [...this.items].map(([id, value]) => {
      const track = snapshotBarcode(value);
      if (track.id !== id || typeof track.id !== 'string' || !Number.isFinite(track.firstSeen) || !Number.isFinite(track.lastSeen)
        || !Number.isSafeInteger(track.count) || track.count <= 0) {
        throw new RangeError('Spatial retained track identity, timestamps and count must be valid');
      }
      return track;
    });
    validateSpatialFrame(retained, this.maxJump, this.spatialFrameSize ?? undefined);
    const sample = this.clock.preview(value);
    spatialTime(sample);
    const now = sample.timestamp;
    // Rebase from the validated snapshots, using the same timestamp-age policy
    // as payload mode, without rereading caller-owned getters or mutating history.
    const observed = sample.changed ? new Map(retained.map(track =>
      [track.id, sample.elapsed - (sample.timestamp - track.lastSeen)])) : new Map(this.lastObserved);
    for (const track of retained) {
      if (!Number.isFinite(observed.get(track.id))) throw new RangeError('Spatial elapsed history must remain finite');
    }
    const reset = size !== null && this.spatialFrameSize !== null
      && (size.width !== this.spatialFrameSize.width || size.height !== this.spatialFrameSize.height);
    const removed = retained.filter(track => reset || sample.elapsed - observed.get(track.id)! > this.timeout);
    const previous = retained.filter(track => !reset && sample.elapsed - observed.get(track.id)! <= this.timeout);
    for (const track of removed) observed.delete(track.id);
    const work = associationWork(detections, previous);
    if (work > this.maxAssociationWork) throw new RangeError(`Spatial association work ${work} exceeds maxAssociationWork=${this.maxAssociationWork}`);
    const matched = associateSpatial(detections, previous, this.maxJump);
    const next = new Map(previous.map(track => [track.id, track]));
    const added: TrackedBarcode[] = [];
    let ordinal = this.nextSpatialId;
    for (let index = 0; index < detections.length; index++) {
      const barcode = detections[index]!;
      const old = matched.get(index);
      let item: TrackedBarcode;
      if (old) {
        if (!Number.isSafeInteger(old.count + 1)) throw new RangeError('Spatial observation count exceeds safe integer range');
        item = { ...barcode, id: old.id, firstSeen: old.firstSeen, lastSeen: now, count: old.count + 1 };
      } else {
        if (!Number.isSafeInteger(ordinal + 1)) throw new RangeError('Spatial tracking ID range exhausted');
        item = { ...barcode, id: `spatial-${ordinal++}`, firstSeen: now, lastSeen: now, count: 1 };
        added.push(item);
      }
      next.set(item.id, item);
      observed.set(item.id, sample.elapsed);
    }
    const result = { tracked: [...next.values()], added, removed, changed: detections.length > 0 || removed.length > 0 };
    // The complete output and ID plan exist before the first state mutation.
    this.items = next;
    this.lastObserved = observed;
    this.nextSpatialId = ordinal;
    if (size !== null) this.spatialFrameSize = size;
    this.clock.commit(sample);
    return result;
  }

  private allocateId(base: string, activeIds: Set<string>): string {
    let id = base;
    let suffix = 1;
    while (activeIds.has(id)) id = `${base}-${suffix++}`;
    activeIds.add(id);
    return id;
  }

  private elapsedHistory(sample: DurationSample): Map<string, number> {
    return sample.changed ? new Map([...this.items].map(([key, item]) =>
      [key, sample.elapsed - (sample.timestamp - item.lastSeen)])) : this.lastObserved;
  }

  private dropStale(
    elapsed: number, items: Map<string, TrackedBarcode>, activeIds: Set<string>, observed: Map<string, number>,
  ): TrackedBarcode[] {
    const removed: TrackedBarcode[] = [];
    for (const [key, item] of items) {
      if (elapsed - observed.get(key)! > this.timeout) {
        items.delete(key);
        activeIds.delete(item.id);
        observed.delete(key);
        removed.push(item);
      }
    }
    return removed;
  }
}
