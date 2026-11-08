// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual mounted QRGenScanner/MobileScanner/controller and highlight painters.
// Generated captures cross the existing asynchronous fake-platform boundary;
// these tests do not establish physical-camera or native-frame provenance.
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

import 'scanner_widget_test.dart' as fixture;

enum _Boundary { running, stop, inactive }

class _Trace {
  _Trace(this.name);

  final String name;
  final fixture.CallbackTrace callbacks = fixture.CallbackTrace();
  final Stopwatch elapsed = Stopwatch()..start();
  final List<Map<String, Object?>> snapshots = [];

  Map<String, Object?> record(WidgetTester tester, fixture.FakeScannerPlatform platform, String phase) {
    final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    final painters = tester
        .widgetList<CustomPaint>(find.byType(CustomPaint))
        .map((paint) => paint.painter)
        .whereType<QRGenHighlightPainter>()
        .toList(growable: false);
    final polygons = List<List<List<double>>>.unmodifiable([
      for (final painter in painters)
        for (final polygon in painter.polygons)
          List<List<double>>.unmodifiable([
            for (final point in polygon) List<double>.unmodifiable([point.dx, point.dy]),
          ]),
    ]);
    final snapshot = Map<String, Object?>.unmodifiable({
      'phase': phase,
      'elapsedMicroseconds': elapsed.elapsedMicroseconds,
      'controllerIdentity': identityHashCode(native),
      'controllerRunning': native.value.isRunning,
      'cameraDirection': native.value.cameraDirection.name,
      'platformRunning': platform.running,
      'starts': platform.starts.length,
      'stops': platform.stops,
      'highlightPainterCount': painters.length,
      'polygons': polygons,
      'viewSize': [tester.getSize(find.byType(QRGenScanner)).width, tester.getSize(find.byType(QRGenScanner)).height],
      'scanReports': callbacks.scans.length,
      'trackReports': callbacks.tracks.length,
      'lastTrackData': callbacks.tracks.isEmpty
          ? const <Object?>[]
          : List<Object?>.unmodifiable(callbacks.tracks.last.map((code) => code['data'])),
    });
    snapshots.add(snapshot);
    return snapshot;
  }
}

void _expectVisibleCapture(Map<String, Object?> snapshot) {
  expect(snapshot['highlightPainterCount'], 1, reason: 'An actual current capture must first produce the real highlight painter.');
  final polygons = snapshot['polygons']! as List<List<List<double>>>;
  expect(polygons, hasLength(1));
  final polygon = polygons.single;
  expect(polygon, hasLength(4));
  for (final point in polygon) {
    expect(point, hasLength(2));
    expect(point.every((coordinate) => coordinate.isFinite), isTrue);
  }
  expect(polygon.map((point) => point[0]).toSet().length, greaterThan(1));
  expect(polygon.map((point) => point[1]).toSet().length, greaterThan(1));
}

void main() {
  late fixture.FakeScannerPlatform platform;

  setUp(() {
    platform = fixture.FakeScannerPlatform();
    MobileScannerPlatform.instance = platform;
  });

  setUpAll(() {
    debugPrint('FLUTTER_STOPPED_TRACKING_RUNTIME Dart ${Platform.version}');
  });

  Future<void> mount(WidgetTester tester, QRGenScannerController controller, _Trace trace, {bool active = true}) async {
    await tester.pumpWidget(fixture.host(QRGenScanner(
      controller: controller,
      isActive: active,
      options: const QRGenScannerOptions(
        symbologies: ['qr'],
        mode: QRGenScanMode.batch,
        duplicateFilter: -1,
        beep: false,
        vibrate: false,
      ),
      showToast: false,
      onScan: trace.callbacks.scanned,
      onTrack: trace.callbacks.tracked,
      onError: trace.callbacks.failed,
    )));
    await fixture.settle(tester);
  }

  Future<void> detect(WidgetTester tester, String payload) async {
    platform.barcodes.add(fixture.capture(payload));
    await fixture.settle(tester);
  }

  void retain(WidgetTester tester, QRGenScannerController controller, _Trace trace) {
    addTearDown(() async {
      // Public-controller disposal is not actual widget or camera disposal.
      await tester.pumpWidget(const SizedBox());
      await fixture.settle(tester);
      final cleanup = {
        'attached': controller.isAttached,
        'scannerMounted': find.byType(QRGenScanner).evaluate().isNotEmpty,
        'mobileScannerMounted': find.byType(MobileScanner).evaluate().isNotEmpty,
        'platformRunning': platform.running,
        'barcodeListener': platform.barcodes.hasListener,
        'torchListener': platform.torch.hasListener,
        'zoomListener': platform.zoom.hasListener,
        'transientCallbacks': tester.binding.transientCallbackCount,
      };
      controller.dispose();
      await platform.barcodes.close();
      await platform.torch.close();
      await platform.zoom.close();
      debugPrint('FLUTTER_STOPPED_TRACKING_PROBE ${jsonEncode({
        'name': trace.name,
        'snapshots': trace.snapshots,
        'events': trace.callbacks.events,
        'scanSnapshots': trace.callbacks.scans,
        'trackSnapshots': trace.callbacks.tracks,
        'errors': trace.callbacks.errors,
        'cleanup': cleanup,
        'timerCheck': 'flutter_test automatic post-test pending-timer invariant',
        'scope': 'Actual mounted widget/controller/painter; asynchronous fake camera-platform captures only. No phone or native-frame claim.',
      })}');
      expect(cleanup, {
        'attached': false,
        'scannerMounted': false,
        'mobileScannerMounted': false,
        'platformRunning': false,
        'barcodeListener': false,
        'torchListener': false,
        'zoomListener': false,
        'transientCallbacks': 0,
      });
      expect(trace.callbacks.errors, isEmpty);
      expect(tester.takeException(), isNull);
    });
  }

  for (final boundary in _Boundary.values) {
    testWidgets('batch expired outlines are absent after ${boundary.name}', (tester) async {
      final controller = QRGenScannerController();
      final trace = _Trace('batch expiry after ${boundary.name}');
      retain(tester, controller, trace);
      await mount(tester, controller, trace);
      await detect(tester, 'A');
      final before = trace.record(tester, platform, 'current A before boundary');
      final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;

      if (boundary == _Boundary.stop) {
        final stopped = controller.stop();
        await fixture.settle(tester);
        await stopped;
        await fixture.settle(tester);
      } else if (boundary == _Boundary.inactive) {
        await mount(tester, controller, trace, active: false);
      }
      final acknowledged = trace.record(tester, platform, 'boundary acknowledged');

      // The production duration clock uses Stopwatch. Advancing only the
      // widget fake timer would not prove that a capture really aged out.
      final actualWait = Stopwatch()..start();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 650)));
      actualWait.stop();
      await tester.pump(const Duration(milliseconds: 150));
      await fixture.settle(tester);
      final expired = trace.record(tester, platform, 'after actual 650ms and timer pump');
      trace.snapshots.add(Map<String, Object?>.unmodifiable({
        'phase': 'actual wait measurement',
        'waitMicroseconds': actualWait.elapsedMicroseconds,
      }));

      // Capture recovery before any expected baseline assertion can fail.
      if (boundary == _Boundary.stop) {
        final started = controller.start();
        await fixture.settle(tester);
        await started;
        await fixture.settle(tester);
      } else if (boundary == _Boundary.inactive) {
        await mount(tester, controller, trace);
      }
      await detect(tester, 'B');
      final recovered = trace.record(tester, platform, 'fresh B after recovery');
      await detect(tester, 'A');
      trace.record(tester, platform, 'A observed again with once-per-session duplicate history');

      _expectVisibleCapture(before);
      expect(before['controllerRunning'], isTrue);
      expect(before['platformRunning'], isTrue);
      expect(trace.callbacks.scans.first.single['data'], 'A');
      expect(trace.callbacks.tracks.first.single['data'], 'A');
      expect(actualWait.elapsedMilliseconds, greaterThanOrEqualTo(600));
      expect(identical(initialNative, tester.widget<MobileScanner>(find.byType(MobileScanner)).controller), isTrue);
      expect(acknowledged['controllerIdentity'], before['controllerIdentity']);
      expect(expired['controllerIdentity'], before['controllerIdentity']);
      final shouldRun = boundary == _Boundary.running;
      expect(acknowledged['controllerRunning'], shouldRun);
      expect(acknowledged['platformRunning'], shouldRun);
      expect(expired['controllerRunning'], shouldRun);
      expect(expired['platformRunning'], shouldRun);
      _expectVisibleCapture(recovered);
      expect(recovered['controllerRunning'], isTrue);
      expect(recovered['platformRunning'], isTrue);
      expect(recovered['lastTrackData'], ['B']);
      expect(trace.callbacks.scans.map((codes) => codes.single['data']), ['A', 'B'],
          reason: 'Stopping or temporarily hiding the camera must not re-arm duplicateFilter=-1.');
      if (shouldRun) {
        expect(expired['lastTrackData'], isEmpty, reason: 'The running-camera control must demonstrate actual timer expiry.');
      }
      // onTrack history is retained as evidence. Its stopped-state clearing
      // semantics are separate from this visual lifetime assertion.
      expect(expired['highlightPainterCount'], 0,
          reason: 'An outline older than the tracking timeout must not remain on the stopped or inactive camera.');
      expect(expired['polygons'], isEmpty);
    });
  }
}
