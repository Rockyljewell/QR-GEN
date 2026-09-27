/// Duplicate filter (SPEC section 4, `duplicateFilter`). Pure Dart.
library;

import 'barcode.dart';

/// Suppresses repeated reports of the same symbology + data.
///
/// - `window > 0` ms: a code is reported, then ignored until `window` ms
///   have passed since it was last reported.
/// - `window == 0`: every sighting is reported (every frame).
/// - `window < 0` (use `-1`): each code is reported once per session, until
///   [reset] is called.
class QRGenDuplicateFilter {
  /// Creates a filter with a window in milliseconds.
  QRGenDuplicateFilter([int window = 1000]) : _window = window < 0 ? -1 : window;

  static const int _cleanupThreshold = 256;

  final Map<String, DateTime> _lastReported = {};
  int _window;

  /// The window in ms (`-1` means once per session).
  int get window => _window;

  /// Changes the window; history is kept.
  set window(int value) => _window = value < 0 ? -1 : value;

  /// Number of codes remembered.
  int get length => _lastReported.length;

  /// Returns `true` when the code with [key] should be reported at [now], and
  /// records it. Use [QRGenBarcode.key] for barcodes.
  bool acceptKey(String key, DateTime now) {
    if (_window == 0) return true;
    final last = _lastReported[key];
    if (last != null && (_window < 0 || now.difference(last).inMilliseconds < _window)) return false;
    _lastReported[key] = now;
    if (_window > 0 && _lastReported.length > _cleanupThreshold) _cleanup(now);
    return true;
  }

  /// Returns `true` when [barcode] should be reported, and records it.
  bool accept(QRGenBarcode barcode, [DateTime? now]) => acceptKey(barcode.key, now ?? DateTime.now());

  /// The barcodes that are not duplicates, in order; records them.
  List<T> filter<T extends QRGenBarcode>(Iterable<T> barcodes, [DateTime? now]) {
    final time = now ?? DateTime.now();
    return barcodes.where((b) => acceptKey(b.key, time)).toList();
  }

  /// Forgets every code (starts a new session).
  void reset() => _lastReported.clear();

  void _cleanup(DateTime now) =>
      _lastReported.removeWhere((_, time) => now.difference(time).inMilliseconds >= _window);
}
