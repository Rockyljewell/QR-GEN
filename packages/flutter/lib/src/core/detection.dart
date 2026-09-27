/// Converts engine detections into SPEC section 2 results. Pure Dart.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'barcode.dart';
import 'geometry.dart';
import 'symbology.dart';

/// An engine-neutral detection, as reported by `mobile_scanner`.
class QRGenDetectedCode {
  /// Creates a detection.
  const QRGenDetectedCode({required this.formatName, this.rawValue, this.rawBytes, this.corners = const []});

  /// The `mobile_scanner` `BarcodeFormat` name, for example `qrCode`.
  final String formatName;

  /// Decoded text, if any.
  final String? rawValue;

  /// Raw payload bytes, if any.
  final Uint8List? rawBytes;

  /// Corner points in pixels of the camera frame.
  final List<QRGenPoint> corners;
}

final RegExp _gtinWithAi = RegExp(r'^01\d{14}$');
final RegExp _gtin = RegExp(r'^\d{14}$');
final RegExp _hriGtin = RegExp(r'^\(01\)\d{14}$');

({String data, QRGenContentType contentType})? _gs1DataBar(QRGenSymbology s, String data) {
  if (s == QRGenSymbology.databar || s == QRGenSymbology.databarLimited) {
    if (_gtinWithAi.hasMatch(data)) return (data: '(01)${data.substring(2)}', contentType: QRGenContentType.gs1);
    if (_gtin.hasMatch(data)) return (data: '(01)$data', contentType: QRGenContentType.gs1);
    if (_hriGtin.hasMatch(data)) return (data: data, contentType: QRGenContentType.gs1);
  }
  if (s == QRGenSymbology.databarExpanded && data.startsWith('(')) {
    return (data: data, contentType: QRGenContentType.gs1);
  }
  return null;
}

/// Converts detections to QRGen barcodes.
///
/// Detections of formats outside [requested], and detections without text or
/// bytes, are dropped. [frameSize] is the camera frame the corners refer to;
/// when [viewSize] is given and its orientation differs from the frame, the
/// frame size is swapped so `location`/`frameSize` describe the upright frame.
/// Codes without text but with bytes are reported with `contentType: binary`
/// and the bytes decoded as Latin-1.
List<QRGenBarcode> convertDetectedCodes(
  Iterable<QRGenDetectedCode> codes, {
  required QRGenSize frameSize,
  required List<QRGenSymbology> requested,
  QRGenSize? viewSize,
  DateTime? timestamp,
}) {
  final upright = uprightFrameSize(frameSize, viewSize);
  final time = timestamp ?? DateTime.now();
  final out = <QRGenBarcode>[];
  for (final code in codes) {
    final bytes = code.rawBytes;
    var value = code.rawValue;
    var contentType = QRGenContentType.text;
    if ((value == null || value.isEmpty) && bytes != null && bytes.isNotEmpty) {
      value = latin1.decode(bytes, allowInvalid: true);
      contentType = QRGenContentType.binary;
    }
    if (value == null || value.isEmpty) continue;
    final mapped = fromMobileScannerFormat(code.formatName, value, requested);
    if (mapped == null) continue;
    var data = mapped.data;
    final gs1 = _gs1DataBar(mapped.symbology, data);
    if (gs1 != null) {
      data = gs1.data;
      contentType = gs1.contentType;
    }
    out.add(
      QRGenBarcode(
        data: data,
        symbology: mapped.symbology,
        rawBytes: bytes == null || bytes.isEmpty ? '' : base64Encode(bytes),
        contentType: contentType,
        location: orderCorners(code.corners),
        frameSize: upright,
        timestamp: time,
      ),
    );
  }
  return out;
}
