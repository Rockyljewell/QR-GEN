// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { Point, Quadrilateral, ScanArea, Size } from "../types.js";

/** Mapping between camera-frame pixels and element pixels for `object-fit: cover`. */
export interface CoverTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  view: Size;
  frame: Size;
  mirror: boolean;
}

export function coverTransform(view: Size, frame: Size, mirror = false): CoverTransform {
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  return {
    scale,
    offsetX: (view.width - frame.width * scale) / 2,
    offsetY: (view.height - frame.height * scale) / 2,
    view,
    frame,
    mirror,
  };
}

export function frameToView(p: Point, t: CoverTransform): Point {
  const x = t.offsetX + p.x * t.scale;
  return { x: t.mirror ? t.view.width - x : x, y: t.offsetY + p.y * t.scale };
}

export function quadToView(q: Quadrilateral, t: CoverTransform): Quadrilateral {
  return {
    topLeft: frameToView(q.topLeft, t),
    topRight: frameToView(q.topRight, t),
    bottomRight: frameToView(q.bottomRight, t),
    bottomLeft: frameToView(q.bottomLeft, t),
  };
}

/** Convert a rectangle in element pixels into a normalized scan area of the camera frame. */
export function viewRectToScanArea(rect: { x: number; y: number; width: number; height: number }, t: CoverTransform, margin = 0.08): ScanArea {
  let x0 = (rect.x - t.offsetX) / t.scale;
  let x1 = (rect.x + rect.width - t.offsetX) / t.scale;
  if (t.mirror) [x0, x1] = [t.frame.width - x1, t.frame.width - x0];
  const y0 = (rect.y - t.offsetY) / t.scale;
  const y1 = (rect.y + rect.height - t.offsetY) / t.scale;
  const mx = (x1 - x0) * margin;
  const my = (y1 - y0) * margin;
  const nx = Math.max(0, (x0 - mx) / t.frame.width);
  const ny = Math.max(0, (y0 - my) / t.frame.height);
  const nw = Math.min(1 - nx, (x1 - x0 + 2 * mx) / t.frame.width);
  const nh = Math.min(1 - ny, (y1 - y0 + 2 * my) / t.frame.height);
  return { x: nx, y: ny, width: nw, height: nh };
}

export function pointInQuad(p: Point, q: Quadrilateral): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Grow a quad around its center (highlights look better slightly larger than the code). */
export function inflateQuad(q: Quadrilateral, amount: number): Quadrilateral {
  const cx = (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4;
  const cy = (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4;
  const grow = (p: Point): Point => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  };
  return { topLeft: grow(q.topLeft), topRight: grow(q.topRight), bottomRight: grow(q.bottomRight), bottomLeft: grow(q.bottomLeft) };
}

/** Linear barcodes decode to a thin line; give them some height for highlighting. */
export function ensureMinHeight(q: Quadrilateral, min: number): Quadrilateral {
  const h = Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
  if (h >= min) return q;
  const w = Math.hypot(q.topRight.x - q.topLeft.x, q.topRight.y - q.topLeft.y) || 1;
  // Normal to the top edge.
  const nx = -(q.topRight.y - q.topLeft.y) / w;
  const ny = (q.topRight.x - q.topLeft.x) / w;
  const pad = (min - h) / 2;
  return {
    topLeft: { x: q.topLeft.x - nx * pad, y: q.topLeft.y - ny * pad },
    topRight: { x: q.topRight.x - nx * pad, y: q.topRight.y - ny * pad },
    bottomRight: { x: q.bottomRight.x + nx * pad, y: q.bottomRight.y + ny * pad },
    bottomLeft: { x: q.bottomLeft.x + nx * pad, y: q.bottomLeft.y + ny * pad },
  };
}
