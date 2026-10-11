// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Scan session state machine shared by the scanner components: applies the
 * mode (`single` / `continuous` / `batch`), the duplicate filter and the batch
 * tracker to the codes decoded in each frame. Pure TypeScript.
 */
import { DuplicateFilter, prepareSpatialFilter } from './duplicateFilter';
import { snapshotBarcode, spatialSize, validateSpatialFrame } from './spatialAssociation';
import { BarcodeTracker, DEFAULT_TRACKING_TIMEOUT } from './tracker';
import type { Barcode, ScanMode, Size, TrackedBarcode } from './types';

/** Options for {@link ScanSession}. */
export interface ScanSessionOptions {
  mode?: ScanMode;
  /** Duplicate window in ms (`0` every frame, `-1` once per session). Default 1000. */
  duplicateFilter?: number;
  /** Batch tracking timeout in ms. Default 500. */
  trackingTimeout?: number;
  /** Separate equal-payload batch observations by position. Default false. */
  spatialTracking?: boolean;
  /** Spatial movement gate relative to detection size. Default 3. */
  trackMaxJump?: number;
  /** Positive safe-integer spatial assignment-work budget. Default 250,000. */
  trackMaxAssociationWork?: number;
}

/** What the component should do after a frame. */
export interface ScanSessionResult {
  /** Codes to report through `onScan` (already de-duplicated). */
  scanned: Barcode[];
  /** Batch mode: the full tracked list when it changed, else `null`. */
  tracked: TrackedBarcode[] | null;
  /** `single` mode: true when scanning must stop now. */
  stop: boolean;
}

const EMPTY: ScanSessionResult = Object.freeze({ scanned: [], tracked: null, stop: false }) as ScanSessionResult;

/** Mode, duplicate filter and tracker logic, independent of any camera. */
export class ScanSession {
  private filter: DuplicateFilter;
  private tracker: BarcodeTracker;
  private currentMode: ScanMode;
  private done = false;
  private policyGeneration = 0;

  constructor(options: ScanSessionOptions = {}) {
    const { mode, duplicateFilter, trackingTimeout, spatialTracking, trackMaxJump, trackMaxAssociationWork } = options;
    this.currentMode = mode ?? 'continuous';
    this.filter = new DuplicateFilter(duplicateFilter ?? 1000);
    this.tracker = new BarcodeTracker({ timeout: trackingTimeout ?? DEFAULT_TRACKING_TIMEOUT,
      spatial: spatialTracking, maxJump: trackMaxJump, maxAssociationWork: trackMaxAssociationWork });
  }

  /** Current mode. */
  get mode(): ScanMode {
    return this.currentMode;
  }

  /** True after a `single` mode scan, until {@link resume} or {@link reset}. */
  get stopped(): boolean {
    return this.done;
  }

  /** Current accepted batch tracking policy. */
  get spatialTracking(): boolean { return this.tracker.spatial; }
  get trackMaxJump(): number { return this.tracker.maxJump; }
  get trackMaxAssociationWork(): number { return this.tracker.maxAssociationWork; }

  /** Every code currently tracked (batch mode). */
  get tracked(): TrackedBarcode[] {
    return this.publicTracks(this.tracker.tracked);
  }

  /**
   * Applies options atomically. A changed spatial policy clears tracks while
   * preserving duplicate history. Changing the mode also resumes scanning.
   * The construction-time tracking timeout remains unchanged.
   */
  configure(options: ScanSessionOptions): void {
    // Preserve the established configure contract: do not read ignored timeout.
    const { mode, duplicateFilter, spatialTracking, trackMaxJump, trackMaxAssociationWork } = options;
    const candidate = new BarcodeTracker({ timeout: this.tracker.timeout,
      spatial: spatialTracking === undefined ? this.spatialTracking : spatialTracking,
      maxJump: trackMaxJump === undefined ? this.trackMaxJump : trackMaxJump,
      maxAssociationWork: trackMaxAssociationWork === undefined ? this.trackMaxAssociationWork : trackMaxAssociationWork });
    const replaced = candidate.spatial !== this.spatialTracking || candidate.maxJump !== this.trackMaxJump
      || candidate.maxAssociationWork !== this.trackMaxAssociationWork;
    const generation = this.policyGeneration + (replaced ? 1 : 0);
    if (!Number.isSafeInteger(generation)) throw new RangeError('Spatial policy generation range exhausted');
    // Every fallible read/validation is complete before changing session state.
    if (duplicateFilter !== undefined) this.filter.window = duplicateFilter;
    if (replaced) {
      this.tracker = candidate;
      this.policyGeneration = generation;
    }
    if (mode !== undefined && mode !== this.currentMode) {
      this.currentMode = mode;
      if (!replaced) this.tracker.reset();
      this.done = false;
    }
  }

  /**
   * Feeds one frame. Spatial batch records require their own valid source size;
   * optional frameSize also detects blank resize frames. Other modes ignore it.
   * Rejected spatial frames leave both histories and tracking IDs unchanged.
   */
  process(barcodes: readonly Barcode[], now?: number, frameSize?: Size): ScanSessionResult {
    if (this.done) return EMPTY;
    switch (this.currentMode) {
      case 'single': {
        const scanned = this.filter.filter(barcodes, now);
        if (scanned.length === 0) return EMPTY;
        this.done = true;
        return { scanned, tracked: null, stop: true };
      }
      case 'batch': {
        if (this.spatialTracking) return this.processSpatial(barcodes, now, frameSize);
        const update = this.tracker.update(barcodes, now);
        const scanned = this.filter.filter(barcodes, now);
        return { scanned, tracked: update.changed ? update.tracked : null, stop: false };
      }
      default:
        return { scanned: this.filter.filter(barcodes, now), tracked: null, stop: false };
    }
  }

  /**
   * Batch mode housekeeping for frames without codes: drops codes unseen for
   * longer than the tracking timeout. Returns the tracked list when it changed.
   */
  tick(now?: number): TrackedBarcode[] | null {
    if (this.currentMode !== 'batch') return null;
    const update = this.tracker.prune(now);
    return update.changed ? this.publicTracks(update.tracked) : null;
  }

  /** Clears spatial observations only; returns an empty-list change once. */
  resetSpatial(): TrackedBarcode[] | null {
    if (!this.spatialTracking) return null;
    const changed = this.tracker.size > 0;
    this.tracker.reset();
    return changed ? [] : null;
  }

  /** Continues after a `single` mode scan. Duplicate history is kept. */
  resume(): void {
    this.done = false;
  }

  /** Starts a new session: clears duplicate history and tracked codes, and resumes. */
  reset(): void {
    this.filter.reset();
    this.tracker.reset();
    this.done = false;
  }

  private processSpatial(barcodes: readonly Barcode[], now: number | undefined, frameSize?: Size): ScanSessionResult {
    const canonical = Array.from(barcodes, snapshotBarcode);
    const size = frameSize === undefined ? undefined : spatialSize(frameSize);
    validateSpatialFrame(canonical, this.trackMaxJump, size);
    const plan = prepareSpatialFilter(this.filter, canonical, now);
    const update = this.tracker.update(canonical, now, size);
    const result = { scanned: plan.scanned, tracked: update.changed ? this.publicTracks(update.tracked) : null, stop: false };
    // Tracker output is plain data. No caller or clock reads remain after its commit.
    plan.commit();
    return result;
  }

  private publicTracks(tracks: TrackedBarcode[]): TrackedBarcode[] {
    if (!this.spatialTracking) return tracks;
    return tracks.map(track => ({ ...track, id: `spatial-${this.policyGeneration}:${track.id}` }));
  }
}
