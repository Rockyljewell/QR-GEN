// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

/** Internal duration clock. Public result metadata remains epoch milliseconds. */
type ClockSource = 'explicit' | 'monotonic' | 'wall';

export interface DurationSample {
  timestamp: number;
  elapsed: number;
  source: ClockSource;
  changed: boolean;
}

export class DurationClock {
  private source: ClockSource | undefined;

  /** Read without consuming a source transition; callers may reject their plan. */
  preview(now?: number): DurationSample {
    const timestamp = now === undefined ? Date.now() : now;
    const clock = (globalThis as typeof globalThis & { performance?: { now(): number } }).performance;
    const source: ClockSource = now !== undefined ? 'explicit'
      : typeof clock?.now === 'function' ? 'monotonic' : 'wall';
    // React Native >= 0.73 and supported Node provide performance.now(). The
    // fallback preserves legacy behavior in unsupported pure-JS environments.
    const elapsed = source === 'monotonic' ? clock!.now() : timestamp;
    return { timestamp, elapsed, source, changed: this.source !== undefined && this.source !== source };
  }

  commit(sample: DurationSample): void {
    this.source = sample.source;
  }

  reset(): void {
    this.source = undefined;
  }
}
