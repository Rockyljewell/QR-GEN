// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Duplicate filter (SPEC section 4, `duplicateFilter`). Pure Dart.
library;

import 'barcode.dart';
import 'duplicate_filter_plan.dart';
import 'duration_clock.dart';

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

  Map<String, DateTime> _lastReported = {};
  Map<String, Duration> _reportedElapsed = {};
  final QRGenDurationClock _clock = QRGenDurationClock();
  Object _revision = Object();
  int _window;

  /// The window in ms (`-1` means once per session).
  int get window => _window;

  /// Changes the window; history is kept.
  set window(int value) {
    final next = value < 0 ? -1 : value;
    if (next == _window) return;
    final revision = Object();
    _window = next;
    _revision = revision;
  }

  /// Number of codes remembered.
  int get length => _lastReported.length;

  /// Returns `true` when the code with [key] should be reported at [now], and
  /// records it. Use [QRGenBarcode.key] for barcodes.
  bool acceptKey(String key, DateTime now) => _accept(key, _clock.preview(now));

  /// Returns `true` when [barcode] should be reported, and records it.
  bool accept(QRGenBarcode barcode, [DateTime? now]) => _accept(barcode.key, _clock.preview(now));

  /// The barcodes that are not duplicates, in order; records them.
  List<T> filter<T extends QRGenBarcode>(Iterable<T> barcodes, [DateTime? now]) {
    final revision = Object();
    final sample = _clock.preview(now);
    final observed = _elapsedHistory(sample);
    final pending = <String, DateTime>{};
    final pendingElapsed = <String, Duration>{};
    Map<String, DateTime>? reported;
    Map<String, Duration>? elapsed;
    final result = <T>[];
    for (final barcode in barcodes) {
      final key = barcode.key;
      if (reported == null && _window < 0) {
        if (_lastReported.containsKey(key) || pending.containsKey(key)) continue;
        pending[key] = sample.timestamp;
        pendingElapsed[key] = sample.elapsed;
        result.add(barcode);
      } else if (_window == 0) {
        result.add(barcode);
      } else {
        // Once-per-session histories can be large. Only a positive window
        // needs a complete working map for age-based replacement and cleanup.
        reported ??= Map.of(_lastReported)..addAll(pending);
        elapsed ??= Map.of(observed)..addAll(pendingElapsed);
        if (_acceptAt(key, sample, reported, elapsed)) result.add(barcode);
      }
    }
    // Caller iteration and all DateTime comparisons finish before committing.
    if (reported != null) {
      _lastReported = reported;
      _reportedElapsed = elapsed!;
    } else {
      _lastReported.addAll(pending);
      observed.addAll(pendingElapsed);
      _reportedElapsed = observed;
    }
    _clock.commit(sample);
    _revision = revision;
    return result;
  }

  /// Prepares filtering without recording reports. Used by spatial sessions
  /// to commit payload history and observation tracking together. A later
  /// filter operation, reset or effective window change invalidates the plan.
  QRGenDuplicateFilterPlan<T> prepareFilter<T extends QRGenBarcode>(Iterable<T> barcodes, [DateTime? now]) {
    final previousRevision = _revision;
    final nextRevision = Object();
    final sample = _clock.preview(now);
    final reported = Map.of(_lastReported);
    final observed = Map.of(_elapsedHistory(sample));
    final scanned = <T>[];
    for (final barcode in barcodes) {
      if (_acceptAt(barcode.key, sample, reported, observed)) scanned.add(barcode);
    }
    final result = List<T>.unmodifiable(scanned);
    void validate() {
      if (!identical(_revision, previousRevision)) throw StateError('Obsolete duplicate-filter plan.');
    }

    validate();
    return QRGenDuplicateFilterPlan<T>(
      scanned: result,
      validate: validate,
      commit: () {
        validate();
        // Every allocation, caller read and time comparison finished above.
        _lastReported = reported;
        _reportedElapsed = observed;
        _clock.commit(sample);
        _revision = nextRevision;
      },
    );
  }

  /// Forgets every code (starts a new session).
  void reset() {
    final revision = Object();
    _lastReported.clear();
    _reportedElapsed.clear();
    _clock.reset();
    _revision = revision;
  }

  Map<String, Duration> _elapsedHistory(QRGenDurationSample sample) => sample.changed && !sample.explicit
      ? {for (final entry in _lastReported.entries) entry.key: sample.rebase(entry.value)}
      : _reportedElapsed;

  bool _accept(String key, QRGenDurationSample sample) {
    final revision = Object();
    final observed = _elapsedHistory(sample);
    final accepted = _acceptAt(key, sample, _lastReported, observed);
    _reportedElapsed = observed;
    _clock.commit(sample);
    _revision = revision;
    return accepted;
  }

  bool _acceptAt(String key, QRGenDurationSample sample, Map<String, DateTime> reported, Map<String, Duration> observed) {
    if (_window == 0) return true;
    final last = reported[key];
    if (last != null && (_window < 0 || sample.age(last, observed[key]!).inMilliseconds < _window)) return false;
    final length = reported.length + (last == null ? 1 : 0);
    final stale = _window > 0 && length > _cleanupThreshold
        ? reported.entries
            .where((entry) => entry.key != key && sample.age(entry.value, observed[entry.key]!).inMilliseconds >= _window)
            .map((entry) => entry.key)
            .toList()
        : const <String>[];
    reported[key] = sample.timestamp;
    observed[key] = sample.elapsed;
    for (final old in stale) {
      reported.remove(old);
      observed.remove(old);
    }
    return true;
  }
}
