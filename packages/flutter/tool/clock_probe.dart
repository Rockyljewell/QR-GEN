// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Compile this probe with the official Dart web compiler; QRGen algorithms are imported unchanged.
import 'dart:convert';
import 'dart:js_interop';

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/duplicate_filter.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/session.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';

@JS('qrAuditSetClock')
external void _setClock(JSNumber elapsed, JSNumber wall);

/// Fixed epoch shared with the isolated clock boundary runner.
const baseWall = 1800000000000;
/// Machine-readable outcomes from the compiled Dart checks.
final results = <Map<String, Object?>>[];

/// Sets elapsed and wall time independently in the isolated runtime.
void clock(int elapsed, {int offset = 0, int? wall}) =>
    _setClock(elapsed.toJS, (wall ?? baseWall + elapsed + offset).toJS);

/// Creates an explicitly timed epoch control.
DateTime at(int milliseconds) => DateTime.fromMillisecondsSinceEpoch(milliseconds);
/// Creates an actual barcode using production constructors.
QRGenBarcode qr([String data = 'A', DateTime? timestamp]) =>
    QRGenBarcode(data: data, symbology: QRGenSymbology.qr, timestamp: timestamp);

/// Compares only the primitive and collection values used by the test oracle.
bool equivalent(Object? actual, Object? expected) {
  if (actual is List<Object?> && expected is List<Object?>) {
    return actual.length == expected.length &&
        List.generate(actual.length, (i) => equivalent(actual[i], expected[i])).every((v) => v);
  }
  if (actual is Map<Object?, Object?> && expected is Map<Object?, Object?>) {
    return actual.length == expected.length &&
        expected.keys.every((key) => actual.containsKey(key) && equivalent(actual[key], expected[key]));
  }
  return actual == expected;
}

/// Runs one independent case with a fresh initial clock boundary.
void check(String name, String kind, Object? expected, Object? Function() run) {
  clock(0);
  try {
    final actual = run();
    results.add({'name': name, 'kind': kind, 'expected': expected,
      'actual': actual, 'passed': equivalent(actual, expected)});
  } catch (error, stack) {
    results.add({'name': name, 'kind': kind, 'expected': expected,
      'passed': false, 'error': '$error', 'stack': '$stack'});
  }
}

/// Emits the machine-readable receipt consumed by the isolated Node runner.
// ignore: avoid_print
void emit(String phase) => print('QRGEN_DART_CLOCK_RESULT:${jsonEncode({
  'phase': phase,
  'scope': 'Official compiler execution of exact QRGen Dart sources on the web target; no native Flutter VM, widgets, phone, or competitor comparison.',
  'results': results,
})}');

/// A wall-clock jump and its independent elapsed-duration expectation.
class Scenario {
  /// Creates an immutable test scenario.
  const Scenario(this.name, this.elapsed, this.offset, this.report, this.expire);
  /// Case label.
  final String name;
  /// Elapsed milliseconds since the initial observation.
  final int elapsed;
  /// Wall-clock offset from ordinary elapsed progression.
  final int offset;
  /// Whether a positive duplicate window should permit another report.
  final bool report;
  /// Whether a stale track should expire.
  final bool expire;
  /// Applies this scenario through the isolated clock boundary.
  void advance() => clock(elapsed, offset: offset);
}

/// Calibrates the clocks before checking actual default and explicit APIs.
void main() {
  check('calibration initial epoch and elapsed', 'calibration', [baseWall, 0], () {
    final watch = Stopwatch()..start();
    return [DateTime.now().millisecondsSinceEpoch, watch.elapsedMilliseconds];
  });
  for (final step in [60000, -60000]) {
    check('calibration wall ${step > 0 ? 'forward' : 'rollback'} only', 'calibration', [step, 0], () {
      final initial = DateTime.now();
      final watch = Stopwatch()..start();
      clock(0, offset: step);
      return [DateTime.now().difference(initial).inMilliseconds, watch.elapsedMilliseconds];
    });
  }
  check('calibration elapsed only', 'calibration', [0, 2000], () {
    final initial = DateTime.now();
    final watch = Stopwatch()..start();
    clock(2000, wall: baseWall);
    return [DateTime.now().difference(initial).inMilliseconds, watch.elapsedMilliseconds];
  });
  if (results.any((result) => result['passed'] != true)) {
    emit('calibration-rejected');
    return;
  }

  // These oracles use elapsed duration: rollback after 2 seconds must allow/expire;
  // a 60-second wall jump after 100ms must not allow/expire. No optional now is supplied.
  for (final s in const [
    Scenario('rollback', 2000, -60000, true, true),
    Scenario('forward', 100, 60000, false, false),
  ]) {
    check('default filter.accept ${s.name}', 'default-clock', s.report, () {
      final filter = QRGenDuplicateFilter();
      final barcode = qr();
      if (!filter.accept(barcode)) throw StateError('Initial acceptance failed');
      s.advance();
      return filter.accept(barcode);
    });
    check('default filter.filter ${s.name}', 'default-clock', s.report ? 1 : 0, () {
      final filter = QRGenDuplicateFilter();
      final barcode = qr();
      if (filter.filter([barcode]).length != 1) throw StateError('Initial report failed');
      s.advance();
      return filter.filter([barcode]).length;
    });
    check('default tracker.prune ${s.name}', 'default-clock',
        [s.expire ? 0 : 1, s.expire ? 1 : 0, s.expire], () {
      final tracker = QRGenBarcodeTracker();
      tracker.update([qr()]);
      s.advance();
      final update = tracker.prune();
      return [update.tracked.length, update.removed.length, update.changed];
    });
    check('default tracker.update empty ${s.name}', 'default-clock',
        [s.expire ? 0 : 1, s.expire ? 1 : 0, s.expire], () {
      final tracker = QRGenBarcodeTracker();
      tracker.update([qr()]);
      s.advance();
      final update = tracker.update([]);
      return [update.tracked.length, update.removed.length, update.changed];
    });
    check('default session continuous ${s.name}', 'default-clock', s.report ? 1 : 0, () {
      final session = QRGenScanSession();
      final barcode = qr();
      if (session.process([barcode]).scanned.length != 1) throw StateError('Initial session report failed');
      s.advance();
      return session.process([barcode]).scanned.length;
    });
    check('default session batch.tick ${s.name}', 'default-clock', s.expire ? <String>[] : null, () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      session.process([qr()]);
      s.advance();
      return session.tick()?.map((item) => item.data).toList();
    });
    check('default session batch.process empty ${s.name}', 'default-clock', s.expire ? <String>[] : null, () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      session.process([qr()]);
      s.advance();
      return session.process([]).tracked?.map((item) => item.data).toList();
    });
  }

  check('ordinary filter positive boundaries', 'control', [true, false, false, true, false, true], () {
    final filter = QRGenDuplicateFilter();
    final barcode = qr();
    final values = [filter.accept(barcode)];
    for (final elapsed in [500, 999, 1000, 1500, 2000]) {
      clock(elapsed);
      values.add(filter.accept(barcode));
    }
    return values;
  });
  check('filter zero ignores wall jumps and remembers nothing', 'control', [true, true, true, 0], () {
    final filter = QRGenDuplicateFilter(0);
    final barcode = qr();
    final first = filter.accept(barcode);
    clock(2000, offset: -60000);
    final second = filter.accept(barcode);
    clock(2100, offset: 60000);
    return [first, second, filter.accept(barcode), filter.length];
  });
  check('filter once retains history across jumps until reset', 'control', [true, false, false, true], () {
    final filter = QRGenDuplicateFilter(-1);
    final barcode = qr();
    final first = filter.accept(barcode);
    clock(2000, offset: -60000);
    final second = filter.accept(barcode);
    clock(2100, offset: 60000);
    final third = filter.accept(barcode);
    filter.reset();
    return [first, second, third, filter.accept(barcode)];
  });
  check('ordinary filter cleanup', 'control', [300, 1, false], () {
    final filter = QRGenDuplicateFilter(100);
    for (var i = 0; i < 300; i++) { filter.accept(qr('$i')); }
    final before = filter.length;
    clock(1000);
    final late = qr('late');
    filter.accept(late);
    return [before, filter.length, filter.accept(late)];
  });
  check('ordinary tracker 500 versus 501 boundary', 'control', [1, false, 1, 0], () {
    final tracker = QRGenBarcodeTracker();
    tracker.update([qr()]);
    clock(500);
    final kept = tracker.prune();
    clock(501);
    final expired = tracker.prune();
    return [kept.tracked.length, kept.changed, expired.removed.length, tracker.length];
  });
  check('tracker aggregates duplicate payload and counts once per frame', 'control', [1, 2, 1], () {
    final tracker = QRGenBarcodeTracker();
    final barcode = qr();
    final first = tracker.update([barcode, barcode]).tracked.single.count;
    clock(100);
    final second = tracker.update([barcode, barcode]).tracked.single.count;
    return [first, second, tracker.length];
  });
  check('ordinary returning expired code starts count and epoch again', 'control', [1, baseWall + 2000, baseWall + 2000], () {
    final tracker = QRGenBarcodeTracker();
    tracker.update([qr()]);
    clock(2000);
    final track = tracker.update([qr()]).tracked.single;
    return [track.count, track.firstSeen.millisecondsSinceEpoch, track.lastSeen.millisecondsSinceEpoch];
  });
  check('tracker reset clears history', 'control', [0, 1, baseWall + 100], () {
    final tracker = QRGenBarcodeTracker();
    tracker.update([qr()]);
    tracker.reset();
    final empty = tracker.length;
    clock(100);
    final track = tracker.update([qr()]).tracked.single;
    return [empty, track.count, track.firstSeen.millisecondsSinceEpoch];
  });
  check('ordinary session continuous boundary', 'control', [1, 0, 1], () {
    final session = QRGenScanSession();
    final barcode = qr();
    final first = session.process([barcode]).scanned.length;
    clock(999);
    final second = session.process([barcode]).scanned.length;
    clock(1000);
    return [first, second, session.process([barcode]).scanned.length];
  });
  for (final timer in [true, false]) {
    check('ordinary session batch ${timer ? 'tick' : 'empty frame'} boundary', 'control', [null, <String>[], 0], () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch);
      session.process([qr()]);
      clock(500);
      final first = timer ? session.tick() : session.process([]).tracked;
      clock(501);
      final second = timer ? session.tick() : session.process([]).tracked;
      return [first?.map((item) => item.data).toList(), second?.map((item) => item.data).toList(), session.tracked.length];
    });
  }
  check('single resume keeps once history and reset clears it', 'control', [true, 0, false, true], () {
    final session = QRGenScanSession(mode: QRGenScanMode.single, duplicateFilter: -1);
    final barcode = qr();
    final first = session.process([barcode]);
    session.resume();
    clock(10000);
    final second = session.process([barcode]);
    session.reset();
    return [first.stop, second.scanned.length, second.stop, session.process([barcode]).stop];
  });
  check('mode configure clears tracks and retains duplicate history', 'control', [0, 0, null, 'continuous'], () {
    final session = QRGenScanSession(mode: QRGenScanMode.batch, duplicateFilter: -1);
    final barcode = qr();
    session.process([barcode]);
    session.configure(mode: QRGenScanMode.continuous);
    return [session.process([barcode]).scanned.length, session.tracked.length, session.tick(), session.mode.name];
  });
  check('explicit time stays independent from omitted clock sources', 'control', [true, false, true, 1, 1, 300, 111], () {
    final filter = QRGenDuplicateFilter();
    final barcode = qr('A', at(111));
    final first = filter.accept(barcode, at(0));
    clock(2000, offset: -60000);
    final second = filter.accept(barcode, at(999));
    final third = filter.accept(barcode, at(1000));
    final tracker = QRGenBarcodeTracker();
    tracker.update([barcode], at(0));
    final kept = tracker.prune(at(500)).tracked.length;
    final removed = tracker.prune(at(501)).removed.length;
    final session = QRGenScanSession(mode: QRGenScanMode.batch);
    final track = session.process([barcode], at(300)).tracked!.single;
    return [first, second, third, kept, removed, track.lastSeen.millisecondsSinceEpoch, track.timestamp.millisecondsSinceEpoch];
  });
  check('omitted barcode and tracked metadata use wall epoch', 'control',
      [baseWall + 60000, baseWall + 60000, baseWall + 60000, baseWall + 60000,
        baseWall - 60000, baseWall - 60000, baseWall - 60000, baseWall - 60000], () {
    final tracker = QRGenBarcodeTracker();
    clock(0, offset: 60000);
    final firstBarcode = qr();
    final first = tracker.update([firstBarcode]).tracked.single;
    clock(100, wall: baseWall - 60000);
    final secondBarcode = qr('B');
    final second = tracker.update([secondBarcode]).tracked.firstWhere((track) => track.data == 'B');
    return [firstBarcode.timestamp.millisecondsSinceEpoch, first.timestamp.millisecondsSinceEpoch,
      first.firstSeen.millisecondsSinceEpoch, first.lastSeen.millisecondsSinceEpoch,
      secondBarcode.timestamp.millisecondsSinceEpoch, second.timestamp.millisecondsSinceEpoch,
      second.firstSeen.millisecondsSinceEpoch, second.lastSeen.millisecondsSinceEpoch];
  });
  check('explicit barcode timestamp remains distinct from tracking epoch', 'control', [42, baseWall + 60000, baseWall + 60000], () {
    clock(0, offset: 60000);
    final tracker = QRGenBarcodeTracker();
    final track = tracker.update([qr('A', at(42))]).tracked.single;
    return [track.timestamp.millisecondsSinceEpoch, track.firstSeen.millisecondsSinceEpoch, track.lastSeen.millisecondsSinceEpoch];
  });
  _spatialChecks();
  emit('completed');
}

QRGenBarcode _spatialBarcode([DateTime? timestamp]) => QRGenBarcode(
      data: 'A',
      symbology: QRGenSymbology.qr,
      location: QRGenQuadrilateral.fromRect(const QRGenRect(10, 20, 10, 10)),
      frameSize: const QRGenSize(640, 480),
      timestamp: timestamp,
    );

void _spatialChecks() {
  // Actual opt-in APIs use valid geometry and omit now throughout these cases.
  // The harness supplies independent wall and elapsed clocks, never associations.
  for (final s in const [
    Scenario('rollback', 2000, -60000, true, true),
    Scenario('forward', 100, 60000, false, false),
  ]) {
    check('spatial tracker.prune ${s.name}', 'spatial-default-clock',
        [s.expire ? 0 : 1, s.expire ? 1 : 0, s.expire], () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      tracker.update([_spatialBarcode()]);
      s.advance();
      final update = tracker.prune();
      return [update.tracked.length, update.removed.length, update.changed];
    });
    check('spatial tracker.update empty ${s.name}', 'spatial-default-clock',
        [s.expire ? 0 : 1, s.expire ? 1 : 0, s.expire], () {
      final tracker = QRGenBarcodeTracker(spatial: true);
      tracker.update([_spatialBarcode()]);
      s.advance();
      final update = tracker.update([], null, const QRGenSize(640, 480));
      return [update.tracked.length, update.removed.length, update.changed];
    });
    check('spatial session batch.tick ${s.name}', 'spatial-default-clock',
        s.expire ? <String>[] : null, () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
      session.process([_spatialBarcode()]);
      s.advance();
      return session.tick()?.map((item) => item.data).toList();
    });
    check('spatial session batch.process empty ${s.name}', 'spatial-default-clock',
        s.expire ? <String>[] : null, () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
      session.process([_spatialBarcode()]);
      s.advance();
      return session.process([], null, const QRGenSize(640, 480))
          .tracked?.map((item) => item.data).toList();
    });
    check('spatial session prepared duplicate filter ${s.name}', 'spatial-default-clock',
        [s.report ? 1 : 0, s.expire, s.expire ? 1 : 2], () {
      final session = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
      final first = session.process([_spatialBarcode()]);
      if (first.scanned.length != 1) throw StateError('Initial spatial report failed');
      final initialId = first.tracked!.single.id;
      s.advance();
      final second = session.process([_spatialBarcode()]);
      final track = second.tracked!.single;
      return [second.scanned.length, track.id != initialId, track.count];
    });
  }

  check('spatial tracker 500 versus 501 elapsed boundary', 'spatial-control',
      [1, false, 1, 0], () {
    final tracker = QRGenBarcodeTracker(spatial: true);
    tracker.update([_spatialBarcode()]);
    clock(500, offset: 60000);
    final kept = tracker.prune();
    clock(501, offset: -60000);
    final expired = tracker.prune();
    return [kept.tracked.length, kept.changed, expired.removed.length, tracker.length];
  });
  check('spatial session tick and blank elapsed boundaries', 'spatial-control',
      [null, null, <String>[], <String>[], 0, 0], () {
    final timer = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
    final frame = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
    timer.process([_spatialBarcode()]);
    frame.process([_spatialBarcode()]);
    clock(500, offset: 60000);
    final timerKept = timer.tick()?.map((item) => item.id).toList();
    final frameKept = frame.process([], null, const QRGenSize(640, 480))
        .tracked?.map((item) => item.id).toList();
    clock(501, offset: -60000);
    final timerExpired = timer.tick()?.map((item) => item.id).toList();
    final frameExpired = frame.process([], null, const QRGenSize(640, 480))
        .tracked?.map((item) => item.id).toList();
    return [timerKept, frameKept, timerExpired, frameExpired,
      timer.tracked.length, frame.tracked.length];
  });
  check('spatial metadata preserves epoch through wall rollback', 'spatial-control',
      [true, 2, baseWall + 60000, baseWall - 60000, baseWall - 60000,
        true, 2, baseWall + 60000, baseWall - 60000, baseWall - 60000], () {
    final tracker = QRGenBarcodeTracker(spatial: true);
    final session = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
    clock(0, offset: 60000);
    final firstBarcode = _spatialBarcode();
    final first = tracker.update([firstBarcode]).tracked.single;
    final firstSession = session.process([firstBarcode]).tracked!.single;
    clock(100, wall: baseWall - 60000);
    final secondBarcode = _spatialBarcode();
    final second = tracker.update([secondBarcode]).tracked.single;
    final secondSession = session.process([secondBarcode]).tracked!.single;
    return [second.id == first.id, second.count, second.firstSeen.millisecondsSinceEpoch,
      second.lastSeen.millisecondsSinceEpoch, second.timestamp.millisecondsSinceEpoch,
      secondSession.id == firstSession.id, secondSession.count,
      secondSession.firstSeen.millisecondsSinceEpoch, secondSession.lastSeen.millisecondsSinceEpoch,
      secondSession.timestamp.millisecondsSinceEpoch];
  });
  check('spatial explicit time and decode metadata remain independent', 'spatial-control',
      [1, 1, 42, 300, 300, null, <String>[]], () {
    final barcode = _spatialBarcode(at(42));
    final tracker = QRGenBarcodeTracker(spatial: true);
    tracker.update([barcode], at(0));
    clock(2000, offset: -60000);
    final kept = tracker.prune(at(500)).tracked.length;
    final removed = tracker.prune(at(501)).removed.length;
    final session = QRGenScanSession(mode: QRGenScanMode.batch, spatialTracking: true);
    final track = session.process([barcode], at(300)).tracked!.single;
    return [kept, removed, track.timestamp.millisecondsSinceEpoch,
      track.firstSeen.millisecondsSinceEpoch, track.lastSeen.millisecondsSinceEpoch,
      session.tick(at(800))?.map((item) => item.id).toList(),
      session.tick(at(801))?.map((item) => item.id).toList()];
  });
}
