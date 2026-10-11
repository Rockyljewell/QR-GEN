// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/spatial_association.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';
import 'package:test/test.dart';

DateTime _at(int us, {bool utc = true}) => DateTime.fromMicrosecondsSinceEpoch(us, isUtc: utc);
const _size = QRGenSize(640, 480);

QRGenBarcode _code(String data, double x, {QRGenSize size = _size, QRGenQuadrilateral? location}) => QRGenBarcode(
  data: data,
  symbology: QRGenSymbology.qr,
  symbologyName: 'name',
  rawBytes: 'YQ==',
  contentType: QRGenContentType.binary,
  isGS1: true,
  location: location ?? QRGenQuadrilateral.fromRect(QRGenRect(x, 10, 10, 10)),
  frameSize: size,
  orientation: 90,
  ecLevel: 'H',
  symbologyIdentifier: ']Q1',
  timestamp: _at(17),
);

Iterable<QRGenBarcode> _lateFailure(QRGenBarcode first) sync* {
  yield first;
  throw StateError('late iteration');
}

class _MetadataBarcode extends QRGenBarcode {
  _MetadataBarcode({this.onRead, this.fail = false})
    : super(
        data: 'A',
        symbology: QRGenSymbology.qr,
        location: QRGenQuadrilateral.fromRect(const QRGenRect(0, 10, 10, 10)),
        frameSize: _size,
        timestamp: _at(17),
      );
  final void Function()? onRead;
  final bool fail;
  int reads = 0;
  String bytes = 'before';

  @override
  String get rawBytes {
    reads++;
    onRead?.call();
    if (fail) throw StateError('late metadata');
    return bytes;
  }
}

class _ThrowingTime implements DateTime {
  _ThrowingTime(this._instant);
  final DateTime _instant;
  int _comparisons = 0;

  @override
  int get microsecondsSinceEpoch => _instant.microsecondsSinceEpoch;

  @override
  Duration difference(DateTime other) {
    if (++_comparisons == 2) throw StateError('late comparison');
    return _instant.difference(other);
  }

  @override
  Object? noSuchMethod(Invocation invocation) => throw StateError('unexpected DateTime operation');
}

void main() {
  group('policy and default compatibility', () {
    test('defaults preserve payload aggregation, FNV and invalid-size permissiveness', () {
      final tracker = QRGenBarcodeTracker();
      expect(tracker.spatial, isFalse);
      expect(tracker.maxJump, 3);
      expect(tracker.maxAssociationWork, 250000);
      final result = tracker.update([_code('A', 0), _code('A', 100)], _at(0), const QRGenSize(double.nan, -1));
      expect(result.tracked, hasLength(1));
      expect(result.tracked.single.id, qrgenTrackingId('qr', 'A'));
      expect(result.tracked.single.count, 1);
    });

    for (final jump in [-1.0, double.nan, double.infinity, double.negativeInfinity]) {
      test('rejects invalid maxJump $jump even when spatial mode is off', () {
        expect(() => QRGenBarcodeTracker(maxJump: jump), throwsRangeError);
      });
    }
    for (final work in [0, -1, 9007199254740992]) {
      test('rejects invalid portable work budget $work', () {
        expect(() => QRGenBarcodeTracker(maxAssociationWork: work), throwsRangeError);
      });
    }
    test('portable integer guard rejects overflow without advancing', () {
      expect(incrementQRGenSpatialInteger(qrgenSpatialMaxInteger - 1), qrgenSpatialMaxInteger);
      expect(() => incrementQRGenSpatialInteger(qrgenSpatialMaxInteger), throwsRangeError);
      expect(() => incrementQRGenSpatialInteger(0), throwsRangeError);
      expect(
        QRGenBarcodeTracker(maxAssociationWork: qrgenSpatialMaxInteger).maxAssociationWork,
        qrgenSpatialMaxInteger,
      );
    });
  });

  group('spatial observations and metadata', () {
    test('separates repeated payloads and counts each detection once', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.update([_code('A', 0), _code('A', 100)], _at(0));
      expect(first.tracked.map((b) => b.id), ['spatial-1', 'spatial-2']);
      final next = tracker.update([_code('A', 101), _code('A', 1)], _at(100));
      expect(next.tracked.map((b) => b.id), ['spatial-1', 'spatial-2']);
      expect(next.tracked.map((b) => b.location.topLeft.x), [1, 101]);
      expect(next.tracked.map((b) => b.count), [2, 2]);
      expect(next.added, isEmpty);
    });

    test('full metadata snapshots preserve DateTime identity and ignore later getters', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final barcode = _MetadataBarcode();
      final now = _at(123, utc: false);
      final plan = tracker.prepareUpdate([barcode], now);
      expect(barcode.reads, 1);
      barcode.bytes = 'after';
      plan.commit();
      final item = tracker.tracked.single;
      expect(item.rawBytes, 'before');
      expect(item.timestamp, _at(17));
      expect(identical(item.firstSeen, now), isTrue);
      expect(identical(item.lastSeen, now), isTrue);
      expect(item.firstSeen.isUtc, isFalse);
      expect(barcode.reads, 1);
      final metadata = tracker.update([_code('A', 0)], _at(200)).tracked.single;
      expect(metadata.symbologyName, 'name');
      expect(metadata.rawBytes, 'YQ==');
      expect(metadata.contentType, QRGenContentType.binary);
      expect(metadata.isGS1, isTrue);
      expect(metadata.orientation, 90);
      expect(metadata.ecLevel, 'H');
      expect(metadata.symbologyIdentifier, ']Q1');
    });

    test('retains unmatched tracks and expires strictly at full microsecond boundary', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      tracker.update([_code('A', 0), _code('A', 100)], _at(123));
      tracker.update([_code('A', 1)], _at(100123));
      expect(tracker.prune(_at(500123)).removed, isEmpty);
      final expired = tracker.prune(_at(500124));
      expect(expired.removed.map((b) => b.id), ['spatial-2']);
      expect(expired.tracked.single.id, 'spatial-1');
    });

    test('reset, expiry and blank size changes never recycle spatial IDs', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      expect(tracker.update([_code('A', 0)], _at(0)).tracked.single.id, 'spatial-1');
      tracker.reset();
      expect(tracker.update([_code('A', 0)], _at(0)).tracked.single.id, 'spatial-2');
      expect(tracker.prune(_at(500001)).removed.single.id, 'spatial-2');
      expect(tracker.update([_code('A', 0)], _at(500001)).tracked.single.id, 'spatial-3');
      final reset = tracker.update([], _at(500002), const QRGenSize(480, 640));
      expect(reset.removed.single.id, 'spatial-3');
      expect(reset.changed, isTrue);
      expect(
        tracker.update([_code('A', 0, size: const QRGenSize(480, 640))], _at(500003)).tracked.single.id,
        'spatial-4',
      );
    });

    test('same-size blank frame is no change and prune does not forget source size', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      tracker.update([_code('A', 0)], _at(0));
      expect(tracker.update([], _at(1), _size).changed, isFalse);
      expect(tracker.prune(_at(2)).changed, isFalse);
      final resized = tracker.update([], _at(3), const QRGenSize(1, 2));
      expect(resized.removed, hasLength(1));
    });

    test('spatial result lists cannot be modified before deferred commit', () {
      final plan = QRGenBarcodeTracker(spatial: true).prepareUpdate([_code('A', 0)], _at(0));
      expect(plan.result.tracked.clear, throwsUnsupportedError);
      expect(plan.result.added.clear, throwsUnsupportedError);
      expect(() => plan.result.removed.add(plan.result.tracked.single), throwsUnsupportedError);
    });
  });

  group('strict geometry and dimensions', () {
    for (final size in [
      QRGenSize.zero,
      const QRGenSize(1.5, 2),
      const QRGenSize(double.nan, 1),
      const QRGenSize(double.infinity, 1),
      const QRGenSize(9007199254740992, 1),
    ]) {
      test('rejects source size $size on a record and empty frame', () {
        final tracker = QRGenBarcodeTracker(spatial: true);
        expect(() => tracker.update([_code('A', 0, size: size)], _at(0)), throwsRangeError);
        expect(() => tracker.update([], _at(0), size), throwsRangeError);
        expect(tracker.length, 0);
        expect(tracker.update([_code('A', 0)], _at(0)).tracked.single.id, 'spatial-1');
      });
    }
    test('rejects mixed record sizes despite an explicit frame size', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      expect(
        () => tracker.update([_code('A', 0), _code('B', 0, size: const QRGenSize(480, 640))], _at(0), _size),
        throwsRangeError,
      );
      expect(tracker.length, 0);
    });
    test('requires nonzero finite geometry but accepts a one-dimensional extent', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      expect(() => tracker.update([_code('A', 0, location: QRGenQuadrilateral.zero)], _at(0)), throwsRangeError);
      final infinite = QRGenQuadrilateral.fromRect(const QRGenRect(double.infinity, 0, 1, 1));
      expect(() => tracker.update([_code('A', 0, location: infinite)], _at(0)), throwsRangeError);
      final line = QRGenQuadrilateral.fromRect(const QRGenRect(-100, 0, 10, 0));
      expect(tracker.update([_code('A', 0, location: line)], _at(0)).tracked, hasLength(1));
    });
    test('rejects finite corners whose derived extent or gate overflows', () {
      final extreme = QRGenQuadrilateral.fromRect(const QRGenRect(-1e308, 0, 1e308, 1));
      expect(
        () => QRGenBarcodeTracker(spatial: true).update([_code('A', 0, location: extreme)], _at(0)),
        throwsRangeError,
      );
    });
  });

  group('prepared transactions and failure atomicity', () {
    for (final spatial in [false, true]) {
      test('preparation for spatial=$spatial changes neither output history nor IDs', () {
        final tracker = QRGenBarcodeTracker(spatial: spatial);
        final plan = tracker.prepareUpdate([_code('A', 0)], _at(0));
        expect(tracker.length, 0);
        expect(plan.result.added, hasLength(1));
        plan.validateCurrent();
        plan.commit();
        expect(tracker.length, 1);
        expect(plan.validateCurrent, throwsStateError);
        expect(plan.commit, throwsStateError);
        expect(tracker.tracked.single.count, 1);
      });
    }
    test('abandoned plan consumes no ordinal or source dimensions', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      tracker.prepareUpdate([_code('A', 0)], _at(0), _size);
      final accepted = tracker.update([_code('B', 0, size: const QRGenSize(1, 2))], _at(0));
      expect(accepted.tracked.single.id, 'spatial-1');
      expect(accepted.removed, isEmpty);
    });
    test('prepared prune leaves removals pending until its commit', () {
      final tracker = QRGenBarcodeTracker(spatial: true)..update([_code('A', 0)], _at(0));
      final plan = tracker.preparePrune(_at(500001));
      expect(plan.result.removed, hasLength(1));
      expect(tracker.length, 1);
      plan.commit();
      expect(tracker.length, 0);
    });
    test('another accepted update and reset both invalidate old plans', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = tracker.prepareUpdate([_code('A', 0)], _at(0));
      tracker.update([_code('B', 0)], _at(0));
      expect(first.commit, throwsStateError);
      final second = tracker.preparePrune(_at(1));
      tracker.reset();
      expect(second.commit, throwsStateError);
      expect(tracker.length, 0);
    });
    test('a reentrant caller getter cannot overwrite its own accepted reset', () {
      final tracker = QRGenBarcodeTracker(spatial: true)..update([_code('B', 0)], _at(0));
      final barcode = _MetadataBarcode(onRead: tracker.reset);
      expect(() => tracker.update([barcode], _at(1)), throwsStateError);
      expect(tracker.length, 0);
      expect(tracker.update([_code('A', 0)], _at(2)).tracked.single.id, 'spatial-2');
    });
    test('late metadata and iteration errors preserve expiry, IDs and geometry', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final original = tracker.update([_code('A', 0)], _at(0)).tracked.single;
      expect(() => tracker.update([_code('B', 0), _MetadataBarcode(fail: true)], _at(500001)), throwsStateError);
      expect(() => tracker.update(_lateFailure(_code('B', 0)), _at(500001)), throwsStateError);
      expect(tracker.tracked.single.id, original.id);
      expect(tracker.tracked.single.count, 1);
      final recovery = tracker.update([_code('B', 0)], _at(1));
      expect(recovery.added.single.id, 'spatial-2');
      expect(recovery.removed, isEmpty);
    });
    test('late clock comparison cannot commit earlier expiry', () {
      final tracker = QRGenBarcodeTracker(spatial: true)..update([_code('A', 0), _code('B', 0)], _at(0));
      expect(() => tracker.prune(_ThrowingTime(_at(500001))), throwsStateError);
      expect(tracker.length, 2);
      expect(tracker.prune(_at(500000)).removed, isEmpty);
    });
  });

  group('DateTime and source-transition compatibility', () {
    test('explicit rollback and UTC/local dates keep identity and unsaturated ages', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final first = _at(1000123, utc: false);
      tracker.update([_code('A', 0)], first);
      expect(tracker.prune(_at(0)).changed, isFalse);
      final last = _at(1100123);
      final item = tracker.update([_code('A', 1)], last).tracked.single;
      expect(identical(item.firstSeen, first), isTrue);
      expect(identical(item.lastSeen, last), isTrue);
      expect(item.timestamp, _at(17));
    });
    test('empty default transition preserves separate old and future anchors', () {
      final now = DateTime.now();
      final tracker = QRGenBarcodeTracker(spatial: true, timeout: const Duration(minutes: 10));
      tracker.update([_code('future', 0)], now.add(const Duration(minutes: 20)));
      tracker.update([_code('old', 0)], now.subtract(const Duration(minutes: 20)));
      final result = tracker.update([]);
      expect(result.removed.map((b) => b.data), ['old']);
      expect(result.tracked.single.data, 'future');
      expect(tracker.prune().changed, isFalse);
    });
    test('default metadata remains epoch-valued and explicit prune retains precision', () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      final item = tracker.update([_code('A', 0)]).tracked.single;
      expect(item.lastSeen.year, DateTime.now().year);
      expect(tracker.prune(item.lastSeen.add(const Duration(microseconds: 500000))).changed, isFalse);
      expect(tracker.prune(item.lastSeen.add(const Duration(microseconds: 500001))).removed.single.id, item.id);
    });
  });
}
