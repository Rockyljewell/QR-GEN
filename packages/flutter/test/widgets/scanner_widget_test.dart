// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Widget tests for QRGenScanner against a fake mobile_scanner platform.
//
// The fake implements the mobile_scanner 7 platform interface (the version
// resolved for development); the pure-Dart tests in the parent folder do not
// depend on Flutter or mobile_scanner.
import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

class FakeScannerPlatform extends MobileScannerPlatform {
  final StreamController<BarcodeCapture?> barcodes = StreamController<BarcodeCapture?>.broadcast();
  final StreamController<TorchState> torch = StreamController<TorchState>.broadcast();
  final StreamController<double> zoom = StreamController<double>.broadcast();
  final List<StartOptions> starts = [];
  int stops = 0;
  int torchToggles = 0;
  bool running = false;
  TorchState torchState = TorchState.off;
  MobileScannerException? startError;

  @override
  Stream<BarcodeCapture?> get barcodesStream => barcodes.stream;

  @override
  Stream<TorchState> get torchStateStream => torch.stream;

  @override
  Stream<double> get zoomScaleStateStream => zoom.stream;

  @override
  Widget buildCameraView() => const SizedBox.expand();

  @override
  Future<MobileScannerViewAttributes> start(StartOptions startOptions) async {
    final error = startError;
    if (error != null) throw error;
    starts.add(startOptions);
    running = true;
    torchState = startOptions.torchEnabled ? TorchState.on : TorchState.off;
    return MobileScannerViewAttributes(
      cameraDirection: startOptions.cameraDirection,
      currentTorchMode: torchState,
      size: const Size(720, 1280),
    );
  }

  @override
  Future<void> stop() async {
    stops++;
    running = false;
  }

  @override
  Future<void> pause() async {}

  @override
  Future<void> toggleTorch() async {
    torchToggles++;
    torchState = torchState == TorchState.on ? TorchState.off : TorchState.on;
    torch.add(torchState);
  }

  @override
  Future<void> updateScanWindow(Rect? window) async {}

  @override
  Future<void> resetZoomScale() async {}

  @override
  Future<void> setZoomScale(double zoomScale) async {}

  @override
  Future<void> dispose() async => running = false;
}

BarcodeCapture capture(String value, {BarcodeFormat format = BarcodeFormat.qrCode}) => BarcodeCapture(
      size: const Size(720, 1280),
      barcodes: [
        Barcode(
          rawValue: value,
          format: format,
          size: const Size(200, 200),
          corners: const [Offset(260, 540), Offset(460, 540), Offset(460, 740), Offset(260, 740)],
        ),
      ],
    );

Widget host(Widget child) => MaterialApp(home: Scaffold(body: SizedBox(width: 390, height: 844, child: child)));

/// Lets queued async camera work and microtasks run.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Immutable callback snapshots and their delivery order for CI evidence.
class CallbackTrace {
  final List<String> events = [];
  final List<List<Map<String, Object?>>> scans = [];
  final List<List<Map<String, Object?>>> tracks = [];
  final List<Map<String, Object?>> errors = [];

  void scanned(List<QRGenBarcode> codes) {
    scans.add(List.unmodifiable(codes.map((code) => Map<String, Object?>.unmodifiable(code.toJson()))));
    events.add('scan:${codes.map((code) => code.data).join(',')}');
  }

  void tracked(List<QRGenTrackedBarcode> codes) {
    tracks.add(List.unmodifiable(codes.map((code) => Map<String, Object?>.unmodifiable(code.toJson()))));
    events.add('track:${codes.map((code) => code.data).join(',')}');
  }

  void failed(QRGenError error) {
    errors.add({'code': error.code.name, 'message': error.message});
    events.add('error:${error.code.name}');
  }
}

void main() {
  late FakeScannerPlatform platform;

  setUp(() {
    platform = FakeScannerPlatform();
    MobileScannerPlatform.instance = platform;
  });

  setUpAll(() {
    debugPrint('FLUTTER_CALLBACK_PROBE_RUNTIME Dart ${Platform.version}');
  });

  // Every new ownership probe removes the actual widget, including on a failed
  // assertion. Disposing the public controller alone is not widget disposal.
  void retainCallbackEvidence(WidgetTester tester, QRGenScannerController controller, CallbackTrace trace, String name) {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      await settle(tester);
      final attached = controller.isAttached;
      final running = platform.running;
      final barcodeListener = platform.barcodes.hasListener;
      controller.dispose();
      await platform.barcodes.close();
      await platform.torch.close();
      await platform.zoom.close();
      debugPrint('FLUTTER_CALLBACK_PROBE ${jsonEncode({
        'name': name,
        'events': trace.events,
        'scanSnapshots': trace.scans,
        'trackSnapshots': trace.tracks,
        'errors': trace.errors,
        'cleanup': {'attached': attached, 'fakeCameraRunning': running, 'barcodeListener': barcodeListener},
      })}');
      expect(attached, isFalse);
      expect(running, isFalse);
      expect(barcodeListener, isFalse);
      expect(trace.errors, isEmpty);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('starts the camera with the mapped formats and reports scans', (tester) async {
    final scans = <List<QRGenBarcode>>[];
    var ready = 0;
    await tester.pumpWidget(
      host(
        QRGenScanner(
          options: const QRGenScannerOptions(symbologies: ['qr', 'ean-13', 'maxicode']),
          onScan: scans.add,
          onReady: () => ready++,
        ),
      ),
    );
    await settle(tester);

    expect(platform.starts, hasLength(1));
    expect(platform.starts.single.formats.map((f) => f.name), ['qrCode', 'ean13']);
    expect(platform.starts.single.detectionSpeed, DetectionSpeed.normal);
    expect(ready, 1);

    platform.barcodes.add(capture('https://example.com'));
    await settle(tester);

    expect(scans, hasLength(1));
    final b = scans.single.single;
    expect(b.symbology, QRGenSymbology.qr);
    expect(b.data, 'https://example.com');
    expect(b.frameSize, const QRGenSize(720, 1280));
    expect(b.location.topLeft, const QRGenPoint(260, 540));
    expect(find.textContaining('QR Code'), findsOneWidget);

    // Duplicate inside the 1000 ms window.
    platform.barcodes.add(capture('https://example.com'));
    await settle(tester);
    expect(scans, hasLength(1));

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  testWidgets('single mode stops the camera and the controller restarts it', (tester) async {
    final scans = <QRGenBarcode>[];
    final controller = QRGenScannerController();
    await tester.pumpWidget(
      host(
        QRGenScanner(
          controller: controller,
          options: const QRGenScannerOptions(mode: QRGenScanMode.single, duplicateFilter: 0),
          onScan: scans.addAll,
        ),
      ),
    );
    await settle(tester);
    expect(platform.starts, hasLength(1));

    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(scans.map((b) => b.data), ['A']);
    expect(platform.stops, greaterThanOrEqualTo(1));

    platform.barcodes.add(capture('B'));
    await settle(tester);
    expect(scans.map((b) => b.data), ['A'], reason: 'ignored after the single scan');

    unawaited(controller.start());
    await settle(tester);
    expect(platform.starts, hasLength(2));
    platform.barcodes.add(capture('B'));
    await settle(tester);
    expect(scans.map((b) => b.data), ['A', 'B']);

    controller.dispose();
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  testWidgets('batch mode reports tracked codes and drops them after 500 ms', (tester) async {
    final tracked = <List<QRGenTrackedBarcode>>[];
    await tester.pumpWidget(
      host(
        QRGenScanner(
          options: const QRGenScannerOptions(mode: QRGenScanMode.batch),
          onTrack: tracked.add,
        ),
      ),
    );
    await settle(tester);
    expect(platform.starts.single.detectionSpeed, DetectionSpeed.unrestricted);

    platform.barcodes.add(capture('X'));
    await settle(tester);
    expect(tracked.last.single.id, qrgenTrackingId('qr', 'X'));

    // Let actual elapsed time pass, then fire the tracker tick timer.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 650)));
    await tester.pump(const Duration(milliseconds: 150));
    await settle(tester);
    expect(tracked.last, isEmpty);

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  for (final action in ['start', 'resume', 'reset']) {
    testWidgets('single onScan $action owns the next scan', (tester) async {
      final scans = <String>[];
      final controller = QRGenScannerController();
      await tester.pumpWidget(host(QRGenScanner(
        controller: controller,
        options: const QRGenScannerOptions(mode: QRGenScanMode.single, duplicateFilter: 0, beep: false, vibrate: false),
        onScan: (codes) {
          scans.addAll(codes.map((b) => b.data));
          unawaited(switch (action) {
            'start' => controller.start(),
            'resume' => controller.resume(),
            _ => controller.reset(),
          });
        },
      )));
      await settle(tester);
      platform.barcodes.add(capture('A'));
      await settle(tester);
      expect(platform.running, isTrue, reason: 'the callback requested the next scan');
      platform.barcodes.add(capture('B'));
      await settle(tester);
      expect(scans, ['A', 'B']);
      controller.dispose();
      await tester.pumpWidget(const SizedBox());
      await settle(tester);
      expect(platform.running, isFalse);
    });
  }

  for (final action in ['start', 'resume', 'reset']) {
    testWidgets('single callback $action preserves its duplicate policy', (tester) async {
      final scans = <String>[];
      final controller = QRGenScannerController();
      await tester.pumpWidget(host(QRGenScanner(
        controller: controller,
        options: const QRGenScannerOptions(mode: QRGenScanMode.single, duplicateFilter: -1, beep: false, vibrate: false),
        onScan: (codes) {
          scans.addAll(codes.map((b) => b.data));
          unawaited(switch (action) {
            'start' => controller.start(),
            'resume' => controller.resume(),
            _ => controller.reset(),
          });
        },
      )));
      await settle(tester);
      platform.barcodes.add(capture('A'));
      await settle(tester);
      platform.barcodes.add(capture('A'));
      await settle(tester);
      platform.barcodes.add(capture('B'));
      await settle(tester);
      expect(scans, action == 'reset' ? ['A', 'A', 'B'] : ['A', 'B']);
      expect(platform.running, isTrue);
      controller.dispose();
      await tester.pumpWidget(const SizedBox());
      await settle(tester);
      expect(platform.running, isFalse);
    });
  }

  testWidgets('single callback mode change retains the newer continuous session', (tester) async {
    final scans = <String>[];
    var mode = QRGenScanMode.single;
    await tester.pumpWidget(host(StatefulBuilder(builder: (context, update) => QRGenScanner(
      options: QRGenScannerOptions(mode: mode, duplicateFilter: 0, beep: false, vibrate: false),
      onScan: (codes) {
        scans.addAll(codes.map((b) => b.data));
        update(() => mode = QRGenScanMode.continuous);
      },
    ))));
    await settle(tester);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(platform.running, isTrue);
    platform.barcodes.add(capture('B'));
    await settle(tester);
    expect(scans, ['A', 'B']);
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
    expect(platform.running, isFalse);
  });

  testWidgets('single callback unmount discards queued restarts', (tester) async {
    final scans = <String>[];
    final controller = QRGenScannerController();
    var visible = true;
    await tester.pumpWidget(host(StatefulBuilder(builder: (context, update) => visible ? QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.single, duplicateFilter: 0, beep: false, vibrate: false),
      onScan: (codes) {
        scans.addAll(codes.map((b) => b.data));
        unawaited(controller.start());
        update(() => visible = false);
      },
    ) : const SizedBox())));
    await settle(tester);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(controller.isAttached, isFalse);
    expect(platform.running, isFalse);
    platform.barcodes.add(capture('B'));
    await settle(tester);
    expect(scans, ['A']);
    expect(tester.takeException(), isNull);
    controller.dispose();
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  // The broadcast fake is intentionally asynchronous. These tests never
  // recursively call StreamController.add on a synchronous stream. A direct
  // nested call uses the public onDetect from the mounted MobileScanner widget;
  // it proves Dart callback ownership, not native camera event scheduling.
  testWidgets('batch onScan synchronous reset cancels the saved old track result', (tester) async {
    const name = 'reset inside onScan';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    var resetOnce = true;
    await tester.pumpWidget(host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        if (resetOnce) {
          resetOnce = false;
          trace.events.add('reset');
          unawaited(controller.reset());
        }
      },
      onTrack: trace.tracked,
    )));
    await settle(tester);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'reset'], reason: 'reset already cleared A before onScan returned');
    expect(trace.tracks, isEmpty);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'reset', 'scan:A', 'track:A']);
    expect(trace.tracks.single.single['count'], 1, reason: 'reset also clears duplicate and tracking history');
  });

  testWidgets('batch direct mounted detect supersedes the earlier saved track result', (tester) async {
    const name = 'direct mounted nested B';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    late void Function(BarcodeCapture) detect;
    var nestOnce = true;
    await tester.pumpWidget(host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        if (nestOnce) {
          nestOnce = false;
          trace.events.add('direct:B');
          detect(capture('B'));
        }
      },
      onTrack: trace.tracked,
    )));
    await settle(tester);
    detect = tester.widget<MobileScanner>(find.byType(MobileScanner)).onDetect!;
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'direct:B', 'scan:B', 'track:A,B']);
    expect(trace.tracks.single.map((code) => code['data']), ['A', 'B']);
    expect(trace.tracks.single.map((code) => code['count']), [1, 1]);
  });

  testWidgets('batch reset and direct mounted B retain only the new result', (tester) async {
    const name = 'reset plus direct mounted nested B';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    late void Function(BarcodeCapture) detect;
    var nestOnce = true;
    await tester.pumpWidget(host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        if (nestOnce) {
          nestOnce = false;
          trace.events.add('reset');
          unawaited(controller.reset());
          trace.events.add('direct:B');
          detect(capture('B'));
        }
      },
      onTrack: trace.tracked,
    )));
    await settle(tester);
    detect = tester.widget<MobileScanner>(find.byType(MobileScanner)).onDetect!;
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'reset', 'direct:B', 'scan:B', 'track:B']);
    expect(trace.tracks.single.single['count'], 1);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events.skip(5), ['scan:A', 'track:B,A']);
    expect(trace.tracks.last.map((code) => code['count']), [1, 1]);
  });

  testWidgets('batch asynchronous broadcast next frame preserves both ordered results', (tester) async {
    const name = 'ordinary asynchronous next frame';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    var nextOnce = true;
    await tester.pumpWidget(host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        if (nextOnce) {
          nextOnce = false;
          trace.events.add('schedule:B');
          platform.barcodes.add(capture('B'));
        }
      },
      onTrack: trace.tracked,
    )));
    await settle(tester);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'schedule:B', 'track:A', 'scan:B', 'track:A,B']);
    expect(trace.tracks.first.single['count'], 1);
    expect(trace.tracks.last.map((code) => code['count']), [1, 1]);
  });

  for (final action in ['unchanged', 'start', 'resume']) {
    testWidgets('batch callback $action preserves the still-current track notification', (tester) async {
      final controller = QRGenScannerController();
      final trace = CallbackTrace();
      retainCallbackEvidence(tester, controller, trace, 'no-op $action');
      await tester.pumpWidget(host(QRGenScanner(
        controller: controller,
        options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
        showToast: false,
        showHighlights: false,
        onError: trace.failed,
        onScan: (codes) {
          trace.scanned(codes);
          if (action == 'start') unawaited(controller.start());
          if (action == 'resume') unawaited(controller.resume());
        },
        onTrack: trace.tracked,
      )));
      await settle(tester);
      platform.barcodes.add(capture('A'));
      await settle(tester);
      expect(trace.events, ['scan:A', 'track:A']);
      platform.barcodes.add(capture('A'));
      await settle(tester);
      expect(trace.events, ['scan:A', 'track:A', 'track:A']);
      expect(trace.tracks.last.single['count'], 2);
      expect(platform.running, isTrue);
    });
  }

  testWidgets('batch cosmetic rebuild request does not synchronously replace the current result', (tester) async {
    const name = 'scheduled cosmetic rebuild';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    var accent = const Color(0xFF2EC1CE);
    await tester.pumpWidget(host(StatefulBuilder(builder: (context, update) => QRGenScanner(
      controller: controller,
      accentColor: accent,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        trace.events.add('schedule:cosmetic');
        update(() => accent = const Color(0xFFABCDEF));
      },
      onTrack: trace.tracked,
    ))));
    await settle(tester);
    final nativeController = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller;
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'schedule:cosmetic', 'track:A']);
    expect(identical(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, nativeController), isTrue);
    expect(platform.starts, hasLength(1));
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.tracks.last.single['count'], 2);
    expect(trace.scans, hasLength(1));
  });

  testWidgets('batch scheduled mode change permits the current result before the real rebuild', (tester) async {
    const name = 'scheduled mode change';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    var mode = QRGenScanMode.batch;
    await tester.pumpWidget(host(StatefulBuilder(builder: (context, update) => QRGenScanner(
      controller: controller,
      options: QRGenScannerOptions(mode: mode, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        if (mode == QRGenScanMode.batch) {
          trace.events.add('schedule:continuous');
          update(() => mode = QRGenScanMode.continuous);
        }
      },
      onTrack: trace.tracked,
    ))));
    await settle(tester);
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'schedule:continuous', 'track:A']);
    platform.barcodes.add(capture('B'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'schedule:continuous', 'track:A', 'scan:B']);
    expect(trace.tracks, hasLength(1));
  });

  testWidgets('batch direct no-change blank preserves the pending nonempty result', (tester) async {
    const name = 'nested no-change blank';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    late void Function(BarcodeCapture) detect;
    await tester.pumpWidget(host(QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        trace.events.add('direct:blank');
        detect(BarcodeCapture(size: const Size(720, 1280), barcodes: const <Barcode>[]));
      },
      onTrack: trace.tracked,
    )));
    await settle(tester);
    detect = tester.widget<MobileScanner>(find.byType(MobileScanner)).onDetect!;
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'direct:blank', 'track:A']);
    expect(trace.tracks.single.single['count'], 1);
  });

  testWidgets('batch requested removal waits for rebuild and saved detect is ignored after real disposal', (tester) async {
    const name = 'requested then committed widget removal';
    final controller = QRGenScannerController();
    final trace = CallbackTrace();
    retainCallbackEvidence(tester, controller, trace, name);
    var visible = true;
    var attachedDuringCallback = false;
    await tester.pumpWidget(host(StatefulBuilder(builder: (context, update) => visible ? QRGenScanner(
      controller: controller,
      options: const QRGenScannerOptions(mode: QRGenScanMode.batch, duplicateFilter: -1, beep: false, vibrate: false),
      showToast: false,
      showHighlights: false,
      onError: trace.failed,
      onScan: (codes) {
        trace.scanned(codes);
        trace.events.add('schedule:remove');
        update(() => visible = false);
        attachedDuringCallback = controller.isAttached;
      },
      onTrack: trace.tracked,
    ) : const SizedBox())));
    await settle(tester);
    final savedDetect = tester.widget<MobileScanner>(find.byType(MobileScanner)).onDetect!;
    platform.barcodes.add(capture('A'));
    await settle(tester);
    expect(attachedDuringCallback, isTrue, reason: 'setState requests a later rebuild; it does not dispose synchronously');
    expect(trace.events, ['scan:A', 'schedule:remove', 'track:A']);
    expect(controller.isAttached, isFalse);
    expect(find.byType(MobileScanner), findsNothing);
    expect(platform.running, isFalse);
    savedDetect(capture('B'));
    platform.barcodes.add(capture('C'));
    await settle(tester);
    expect(trace.events, ['scan:A', 'schedule:remove', 'track:A']);
    expect(trace.errors, isEmpty);
  });

  testWidgets('isActive false stops the camera, true starts it again', (tester) async {
    await tester.pumpWidget(host(const QRGenScanner()));
    await settle(tester);
    expect(platform.starts, hasLength(1));

    await tester.pumpWidget(host(const QRGenScanner(isActive: false)));
    await settle(tester);
    expect(platform.stops, 1);

    await tester.pumpWidget(host(const QRGenScanner()));
    await settle(tester);
    expect(platform.starts, hasLength(2));

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  testWidgets('torch option toggles the torch', (tester) async {
    await tester.pumpWidget(host(const QRGenScanner()));
    await settle(tester);
    expect(platform.torchToggles, 0);

    await tester.pumpWidget(host(const QRGenScanner(options: QRGenScannerOptions(torch: true))));
    await settle(tester);
    expect(platform.torchToggles, 1);

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });

  testWidgets('reports unsupported symbology sets without starting', (tester) async {
    final errors = <QRGenError>[];
    await tester.pumpWidget(
      host(QRGenScanner(options: const QRGenScannerOptions(symbologies: ['maxicode', 'telepen']), onError: errors.add)),
    );
    await settle(tester);
    expect(platform.starts, isEmpty);
    expect(errors.single.code, QRGenErrorCode.unsupported);
    expect(find.textContaining('maxicode'), findsOneWidget);
  });

  testWidgets('maps permission errors', (tester) async {
    platform.startError = const MobileScannerException(errorCode: MobileScannerErrorCode.permissionDenied);
    final errors = <QRGenError>[];
    await tester.pumpWidget(host(QRGenScanner(onError: errors.add)));
    await settle(tester);
    expect(errors.map((e) => e.code), contains(QRGenErrorCode.cameraPermissionDenied));
  });

  testWidgets('overlay paints the viewfinder, highlights and toast', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 390,
          height: 844,
          child: QRGenScannerOverlay(
            viewfinder: QRGenViewfinder.frame,
            viewfinderRect: const Rect.fromLTWH(60, 280, 270, 270),
            highlights: const [
              [Offset(100, 300), Offset(200, 300), Offset(200, 400), Offset(100, 400)],
            ],
            toast: const QRGenToastData(1, 'QR Code · hello'),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.byType(CustomPaint), findsWidgets);
    expect(find.text('QR Code · hello'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
  });
}
