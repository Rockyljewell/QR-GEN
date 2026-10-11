// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual installed MobileScannerController; fake platform state is not
// physical camera/LED or native-frame evidence.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

import 'scanner_widget_test.dart' as fixture;

class _SingleCameraNoTorchPlatform extends fixture.FakeScannerPlatform {
  @override
  Future<MobileScannerViewAttributes> start(StartOptions startOptions) async {
    await super.start(startOptions);
    torchState = TorchState.unavailable;
    return MobileScannerViewAttributes(
      cameraDirection: startOptions.cameraDirection,
      currentTorchMode: torchState,
      numberOfCameras: 1,
      size: const Size(720, 1280),
    );
  }
}

class _Trace {
  _Trace(this.name);

  final String name;
  final List<Map<String, Object?>> snapshots = [];
  final List<QRGenError> errors = [];

  void record(WidgetTester tester, fixture.FakeScannerPlatform platform, String phase) {
    final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    snapshots.add({
      'phase': phase,
      'controllerIdentity': identityHashCode(native),
      'controllerRunning': native.value.isRunning,
      'controllerDirection': native.value.cameraDirection.name,
      'controllerTorch': native.value.torchState.name,
      'constructorTorch': native.torchEnabled,
      'platformRunning': platform.running,
      'platformTorch': platform.torchState.name,
      'torchToggles': platform.torchToggles,
      'starts': [
        for (final start in platform.starts)
          {'camera': start.cameraDirection.name, 'torchEnabled': start.torchEnabled},
      ],
      'stops': platform.stops,
      'errors': [for (final error in errors) error.toJson()],
    });
  }
}

QRGenScannerOptions _options(bool torch) => QRGenScannerOptions(
      symbologies: const ['qr'],
      torch: torch,
      beep: false,
      vibrate: false,
    );

Future<void> _command(WidgetTester tester, Future<void> command) async {
  await fixture.settle(tester);
  await command;
  await fixture.settle(tester);
}

void main() {
  late fixture.FakeScannerPlatform platform;

  void usePlatform(fixture.FakeScannerPlatform next) {
    platform = next;
    MobileScannerPlatform.instance = platform;
  }

  Future<void> mount(WidgetTester tester, QRGenScannerController controller, bool torch, _Trace trace) async {
    await tester.pumpWidget(fixture.host(QRGenScanner(
      controller: controller,
      options: _options(torch),
      onError: trace.errors.add,
    )));
    await fixture.settle(tester);
  }

  void retain(WidgetTester tester, QRGenScannerController controller, _Trace trace,
      {List<QRGenErrorCode> expectedErrors = const []}) {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      await fixture.settle(tester);
      final cleanup = {
        'attached': controller.isAttached,
        'platformRunning': platform.running,
        'barcodeListener': platform.barcodes.hasListener,
        'torchListener': platform.torch.hasListener,
        'zoomListener': platform.zoom.hasListener,
      };
      controller.dispose();
      await platform.barcodes.close();
      await platform.torch.close();
      await platform.zoom.close();
      debugPrint('FLUTTER_TORCH_CONTROL ${jsonEncode({
        'name': trace.name,
        'snapshots': trace.snapshots,
        'errors': [for (final error in trace.errors) error.toJson()],
        'cleanup': cleanup,
      })}');
      expect(cleanup, {
        'attached': false,
        'platformRunning': false,
        'barcodeListener': false,
        'torchListener': false,
        'zoomListener': false,
      });
      expect(trace.errors.map((error) => error.code), expectedErrors);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('single-camera unavailable torch switch keeps its no-op error count', (tester) async {
    usePlatform(_SingleCameraNoTorchPlatform());
    final controller = QRGenScannerController();
    final trace = _Trace('single-camera unavailable torch no-op');
    retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.unsupported]);
    await mount(tester, controller, true, trace);
    trace.record(tester, platform, 'initial unsupported');
    final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    expect(initialNative.value.availableCameras, 1);
    expect(initialNative.value.torchState, TorchState.unavailable);
    expect(trace.errors.map((error) => error.code), [QRGenErrorCode.unsupported]);
    final stopsBefore = platform.stops;

    await _command(tester, controller.switchCamera());
    trace.record(tester, platform, 'after no-op switch');
    expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(initialNative));
    expect(platform.starts, hasLength(1));
    expect(platform.stops, stopsBefore);
    expect(platform.torchToggles, 0);
    expect(platform.running, isTrue);
    expect(platform.torchState, TorchState.unavailable);
    expect(trace.errors.map((error) => error.code), [QRGenErrorCode.unsupported],
        reason: 'a plugin no-op must not repeat the initial unsupported request');
  });

  testWidgets('stopped camera switch neither starts nor toggles the camera', (tester) async {
    usePlatform(fixture.FakeScannerPlatform());
    final controller = QRGenScannerController();
    final trace = _Trace('switch after explicit stop');
    retain(tester, controller, trace);
    await mount(tester, controller, false, trace);
    await _command(tester, controller.stop());
    trace.record(tester, platform, 'stopped');
    final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    expect(native.value.isRunning, isFalse);
    expect(platform.running, isFalse);
    final startsBefore = platform.starts.length;
    final stopsBefore = platform.stops;
    final togglesBefore = platform.torchToggles;

    await _command(tester, controller.switchCamera());
    trace.record(tester, platform, 'switch ignored while stopped');
    expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(native));
    expect(native.value.isRunning, isFalse);
    expect(platform.running, isFalse);
    expect(platform.starts, hasLength(startsBefore));
    expect(platform.stops, stopsBefore);
    expect(platform.torchToggles, togglesBefore);
    expect(trace.errors, isEmpty);
  });

  for (final initialTorch in [false, true]) {
    testWidgets('changed torch option ${!initialTorch} survives camera round trip without manual override', (tester) async {
      usePlatform(fixture.FakeScannerPlatform());
      final controller = QRGenScannerController();
      final trace = _Trace('accepted option: constructor=$initialTorch current=${!initialTorch}');
      retain(tester, controller, trace);
      await mount(tester, controller, initialTorch, trace);
      final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
      trace.record(tester, platform, 'initial');

      // No imperative setTorch: the accepted option changes while the same
      // controller retains its original constructor torchEnabled.
      await mount(tester, controller, !initialTorch, trace);
      trace.record(tester, platform, 'accepted torch-only option');
      expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(native));
      expect(native.torchEnabled, initialTorch);
      expect(platform.starts, hasLength(1));
      expect(platform.torchState, initialTorch ? TorchState.off : TorchState.on);

      await _command(tester, controller.switchCamera());
      trace.record(tester, platform, 'front');
      expect(native.value.cameraDirection, CameraFacing.front);
      expect(platform.torchState, initialTorch ? TorchState.off : TorchState.on,
          reason: 'the current accepted option wins over immutable constructor settings');

      await _command(tester, controller.switchCamera());
      trace.record(tester, platform, 'back');
      expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(native));
      expect(platform.starts.map((start) => start.cameraDirection),
          [CameraFacing.back, CameraFacing.front, CameraFacing.back]);
      expect(platform.starts.map((start) => start.torchEnabled),
          [initialTorch, initialTorch, initialTorch]);
      expect(platform.torchState, initialTorch ? TorchState.off : TorchState.on);
      expect(native.value.torchState, initialTorch ? TorchState.off : TorchState.on);
      expect(trace.errors, isEmpty);
    });
  }
}
