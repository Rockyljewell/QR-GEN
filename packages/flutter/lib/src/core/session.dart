// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Scan session state machine: mode, duplicate filter and tracker. Pure Dart.
library;

import 'barcode.dart';
import 'duplicate_filter.dart';
import 'options.dart';
import 'tracker.dart';

/// What a scanner should do after a frame.
class QRGenScanSessionResult {
  /// Creates a result.
  const QRGenScanSessionResult({this.scanned = const [], this.tracked, this.stop = false});

  /// Nothing to report.
  static const QRGenScanSessionResult empty = QRGenScanSessionResult();

  /// Codes to report through `onScan` (already de-duplicated).
  final List<QRGenBarcode> scanned;

  /// Batch mode: the full tracked list when it changed, else `null`.
  final List<QRGenTrackedBarcode>? tracked;

  /// Single mode: `true` when scanning must stop now.
  final bool stop;
}

/// Applies the scan mode, duplicate filter and batch tracker to the codes of
/// each frame, independent of any camera.
class QRGenScanSession {
  /// Creates a session.
  QRGenScanSession({
    QRGenScanMode mode = QRGenScanMode.continuous,
    int duplicateFilter = 1000,
    Duration trackingTimeout = qrgenDefaultTrackingTimeout,
  })  : _mode = mode,
        _filter = QRGenDuplicateFilter(duplicateFilter),
        _tracker = QRGenBarcodeTracker(timeout: trackingTimeout);

  QRGenScanMode _mode;
  final QRGenDuplicateFilter _filter;
  final QRGenBarcodeTracker _tracker;
  bool _stopped = false;

  /// Current mode.
  QRGenScanMode get mode => _mode;

  /// `true` after a single-mode scan, until [resume] or [reset].
  bool get stopped => _stopped;

  /// Every tracked code (batch mode).
  List<QRGenTrackedBarcode> get tracked => _tracker.tracked;

  /// Applies new settings. Changing the mode clears the tracker and resumes.
  void configure({QRGenScanMode? mode, int? duplicateFilter}) {
    if (duplicateFilter != null) _filter.window = duplicateFilter;
    if (mode != null && mode != _mode) {
      _mode = mode;
      _tracker.reset();
      _stopped = false;
    }
  }

  /// Feeds the codes decoded in one frame.
  QRGenScanSessionResult process(List<QRGenBarcode> barcodes, [DateTime? now]) {
    if (_stopped) return QRGenScanSessionResult.empty;
    final time = now ?? DateTime.now();
    switch (_mode) {
      case QRGenScanMode.single:
        final scanned = _filter.filter(barcodes, time);
        if (scanned.isEmpty) return QRGenScanSessionResult.empty;
        _stopped = true;
        return QRGenScanSessionResult(scanned: scanned, stop: true);
      case QRGenScanMode.batch:
        final update = _tracker.update(barcodes, time);
        final scanned = _filter.filter(barcodes, time);
        return QRGenScanSessionResult(scanned: scanned, tracked: update.changed ? update.tracked : null);
      case QRGenScanMode.continuous:
        return QRGenScanSessionResult(scanned: _filter.filter(barcodes, time));
    }
  }

  /// Batch mode housekeeping: drops codes unseen for longer than the tracking
  /// timeout. Returns the tracked list when it changed, else `null`.
  List<QRGenTrackedBarcode>? tick([DateTime? now]) {
    if (_mode != QRGenScanMode.batch) return null;
    final update = _tracker.prune(now);
    return update.changed ? update.tracked : null;
  }

  /// Continues after a single-mode scan; duplicate history is kept.
  void resume() => _stopped = false;

  /// Starts a new session: clears duplicate history and tracked codes.
  void reset() {
    _filter.reset();
    _tracker.reset();
    _stopped = false;
  }
}
