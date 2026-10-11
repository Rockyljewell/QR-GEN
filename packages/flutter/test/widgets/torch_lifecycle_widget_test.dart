// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Public QRGen widget/controller tests against the installed mobile_scanner
// controller and the existing fake platform. No physical camera/torch claim.
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

import 'scanner_widget_test.dart' as fixture;

enum _Boundary { camera, formats, detectionSpeed }

QRGenScannerOptions _options(bool torch, [_Boundary? boundary]) => QRGenScannerOptions(
      symbologies: boundary == _Boundary.formats ? const ['ean13'] : const ['qr'],
      camera: boundary == _Boundary.camera ? QRGenCameraFacing.front : QRGenCameraFacing.back,
      mode: boundary == _Boundary.detectionSpeed ? QRGenScanMode.batch : QRGenScanMode.continuous,
      torch: torch,
      beep: false,
      vibrate: false,
    );

/// Settles public queued work before observing the installed controller.
Future<void> _command(WidgetTester tester, Future<void> command) async {
  await fixture.settle(tester);
  await command;
  await fixture.settle(tester);
}

class _TorchTrace {
  _TorchTrace(this.name);
  final String name;
  final List<String> events = [];
  final List<Map<String, Object?>> snapshots = [];
  final List<Map<String, Object?>> errors = [];

  void record(WidgetTester tester, fixture.FakeScannerPlatform platform, String phase) {
    final native = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!;
    events.add(phase);
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
          {
            'camera': start.cameraDirection.name,
            'torchEnabled': start.torchEnabled,
            'detectionSpeed': start.detectionSpeed.name,
            'formats': start.formats.map((format) => format.name).toList(),
          },
      ],
      'stops': platform.stops,
    });
  }
}

void main() {
  late fixture.FakeScannerPlatform platform;

  setUp(() {
    platform = fixture.FakeScannerPlatform();
    MobileScannerPlatform.instance = platform;
  });

  setUpAll(() {
    debugPrint('FLUTTER_TORCH_PROBE_RUNTIME Dart ${Platform.version}');
  });

  Future<void> mount(
    WidgetTester tester,
    QRGenScannerController controller,
    QRGenScannerOptions options,
    _TorchTrace trace,
  ) async {
    await tester.pumpWidget(fixture.host(QRGenScanner(
      controller: controller,
      options: options,
      onReady: () => trace.events.add('ready'),
      onError: (error) => trace.errors.add(error.toJson()),
    )));
    await fixture.settle(tester);
  }

  void retain(WidgetTester tester, QRGenScannerController controller, _TorchTrace trace) {
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
      debugPrint('FLUTTER_TORCH_PROBE ${jsonEncode({
        'name': trace.name,
        'events': trace.events,
        'snapshots': trace.snapshots,
        'errors': trace.errors,
        'cleanup': cleanup,
      })}');
      expect(cleanup, {'attached': false, 'platformRunning': false, 'barcodeListener': false, 'torchListener': false, 'zoomListener': false});
      expect(trace.errors, isEmpty);
      expect(tester.takeException(), isNull);
    });
  }

  for (final oldTorch in [false, true]) {
    testWidgets('manual torch ${!oldTorch} survives imperative camera round trip', (tester) async {
      final controller = QRGenScannerController();
      final trace = _TorchTrace('imperative switch: initial=$oldTorch override=${!oldTorch}');
      retain(tester, controller, trace);
      await mount(tester, controller, _options(oldTorch), trace);
      trace.record(tester, platform, 'initial');
      final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller;

      await _command(tester, controller.setTorch(!oldTorch));
      trace.record(tester, platform, 'manual override');
      expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on);
      await _command(tester, controller.switchCamera());
      trace.record(tester, platform, 'front');
      await _command(tester, controller.switchCamera());
      trace.record(tester, platform, 'back again');

      expect(platform.starts.map((start) => start.cameraDirection), [CameraFacing.back, CameraFacing.front, CameraFacing.back]);
      expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(initialNative));
      // The final back camera is the same torch-capable fake camera as initially;
      // this makes no assumption about a physical front-camera torch.
      expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on,
          reason: 'setTorch override lasts until options.torch changes');
    });

    for (final boundary in _Boundary.values) {
      testWidgets('${boundary.name} replacement accepts changed torch option $oldTorch to ${!oldTorch}', (tester) async {
        final controller = QRGenScannerController();
        final trace = _TorchTrace('combined ${boundary.name}: old=$oldTorch next=${!oldTorch}');
        retain(tester, controller, trace);
        await mount(tester, controller, _options(oldTorch), trace);
        trace.record(tester, platform, 'initial');
        final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller;

        // Both setters change the actual fake torch. The final override equals
        // the old option, then a committed new option must replace that override.
        await _command(tester, controller.setTorch(!oldTorch));
        trace.record(tester, platform, 'manual away');
        expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on);
        await _command(tester, controller.setTorch(oldTorch));
        trace.record(tester, platform, 'manual back');
        expect(platform.torchState, oldTorch ? TorchState.on : TorchState.off);
        expect(platform.torchToggles, 2);

        await mount(tester, controller, _options(!oldTorch, boundary), trace);
        trace.record(tester, platform, 'replacement');
        expect(platform.starts, hasLength(2));
        expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, isNot(same(initialNative)));
        expect(platform.starts.last.torchEnabled, !oldTorch,
            reason: 'changing options.torch ends the manual override even when replacing the source');
        expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on);
      });

      testWidgets('${boundary.name} replacement preserves manual override with unchanged torch option $oldTorch', (tester) async {
        final controller = QRGenScannerController();
        final trace = _TorchTrace('source-only ${boundary.name}: option=$oldTorch override=${!oldTorch}');
        retain(tester, controller, trace);
        await mount(tester, controller, _options(oldTorch), trace);
        trace.record(tester, platform, 'initial');
        final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller;
        await _command(tester, controller.setTorch(!oldTorch));
        trace.record(tester, platform, 'manual override');
        await mount(tester, controller, _options(oldTorch, boundary), trace);
        trace.record(tester, platform, 'replacement');

        expect(platform.starts, hasLength(2));
        expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, isNot(same(initialNative)));
        expect(platform.starts.last.torchEnabled, !oldTorch);
        expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on);
      });
    }

    testWidgets('torch-only changed option $oldTorch to ${!oldTorch} ends manual override', (tester) async {
      final controller = QRGenScannerController();
      final trace = _TorchTrace('torch-only: old=$oldTorch next=${!oldTorch}');
      retain(tester, controller, trace);
      await mount(tester, controller, _options(oldTorch), trace);
      trace.record(tester, platform, 'initial');
      final initialNative = tester.widget<MobileScanner>(find.byType(MobileScanner)).controller;
      await _command(tester, controller.setTorch(!oldTorch));
      trace.record(tester, platform, 'manual away');
      await _command(tester, controller.setTorch(oldTorch));
      trace.record(tester, platform, 'manual back');
      expect(platform.torchToggles, 2);
      await mount(tester, controller, _options(!oldTorch), trace);
      trace.record(tester, platform, 'torch option update');

      expect(platform.starts, hasLength(1));
      expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller, same(initialNative));
      expect(platform.torchState, oldTorch ? TorchState.off : TorchState.on);
      expect(platform.torchToggles, 3);
    });
  }
}
