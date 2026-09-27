import type { Barcode } from "./types.js";

/**
 * Suppresses repeated reports of the same code.
 *
 * - `window > 0`: a code (symbology + data) is reported at most once per `window` ms.
 * - `window === 0`: every detection is reported.
 * - `window < 0`: each code is reported once until `reset()`.
 */
export class DuplicateFilter {
  private seen = new Map<string, number>();

  constructor(public window = 1000) {}

  static key(b: Pick<Barcode, "symbology" | "data">): string {
    return `${b.symbology}\u0000${b.data}`;
  }

  /** Returns true when the barcode should be reported (and records it). */
  accept(b: Pick<Barcode, "symbology" | "data">, now = Date.now()): boolean {
    if (this.window === 0) return true;
    const key = DuplicateFilter.key(b);
    const last = this.seen.get(key);
    if (last !== undefined && (this.window < 0 || now - last < this.window)) return false;
    this.seen.set(key, now);
    if (this.seen.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    if (this.window < 0) return;
    for (const [k, t] of this.seen) if (now - t >= this.window) this.seen.delete(k);
  }

  reset(): void {
    this.seen.clear();
  }
}
