// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual QRGenWebScanner/controller bootstrap checks using the existing
// script/navigation platform boundary. No fabricated camera-ready messages.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';

import 'web_scanner_widget_test.dart' as fixture;

class _Navigation extends fixture.FakeNavigationDelegate {
  _Navigation(super.params);

  PageEventCallback? started;
  PageEventCallback? finished;
  WebResourceErrorCallback? failed;

  @override
  Future<void> setOnPageStarted(PageEventCallback callback) async => started = callback;

  @override
  Future<void> setOnPageFinished(PageEventCallback callback) async => finished = callback;

  @override
  Future<void> setOnWebResourceError(WebResourceErrorCallback callback) async => failed = callback;
}

class _WebController extends fixture.FakeWebViewController {
  _WebController(super.params);

  _Navigation? navigation;
  final List<String> events = [];
  final List<Map<String, Object?>> capabilityProbes = [];
  bool documentFinished = false;

  @override
  Future<void> setPlatformNavigationDelegate(PlatformNavigationDelegate handler) async {
    navigation = handler as _Navigation;
  }

  @override
  Future<void> loadRequest(LoadRequestParams params) async {
    documentFinished = false;
    await super.loadRequest(params);
    events.add('platform:load-request');
    navigation?.started?.call(params.uri.toString());
  }

  void finishDocument() {
    documentFinished = true;
    events.add('platform:document-finished');
    navigation?.finished?.call(loaded.last.toString());
  }

  @override
  Future<void> runJavaScript(String javaScript) async {
    events.add('platform:javascript-dispatched');
    await super.runJavaScript(javaScript);
  }

  @override
  Future<Object> runJavaScriptReturningResult(String javaScript) async {
    // Read-only Boolean transport-capability boundary. The independent real
    // browser control checks this predicate for the actual embed. This fake
    // neither executes page code nor decides whether a command may be sent.
    if (!javaScript.contains('typeof') || !javaScript.contains('qrgen') || !javaScript.contains('command')) {
      throw UnsupportedError('This fixture supports only a Boolean QRGen command-capability predicate');
    }
    capabilityProbes.add({'script': javaScript, 'commandAvailable': documentFinished});
    return documentFinished;
  }
}

class _Platform extends fixture.FakeWebViewPlatform {
  _WebController get probe => last as _WebController;

  @override
  PlatformWebViewController createPlatformWebViewController(PlatformWebViewControllerCreationParams params) {
    final controller = _WebController(params);
    controllers.add(controller);
    return controller;
  }

  @override
  PlatformNavigationDelegate createPlatformNavigationDelegate(PlatformNavigationDelegateCreationParams params) =>
      _Navigation(params);
}

class _Trace {
  _Trace(this.name);

  final String name;
  final List<QRGenError> errors = [];
  final List<Map<String, Object?>> snapshots = [];
  int readyCallbacks = 0;

  void record(QRGenWebScannerController controller, _Platform platform, String phase) {
    snapshots.add({
      'phase': phase,
      'attached': controller.isAttached,
      'ready': controller.isReady,
      'readyCallbacks': readyCallbacks,
      'loaded': [for (final uri in platform.probe.loaded) uri.toString()],
      'scripts': List<String>.of(platform.probe.scripts),
      'events': List<String>.of(platform.probe.events),
      'capabilityProbes': List<Map<String, Object?>>.of(platform.probe.capabilityProbes),
      'errors': [for (final error in errors) error.toJson()],
    });
  }
}

void main() {
  late _Platform platform;

  setUp(() {
    platform = _Platform();
    WebViewPlatform.instance = platform;
  });

  Future<void> mount(WidgetTester tester, QRGenWebScannerController controller, _Trace trace,
      {QRGenPermissionRequest? permission, String embedUrl = 'https://example.com/embed/?autostart=0'}) async {
    await tester.pumpWidget(fixture.host(QRGenWebScanner(
      controller: controller,
      embedUrl: embedUrl,
      options: const QRGenScannerOptions(symbologies: ['qr'], beep: false, vibrate: false),
      requestCameraPermission: permission,
      onReady: () => trace.readyCallbacks++,
      onError: trace.errors.add,
    )));
    await fixture.settle(tester);
  }

  void retain(WidgetTester tester, QRGenWebScannerController controller, _Trace trace,
      {List<QRGenErrorCode> expectedErrors = const []}) {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      await fixture.settle(tester);
      final cleanup = {
        'attached': controller.isAttached,
        'ready': controller.isReady,
        'scannerWidgetMounted': find.byType(QRGenWebScanner).evaluate().isNotEmpty,
      };
      controller.dispose();
      debugPrint('FLUTTER_WEB_BOOTSTRAP_PROBE ${jsonEncode({
        'name': trace.name,
        'snapshots': trace.snapshots,
        'errors': [for (final error in trace.errors) error.toJson()],
        'cleanup': cleanup,
        'scope': 'Actual Flutter widget/controller with script/navigation boundary only; no embed execution or native resource claim.',
      })}');
      expect(cleanup, {'attached': false, 'ready': false, 'scannerWidgetMounted': false});
      expect(trace.errors.map((error) => error.code), expectedErrors);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('programmatic start reaches autostart-disabled loaded page before camera ready', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('programmatic autostart0 bootstrap');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    expect(web.loaded.single.queryParameters['autostart'], '0');
    expect(web.channels.keys, contains(qrgenBridgeChannelName));
    expect(web.navigation, isNotNull);
    web.finishDocument();
    await fixture.settle(tester);
    trace.record(controller, platform, 'document finished, no camera-ready message');
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    expect(web.scripts, isEmpty);

    await controller.start();
    await fixture.settle(tester);
    trace.record(controller, platform, 'public start completed');
    // Intended baseline failure. This asserts the public dispatch needed to
    // bootstrap. Separate actual-browser proof establishes bridge availability
    // before camera ready; this fake does not invent that page behavior.
    expect(web.scripts, contains(QRGenBridgeCommand.start.toScript()),
        reason: 'autostart0 waits for the host start that cannot wait for camera-ready');
    expect(trace.readyCallbacks, 0);
  });

  testWidgets('disposed controller does not dispatch a queued start', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('dispose before bootstrap');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    await tester.pumpWidget(const SizedBox());
    await fixture.settle(tester);
    await controller.start();
    await fixture.settle(tester);
    trace.record(controller, platform, 'detached public start');
    expect(controller.isAttached, isFalse);
    expect(platform.probe.scripts, isEmpty);
  });

  testWidgets('late permission grant after widget removal does not load or start', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('late permission after dispose');
    final permission = Completer<bool>();
    retain(tester, controller, trace);
    await mount(tester, controller, trace, permission: () => permission.future);
    expect(platform.probe.loaded, isEmpty);
    await tester.pumpWidget(const SizedBox());
    await fixture.settle(tester);
    permission.complete(true);
    await fixture.settle(tester);
    await controller.start();
    trace.record(controller, platform, 'late grant completed');
    expect(platform.probe.loaded, isEmpty);
    expect(platform.probe.scripts, isEmpty);
  });

  for (final throws in [false, true]) {
    testWidgets('permission ${throws ? 'throw' : 'denial'} is not a bootstrap wait', (tester) async {
      final controller = QRGenWebScannerController();
      final trace = _Trace('permission ${throws ? 'throw' : 'deny'}');
      retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.cameraPermissionDenied]);
      await mount(tester, controller, trace, permission: () async {
        if (throws) throw StateError('Controlled permission callback failure');
        return false;
      });
      await controller.start();
      await fixture.settle(tester);
      trace.record(controller, platform, 'permission rejected');
      expect(platform.probe.loaded, isEmpty);
      expect(platform.probe.scripts, isEmpty);
      expect(trace.readyCallbacks, 0);
      expect(trace.errors.map((error) => error.code), [QRGenErrorCode.cameraPermissionDenied]);
    });
  }

  testWidgets('main-frame load error is reported distinctly from bootstrap wait', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('controlled main-frame error');
    retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.engineLoadFailed]);
    await mount(tester, controller, trace);
    final callback = platform.probe.navigation?.failed;
    expect(callback, isNotNull);
    callback!(WebResourceError(errorCode: -2, description: 'Controlled main-frame load failure', isForMainFrame: true));
    await fixture.settle(tester);
    trace.record(controller, platform, 'main-frame failure delivered');
    expect(trace.errors.map((error) => error.code), [QRGenErrorCode.engineLoadFailed]);
    expect(trace.readyCallbacks, 0);
    expect(platform.probe.scripts, isEmpty);
  });

  testWidgets('start queued before document finish dispatches after document availability without ready', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('start before document finish');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.start();
    trace.record(controller, platform, 'start before document finish');
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    web.finishDocument();
    await fixture.settle(tester);
    trace.record(controller, platform, 'document finished with pending start');
    expect(web.scripts, contains(QRGenBridgeCommand.start.toScript()),
        reason: 'Initial queued start must be admitted once the document bridge can receive it');
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
  });

  testWidgets('ordinary commands remain queued before document bridge availability', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('ordinary commands before document availability');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    await controller.pause();
    await controller.setTorch(true);
    await fixture.settle(tester);
    trace.record(controller, platform, 'ordinary commands before document finish');
    expect(platform.probe.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    platform.probe.finishDocument();
    await fixture.settle(tester);
    trace.record(controller, platform, 'ordinary commands after document finish, before camera-ready');
    expect(platform.probe.scripts, isEmpty,
        reason: 'Admitting bootstrap start must preserve ordinary pre-camera-ready queue behavior');
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
  });

  testWidgets('public start retry dispatches after initial camera error without a ready message', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('initial default-autostart error then public retry');
    retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.cameraPermissionDenied]);
    await mount(tester, controller, trace, embedUrl: 'https://example.com/embed/');
    final web = platform.probe;
    expect(web.loaded.single.queryParameters.containsKey('autostart'), isFalse);
    web.finishDocument();
    // This is an incoming error at the documented channel boundary, not a
    // fabricated ready or a replacement of the page startup algorithm.
    // The real browser denial/retry control proves the corresponding page path.
    web.post({'source': 'qrgen', 'version': 1, 'type': 'error',
      'code': 'camera-permission-denied', 'message': 'Controlled initial camera startup denial'});
    await fixture.settle(tester);
    trace.record(controller, platform, 'initial error, no ready');
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    expect(trace.errors.map((error) => error.code), [QRGenErrorCode.cameraPermissionDenied]);
    expect(web.scripts, isEmpty);
    await controller.start();
    await fixture.settle(tester);
    trace.record(controller, platform, 'public retry completed');
    expect(web.scripts, contains(QRGenBridgeCommand.start.toScript()),
        reason: 'A start retry cannot depend on the first startup succeeding and reporting ready');
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
  });
}
