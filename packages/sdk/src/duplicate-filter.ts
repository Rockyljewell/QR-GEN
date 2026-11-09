// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { Barcode } from "./types.js";

/**
 * Suppresses repeated reports of the same code.
 *
 * - `window > 0`: a code (symbology + data) is reported at most once per `window` ms.
 * - `window === 0`: every detection is reported.
 * - `window < 0`: each code is reported once until `reset()`.
 */
export class DuplicateFilter {
  private seen = new Map<string, { timestamp: number; elapsed: number }>();
  private elapsedClock = false;

  constructor(public window = 1000) {}

  static key(b: Pick<Barcode, "symbology" | "data">): string {
    return `${b.symbology}\u0000${b.data}`;
  }

  /** Returns true when the barcode should be reported (and records it). */
  accept(b: Pick<Barcode, "symbology" | "data">, now?: number): boolean {
    if (this.window === 0) return true;
    const timestamp = now === undefined ? Date.now() : now;
    const elapsedClock = now === undefined && typeof performance !== "undefined" && typeof performance.now === "function";
    const elapsed = elapsedClock ? performance.now() : timestamp;
    if (elapsedClock !== this.elapsedClock) {
      // Explicit times retain their original timestamp semantics. On a source
      // change, preserve each entry's timestamp age in the new duration clock.
      for (const entry of this.seen.values()) entry.elapsed = elapsedClock ? elapsed - (timestamp - entry.timestamp) : entry.timestamp;
      this.elapsedClock = elapsedClock;
    }
    const key = DuplicateFilter.key(b);
    const last = this.seen.get(key);
    if (last !== undefined && (this.window < 0 || elapsed - last.elapsed < this.window)) return false;
    this.seen.set(key, { timestamp, elapsed });
    if (this.seen.size > 5000) this.prune(elapsed);
    return true;
  }

  private prune(now: number): void {
    if (this.window < 0) return;
    for (const [k, t] of this.seen) if (now - t.elapsed >= this.window) this.seen.delete(k);
  }

  reset(): void {
    this.seen.clear();
    this.elapsedClock = false;
  }
}
