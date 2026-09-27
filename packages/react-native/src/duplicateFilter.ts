/**
 * Duplicate filter (SPEC section 4, `duplicateFilter`). Pure TypeScript.
 */

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

/**
 * Suppresses repeated reports of the same symbology + data.
 *
 * - `window > 0`: a code is reported, then ignored until `window` ms have
 *   passed since it was last reported.
 * - `window === 0`: every sighting is reported (every frame).
 * - `window < 0` (use `-1`): each code is reported once per session, until
 *   {@link DuplicateFilter.reset} is called.
 */
export class DuplicateFilter {
  private lastReported = new Map<string, number>();
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
  accept(code: DuplicateKeySource, now: number = Date.now()): boolean {
    if (this.windowMs === 0) return true;
    const key = barcodeKey(code);
    const last = this.lastReported.get(key);
    if (last !== undefined && (this.windowMs < 0 || now - last < this.windowMs)) return false;
    this.lastReported.set(key, now);
    if (this.windowMs > 0 && this.lastReported.size > CLEANUP_THRESHOLD) this.cleanup(now);
    return true;
  }

  /** Returns the codes that are not duplicates, in order, and records them. */
  filter<T extends DuplicateKeySource>(codes: readonly T[], now: number = Date.now()): T[] {
    return codes.filter((c) => this.accept(c, now));
  }

  /** Forgets every code (starts a new session). */
  reset(): void {
    this.lastReported.clear();
  }

  private cleanup(now: number): void {
    for (const [key, time] of this.lastReported) {
      if (now - time >= this.windowMs) this.lastReported.delete(key);
    }
  }
}
