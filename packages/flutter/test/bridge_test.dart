import 'dart:convert';

import 'package:qrgen_flutter/src/core/bridge.dart';
import 'package:qrgen_flutter/src/core/error.dart';
import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:test/test.dart';

final Map<String, Object?> _sample = {
  'data': 'https://example.com',
  'symbology': 'qr',
  'symbologyName': 'QR Code',
  'rawBytes': '',
  'contentType': 'text',
  'isGS1': false,
  'location': {
    'topLeft': {'x': 10, 'y': 10},
    'topRight': {'x': 90, 'y': 10},
    'bottomRight': {'x': 90, 'y': 90},
    'bottomLeft': {'x': 10, 'y': 90},
  },
  'frameSize': {'width': 1280, 'height': 720},
  'orientation': 0,
  'ecLevel': 'M',
  'symbologyIdentifier': ']Q1',
  'timestamp': 1735689600000,
};

void main() {
  group('buildEmbedUrl', () {
    test('uses the hosted page and writes every option', () {
      expect(
        buildEmbedUrl(const QRGenScannerOptions(symbologies: ['qr', 'ean13'], mode: QRGenScanMode.single, viewfinder: QRGenViewfinder.frame)),
        'https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single&duplicateFilter=1000'
        '&beep=1&vibrate=1&camera=back&torch=0&viewfinder=frame',
      );
    });

    test('writes scan area, max results and overrides', () {
      final url = buildEmbedUrl(
        const QRGenScannerOptions(
          symbologies: [],
          duplicateFilter: -1,
          camera: QRGenCameraFacing.front,
          scanArea: QRGenScanArea(x: 0.1, y: 0.2, width: 0.8, height: 0.5),
          maxResults: 20,
        ),
        embedUrl: 'https://example.com/embed/',
        extra: {'vibrate': '0'},
      );
      expect(
        url,
        'https://example.com/embed/?mode=continuous&duplicateFilter=-1&beep=1&vibrate=0&camera=front&torch=0'
        '&scanArea=0.1,0.2,0.8,0.5&maxResults=20',
      );
    });

    test('keeps an existing query and fragment and encodes values', () {
      final url = buildEmbedUrl(
        const QRGenScannerOptions(symbologies: ['QR Code']),
        embedUrl: 'https://example.com/e/?lang=de#top',
      );
      expect(url, startsWith('https://example.com/e/?lang=de&symbologies=QR%20Code&'));
      expect(url, endsWith('#top'));
      expect(buildEmbedUri(const QRGenScannerOptions()).queryParameters['mode'], 'continuous');
    });
  });

  group('parseBridgeMessage', () {
    test('parses ready', () {
      final m = parseBridgeMessage('{"source":"qrgen","version":1,"type":"ready"}');
      expect(m, isA<QRGenReadyMessage>());
      expect(m!.version, 1);
    });

    test('parses scan messages from JSON strings', () {
      final m = parseBridgeMessage(jsonEncode({'source': 'qrgen', 'version': 1, 'type': 'scan', 'barcodes': [_sample]}));
      expect(m, isA<QRGenScanMessage>());
      final barcodes = (m! as QRGenScanMessage).barcodes;
      expect(barcodes.single.symbology, QRGenSymbology.qr);
      expect(barcodes.single.toJson(), _sample);
    });

    test('accepts maps, defaults the version and skips invalid barcodes', () {
      final m = parseBridgeMessage({
        'source': 'qrgen',
        'type': 'scan',
        'barcodes': [
          {'data': '123', 'symbology': 'EAN-13'},
          {'nope': true},
          'x',
        ],
      });
      final scan = m! as QRGenScanMessage;
      expect(scan.version, 1);
      expect(scan.barcodes.single.symbology, QRGenSymbology.ean13);
    });

    test('parses track messages', () {
      final m = parseBridgeMessage({
        'source': 'qrgen',
        'version': 1,
        'type': 'track',
        'tracked': [
          {..._sample, 'id': 3, 'firstSeen': 1, 'lastSeen': 2, 'count': 5},
        ],
      });
      final t = (m! as QRGenTrackMessage).tracked.single;
      expect(t.id, '3');
      expect(t.count, 5);
      expect(t.lastSeen, DateTime.fromMillisecondsSinceEpoch(2));
    });

    test('parses errors', () {
      final m = parseBridgeMessage({'source': 'qrgen', 'version': 1, 'type': 'error', 'code': 'camera-permission-denied', 'message': 'Denied'});
      final e = (m! as QRGenErrorMessage).error;
      expect(e.code, QRGenErrorCode.cameraPermissionDenied);
      expect(e.message, 'Denied');
      final unknown = parseBridgeMessage({'source': 'qrgen', 'type': 'error', 'code': 'odd'})! as QRGenErrorMessage;
      expect(unknown.error.code, QRGenErrorCode.unknown);
    });

    test('ignores foreign, malformed and unknown messages', () {
      expect(parseBridgeMessage('not json'), isNull);
      expect(parseBridgeMessage('"qrgen"'), isNull);
      expect(parseBridgeMessage('[1,2]'), isNull);
      expect(parseBridgeMessage({'source': 'other', 'type': 'scan'}), isNull);
      expect(parseBridgeMessage({'source': 'qrgen-host', 'type': 'start'}), isNull);
      expect(parseBridgeMessage({'source': 'qrgen', 'type': 'weird'}), isNull);
      expect(parseBridgeMessage({'source': 'qrgen'}), isNull);
      expect(parseBridgeMessage(null), isNull);
      expect(parseBridgeMessage(42), isNull);
    });

    test('tolerates a scan without barcodes', () {
      expect((parseBridgeMessage({'source': 'qrgen', 'type': 'scan'})! as QRGenScanMessage).barcodes, isEmpty);
    });
  });

  group('QRGenBridgeCommand', () {
    test('builds runJavaScript snippets', () {
      expect(QRGenBridgeCommand.start.toScript(), 'window.qrgen && window.qrgen.command({"type":"start"});');
      expect(QRGenBridgeCommand.torch(true).toScript(), 'window.qrgen && window.qrgen.command({"type":"torch","value":true});');
      expect(QRGenBridgeCommand.pause.toJson(), {'type': 'pause'});
    });

    test('builds the postMessage form', () {
      expect(jsonDecode(QRGenBridgeCommand.resume.toPostMessage()), {'source': 'qrgen-host', 'type': 'resume'});
      expect(QRGenBridgeCommand.torch(false), QRGenBridgeCommand.torch(false));
    });

    test('channel name matches the SPEC', () {
      expect(qrgenBridgeChannelName, 'QRGenBridge');
      expect(qrgenDefaultEmbedUrl, 'https://rockyljewell.github.io/QR-GEN/embed/');
    });
  });
}
