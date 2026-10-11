// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'dart:math' as math;

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';
import 'package:test/test.dart';

// These tests concern short-lived decoded observations, not physical inventory.
// The oracle enumerates partial injections; it shares no assignment algorithm,
// normalization, potentials, cost matrix or geometry helper with production.
const _frame = QRGenSize(1280, 720);
DateTime _at(int ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);

class _Observation {
  const _Observation(this.x, this.y, {this.width = 40, this.height = 40, this.data = 'same', this.symbology = QRGenSymbology.qr});
  final double x;
  final double y;
  final double width;
  final double height;
  final String data;
  final QRGenSymbology symbology;

  QRGenBarcode barcode(String tag, {QRGenSize size = _frame}) => QRGenBarcode(
        data: data,
        symbology: symbology,
        symbologyName: tag,
        timestamp: _at(17),
        frameSize: size,
        location: QRGenQuadrilateral(
          topLeft: QRGenPoint(x - width / 2, y - height / 2),
          topRight: QRGenPoint(x + width / 2, y - height / 2),
          bottomRight: QRGenPoint(x + width / 2, y + height / 2),
          bottomLeft: QRGenPoint(x - width / 2, y + height / 2),
        ),
      );
}

class _Optimum {
  const _Optimum(this.count, this.movement);
  final int count;
  final double movement;
}

// Only bounded small-scene values reach this oracle. Squaring for eligibility
// and ordinary sqrt for movement are safe here and independent of stable hypot.
_Optimum _exhaustive(List<_Observation> old, List<_Observation> current, double jump) {
  var bestCount = -1;
  var bestMovement = double.infinity;
  final used = <int>{};
  void visit(int row, int count, double movement) {
    if (row == current.length) {
      if (count > bestCount || (count == bestCount && movement < bestMovement)) {
        bestCount = count;
        bestMovement = movement;
      }
      return;
    }
    // Every current observation may remain unmatched, including gated rows.
    visit(row + 1, count, movement);
    final next = current[row];
    final gate = math.max(math.max(next.width, next.height), 1.0) * jump;
    for (var column = 0; column < old.length; column++) {
      final previous = old[column];
      if (used.contains(column) || previous.data != next.data || previous.symbology != next.symbology) continue;
      final dx = previous.x - next.x;
      final dy = previous.y - next.y;
      final squared = dx * dx + dy * dy;
      if (squared > gate * gate) continue;
      used.add(column);
      visit(row + 1, count + 1, movement + math.sqrt(squared));
      used.remove(column);
    }
  }
  visit(0, 0, 0);
  return _Optimum(bestCount, bestMovement);
}

void _checkScene(List<_Observation> old, List<_Observation> current, double jump, String label) {
  final optimum = _exhaustive(old, current, jump);
  final tracker = QRGenBarcodeTracker(spatial: true, maxJump: jump);
  final first = tracker.update([for (var i = 0; i < old.length; i++) old[i].barcode('i-$i')], _at(0));
  expect(first.tracked.map((b) => b.symbologyName), orderedEquals([for (var i = 0; i < old.length; i++) 'i-$i']), reason: label);
  final columns = {for (var i = 0; i < first.tracked.length; i++) first.tracked[i].id: i};
  expect(columns.length, old.length, reason: label);
  final update = tracker.update([for (var i = 0; i < current.length; i++) current[i].barcode('c-$i')], _at(30));
  final matches = update.tracked.where((item) => item.count == 2).toList();
  expect(matches, hasLength(optimum.count), reason: label);
  expect(update.added, hasLength(current.length - optimum.count), reason: label);
  expect(update.removed, isEmpty, reason: label);
  expect(update.tracked, hasLength(old.length + current.length - optimum.count), reason: label);
  final usedRows = <int>{};
  final usedColumns = <int>{};
  var movement = 0.0;
  for (final item in matches) {
    final column = columns[item.id];
    expect(column, isNotNull, reason: label);
    final oldIndex = column!;
    // Metadata tags identify rows independently of geometry or opaque IDs.
    final actualRow = int.parse(item.symbologyName.substring(2));
    expect(item.symbologyName, 'c-$actualRow', reason: label);
    expect(actualRow, inInclusiveRange(0, current.length - 1), reason: label);
    expect(usedRows.add(actualRow), isTrue, reason: '$label repeated current row');
    expect(usedColumns.add(oldIndex), isTrue, reason: '$label repeated old column');
    final previous = old[oldIndex];
    final next = current[actualRow];
    expect(previous.data, next.data, reason: label);
    expect(previous.symbology, next.symbology, reason: label);
    final dx = previous.x - next.x;
    final dy = previous.y - next.y;
    final distance = math.sqrt(dx * dx + dy * dy);
    final gate = math.max(math.max(next.width, next.height), 1.0) * jump;
    expect(distance, lessThanOrEqualTo(gate), reason: '$label ineligible match');
    movement += distance;
  }
  expect(movement, closeTo(optimum.movement, math.max(1e-9, optimum.movement * 1e-11)), reason: label);
}

class _PortableRandom {
  _PortableRandom(this._state);
  int _state;
  int next(int limit) {
    // The product is below 2^53, so VM and web enumerate identical scenes.
    _state = (_state * 48271) % 2147483647;
    return _state % limit;
  }
}

List<QRGenBarcode> _dense(int count, {double x = 0, String data = 'same', QRGenSize size = _frame}) =>
    [for (var i = 0; i < count; i++) _Observation(x, 0, data: data).barcode('$data-$i', size: size)];

/// Runs an independent finite-scene oracle and targeted assignment regressions.
void main() {
  group('independent spatial assignment oracle', () {
    test('enumerates all two-by-two scenes on a four-position grid', () {
      const grid = [-3.0, -1.0, 1.0, 3.0];
      var scene = 0;
      for (final a in grid) {
        for (final b in grid) {
          for (final c in grid) {
            for (final d in grid) {
              _checkScene(
                [_Observation(a, 0, width: 2, height: 0), _Observation(b, 0, width: 2, height: 0)],
                [_Observation(c, 0, width: 2, height: 0), _Observation(d, 0, width: 2, height: 0)],
                1, 'grid ${scene++}',
              );
            }
          }
        }
      }
      expect(scene, 256);
    });

    test('matches exhaustive cardinality and Euclidean cost in 240 seeded scenes', () {
      final random = _PortableRandom(20261011);
      for (var scene = 0; scene < 240; scene++) {
        final old = <_Observation>[];
        final current = <_Observation>[];
        for (var i = 0, n = 1 + random.next(4); i < n; i++) {
          old.add(_Observation(random.next(301).toDouble(), random.next(301).toDouble(),
            width: (1 + random.next(80)).toDouble(), height: random.next(20).toDouble(),
            data: random.next(4) == 0 ? 'a\u0000b' : 'same',
            symbology: random.next(4) == 0 ? QRGenSymbology.code128 : QRGenSymbology.qr));
        }
        for (var i = 0, n = random.next(5); i < n; i++) {
          current.add(_Observation(random.next(301).toDouble(), random.next(301).toDouble(),
            width: (1 + random.next(80)).toDouble(), height: random.next(20).toDouble(),
            data: random.next(4) == 0 ? 'a\u0000b' : 'same',
            symbology: random.next(4) == 0 ? QRGenSymbology.code128 : QRGenSymbology.qr));
        }
        _checkScene(old, current, random.next(5).toDouble(), 'seeded $scene');
      }
    });

    for (final reversed in [false, true]) {
      test('maximizes cardinality in the greedy trap (reversed=$reversed)', () {
        final tracker = QRGenBarcodeTracker(spatial: true);
        final first = tracker.update([const _Observation(0, 0).barcode('old-a'), const _Observation(100, 0).barcode('old-b')], _at(0));
        final next = [const _Observation(80, 0).barcode('near'), const _Observation(210, 0).barcode('far')];
        final update = tracker.update(reversed ? next.reversed : next, _at(30));
        expect(update.added, isEmpty);
        expect(update.tracked.map((b) => [b.id, b.symbologyName, b.count]).toList(), equals([
          [first.tracked[0].id, 'near', 2], [first.tracked[1].id, 'far', 2],
        ]));
      });

      test('minimizes Euclidean movement rather than squared movement (reversed=$reversed)', () {
        // Direct lengths 0+sqrt(221) beat 10+sqrt(101); squared totals
        // reverse that preference: 221 is greater than 100+101.
        final tracker = QRGenBarcodeTracker(spatial: true);
        final first = tracker.update([const _Observation(0, 0).barcode('old-a'), const _Observation(10, 0).barcode('old-b')], _at(0));
        final next = [const _Observation(0, 0).barcode('zero'), const _Observation(-1, 10).barcode('diagonal')];
        final update = tracker.update(reversed ? next.reversed : next, _at(30));
        expect(update.added, isEmpty);
        expect(update.tracked.map((b) => [b.id, b.symbologyName]).toList(), equals([
          [first.tracked[0].id, 'zero'], [first.tracked[1].id, 'diagonal'],
        ]));
      });
    }

    test('canonical rows make equal-distance tie identities independent of input reordering', () {
      Map<String, int> run(bool reversed) {
        final tracker = QRGenBarcodeTracker(spatial: true);
        final first = tracker.update([const _Observation(100, 100).barcode('old-a'), const _Observation(100, 100).barcode('old-b')], _at(0));
        final next = [const _Observation(100, 50).barcode('above'), const _Observation(100, 150).barcode('below')];
        final update = tracker.update(reversed ? next.reversed : next, _at(30));
        expect(update.added, isEmpty);
        return {for (final item in update.tracked) item.symbologyName: first.tracked.indexWhere((old) => old.id == item.id)};
      }
      expect(run(false), run(true));
      expect(run(false).values.toSet(), {0, 1});
    });

    test('old columns use numeric creation order when IDs 2 and 10 tie', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update([
        for (var i = 0; i < 12; i++)
          _Observation(100, 100, data: i == 1 || i == 9 ? 'target' : 'other-$i').barcode('initial-$i'),
      ], _at(0));
      final update = tracker.update([const _Observation(100, 100, data: 'target').barcode('matched')], _at(30));
      expect(update.tracked.where((item) => item.count == 2).map((b) => b.id), [first.tracked[1].id]);
      expect(update.tracked.map((b) => b.id), orderedEquals(first.tracked.map((b) => b.id)));
    });

    test('new observations use original frame order while existing output retains creation order', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update([const _Observation(0, 0).barcode('old-a'), const _Observation(100, 0).barcode('old-b')], _at(0));
      final second = tracker.update([const _Observation(700, 0).barcode('new-right'), const _Observation(500, 0).barcode('new-left')], _at(30));
      expect(second.added.map((b) => b.symbologyName), ['new-right', 'new-left']);
      expect(second.tracked.map((b) => b.id), [...first.tracked.map((b) => b.id), ...second.added.map((b) => b.id)]);
      final third = tracker.update([const _Observation(501, 0).barcode('left-again'), const _Observation(701, 0).barcode('right-again')], _at(60));
      expect(third.added, isEmpty);
      expect(third.tracked.map((b) => [b.id, b.symbologyName, b.count]).toList(), equals([
        [first.tracked[0].id, 'old-a', 1], [first.tracked[1].id, 'old-b', 1],
        [second.added[0].id, 'right-again', 2], [second.added[1].id, 'left-again', 2],
      ]));
    });
  });

  group('movement gates and finite extreme geometry', () {
    test('uses current extent rather than prior extent', () {
      final larger = QRGenBarcodeTracker(spatial: true, maxJump: 1);
      final first = larger.update([const _Observation(0, 0, width: 1, height: 0).barcode('old')], _at(0));
      final accepted = larger.update([const _Observation(20, 0, width: 40, height: 0).barcode('current')], _at(30));
      expect(accepted.added, isEmpty);
      expect(accepted.tracked.single.id, first.tracked.single.id);
      final smaller = QRGenBarcodeTracker(spatial: true, maxJump: 1);
      smaller.update([const _Observation(0, 0, width: 40, height: 0).barcode('old')], _at(0));
      expect(smaller.update([const _Observation(20, 0, width: 1, height: 0).barcode('current')], _at(30)).added, hasLength(1));
    });

    test('includes exact gate equality and excludes a greater Euclidean distance', () {
      for (final x in [3.0, 3.01]) {
        final tracker = QRGenBarcodeTracker(spatial: true, maxJump: 1);
        tracker.update([const _Observation(0, 0, width: 5, height: 0).barcode('old')], _at(0));
        final update = tracker.update([_Observation(x, 4, width: 5, height: 0).barcode('next')], _at(30));
        expect(update.added, hasLength(x == 3 ? 0 : 1));
      }
    });

    test('finite 1e200 displacement uses stable hypot instead of overflowing squares', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update([const _Observation(0, 0, width: 1e200, height: 0).barcode('old')], _at(0));
      final update = tracker.update([const _Observation(1e200, 1e200, width: 1e200, height: 0).barcode('next')], _at(30));
      expect(update.added, isEmpty);
      expect(update.tracked.single.id, first.tracked.single.id);
      expect(update.tracked.single.count, 2);
    });

    test('finite near-limit corner means do not overflow before division', () {
      final tracker = QRGenBarcodeTracker(spatial: true, maxJump: 0);
      final record = const _Observation(1e308, 0, width: 1e293, height: 0).barcode('same');
      final first = tracker.update([record], _at(0));
      final update = tracker.update([record], _at(30));
      expect(update.added, isEmpty);
      expect(update.tracked.single.id, first.tracked.single.id);
      expect(update.tracked.single.count, 2);
    });

    test('infinite displacement is ineligible without poisoning later zero-distance matches', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final left = const _Observation(-1e308, 0, width: 1e293, height: 0).barcode('left');
      final right = const _Observation(1e308, 0, width: 1e293, height: 0).barcode('right');
      final first = tracker.update([left], _at(0));
      final second = tracker.update([right], _at(30));
      expect(second.added, hasLength(1));
      expect(second.tracked, hasLength(2));
      final third = tracker.update([right, left], _at(60));
      expect(third.added, isEmpty);
      expect(third.tracked.map((b) => [b.id, b.count]).toList(), equals([
        [first.tracked.single.id, 2], [second.added.single.id, 2],
      ]));
    });

    test('tiny nonzero displacement is not rounded to zero by squared-distance underflow', () {
      final tracker = QRGenBarcodeTracker(spatial: true, maxJump: 0);
      tracker.update([const _Observation(0, 0, width: 1e-200, height: 0).barcode('old')], _at(0));
      final update = tracker.update([const _Observation(1e-200, 0, width: 1e-200, height: 0).barcode('next')], _at(30));
      expect(update.added, hasLength(1));
      expect(update.tracked, hasLength(2));
    });
  });

  group('conservative complete-frame association budget', () {
    test('50 by 50 costs exactly 250000 and preserves every tied observation', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update(_dense(50), _at(0));
      final update = tracker.update(_dense(50), _at(30));
      expect(update.added, isEmpty);
      expect(update.tracked.map((b) => b.id), orderedEquals(first.tracked.map((b) => b.id)));
      expect(update.tracked.map((b) => b.count), everyElement(2));
    });

    test('51 by 51 rejects atomically, but new-only and fully expired groups cost zero', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update(_dense(51), _at(0));
      expect(() => tracker.update(_dense(51), _at(30)), throwsRangeError);
      expect(tracker.tracked.map((b) => [b.id, b.count, b.lastSeen]).toList(), equals(first.tracked.map((b) => [b.id, 1, _at(0)]).toList()));
      final expired = tracker.update(_dense(51), _at(501));
      expect(expired.removed, hasLength(51));
      expect(expired.added, hasLength(51));
      expect(expired.tracked.map((b) => b.count), everyElement(1));
      expect(expired.added.any((b) => first.tracked.any((old) => old.id == b.id)), isFalse);
    });

    test('coordinate replacement costs zero and never reuses prior observation IDs', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update(_dense(51), _at(0));
      const resized = QRGenSize(640, 480);
      final update = tracker.update(_dense(51, size: resized), _at(30), resized);
      expect(update.removed, hasLength(51));
      expect(update.added, hasLength(51));
      expect(update.tracked, hasLength(51));
      expect(update.added.any((b) => first.tracked.any((old) => old.id == b.id)), isFalse);
    });

    test('work sums across exact payload groups instead of testing each separately', () {
      final records = [..._dense(40, data: 'A'), ..._dense(40, data: 'B')];
      for (final budget in [250000, 255999, 256000]) {
        final tracker = QRGenBarcodeTracker(spatial: true, maxAssociationWork: budget);
        final first = tracker.update(records, _at(0));
        if (budget < 256000) {
          expect(() => tracker.update(records, _at(30)), throwsRangeError);
          expect(tracker.tracked.map((b) => [b.id, b.count]).toList(), equals(first.tracked.map((b) => [b.id, 1]).toList()));
        } else {
          final update = tracker.update(records, _at(30));
          expect(update.added, isEmpty);
          expect(update.tracked.map((b) => b.count), everyElement(2));
        }
      }
    });

    test('out-of-gate old columns still count in the work estimate', () {
      for (final budget in [27, 28]) {
        final tracker = QRGenBarcodeTracker(spatial: true, maxAssociationWork: budget);
        final old = [for (var i = 0; i < 5; i++) _Observation(i * 100.0, 0).barcode('old-$i')];
        final first = tracker.update(old, _at(0));
        final current = [const _Observation(10000, 0).barcode('far-a'), const _Observation(20000, 0).barcode('far-b')];
        if (budget == 27) {
          expect(() => tracker.update(current, _at(30)), throwsRangeError);
          expect(tracker.tracked.map((b) => b.id), orderedEquals(first.tracked.map((b) => b.id)));
        } else {
          final update = tracker.update(current, _at(30));
          expect(update.added, hasLength(2));
          expect(update.tracked, hasLength(7));
        }
      }
    });

    test('retained unmatched backlog is charged and explicit larger budget has no truncation', () {
      for (final budget in [374999, 375000]) {
        final tracker = QRGenBarcodeTracker(spatial: true, maxAssociationWork: budget);
        final first = tracker.update(_dense(50), _at(0));
        final backlog = tracker.update(_dense(50, x: 1000), _at(10));
        expect(backlog.added, hasLength(50));
        expect(backlog.tracked, hasLength(100));
        if (budget < 375000) {
          expect(() => tracker.update(_dense(50, x: 1), _at(20)), throwsRangeError);
          expect(tracker.tracked.map((b) => b.count), everyElement(1));
        } else {
          final update = tracker.update(_dense(50, x: 1), _at(20));
          expect(update.added, isEmpty);
          expect(update.tracked, hasLength(100));
          expect(update.tracked.take(50).map((b) => b.id), orderedEquals(first.tracked.map((b) => b.id)));
          expect(update.tracked.take(50).map((b) => b.count), everyElement(2));
          expect(update.tracked.skip(50).map((b) => b.count), everyElement(1));
        }
      }
    });
  });
}
