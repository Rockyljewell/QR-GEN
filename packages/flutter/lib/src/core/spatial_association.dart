// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Internal snapshots and whole-frame spatial association. No tracker mutation.
library;

import 'dart:math' as math;

import 'barcode.dart';

/// Exact integer range shared by Dart VM and compiled web arithmetic.
const int qrgenSpatialMaxInteger = 9007199254740991;

/// Advances a positive spatial ordinal or count without losing integer precision.
int incrementQRGenSpatialInteger(int value) {
  if (value <= 0 || value >= qrgenSpatialMaxInteger) throw RangeError('Spatial identity or count range exhausted');
  return value + 1;
}

/// Reads every known caller field once into a plain, immutable barcode.
QRGenBarcode snapshotQRGenBarcode(QRGenBarcode barcode) {
  final location = barcode.location;
  final size = barcode.frameSize;
  return QRGenBarcode(
    data: barcode.data,
    symbology: barcode.symbology,
    symbologyName: barcode.symbologyName,
    rawBytes: barcode.rawBytes,
    contentType: barcode.contentType,
    isGS1: barcode.isGS1,
    location: QRGenQuadrilateral(
      topLeft: QRGenPoint(location.topLeft.x, location.topLeft.y),
      topRight: QRGenPoint(location.topRight.x, location.topRight.y),
      bottomRight: QRGenPoint(location.bottomRight.x, location.bottomRight.y),
      bottomLeft: QRGenPoint(location.bottomLeft.x, location.bottomLeft.y),
    ),
    frameSize: QRGenSize(size.width, size.height),
    orientation: barcode.orientation,
    ecLevel: barcode.ecLevel,
    symbologyIdentifier: barcode.symbologyIdentifier,
    timestamp: barcode.timestamp,
  );
}

/// Validates an epoch DateTime without converting or replacing its representation.
void validateQRGenSpatialTime(DateTime value) {
  final micros = value.microsecondsSinceEpoch;
  if (micros < -8640000000000000000 || micros > 8640000000000000000) {
    throw RangeError('Spatial timestamps must be valid DateTime values');
  }
}

/// Validates positive integral full-frame source dimensions.
QRGenSize validateQRGenSpatialSize(QRGenSize value) {
  bool valid(double v) => v.isFinite && v > 0 && v <= qrgenSpatialMaxInteger && v == v.truncateToDouble();
  if (!valid(value.width) || !valid(value.height)) {
    throw RangeError('Spatial tracking requires positive integer frame dimensions');
  }
  return QRGenSize(value.width, value.height);
}

typedef _Payload = (String, String);
typedef _Geometry = ({double x, double y, double limit});

_Payload _key(QRGenBarcode barcode) => (barcode.symbology.id, barcode.data);

_Geometry _geometry(QRGenBarcode barcode, double maxJump) {
  final points = barcode.location.points;
  if (points.any((p) => !p.x.isFinite || !p.y.isFinite)) throw RangeError('Spatial tracking requires finite corners');
  final width = points.map((p) => p.x).reduce(math.max) - points.map((p) => p.x).reduce(math.min);
  final height = points.map((p) => p.y).reduce(math.max) - points.map((p) => p.y).reduce(math.min);
  final x = points.fold<double>(0, (sum, p) => sum + p.x / 4);
  final y = points.fold<double>(0, (sum, p) => sum + p.y / 4);
  final extent = math.max(width, height);
  final limit = math.max(extent, 1) * maxJump;
  if (extent <= 0 || ![width, height, x, y, limit].every((v) => v.isFinite)) {
    throw RangeError('Spatial tracking requires a nonzero finite extent and movement gate');
  }
  return (x: x, y: y, limit: limit);
}

/// Validates each record's geometry, timestamp and consistent full-frame size.
QRGenSize? validateQRGenSpatialFrame(List<QRGenBarcode> barcodes, double maxJump, [QRGenSize? frameSize]) {
  var size = frameSize == null ? null : validateQRGenSpatialSize(frameSize);
  for (final barcode in barcodes) {
    _geometry(barcode, maxJump);
    validateQRGenSpatialTime(barcode.timestamp);
    final own = validateQRGenSpatialSize(barcode.frameSize);
    if (size != null && own != size) throw RangeError('Spatial records must share their source frame dimensions');
    size = own;
  }
  return size;
}

/// Rejects summed conservative assignment work before any matching allocation.
void validateQRGenSpatialWork(List<QRGenBarcode> detections, List<QRGenTrackedBarcode> tracks, int budget) {
  final current = <_Payload, int>{};
  final previous = <_Payload, int>{};
  for (final barcode in detections) {
    final key = _key(barcode);
    current[key] = (current[key] ?? 0) + 1;
  }
  for (final barcode in tracks) {
    final key = _key(barcode);
    previous[key] = (previous[key] ?? 0) + 1;
  }
  var remaining = budget;
  for (final entry in current.entries) {
    final n = entry.value;
    final m = previous[entry.key] ?? 0;
    if (m == 0) continue;
    // All products are bounded by the remaining safe integer budget first.
    if (n > remaining ~/ n) throw RangeError('Spatial association exceeds maxAssociationWork=$budget');
    final square = n * n;
    final factorLimit = remaining ~/ square;
    if (n > factorLimit || m > factorLimit - n) {
      throw RangeError('Spatial association exceeds maxAssociationWork=$budget');
    }
    remaining -= square * (m + n);
  }
}

double _hypot(double dx, double dy) {
  final scale = math.max(dx.abs(), dy.abs());
  if (!scale.isFinite || scale == 0) return scale;
  final x = dx / scale;
  final y = dy / scale;
  return scale * math.sqrt(x * x + y * y);
}

/// Most gated one-to-one matches, then least total Euclidean movement.
/// Prior tracks must be supplied in numeric creation order.
Map<int, QRGenTrackedBarcode> associateQRGenSpatial(
  List<QRGenBarcode> detections,
  List<QRGenTrackedBarcode> tracks,
  double maxJump,
) {
  final groups = <_Payload, List<int>>{};
  final oldGroups = <_Payload, List<QRGenTrackedBarcode>>{};
  for (var index = 0; index < detections.length; index++) {
    (groups[_key(detections[index])] ??= []).add(index);
  }
  for (final track in tracks) {
    (oldGroups[_key(track)] ??= []).add(track);
  }
  final matched = <int, QRGenTrackedBarcode>{};
  for (final entry in groups.entries) {
    final previous = oldGroups[entry.key];
    if (previous == null || previous.isEmpty) continue;
    final rows = [for (final index in entry.value) (index: index, geometry: _geometry(detections[index], maxJump))];
    rows.sort((a, b) {
      final x = a.geometry.x.compareTo(b.geometry.x);
      if (x != 0) return x;
      final y = a.geometry.y.compareTo(b.geometry.y);
      return y != 0 ? y : a.index.compareTo(b.index);
    });
    final oldPoints = previous.map((track) => _geometry(track, maxJump)).toList(growable: false);
    final distances = [
      for (final row in rows)
        [for (final point in oldPoints) _hypot(point.x - row.geometry.x, point.y - row.geometry.y)],
    ];
    for (var row = 0; row < rows.length; row++) {
      for (var column = 0; column < previous.length; column++) {
        if (distances[row][column] > rows[row].geometry.limit) distances[row][column] = double.infinity;
      }
    }
    final usable = [
      for (var c = 0; c < previous.length; c++)
        if (distances.any((row) => row[c].isFinite)) c,
    ];
    if (usable.isEmpty) continue;
    if (rows.length == 1) {
      var best = usable.first;
      for (final column in usable.skip(1)) {
        if (distances[0][column] < distances[0][best]) best = column;
      }
      matched[rows[0].index] = previous[best];
      continue;
    }
    var scale = 1.0;
    for (final row in distances) {
      for (final column in usable) {
        if (row[column].isFinite) scale = math.max(scale, row[column]);
      }
    }
    final columns = usable.length + rows.length;
    final unmatched = rows.length + 1.0;
    final invalid = unmatched * unmatched;
    double cost(int row, int column) => column >= usable.length
        ? unmatched
        : distances[row][usable[column]].isFinite
        ? distances[row][usable[column]] / scale
        : invalid;
    final u = List<double>.filled(rows.length + 1, 0);
    final v = List<double>.filled(columns + 1, 0);
    final p = List<int>.filled(columns + 1, 0);
    final way = List<int>.filled(columns + 1, 0);
    for (var row = 1; row <= rows.length; row++) {
      p[0] = row;
      var column = 0;
      final minimum = List<double>.filled(columns + 1, double.infinity);
      final used = List<bool>.filled(columns + 1, false);
      do {
        used[column] = true;
        final active = p[column];
        var delta = double.infinity;
        var next = 0;
        for (var candidate = 1; candidate <= columns; candidate++) {
          if (used[candidate]) continue;
          final reduced = cost(active - 1, candidate - 1) - u[active] - v[candidate];
          if (reduced < minimum[candidate]) {
            minimum[candidate] = reduced;
            way[candidate] = column;
          }
          if (minimum[candidate] < delta) {
            delta = minimum[candidate];
            next = candidate;
          }
        }
        for (var candidate = 0; candidate <= columns; candidate++) {
          if (used[candidate]) {
            u[p[candidate]] += delta;
            v[candidate] -= delta;
          } else {
            minimum[candidate] -= delta;
          }
        }
        column = next;
      } while (p[column] != 0);
      do {
        final prior = way[column];
        p[column] = p[prior];
        column = prior;
      } while (column != 0);
    }
    for (var column = 1; column <= usable.length; column++) {
      final row = p[column] - 1;
      if (row >= 0 && distances[row][usable[column - 1]].isFinite) {
        matched[rows[row].index] = previous[usable[column - 1]];
      }
    }
  }
  return matched;
}
