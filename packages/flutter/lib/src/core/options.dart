/// Shared scanner options (SPEC section 4). Pure Dart.
library;

import 'symbology.dart';

/// Scan mode.
enum QRGenScanMode {
  /// Stop after the first scan.
  single,

  /// Keep scanning; the duplicate filter suppresses repeats.
  continuous,

  /// Track many codes at once (`onTrack`).
  batch,
}

/// Overlay style.
enum QRGenViewfinder {
  /// Rounded corner brackets.
  frame,

  /// A horizontal scan line (default for linear-only symbology sets).
  line,

  /// No viewfinder.
  none,
}

/// Camera selection.
enum QRGenCameraFacing {
  /// The back (world-facing) camera.
  back,

  /// The front (selfie) camera.
  front,
}

/// Region of interest, normalized `0..1` relative to the camera frame.
final class QRGenScanArea {
  /// Creates a scan area.
  const QRGenScanArea({required this.x, required this.y, required this.width, required this.height});

  /// Left edge (0..1).
  final double x;

  /// Top edge (0..1).
  final double y;

  /// Width (0..1).
  final double width;

  /// Height (0..1).
  final double height;

  /// `x,y,width,height`, as used in the embed query string.
  String toQueryValue() => [x, y, width, height].map(_fmt).join(',');

  @override
  bool operator ==(Object other) =>
      other is QRGenScanArea && other.x == x && other.y == y && other.width == width && other.height == height;

  @override
  int get hashCode => Object.hash(x, y, width, height);
}

String _fmt(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

/// Scanner options with SPEC defaults.
class QRGenScannerOptions {
  /// Creates options. Every value defaults to the SPEC default.
  const QRGenScannerOptions({
    this.symbologies = const ['all'],
    this.mode = QRGenScanMode.continuous,
    this.duplicateFilter = 1000,
    this.beep = true,
    this.vibrate = true,
    this.camera = QRGenCameraFacing.back,
    this.torch = false,
    this.viewfinder,
    this.scanArea,
    this.maxResults,
  });

  /// Ids, aliases or groups from SPEC section 1.
  final List<String> symbologies;

  /// Scan mode.
  final QRGenScanMode mode;

  /// Duplicate window in ms. `0` reports every frame, `-1` once per session.
  final int duplicateFilter;

  /// Play a short tone on scan.
  final bool beep;

  /// Haptic feedback on scan.
  final bool vibrate;

  /// Camera selection.
  final QRGenCameraFacing camera;

  /// Flashlight.
  final bool torch;

  /// Overlay style; `null` means [effectiveViewfinder] picks one.
  final QRGenViewfinder? viewfinder;

  /// Region of interest; `null` means the full frame.
  final QRGenScanArea? scanArea;

  /// Codes reported per frame; `null` means [effectiveMaxResults].
  final int? maxResults;

  /// [symbologies] expanded to concrete symbologies.
  List<QRGenSymbology> get resolvedSymbologies => resolveSymbologies(symbologies);

  /// `frame`, or `line` for linear-only symbology sets, unless [viewfinder] is set.
  QRGenViewfinder get effectiveViewfinder =>
      viewfinder ?? (isLinearOnly(resolvedSymbologies) ? QRGenViewfinder.line : QRGenViewfinder.frame);

  /// `1`, or `20` in batch mode, unless [maxResults] is set.
  int get effectiveMaxResults => maxResults ?? (mode == QRGenScanMode.batch ? 20 : 1);

  /// A copy with the given fields replaced.
  QRGenScannerOptions copyWith({
    List<String>? symbologies,
    QRGenScanMode? mode,
    int? duplicateFilter,
    bool? beep,
    bool? vibrate,
    QRGenCameraFacing? camera,
    bool? torch,
    QRGenViewfinder? viewfinder,
    QRGenScanArea? scanArea,
    int? maxResults,
  }) =>
      QRGenScannerOptions(
        symbologies: symbologies ?? this.symbologies,
        mode: mode ?? this.mode,
        duplicateFilter: duplicateFilter ?? this.duplicateFilter,
        beep: beep ?? this.beep,
        vibrate: vibrate ?? this.vibrate,
        camera: camera ?? this.camera,
        torch: torch ?? this.torch,
        viewfinder: viewfinder ?? this.viewfinder,
        scanArea: scanArea ?? this.scanArea,
        maxResults: maxResults ?? this.maxResults,
      );

  /// The options as embed query parameters (SPEC section 5): lists are
  /// comma-separated, booleans `1`/`0`. `viewfinder`, `scanArea` and
  /// `maxResults` are only written when set.
  Map<String, String> toQueryParameters() {
    final list = symbologies.map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    return {
      if (list.isNotEmpty) 'symbologies': list.join(','),
      'mode': mode.name,
      'duplicateFilter': duplicateFilter.toString(),
      'beep': beep ? '1' : '0',
      'vibrate': vibrate ? '1' : '0',
      'camera': camera.name,
      'torch': torch ? '1' : '0',
      if (viewfinder != null) 'viewfinder': viewfinder!.name,
      if (scanArea != null) 'scanArea': scanArea!.toQueryValue(),
      if (maxResults != null) 'maxResults': maxResults.toString(),
    };
  }

  @override
  bool operator ==(Object other) =>
      other is QRGenScannerOptions &&
      _listEquals(other.symbologies, symbologies) &&
      other.mode == mode &&
      other.duplicateFilter == duplicateFilter &&
      other.beep == beep &&
      other.vibrate == vibrate &&
      other.camera == camera &&
      other.torch == torch &&
      other.viewfinder == viewfinder &&
      other.scanArea == scanArea &&
      other.maxResults == maxResults;

  @override
  int get hashCode => Object.hash(
        Object.hashAll(symbologies),
        mode,
        duplicateFilter,
        beep,
        vibrate,
        camera,
        torch,
        viewfinder,
        scanArea,
        maxResults,
      );
}

bool _listEquals(List<String> a, List<String> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
