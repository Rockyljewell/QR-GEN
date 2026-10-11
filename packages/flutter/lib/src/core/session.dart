// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Scan session state machine: mode, duplicate filter and tracker. Pure Dart.
library;

import 'barcode.dart';
import 'duplicate_filter.dart';
import 'options.dart';
import 'spatial_association.dart';
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
    bool spatialTracking = false,
    double trackMaxJump = 3,
    int trackMaxAssociationWork = 250000,
  })  : _mode = mode,
        _filter = QRGenDuplicateFilter(duplicateFilter),
        _tracker = QRGenBarcodeTracker(
          timeout: trackingTimeout,
          spatial: spatialTracking,
          maxJump: trackMaxJump,
          maxAssociationWork: trackMaxAssociationWork,
        );

  static const int _maxSafeInteger = 9007199254740991;
  QRGenScanMode _mode;
  final QRGenDuplicateFilter _filter;
  QRGenBarcodeTracker _tracker;
  bool _stopped = false;
  int _policyGeneration = 0;
  Object _revision = Object();

  /// Current mode.
  QRGenScanMode get mode => _mode;

  /// `true` after a single-mode scan, until [resume] or [reset].
  bool get stopped => _stopped;

  /// Whether equal-payload batch observations are separated by position.
  bool get spatialTracking => _tracker.spatial;

  /// Maximum movement relative to each current detection's extent.
  double get trackMaxJump => _tracker.maxJump;

  /// Maximum summed association work for one spatial frame.
  int get trackMaxAssociationWork => _tracker.maxAssociationWork;

  /// Every tracked code (batch mode).
  List<QRGenTrackedBarcode> get tracked => _publicTracks(_tracker.tracked);

  /// Applies settings atomically. A changed tracking policy clears observations
  /// and preserves duplicate history. Changing mode also resumes scanning.
  /// The construction-time tracking timeout stays unchanged.
  void configure({
    QRGenScanMode? mode,
    int? duplicateFilter,
    bool? spatialTracking,
    double? trackMaxJump,
    int? trackMaxAssociationWork,
  }) {
    final spatial = spatialTracking ?? this.spatialTracking;
    final maxJump = trackMaxJump ?? this.trackMaxJump;
    final maxWork = trackMaxAssociationWork ?? this.trackMaxAssociationWork;
    final replaced = spatial != this.spatialTracking || maxJump != this.trackMaxJump || maxWork != this.trackMaxAssociationWork;
    QRGenBarcodeTracker? candidate;
    if (replaced) {
      candidate = QRGenBarcodeTracker(timeout: _tracker.timeout, spatial: spatial, maxJump: maxJump, maxAssociationWork: maxWork);
      if (_policyGeneration >= _maxSafeInteger) throw RangeError('Spatial policy generation range exhausted.');
    }
    final modeChanged = mode != null && mode != _mode;
    final filterChanged = duplicateFilter != null && (duplicateFilter < 0 ? -1 : duplicateFilter) != _filter.window;
    final revision = replaced || modeChanged || filterChanged ? Object() : _revision;
    // Policy validation finishes before any history, mode or stopped state changes.
    if (duplicateFilter != null) _filter.window = duplicateFilter;
    if (candidate != null) {
      _tracker = candidate;
      _policyGeneration++;
    }
    if (mode != null && mode != _mode) {
      _mode = mode;
      if (!replaced) _tracker.reset();
      _stopped = false;
    }
    _revision = revision;
  }

  /// Feeds the codes decoded in one frame. Spatial batch observations require
  /// valid full-frame dimensions on each record. Optional [frameSize] also
  /// detects coordinate changes on empty frames. Other modes ignore it.
  /// A rejected spatial frame changes neither reports nor observations.
  QRGenScanSessionResult process(List<QRGenBarcode> barcodes, [DateTime? now, QRGenSize? frameSize]) {
    if (_stopped) return QRGenScanSessionResult.empty;
    switch (_mode) {
      case QRGenScanMode.single:
        final scanned = _filter.filter(barcodes, now);
        if (scanned.isEmpty) return QRGenScanSessionResult.empty;
        _stopped = true;
        return QRGenScanSessionResult(scanned: scanned, stop: true);
      case QRGenScanMode.batch:
        if (spatialTracking) return _processSpatial(barcodes, now, frameSize);
        final update = _tracker.update(barcodes, now);
        final scanned = _filter.filter(barcodes, now);
        return QRGenScanSessionResult(scanned: scanned, tracked: update.changed ? update.tracked : null);
      case QRGenScanMode.continuous:
        return QRGenScanSessionResult(scanned: _filter.filter(barcodes, now));
    }
  }

  /// Batch mode housekeeping: drops codes unseen for longer than the tracking
  /// timeout. Returns the tracked list when it changed, else `null`.
  List<QRGenTrackedBarcode>? tick([DateTime? now]) {
    if (_mode != QRGenScanMode.batch) return null;
    if (spatialTracking) {
      final previousRevision = _revision;
      final revision = Object();
      final plan = _tracker.preparePrune(now);
      final result = plan.result.changed ? _publicTracks(plan.result.tracked) : null;
      _validateRevision(previousRevision);
      plan.commit();
      _revision = revision;
      return result;
    }
    final update = _tracker.prune(now);
    return update.changed ? update.tracked : null;
  }

  /// Clears spatial observations while retaining payload duplicate history.
  /// Returns an empty-list change once when something was cleared.
  List<QRGenTrackedBarcode>? resetSpatial() {
    if (!spatialTracking) return null;
    final revision = Object();
    final changed = _tracker.length > 0;
    _tracker.reset();
    _revision = revision;
    return changed ? const [] : null;
  }

  /// Continues after a single-mode scan; duplicate history is kept.
  void resume() {
    if (!_stopped) return;
    final revision = Object();
    _stopped = false;
    _revision = revision;
  }

  /// Starts a new session: clears duplicate history and tracked codes.
  void reset() {
    final revision = Object();
    _filter.reset();
    _tracker.reset();
    _stopped = false;
    _revision = revision;
  }

  QRGenScanSessionResult _processSpatial(List<QRGenBarcode> barcodes, DateTime? now, QRGenSize? frameSize) {
    final previousRevision = _revision;
    final revision = Object();
    final activeTracker = _tracker;
    // Materialize caller iteration/getters before either helper prepares state.
    final canonical = barcodes.map(snapshotQRGenBarcode).toList(growable: false);
    _validateRevision(previousRevision);
    final filter = _filter.prepareFilter(canonical, now);
    final tracker = activeTracker.prepareUpdate(canonical, now, frameSize);
    final result = QRGenScanSessionResult(
      scanned: filter.scanned,
      tracked: tracker.result.changed ? _publicTracks(tracker.result.tracked) : null,
    );
    // All namespace copies, caller reads, clocks and allocations are complete.
    // No user callback can intervene between these assignment-only commits.
    _validateRevision(previousRevision);
    filter.validateCurrent();
    tracker.validateCurrent();
    tracker.commit();
    filter.commit();
    _revision = revision;
    return result;
  }

  void _validateRevision(Object revision) {
    if (!identical(_revision, revision)) throw StateError('Obsolete spatial session operation.');
  }

  List<QRGenTrackedBarcode> _publicTracks(List<QRGenTrackedBarcode> tracks) {
    if (!spatialTracking) return tracks;
    return List.unmodifiable([
      for (final track in tracks)
        QRGenTrackedBarcode.fromBarcode(
          track,
          id: 'spatial-$_policyGeneration:${track.id}',
          firstSeen: track.firstSeen,
          lastSeen: track.lastSeen,
          count: track.count,
        ),
    ]);
  }
}
