// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual mounted QRGenScanner/MobileScanner/controller and highlight painters.
// Camera frames use the existing asynchronous platform broadcast boundary.
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

import 'scanner_widget_test.dart' as fixture;

class _Observation {
  const _Observation({
    required this.native,
    required this.painterCount,
    required this.polygons,
    required this.viewSize,
    required this.starts,
    required this.stops,
    required this.running,
  });

  final MobileScannerController native;
  final int painterCount;
  final List<List<List<double>>> polygons;
  final Size viewSize;
  final int starts;
  final int stops;
  final bool running;
}

class _Trace {
  _Trace(this.name);

  final String name;
  final fixture.CallbackTrace callbacks = fixture.CallbackTrace();
  final List<Map<String, Object?>> snapshots = [];
  final Stopwatch elapsed = Stopwatch()..start();

  _Observation record(WidgetTester tester, fixture.FakeScannerPlatform platform, String phase) {
    final widget = tester.widget<QRGenScanner>(find.byType(QRGenScanner));
    final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    final view = tester.getSize(find.byType(QRGenScanner));
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
    snapshots.add(Map<String, Object?>.unmodifiable({
      'phase': phase,
      'elapsedMicroseconds': elapsed.elapsedMicroseconds,
      'showHighlights': widget.showHighlights,
      'highlightPainterCount': painters.length,
      'polygons': polygons,
      'viewSize': [view.width, view.height],
      'controllerIdentity': identityHashCode(native),
      'controllerRunning': native.value.isRunning,
      'controllerDirection': native.value.cameraDirection.name,
      'platformRunning': platform.running,
      'starts': [
        for (final start in platform.starts)
          {
            'camera': start.cameraDirection.name,
            'torchEnabled': start.torchEnabled,
            'detectionSpeed': start.detectionSpeed.name,
            'formats': start.formats.map((format) => format.name).toList(growable: false),
          },
      ],
      'stops': platform.stops,
      'scanReports': callbacks.scans.length,
      'trackReports': callbacks.tracks.length,
      'latestTrackData': callbacks.tracks.isEmpty
          ? const <Object?>[]
          : callbacks.tracks.last.map((code) => code['data']).toList(growable: false),
    }));
    return _Observation(
      native: native,
      painterCount: painters.length,
      polygons: polygons,
      viewSize: view,
      starts: platform.starts.length,
      stops: platform.stops,
      running: platform.running,
    );
  }
}

void _expectVisibleA(_Observation observation) {
  expect(observation.painterCount, 1, reason: 'The current-source A capture must first produce a real highlight painter');
  expect(observation.polygons, hasLength(1));
  final polygon = observation.polygons.single;
  expect(polygon, hasLength(4));
  for (final point in polygon) {
    expect(point, hasLength(2));
    expect(point.every((coordinate) => coordinate.isFinite), isTrue);
    expect(point[0], inInclusiveRange(0.0, observation.viewSize.width));
    expect(point[1], inInclusiveRange(0.0, observation.viewSize.height));
  }
  expect(polygon.map((point) => point[0]).toSet().length, greaterThan(1));
  expect(polygon.map((point) => point[1]).toSet().length, greaterThan(1));
}

void _expectSameSource(_Observation before, _Observation after) {
  expect(identical(before.native, after.native), isTrue, reason: 'Visibility must be tested on the same installed controller');
  expect(after.starts, 1);
  expect(after.stops, 0);
  expect(after.running, isTrue);
  expect(after.native.value.isRunning, isTrue);
}

void main() {
  late fixture.FakeScannerPlatform platform;

  setUp(() {
    platform = fixture.FakeScannerPlatform();
    MobileScannerPlatform.instance = platform;
  });

  setUpAll(() {
    debugPrint('FLUTTER_HIGHLIGHT_VISIBILITY_RUNTIME Dart ${Platform.version}');
  });

  Future<void> mount(
    WidgetTester tester,
    QRGenScannerController controller,
    _Trace trace, {
    required bool highlights,
    String? cosmeticLabel,
  }) async {
    await tester.pumpWidget(fixture.host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(
        symbologies: ['qr'],
        mode: QRGenScanMode.batch,
        duplicateFilter: -1,
        beep: false,
        vibrate: false,
      ),
      showHighlights: highlights,
      showToast: false,
      onScan: trace.callbacks.scanned,
      onTrack: trace.callbacks.tracked,
      onError: trace.callbacks.failed,
      child: cosmeticLabel == null ? null : Semantics(label: cosmeticLabel, child: const SizedBox.shrink()),
    )));
    await fixture.settle(tester);
  }

  Future<void> detect(WidgetTester tester, String payload) async {
    platform.barcodes.add(fixture.capture(payload));
    await fixture.settle(tester);
  }

  void retain(WidgetTester tester, QRGenScannerController controller, _Trace trace) {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      await fixture.settle(tester);
      final cleanup = {
        'attached': controller.isAttached,
        'scannerWidgetMounted': find.byType(QRGenScanner).evaluate().isNotEmpty,
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
      debugPrint('FLUTTER_HIGHLIGHT_VISIBILITY_PROBE ${jsonEncode({
        'name': trace.name,
        'snapshots': trace.snapshots,
        'events': trace.callbacks.events,
        'scanSnapshots': trace.callbacks.scans,
        'trackSnapshots': trace.callbacks.tracks,
        'errors': trace.callbacks.errors,
        'cleanup': cleanup,
        'timerCheck': 'flutter_test automatic post-test pending-timer invariant',
        'scope': 'Actual mounted widget/controller/painter; camera-platform broadcast only, no phone or native-frame claim.',
      })}');
      expect(cleanup, {
        'attached': false,
        'scannerWidgetMounted': false,
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

  testWidgets('batch highlights hide after the visibility option is disabled', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('hide active batch outlines');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: true);
    await detect(tester, 'A');
    final before = trace.record(tester, platform, 'visible A');
    await mount(tester, controller, trace, highlights: false);
    final hidden = trace.record(tester, platform, 'committed false before another capture');
    await detect(tester, 'B');
    final afterB = trace.record(tester, platform, 'different current-source B while hidden');

    _expectVisibleA(before);
    _expectSameSource(before, hidden);
    _expectSameSource(before, afterB);
    expect(trace.callbacks.scans.map((codes) => codes.single['data']), ['A', 'B']);
    expect(trace.callbacks.tracks.last.map((code) => code['data']), contains('B'));
    expect(hidden.painterCount, 0, reason: 'Committed showHighlights=false must hide the retained outline immediately');
    expect(hidden.polygons, isEmpty);
    expect(afterB.painterCount, 0, reason: 'New reports must not restore a disabled highlight');
    expect(afterB.polygons, isEmpty);
  });

  testWidgets('hidden expired batch outlines do not return when highlights are re-enabled', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('hide then actual expiry then re-enable without a frame');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: true);
    await detect(tester, 'A');
    final before = trace.record(tester, platform, 'visible A');
    await mount(tester, controller, trace, highlights: false);
    final hidden = trace.record(tester, platform, 'committed false');
    // The production tracker ages with Stopwatch, not the widget fake clock.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 650)));
    await tester.pump(const Duration(milliseconds: 150));
    await fixture.settle(tester);
    final expired = trace.record(tester, platform, 'actual expiry and empty onTrack while hidden');
    await mount(tester, controller, trace, highlights: true);
    final reEnabled = trace.record(tester, platform, 're-enabled after expiry without a new capture');

    // Capture every stage before any visibility oracle can fail on the baseline.
    _expectVisibleA(before);
    _expectSameSource(before, hidden);
    _expectSameSource(before, expired);
    _expectSameSource(before, reEnabled);
    expect(trace.callbacks.scans.single.single['data'], 'A');
    expect(trace.callbacks.tracks.first.single['data'], 'A');
    expect(trace.callbacks.tracks.last, isEmpty, reason: 'The actual batch timer must first report track expiry');
    expect(hidden.painterCount, 0, reason: 'Disabled outlines must disappear before expiry');
    expect(expired.painterCount, 0, reason: 'Expired observations must have no hidden retained outline');
    expect(reEnabled.painterCount, 0, reason: 'Re-enabling must not resurrect a known-expired outline');
    expect(reEnabled.polygons, isEmpty);
  });

  testWidgets('initially disabled highlights still report scans and tracks', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('false at initial mount');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: false);
    await detect(tester, 'A');
    final result = trace.record(tester, platform, 'A with highlights disabled from mount');

    expect(result.starts, 1);
    expect(result.stops, 0);
    expect(result.running, isTrue);
    expect(result.painterCount, 0);
    expect(result.polygons, isEmpty);
    expect(trace.callbacks.scans.single.single['data'], 'A');
    expect(trace.callbacks.tracks.single.single['data'], 'A');
  });

  testWidgets('disabling highlights before the first detection keeps them absent', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('hide before first detection');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: true);
    final before = trace.record(tester, platform, 'enabled with no detections');
    await mount(tester, controller, trace, highlights: false);
    trace.record(tester, platform, 'disabled with no detections');
    await detect(tester, 'A');
    final result = trace.record(tester, platform, 'first A after disabling');

    _expectSameSource(before, result);
    expect(before.painterCount, 0);
    expect(result.painterCount, 0);
    expect(result.polygons, isEmpty);
    expect(trace.callbacks.scans.single.single['data'], 'A');
    expect(trace.callbacks.tracks.single.single['data'], 'A');
  });

  testWidgets('enabled highlights survive a cosmetic rebuild on the same controller', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('enabled cosmetic rebuild');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: true);
    await detect(tester, 'A');
    final before = trace.record(tester, platform, 'visible A');
    await mount(tester, controller, trace, highlights: true, cosmeticLabel: 'cosmetic accessibility label');
    final after = trace.record(tester, platform, 'cosmetic child changed');

    _expectVisibleA(before);
    _expectSameSource(before, after);
    expect(after.painterCount, 1);
    expect(jsonEncode(after.polygons), jsonEncode(before.polygons));
    expect(trace.callbacks.scans.single.single['data'], 'A');
    expect(trace.callbacks.tracks.single.single['data'], 'A');
  });

  testWidgets('re-enabled highlights show a fresh current-source detection', (tester) async {
    final controller = QRGenScannerController();
    final trace = _Trace('enable then fresh current-source B');
    retain(tester, controller, trace);
    await mount(tester, controller, trace, highlights: false);
    await detect(tester, 'A');
    final disabled = trace.record(tester, platform, 'A tracked while initially hidden');
    await mount(tester, controller, trace, highlights: true);
    trace.record(tester, platform, 're-enabled before any fresh capture');
    // Restoring a still-live A cache at this intermediate stage is unspecified.
    await detect(tester, 'B');
    final fresh = trace.record(tester, platform, 'fresh current-source B after enabling');

    _expectSameSource(disabled, fresh);
    expect(disabled.painterCount, 0);
    expect(fresh.painterCount, 1);
    expect(fresh.polygons, isNotEmpty);
    expect(trace.callbacks.scans.map((codes) => codes.single['data']), ['A', 'B']);
    expect(trace.callbacks.tracks.last.map((code) => code['data']), contains('B'));
  });
}
