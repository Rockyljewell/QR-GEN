// Widget tests for QRGenWebScanner against a fake webview_flutter platform.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';

class FakeWebViewPlatform extends WebViewPlatform {
  final List<FakeWebViewController> controllers = [];

  FakeWebViewController get last => controllers.last;

  @override
  PlatformWebViewController createPlatformWebViewController(PlatformWebViewControllerCreationParams params) {
    final controller = FakeWebViewController(params);
    controllers.add(controller);
    return controller;
  }

  @override
  PlatformNavigationDelegate createPlatformNavigationDelegate(PlatformNavigationDelegateCreationParams params) =>
      FakeNavigationDelegate(params);

  @override
  PlatformWebViewWidget createPlatformWebViewWidget(PlatformWebViewWidgetCreationParams params) => FakeWebViewWidget(params);
}

class FakeWebViewController extends PlatformWebViewController {
  FakeWebViewController(super.params) : super.implementation();

  final List<Uri> loaded = [];
  final List<String> scripts = [];
  final Map<String, JavaScriptChannelParams> channels = {};
  void Function(PlatformWebViewPermissionRequest request)? onPermission;
  int reloads = 0;

  void post(Map<String, Object?> message) =>
      channels[qrgenBridgeChannelName]!.onMessageReceived(JavaScriptMessage(message: jsonEncode(message)));

  @override
  Future<void> loadRequest(LoadRequestParams params) async => loaded.add(params.uri);

  @override
  Future<void> runJavaScript(String javaScript) async => scripts.add(javaScript);

  @override
  Future<void> addJavaScriptChannel(JavaScriptChannelParams javaScriptChannelParams) async =>
      channels[javaScriptChannelParams.name] = javaScriptChannelParams;

  @override
  Future<void> setJavaScriptMode(JavaScriptMode javaScriptMode) async {}

  @override
  Future<void> setBackgroundColor(Color color) async {}

  @override
  Future<void> setPlatformNavigationDelegate(PlatformNavigationDelegate handler) async {}

  @override
  Future<void> setOnPlatformPermissionRequest(void Function(PlatformWebViewPermissionRequest request) onPermissionRequest) async =>
      onPermission = onPermissionRequest;

  @override
  Future<void> reload() async => reloads++;
}

class FakeNavigationDelegate extends PlatformNavigationDelegate {
  FakeNavigationDelegate(super.params) : super.implementation();

  @override
  Future<void> setOnPageStarted(PageEventCallback onPageStarted) async {}

  @override
  Future<void> setOnPageFinished(PageEventCallback onPageFinished) async {}

  @override
  Future<void> setOnWebResourceError(WebResourceErrorCallback onWebResourceError) async {}

  @override
  Future<void> setOnNavigationRequest(NavigationRequestCallback onNavigationRequest) async {}

  @override
  Future<void> setOnProgress(ProgressCallback onProgress) async {}

  @override
  Future<void> setOnUrlChange(UrlChangeCallback onUrlChange) async {}
}

class FakeWebViewWidget extends PlatformWebViewWidget {
  FakeWebViewWidget(super.params) : super.implementation();

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

/// Records the decision in a shared list (the request class is immutable).
class FakePermissionRequest extends PlatformWebViewPermissionRequest {
  const FakePermissionRequest(Set<WebViewPermissionResourceType> types, this.decisions) : super(types: types);

  final List<bool> decisions;

  @override
  Future<void> grant() async => decisions.add(true);

  @override
  Future<void> deny() async => decisions.add(false);
}

const Map<String, Object?> _barcode = {'data': 'hello', 'symbology': 'qr', 'timestamp': 1};

Widget host(Widget child) => MaterialApp(home: Scaffold(body: SizedBox(width: 390, height: 844, child: child)));

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 10));
  }
}

String script(QRGenBridgeCommand c) => c.toScript();

void main() {
  late FakeWebViewPlatform platform;

  setUp(() {
    platform = FakeWebViewPlatform();
    WebViewPlatform.instance = platform;
  });

  testWidgets('loads the embed URL and registers the QRGenBridge channel', (tester) async {
    await tester.pumpWidget(
      host(const QRGenWebScanner(options: QRGenScannerOptions(symbologies: ['qr', 'ean13'], mode: QRGenScanMode.single))),
    );
    await settle(tester);
    final web = platform.last;
    expect(web.channels.keys, [qrgenBridgeChannelName]);
    final uri = web.loaded.single;
    expect(uri.toString(), startsWith(qrgenDefaultEmbedUrl));
    expect(uri.queryParameters['symbologies'], 'qr,ean13');
    expect(uri.queryParameters['mode'], 'single');
    expect(uri.queryParameters['vibrate'], '0', reason: 'haptics are native');
  });

  testWidgets('forwards scan, track and error messages', (tester) async {
    final scans = <List<QRGenBarcode>>[];
    final tracks = <List<QRGenTrackedBarcode>>[];
    final errors = <QRGenError>[];
    var ready = 0;
    await tester.pumpWidget(
      host(
        QRGenWebScanner(
          embedUrl: 'https://example.com/embed/',
          onScan: scans.add,
          onTrack: tracks.add,
          onError: errors.add,
          onReady: () => ready++,
        ),
      ),
    );
    await settle(tester);
    final web = platform.last;
    expect(web.loaded.single.toString(), startsWith('https://example.com/embed/?'));

    web.post({'source': 'qrgen', 'version': 1, 'type': 'ready'});
    web.post({'source': 'other', 'type': 'scan', 'barcodes': [_barcode]});
    web.post({'source': 'qrgen', 'version': 1, 'type': 'scan', 'barcodes': [_barcode]});
    web.post({'source': 'qrgen', 'version': 1, 'type': 'track', 'tracked': [{..._barcode, 'id': 'qr-1', 'count': 2}]});
    web.post({'source': 'qrgen', 'version': 1, 'type': 'error', 'code': 'camera-in-use', 'message': 'busy'});
    await settle(tester);

    expect(ready, 1);
    expect(scans.single.single.data, 'hello');
    expect(tracks.single.single.id, 'qr-1');
    expect(errors.single.code, QRGenErrorCode.cameraInUse);
  });

  testWidgets('queues commands until ready, then runs them', (tester) async {
    final controller = QRGenWebScannerController();
    await tester.pumpWidget(host(QRGenWebScanner(controller: controller)));
    await settle(tester);
    final web = platform.last;

    await controller.setTorch(true);
    await controller.pause();
    expect(web.scripts, isEmpty);
    expect(controller.isReady, isFalse);

    web.post({'source': 'qrgen', 'version': 1, 'type': 'ready'});
    await settle(tester);
    expect(controller.isReady, isTrue);
    expect(web.scripts, [script(QRGenBridgeCommand.torch(true)), script(QRGenBridgeCommand.pause)]);

    await controller.resume();
    expect(web.scripts.last, 'window.qrgen && window.qrgen.command({"type":"resume"});');
    controller.dispose();
  });

  testWidgets('isActive and torch changes send commands', (tester) async {
    await tester.pumpWidget(host(const QRGenWebScanner()));
    await settle(tester);
    final web = platform.last;
    web.post({'source': 'qrgen', 'version': 1, 'type': 'ready'});
    await settle(tester);
    expect(web.scripts, isEmpty);

    await tester.pumpWidget(host(const QRGenWebScanner(isActive: false)));
    await settle(tester);
    expect(web.scripts.last, script(QRGenBridgeCommand.stop));

    await tester.pumpWidget(host(const QRGenWebScanner(options: QRGenScannerOptions(torch: true))));
    await settle(tester);
    expect(web.scripts, containsAll([script(QRGenBridgeCommand.start), script(QRGenBridgeCommand.torch(true))]));
    expect(web.loaded, hasLength(1), reason: 'torch changes must not reload the page');

    await tester.pumpWidget(host(const QRGenWebScanner(options: QRGenScannerOptions(torch: true, mode: QRGenScanMode.batch))));
    await settle(tester);
    expect(web.loaded, hasLength(2));
    expect(web.loaded.last.queryParameters['mode'], 'batch');
  });

  testWidgets('grants only camera permission requests from the page', (tester) async {
    await tester.pumpWidget(host(const QRGenWebScanner()));
    await settle(tester);
    final decisions = <bool>[];
    platform.last.onPermission!(FakePermissionRequest(const {WebViewPermissionResourceType.camera}, decisions));
    platform.last.onPermission!(FakePermissionRequest(const {WebViewPermissionResourceType.microphone}, decisions));
    await settle(tester);
    expect(decisions, [true, false]);
  });

  testWidgets('does not load when the camera permission is refused', (tester) async {
    final errors = <QRGenError>[];
    await tester.pumpWidget(
      host(QRGenWebScanner(requestCameraPermission: () async => false, onError: errors.add)),
    );
    await settle(tester);
    expect(platform.last.loaded, isEmpty);
    expect(errors.single.code, QRGenErrorCode.cameraPermissionDenied);
    expect(find.textContaining('Camera permission was denied'), findsOneWidget);
  });
}
