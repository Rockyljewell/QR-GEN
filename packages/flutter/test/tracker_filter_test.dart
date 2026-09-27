import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/duplicate_filter.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/session.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:qrgen_flutter/src/core/tracker.dart';
import 'package:test/test.dart';

DateTime at(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

QRGenBarcode qr(String data, {int t = 0, QRGenQuadrilateral location = QRGenQuadrilateral.zero}) =>
    QRGenBarcode(data: data, symbology: QRGenSymbology.qr, timestamp: at(t), location: location);

QRGenBarcode ean(String data) => QRGenBarcode(data: data, symbology: QRGenSymbology.ean13, timestamp: at(0));

void main() {
  group('QRGenDuplicateFilter', () {
    test('suppresses repeats inside the window, measured from the last report', () {
      final f = QRGenDuplicateFilter(1000);
      expect(f.accept(qr('a'), at(0)), isTrue);
      expect(f.accept(qr('a'), at(500)), isFalse);
      expect(f.accept(qr('a'), at(999)), isFalse);
      expect(f.accept(qr('a'), at(1000)), isTrue);
      expect(f.accept(qr('a'), at(1500)), isFalse);
      expect(f.accept(qr('a'), at(2000)), isTrue);
    });

    test('keys on symbology and data', () {
      final f = QRGenDuplicateFilter();
      expect(f.accept(qr('123'), at(0)), isTrue);
      expect(f.accept(ean('123'), at(0)), isTrue);
      expect(f.accept(qr('124'), at(0)), isTrue);
    });

    test('0 reports every frame', () {
      final f = QRGenDuplicateFilter(0);
      expect(f.filter([qr('a'), qr('a')], at(0)), hasLength(2));
      expect(f.length, 0);
    });

    test('-1 reports once per session', () {
      final f = QRGenDuplicateFilter(-1);
      expect(f.accept(qr('a'), at(0)), isTrue);
      expect(f.accept(qr('a'), at(100000000)), isFalse);
      f.reset();
      expect(f.accept(qr('a'), at(100000001)), isTrue);
      expect(QRGenDuplicateFilter(-7).window, -1);
    });

    test('filters in order and drops in-frame duplicates', () {
      final f = QRGenDuplicateFilter();
      expect(f.filter([qr('a'), qr('b'), qr('a')], at(0)).map((b) => b.data), ['a', 'b']);
    });

    test('cleans up old entries', () {
      final f = QRGenDuplicateFilter(100);
      for (var i = 0; i < 300; i++) {
        f.accept(qr('$i'), at(0));
      }
      f.accept(qr('late'), at(1000));
      expect(f.length, lessThan(300));
      expect(f.accept(qr('late'), at(1001)), isFalse);
    });
  });

  group('qrgenTrackingId', () {
    test('matches FNV-1a 32 reference values', () {
      expect(qrgenTrackingId('qr', ''), 'qr-811c9dc5');
      expect(qrgenTrackingId('qr', 'a'), 'qr-e40c292c');
      expect(qrgenTrackingId('qr', 'foobar'), 'qr-bf9cf968');
    });

    test('is stable and depends on symbology and data', () {
      expect(qrgenTrackingId('ean13', 'x'), qrgenTrackingId('ean13', 'x'));
      expect(qrgenTrackingId('qr', 'x'), isNot(qrgenTrackingId('qr', 'y')));
      expect(qrgenTrackingId('ean13', 'x'), startsWith('ean13-'));
    });
  });

  group('QRGenBarcodeTracker', () {
    test('adds, updates and drops codes after 500 ms unseen', () {
      final t = QRGenBarcodeTracker();
      expect(t.timeout, const Duration(milliseconds: 500));

      var u = t.update([qr('a'), qr('b')], at(0));
      expect(u.added.map((x) => x.data), ['a', 'b']);
      expect(u.changed, isTrue);
      final idA = u.tracked.first.id;
      expect(idA, qrgenTrackingId('qr', 'a'));

      u = t.update([qr('a')], at(300));
      expect(u.added, isEmpty);
      final a = u.tracked.firstWhere((x) => x.data == 'a');
      expect(a.id, idA);
      expect(a.count, 2);
      expect(a.firstSeen, at(0));
      expect(a.lastSeen, at(300));

      u = t.update([qr('a')], at(501));
      expect(u.removed.map((x) => x.data), ['b']);
      expect(u.tracked.map((x) => x.data), ['a']);

      expect(t.prune(at(1001)).changed, isFalse);
      u = t.prune(at(1002));
      expect(u.removed.map((x) => x.data), ['a']);
      expect(t.length, 0);
    });

    test('counts once per frame and refreshes the location', () {
      final t = QRGenBarcodeTracker();
      t.update([qr('a'), qr('a')], at(0));
      expect(t.tracked.single.count, 1);
      final moved = QRGenQuadrilateral.fromRect(const QRGenRect(5, 5, 4, 4));
      final u = t.update([qr('a', t: 9, location: moved)], at(100));
      expect(u.tracked.single.location, moved);
      expect(u.tracked.single.timestamp, at(9));
    });

    test('reset clears everything', () {
      final t = QRGenBarcodeTracker()..update([qr('a')], at(0));
      t.reset();
      expect(t.tracked, isEmpty);
    });
  });

  group('QRGenScanSession', () {
    test('single mode stops after the first accepted scan', () {
      final s = QRGenScanSession(mode: QRGenScanMode.single);
      expect(s.process([], at(0)).stop, isFalse);
      final r = s.process([qr('a')], at(10));
      expect(r.scanned.map((b) => b.data), ['a']);
      expect(r.stop, isTrue);
      expect(s.stopped, isTrue);
      expect(s.process([qr('b')], at(20)).scanned, isEmpty);
      s.resume();
      expect(s.process([qr('a')], at(30)).scanned, isEmpty);
      expect(s.process([qr('b')], at(40)).scanned.map((b) => b.data), ['b']);
    });

    test('continuous mode applies the duplicate filter', () {
      final s = QRGenScanSession();
      expect(s.process([qr('a')], at(0)).scanned, hasLength(1));
      expect(s.process([qr('a')], at(100)).scanned, isEmpty);
      expect(s.process([qr('a')], at(1100)).scanned, hasLength(1));
      expect(s.process([qr('a')], at(1200)).tracked, isNull);
    });

    test('batch mode tracks and ticks', () {
      final s = QRGenScanSession(mode: QRGenScanMode.batch, duplicateFilter: -1);
      var r = s.process([qr('a'), qr('b')], at(0));
      expect(r.scanned, hasLength(2));
      expect(r.tracked, hasLength(2));
      r = s.process([qr('a'), qr('b')], at(100));
      expect(r.scanned, isEmpty);
      expect(r.tracked, hasLength(2));
      expect(s.tick(at(400)), isNull);
      expect(s.tick(at(601)), isEmpty);
    });

    test('configure and reset', () {
      final s = QRGenScanSession(mode: QRGenScanMode.single, duplicateFilter: -1);
      s.process([qr('a')], at(0));
      s.configure(mode: QRGenScanMode.continuous);
      expect(s.stopped, isFalse);
      expect(s.process([qr('a')], at(10)).scanned, isEmpty);
      s.reset();
      expect(s.process([qr('a')], at(20)).scanned, hasLength(1));
      s.configure(duplicateFilter: 0);
      expect(s.process([qr('a')], at(21)).scanned, hasLength(1));
      expect(s.tick(at(10000)), isNull);
    });
  });
}
