// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Duplicate filter (SPEC section 4, `duplicateFilter`). Pure TypeScript.
 */
import { DurationClock } from './durationClock';
import type { DurationSample } from './durationClock';

/** Anything with a symbology and data, typically a `Barcode`. */
export interface DuplicateKeySource {
  symbology: string;
  data: string;
}

/** Returns the key the duplicate filter and tracker use for a code. */
export function barcodeKey(code: DuplicateKeySource): string {
  return `${code.symbology}\u0000${code.data}`;
}

const CLEANUP_THRESHOLD = 256;

interface PreparedFilter<T> {
  scanned: T[];
  commit(): void;
}

// The symbol keeps the transaction hook off the named public class API.
const prepareFrame = Symbol('prepareDuplicateFrame');

/** Internal spatial-session transaction; deliberately not a root-package export. */
export function prepareSpatialFilter<T extends DuplicateKeySource>(
  filter: DuplicateFilter, codes: readonly T[], now?: number,
): PreparedFilter<T> {
  return filter[prepareFrame](codes, now, true);
}

/**
 * Suppresses repeated reports of the same symbology + data.
 *
 * - `window > 0`: a code is reported, then ignored until `window` ms have
 *   passed since it was last reported.
 * - `window === 0`: every sighting is reported (every frame).
 * - `window < 0` (use `-1`): each code is reported once per session, until
 *   {@link DuplicateFilter.reset} is called.
 *
 * Omitted time uses monotonic durations. Explicit `now` supplies an injected
 * clock; changing clock sources rebases retained history by timestamp age.
 */
export class DuplicateFilter {
  private lastReported = new Map<string, number>();
  private lastReportedElapsed = new Map<string, number>();
  private clock = new DurationClock();
  private windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = DuplicateFilter.sanitize(windowMs);
  }

  private static sanitize(value: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 1000;
    return value < 0 ? -1 : value;
  }

  /** The current window in ms (`-1` means once per session). */
  get window(): number {
    return this.windowMs;
  }

  /** Changes the window. Existing history is kept. */
  set window(value: number) {
    this.windowMs = DuplicateFilter.sanitize(value);
  }

  /** Number of codes currently remembered. */
  get size(): number {
    return this.lastReported.size;
  }

  /**
   * Returns true when the code should be reported now, and records it.
   * Returns false for a duplicate.
   */
  accept(code: DuplicateKeySource, now?: number): boolean {
    if (this.windowMs === 0) return true;
    const key = barcodeKey(code);
    const sample = this.clock.preview(now);
    const elapsed = this.elapsedHistory(sample);
    const accepted = this.acceptAt(key, sample, this.lastReported, elapsed);
    this.lastReportedElapsed = elapsed;
    this.clock.commit(sample);
    return accepted;
  }

  /** Returns the codes that are not duplicates, in order, and records them. */
  filter<T extends DuplicateKeySource>(codes: readonly T[], now?: number): T[] {
    if (this.windowMs === 0) return codes.filter(() => true);
    // Read every caller-owned key before any history mutation; the remaining
    // work cannot throw, so update the live histories without copying them.
    // Copying made each frame O(history), which grows without bound for -1.
    const entries = codes.map(code => [code, barcodeKey(code)] as const);
    const sample = this.clock.preview(now);
    const elapsed = this.elapsedHistory(sample);
    const scanned = entries.filter(([, key]) => this.acceptAt(key, sample, this.lastReported, elapsed)).map(([code]) => code);
    this.lastReportedElapsed = elapsed;
    this.clock.commit(sample);
    return scanned;
  }

  [prepareFrame]<T extends DuplicateKeySource>(codes: readonly T[], now: number | undefined, strict: boolean): PreparedFilter<T> {
    if (this.windowMs === 0) return { scanned: codes.filter(() => true), commit() {} };
    // Resolve input before clock/history mutation, and sample only once per frame.
    const keys = codes.map(barcodeKey);
    const sample = this.clock.preview(now);
    const reported = new Map(this.lastReported);
    const elapsed = new Map(this.elapsedHistory(sample));
    if (strict && (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.elapsed)
      || [...reported.values(), ...elapsed.values()].some(value => !Number.isFinite(value)))) {
      throw new RangeError('Spatial duplicate filtering requires finite clocks and elapsed history');
    }
    const scanned = codes.filter((_, index) => this.acceptAt(keys[index]!, sample, reported, elapsed));
    return { scanned, commit: () => {
      this.lastReported = reported;
      this.lastReportedElapsed = elapsed;
      this.clock.commit(sample);
    } };
  }

  /** Forgets every code (starts a new session). */
  reset(): void {
    this.lastReported.clear();
    this.lastReportedElapsed.clear();
    this.clock.reset();
  }

  private elapsedHistory(sample: DurationSample): Map<string, number> {
    return sample.changed ? new Map([...this.lastReported].map(([key, timestamp]) =>
      [key, sample.elapsed - (sample.timestamp - timestamp)])) : this.lastReportedElapsed;
  }

  private acceptAt(
    key: string, sample: DurationSample, reported: Map<string, number>, elapsed: Map<string, number>,
  ): boolean {
    const last = elapsed.get(key);
    if (last !== undefined && (this.windowMs < 0 || sample.elapsed - last < this.windowMs)) return false;
    reported.set(key, sample.timestamp);
    elapsed.set(key, sample.elapsed);
    if (this.windowMs > 0 && reported.size > CLEANUP_THRESHOLD) {
      for (const [oldKey, time] of elapsed) {
        if (sample.elapsed - time >= this.windowMs) {
          reported.delete(oldKey);
          elapsed.delete(oldKey);
        }
      }
    }
    return true;
  }
}
