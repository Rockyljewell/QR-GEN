// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// QRGen for Flutter: barcode, QR and ID scanning.
///
/// - [QRGenScanner]: native performance, built on `mobile_scanner`.
/// - [QRGenWebScanner]: zero native setup, runs the hosted QRGen embed page
///   in `webview_flutter`.
///
/// Both use the QRGen symbology ids, result shape ([QRGenBarcode]) and error
/// codes ([QRGenErrorCode]) of the cross-platform specification.
library;

export 'src/core/barcode.dart';
export 'src/core/bridge.dart';
export 'src/core/detection.dart';
export 'src/core/duplicate_filter.dart';
export 'src/core/error.dart';
export 'src/core/geometry.dart';
export 'src/core/options.dart';
export 'src/core/session.dart';
export 'src/core/symbology.dart';
export 'src/core/tracker.dart';
export 'src/widgets/overlay.dart';
export 'src/widgets/qrgen_scanner.dart';
export 'src/widgets/qrgen_web_scanner.dart';
