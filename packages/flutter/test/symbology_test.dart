import 'package:qrgen_flutter/src/core/options.dart';
import 'package:qrgen_flutter/src/core/symbology.dart';
import 'package:test/test.dart';

const _v5Formats = {
  'unknown', 'all', 'code128', 'code39', 'code93', 'codabar', 'dataMatrix', 'ean13', 'ean8', 'itf', 'qrCode', 'upcA', //
  'upcE', 'pdf417', 'aztec',
};

const _v7Formats = {
  ..._v5Formats,
  'itf2of5', 'itf2of5WithChecksum', 'itf14', 'maxiCode', 'microQrCode', 'dataBar', 'dataBarExpanded', 'dataBarLimited', //
};

void main() {
  group('QRGenSymbology', () {
    test('has the 26 SPEC ids in order', () {
      expect(QRGenSymbology.values.map((s) => s.id).toList(), [
        'qr', 'micro-qr', 'rmqr', 'data-matrix', 'aztec', 'pdf417', 'micro-pdf417', 'maxicode', //
        'ean13', 'ean8', 'upca', 'upce', 'isbn', 'code128', 'code39', 'code93', 'codabar', 'itf', //
        'itf14', 'databar', 'databar-expanded', 'databar-limited', 'code32', 'pzn', 'telepen', 'dx-film-edge', //
      ]);
    });

    test('has names', () {
      expect(QRGenSymbology.qr.displayName, 'QR Code');
      expect(QRGenSymbology.ean13.displayName, 'EAN-13');
      expect(QRGenSymbology.itf.displayName, 'Interleaved 2 of 5');
      expect(QRGenSymbology.dataMatrix.toString(), 'data-matrix');
    });

    test('has no alias collisions', () {
      final owners = <String, QRGenSymbology>{};
      for (final s in QRGenSymbology.values) {
        for (final key in [s.id, ...s.aliases].map(normalizeSymbologyKey)) {
          expect(owners.putIfAbsent(key, () => s), s, reason: key);
        }
      }
    });

    final cases = {
      'QRCode': QRGenSymbology.qr,
      'qr-code': QRGenSymbology.qr,
      'QR': QRGenSymbology.qr,
      'qr': QRGenSymbology.qr,
      'DataMatrix': QRGenSymbology.dataMatrix,
      'dm': QRGenSymbology.dataMatrix,
      'EAN': QRGenSymbology.ean13,
      'jan': QRGenSymbology.ean13,
      'GTIN-13': QRGenSymbology.ean13,
      'ean-13': QRGenSymbology.ean13,
      'UPC': QRGenSymbology.upca,
      'upc-a': QRGenSymbology.upca,
      'GS1-128': QRGenSymbology.code128,
      'Code 3 of 9': QRGenSymbology.code39,
      'NW-7': QRGenSymbology.codabar,
      'I2of5': QRGenSymbology.itf,
      'ITF-14': QRGenSymbology.itf14,
      'RSS-14': QRGenSymbology.databar,
      'RSS Expanded': QRGenSymbology.databarExpanded,
      'pdf-417': QRGenSymbology.pdf417,
      'Compact PDF417': QRGenSymbology.pdf417,
      'MicroPDF417': QRGenSymbology.microPdf417,
      'ISBN-13': QRGenSymbology.isbn,
      'DX Film Edge': QRGenSymbology.dxFilmEdge,
    };
    cases.forEach((input, expected) {
      test('resolves "$input"', () => expect(QRGenSymbology.tryParse(input), expected));
    });

    test('returns null for unknown input and groups, parse throws', () {
      expect(QRGenSymbology.tryParse('foo'), isNull);
      expect(QRGenSymbology.tryParse('all'), isNull);
      expect(QRGenSymbology.tryParse(''), isNull);
      expect(() => QRGenSymbology.parse('foo'), throwsFormatException);
    });
  });

  group('resolveSymbologies', () {
    test('defaults to all', () {
      expect(resolveSymbologies(null), QRGenSymbology.values);
      expect(resolveSymbologies([]), QRGenSymbology.values);
      expect(resolveSymbologies(['  ']), QRGenSymbology.values);
      expect(resolveSymbologies(['ALL']), QRGenSymbology.values);
    });

    test('expands groups and de-duplicates in order', () {
      expect(resolveSymbologies(['QR', 'retail', 'ean']), [
        QRGenSymbology.qr,
        QRGenSymbology.ean13,
        QRGenSymbology.ean8,
        QRGenSymbology.upca,
        QRGenSymbology.upce,
        QRGenSymbology.isbn,
        QRGenSymbology.databar,
        QRGenSymbology.databarExpanded,
        QRGenSymbology.databarLimited,
      ]);
      expect(resolveSymbologies(['2D']), qrgenSymbologyGroups['matrix']);
      expect(resolveSymbologies(['1d']).length, 18);
      expect(resolveSymbologies(['industrial']).last, QRGenSymbology.dataMatrix);
      expect(resolveSymbologies(['gs1']).map((s) => s.id), ['code128', 'data-matrix', 'qr', 'databar', 'databar-expanded', 'databar-limited']);
    });

    test('drops unknown ids silently', () {
      expect(resolveSymbologies(['qr', 'nope']), [QRGenSymbology.qr]);
      expect(resolveSymbologies(['nope']), isEmpty);
    });

    test('linear and matrix partition all', () {
      final union = {...qrgenSymbologyGroups['linear']!, ...qrgenSymbologyGroups['matrix']!};
      expect(union.length, QRGenSymbology.values.length);
      expect(isLinearOnly(resolveSymbologies(['linear'])), isTrue);
      expect(isLinearOnly(resolveSymbologies(['ean13', 'qr'])), isFalse);
      expect(isLinearOnly(const []), isFalse);
    });

    test('options pick the default viewfinder and max results', () {
      expect(const QRGenScannerOptions(symbologies: ['ean13', 'code128']).effectiveViewfinder, QRGenViewfinder.line);
      expect(const QRGenScannerOptions().effectiveViewfinder, QRGenViewfinder.frame);
      expect(const QRGenScannerOptions(symbologies: ['1d'], viewfinder: QRGenViewfinder.none).effectiveViewfinder, QRGenViewfinder.none);
      expect(const QRGenScannerOptions().effectiveMaxResults, 1);
      expect(const QRGenScannerOptions(mode: QRGenScanMode.batch).effectiveMaxResults, 20);
      expect(const QRGenScannerOptions(maxResults: 3).effectiveMaxResults, 3);
    });
  });

  group('mobile_scanner mapping', () {
    List<String> names(List<String> input, String platform, Set<String> available, {bool vision = false}) =>
        mobileScannerFormatNames(resolveSymbologies(input), platform: platform, availableFormatNames: available, appleVision: vision);

    test('detects Apple Vision (mobile_scanner 7 on iOS/macOS)', () {
      const v6Errors = {'controllerAlreadyInitialized', 'controllerDisposed', 'genericError', 'permissionDenied', 'unsupported'};
      const v7Errors = {...v6Errors, 'controllerInitializing', 'controllerNotAttached'};
      expect(mobileScannerUsesAppleVision(platform: QRGenPlatform.ios, errorCodeNames: v7Errors), isTrue);
      expect(mobileScannerUsesAppleVision(platform: QRGenPlatform.macos, errorCodeNames: v7Errors), isTrue);
      expect(mobileScannerUsesAppleVision(platform: QRGenPlatform.android, errorCodeNames: v7Errors), isFalse);
      expect(mobileScannerUsesAppleVision(platform: QRGenPlatform.ios, errorCodeNames: v6Errors), isFalse);
    });

    test('maps the common set on every version', () {
      expect(names(['qr', 'ean13', 'pdf417', 'data-matrix', 'aztec'], QRGenPlatform.android, _v5Formats),
          ['qrCode', 'ean13', 'pdf417', 'dataMatrix', 'aztec']);
      expect(names(['code128', 'code39', 'code93', 'codabar', 'ean8', 'upce'], QRGenPlatform.ios, _v7Formats, vision: true),
          ['code128', 'code39', 'code93', 'codabar', 'ean8', 'upcE']);
    });

    test('mobile_scanner 5/6 (ML Kit) uses ITF and no DataBar', () {
      expect(names(['itf', 'itf14'], QRGenPlatform.ios, _v5Formats), ['itf']);
      expect(names(['databar', 'upca'], QRGenPlatform.ios, _v5Formats), ['upcA']);
    });

    test('mobile_scanner 7.0-7.2 on Apple: Vision, but the old format names', () {
      expect(names(['upca'], QRGenPlatform.ios, _v5Formats, vision: true), ['ean13']);
      expect(names(['itf14'], QRGenPlatform.ios, _v5Formats, vision: true), ['itf']);
      expect(names(['databar'], QRGenPlatform.ios, _v5Formats, vision: true), isEmpty);
    });

    test('mobile_scanner 7.3+ on Apple uses the Vision formats', () {
      expect(names(['itf'], QRGenPlatform.ios, _v7Formats, vision: true), ['itf2of5', 'itf14']);
      expect(names(['itf14'], QRGenPlatform.ios, _v7Formats, vision: true), ['itf14']);
      expect(names(['upca'], QRGenPlatform.ios, _v7Formats, vision: true), ['ean13']);
      expect(names(['retail'], QRGenPlatform.macos, _v7Formats, vision: true),
          ['ean13', 'ean8', 'upcE', 'dataBar', 'dataBarExpanded', 'dataBarLimited']);
    });

    test('mobile_scanner 7 on Android keeps ML Kit formats', () {
      expect(names(['itf'], QRGenPlatform.android, _v7Formats), ['itf2of5']);
      expect(names(['upca', 'databar'], QRGenPlatform.android, _v7Formats), ['upcA']);
    });

    test('drops unsupported symbologies silently', () {
      expect(names(['micro-qr', 'maxicode', 'telepen', 'qr'], QRGenPlatform.ios, _v7Formats, vision: true), ['qrCode']);
      expect(names(['rmqr'], QRGenPlatform.android, _v5Formats), isEmpty);
    });

    test('only returns names that exist in the installed version', () {
      expect(names(['itf14'], QRGenPlatform.android, {'qrCode'}), isEmpty);
    });

    test('lists supported symbologies', () {
      final android = mobileScannerSupportedSymbologies(platform: QRGenPlatform.android, availableFormatNames: _v5Formats);
      expect(android.map((s) => s.id), [
        'qr', 'data-matrix', 'aztec', 'pdf417', 'ean13', 'ean8', 'upca', 'upce', 'isbn', 'code128', 'code39', 'code93', //
        'codabar', 'itf', 'itf14',
      ]);
      final ios7 = mobileScannerSupportedSymbologies(platform: QRGenPlatform.ios, availableFormatNames: _v7Formats, appleVision: true);
      expect(ios7, contains(QRGenSymbology.databarLimited));
    });
  });

  group('fromMobileScannerFormat', () {
    final all = resolveSymbologies(null);

    test('maps plain formats', () {
      expect(fromMobileScannerFormat('qrCode', 'hi', all), (symbology: QRGenSymbology.qr, data: 'hi'));
      expect(fromMobileScannerFormat('dataBarLimited', 'x', all)?.symbology, QRGenSymbology.databarLimited);
      expect(fromMobileScannerFormat('microQrCode', 'x', all)?.symbology, QRGenSymbology.microQr);
      expect(fromMobileScannerFormat('unknown', 'x', all), isNull);
      expect(fromMobileScannerFormat('qrCode', 'x', [QRGenSymbology.ean13]), isNull);
    });

    test('refines EAN-13 into ISBN and UPC-A', () {
      expect(fromMobileScannerFormat('ean13', '9780306406157', all), (symbology: QRGenSymbology.isbn, data: '9780306406157'));
      expect(fromMobileScannerFormat('ean13', '9780306406157', [QRGenSymbology.ean13])?.symbology, QRGenSymbology.ean13);
      expect(fromMobileScannerFormat('ean13', '0036000291452', all), (symbology: QRGenSymbology.upca, data: '036000291452'));
      expect(fromMobileScannerFormat('ean13', '4006381333931', [QRGenSymbology.upca]), isNull);
    });

    test('maps UPC-A back to EAN-13 when only EAN-13 was requested', () {
      expect(fromMobileScannerFormat('upcA', '036000291452', [QRGenSymbology.ean13]), (symbology: QRGenSymbology.ean13, data: '0036000291452'));
    });

    test('refines ITF formats', () {
      expect(fromMobileScannerFormat('itf14', '15400141288763', all)?.symbology, QRGenSymbology.itf14);
      // mobile_scanner 7 on Android reports every ITF as itf14.
      expect(fromMobileScannerFormat('itf14', '123456', all)?.symbology, QRGenSymbology.itf);
      expect(fromMobileScannerFormat('itf14', '123456', [QRGenSymbology.itf14]), isNull);
      expect(fromMobileScannerFormat('itf2of5', '15400141288763', [QRGenSymbology.itf])?.symbology, QRGenSymbology.itf);
      expect(fromMobileScannerFormat('itf', '15400141288763', all)?.symbology, QRGenSymbology.itf14);
    });
  });
}
