// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Batch tracker (SPEC section 4, batch mode). Pure Dart.
library;

import 'package:meta/meta.dart';

import 'barcode.dart';
import 'duration_clock.dart';
import 'spatial_association.dart';
import 'tracker_plan.dart';

/// Default time after which an unseen code is dropped.
const Duration qrgenDefaultTrackingTimeout = Duration(milliseconds: 500);

/// Deterministic base tracking id for a code: `<symbology>-<fnv1a32(data) as 8 hex digits>`,
/// hashed over the UTF-16 code units of [data]. The same symbology and data
/// always give the same base on platforms using this scheme. Trackers append
/// a suffix on hash collision to keep active IDs unique.
String qrgenTrackingId(String symbologyId, String data) {
  var hash = 0x811c9dc5;
  for (final unit in data.codeUnits) {
    hash ^= unit;
    // hash * 16777619 (FNV prime = 2^24 + 403), kept in 32 bits. Split so it
    // stays exact on the web, where integers are doubles.
    hash = (((hash << 24) & 0xffffffff) + hash * 403) & 0xffffffff;
  }
  return '$symbologyId-${hash.toRadixString(16).padLeft(8, '0')}';
}

/// Result of a tracker update.
class QRGenTrackerUpdate {
  /// Creates an update.
  const QRGenTrackerUpdate({required this.tracked, required this.added, required this.removed, required this.changed});

  /// Every tracked code, oldest first.
  final List<QRGenTrackedBarcode> tracked;

  /// Codes seen for the first time.
  final List<QRGenTrackedBarcode> added;

  /// Codes dropped after the timeout or a spatial coordinate-size change.
  final List<QRGenTrackedBarcode> removed;

  /// Whether anything was seen, added or removed.
  final bool changed;
}

/// Follows codes across frames, dropping them after [timeout] unseen.
/// Default payload mode groups by symbology + data and uses [qrgenTrackingId].
/// Optional spatial mode separates equal-payload observations by gated position,
/// maximizing one-to-one matches before minimizing total center movement.
/// Observations are not confirmed quantities or persistent physical identities.
class QRGenBarcodeTracker {
  /// Creates a tracker.
  QRGenBarcodeTracker({
    this.timeout = qrgenDefaultTrackingTimeout,
    this.spatial = false,
    this.maxJump = 3,
    this.maxAssociationWork = 250000,
  }) {
    if (!maxJump.isFinite || maxJump < 0) throw RangeError('maxJump must be finite and nonnegative');
    if (maxAssociationWork <= 0 || maxAssociationWork > qrgenSpatialMaxInteger) {
      throw RangeError('maxAssociationWork must be a positive safe integer');
    }
  }

  /// How long a code may stay unseen before it is dropped.
  final Duration timeout;

  /// Construction-only opt-in to separate equal-payload spatial observations.
  final bool spatial;

  /// Construction-only center-distance gate relative to each detection's extent.
  final double maxJump;

  /// Construction-only summed assignment-work limit; not a latency guarantee.
  final int maxAssociationWork;

  Map<String, QRGenTrackedBarcode> _items = {};
  Set<String> _activeIds = {};
  Map<String, Duration> _observedElapsed = {};
  final QRGenDurationClock _clock = QRGenDurationClock();
  Object _revision = Object();
  QRGenSize? _spatialFrameSize;
  int _nextSpatialId = 1;

  /// Number of tracked codes.
  int get length => _items.length;

  /// Snapshot of every tracked code, oldest first.
  List<QRGenTrackedBarcode> get tracked => List.unmodifiable(_items.values);

  /// Feeds the codes decoded in one frame. Known codes get their location
  /// refreshed and `count` incremented (once per frame), new codes are added
  /// and stale codes removed.
  /// Spatial input requires usable corners and consistent positive integral
  /// full-frame dimensions. [frameSize] also detects changes on empty frames;
  /// default payload mode ignores it. Invalid or over-budget input consumes no
  /// clock, geometry history or IDs. Work sums n*n*(m+n) across exact-payload
  /// groups with m>0 surviving old observations; new-only groups cost zero.
  QRGenTrackerUpdate update(Iterable<QRGenBarcode> barcodes, [DateTime? now, QRGenSize? frameSize]) {
    final plan = prepareUpdate(barcodes, now, frameSize);
    plan.commit();
    return plan.result;
  }

  /// Internal session transaction: prepares complete output without committing.
  @internal
  QRGenTrackerPlan prepareUpdate(Iterable<QRGenBarcode> barcodes, [DateTime? now, QRGenSize? frameSize]) {
    final revision = _revision;
    if (spatial) return _prepareSpatial(barcodes, now, frameSize, revision);
    final sample = _clock.preview(now);
    final items = Map.of(_items);
    final ids = Set.of(_activeIds);
    final observed = _elapsedHistory(sample);
    final removed = _dropStale(sample, items, ids, observed);
    final added = <QRGenTrackedBarcode>[];
    final seen = <String>{};
    for (final b in barcodes) {
      final key = b.key;
      if (!seen.add(key)) continue;
      final existing = items[key];
      if (existing != null) {
        items[key] = QRGenTrackedBarcode.fromBarcode(
          b,
          id: existing.id,
          firstSeen: existing.firstSeen,
          lastSeen: sample.timestamp,
          count: existing.count + 1,
        );
      } else {
        final item = QRGenTrackedBarcode.fromBarcode(
          b,
          id: _allocateId(qrgenTrackingId(b.symbology.id, b.data), ids),
          firstSeen: sample.timestamp,
          lastSeen: sample.timestamp,
          count: 1,
        );
        items[key] = item;
        added.add(item);
      }
      observed[key] = sample.elapsed;
    }
    final result = QRGenTrackerUpdate(
      tracked: List.unmodifiable(items.values),
      added: added,
      removed: removed,
      changed: seen.isNotEmpty || removed.isNotEmpty,
    );
    return _plan(result, revision, () {
      _items = items;
      _activeIds = ids;
      _observedElapsed = observed;
      _clock.commit(sample);
    });
  }

  /// Removes stale codes; call it on a timer when no frames with codes arrive.
  QRGenTrackerUpdate prune([DateTime? now]) {
    final plan = preparePrune(now);
    plan.commit();
    return plan.result;
  }

  /// Internal session transaction: prepares expiry output without committing.
  @internal
  QRGenTrackerPlan preparePrune([DateTime? now]) {
    final revision = _revision;
    if (spatial) return _prepareSpatial(const [], now, null, revision);
    final sample = _clock.preview(now);
    final items = Map.of(_items);
    final ids = Set.of(_activeIds);
    final observed = _elapsedHistory(sample);
    final removed = _dropStale(sample, items, ids, observed);
    final result = QRGenTrackerUpdate(
      tracked: List.unmodifiable(items.values),
      added: const [],
      removed: removed,
      changed: removed.isNotEmpty,
    );
    return _plan(result, revision, () {
      _items = items;
      _activeIds = ids;
      _observedElapsed = observed;
      _clock.commit(sample);
    });
  }

  /// Forgets every tracked code.
  void reset() {
    _items.clear();
    _activeIds.clear();
    _observedElapsed.clear();
    _spatialFrameSize = null;
    _clock.reset();
    _revision = Object();
  }

  QRGenTrackerPlan _plan(QRGenTrackerUpdate result, Object revision, void Function() apply) {
    final nextRevision = Object();
    void validateCurrent() {
      if (!identical(revision, _revision)) throw StateError('Tracker plan is stale or already committed');
    }

    validateCurrent();
    return QRGenTrackerPlan(
      result,
      validateCurrent: validateCurrent,
      commit: () {
        validateCurrent();
        apply();
        _revision = nextRevision;
      },
    );
  }

  QRGenTrackerPlan _prepareSpatial(
    Iterable<QRGenBarcode> barcodes,
    DateTime? now,
    QRGenSize? frameSize,
    Object revision,
  ) {
    final detections = barcodes.map(snapshotQRGenBarcode).toList(growable: false);
    final size = validateQRGenSpatialFrame(detections, maxJump, frameSize);
    final retained = <QRGenTrackedBarcode>[];
    for (final entry in _items.entries) {
      final track = entry.value;
      final id = track.id;
      final count = track.count;
      final first = track.firstSeen;
      final last = track.lastSeen;
      if (id != entry.key || count <= 0 || count > qrgenSpatialMaxInteger) {
        throw RangeError('Spatial retained identity and count must be valid');
      }
      validateQRGenSpatialTime(first);
      validateQRGenSpatialTime(last);
      retained.add(
        QRGenTrackedBarcode.fromBarcode(
          snapshotQRGenBarcode(track),
          id: id,
          firstSeen: first,
          lastSeen: last,
          count: count,
        ),
      );
    }
    validateQRGenSpatialFrame(retained, maxJump, _spatialFrameSize);
    final sample = _clock.preview(now);
    validateQRGenSpatialTime(sample.timestamp);
    final observed = sample.changed && !sample.explicit
        ? {for (final track in retained) track.id: sample.rebase(track.lastSeen)}
        : Map.of(_observedElapsed);
    final reset = size != null && _spatialFrameSize != null && size != _spatialFrameSize;
    final removed = <QRGenTrackedBarcode>[];
    final previous = <QRGenTrackedBarcode>[];
    for (final track in retained) {
      final anchor = observed[track.id];
      if (anchor == null) throw RangeError('Spatial elapsed history is missing');
      if (reset || sample.age(track.lastSeen, anchor) > timeout) {
        removed.add(track);
        observed.remove(track.id);
      } else {
        previous.add(track);
      }
    }
    validateQRGenSpatialWork(detections, previous, maxAssociationWork);
    final matched = associateQRGenSpatial(detections, previous, maxJump);
    final items = {for (final track in previous) track.id: track};
    final added = <QRGenTrackedBarcode>[];
    var ordinal = _nextSpatialId;
    for (var index = 0; index < detections.length; index++) {
      final barcode = detections[index];
      final old = matched[index];
      final QRGenTrackedBarcode item;
      if (old != null) {
        item = QRGenTrackedBarcode.fromBarcode(
          barcode,
          id: old.id,
          firstSeen: old.firstSeen,
          lastSeen: sample.timestamp,
          count: incrementQRGenSpatialInteger(old.count),
        );
      } else {
        final nextOrdinal = incrementQRGenSpatialInteger(ordinal);
        item = QRGenTrackedBarcode.fromBarcode(
          barcode,
          id: 'spatial-$ordinal',
          firstSeen: sample.timestamp,
          lastSeen: sample.timestamp,
          count: 1,
        );
        ordinal = nextOrdinal;
        added.add(item);
      }
      items[item.id] = item;
      observed[item.id] = sample.elapsed;
    }
    final result = QRGenTrackerUpdate(
      tracked: List.unmodifiable(items.values),
      added: List.unmodifiable(added),
      removed: List.unmodifiable(removed),
      changed: detections.isNotEmpty || removed.isNotEmpty,
    );
    return _plan(result, revision, () {
      _items = items;
      _observedElapsed = observed;
      _nextSpatialId = ordinal;
      if (size != null) _spatialFrameSize = size;
      _clock.commit(sample);
    });
  }

  String _allocateId(String base, Set<String> activeIds) {
    var id = base;
    var suffix = 1;
    while (activeIds.contains(id)) {
      id = '$base-${suffix++}';
    }
    activeIds.add(id);
    return id;
  }

  Map<String, Duration> _elapsedHistory(QRGenDurationSample sample) => sample.changed && !sample.explicit
      ? {for (final entry in _items.entries) entry.key: sample.rebase(entry.value.lastSeen)}
      : Map.of(_observedElapsed);

  List<QRGenTrackedBarcode> _dropStale(
    QRGenDurationSample sample,
    Map<String, QRGenTrackedBarcode> items,
    Set<String> activeIds,
    Map<String, Duration> observed,
  ) {
    final removed = <QRGenTrackedBarcode>[];
    items.removeWhere((key, item) {
      final stale = sample.age(item.lastSeen, observed[key]!) > timeout;
      if (stale) {
        removed.add(item);
        activeIds.remove(item.id);
        observed.remove(key);
      }
      return stale;
    });
    return removed;
  }
}
