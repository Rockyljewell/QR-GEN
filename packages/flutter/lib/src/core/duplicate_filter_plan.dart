// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Internal prepared duplicate-filter transaction; not barrel-exported.
library;

import 'barcode.dart';

/// A completed filter proposal whose histories have not yet changed.
class QRGenDuplicateFilterPlan<T extends QRGenBarcode> {
  /// Creates an internal plan. Callers should use the filter's prepare method.
  QRGenDuplicateFilterPlan({
    required this.scanned,
    required void Function() validate,
    required void Function() commit,
  })  : _validate = validate,
        _commit = commit;

  /// Payload reports in input order, ready before the transaction commits.
  final List<T> scanned;
  final void Function() _validate;
  final void Function() _commit;

  /// Rejects an obsolete or previously committed proposal without mutation.
  void validateCurrent() => _validate();

  /// Installs prepared histories after checking that this proposal is current.
  void commit() => _commit();
}
