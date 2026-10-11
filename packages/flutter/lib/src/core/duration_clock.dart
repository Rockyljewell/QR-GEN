// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Internal duration time, separate from public DateTime metadata.
library;

/// One clock read, planned before a helper changes its history.
class QRGenDurationSample {
  /// Creates an internal sample.
  const QRGenDurationSample({
    required this.timestamp,
    required this.elapsed,
    required this.explicit,
    required this.changed,
  });

  /// Epoch time used for public metadata and injected-clock transitions.
  final DateTime timestamp;

  /// Default elapsed time; unused for explicitly timed age comparisons.
  final Duration elapsed;

  /// Whether the caller supplied a DateTime.
  final bool explicit;

  /// Whether retained elapsed anchors need a new clock source.
  final bool changed;

  /// The retained age, preserving DateTime's full injected-time precision.
  Duration age(DateTime previous, Duration observed) => explicit ? timestamp.difference(previous) : elapsed - observed;

  /// Carries an existing epoch age into the default elapsed clock.
  Duration rebase(DateTime previous) => elapsed - timestamp.difference(previous);
}

/// Internal per-helper clock. This module is not exported by the package barrel.
class QRGenDurationClock {
  final Stopwatch _watch = Stopwatch()..start();
  bool? _explicit;

  /// Reads a clock without committing its source.
  QRGenDurationSample preview([DateTime? now]) {
    final explicit = now != null;
    return QRGenDurationSample(
      timestamp: now ?? DateTime.now(),
      elapsed: explicit ? Duration.zero : _watch.elapsed,
      explicit: explicit,
      changed: _explicit != explicit,
    );
  }

  /// Commits a successfully applied sample.
  void commit(QRGenDurationSample sample) => _explicit = sample.explicit;

  /// Forgets source association after all retained history is cleared.
  void reset() => _explicit = null;
}
