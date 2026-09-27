// Widget tests for QRGenScanner against a fake mobile_scanner platform.
//
// The fake implements the mobile_scanner 7 platform interface (the version
// resolved for development); the pure-Dart tests in the parent folder do not
// depend on Flutter or mobile_scanner.
import 'dart:async';

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
    torchState = startOptions.torchEnabled ? TorchState.on : TorchState.off;
    return MobileScannerViewAttributes(
      cameraDirection: startOptions.cameraDirection,
      currentTorchMode: torchState,
      size: const Size(720, 1280),
    );
  }

  @override
  Future<void> stop() async => stops++;

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
  Future<void> dispose() async {}
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

void main() {
  late FakeScannerPlatform platform;

  setUp(() {
    platform = FakeScannerPlatform();
    MobileScannerPlatform.instance = platform;
  });

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

    // The tracker uses wall-clock time, so let real time pass, then fire the tick timer.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 650)));
    await tester.pump(const Duration(milliseconds: 150));
    await settle(tester);
    expect(tracked.last, isEmpty);

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
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
