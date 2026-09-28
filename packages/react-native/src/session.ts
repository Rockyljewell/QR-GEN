// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Scan session state machine shared by the scanner components: applies the
 * mode (`single` / `continuous` / `batch`), the duplicate filter and the batch
 * tracker to the codes decoded in each frame. Pure TypeScript.
 */
import { DuplicateFilter } from './duplicateFilter';
import { BarcodeTracker, DEFAULT_TRACKING_TIMEOUT } from './tracker';
import type { Barcode, ScanMode, TrackedBarcode } from './types';

/** Options for {@link ScanSession}. */
export interface ScanSessionOptions {
  mode?: ScanMode;
  /** Duplicate window in ms (`0` every frame, `-1` once per session). Default 1000. */
  duplicateFilter?: number;
  /** Batch tracking timeout in ms. Default 500. */
  trackingTimeout?: number;
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

  constructor(options: ScanSessionOptions = {}) {
    this.currentMode = options.mode ?? 'continuous';
    this.filter = new DuplicateFilter(options.duplicateFilter ?? 1000);
    this.tracker = new BarcodeTracker({ timeout: options.trackingTimeout ?? DEFAULT_TRACKING_TIMEOUT });
  }

  /** Current mode. */
  get mode(): ScanMode {
    return this.currentMode;
  }

  /** True after a `single` mode scan, until {@link resume} or {@link reset}. */
  get stopped(): boolean {
    return this.done;
  }

  /** Every code currently tracked (batch mode). */
  get tracked(): TrackedBarcode[] {
    return this.tracker.tracked;
  }

  /** Applies new options. Changing the mode clears the tracker and resumes. */
  configure(options: ScanSessionOptions): void {
    if (options.duplicateFilter !== undefined) this.filter.window = options.duplicateFilter;
    if (options.mode !== undefined && options.mode !== this.currentMode) {
      this.currentMode = options.mode;
      this.tracker.reset();
      this.done = false;
    }
  }

  /** Feeds the codes decoded in one frame. */
  process(barcodes: readonly Barcode[], now: number = Date.now()): ScanSessionResult {
    if (this.done) return EMPTY;
    switch (this.currentMode) {
      case 'single': {
        const scanned = this.filter.filter(barcodes, now);
        if (scanned.length === 0) return EMPTY;
        this.done = true;
        return { scanned, tracked: null, stop: true };
      }
      case 'batch': {
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
  tick(now: number = Date.now()): TrackedBarcode[] | null {
    if (this.currentMode !== 'batch') return null;
    const update = this.tracker.prune(now);
    return update.changed ? update.tracked : null;
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
}
