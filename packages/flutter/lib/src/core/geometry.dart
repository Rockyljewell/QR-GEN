// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Frame-to-view coordinate helpers, including the crop of an aspect-fill
/// (`BoxFit.cover`) preview. Pure Dart.
library;

import 'dart:math' as math;

import 'barcode.dart';
import 'options.dart';

/// Whether a portrait view shows a landscape frame (or the other way round),
/// meaning the frame's width and height must be swapped to get the upright
/// image size.
bool frameNeedsSwap(QRGenSize frame, QRGenSize? view) {
  if (view == null || view.isEmpty || frame.isEmpty) return false;
  if (frame.width == frame.height || view.width == view.height) return false;
  return (frame.width > frame.height) != (view.width > view.height);
}

/// The frame size as it appears upright in [view].
QRGenSize uprightFrameSize(QRGenSize frame, QRGenSize? view) => frameNeedsSwap(frame, view) ? frame.flipped : frame;

/// Maps frame pixels to view points for a centered `cover` or `contain` fit.
class QRGenFrameTransform {
  /// Computes the transform for an upright [frame] shown in [view].
  factory QRGenFrameTransform(QRGenSize frame, QRGenSize view, {bool cover = true, bool mirrored = false}) {
    if (frame.isEmpty) return QRGenFrameTransform._(1, 0, 0, mirrored, view.width);
    final sx = view.width / frame.width;
    final sy = view.height / frame.height;
    final scale = cover ? math.max(sx, sy) : math.min(sx, sy);
    return QRGenFrameTransform._(
      scale,
      (view.width - frame.width * scale) / 2,
      (view.height - frame.height * scale) / 2,
      mirrored,
      view.width,
    );
  }

  const QRGenFrameTransform._(this.scale, this.offsetX, this.offsetY, this.mirrored, this.viewWidth);

  /// Scale factor from frame pixels to view points.
  final double scale;

  /// Horizontal offset (negative when the sides are cropped).
  final double offsetX;

  /// Vertical offset (negative when top and bottom are cropped).
  final double offsetY;

  /// Whether x is mirrored (front camera preview).
  final bool mirrored;

  /// View width, used for mirroring.
  final double viewWidth;

  /// Maps a point.
  QRGenPoint apply(QRGenPoint p) {
    final x = p.x * scale + offsetX;
    return QRGenPoint(mirrored ? viewWidth - x : x, p.y * scale + offsetY);
  }

  /// Maps a quadrilateral, keeping the corner roles when mirrored.
  QRGenQuadrilateral applyToQuadrilateral(QRGenQuadrilateral q) {
    final tl = apply(q.topLeft);
    final tr = apply(q.topRight);
    final br = apply(q.bottomRight);
    final bl = apply(q.bottomLeft);
    return mirrored
        ? QRGenQuadrilateral(topLeft: tr, topRight: tl, bottomRight: bl, bottomLeft: br)
        : QRGenQuadrilateral(topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl);
  }

  /// Maps a view rectangle back to frame pixels.
  QRGenRect invertRect(QRGenRect r) {
    final x0 = mirrored ? viewWidth - r.right : r.x;
    return QRGenRect((x0 - offsetX) / scale, (r.y - offsetY) / scale, r.width / scale, r.height / scale);
  }
}

/// Orders four points into a quadrilateral: clockwise (y down) around the
/// centroid, starting with the point with the smallest `x + y`. With fewer
/// than four points the bounding box is used.
QRGenQuadrilateral orderCorners(List<QRGenPoint> points) {
  if (points.length < 4) {
    if (points.isEmpty) return QRGenQuadrilateral.zero;
    final xs = points.map((p) => p.x);
    final ys = points.map((p) => p.y);
    final minX = xs.reduce(math.min);
    final minY = ys.reduce(math.min);
    final maxX = xs.reduce(math.max);
    final maxY = ys.reduce(math.max);
    return QRGenQuadrilateral.fromRect(QRGenRect(minX, minY, maxX - minX, maxY - minY));
  }
  final pts = points.take(4).toList();
  final cx = pts.fold<double>(0, (s, p) => s + p.x) / 4;
  final cy = pts.fold<double>(0, (s, p) => s + p.y) / 4;
  pts.sort((a, b) => math.atan2(a.y - cy, a.x - cx).compareTo(math.atan2(b.y - cy, b.x - cx)));
  var start = 0;
  for (var i = 1; i < 4; i++) {
    if (pts[i].x + pts[i].y < pts[start].x + pts[start].y) start = i;
  }
  QRGenPoint at(int i) => pts[(start + i) % 4];
  return QRGenQuadrilateral(topLeft: at(0), topRight: at(1), bottomRight: at(2), bottomLeft: at(3));
}

/// Default viewfinder rectangle in view points.
QRGenRect defaultViewfinderRect(QRGenSize view, {bool line = false}) {
  if (line) {
    final width = math.min(view.width * 0.84, 520.0);
    final height = math.min(view.height * 0.28, width * 0.5);
    return QRGenRect((view.width - width) / 2, (view.height - height) / 2, width, height);
  }
  final side = math.min(view.width, view.height) * 0.68;
  return QRGenRect((view.width - side) / 2, (view.height - side) / 2, side, side);
}

/// Applies `scanArea` and `maxResults`: drops codes whose center is outside
/// [scanArea] (normalized to each code's frame) and keeps the [maxResults]
/// codes closest to the area's center, in their original order.
List<T> selectBarcodes<T extends QRGenBarcode>(
  List<T> barcodes, {
  QRGenScanArea? scanArea,
  int? maxResults,
}) {
  var list = barcodes;
  if (scanArea != null) {
    final area = QRGenRect(scanArea.x, scanArea.y, scanArea.width, scanArea.height);
    list = list.where((b) {
      if (b.frameSize.isEmpty) return true;
      final c = b.location.center;
      return area.contains(QRGenPoint(c.x / b.frameSize.width, c.y / b.frameSize.height));
    }).toList();
  }
  if (maxResults != null && maxResults > 0 && list.length > maxResults) {
    double distance(T b) {
      final ax = scanArea == null ? 0.5 : scanArea.x + scanArea.width / 2;
      final ay = scanArea == null ? 0.5 : scanArea.y + scanArea.height / 2;
      final c = b.location.center;
      final dx = c.x - ax * b.frameSize.width;
      final dy = c.y - ay * b.frameSize.height;
      return dx * dx + dy * dy;
    }

    final indexed = [for (var i = 0; i < list.length; i++) (index: i, item: list[i], d: distance(list[i]))];
    indexed.sort((a, b) {
      final c = a.d.compareTo(b.d);
      return c != 0 ? c : a.index.compareTo(b.index);
    });
    final kept = indexed.take(maxResults).toList()..sort((a, b) => a.index.compareTo(b.index));
    list = [for (final e in kept) e.item];
  }
  return list;
}
