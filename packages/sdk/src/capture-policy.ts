// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { QRGenError } from "./errors.js";

/** Absolute input limits for the opt-in capture experiment. Fixed capture is unchanged. */
export const MAX_ADAPTIVE_DECODE_SIZE = 2048;
export const MAX_ADAPTIVE_DECODE_PIXELS = 4_194_304;

/** Experimental full-frame capture policy. No camera constraints or decoder options change. */
export interface AdaptiveCaptureOptions {
  /** Initial low-cost longest side. Default min(640, maxDecodeSize). */
  initialDecodeSize?: number;
  /** Smallest low-cost longest side. Default min(320, initialDecodeSize). */
  minDecodeSize?: number;
  /** Maximum input pixels for every adaptive decode. Default 1,048,576; maximum 4,194,304. */
  maxDecodePixels?: number;
  /** Completed normal frames between discovery attempts. Integer 2..120; default 8. */
  discoveryInterval?: number;
  /** Consecutive unsuccessful frames before discovery is eligible. Integer 1..120; default 3. */
  missesBeforeDiscovery?: number;
  /** Target decoder time in milliseconds. 1..1000; default 32. */
  targetDecodeMs?: number;
}

export interface ResolvedAdaptiveCaptureOptions {
  readonly initialDecodeSize: number;
  readonly minDecodeSize: number;
  readonly maxDecodeSize: number;
  readonly maxDecodePixels: number;
  readonly discoveryInterval: number;
  readonly missesBeforeDiscovery: number;
  readonly targetDecodeMs: number;
}

export interface AdaptiveCapturePlan {
  readonly phase: "normal" | "discovery";
  readonly maxDecodeSize: number;
  readonly maxDecodePixels: number;
}

export interface AdaptiveCaptureSnapshot {
  readonly normalDecodeSize: number;
  readonly consecutiveMisses: number;
  readonly consecutiveSuccesses: number;
  readonly completedFrames: number;
}

/** Last accepted adaptive frame. Dimensions describe decoder input, not the camera. */
export interface AdaptiveCaptureStats extends AdaptiveCaptureSnapshot {
  readonly phase: AdaptiveCapturePlan["phase"];
  readonly width: number;
  readonly height: number;
  /** Decoder-only elapsed time, excluding canvas capture. */
  readonly decodeMs: number;
}

function bounded(name: string, value: number, min: number, max: number, integer = true): number {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new QRGenError("bad-request", `adaptive ${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}

export function resolveAdaptiveCaptureOptions(
  input: boolean | AdaptiveCaptureOptions | undefined,
  maxDecodeSize: number,
): ResolvedAdaptiveCaptureOptions | null {
  if (input === undefined || input === false) return null;
  if (input !== true && (input === null || typeof input !== "object" || Array.isArray(input))) {
    throw new QRGenError("bad-request", "adaptive must be a boolean or an options object.");
  }
  const o: AdaptiveCaptureOptions = input === true ? {} : input;
  const value = (key: keyof AdaptiveCaptureOptions, fallback: number): number => o[key] === undefined ? fallback : o[key]!;
  // A larger fixed-capture preference cannot bypass the experiment's absolute side cap.
  const maxSize = Math.min(MAX_ADAPTIVE_DECODE_SIZE, bounded("maxDecodeSize", maxDecodeSize, 16, 16_384));
  const initial = bounded("initialDecodeSize", value("initialDecodeSize", Math.min(640, maxSize)), 16, maxSize);
  const min = bounded("minDecodeSize", value("minDecodeSize", Math.min(320, initial)), 16, initial);
  return Object.freeze({
    initialDecodeSize: initial,
    minDecodeSize: min,
    maxDecodeSize: maxSize,
    maxDecodePixels: bounded("maxDecodePixels", value("maxDecodePixels", 1_048_576), 256, MAX_ADAPTIVE_DECODE_PIXELS),
    discoveryInterval: bounded("discoveryInterval", value("discoveryInterval", 8), 2, 120),
    missesBeforeDiscovery: bounded("missesBeforeDiscovery", value("missesBeforeDiscovery", 3), 1, 120),
    targetDecodeMs: bounded("targetDecodeMs", value("targetDecodeMs", 32), 1, 1000, false),
  });
}

/**
 * Pure scheduling policy: next() does not advance it; only completed, accepted
 * decodes do. Two slow normal decodes reduce work; three fast normal successes
 * can restore it. A successful discovery within the time budget retains its
 * proven resolution. Discovery always scans the whole selected area.
 */
export class AdaptiveCapturePolicy {
  private normalSize: number;
  private recoverySize: number;
  private misses = 0;
  private successes = 0;
  private frames = 0;
  private sinceDiscovery = 0;
  private slowFrames = 0;
  private fastSuccesses = 0;

  constructor(private readonly options: ResolvedAdaptiveCaptureOptions) {
    this.normalSize = options.initialDecodeSize;
    this.recoverySize = options.initialDecodeSize;
  }

  get snapshot(): AdaptiveCaptureSnapshot {
    return {
      normalDecodeSize: this.normalSize,
      consecutiveMisses: this.misses,
      consecutiveSuccesses: this.successes,
      completedFrames: this.frames,
    };
  }

  next(): AdaptiveCapturePlan {
    const discovery = this.misses >= this.options.missesBeforeDiscovery && this.sinceDiscovery >= this.options.discoveryInterval;
    return {
      phase: discovery ? "discovery" : "normal",
      maxDecodeSize: discovery ? this.options.maxDecodeSize : this.normalSize,
      maxDecodePixels: this.options.maxDecodePixels,
    };
  }

  observe(plan: AdaptiveCapturePlan, decodeMs: number, found: boolean): void {
    if (!Number.isFinite(decodeMs) || decodeMs < 0) return;
    this.frames++;
    this.misses = found ? 0 : Math.min(this.misses + 1, 1_000_000);
    this.successes = found ? Math.min(this.successes + 1, 1_000_000) : 0;
    this.sinceDiscovery = plan.phase === "discovery" ? 0 : Math.min(this.sinceDiscovery + 1, this.options.discoveryInterval);
    if (plan.phase === "discovery") {
      if (found && decodeMs <= this.options.targetDecodeMs) {
        // Repeated low-resolution misses followed by a readable, affordable
        // discovery are evidence to retain this size, never to exceed its cap.
        this.normalSize = Math.max(this.normalSize, Math.min(plan.maxDecodeSize, this.options.maxDecodeSize));
        this.recoverySize = this.normalSize;
        this.slowFrames = 0;
        this.fastSuccesses = 0;
      }
      return;
    }
    this.slowFrames = decodeMs > this.options.targetDecodeMs * 1.25 ? this.slowFrames + 1 : 0;
    this.fastSuccesses = found && decodeMs < this.options.targetDecodeMs * 0.6 ? this.fastSuccesses + 1 : 0;
    if (this.slowFrames >= 2) {
      this.normalSize = Math.max(this.options.minDecodeSize, Math.floor(this.normalSize * 0.8));
      this.slowFrames = 0;
      this.fastSuccesses = 0;
    } else if (this.fastSuccesses >= 3) {
      this.normalSize = Math.min(this.recoverySize, Math.ceil(this.normalSize * 1.25));
      this.fastSuccesses = 0;
    }
  }
}
