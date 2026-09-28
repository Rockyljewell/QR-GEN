// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart' as ms;

import '../core/barcode.dart';
import '../core/detection.dart';
import '../core/error.dart';
import '../core/geometry.dart';
import '../core/options.dart';
import '../core/session.dart';
import '../core/symbology.dart';
import 'overlay.dart';

/// Called with newly scanned codes.
typedef QRGenScanCallback = void Function(List<QRGenBarcode> barcodes);

/// Called with every tracked code (batch mode).
typedef QRGenTrackCallback = void Function(List<QRGenTrackedBarcode> tracked);

/// Called with scanner errors.
typedef QRGenErrorCallback = void Function(QRGenError error);

/// Builds the view shown when the camera cannot run.
typedef QRGenErrorWidgetBuilder = Widget Function(BuildContext context, QRGenError error);

/// Names of the `BarcodeFormat` values of the installed mobile_scanner version.
final Set<String> _availableFormatNames = {for (final f in ms.BarcodeFormat.values) f.name};

String get _platformName {
  if (kIsWeb) return QRGenPlatform.web;
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS => QRGenPlatform.ios,
    TargetPlatform.macOS => QRGenPlatform.macos,
    _ => QRGenPlatform.android,
  };
}

/// Whether the installed mobile_scanner decodes with Apple Vision on this platform.
bool get _appleVision => mobileScannerUsesAppleVision(
      platform: _platformName,
      errorCodeNames: {for (final c in ms.MobileScannerErrorCode.values) c.name},
    );

/// The symbologies [QRGenScanner] can read on this platform with the
/// installed mobile_scanner version.
List<QRGenSymbology> qrgenSupportedSymbologies() => mobileScannerSupportedSymbologies(
      platform: _platformName,
      availableFormatNames: _availableFormatNames,
      appleVision: _appleVision,
    );

/// Maps QRGen symbologies to mobile_scanner formats for this platform.
List<ms.BarcodeFormat> qrgenMobileScannerFormats(Iterable<QRGenSymbology> symbologies) {
  final names = mobileScannerFormatNames(
    symbologies,
    platform: _platformName,
    availableFormatNames: _availableFormatNames,
    appleVision: _appleVision,
  );
  return [
    for (final name in names) ms.BarcodeFormat.values.firstWhere((f) => f.name == name),
  ];
}

/// Imperative control of a [QRGenScanner].
///
/// Create it in a `State`, pass it to [QRGenScanner.controller] and call
/// [dispose] when the state is disposed.
class QRGenScannerController {
  _QRGenScannerState? _state;

  /// Whether the controller is attached to a mounted scanner.
  bool get isAttached => _state != null;

  /// Starts the camera, or restarts it after [stop] or a single-mode scan.
  Future<void> start() async => _state?._userStart();

  /// Stops the camera.
  Future<void> stop() async => _state?._userStop();

  /// Keeps the preview running but ignores codes.
  void pause() => _state?._paused = true;

  /// Resumes after [pause], [stop] or a single-mode scan.
  Future<void> resume() async => _state?._userStart();

  /// Clears duplicate history and tracked codes, and resumes.
  Future<void> reset() async => _state?._reset();

  /// Turns the torch on or off (until [QRGenScannerOptions.torch] changes).
  Future<void> setTorch(bool on) async => _state?._setTorch(on);

  /// Switches between the back and front camera.
  Future<void> switchCamera() async => _state?._switchCamera();

  /// The symbologies this back end can read on this device.
  List<QRGenSymbology> get supportedSymbologies => qrgenSupportedSymbologies();

  /// Detaches the controller.
  void dispose() => _state = null;
}

/// Barcode, QR and ID scanner built on `mobile_scanner` (ML Kit on Android,
/// ML Kit or Apple Vision on iOS depending on the mobile_scanner version).
///
/// Uses QRGen symbology ids, SPEC results, scan modes, a duplicate filter,
/// haptic feedback and a QRGen overlay. The camera is stopped while the app
/// is in the background, while [isActive] is `false`, and while the route is
/// covered by another route.
///
/// ```dart
/// QRGenScanner(
///   options: const QRGenScannerOptions(symbologies: ['qr', 'ean13'], mode: QRGenScanMode.single),
///   onScan: (codes) => debugPrint(codes.first.data),
/// )
/// ```
class QRGenScanner extends StatefulWidget {
  /// Creates a scanner.
  const QRGenScanner({
    super.key,
    this.options = const QRGenScannerOptions(),
    this.onScan,
    this.onTrack,
    this.onError,
    this.onReady,
    this.controller,
    this.isActive = true,
    this.accentColor = qrgenAccentColor,
    this.showToast = true,
    this.showHighlights = true,
    this.onBeep,
    this.errorBuilder,
    this.child,
  });

  /// Scanner options (SPEC section 4).
  final QRGenScannerOptions options;

  /// Newly scanned codes, after the duplicate filter.
  final QRGenScanCallback? onScan;

  /// Batch mode: every tracked code, whenever the tracked set changes.
  final QRGenTrackCallback? onTrack;

  /// Errors with SPEC error codes.
  final QRGenErrorCallback? onError;

  /// The camera started.
  final VoidCallback? onReady;

  /// Optional imperative controller.
  final QRGenScannerController? controller;

  /// Run the camera. Set it to `false` when the scanner is not visible.
  final bool isActive;

  /// Viewfinder, highlight and toast accent color.
  final Color accentColor;

  /// Show the success toast pill.
  final bool showToast;

  /// Outline detected codes.
  final bool showHighlights;

  /// Plays the scan sound when [QRGenScannerOptions.beep] is on. Defaults to
  /// a short system click (`SystemSound.play`); pass your own player (for
  /// example with `audioplayers`) for a real beep.
  final VoidCallback? onBeep;

  /// Builds the view shown when the camera cannot run.
  final QRGenErrorWidgetBuilder? errorBuilder;

  /// Drawn on top of the camera and overlay.
  final Widget? child;

  @override
  State<QRGenScanner> createState() => _QRGenScannerState();
}

class _QRGenScannerState extends State<QRGenScanner> with WidgetsBindingObserver {
  static const Duration _highlightLinger = Duration(milliseconds: 280);
  static const Duration _batchTick = Duration(milliseconds: 100);

  late ms.MobileScannerController _controller;
  late String _controllerConfig;
  late QRGenScanSession _session;
  late List<QRGenSymbology> _requested;
  late List<ms.BarcodeFormat> _formats;

  QRGenSize? _viewSize;
  QRGenError? _error;
  Object? _lastReportedScannerError;
  bool _appActive = true;
  bool _visible = true;
  bool _userStopped = false;
  bool _singleDone = false;
  bool _paused = false;
  bool? _torchOverride;
  bool _readyReported = false;
  bool _disposed = false;
  Future<void> _queue = Future<void>.value();

  List<List<Offset>> _highlights = const [];
  QRGenToastData? _toast;
  int _toastId = 0;
  Timer? _highlightTimer;
  Timer? _batchTimer;

  QRGenScannerOptions get _options => widget.options;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _appActive = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _session = QRGenScanSession(mode: _options.mode, duplicateFilter: _options.duplicateFilter);
    _resolveFormats();
    _controller = _createController();
    widget.controller?._state = this;
    if (_formats.isEmpty) _reportUnsupported();
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Routes covered by an opaque route are offstage, which disables tickers.
    // ignore: deprecated_member_use
    final visible = TickerMode.of(context);
    if (visible != _visible) {
      _visible = visible;
      _sync();
    }
  }

  @override
  void didUpdateWidget(QRGenScanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      if (oldWidget.controller?._state == this) oldWidget.controller?._state = null;
      widget.controller?._state = this;
    }
    final oldOptions = oldWidget.options;
    final newOptions = widget.options;
    if (oldOptions.mode != newOptions.mode) {
      _singleDone = false;
      _clearHighlights(rebuild: false);
    }
    _session.configure(mode: newOptions.mode, duplicateFilter: newOptions.duplicateFilter);
    if (!listEquals(oldOptions.symbologies, newOptions.symbologies)) _resolveFormats();
    if (_configKey() != _controllerConfig) {
      _replaceController();
    } else if (oldOptions.torch != newOptions.torch) {
      _torchOverride = null;
      _enqueue(_applyTorch);
    }
    if (oldWidget.isActive != widget.isActive || oldOptions.mode != newOptions.mode) _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final active = state == AppLifecycleState.resumed;
    if (active != _appActive) {
      _appActive = active;
      _sync();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    if (widget.controller?._state == this) widget.controller?._state = null;
    _highlightTimer?.cancel();
    _batchTimer?.cancel();
    final controller = _controller;
    controller.removeListener(_onControllerValue);
    unawaited(_queue.then((_) => controller.dispose()).catchError((Object _) {}));
    super.dispose();
  }

  // Controller management -----------------------------------------------------

  void _resolveFormats() {
    _requested = _options.resolvedSymbologies;
    _formats = qrgenMobileScannerFormats(_requested);
  }

  bool get _wantsEveryFrame => _options.mode == QRGenScanMode.batch || _options.duplicateFilter == 0;

  String _configKey() =>
      '${_formats.map((f) => f.name).join(',')}|${_wantsEveryFrame ? 'all' : 'normal'}|${_options.camera.name}';

  ms.MobileScannerController _createController() {
    _controllerConfig = _configKey();
    final controller = ms.MobileScannerController(
      autoStart: false,
      facing: _options.camera == QRGenCameraFacing.front ? ms.CameraFacing.front : ms.CameraFacing.back,
      detectionSpeed: _wantsEveryFrame ? ms.DetectionSpeed.unrestricted : ms.DetectionSpeed.normal,
      formats: _formats.isEmpty ? const [ms.BarcodeFormat.qrCode] : _formats,
      torchEnabled: _torchOverride ?? _options.torch,
    );
    controller.addListener(_onControllerValue);
    return controller;
  }

  void _replaceController() {
    final old = _controller;
    old.removeListener(_onControllerValue);
    _controller = _createController();
    _readyReported = false;
    _clearHighlights(rebuild: false);
    if (_formats.isEmpty) _reportUnsupported();
    _enqueue(() async {
      try {
        await old.stop();
      } catch (_) {
        // Already stopped or never started.
      }
      await old.dispose();
    });
    // didUpdateWidget is followed by a build; start once the new MobileScanner widget is attached.
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  bool get _shouldRun =>
      !_disposed && widget.isActive && _appActive && _visible && !_userStopped && !_singleDone && _formats.isNotEmpty;

  void _enqueue(Future<void> Function() action) {
    _queue = _queue.then((_) => action()).catchError((Object error) {
      if (error is ms.MobileScannerException) {
        _reportScannerException(error);
      } else if (!_disposed) {
        _emitError(QRGenError(QRGenErrorCode.unknown, error.toString()));
      }
    });
  }

  /// Starts or stops the camera to match the current state.
  void _sync() {
    if (_disposed) return;
    _enqueue(() async {
      if (_disposed) return;
      final controller = _controller;
      if (_shouldRun) {
        await controller.start();
        await _applyTorch();
      } else {
        await controller.stop();
      }
    });
    _updateBatchTimer();
  }

  Future<void> _applyTorch() async {
    if (_disposed) return;
    final want = _torchOverride ?? _options.torch;
    final state = _controller.value.torchState.name;
    if (!_controller.value.isRunning) return;
    if (state == 'unavailable') {
      if (want) _emitError(QRGenError(QRGenErrorCode.unsupported, 'This camera has no torch.'));
      return;
    }
    final on = state == 'on';
    if (on != want) await _controller.toggleTorch();
  }

  void _onControllerValue() {
    if (_disposed) return;
    final value = _controller.value;
    final error = value.error;
    if (error != null && !identical(error, _lastReportedScannerError)) {
      _lastReportedScannerError = error;
      _reportScannerException(error);
    }
    if (value.isRunning && error == null) {
      if (_error != null) setState(() => _error = null);
      if (!_readyReported) {
        _readyReported = true;
        widget.onReady?.call();
      }
    }
  }

  void _reportScannerException(ms.MobileScannerException error) {
    final code = errorCodeFromMobileScanner(error.errorCode.name);
    final details = error.errorDetails?.message;
    _emitError(QRGenError(code, details == null || details.isEmpty ? null : details));
  }

  void _reportUnsupported() {
    final ids = _requested.map((s) => s.id).join(', ');
    _emitError(
      QRGenError(
        QRGenErrorCode.unsupported,
        'None of the requested symbologies (${ids.isEmpty ? 'none' : ids}) can be read by mobile_scanner on this platform.',
      ),
    );
  }

  /// Reports an error. Deferred to a microtask so it is safe to call from
  /// lifecycle methods that run during a build.
  void _emitError(QRGenError error) {
    scheduleMicrotask(() {
      if (_disposed || !mounted) return;
      setState(() => _error = error);
      widget.onError?.call(error);
    });
  }

  // Imperative API ------------------------------------------------------------

  Future<void> _userStart() async {
    _userStopped = false;
    _singleDone = false;
    _paused = false;
    _session.resume();
    _sync();
    await _queue;
  }

  Future<void> _userStop() async {
    _userStopped = true;
    _sync();
    await _queue;
  }

  Future<void> _reset() async {
    _session.reset();
    _clearHighlights();
    await _userStart();
  }

  Future<void> _setTorch(bool on) async {
    _torchOverride = on;
    _enqueue(_applyTorch);
    await _queue;
  }

  Future<void> _switchCamera() async {
    _enqueue(() async {
      if (_controller.value.isRunning) await _controller.switchCamera();
    });
    await _queue;
  }

  // Detection -----------------------------------------------------------------

  void _onDetect(ms.BarcodeCapture capture) {
    if (_disposed || !mounted || _paused || !_shouldRun) return;
    final now = DateTime.now();
    final captureSize = capture.size;
    final frame = captureSize.isEmpty ? _controller.value.size : captureSize;
    final detected = [
      for (final b in capture.barcodes)
        QRGenDetectedCode(
          formatName: b.format.name,
          rawValue: b.rawValue,
          // Deprecated in mobile_scanner 7 in favor of rawDecodedBytes, which 5 and 6 lack.
          // ignore: deprecated_member_use
          rawBytes: b.rawBytes,
          corners: [for (final c in b.corners) QRGenPoint(c.dx, c.dy)],
        ),
    ];
    final converted = convertDetectedCodes(
      detected,
      frameSize: QRGenSize(frame.width, frame.height),
      viewSize: _viewSize,
      requested: _requested,
      timestamp: now,
    );
    final barcodes = selectBarcodes(converted, scanArea: _options.scanArea, maxResults: _options.effectiveMaxResults);
    final result = _session.process(barcodes, now);

    if (_options.mode == QRGenScanMode.batch) {
      final tracked = result.tracked;
      if (tracked != null) _showHighlights(tracked, linger: false);
    } else if (barcodes.isNotEmpty) {
      _showHighlights(barcodes, linger: true);
    }

    if (result.scanned.isNotEmpty) {
      _feedback();
      if (widget.showToast) {
        setState(() => _toast = QRGenToastData(++_toastId, _toastText(result.scanned)));
      }
      widget.onScan?.call(result.scanned);
    }
    final tracked = result.tracked;
    if (tracked != null) widget.onTrack?.call(tracked);
    if (result.stop) {
      _singleDone = true;
      _sync();
    }
  }

  void _feedback() {
    if (_options.beep) {
      final beep = widget.onBeep;
      if (beep != null) {
        beep();
      } else {
        unawaited(SystemSound.play(SystemSoundType.click));
      }
    }
    if (_options.vibrate) unawaited(HapticFeedback.mediumImpact());
  }

  static String _toastText(List<QRGenBarcode> scanned) {
    if (scanned.length > 1) return '${scanned.length} codes scanned';
    final b = scanned.first;
    final text = b.data.replaceAll(RegExp(r'\s+'), ' ').trim();
    final short = text.length > 48 ? '${text.substring(0, 47)}…' : text;
    return '${b.symbologyName} · $short';
  }

  void _updateBatchTimer() {
    final want = _options.mode == QRGenScanMode.batch && _shouldRun;
    if (want && _batchTimer == null) {
      _batchTimer = Timer.periodic(_batchTick, (_) {
        if (_disposed || !mounted) return;
        final tracked = _session.tick();
        if (tracked != null) {
          _showHighlights(tracked, linger: false);
          widget.onTrack?.call(tracked);
        }
      });
    } else if (!want && _batchTimer != null) {
      _batchTimer!.cancel();
      _batchTimer = null;
    }
  }

  // Overlay -------------------------------------------------------------------

  void _showHighlights(List<QRGenBarcode> barcodes, {required bool linger}) {
    if (!widget.showHighlights || !mounted) return;
    final view = _viewSize;
    if (view == null) return;
    final polygons = <List<Offset>>[];
    for (final b in barcodes) {
      if (b.frameSize.isEmpty || b.location == QRGenQuadrilateral.zero) continue;
      final t = QRGenFrameTransform(b.frameSize, view);
      final q = t.applyToQuadrilateral(b.location);
      polygons.add([for (final p in q.points) Offset(p.x, p.y)]);
    }
    setState(() => _highlights = polygons);
    _highlightTimer?.cancel();
    _highlightTimer = null;
    if (linger && polygons.isNotEmpty) {
      _highlightTimer = Timer(_highlightLinger, () {
        if (mounted) setState(() => _highlights = const []);
      });
    }
  }

  void _clearHighlights({bool rebuild = true}) {
    _highlightTimer?.cancel();
    _highlightTimer = null;
    if (_highlights.isEmpty) return;
    if (rebuild && mounted) {
      setState(() => _highlights = const []);
    } else {
      _highlights = const [];
    }
  }

  Rect? _viewfinderRect(QRGenSize view) {
    final style = _options.effectiveViewfinder;
    if (style == QRGenViewfinder.none) return null;
    final area = _options.scanArea;
    final QRGenRect rect;
    if (area != null) {
      final size = _controller.value.size;
      final frame = uprightFrameSize(QRGenSize(size.width, size.height), view);
      if (frame.isEmpty) {
        rect = QRGenRect(area.x * view.width, area.y * view.height, area.width * view.width, area.height * view.height);
      } else {
        final t = QRGenFrameTransform(frame, view);
        rect = t
            .applyToQuadrilateral(
              QRGenQuadrilateral.fromRect(
                QRGenRect(area.x * frame.width, area.y * frame.height, area.width * frame.width, area.height * frame.height),
              ),
            )
            .bounds;
      }
    } else {
      rect = defaultViewfinderRect(view, line: style == QRGenViewfinder.line);
    }
    return Rect.fromLTWH(rect.x, rect.y, rect.width, rect.height);
  }

  Widget _buildError(BuildContext context, QRGenError error) {
    final builder = widget.errorBuilder;
    if (builder != null) return builder(context, error);
    return ColoredBox(
      color: const Color(0xFF0B0F14),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            error.message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFE5E7EB), fontSize: 15),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!constraints.hasBoundedWidth || !constraints.hasBoundedHeight) {
          throw FlutterError(
            'QRGenScanner was given unbounded constraints.\n'
            'Give it a size, for example with Expanded, SizedBox or AspectRatio.',
          );
        }
        final view = QRGenSize(constraints.maxWidth, constraints.maxHeight);
        _viewSize = view;
        final error = _error;
        final showError = error != null &&
            (error.code == QRGenErrorCode.cameraPermissionDenied ||
                error.code == QRGenErrorCode.cameraNotFound ||
                (error.code == QRGenErrorCode.unsupported && _formats.isEmpty) ||
                !_controller.value.isRunning);
        return ClipRect(
          child: Stack(
            fit: StackFit.expand,
            children: [
              const ColoredBox(color: Colors.black),
              if (_formats.isNotEmpty)
                ms.MobileScanner(
                  key: ObjectKey(_controller),
                  controller: _controller,
                  onDetect: _onDetect,
                  fit: BoxFit.cover,
                ),
              if (showError)
                _buildError(context, error)
              else
                ValueListenableBuilder<ms.MobileScannerState>(
                  valueListenable: _controller,
                  builder: (context, state, _) => QRGenScannerOverlay(
                    viewfinder: _options.effectiveViewfinder,
                    viewfinderRect: _viewfinderRect(view),
                    accentColor: widget.accentColor,
                    highlights: _highlights,
                    toast: _toast,
                  ),
                ),
              if (widget.child != null) widget.child!,
            ],
          ),
        );
      },
    );
  }
}
