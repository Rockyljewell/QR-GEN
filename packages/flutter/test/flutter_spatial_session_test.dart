// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'dart:collection';

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/duplicate_filter.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/session.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';
import 'package:test/test.dart';

DateTime _at(int us, {bool utc = true}) => DateTime.fromMicrosecondsSinceEpoch(us, isUtc: utc);

QRGenBarcode _code(String data, double x, {QRGenSize frame = const QRGenSize(640, 480), double extent = 10}) => QRGenBarcode(
      data: data,
      symbology: QRGenSymbology.qr,
      frameSize: frame,
      location: QRGenQuadrilateral.fromRect(QRGenRect(x, 10, extent, extent)),
      timestamp: _at(17),
      rawBytes: 'cGF5bG9hZA==',
      orientation: 90,
      ecLevel: 'M',
      symbologyIdentifier: ']Q1',
    );

QRGenScanSession _session({int duplicateFilter = 1000, int maxWork = 250000}) => QRGenScanSession(
      mode: QRGenScanMode.batch,
      duplicateFilter: duplicateFilter,
      spatialTracking: true,
      trackMaxAssociationWork: maxWork,
    );

class _ThrowingMetadata extends QRGenBarcode {
  _ThrowingMetadata() : super(data: 'late', symbology: QRGenSymbology.qr);

  @override
  String get rawBytes => throw StateError('late metadata');
}

class _SnapshotCallback extends QRGenBarcode {
  _SnapshotCallback(this.callback) : super(data: 'A', symbology: QRGenSymbology.qr);
  final void Function() callback;

  @override
  String get rawBytes {
    callback();
    return '';
  }
}

class _ReadOnceMetadata extends QRGenBarcode {
  _ReadOnceMetadata([this.onRead])
      : super(
          data: 'A',
          symbology: QRGenSymbology.qr,
          frameSize: const QRGenSize(640, 480),
          location: QRGenQuadrilateral.fromRect(const QRGenRect(0, 10, 10, 10)),
          timestamp: _at(17),
        );

  final void Function()? onRead;
  int reads = 0;
  @override
  String get rawBytes {
    if (++reads > 1) throw StateError('caller metadata read twice');
    onRead?.call();
    return 'canonical';
  }
}

class _FailingList extends ListBase<QRGenBarcode> {
  @override
  int get length => 2;
  @override
  set length(int value) => throw UnsupportedError('read only');
  @override
  QRGenBarcode operator [](int index) {
    if (index == 0) return _code('new', 30);
    throw StateError('late list iteration');
  }

  @override
  void operator []=(int index, QRGenBarcode value) => throw UnsupportedError('read only');
}

class _ComparisonTime implements DateTime {
  _ComparisonTime(this.instant, {this.failAt, this.onFirst});
  final DateTime instant;
  final int? failAt;
  final void Function()? onFirst;
  int comparisons = 0;

  @override
  int get microsecondsSinceEpoch => instant.microsecondsSinceEpoch;

  @override
  Duration difference(DateTime other) {
    comparisons++;
    if (comparisons == 1) onFirst?.call();
    if (comparisons == failAt) throw StateError('late time comparison');
    return instant.difference(other);
  }

  @override
  Object? noSuchMethod(Invocation invocation) => throw StateError('unexpected DateTime operation');
}

void main() {
  group('spatial sessions and payload reports', () {
    test('equal labels are separate observations with one shared payload report', () {
      final session = _session();
      final first = session.process([_code('A', 0), _code('A', 40)], _at(0));
      expect(first.scanned.map((b) => b.data), ['A']);
      expect(first.tracked, hasLength(2));
      expect(first.tracked!.map((b) => b.id).toSet(), hasLength(2));
      final ids = first.tracked!.map((b) => b.id).toList();
      final moved = session.process([_code('A', 41), _code('A', 1)], _at(100000));
      expect(moved.scanned, isEmpty);
      expect(moved.tracked!.map((b) => b.id), ids);
      expect(moved.tracked!.map((b) => b.count), [2, 2]);
    });

    test('zero duplicate window reports every label without merging observations', () {
      final session = _session(duplicateFilter: 0);
      final frame = [_code('A', 0), _code('A', 40)];
      for (final time in [0, 100000]) {
        final result = session.process(frame, _at(time));
        expect(result.scanned, hasLength(2));
        expect(result.tracked, hasLength(2));
      }
    });

    test('default payload aggregation and permissive missing geometry stay unchanged', () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      final input = QRGenBarcode(data: 'A', symbology: QRGenSymbology.qr, timestamp: _at(17));
      final result = session.process([input, input], _at(0), const QRGenSize(0.5, -1));
      expect(result.tracked, hasLength(1));
      expect(result.tracked!.single.id, qrgenTrackingId('qr', 'A'));
      expect(identical(result.scanned.single, input), isTrue);
      expect(session.resetSpatial(), isNull);
      expect(session.tracked, hasLength(1));
    });

    test('single and continuous modes ignore spatial-only geometry', () {
      final input = QRGenBarcode(data: 'A', symbology: QRGenSymbology.qr);
      for (final mode in [QRGenScanMode.single, QRGenScanMode.continuous]) {
        final session = QRGenScanSession(mode: mode, spatialTracking: true);
        final result = session.process([input], _at(0), const QRGenSize(-1, 0.5));
        expect(result.scanned, [input]);
        expect(result.tracked, isNull);
        expect(result.stop, mode == QRGenScanMode.single);
      }
    });

    test('caller fields are snapshotted once before both helpers consume them', () {
      final session = _session();
      final input = _ReadOnceMetadata();
      final result = session.process([input], _at(0));
      expect(input.reads, 1);
      expect(result.scanned.single.rawBytes, 'canonical');
      expect(result.tracked!.single.rawBytes, 'canonical');
      expect(result.scanned.single.runtimeType, QRGenBarcode);
    });

    test('tracking and decode DateTimes retain distinct exact objects', () {
      final session = _session();
      final now = _at(123, utc: false);
      final input = _code('A', 0);
      final result = session.process([input], now);
      final track = result.tracked!.single;
      expect(identical(track.firstSeen, now), isTrue);
      expect(identical(track.lastSeen, now), isTrue);
      expect(identical(track.timestamp, input.timestamp), isTrue);
      expect(track.orientation, 90);
      expect(track.rawBytes, input.rawBytes);
      expect(track.ecLevel, 'M');
      expect(track.symbologyIdentifier, ']Q1');
    });

    test('process, getter and partial-expiry tick use the same public namespace', () {
      final session = _session();
      final first = session.process([_code('A', 0), _code('B', 40)], _at(0)).tracked!;
      expect(first.every((b) => b.id.startsWith('spatial-0:')), isTrue);
      final updated = session.process([_code('A', 1)], _at(100000)).tracked!;
      expect(session.tracked.map((b) => b.id), updated.map((b) => b.id));
      final ticked = session.tick(_at(500001))!;
      expect(ticked.single.id, first.first.id);
      expect(ticked.single.count, 2);
      expect(session.tick(_at(600000)), isNull);
      expect(session.tick(_at(600001)), isEmpty);
    });

    test('omitted time keeps epoch metadata and transitions to exact explicit expiry', () {
      final session = _session();
      final input = _code('A', 0);
      final result = session.process([input]);
      final track = result.tracked!.single;
      expect(track.firstSeen.year, DateTime.now().year);
      expect(identical(track.firstSeen, track.lastSeen), isTrue);
      expect(identical(track.timestamp, input.timestamp), isTrue);
      expect(session.process([]).tracked, isNull);
      expect(session.tick(track.lastSeen.add(const Duration(microseconds: 500000))), isNull);
      expect(session.tick(track.lastSeen.add(const Duration(microseconds: 500001))), isEmpty);
    });

    test('blank default-time transition independently rebases past and future histories', () {
      final now = DateTime.now();
      final future = now.add(const Duration(minutes: 20));
      final past = now.subtract(const Duration(minutes: 20));
      final session = QRGenScanSession(
        mode: QRGenScanMode.batch,
        spatialTracking: true,
        trackingTimeout: const Duration(minutes: 10),
      );
      final futureTrack = session.process([_code('future', 0)], future).tracked!.single;
      session.process([_code('past', 40)], past);
      final transition = session.process([]);
      expect(transition.tracked!.map((b) => b.data), ['future']);
      expect(identical(transition.tracked!.single.lastSeen, future), isTrue);
      final next = session.process([_code('future', 0), _code('past', 40)]);
      expect(next.scanned.map((b) => b.data), ['past']);
      expect(next.tracked!.first.id, futureTrack.id);
      expect(next.tracked!.map((b) => b.count), [2, 1]);
    });

    test('rejected omitted-time frame cannot commit either helper clock transition', () {
      final session = _session();
      final future = DateTime.now().add(const Duration(days: 1));
      final past = DateTime.now().subtract(const Duration(minutes: 1));
      final futureTrack = session.process([_code('future', 0)], future).tracked!.single;
      final pastTrack = session.process([_code('past', 40)], past).tracked!.last;
      expect(() => session.process([_code('B', double.nan)]), throwsArgumentError);
      expect(session.tracked.map((b) => b.id), [futureTrack.id, pastTrack.id]);
      final recovery = session.process([_code('future', 0), _code('past', 40), _code('B', 80)]);
      expect(recovery.scanned.map((b) => b.data), ['past', 'B']);
      expect(recovery.tracked!.first.id, futureTrack.id);
      expect(recovery.tracked![1].id, isNot(pastTrack.id));
      expect(identical(recovery.tracked!.first.firstSeen, future), isTrue);
      expect(recovery.tracked!.map((b) => b.count), [2, 1, 1]);
    });
  });

  group('reactive policy and reset boundaries', () {
    test('equal effective policies preserve tracks and duplicate history', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      session.configure(spatialTracking: true, trackMaxJump: 3, trackMaxAssociationWork: 250000, duplicateFilter: -7);
      expect(session.tracked.single.id, old.id);
      final result = session.process([_code('A', 1)], _at(100000));
      expect(result.scanned, isEmpty);
      expect(result.tracked!.single.id, old.id);
    });

    test('changed policy clears observations, namespaces fresh IDs and retains reports', () {
      final session = _session(duplicateFilter: -1);
      final first = session.process([_code('A', 0)], _at(0)).tracked!.single;
      session.configure(trackMaxJump: 4);
      expect(session.tracked, isEmpty);
      final next = session.process([_code('A', 0)], _at(100000));
      expect(next.scanned, isEmpty);
      expect(next.tracked!.single.id, startsWith('spatial-1:'));
      expect(next.tracked!.single.id, isNot(first.id));
      session.configure(trackMaxAssociationWork: 200000);
      expect(session.process([_code('A', 0)], _at(200000)).tracked!.single.id, startsWith('spatial-2:'));
    });

    test('invalid policy combined with mode/window proposal changes nothing', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      for (final invalid in [double.nan, double.infinity, -1.0]) {
        expect(
          () => session.configure(mode: QRGenScanMode.single, duplicateFilter: 0, spatialTracking: false, trackMaxJump: invalid),
          throwsArgumentError,
        );
        expect(session.mode, QRGenScanMode.batch);
        expect(session.spatialTracking, isTrue);
        expect(session.trackMaxJump, 3);
        expect(session.tracked.single.id, old.id);
        expect(session.stopped, isFalse);
      }
      expect(() => session.configure(trackMaxAssociationWork: 0), throwsArgumentError);
      expect(() => session.configure(trackMaxAssociationWork: 9007199254740992), throwsArgumentError);
      expect(session.process([_code('A', 0)], _at(100000)).scanned, isEmpty);
    });

    test('policy changes preserve stopped state and mode changes resume', () {
      final session = QRGenScanSession(mode: QRGenScanMode.single, duplicateFilter: -1, spatialTracking: true);
      expect(session.process([_code('A', 0)], _at(0)).stop, isTrue);
      session.configure(trackMaxJump: 4);
      expect(session.stopped, isTrue);
      expect(session.process([_ThrowingMetadata()], _at(1)).scanned, isEmpty);
      session.configure(mode: QRGenScanMode.batch);
      expect(session.stopped, isFalse);
      final result = session.process([_code('A', 0)], _at(100000));
      expect(result.scanned, isEmpty);
      expect(result.tracked!.single.id, startsWith('spatial-1:'));
    });

    test('resetSpatial clears once and preserves reports and allocator freshness', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      expect(session.resetSpatial(), isEmpty);
      expect(session.resetSpatial(), isNull);
      final next = session.process([_code('A', 0)], _at(100000));
      expect(next.scanned, isEmpty);
      expect(next.tracked!.single.id, isNot(old.id));
      expect(next.tracked!.single.id, startsWith('spatial-0:'));
    });

    test('full reset clears reports and mode boundaries preserve allocator freshness', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      session.configure(mode: QRGenScanMode.continuous);
      expect(session.tracked, isEmpty);
      expect(session.process([_code('A', 0)], _at(100000)).scanned, isEmpty);
      session.configure(mode: QRGenScanMode.batch);
      final returned = session.process([_code('A', 0)], _at(200000));
      expect(returned.scanned, isEmpty);
      expect(returned.tracked!.single.id, isNot(old.id));
      session.reset();
      final reset = session.process([_code('A', 0)], _at(300000));
      expect(reset.scanned, hasLength(1));
      expect(reset.tracked!.single.id, isNot(returned.tracked!.single.id));
      expect(reset.tracked!.single.id, startsWith('spatial-0:'));
    });

    test('positive/zero/once window changes keep the established payload history', () {
      final session = _session();
      session.process([_code('A', 0)], _at(0));
      session.configure(duplicateFilter: 0);
      expect(session.process([_code('A', 0), _code('B', 40)], _at(900000)).scanned, hasLength(2));
      session.configure(duplicateFilter: -1);
      expect(session.process([_code('A', 0), _code('B', 40)], _at(999999)).scanned.map((b) => b.data), ['B']);
      session.configure(duplicateFilter: 1000);
      expect(session.process([_code('A', 0), _code('B', 40)], _at(1000000)).scanned.map((b) => b.data), ['A']);
    });
  });

  group('spatial session frame transactions', () {
    test('late caller metadata failure cannot consume reports or observation IDs', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      expect(() => session.process([_code('B', 40), _ThrowingMetadata()], _at(600000)), throwsStateError);
      expect(session.tracked.single.id, old.id);
      final result = session.process([_code('B', 40)], _at(100000));
      expect(result.scanned.map((b) => b.data), ['B']);
      expect(result.tracked!.map((b) => b.count), [1, 1]);
    });

    test('late list iteration failure cannot partially record the first barcode', () {
      final session = _session(duplicateFilter: -1);
      expect(() => session.process(_FailingList(), _at(0)), throwsStateError);
      expect(session.tracked, isEmpty);
      final result = session.process([_code('new', 30)], _at(1));
      expect(result.scanned.map((b) => b.data), ['new']);
      expect(result.tracked!.single.count, 1);
    });

    test('tracker time failure after filter preparation leaves both histories intact', () {
      final session = _session();
      final first = session.process([_code('A', 0)], _at(0)).tracked!.single;
      final failing = _ComparisonTime(_at(1000000), failAt: 2);
      expect(() => session.process([_code('A', 0), _code('B', 40)], failing), throwsStateError);
      expect(failing.comparisons, 2); // Filter's existing A comparison, then tracker expiry.
      expect(session.tracked.single.id, first.id);
      expect(identical(session.tracked.single.lastSeen, first.lastSeen), isTrue);
      final recovery = session.process([_code('A', 0), _code('B', 40)], _at(100000));
      expect(recovery.scanned.map((b) => b.data), ['B']);
      expect(recovery.tracked!.map((b) => b.count), [2, 1]);
    });

    test('invalid geometry and size reject without clearing observations or reports', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      for (final invalid in [
        _code('B', 40, extent: 0),
        _code('B', 40, frame: const QRGenSize(640.5, 480)),
        _code('B', double.nan),
      ]) {
        expect(() => session.process([invalid], _at(600000)), throwsArgumentError);
        expect(session.tracked.single.id, old.id);
      }
      expect(() => session.process([], _at(600000), const QRGenSize(0, 480)), throwsArgumentError);
      final next = session.process([_code('B', 40)], _at(100000));
      expect(next.scanned.map((b) => b.data), ['B']);
      expect(next.tracked, hasLength(2));
    });

    test('mixed source dimensions reject atomically', () {
      final session = _session(duplicateFilter: -1);
      expect(() => session.process([_code('A', 0), _code('B', 40, frame: const QRGenSize(480, 640))], _at(0)), throwsArgumentError);
      expect(session.tracked, isEmpty);
      final good = session.process([_code('A', 0), _code('B', 40)], _at(1));
      expect(good.scanned.map((b) => b.data), ['A', 'B']);
      expect(good.tracked, hasLength(2));
    });

    test('budget rejection after filter preparation records no new payload', () {
      final session = _session(duplicateFilter: -1, maxWork: 1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      expect(() => session.process([_code('A', 0), _code('B', 40)], _at(100000)), throwsArgumentError);
      expect(session.tracked.single.id, old.id);
      expect(session.tracked.single.count, 1);
      // New-only groups do no assignment work, so B can now be accepted.
      final good = session.process([_code('B', 40)], _at(100000));
      expect(good.scanned.map((b) => b.data), ['B']);
      expect(good.tracked, hasLength(2));
    });

    test('empty measured source-size change clears once but retains payload history', () {
      final session = _session(duplicateFilter: -1);
      final first = session.process([_code('A', 0)], _at(0)).tracked!.single;
      expect(session.process([], _at(1), const QRGenSize(480, 640)).tracked, isEmpty);
      expect(session.process([], _at(2), const QRGenSize(480, 640)).tracked, isNull);
      final next = session.process([_code('A', 0, frame: const QRGenSize(480, 640))], _at(3));
      expect(next.scanned, isEmpty);
      expect(next.tracked!.single.id, isNot(first.id));
      expect(next.tracked!.single.id, startsWith('spatial-0:'));
    });

    test('omitting blank frame size retains coordinates and strict microsecond expiry', () {
      final session = _session();
      final first = session.process([_code('A', 0)], _at(123)).tracked!.single;
      expect(session.process([], _at(500123)).tracked, isNull);
      expect(session.tracked.single.id, first.id);
      expect(session.process([], _at(500124)).tracked, isEmpty);
    });

    test('reentrant reset during caller snapshot prevents an outer frame from committing', () {
      final session = _session(duplicateFilter: -1);
      final old = session.process([_code('A', 0)], _at(0)).tracked!.single;
      expect(() => session.process([_SnapshotCallback(session.reset)], _at(100000)), throwsStateError);
      expect(session.tracked, isEmpty); // The deliberate reset remains authoritative.
      final next = session.process([_code('A', 0)], _at(200000));
      expect(next.scanned, hasLength(1));
      expect(next.tracked!.single.id, isNot(old.id));
    });

    test('equal configuration from a getter does not cancel the admitted frame', () {
      final session = _session();
      final input = _ReadOnceMetadata(() => session.configure(trackMaxJump: 3));
      expect(session.process([input], _at(0)).tracked, hasLength(1));
      expect(input.reads, 1);
    });

    test('policy change during tick comparison cannot restore cleared old tracks', () {
      final session = _session(duplicateFilter: -1);
      session.process([_code('A', 0)], _at(0));
      final reentrant = _ComparisonTime(_at(100000), onFirst: () => session.configure(trackMaxJump: 4));
      expect(() => session.tick(reentrant), throwsStateError);
      expect(session.tracked, isEmpty);
      final next = session.process([_code('A', 0)], _at(200000));
      expect(next.scanned, isEmpty);
      expect(next.tracked!.single.id, startsWith('spatial-1:'));
    });
  });

  group('prepared duplicate-filter transactions', () {
    test('preparation is invisible until commit and keeps ordering', () {
      final filter = QRGenDuplicateFilter();
      final plan = filter.prepareFilter([_code('A', 0), _code('A', 40), _code('B', 80)], _at(0));
      expect(filter.length, 0);
      expect(plan.scanned.map((b) => b.data), ['A', 'B']);
      plan.validateCurrent();
      plan.commit();
      expect(filter.length, 2);
      expect(filter.filter([_code('A', 0), _code('B', 80)], _at(999999)), isEmpty);
      expect(plan.commit, throwsStateError);
    });

    test('a committed competing plan makes older plans obsolete', () {
      final filter = QRGenDuplicateFilter(-1);
      final old = filter.prepareFilter([_code('A', 0)], _at(0));
      final newer = filter.prepareFilter([_code('B', 40)], _at(1));
      newer.commit();
      expect(old.validateCurrent, throwsStateError);
      expect(old.commit, throwsStateError);
      expect(filter.accept(_code('A', 0), _at(2)), isTrue);
      expect(filter.accept(_code('B', 40), _at(2)), isFalse);
    });

    test('effective window changes and reset invalidate plans while no-ops preserve them', () {
      final filter = QRGenDuplicateFilter(-1);
      final same = filter.prepareFilter([_code('A', 0)], _at(0));
      filter.window = -7;
      same.commit();
      final changed = filter.prepareFilter([_code('B', 40)], _at(1));
      filter.window = 0;
      expect(changed.commit, throwsStateError);
      final reset = filter.prepareFilter([_code('C', 80)], _at(2));
      filter.reset();
      expect(reset.commit, throwsStateError);
      expect(filter.length, 0);
    });

    test('ordinary accept and successful empty filter invalidate older plans', () {
      final filter = QRGenDuplicateFilter(-1);
      final first = filter.prepareFilter([_code('A', 0)], _at(0));
      filter.accept(_code('B', 40), _at(1));
      expect(first.commit, throwsStateError);
      final second = filter.prepareFilter([_code('A', 0)], _at(2));
      filter.filter<QRGenBarcode>([], _at(3));
      expect(second.commit, throwsStateError);
      expect(filter.length, 1);
    });
  });
}
