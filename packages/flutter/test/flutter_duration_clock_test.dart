// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/duplicate_filter.dart';
import 'package:qrgen_flutter/src/core/duration_clock.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/session.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';
import 'package:test/test.dart';

DateTime _at(int us, {bool utc = true}) => DateTime.fromMicrosecondsSinceEpoch(us, isUtc: utc);

QRGenBarcode _qr(String data) => QRGenBarcode(data: data, symbology: QRGenSymbology.qr, timestamp: _at(17));

Iterable<QRGenBarcode> _failsAfter(QRGenBarcode barcode) sync* {
  yield barcode;
  throw StateError('late iterator failure');
}

class _ThrowingKeyBarcode extends QRGenBarcode {
  _ThrowingKeyBarcode() : super(data: 'bad', symbology: QRGenSymbology.qr);

  @override
  String get key => throw StateError('late key failure');
}

class _ThrowingMetadataBarcode extends QRGenBarcode {
  _ThrowingMetadataBarcode() : super(data: 'bad', symbology: QRGenSymbology.qr);

  @override
  String get rawBytes => throw StateError('late metadata failure');
}

class _ThrowingComparisonTime implements DateTime {
  _ThrowingComparisonTime(this._instant);

  final DateTime _instant;
  int _comparisons = 0;

  @override
  Duration difference(DateTime other) {
    if (++_comparisons == 2) throw StateError('late DateTime comparison failure');
    return _instant.difference(other);
  }

  @override
  Object? noSuchMethod(Invocation invocation) => throw StateError('unexpected DateTime operation');
}

void main() {
  group('duration clock source ownership', () {
    test('preview does not commit a proposed source', () {
      final clock = QRGenDurationClock();
      final explicit = clock.preview(_at(0));
      expect(explicit.changed, isTrue);
      expect(clock.preview().changed, isTrue);
      clock.commit(explicit);
      expect(clock.preview(_at(1)).changed, isFalse);
      final defaultTime = clock.preview();
      expect(defaultTime.changed, isTrue);
      clock.commit(defaultTime);
      expect(clock.preview().changed, isFalse);
      expect(clock.preview(_at(2)).changed, isTrue);
      clock.reset();
      expect(clock.preview().changed, isTrue);
    });

    test('default elapsed increases independently of epoch metadata', () async {
      final clock = QRGenDurationClock();
      final before = clock.preview();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      final after = clock.preview();
      expect(after.explicit, isFalse);
      expect(after.elapsed, greaterThan(before.elapsed));
      expect(after.timestamp.year, DateTime.now().year);
    });

    test('rebasing retains negative and submillisecond epoch ages', () {
      final sample = QRGenDurationSample(
        timestamp: _at(100),
        elapsed: const Duration(seconds: 4),
        explicit: false,
        changed: true,
      );
      for (final previous in [_at(-500001), _at(99), _at(101)]) {
        expect(sample.age(previous, sample.rebase(previous)), sample.timestamp.difference(previous));
      }
    });
  });

  group('explicit DateTime compatibility', () {
    test('duplicate windows retain floored millisecond boundaries', () {
      final filter = QRGenDuplicateFilter(1);
      final barcode = _qr('A');
      expect(filter.accept(barcode, _at(123)), isTrue);
      expect(filter.accept(barcode, _at(1122)), isFalse);
      expect(filter.accept(barcode, _at(1123)), isTrue);
    });

    test('tracker expiry compares the complete Duration strictly', () {
      final tracker = QRGenBarcodeTracker();
      final first = tracker.update([_qr('A')], _at(123)).tracked.single;
      expect(tracker.prune(_at(500122)).removed, isEmpty);
      expect(tracker.prune(_at(500123)).removed, isEmpty);
      expect(tracker.prune(_at(500124)).removed, [first]);
    });

    test('custom submillisecond and negative timeouts remain valid', () {
      final precise = QRGenBarcodeTracker(timeout: const Duration(microseconds: 7));
      precise.update([_qr('A')], _at(0));
      expect(precise.prune(_at(7)).tracked, hasLength(1));
      expect(precise.prune(_at(8)).removed, hasLength(1));
      final negative = QRGenBarcodeTracker(timeout: const Duration(microseconds: -1));
      negative.update([_qr('A')], _at(0));
      expect(negative.prune(_at(0)).removed, hasLength(1));
    });

    test('rollback neither reports a duplicate nor expires a track', () {
      final filter = QRGenDuplicateFilter();
      final tracker = QRGenBarcodeTracker();
      final barcode = _qr('A');
      filter.accept(barcode, _at(2000000));
      tracker.update([barcode], _at(2000000));
      expect(filter.accept(barcode, _at(0)), isFalse);
      expect(tracker.prune(_at(0)).changed, isFalse);
      expect(filter.accept(barcode, _at(3000000)), isTrue);
      expect(tracker.prune(_at(2500001)).removed, hasLength(1));
    });

    test('UTC/local representations keep instant comparison and object identity', () {
      final first = _at(123, utc: false);
      final last = _at(100123);
      final tracker = QRGenBarcodeTracker();
      tracker.update([_qr('A')], first);
      final item = tracker.update([_qr('A')], last).tracked.single;
      expect(identical(item.firstSeen, first), isTrue);
      expect(identical(item.lastSeen, last), isTrue);
      expect(item.firstSeen.isUtc, isFalse);
      expect(item.lastSeen.isUtc, isTrue);
      final filter = QRGenDuplicateFilter();
      expect(filter.acceptKey('A', first), isTrue);
      expect(filter.acceptKey('A', _at(123)), isFalse);
      expect(filter.acceptKey('A', _at(1000123)), isTrue);
    });

    test('widely separated explicit dates use DateTime difference directly', () {
      final early = _at(-4000000000000000000);
      final late = _at(4000000000000000000);
      final filter = QRGenDuplicateFilter();
      filter.acceptKey('A', early);
      expect(filter.acceptKey('A', late), isTrue);
      final tracker = QRGenBarcodeTracker();
      tracker.update([_qr('A')], late);
      expect(tracker.prune(early).changed, isFalse);
    });
  });

  group('source transitions and policy history', () {
    test('filter rebase keeps separate old and future reports', () {
      final now = DateTime.now();
      final filter = QRGenDuplicateFilter();
      filter.accept(_qr('old'), now.subtract(const Duration(seconds: 60)));
      filter.accept(_qr('future'), now.add(const Duration(seconds: 60)));
      expect(filter.filter([_qr('old'), _qr('future')]).map((b) => b.data), ['old']);
      expect(filter.accept(_qr('future')), isFalse);
    });

    test('empty filter commits a switch without refreshing reports', () {
      final now = DateTime.now();
      final filter = QRGenDuplicateFilter();
      filter.accept(_qr('old'), now.subtract(const Duration(seconds: 60)));
      filter.accept(_qr('future'), now.add(const Duration(seconds: 60)));
      expect(filter.filter<QRGenBarcode>([]), isEmpty);
      expect(filter.filter([_qr('old'), _qr('future')]).map((b) => b.data), ['old']);
    });

    test('acceptKey is explicit when interleaved with default accept', () {
      final filter = QRGenDuplicateFilter();
      final barcode = _qr('A');
      expect(filter.accept(barcode), isTrue);
      final explicitFuture = DateTime.now().add(const Duration(seconds: 60));
      expect(filter.acceptKey(barcode.key, explicitFuture), isTrue);
      expect(filter.accept(barcode), isFalse);
      expect(filter.acceptKey(barcode.key, explicitFuture.add(const Duration(seconds: 1))), isTrue);
    });

    for (final useEmptyUpdate in [false, true]) {
      test('${useEmptyUpdate ? 'empty update' : 'prune'} rebases each tracker age', () {
        final now = DateTime.now();
        final tracker = QRGenBarcodeTracker(timeout: const Duration(minutes: 10));
        // Reverse chronological input keeps both until the source switch.
        tracker.update([_qr('future')], now.add(const Duration(minutes: 20)));
        tracker.update([_qr('old')], now.subtract(const Duration(minutes: 20)));
        final future = tracker.tracked.first;
        final result = useEmptyUpdate ? tracker.update([]) : tracker.prune();
        expect(result.removed.map((b) => b.data), ['old']);
        expect(result.tracked, [future]);
        expect(tracker.prune().changed, isFalse);
      });
    }

    test('default to explicit tracker boundary uses public epoch lastSeen', () {
      final tracker = QRGenBarcodeTracker();
      final first = tracker.update([_qr('A')]).tracked.single;
      expect(first.lastSeen.year, DateTime.now().year);
      expect(tracker.prune(first.lastSeen.add(const Duration(milliseconds: 500))).changed, isFalse);
      expect(tracker.prune(first.lastSeen.add(const Duration(microseconds: 500001))).removed, [first]);
    });

    test('zero mode preserves old reports and records no new ones', () {
      final filter = QRGenDuplicateFilter();
      filter.accept(_qr('A'), _at(0));
      filter.window = 0;
      expect(filter.filter([_qr('A'), _qr('B'), _qr('B')], _at(900000)), hasLength(3));
      expect(filter.length, 1);
      filter.window = 1000;
      expect(filter.filter([_qr('A'), _qr('B')], _at(999999)).map((b) => b.data), ['B']);
      expect(filter.accept(_qr('A'), _at(1000000)), isTrue);
    });

    test('once mode keeps order and past positive-window history', () {
      final filter = QRGenDuplicateFilter();
      filter.accept(_qr('A'), _at(0));
      filter.window = -7;
      expect(filter.filter([_qr('A'), _qr('B'), _qr('B'), _qr('C')], _at(2000000)).map((b) => b.data), ['B', 'C']);
      filter.window = 1000;
      expect(filter.filter([_qr('A'), _qr('B')], _at(2000000)).map((b) => b.data), ['A']);
    });

    test('cleanup at 257 entries retains boundary behavior after rebasing', () {
      final filter = QRGenDuplicateFilter();
      final old = DateTime.now().subtract(const Duration(seconds: 60));
      for (var i = 0; i < 256; i++) {
        filter.acceptKey('$i', old);
      }
      expect(filter.length, 256);
      expect(filter.accept(_qr('new')), isTrue);
      expect(filter.length, 1);
      expect(filter.accept(_qr('new')), isFalse);
    });

    test('reset clears source association and retained IDs', () {
      final future = DateTime.now().add(const Duration(days: 1));
      final filter = QRGenDuplicateFilter(-1)..accept(_qr('A'), future);
      final tracker = QRGenBarcodeTracker()..update([_qr('A')], future);
      filter.reset();
      tracker.reset();
      expect(filter.accept(_qr('A')), isTrue);
      final item = tracker.update([_qr('A')]).tracked.single;
      expect(item.count, 1);
      expect(item.id, qrgenTrackingId('qr', 'A'));
      expect(item.lastSeen.isBefore(future), isTrue);
    });
  });

  group('failed batches preserve history and source', () {
    test('cleanup comparison failure does not record or remove filter history', () {
      final filter = QRGenDuplicateFilter();
      for (var i = 0; i < 256; i++) {
        filter.acceptKey('$i', _at(0));
      }
      expect(() => filter.acceptKey('new', _ThrowingComparisonTime(_at(2000000))), throwsStateError);
      expect(filter.length, 256);
      expect(filter.acceptKey('0', _at(999999)), isFalse);
      expect(filter.acceptKey('new', _at(999999)), isTrue);
    });

    test('late prune comparison failure cannot commit earlier removals', () {
      final tracker = QRGenBarcodeTracker();
      final before = tracker.update([_qr('A'), _qr('B')], _at(0)).tracked;
      expect(() => tracker.prune(_ThrowingComparisonTime(_at(500001))), throwsStateError);
      expect(tracker.tracked, before);
      expect(tracker.prune(_at(500000)).removed, isEmpty);
      expect(tracker.prune(_at(500001)).removed, before);
    });

    for (final once in [false, true]) {
      test('${once ? 'once' : 'window'} filter rejects a late iterator atomically', () {
        final filter = QRGenDuplicateFilter(once ? -1 : 1000)..accept(_qr('A'), _at(0));
        expect(() => filter.filter(_failsAfter(_qr('B'))), throwsStateError);
        expect(filter.length, 1);
        expect(filter.accept(_qr('A'), _at(999999)), isFalse);
        expect(filter.accept(_qr('B'), _at(999999)), isTrue);
      });
    }

    test('a late key getter cannot record the earlier code', () {
      final filter = QRGenDuplicateFilter();
      expect(() => filter.filter([_qr('A'), _ThrowingKeyBarcode()]), throwsStateError);
      expect(filter.length, 0);
      expect(filter.accept(_qr('A')), isTrue);
    });

    test('late tracker iteration cannot expire tracks or consume collision IDs', () {
      final tracker = QRGenBarcodeTracker();
      final original = tracker.update([_qr('costarring')], _at(0)).tracked.single;
      expect(() => tracker.update(_failsAfter(_qr('liquid')), _at(500001)), throwsStateError);
      expect(tracker.tracked, [original]);
      final recovery = tracker.update([_qr('liquid')], _at(100000));
      expect(recovery.tracked.map((b) => b.id), [original.id, '${original.id}-1']);
      expect(recovery.removed, isEmpty);
    });

    test('late tracker metadata failure leaves source, metadata and output intact', () {
      final future = DateTime.now().add(const Duration(minutes: 1));
      final tracker = QRGenBarcodeTracker();
      final original = tracker.update([_qr('A')], future).tracked.single;
      expect(() => tracker.update([_qr('A'), _ThrowingMetadataBarcode()]), throwsStateError);
      expect(tracker.tracked, [original]);
      expect(tracker.tracked.single.count, 1);
      expect(identical(tracker.tracked.single.lastSeen, future), isTrue);
      expect(tracker.prune(future.add(const Duration(milliseconds: 500))).changed, isFalse);
    });
  });

  group('session clock forwarding and metadata', () {
    test('default batch retains epoch metadata distinct from decode timestamp', () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      final barcode = _qr('A');
      final result = session.process([barcode]);
      final tracked = result.tracked!.single;
      expect(identical(result.scanned.single, barcode), isTrue);
      expect(identical(tracked.timestamp, barcode.timestamp), isTrue);
      expect(tracked.firstSeen.year, DateTime.now().year);
      expect(identical(tracked.firstSeen, tracked.lastSeen), isTrue);
      expect(tracked.id, qrgenTrackingId('qr', 'A'));
      expect(session.process([]).tracked, isNull);
      expect(session.tick(), isNull);
    });

    test('explicit session process and tick retain microsecond metadata', () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      final first = _at(123);
      final tracked = session.process([_qr('A')], first).tracked!.single;
      expect(identical(tracked.firstSeen, first), isTrue);
      expect(session.tick(_at(500123)), isNull);
      expect(session.tick(_at(500124)), isEmpty);
    });

    test('mode changes clear tracker but retain duplicate history', () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch, duplicateFilter: -1);
      session.process([_qr('A')], _at(0));
      session.configure(mode: QRGenScanMode.continuous);
      expect(session.tracked, isEmpty);
      expect(session.process([_qr('A')]).scanned, isEmpty);
      session.configure(mode: QRGenScanMode.batch);
      final result = session.process([_qr('A')]);
      expect(result.scanned, isEmpty);
      expect(result.tracked!.single.count, 1);
      session.reset();
      expect(session.process([_qr('A')]).scanned, hasLength(1));
    });

    test('stopped frames cannot replace history before resume', () {
      final session = QRGenScanSession(mode: QRGenScanMode.single);
      expect(session.process([_qr('A')], _at(0)).stop, isTrue);
      expect(session.process([_qr('B')]).scanned, isEmpty);
      session.resume();
      expect(session.process([_qr('A')], _at(999999)).scanned, isEmpty);
      expect(session.process([_qr('B')], _at(999999)).stop, isTrue);
    });
  });
}
