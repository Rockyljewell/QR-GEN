// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Internal prepared tracker transaction; not exported by the package barrel.
library;

import 'tracker.dart';

/// Complete tracker output plus a guarded deferred state commit.
final class QRGenTrackerPlan {
  /// Creates an internal plan after all fallible tracker work is complete.
  QRGenTrackerPlan(this.result, {required void Function() validateCurrent, required void Function() commit})
    : _validateCurrent = validateCurrent,
      _commit = commit;

  /// The complete output available before either session helper commits.
  final QRGenTrackerUpdate result;
  final void Function() _validateCurrent;
  final void Function() _commit;

  /// Rejects a stale or already committed plan without changing state.
  void validateCurrent() => _validateCurrent();

  /// Applies the plan once, provided its tracker has not changed.
  void commit() => _commit();
}
