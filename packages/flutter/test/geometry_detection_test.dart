import 'dart:convert';
import 'dart:typed_data';

import 'package:qrgen_flutter/src/core/barcode.dart';
import 'package:qrgen_flutter/src/core/detection.dart';
import 'package:qrgen_flutter/src/core/geometry.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:test/test.dart';

void main() {
  group('frame to view mapping', () {
    test('swaps landscape frames for portrait views', () {
      expect(frameNeedsSwap(const QRGenSize(1920, 1080), const QRGenSize(390, 844)), isTrue);
      expect(frameNeedsSwap(const QRGenSize(1080, 1920), const QRGenSize(390, 844)), isFalse);
      expect(frameNeedsSwap(const QRGenSize(1920, 1080), null), isFalse);
      expect(uprightFrameSize(const QRGenSize(1920, 1080), const QRGenSize(390, 844)), const QRGenSize(1080, 1920));
    });

    test('handles the aspect-fill crop', () {
      final t = QRGenFrameTransform(const QRGenSize(1080, 1920), const QRGenSize(390, 844));
      expect(t.scale, closeTo(844 / 1920, 1e-9));
      expect(t.offsetY, closeTo(0, 1e-9));
      final center = t.apply(const QRGenPoint(540, 960));
      expect(center.x, closeTo(195, 1e-9));
      expect(center.y, closeTo(422, 1e-9));
      expect(t.apply(QRGenPoint.zero).x, lessThan(0));
    });

    test('handles contain', () {
      final t = QRGenFrameTransform(const QRGenSize(1000, 1000), const QRGenSize(400, 800), cover: false);
      expect(t.scale, closeTo(0.4, 1e-9));
      expect(t.offsetY, closeTo(200, 1e-9));
    });

    test('mirrors and keeps corner roles', () {
      final t = QRGenFrameTransform(const QRGenSize(100, 100), const QRGenSize(100, 100), mirrored: true);
      final q = t.applyToQuadrilateral(QRGenQuadrilateral.fromRect(const QRGenRect(10, 20, 30, 40)));
      expect(q.topLeft, const QRGenPoint(60, 20));
      expect(q.topRight, const QRGenPoint(90, 20));
      expect(q.bounds, const QRGenRect(60, 20, 30, 40));
    });

    test('inverts view rectangles', () {
      final t = QRGenFrameTransform(const QRGenSize(1080, 1920), const QRGenSize(390, 844));
      final view = t.applyToQuadrilateral(QRGenQuadrilateral.fromRect(const QRGenRect(100, 200, 300, 400))).bounds;
      final back = t.invertRect(view);
      expect(back.x, closeTo(100, 1e-6));
      expect(back.y, closeTo(200, 1e-6));
      expect(back.width, closeTo(300, 1e-6));
      expect(back.height, closeTo(400, 1e-6));
    });

    test('orders corners clockwise from the top-left', () {
      final q = orderCorners(const [QRGenPoint(90, 90), QRGenPoint(10, 10), QRGenPoint(10, 90), QRGenPoint(90, 10)]);
      expect(q.topLeft, const QRGenPoint(10, 10));
      expect(q.topRight, const QRGenPoint(90, 10));
      expect(q.bottomRight, const QRGenPoint(90, 90));
      expect(q.bottomLeft, const QRGenPoint(10, 90));
      expect(orderCorners(const []), QRGenQuadrilateral.zero);
      expect(orderCorners(const [QRGenPoint(5, 7), QRGenPoint(1, 2)]).bounds, const QRGenRect(1, 2, 4, 5));
    });

    test('default viewfinder rectangles', () {
      final frame = defaultViewfinderRect(const QRGenSize(400, 800));
      expect(frame.width, closeTo(272, 1e-9));
      expect(frame.width, frame.height);
      expect(frame.center.x, closeTo(200, 1e-9));
      final line = defaultViewfinderRect(const QRGenSize(400, 800), line: true);
      expect(line.width, greaterThan(line.height));
    });
  });

  group('selectBarcodes', () {
    QRGenBarcode at(String data, double x, double y) => QRGenBarcode(
          data: data,
          symbology: QRGenSymbology.qr,
          frameSize: const QRGenSize(100, 100),
          location: QRGenQuadrilateral.fromRect(QRGenRect(x - 1, y - 1, 2, 2)),
        );

    test('keeps the codes closest to the center in original order', () {
      final list = [at('corner', 5, 5), at('center', 50, 50), at('near', 60, 55)];
      expect(selectBarcodes(list, maxResults: 1).map((b) => b.data), ['center']);
      expect(selectBarcodes(list, maxResults: 2).map((b) => b.data), ['center', 'near']);
      expect(selectBarcodes(list).map((b) => b.data), ['corner', 'center', 'near']);
    });

    test('filters by scan area', () {
      final list = [at('left', 10, 50), at('right', 90, 50)];
      expect(
        selectBarcodes(list, scanArea: const QRGenScanArea(x: 0.5, y: 0, width: 0.5, height: 1)).map((b) => b.data),
        ['right'],
      );
    });
  });

  group('convertDetectedCodes', () {
    final all = resolveSymbologies(null);

    test('builds SPEC results in upright frame pixels', () {
      final list = convertDetectedCodes(
        [
          QRGenDetectedCode(
            formatName: 'qrCode',
            rawValue: 'hello',
            rawBytes: Uint8List.fromList(utf8.encode('hello')),
            corners: const [QRGenPoint(150, 200), QRGenPoint(150, 260), QRGenPoint(100, 260), QRGenPoint(100, 200)],
          ),
        ],
        frameSize: const QRGenSize(1280, 720),
        viewSize: const QRGenSize(390, 844),
        requested: all,
        timestamp: DateTime.fromMillisecondsSinceEpoch(42),
      );
      final b = list.single;
      expect(b.symbology, QRGenSymbology.qr);
      expect(b.symbologyName, 'QR Code');
      expect(b.rawBytes, base64Encode(utf8.encode('hello')));
      expect(b.contentType, QRGenContentType.text);
      expect(b.frameSize, const QRGenSize(720, 1280));
      expect(b.location.topLeft, const QRGenPoint(100, 200));
      expect(b.location.bottomRight, const QRGenPoint(150, 260));
      expect(b.timestamp.millisecondsSinceEpoch, 42);
    });

    test('drops empty, unknown and unrequested codes and refines UPC-A', () {
      final list = convertDetectedCodes(
        const [
          QRGenDetectedCode(formatName: 'qrCode'),
          QRGenDetectedCode(formatName: 'qrCode', rawValue: ''),
          QRGenDetectedCode(formatName: 'unknown', rawValue: 'x'),
          QRGenDetectedCode(formatName: 'code128', rawValue: 'abc'),
          QRGenDetectedCode(formatName: 'ean13', rawValue: '0036000291452'),
        ],
        frameSize: QRGenSize.zero,
        requested: resolveSymbologies(['upca', 'qr']),
      );
      expect(list.map((b) => '${b.symbology.id}:${b.data}'), ['upca:036000291452']);
    });

    test('reports byte-only codes as binary', () {
      final b = convertDetectedCodes(
        [QRGenDetectedCode(formatName: 'qrCode', rawBytes: Uint8List.fromList([0xff, 0x00, 0x41]))],
        frameSize: QRGenSize.zero,
        requested: all,
      ).single;
      expect(b.contentType, QRGenContentType.binary);
      expect(b.data.codeUnits, [0xff, 0x00, 0x41]);
    });

    test('presents DataBar in GS1 HRI form', () {
      final b = convertDetectedCodes(
        const [QRGenDetectedCode(formatName: 'dataBar', rawValue: '0100012345678905')],
        frameSize: QRGenSize.zero,
        requested: all,
      ).single;
      expect(b.data, '(01)00012345678905');
      expect(b.isGS1, isTrue);
      expect(b.contentType, QRGenContentType.gs1);
    });
  });
}
