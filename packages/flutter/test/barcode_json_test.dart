// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'dart:convert';

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/error.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:test/test.dart';

/// The SPEC section 2 example.
const _specJson = '''
{
  "data": "https://example.com",
  "symbology": "qr",
  "symbologyName": "QR Code",
  "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
  "contentType": "text",
  "isGS1": false,
  "location": {
    "topLeft": { "x": 10, "y": 10 },
    "topRight": { "x": 90, "y": 10 },
    "bottomRight": { "x": 90, "y": 90 },
    "bottomLeft": { "x": 10, "y": 90 }
  },
  "frameSize": { "width": 1280, "height": 720 },
  "orientation": 0,
  "ecLevel": "M",
  "symbologyIdentifier": "]Q1",
  "timestamp": 1735689600000
}
''';

void main() {
  group('QRGenBarcode JSON', () {
    test('reads the SPEC example', () {
      final b = QRGenBarcode.fromJson((jsonDecode(_specJson) as Map).cast<String, Object?>());
      expect(b.data, 'https://example.com');
      expect(b.symbology, QRGenSymbology.qr);
      expect(b.symbologyName, 'QR Code');
      expect(utf8.decode(base64Decode(b.rawBytes)), 'https://example.com');
      expect(b.contentType, QRGenContentType.text);
      expect(b.isGS1, isFalse);
      expect(b.location.topRight, const QRGenPoint(90, 10));
      expect(b.frameSize, const QRGenSize(1280, 720));
      expect(b.ecLevel, 'M');
      expect(b.symbologyIdentifier, ']Q1');
      expect(b.timestamp.millisecondsSinceEpoch, 1735689600000);
    });

    test('round-trips to identical JSON', () {
      final input = jsonDecode(_specJson) as Map<String, Object?>;
      final output = QRGenBarcode.fromJson(input).toJson();
      expect(jsonDecode(jsonEncode(output)), input);
    });

    test('fills defaults and resolves aliases', () {
      final b = QRGenBarcode.fromJson({'data': '4006381333931', 'symbology': 'EAN-13', 'timestamp': 5});
      expect(b.symbology, QRGenSymbology.ean13);
      expect(b.symbologyName, 'EAN-13');
      expect(b.rawBytes, '');
      expect(b.contentType, QRGenContentType.text);
      expect(b.location, QRGenQuadrilateral.zero);
      expect(b.frameSize.isEmpty, isTrue);
      expect(b.orientation, 0);
      expect(b.timestamp, DateTime.fromMillisecondsSinceEpoch(5));
    });

    test('derives isGS1 from contentType and keeps unknown content types as text', () {
      expect(QRGenBarcode.fromJson({'data': '(01)1', 'symbology': 'code128', 'contentType': 'gs1'}).isGS1, isTrue);
      expect(QRGenBarcode.fromJson({'data': 'x', 'symbology': 'qr', 'contentType': 'weird'}).contentType, QRGenContentType.text);
    });

    test('rejects invalid input', () {
      expect(() => QRGenBarcode.fromJson({'symbology': 'qr'}), throwsFormatException);
      expect(() => QRGenBarcode.fromJson({'data': 'x'}), throwsFormatException);
      expect(() => QRGenBarcode.fromJson({'data': 'x', 'symbology': 'nope'}), throwsFormatException);
      expect(QRGenBarcode.tryFromJson('x'), isNull);
      expect(QRGenBarcode.tryFromJson({'data': 1, 'symbology': 'qr'}), isNull);
    });

    test('keeps fractional coordinates', () {
      final b = QRGenBarcode(data: 'x', symbology: QRGenSymbology.qr, location: QRGenQuadrilateral.fromRect(const QRGenRect(1.5, 2, 3, 4)));
      final json = b.toJson();
      expect((json['location'] as Map)['topLeft'], {'x': 1.5, 'y': 2});
      expect(QRGenBarcode.fromJson(jsonDecode(jsonEncode(json)) as Map<String, Object?>).location, b.location);
    });
  });

  group('QRGenTrackedBarcode JSON', () {
    test('round-trips', () {
      final input = {
        ...(jsonDecode(_specJson) as Map<String, Object?>),
        'id': 'qr-12345678',
        'firstSeen': 1735689600000,
        'lastSeen': 1735689600500,
        'count': 4,
      };
      final t = QRGenTrackedBarcode.fromJson(input);
      expect(t.id, 'qr-12345678');
      expect(t.count, 4);
      expect(t.lastSeen.difference(t.firstSeen), const Duration(milliseconds: 500));
      expect(jsonDecode(jsonEncode(t.toJson())), input);
    });

    test('accepts numeric ids and fills defaults', () {
      final t = QRGenTrackedBarcode.fromJson({'data': 'a', 'symbology': 'qr', 'id': 7, 'timestamp': 10});
      expect(t.id, '7');
      expect(t.count, 1);
      expect(t.firstSeen, DateTime.fromMillisecondsSinceEpoch(10));
      expect(QRGenTrackedBarcode.fromJson({'data': 'a', 'symbology': 'qr'}).id, 'qr:a');
    });
  });

  group('geometry models', () {
    test('quadrilateral helpers', () {
      final q = QRGenQuadrilateral.fromRect(const QRGenRect(10, 20, 30, 40));
      expect(q.center, const QRGenPoint(25, 40));
      expect(q.bounds, const QRGenRect(10, 20, 30, 40));
      expect(q.points.length, 4);
      expect(const QRGenSize(3, 4).flipped, const QRGenSize(4, 3));
    });
  });

  group('QRGenError', () {
    test('JSON and codes', () {
      final e = QRGenError.fromJson({'code': 'camera-in-use', 'message': 'busy'});
      expect(e.code, QRGenErrorCode.cameraInUse);
      expect(e.toJson(), {'code': 'camera-in-use', 'message': 'busy'});
      expect(QRGenError.fromJson({'code': 'strange'}).code, QRGenErrorCode.unknown);
      expect(QRGenError(QRGenErrorCode.unsupported).message, isNotEmpty);
      expect(QRGenErrorCode.values.map((c) => c.value), [
        'camera-permission-denied',
        'camera-not-found',
        'camera-in-use',
        'insecure-context',
        'engine-load-failed',
        'unsupported',
        'unknown',
      ]);
      expect(errorCodeFromMobileScanner('permissionDenied'), QRGenErrorCode.cameraPermissionDenied);
      expect(errorCodeFromMobileScanner('genericError'), QRGenErrorCode.unknown);
    });
  });
}
