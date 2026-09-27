import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../core/bridge.dart';
import '../core/error.dart';
import '../core/options.dart';
import 'qrgen_scanner.dart' show QRGenErrorCallback, QRGenErrorWidgetBuilder, QRGenScanCallback, QRGenTrackCallback;

/// Asks the operating system for the camera permission; returns whether it
/// was granted. See [QRGenWebScanner.requestCameraPermission].
typedef QRGenPermissionRequest = Future<bool> Function();

/// Imperative control of a [QRGenWebScanner]. Commands sent before the page
/// is ready are queued.
class QRGenWebScannerController {
  _QRGenWebScannerState? _state;

  /// Whether the controller is attached to a mounted scanner.
  bool get isAttached => _state != null;

  /// Whether the embed page reported `ready`.
  bool get isReady => _state?._ready ?? false;

  /// Starts the camera.
  Future<void> start() => send(QRGenBridgeCommand.start);

  /// Stops the camera.
  Future<void> stop() => send(QRGenBridgeCommand.stop);

  /// Keeps the camera open but stops decoding.
  Future<void> pause() => send(QRGenBridgeCommand.pause);

  /// Resumes decoding.
  Future<void> resume() => send(QRGenBridgeCommand.resume);

  /// Turns the torch on or off.
  Future<void> setTorch(bool on) => send(QRGenBridgeCommand.torch(on));

  /// Sends any SPEC section 5 command.
  Future<void> send(QRGenBridgeCommand command) async => _state?._send(command);

  /// Reloads the embed page.
  Future<void> reload() async => _state?._reload();

  /// The underlying `WebViewController`, for advanced configuration.
  WebViewController? get webViewController => _state?._web;

  /// Detaches the controller.
  void dispose() => _state = null;
}

/// Scanner without native QRGen code: loads the hosted QRGen embed page in a
/// WebView (camera through `getUserMedia`, decoding with the QRGen
/// WebAssembly engine) and forwards its events over the `QRGenBridge`
/// JavaScript channel (SPEC section 5).
///
/// On Android the app must hold the `CAMERA` runtime permission before the
/// page can open the camera; pass [requestCameraPermission] (for example with
/// `permission_handler`) or request it before showing the scanner.
class QRGenWebScanner extends StatefulWidget {
  /// Creates a WebView scanner.
  const QRGenWebScanner({
    super.key,
    this.options = const QRGenScannerOptions(),
    this.embedUrl,
    this.onScan,
    this.onTrack,
    this.onError,
    this.onReady,
    this.controller,
    this.isActive = true,
    this.requestCameraPermission,
    this.errorBuilder,
  });

  /// Scanner options, sent as the query string.
  final QRGenScannerOptions options;

  /// Embed page URL; defaults to [qrgenDefaultEmbedUrl]. Set it to self-host.
  final String? embedUrl;

  /// Newly scanned codes.
  final QRGenScanCallback? onScan;

  /// Batch mode: every tracked code.
  final QRGenTrackCallback? onTrack;

  /// Errors from the page or the host.
  final QRGenErrorCallback? onError;

  /// The page reported `ready`.
  final VoidCallback? onReady;

  /// Optional imperative controller.
  final QRGenWebScannerController? controller;

  /// Run the camera. Set it to `false` when the scanner is not visible.
  final bool isActive;

  /// Called before the page is loaded to obtain the OS camera permission
  /// (needed on Android). When it returns `false`, the page is not loaded and
  /// `camera-permission-denied` is reported.
  final QRGenPermissionRequest? requestCameraPermission;

  /// Builds the view shown when the scanner cannot run.
  final QRGenErrorWidgetBuilder? errorBuilder;

  @override
  State<QRGenWebScanner> createState() => _QRGenWebScannerState();
}

class _QRGenWebScannerState extends State<QRGenWebScanner> with WidgetsBindingObserver {
  late final WebViewController _web;
  final List<QRGenBridgeCommand> _pending = [];
  bool _ready = false;
  bool _loaded = false;
  bool _appActive = true;
  bool _visible = true;
  bool _disposed = false;
  bool? _sentActive;
  String? _currentUrl;
  QRGenError? _failure;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _appActive = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    widget.controller?._state = this;
    _web = _createWebViewController();
    unawaited(_prepareAndLoad());
  }

  WebViewController _createWebViewController() {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    final controller = WebViewController.fromPlatformCreationParams(params);
    _quiet(controller.setJavaScriptMode(JavaScriptMode.unrestricted));
    _quiet(controller.setBackgroundColor(Colors.black));
    _quiet(controller.addJavaScriptChannel(qrgenBridgeChannelName, onMessageReceived: _onMessage));
    _quiet(
      controller.setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => _ready = false,
          onWebResourceError: _onWebResourceError,
        ),
      ),
    );
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      _quiet(platform.setMediaPlaybackRequiresUserGesture(false));
      _quiet(platform.setOnPlatformPermissionRequest(_onPermissionRequest));
    } else {
      // WKWebView (iOS 15+ / macOS 12+): grant the page's camera request so the
      // user is not asked a second time after the app-level permission.
      _quiet(platform.setOnPlatformPermissionRequest(_onPermissionRequest));
    }
    return controller;
  }

  /// Runs a platform configuration call, ignoring platforms that do not implement it.
  static void _quiet(Future<void> future) => unawaited(future.catchError((Object _) {}));

  /// Rebuilds after the current frame work; safe to call from lifecycle methods.
  void _refresh() => scheduleMicrotask(() {
        if (mounted && !_disposed) setState(() {});
      });

  void _onPermissionRequest(PlatformWebViewPermissionRequest request) {
    if (request.types.contains(WebViewPermissionResourceType.camera)) {
      unawaited(request.grant());
    } else {
      unawaited(request.deny());
    }
  }

  void _onWebResourceError(WebResourceError error) {
    // Only failures of the page itself matter; sub-resources are the page's business.
    if (error.isForMainFrame == false) return;
    _fail(QRGenError(QRGenErrorCode.engineLoadFailed, 'Could not load the QRGen embed page: ${error.description}'));
  }

  Future<void> _prepareAndLoad() async {
    final request = widget.requestCameraPermission;
    if (request != null) {
      bool granted;
      try {
        granted = await request();
      } catch (_) {
        granted = false;
      }
      if (_disposed) return;
      if (!granted) {
        _fail(QRGenError(QRGenErrorCode.cameraPermissionDenied, 'Camera permission was denied. Enable it in Settings to scan.'));
        return;
      }
    }
    await _load();
  }

  Uri _buildUri() => buildEmbedUri(
        widget.options,
        embedUrl: widget.embedUrl,
        // Haptics are done natively: navigator.vibrate is unavailable in WKWebView.
        extra: const {'vibrate': '0'},
      );

  Future<void> _load() async {
    final uri = _buildUri();
    _currentUrl = uri.toString();
    _ready = false;
    _sentActive = null;
    _loaded = true;
    _failure = null;
    _refresh();
    await _web.loadRequest(uri);
  }

  Future<void> _reload() async {
    _ready = false;
    _sentActive = null;
    await _web.reload();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // ignore: deprecated_member_use
    final visible = TickerMode.of(context);
    if (visible != _visible) {
      _visible = visible;
      _syncActive();
    }
  }

  @override
  void didUpdateWidget(QRGenWebScanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      if (oldWidget.controller?._state == this) oldWidget.controller?._state = null;
      widget.controller?._state = this;
    }
    // Torch changes are sent as a command; anything else reloads the page.
    final withoutTorch = widget.options.copyWith(torch: oldWidget.options.torch);
    final optionsChanged = withoutTorch != oldWidget.options || widget.embedUrl != oldWidget.embedUrl;
    if (optionsChanged && _loaded && _buildUri().toString() != _currentUrl) {
      unawaited(_load());
    } else if (oldWidget.options.torch != widget.options.torch) {
      unawaited(_send(QRGenBridgeCommand.torch(widget.options.torch)));
    }
    if (oldWidget.isActive != widget.isActive) _syncActive();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final active = state == AppLifecycleState.resumed;
    if (active != _appActive) {
      _appActive = active;
      _syncActive();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    if (widget.controller?._state == this) widget.controller?._state = null;
    super.dispose();
  }

  bool get _shouldRun => widget.isActive && _appActive && _visible;

  void _syncActive() {
    final run = _shouldRun;
    if (_sentActive == run) return;
    // The page starts on its own; only send `start` after an explicit `stop`.
    if (_sentActive == null && run) return;
    _sentActive = run;
    unawaited(_send(run ? QRGenBridgeCommand.start : QRGenBridgeCommand.stop));
  }

  Future<void> _send(QRGenBridgeCommand command) async {
    if (_disposed) return;
    if (!_ready) {
      _pending
        ..removeWhere((c) => c.type == command.type)
        ..add(command);
      return;
    }
    try {
      await _web.runJavaScript(command.toScript());
    } catch (_) {
      // The page is reloading; the state is re-sent on the next `ready`.
    }
  }

  void _onMessage(JavaScriptMessage message) {
    if (_disposed) return;
    final parsed = parseBridgeMessage(message.message);
    switch (parsed) {
      case null:
        return;
      case QRGenReadyMessage():
        _ready = true;
        final queued = List.of(_pending);
        _pending.clear();
        if (!_shouldRun && !queued.any((c) => c.type == QRGenBridgeCommandType.stop || c.type == QRGenBridgeCommandType.start)) {
          queued.add(QRGenBridgeCommand.stop);
          _sentActive = false;
        }
        for (final c in queued) {
          unawaited(_send(c));
        }
        if (_failure != null) {
          _failure = null;
          _refresh();
        }
        widget.onReady?.call();
      case QRGenScanMessage(:final barcodes):
        if (barcodes.isEmpty) return;
        if (widget.options.vibrate) unawaited(HapticFeedback.mediumImpact());
        widget.onScan?.call(barcodes);
      case QRGenTrackMessage(:final tracked):
        widget.onTrack?.call(tracked);
      case QRGenErrorMessage(:final error):
        widget.onError?.call(error);
    }
  }

  void _fail(QRGenError error) {
    if (_disposed) return;
    _failure = error;
    _refresh();
    scheduleMicrotask(() {
      if (!_disposed) widget.onError?.call(error);
    });
  }

  Widget _buildFailure(BuildContext context, QRGenError failure) {
    final builder = widget.errorBuilder;
    if (builder != null) return builder(context, failure);
    return ColoredBox(
      color: const Color(0xFF0B0F14),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            failure.message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFE5E7EB), fontSize: 15),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final failure = _failure;
    return ColoredBox(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Keep the WebView mounted so a later reload can recover.
          if (_loaded) WebViewWidget(controller: _web),
          if (failure != null) _buildFailure(context, failure),
        ],
      ),
    );
  }
}
