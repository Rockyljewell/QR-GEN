/**
 * Coordinate helpers: camera frame pixels to view points, including the crop
 * of an aspect-fill ("cover") preview. Pure TypeScript.
 */
import type { Point, Quadrilateral, Rect, Size } from './types';

/**
 * True when a portrait view shows a landscape frame (or the other way round),
 * which means the frame's width and height must be swapped to get the upright
 * image size. Camera sensors report landscape sizes such as 1920x1080 even
 * when the phone is held upright.
 */
export function needsSwap(frame: Size, view: Size | null | undefined): boolean {
  if (!view || view.width <= 0 || view.height <= 0) return false;
  if (frame.width === frame.height || view.width === view.height) return false;
  return frame.width > frame.height !== view.width > view.height;
}

/** Size of the frame as it appears upright in the view. */
export function uprightFrameSize(frame: Size, view: Size | null | undefined): Size {
  return needsSwap(frame, view) ? { width: frame.height, height: frame.width } : { width: frame.width, height: frame.height };
}

/** Transform parameters from frame pixels to view points. */
export interface FrameToViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  mirrored: boolean;
  viewWidth: number;
}

/**
 * Computes the transform used by a preview that scales the frame to cover
 * (`cover`, vision-camera's default) or fit inside (`contain`) the view,
 * centered. `frame` must already be upright (see {@link uprightFrameSize}).
 */
export function frameToViewTransform(
  frame: Size,
  view: Size,
  options: { resizeMode?: 'cover' | 'contain'; mirrored?: boolean } = {},
): FrameToViewTransform {
  const { resizeMode = 'cover', mirrored = false } = options;
  if (frame.width <= 0 || frame.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, mirrored, viewWidth: view.width };
  }
  const sx = view.width / frame.width;
  const sy = view.height / frame.height;
  const scale = resizeMode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return {
    scale,
    offsetX: (view.width - frame.width * scale) / 2,
    offsetY: (view.height - frame.height * scale) / 2,
    mirrored,
    viewWidth: view.width,
  };
}

/** Applies a {@link FrameToViewTransform} to a point. */
export function applyTransform(p: Point, t: FrameToViewTransform): Point {
  const x = p.x * t.scale + t.offsetX;
  return { x: t.mirrored ? t.viewWidth - x : x, y: p.y * t.scale + t.offsetY };
}

/** Maps a quadrilateral from upright frame pixels to view points. */
export function quadrilateralToView(q: Quadrilateral, t: FrameToViewTransform): Quadrilateral {
  const m = {
    topLeft: applyTransform(q.topLeft, t),
    topRight: applyTransform(q.topRight, t),
    bottomRight: applyTransform(q.bottomRight, t),
    bottomLeft: applyTransform(q.bottomLeft, t),
  };
  // Mirroring flips left and right.
  return t.mirrored
    ? { topLeft: m.topRight, topRight: m.topLeft, bottomRight: m.bottomLeft, bottomLeft: m.bottomRight }
    : m;
}

/** Maps a view-space rectangle back to upright frame pixels (inverse of {@link applyTransform}). */
export function viewRectToFrame(r: Rect, t: FrameToViewTransform): Rect {
  const x0 = t.mirrored ? t.viewWidth - (r.x + r.width) : r.x;
  return {
    x: (x0 - t.offsetX) / t.scale,
    y: (r.y - t.offsetY) / t.scale,
    width: r.width / t.scale,
    height: r.height / t.scale,
  };
}

/**
 * Orders four (or more) points into a quadrilateral: points are sorted
 * clockwise (screen coordinates, y down) around their centroid, starting with
 * the point closest to the top-left (smallest `x + y`). With fewer than four
 * points the bounding box is used.
 */
export function orderQuadrilateral(points: readonly Point[]): Quadrilateral {
  if (points.length < 4) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = xs.length ? Math.min(...xs) : 0;
    const y0 = ys.length ? Math.min(...ys) : 0;
    const x1 = xs.length ? Math.max(...xs) : 0;
    const y1 = ys.length ? Math.max(...ys) : 0;
    return { topLeft: { x: x0, y: y0 }, topRight: { x: x1, y: y0 }, bottomRight: { x: x1, y: y1 }, bottomLeft: { x: x0, y: y1 } };
  }
  const pts = points.slice(0, 4);
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i]!.x + sorted[i]!.y < sorted[start]!.x + sorted[start]!.y) start = i;
  const at = (i: number) => ({ ...sorted[(start + i) % 4]! });
  return { topLeft: at(0), topRight: at(1), bottomRight: at(2), bottomLeft: at(3) };
}

/** True when `p` lies inside the rectangle. */
export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Default viewfinder rectangle (view points) for a view and style. */
export function defaultViewfinderRect(view: Size, style: 'frame' | 'line'): Rect {
  const w = view.width;
  const h = view.height;
  if (style === 'line') {
    const width = Math.min(w * 0.84, 520);
    const height = Math.min(h * 0.28, width * 0.5);
    return { x: (w - width) / 2, y: (h - height) / 2, width, height };
  }
  const side = Math.min(w, h) * 0.68;
  return { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side };
}
