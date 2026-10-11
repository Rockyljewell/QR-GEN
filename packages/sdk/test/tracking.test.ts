// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DuplicateFilter } from "../src/duplicate-filter";
import { BarcodeTracker } from "../src/tracker";
import type { Barcode } from "../src/types";

function code(data: string, x: number, y = 0, size = 40): Barcode {
  return {
    data,
    symbology: "qr",
    symbologyName: "QR Code",
    rawBytes: "",
    contentType: "text",
    isGS1: false,
    location: { topLeft: { x, y }, topRight: { x: x + size, y }, bottomRight: { x: x + size, y: y + size }, bottomLeft: { x, y: y + size } },
    frameSize: { width: 1280, height: 720 },
    orientation: 0,
    ecLevel: "M",
    symbologyIdentifier: "]Q1",
    timestamp: 0,
  };
}

describe("DuplicateFilter", () => {
  it("suppresses repeats within the window", () => {
    const f = new DuplicateFilter(1000);
    expect(f.accept(code("a", 0), 0)).toBe(true);
    expect(f.accept(code("a", 0), 500)).toBe(false);
    expect(f.accept(code("b", 0), 500)).toBe(true);
    expect(f.accept(code("a", 0), 1000)).toBe(true);
  });
  it("0 reports everything, -1 reports once per session", () => {
    const all = new DuplicateFilter(0);
    expect(all.accept(code("a", 0), 0) && all.accept(code("a", 0), 1)).toBe(true);
    const once = new DuplicateFilter(-1);
    expect(once.accept(code("a", 0), 0)).toBe(true);
    expect(once.accept(code("a", 0), 1e9)).toBe(false);
    once.reset();
    expect(once.accept(code("a", 0), 1e9)).toBe(true);
  });
});

describe("BarcodeTracker", () => {
  it("expires a previous sighting before matching a returning code", () => {
    const t = new BarcodeTracker({ timeout: 500 });
    const first = t.update([code("a", 0)], 0).added[0]!;
    const returning = t.update([code("a", 0)], 501);
    expect(returning.removed.map((b) => b.id)).toEqual([first.id]);
    expect(returning.added).toHaveLength(1);
    expect(returning.added[0]!.id).not.toBe(first.id);
    expect(returning.added[0]!.count).toBe(1);
  });
  it("keeps stable ids while codes move and drops them after the timeout", () => {
    const t = new BarcodeTracker({ timeout: 500 });
    const u1 = t.update([code("a", 0), code("b", 200)], 0);
    expect(u1.added.map((b) => b.id)).toEqual([1, 2]);
    const u2 = t.update([code("a", 20), code("b", 210)], 100);
    expect(u2.added).toEqual([]);
    expect(u2.updated.map((b) => [b.id, b.count])).toEqual([[1, 2], [2, 2]]);
    const u3 = t.update([code("a", 30)], 400);
    expect(u3.removed).toEqual([]);
    const u4 = t.update([code("a", 40)], 700);
    expect(u4.removed.map((b) => b.data)).toEqual(["b"]);
    expect(t.size).toBe(1);
  });
  it("tracks identical codes in different places separately", () => {
    const t = new BarcodeTracker();
    const u = t.update([code("same", 0), code("same", 600)], 0);
    expect(u.added).toHaveLength(2);
    const u2 = t.update([code("same", 5), code("same", 605)], 50);
    expect(u2.added).toHaveLength(0);
    expect(u2.updated.map((b) => b.id).sort()).toEqual([1, 2]);
  });
});

describe("BarcodeTracker association and coordinate spaces", () => {
  it.each([{ positions: [80, 210] }, { positions: [210, 80] }])("keeps two identical items in view for detection order $positions", ({ positions }) => {
    const tracker = new BarcodeTracker();
    tracker.update([code("same", 0), code("same", 100)], 0);
    const update = tracker.update(positions.map((x) => code("same", x)), 30);
    expect(update.added).toEqual([]);
    expect(update.tracked).toHaveLength(2);
    expect(update.updated.map((item) => [item.location.topLeft.x, item.id]).sort((a, b) => a[0]! - b[0]!)).toEqual([[80, 1], [210, 2]]);
  });

  it("minimizes movement after preserving the maximum number of associations", () => {
    const tracker = new BarcodeTracker();
    tracker.update([code("same", 0), code("same", 100)], 0);
    const update = tracker.update([code("same", 80), code("same", 120)], 30);
    expect(update.updated.map((item) => [item.location.topLeft.x, item.id])).toEqual([[80, 1], [120, 2]]);
  });

  it("breaks equal-distance ties consistently when detection order changes", () => {
    const run = (ys: number[]) => {
      const tracker = new BarcodeTracker();
      tracker.update([code("same", 0, 50), code("same", 100, 50)], 0);
      return tracker.update(ys.map((y) => code("same", 50, y)), 30).updated
        .map((item) => [item.location.topLeft.y, item.id]).sort((a, b) => a[0]! - b[0]!);
    };
    expect(run([0, 100])).toEqual(run([100, 0]));
  });

  it("never associates a different payload, symbology, or a code beyond its distance gate", () => {
    const tracker = new BarcodeTracker();
    tracker.update([code("same", 0), code("different", 500)], 0);
    const otherFormat = { ...code("same", 0), symbology: "code128" as const };
    const update = tracker.update([otherFormat, code("same", 121), code("different", 500)], 30);
    expect(update.added).toHaveLength(2);
    expect(update.updated.map((item) => item.id)).toEqual([2]);
  });

  it("removes old coordinate-space tracks before matching rotated-size frames", () => {
    const tracker = new BarcodeTracker();
    const first = tracker.update([code("same", 1100, 100)], 0).added[0]!;
    const rotated = { ...code("same", 500, 1100), frameSize: { width: 720, height: 1280 } };
    const update = tracker.update([rotated], 30);
    expect(update.removed.map((item) => item.id)).toEqual([first.id]);
    expect(update.tracked).toHaveLength(1);
    expect(update.added[0]!.id).not.toBe(first.id);
    expect(update.added[0]!.count).toBe(1);
    expect(update.added[0]!.firstSeen).toBe(30);
  });

  it("preserves tracks across an empty frame and same-size reappearance", () => {
    const tracker = new BarcodeTracker();
    const first = tracker.update([code("same", 10)], 0).added[0]!;
    expect(tracker.update([], 30).tracked[0]!.id).toBe(first.id);
    expect(tracker.update([code("same", 20)], 60).updated[0]!.id).toBe(first.id);
    tracker.clear();
    expect(tracker.update([{ ...code("same", 20), frameSize: { width: 720, height: 1280 } }], 90).removed).toEqual([]);
  });

  it("agrees with an exhaustive small-scene maximum-cardinality/minimum-distance oracle", () => {
    let seed = 20261011;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let scene = 0; scene < 150; scene++) {
      const previous = Array.from({ length: 1 + Math.floor(random() * 4) }, () => code("same", Math.floor(random() * 300), Math.floor(random() * 300)));
      const current = Array.from({ length: 1 + Math.floor(random() * 4) }, () => code("same", Math.floor(random() * 300), Math.floor(random() * 300)));
      let best = { count: -1, distance: Infinity };
      const visit = (index: number, used: Set<number>, count: number, distance: number) => {
        if (index === current.length) {
          if (count > best.count || (count === best.count && distance < best.distance)) best = { count, distance };
          return;
        }
        visit(index + 1, used, count, distance);
        for (let old = 0; old < previous.length; old++) {
          const a = current[index]!.location.topLeft, b = previous[old]!.location.topLeft;
          const movement = Math.hypot(a.x - b.x, a.y - b.y);
          if (used.has(old) || movement > 120) continue;
          used.add(old); visit(index + 1, used, count + 1, distance + movement); used.delete(old);
        }
      };
      visit(0, new Set(), 0, 0);
      const tracker = new BarcodeTracker();
      const before = new Map(tracker.update(previous, 0).added.map((item) => [item.id, item]));
      const update = tracker.update(current, 30);
      const actualDistance = update.updated.reduce((sum, item) => {
        const old = before.get(item.id)!.location.topLeft, next = item.location.topLeft;
        return sum + Math.hypot(old.x - next.x, old.y - next.y);
      }, 0);
      expect(update.updated.length, `scene ${scene}`).toBe(best.count);
      expect(actualDistance, `scene ${scene}`).toBeCloseTo(best.distance, 7);
    }
  });
});
