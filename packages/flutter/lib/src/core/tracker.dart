// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Batch tracker (SPEC section 4, batch mode). Pure Dart.
library;

import 'barcode.dart';
import 'duration_clock.dart';

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

  /// Codes dropped because they were unseen for longer than the timeout.
  final List<QRGenTrackedBarcode> removed;

  /// Whether anything was seen, added or removed.
  final bool changed;
}

/// Follows codes across frames. Codes are identified by symbology + data, get
/// a stable id derived from [qrgenTrackingId], and are dropped after [timeout] unseen.
class QRGenBarcodeTracker {
  /// Creates a tracker.
  QRGenBarcodeTracker({this.timeout = qrgenDefaultTrackingTimeout});

  /// How long a code may stay unseen before it is dropped.
  final Duration timeout;

  Map<String, QRGenTrackedBarcode> _items = {};
  Set<String> _activeIds = {};
  Map<String, Duration> _observedElapsed = {};
  final QRGenDurationClock _clock = QRGenDurationClock();

  /// Number of tracked codes.
  int get length => _items.length;

  /// Snapshot of every tracked code, oldest first.
  List<QRGenTrackedBarcode> get tracked => List.unmodifiable(_items.values);

  /// Feeds the codes decoded in one frame. Known codes get their location
  /// refreshed and `count` incremented (once per frame), new codes are added
  /// and stale codes removed.
  QRGenTrackerUpdate update(Iterable<QRGenBarcode> barcodes, [DateTime? now]) {
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
      tracked: List.unmodifiable(items.values), added: added, removed: removed, changed: seen.isNotEmpty || removed.isNotEmpty,
    );
    _items = items;
    _activeIds = ids;
    _observedElapsed = observed;
    _clock.commit(sample);
    return result;
  }

  /// Removes stale codes; call it on a timer when no frames with codes arrive.
  QRGenTrackerUpdate prune([DateTime? now]) {
    final sample = _clock.preview(now);
    final items = Map.of(_items);
    final ids = Set.of(_activeIds);
    final observed = _elapsedHistory(sample);
    final removed = _dropStale(sample, items, ids, observed);
    final result = QRGenTrackerUpdate(tracked: List.unmodifiable(items.values), added: const [], removed: removed, changed: removed.isNotEmpty);
    _items = items;
    _activeIds = ids;
    _observedElapsed = observed;
    _clock.commit(sample);
    return result;
  }

  /// Forgets every tracked code.
  void reset() {
    _items.clear();
    _activeIds.clear();
    _observedElapsed.clear();
    _clock.reset();
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
    QRGenDurationSample sample, Map<String, QRGenTrackedBarcode> items, Set<String> activeIds, Map<String, Duration> observed,
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
