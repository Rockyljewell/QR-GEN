// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { coverTransform, ensureMinHeight, inflateQuad, quadToView } from "../src/elements/geometry";
import type { Quadrilateral } from "../src/types";

const height = (q: Quadrilateral) => Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
const area = (q: Quadrilateral) => {
  const points = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  return Math.abs(points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
};

describe("Linear barcode overlay geometry", () => {
  it.each([false, true])("expands a thin highlight with mirror=%s", (mirror) => {
    const code = {
      topLeft: { x: 100, y: 100 }, topRight: { x: 200, y: 100 },
      bottomRight: { x: 200, y: 113 }, bottomLeft: { x: 100, y: 113 },
    };
    const view = quadToView(code, coverTransform({ width: 640, height: 480 }, { width: 640, height: 480 }, mirror));
    const expanded = ensureMinHeight(view, 26);
    expect(height(expanded)).toBeCloseTo(26);
    expect(area(inflateQuad(expanded, 6))).toBeGreaterThan(2600);
    expect((expanded.topLeft.y + expanded.bottomLeft.y) / 2).toBeCloseTo(106.5);
  });

  it("expands a rotated mirrored highlight toward its bottom edge", () => {
    const q = {
      topLeft: { x: 200, y: 100 }, topRight: { x: 120, y: 160 },
      bottomRight: { x: 127.8, y: 170.4 }, bottomLeft: { x: 207.8, y: 110.4 },
    };
    expect(height(ensureMinHeight(q, 26))).toBeCloseTo(26);
  });

  it("gives a zero-height decoded line a visible highlight", () => {
    const q = {
      topLeft: { x: 200, y: 100 }, topRight: { x: 100, y: 100 },
      bottomRight: { x: 100, y: 100 }, bottomLeft: { x: 200, y: 100 },
    };
    expect(height(ensureMinHeight(q, 26))).toBeCloseTo(26);
    expect(area(ensureMinHeight(q, 26))).toBeCloseTo(2600);
  });
});
