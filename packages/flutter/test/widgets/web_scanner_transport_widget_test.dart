// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual widget/controller ordering at a controlled WebView API boundary.
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
  Object capability = false;
  final List<String> probes = [];
  final List<String> injections = [];
  final List<Completer<Object>> probeResults = [];
  final List<Completer<void>> injectionResults = [];

  @override
  Future<void> setPlatformNavigationDelegate(PlatformNavigationDelegate handler) async {
    navigation = handler as _Navigation;
  }

  @override
  Future<void> loadRequest(LoadRequestParams params) async {
    capability = false;
    await super.loadRequest(params);
    navigation?.started?.call(params.uri.toString());
  }

  @override
  Future<void> reload() async {
    capability = false;
    await super.reload();
    navigation?.started?.call(loaded.last.toString());
  }

  void finishDocument({Object available = true}) {
    capability = available;
    navigation?.finished?.call(loaded.last.toString());
  }

  void ready() {
    // A real embed can report camera-ready only after installing its command API.
    capability = true;
    post({'source': 'qrgen', 'version': 1, 'type': 'ready'});
  }

  @override
  Future<Object> runJavaScriptReturningResult(String javaScript) async {
    if (!javaScript.contains('typeof') || !javaScript.contains('qrgen') || !javaScript.contains('command')) {
      throw UnsupportedError('Only a read-only command-capability query is supported');
    }
    probes.add(javaScript);
    return probeResults.isEmpty ? capability : await probeResults.removeAt(0).future;
  }

  @override
  Future<void> runJavaScript(String javaScript) async {
    injections.add(javaScript);
    if (injectionResults.isNotEmpty) await injectionResults.removeAt(0).future;
    await super.runJavaScript(javaScript);
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

  void record(QRGenWebScannerController controller, _WebController web, String phase) {
    snapshots.add({
      'phase': phase,
      'attached': controller.isAttached,
      'ready': controller.isReady,
      'readyCallbacks': readyCallbacks,
      'loaded': [for (final uri in web.loaded) uri.toString()],
      'reloads': web.reloads,
      'capability': web.capability,
      'probes': List<String>.of(web.probes),
      'injections': List<String>.of(web.injections),
      'scripts': List<String>.of(web.scripts),
    });
  }
}

void main() {
  late _Platform platform;

  setUp(() {
    platform = _Platform();
    WebViewPlatform.instance = platform;
  });

  Widget widget(
    QRGenWebScannerController controller,
    _Trace trace, {
    String embedUrl = 'https://example.com/embed/?autostart=0',
    QRGenPermissionRequest? permission,
    VoidCallback? onReady,
  }) => fixture.host(
    QRGenWebScanner(
      controller: controller,
      embedUrl: embedUrl,
      onReady: () {
        trace.readyCallbacks++;
        onReady?.call();
      },
      onError: trace.errors.add,
      requestCameraPermission: permission,
    ),
  );

  Future<void> mount(
    WidgetTester tester,
    QRGenWebScannerController controller,
    _Trace trace, {
    QRGenPermissionRequest? permission,
    VoidCallback? onReady,
  }) async {
    await tester.pumpWidget(widget(controller, trace, permission: permission, onReady: onReady));
    await fixture.settle(tester);
  }

  void retain(
    WidgetTester tester,
    QRGenWebScannerController controller,
    _Trace trace, {
    List<QRGenErrorCode> expectedErrors = const [],
  }) {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      await fixture.settle(tester);
      final cleanup = {
        'attached': controller.isAttached,
        'ready': controller.isReady,
        'scannerWidgetMounted': find.byType(QRGenWebScanner).evaluate().isNotEmpty,
      };
      controller.dispose();
      debugPrint(
        'FLUTTER_WEB_TRANSPORT_PROBE ${jsonEncode({
          'name': trace.name,
          'snapshots': trace.snapshots,
          'errors': [for (final error in trace.errors) error.toJson()],
          'cleanup': cleanup,
          'scope': 'Actual widget/controller, fake navigation/evaluation boundary; no native document or camera provenance claim.',
        })}',
      );
      expect(cleanup, {'attached': false, 'ready': false, 'scannerWidgetMounted': false});
      expect(trace.errors.map((error) => error.code), expectedErrors);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('late command API remains observable without inventing camera ready', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('late command API and ordinary queue');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.setTorch(true);
    await controller.pause();
    await controller.resume();
    await controller.start();
    web.finishDocument(available: false);
    await fixture.settle(tester);
    for (var observation = 0; observation < 35; observation++) {
      await tester.pump(const Duration(seconds: 2));
    }
    final beforeLateApi = web.probes.length;
    expect(beforeLateApi, greaterThan(20));
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, web, 'API absent after seventy seconds of fake elapsed time');
    web.capability = true;
    await tester.pump(const Duration(seconds: 2));
    await fixture.settle(tester);
    expect(web.probes.length, greaterThan(beforeLateApi));
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, web, 'late API admits start only');
    final observationsAtStart = web.probes.length;
    await tester.pump(const Duration(seconds: 20));
    expect(web.probes, hasLength(observationsAtStart), reason: 'No eligible command remains before camera-ready');
    web.ready();
    await fixture.settle(tester);
    expect(web.scripts, [
      QRGenBridgeCommand.start.toScript(),
      QRGenBridgeCommand.torch(true).toScript(),
      QRGenBridgeCommand.pause.toScript(),
      QRGenBridgeCommand.resume.toScript(),
    ]);
    expect(controller.isReady, isTrue);
    expect(trace.readyCallbacks, 1);
    trace.record(controller, web, 'actual channel ready drains ordinary queue');
  });

  testWidgets('serialized false is not transport capability', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('strict Boolean capability representation');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.start();
    web.finishDocument(available: 'false');
    await fixture.settle(tester);
    expect(web.scripts, isEmpty);
    web.capability = 'true';
    await tester.pump(const Duration(seconds: 1));
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, web, 'only explicit true admits start');
  });

  testWidgets('transient capability failure retains bootstrap and ordinary intent', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('transient capability evaluation failure');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    final capability = Completer<Object>();
    web.probeResults.add(capability);
    await controller.pause();
    await controller.start();
    web.finishDocument();
    await fixture.settle(tester);
    capability.completeError(StateError('Controlled capability evaluation failure'));
    await fixture.settle(tester);
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    await tester.pump(const Duration(seconds: 1));
    await fixture.settle(tester);
    expect(web.probes, hasLength(2));
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    web.ready();
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript(), QRGenBridgeCommand.pause.toScript()]);
    trace.record(controller, web, 'failed capability did not lose either queued command');
  });

  for (final boundary in ['reload', 'URL', 'removal']) {
    testWidgets('late capability result cannot cross $boundary ownership', (tester) async {
      final controller = QRGenWebScannerController();
      final trace = _Trace('late capability after $boundary');
      retain(tester, controller, trace);
      await mount(tester, controller, trace);
      final web = platform.probe;
      final capability = Completer<Object>();
      web.probeResults.add(capability);
      await controller.start();
      web.finishDocument();
      await fixture.settle(tester);
      expect(web.probes, hasLength(1));
      final previousUrl = web.loaded.last.toString();
      if (boundary == 'reload') {
        await controller.reload();
      } else if (boundary == 'URL') {
        await tester.pumpWidget(widget(controller, trace, embedUrl: 'https://example.com/other/?autostart=0'));
      } else {
        await tester.pumpWidget(const SizedBox());
      }
      await fixture.settle(tester);
      if (boundary == 'URL') web.navigation?.finished?.call(previousUrl);
      capability.complete(true);
      await fixture.settle(tester);
      expect(web.scripts, isEmpty);
      expect(controller.isReady, isFalse);
      trace.record(controller, web, 'old true result ignored');
      if (boundary == 'removal') {
        await tester.pump(const Duration(seconds: 20));
        expect(web.probes, hasLength(1));
        expect(controller.isAttached, isFalse);
      } else {
        web.finishDocument();
        await fixture.settle(tester);
        expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
        expect(web.probes, hasLength(boundary == 'URL' ? 3 : 2));
      }
      trace.record(controller, web, 'current owner outcome');
    });
  }

  testWidgets('redirected document can bootstrap without another page-start event', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('redirected document capability');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    final initialUrl = web.loaded.single.toString();
    const finalUrl = 'https://example.com/redirected/embed/?autostart=0';
    expect(initialUrl, isNot(finalUrl));
    await controller.pause();
    await controller.start();
    // The native boundary may report only the provisional URL as started.
    // Completion alone is not readiness: the actual predicate is still false.
    web.navigation?.finished?.call(finalUrl);
    await fixture.settle(tester);
    expect(web.probes, hasLength(1));
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, web, 'redirect finished without callable bridge');
    web.capability = true;
    await tester.pump(const Duration(seconds: 1));
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, web, 'actual redirected-page capability admits start only');
  });

  testWidgets('same const start during injection remains a distinct queued request', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('same-type entry identity');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    web.finishDocument();
    final injection = Completer<void>();
    web.injectionResults.add(injection);
    final first = controller.start();
    await fixture.settle(tester);
    final replacement = controller.start();
    await tester.pump();
    expect(web.injections, [QRGenBridgeCommand.start.toScript()]);
    injection.complete();
    await first;
    await replacement;
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript(), QRGenBridgeCommand.start.toScript()]);
    expect(web.injections, hasLength(2));
    trace.record(controller, web, 'old completion preserves replacement entry');
  });

  testWidgets('ready racing a false pending probe uses one ordered drain', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('ready while capability is pending');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.setTorch(true);
    await controller.pause();
    await controller.start();
    final capability = Completer<Object>();
    web.probeResults.add(capability);
    web.finishDocument();
    await fixture.settle(tester);
    web.ready();
    await tester.pump();
    expect(trace.readyCallbacks, 1);
    capability.complete(false);
    await fixture.settle(tester);
    expect(web.probes, hasLength(1));
    expect(web.scripts, [
      QRGenBridgeCommand.torch(true).toScript(),
      QRGenBridgeCommand.pause.toScript(),
      QRGenBridgeCommand.start.toScript(),
    ]);
    expect(web.injections, hasLength(3));
    trace.record(controller, web, 'real ready wins over old false without duplicate dispatch');
  });

  for (final afterReady in [false, true]) {
    testWidgets('failed ${afterReady ? 'ready ordinary' : 'bootstrap'} injection remains queued', (tester) async {
      final controller = QRGenWebScannerController();
      final trace = _Trace('retained injection ${afterReady ? 'after ready' : 'before ready'}');
      retain(tester, controller, trace);
      await mount(tester, controller, trace);
      final web = platform.probe;
      web.finishDocument();
      if (afterReady) web.ready();
      final failure = Completer<void>();
      web.injectionResults.add(failure);
      final command = afterReady ? QRGenBridgeCommand.pause : QRGenBridgeCommand.start;
      final sending = controller.send(command);
      await fixture.settle(tester);
      failure.completeError(StateError('Controlled JavaScript injection failure'));
      await sending;
      await fixture.settle(tester);
      expect(web.scripts, isEmpty);
      expect(web.injections, [command.toScript()]);
      await tester.pump(const Duration(seconds: 1));
      await fixture.settle(tester);
      expect(web.scripts, [command.toScript()]);
      expect(web.injections, hasLength(2));
      expect(controller.isReady, afterReady);
      expect(trace.readyCallbacks, afterReady ? 1 : 0);
      trace.record(controller, web, 'transient injection failure recovered once');
    });
  }

  testWidgets('failed old injection never resurrects a replaced torch value', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('failed injection and newer same-type value');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    web.ready();
    final failure = Completer<void>();
    web.injectionResults.add(failure);
    final first = controller.setTorch(true);
    await fixture.settle(tester);
    final replacement = controller.setTorch(false);
    failure.completeError(StateError('Controlled old injection failure'));
    await first;
    await replacement;
    await tester.pump(const Duration(seconds: 1));
    await fixture.settle(tester);
    expect(web.injections, [QRGenBridgeCommand.torch(true).toScript(), QRGenBridgeCommand.torch(false).toScript()]);
    expect(web.scripts, [QRGenBridgeCommand.torch(false).toScript()]);
    trace.record(controller, web, 'new value survives failure');
  });

  testWidgets('old injection completion cannot unlock or remove replacement-page work', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('generation-bound drain ownership');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    web.finishDocument();
    final oldInjection = Completer<void>();
    web.injectionResults.add(oldInjection);
    final oldSending = controller.start();
    await fixture.settle(tester);
    await controller.reload();
    await controller.start();
    final newCapability = Completer<Object>();
    web.probeResults.add(newCapability);
    web.finishDocument();
    await fixture.settle(tester);
    oldInjection.complete();
    await oldSending;
    await fixture.settle(tester);
    expect(web.injections, hasLength(1));
    final replacement = controller.start();
    await tester.pump();
    expect(web.probes, hasLength(2), reason: 'Old completion cannot release the current probe owner');
    newCapability.complete(true);
    await replacement;
    await fixture.settle(tester);
    expect(web.injections, hasLength(2));
    expect(web.scripts, [QRGenBridgeCommand.start.toScript(), QRGenBridgeCommand.start.toScript()]);
    trace.record(controller, web, 'only new owner drains its replacement entry');
  });

  testWidgets('main-frame failure cancels old observations until a new navigation', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('main-frame failure and reload');
    retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.engineLoadFailed]);
    await mount(tester, controller, trace);
    final web = platform.probe;
    final capability = Completer<Object>();
    web.probeResults.add(capability);
    await controller.start();
    web.finishDocument();
    await fixture.settle(tester);
    web.navigation?.failed?.call(
      WebResourceError(errorCode: -2, description: 'Controlled main-frame failure', isForMainFrame: true),
    );
    web.ready();
    capability.complete(true);
    await fixture.settle(tester);
    await tester.pump(const Duration(seconds: 20));
    expect(web.probes, hasLength(1));
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    await controller.reload();
    web.finishDocument();
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    trace.record(controller, web, 'new document recovers retained intent');
  });

  testWidgets('ordinary-only queue never polls or claims camera ready', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('ordinary-only queue is quiet');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.pause();
    await controller.setTorch(true);
    await controller.resume();
    web.finishDocument(available: false);
    await tester.pump(const Duration(seconds: 20));
    expect(web.probes, isEmpty);
    expect(web.scripts, isEmpty);
    expect(trace.readyCallbacks, 0);
    web.ready();
    await fixture.settle(tester);
    expect(web.scripts, [
      QRGenBridgeCommand.pause.toScript(),
      QRGenBridgeCommand.torch(true).toScript(),
      QRGenBridgeCommand.resume.toScript(),
    ]);
    expect(web.probes, isEmpty);
    trace.record(controller, web, 'only real channel ready releases ordinary work');
  });

  testWidgets('start and stop keep their relative order before camera ready', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('transport-safe stop before ready');
    retain(tester, controller, trace);
    await mount(tester, controller, trace);
    final web = platform.probe;
    await controller.pause();
    await controller.start();
    await controller.stop();
    web.finishDocument();
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript(), QRGenBridgeCommand.stop.toScript()]);
    expect(controller.isReady, isFalse);
    expect(trace.readyCallbacks, 0);
    final observations = web.probes.length;
    await tester.pump(const Duration(seconds: 20));
    expect(web.probes, hasLength(observations));
    trace.record(controller, web, 'ordinary pause remains queued');
  });

  testWidgets('ready callback reload invalidates a pending old capability result', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('reentrant ready reload');
    var reloadOnce = true;
    retain(tester, controller, trace);
    await mount(
      tester,
      controller,
      trace,
      onReady: () {
        if (reloadOnce) {
          reloadOnce = false;
          unawaited(controller.reload());
        }
      },
    );
    final web = platform.probe;
    await controller.setTorch(true);
    await controller.start();
    final capability = Completer<Object>();
    web.probeResults.add(capability);
    web.finishDocument();
    await fixture.settle(tester);
    web.ready();
    capability.complete(true);
    await fixture.settle(tester);
    expect(web.reloads, 1);
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);
    web.finishDocument();
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript()]);
    web.ready();
    await fixture.settle(tester);
    expect(web.scripts, [QRGenBridgeCommand.start.toScript(), QRGenBridgeCommand.torch(true).toScript()]);
    expect(trace.readyCallbacks, 2);
    trace.record(controller, web, 'replacement document drains its own commands');
  });

  testWidgets('denied OS permission never starts document-capability observations', (tester) async {
    final controller = QRGenWebScannerController();
    final trace = _Trace('no document after permission denial');
    retain(tester, controller, trace, expectedErrors: const [QRGenErrorCode.cameraPermissionDenied]);
    await mount(tester, controller, trace, permission: () async => false);
    await controller.start();
    await tester.pump(const Duration(seconds: 20));
    expect(platform.probe.loaded, isEmpty);
    expect(platform.probe.probes, isEmpty);
    expect(platform.probe.scripts, isEmpty);
    expect(trace.readyCallbacks, 0);
    trace.record(controller, platform.probe, 'permission failure remains distinct');
  });
}
