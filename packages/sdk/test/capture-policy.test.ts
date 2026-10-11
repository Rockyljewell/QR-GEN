// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { AdaptiveCapturePolicy, MAX_ADAPTIVE_DECODE_PIXELS, MAX_ADAPTIVE_DECODE_SIZE, resolveAdaptiveCaptureOptions, type AdaptiveCaptureOptions } from "../src/capture-policy";

function policy(options: AdaptiveCaptureOptions = {}, maxDecodeSize = 1280) {
  return new AdaptiveCapturePolicy(resolveAdaptiveCaptureOptions(options, maxDecodeSize)!);
}

function observe(p: AdaptiveCapturePolicy, count: number, decodeMs: number, found = false) {
  for (let i = 0; i < count; i++) p.observe(p.next(), decodeMs, found);
}

describe("Adaptive capture policy", () => {
  it("is disabled unless explicitly enabled, including for unvalidated fixed capture sizes", () => {
    expect(resolveAdaptiveCaptureOptions(undefined, Number.NaN)).toBeNull();
    expect(resolveAdaptiveCaptureOptions(false, Infinity)).toBeNull();
    const resolved = resolveAdaptiveCaptureOptions(true, 1280)!;
    expect(resolved).toMatchObject({ initialDecodeSize: 640, minDecodeSize: 320, maxDecodeSize: 1280, maxDecodePixels: 1_048_576 });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("starts cheaply and next() does not consume a frame or discovery attempt", () => {
    const p = policy({ discoveryInterval: 2, missesBeforeDiscovery: 2 });
    expect(p.next()).toMatchObject({ phase: "normal", maxDecodeSize: 640 });
    observe(p, 2, 10);
    expect(p.next()).toMatchObject({ phase: "discovery", maxDecodeSize: 1280 });
    for (let i = 0; i < 100; i++) p.next();
    expect(p.snapshot).toMatchObject({ consecutiveMisses: 2, completedFrames: 2 });
    expect(p.next().phase).toBe("discovery");
  });

  it("periodically discovers while preserving full-frame low-cost attempts between discoveries", () => {
    const p = policy({ discoveryInterval: 3, missesBeforeDiscovery: 2 });
    const phases = [];
    for (let i = 0; i < 12; i++) {
      phases.push(p.next().phase);
      observe(p, 1, 10);
    }
    expect(phases).toEqual(["normal", "normal", "normal", "discovery", "normal", "normal", "normal", "discovery", "normal", "normal", "normal", "discovery"]);
  });

  it("requires consecutive misses, and a success suppresses the next discovery", () => {
    const p = policy({ discoveryInterval: 2, missesBeforeDiscovery: 3 });
    observe(p, 2, 10);
    expect(p.next().phase).toBe("normal");
    observe(p, 1, 10);
    expect(p.next().phase).toBe("discovery");
    observe(p, 1, 10, true);
    expect(p.next().phase).toBe("normal");
    expect(p.snapshot).toMatchObject({ consecutiveMisses: 0, consecutiveSuccesses: 1 });
    observe(p, 2, 10);
    expect(p.next().phase).toBe("normal");
    observe(p, 1, 10);
    expect(p.next().phase).toBe("discovery");
  });

  it("reduces normal work only after two consecutive slow normal decodes", () => {
    const p = policy();
    observe(p, 1, 100, true);
    expect(p.next().maxDecodeSize).toBe(640);
    observe(p, 1, 10, true);
    observe(p, 1, 100, true);
    expect(p.next().maxDecodeSize).toBe(640);
    observe(p, 1, 100, true);
    expect(p.next().maxDecodeSize).toBe(512);
    observe(p, 30, 100, true);
    expect(p.next().maxDecodeSize).toBe(320);
  });

  it("restores normal size with three consecutive fast successes and never exceeds the initial size", () => {
    const p = policy();
    observe(p, 4, 100, true);
    expect(p.next().maxDecodeSize).toBe(409);
    observe(p, 2, 10, true);
    expect(p.next().maxDecodeSize).toBe(409);
    observe(p, 1, 10, false);
    observe(p, 2, 10, true);
    expect(p.next().maxDecodeSize).toBe(409);
    observe(p, 1, 10, true);
    expect(p.next().maxDecodeSize).toBe(512);
    observe(p, 30, 10, true);
    expect(p.next().maxDecodeSize).toBe(640);
  });

  it("does not let expensive discovery frames shrink normal work", () => {
    const p = policy({ discoveryInterval: 2, missesBeforeDiscovery: 1 });
    observe(p, 2, 10);
    expect(p.next().phase).toBe("discovery");
    observe(p, 1, 500);
    expect(p.next().maxDecodeSize).toBe(640);
    observe(p, 1, 100);
    expect(p.next().maxDecodeSize).toBe(640);
  });

  it.each([NaN, Infinity, -1])("ignores unusable elapsed time %s", (ms) => {
    const p = policy();
    const before = p.snapshot;
    p.observe(p.next(), ms, false);
    expect(p.snapshot).toEqual(before);
  });

  it("honors caller and absolute side caps even when fixed capture allows much larger frames", () => {
    const small = policy({}, 160);
    observe(small, 8, 10);
    expect(small.next()).toMatchObject({ phase: "discovery", maxDecodeSize: 160 });
    const large = policy({ maxDecodePixels: MAX_ADAPTIVE_DECODE_PIXELS }, 8192);
    observe(large, 8, 10);
    expect(large.next()).toMatchObject({ maxDecodeSize: MAX_ADAPTIVE_DECODE_SIZE, maxDecodePixels: MAX_ADAPTIVE_DECODE_PIXELS });
  });

  it.each([
    { initialDecodeSize: NaN }, { initialDecodeSize: Infinity }, { initialDecodeSize: 0 }, { initialDecodeSize: 1281 },
    { minDecodeSize: 641 }, { minDecodeSize: -1 }, { minDecodeSize: 320.1 },
    { maxDecodePixels: 255 }, { maxDecodePixels: Infinity }, { maxDecodePixels: MAX_ADAPTIVE_DECODE_PIXELS + 1 },
    { discoveryInterval: 1 }, { discoveryInterval: 121 }, { discoveryInterval: 8.5 },
    { missesBeforeDiscovery: 0 }, { missesBeforeDiscovery: 121 },
    { targetDecodeMs: 0 }, { targetDecodeMs: Infinity }, { targetDecodeMs: 1001 },
  ])("rejects invalid options %j", (options) => {
    expect(() => policy(options)).toThrowError(expect.objectContaining({ code: "bad-request" }));
  });

  it.each([0, NaN, Infinity, 16_385, 1280.1])("rejects invalid maxDecodeSize %s when enabled", (size) => {
    expect(() => policy({}, size)).toThrowError(expect.objectContaining({ code: "bad-request" }));
  });

  it.each([null, [], "yes", 1])("rejects invalid adaptive option %j", (input) => {
    expect(() => resolveAdaptiveCaptureOptions(input as unknown as AdaptiveCaptureOptions, 1280)).toThrowError(expect.objectContaining({ code: "bad-request" }));
  });

  it.each(["initialDecodeSize", "minDecodeSize", "maxDecodePixels", "discoveryInterval", "missesBeforeDiscovery", "targetDecodeMs"])("rejects null rather than silently defaulting %s", (key) => {
    expect(() => policy({ [key]: null } as unknown as AdaptiveCaptureOptions)).toThrowError(expect.objectContaining({ code: "bad-request" }));
  });
});
