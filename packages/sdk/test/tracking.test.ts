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
