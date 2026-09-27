/// QRGen symbology ids, names, aliases and groups (SPEC section 1) and the
/// mapping to `mobile_scanner` barcode formats.
///
/// This library is pure Dart (no Flutter imports).
library;

/// Whether a symbology is linear (1D) or a matrix / stacked (2D) code.
enum QRGenSymbologyKind {
  /// One-dimensional (bars) symbologies such as EAN-13 or Code 128.
  linear,

  /// Two-dimensional or stacked symbologies such as QR Code or PDF417.
  matrix,
}

/// Every symbology defined by the QRGen specification.
///
/// [id] is the lowercase SPEC id used in JSON and across platforms.
enum QRGenSymbology {
  /// QR Code.
  qr('qr', 'QR Code', ['qrcode'], QRGenSymbologyKind.matrix),

  /// Micro QR Code.
  microQr('micro-qr', 'Micro QR Code', ['microqrcode'], QRGenSymbologyKind.matrix),

  /// rMQR Code.
  rmqr('rmqr', 'rMQR Code', ['rmqrcode'], QRGenSymbologyKind.matrix),

  /// Data Matrix.
  dataMatrix('data-matrix', 'Data Matrix', ['datamatrix', 'dm'], QRGenSymbologyKind.matrix),

  /// Aztec.
  aztec('aztec', 'Aztec', ['azteccode'], QRGenSymbologyKind.matrix),

  /// PDF417 (and Compact PDF417).
  pdf417('pdf417', 'PDF417', ['compactpdf417'], QRGenSymbologyKind.matrix),

  /// MicroPDF417.
  microPdf417('micro-pdf417', 'MicroPDF417', ['micropdf417'], QRGenSymbologyKind.matrix),

  /// MaxiCode.
  maxicode('maxicode', 'MaxiCode', [], QRGenSymbologyKind.matrix),

  /// EAN-13.
  ean13('ean13', 'EAN-13', ['ean', 'jan', 'gtin13'], QRGenSymbologyKind.linear),

  /// EAN-8.
  ean8('ean8', 'EAN-8', ['gtin8'], QRGenSymbologyKind.linear),

  /// UPC-A.
  upca('upca', 'UPC-A', ['upc'], QRGenSymbologyKind.linear),

  /// UPC-E.
  upce('upce', 'UPC-E', [], QRGenSymbologyKind.linear),

  /// ISBN (an EAN-13 with a 978/979 prefix).
  isbn('isbn', 'ISBN', ['isbn13'], QRGenSymbologyKind.linear),

  /// Code 128 (and GS1-128).
  code128('code128', 'Code 128', ['gs1128', 'ean128'], QRGenSymbologyKind.linear),

  /// Code 39.
  code39('code39', 'Code 39', ['code3of9'], QRGenSymbologyKind.linear),

  /// Code 93.
  code93('code93', 'Code 93', [], QRGenSymbologyKind.linear),

  /// Codabar.
  codabar('codabar', 'Codabar', ['nw7'], QRGenSymbologyKind.linear),

  /// Interleaved 2 of 5.
  itf('itf', 'Interleaved 2 of 5', ['interleaved2of5', 'i2of5'], QRGenSymbologyKind.linear),

  /// ITF-14.
  itf14('itf14', 'ITF-14', [], QRGenSymbologyKind.linear),

  /// GS1 DataBar (Omnidirectional, Stacked).
  databar('databar', 'GS1 DataBar', ['rss14', 'databaromni'], QRGenSymbologyKind.linear),

  /// GS1 DataBar Expanded.
  databarExpanded('databar-expanded', 'GS1 DataBar Expanded', ['rssexpanded'], QRGenSymbologyKind.linear),

  /// GS1 DataBar Limited.
  databarLimited('databar-limited', 'GS1 DataBar Limited', ['rsslimited'], QRGenSymbologyKind.linear),

  /// Code 32 (Italian Pharmacode).
  code32('code32', 'Code 32 (Italian Pharmacode)', [], QRGenSymbologyKind.linear),

  /// PZN.
  pzn('pzn', 'PZN', [], QRGenSymbologyKind.linear),

  /// Telepen.
  telepen('telepen', 'Telepen', [], QRGenSymbologyKind.linear),

  /// DX Film Edge.
  dxFilmEdge('dx-film-edge', 'DX Film Edge', [], QRGenSymbologyKind.linear);

  const QRGenSymbology(this.id, this.displayName, this.aliases, this.kind);

  /// The SPEC id, for example `ean13` or `data-matrix`.
  final String id;

  /// Human readable name, for example `EAN-13`.
  final String displayName;

  /// Extra spellings accepted as input (compared after [normalizeSymbologyKey]).
  final List<String> aliases;

  /// Linear or matrix.
  final QRGenSymbologyKind kind;

  /// Whether this is a linear (1D) symbology.
  bool get isLinear => kind == QRGenSymbologyKind.linear;

  static final Map<String, QRGenSymbology> _byKey = () {
    final map = <String, QRGenSymbology>{};
    for (final s in QRGenSymbology.values) {
      map[normalizeSymbologyKey(s.id)] = s;
      for (final alias in s.aliases) {
        map[normalizeSymbologyKey(alias)] = s;
      }
    }
    return map;
  }();

  /// Resolves an id or alias (case and punctuation insensitive), for example
  /// `QR-Code` to [QRGenSymbology.qr]. Returns `null` for unknown input and
  /// for group names.
  static QRGenSymbology? tryParse(String input) => _byKey[normalizeSymbologyKey(input)];

  /// Like [tryParse] but throws a [FormatException] for unknown input.
  static QRGenSymbology parse(String input) {
    final value = tryParse(input);
    if (value == null) {
      throw FormatException('Unknown QRGen symbology', input);
    }
    return value;
  }

  @override
  String toString() => id;
}

/// Normalizes user input for matching: lowercase, then remove everything
/// except `[a-z0-9]`. `QR-Code` becomes `qrcode`.
String normalizeSymbologyKey(String input) => input.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

const List<QRGenSymbology> _linear = [
  QRGenSymbology.ean13,
  QRGenSymbology.ean8,
  QRGenSymbology.upca,
  QRGenSymbology.upce,
  QRGenSymbology.isbn,
  QRGenSymbology.code128,
  QRGenSymbology.code39,
  QRGenSymbology.code93,
  QRGenSymbology.codabar,
  QRGenSymbology.itf,
  QRGenSymbology.itf14,
  QRGenSymbology.databar,
  QRGenSymbology.databarExpanded,
  QRGenSymbology.databarLimited,
  QRGenSymbology.code32,
  QRGenSymbology.pzn,
  QRGenSymbology.telepen,
  QRGenSymbology.dxFilmEdge,
];

const List<QRGenSymbology> _matrix = [
  QRGenSymbology.qr,
  QRGenSymbology.microQr,
  QRGenSymbology.rmqr,
  QRGenSymbology.dataMatrix,
  QRGenSymbology.aztec,
  QRGenSymbology.pdf417,
  QRGenSymbology.microPdf417,
  QRGenSymbology.maxicode,
];

/// Symbology groups (SPEC section 1), keyed by group name.
const Map<String, List<QRGenSymbology>> qrgenSymbologyGroups = {
  'all': QRGenSymbology.values,
  'linear': _linear,
  '1d': _linear,
  'matrix': _matrix,
  '2d': _matrix,
  'retail': [
    QRGenSymbology.ean13,
    QRGenSymbology.ean8,
    QRGenSymbology.upca,
    QRGenSymbology.upce,
    QRGenSymbology.isbn,
    QRGenSymbology.databar,
    QRGenSymbology.databarExpanded,
    QRGenSymbology.databarLimited,
  ],
  'industrial': [
    QRGenSymbology.code128,
    QRGenSymbology.code39,
    QRGenSymbology.code93,
    QRGenSymbology.codabar,
    QRGenSymbology.itf,
    QRGenSymbology.itf14,
    QRGenSymbology.dataMatrix,
  ],
  'gs1': [
    QRGenSymbology.code128,
    QRGenSymbology.dataMatrix,
    QRGenSymbology.qr,
    QRGenSymbology.databar,
    QRGenSymbology.databarExpanded,
    QRGenSymbology.databarLimited,
  ],
};

/// Returns the group members for a group name such as `1D` or `Retail`, or
/// `null` when [input] is not a group.
List<QRGenSymbology>? resolveSymbologyGroup(String input) => qrgenSymbologyGroups[normalizeSymbologyKey(input)];

/// Expands ids, aliases and groups into a de-duplicated list, in order of
/// first appearance. Unknown entries are dropped silently.
///
/// `null` or an empty list resolves to every symbology (`all`, the SPEC
/// default). A non-empty list made only of unknown entries resolves to an
/// empty list.
List<QRGenSymbology> resolveSymbologies(Iterable<String>? input) {
  final entries = input?.where((e) => e.trim().isNotEmpty).toList() ?? const <String>[];
  if (entries.isEmpty) return List.of(QRGenSymbology.values);
  final out = <QRGenSymbology>[];
  final seen = <QRGenSymbology>{};
  void add(QRGenSymbology s) {
    if (seen.add(s)) out.add(s);
  }

  for (final entry in entries) {
    final single = QRGenSymbology.tryParse(entry);
    if (single != null) {
      add(single);
      continue;
    }
    resolveSymbologyGroup(entry)?.forEach(add);
  }
  return out;
}

/// Whether every symbology in the list is linear (used to pick the default
/// viewfinder style).
bool isLinearOnly(Iterable<QRGenSymbology> symbologies) =>
    symbologies.isNotEmpty && symbologies.every((s) => s.isLinear);

/* -------------------------------------------------------------------------- */
/* mobile_scanner mapping                                                      */
/* -------------------------------------------------------------------------- */

/// Target platform names used by the `mobile_scanner` mapping.
abstract final class QRGenPlatform {
  /// Android (ML Kit).
  static const String android = 'android';

  /// iOS (ML Kit up to mobile_scanner 6, Apple Vision from 7).
  static const String ios = 'ios';

  /// macOS (Apple Vision).
  static const String macos = 'macos';

  /// Web (ZXing).
  static const String web = 'web';
}

bool _isApple(String platform) => platform == QRGenPlatform.ios || platform == QRGenPlatform.macos;

/// Whether `mobile_scanner` decodes with Apple Vision: version 7 or later
/// (detected from the `MobileScannerErrorCode` value names, as 7.0 added
/// `controllerNotAttached`) running on iOS or macOS. Versions 5 and 6 use
/// ML Kit on iOS.
bool mobileScannerUsesAppleVision({required String platform, required Set<String> errorCodeNames}) =>
    _isApple(platform) && errorCodeNames.contains('controllerNotAttached');

List<String> _formatsFor(QRGenSymbology s, String platform, Set<String> available, bool appleVision) {
  final apple = _isApple(platform);
  switch (s) {
    case QRGenSymbology.qr:
      return ['qrCode'];
    case QRGenSymbology.dataMatrix:
      return ['dataMatrix'];
    case QRGenSymbology.aztec:
      return ['aztec'];
    case QRGenSymbology.pdf417:
      return ['pdf417'];
    case QRGenSymbology.ean13:
    case QRGenSymbology.isbn:
      return ['ean13'];
    case QRGenSymbology.ean8:
      return ['ean8'];
    case QRGenSymbology.upca:
      // Apple Vision reads UPC-A as EAN-13 with a leading zero.
      return appleVision ? ['ean13'] : ['upcA'];
    case QRGenSymbology.upce:
      return ['upcE'];
    case QRGenSymbology.code128:
      return ['code128'];
    case QRGenSymbology.code39:
      return ['code39'];
    case QRGenSymbology.code93:
      return ['code93'];
    case QRGenSymbology.codabar:
      return ['codabar'];
    case QRGenSymbology.itf:
      // mobile_scanner 7.3+ has separate Interleaved 2 of 5 and ITF-14 formats.
      if (!available.contains('itf2of5')) return ['itf'];
      return apple ? ['itf2of5', 'itf14'] : ['itf2of5'];
    case QRGenSymbology.itf14:
      return available.contains('itf14') ? ['itf14'] : ['itf'];
    case QRGenSymbology.databar:
      return appleVision ? ['dataBar'] : const [];
    case QRGenSymbology.databarExpanded:
      return appleVision ? ['dataBarExpanded'] : const [];
    case QRGenSymbology.databarLimited:
      return appleVision ? ['dataBarLimited'] : const [];
    case QRGenSymbology.microQr:
    case QRGenSymbology.rmqr:
    case QRGenSymbology.microPdf417:
    case QRGenSymbology.maxicode:
    case QRGenSymbology.code32:
    case QRGenSymbology.pzn:
    case QRGenSymbology.telepen:
    case QRGenSymbology.dxFilmEdge:
      return const [];
  }
}

/// Maps QRGen symbologies to `mobile_scanner` `BarcodeFormat` names for a
/// platform. [availableFormatNames] are the names of `BarcodeFormat.values`
/// in the installed `mobile_scanner` version and [appleVision] tells whether
/// it decodes with Apple Vision (see [mobileScannerUsesAppleVision]); the
/// mapping differs between versions. Symbologies that cannot be read are
/// dropped silently; the result is de-duplicated.
List<String> mobileScannerFormatNames(
  Iterable<QRGenSymbology> symbologies, {
  required String platform,
  required Set<String> availableFormatNames,
  bool appleVision = false,
}) {
  final out = <String>[];
  for (final s in symbologies) {
    for (final name in _formatsFor(s, platform, availableFormatNames, appleVision)) {
      if (availableFormatNames.contains(name) && !out.contains(name)) out.add(name);
    }
  }
  return out;
}

/// The symbologies the `mobile_scanner` back end can read on [platform].
List<QRGenSymbology> mobileScannerSupportedSymbologies({
  required String platform,
  required Set<String> availableFormatNames,
  bool appleVision = false,
}) =>
    QRGenSymbology.values
        .where(
          (s) => mobileScannerFormatNames(
            [s],
            platform: platform,
            availableFormatNames: availableFormatNames,
            appleVision: appleVision,
          ).isNotEmpty,
        )
        .toList();

final RegExp _digits = RegExp(r'^[0-9]+$');

/// Converts a `mobile_scanner` result (format name and value) back to a QRGen
/// symbology and data, restricted to [requested]. Returns `null` when the code
/// does not match a requested symbology.
///
/// - `ean13` with a `978`/`979` prefix becomes [QRGenSymbology.isbn] when requested.
/// - `ean13` with a leading `0` becomes a 12 digit [QRGenSymbology.upca] when requested.
/// - any ITF format with 14 digits becomes [QRGenSymbology.itf14] when requested.
({QRGenSymbology symbology, String data})? fromMobileScannerFormat(
  String formatName,
  String value,
  Iterable<QRGenSymbology> requested,
) {
  final want = requested.toSet();
  ({QRGenSymbology symbology, String data})? pick(QRGenSymbology s, [String? data]) =>
      want.contains(s) ? (symbology: s, data: data ?? value) : null;
  final digits = _digits.hasMatch(value);

  switch (formatName) {
    case 'ean13':
      if (digits && value.length == 13 && (value.startsWith('978') || value.startsWith('979'))) {
        final isbn = pick(QRGenSymbology.isbn);
        if (isbn != null) return isbn;
      }
      if (digits && value.length == 13 && value.startsWith('0')) {
        final upc = pick(QRGenSymbology.upca, value.substring(1));
        if (upc != null) return upc;
      }
      return pick(QRGenSymbology.ean13);
    case 'upcA':
      return pick(QRGenSymbology.upca) ??
          (digits && value.length == 12 ? pick(QRGenSymbology.ean13, '0$value') : null);
    case 'itf':
    case 'itf14':
    case 'itf2of5':
    case 'itf2of5WithChecksum':
      if (digits && value.length == 14) {
        final itf14 = pick(QRGenSymbology.itf14);
        if (itf14 != null) return itf14;
      }
      return pick(QRGenSymbology.itf);
    case 'ean8':
      return pick(QRGenSymbology.ean8);
    case 'upcE':
      return pick(QRGenSymbology.upce);
    case 'qrCode':
      return pick(QRGenSymbology.qr);
    case 'microQrCode':
      return pick(QRGenSymbology.microQr);
    case 'dataMatrix':
      return pick(QRGenSymbology.dataMatrix);
    case 'aztec':
      return pick(QRGenSymbology.aztec);
    case 'pdf417':
      return pick(QRGenSymbology.pdf417);
    case 'maxiCode':
      return pick(QRGenSymbology.maxicode);
    case 'code128':
      return pick(QRGenSymbology.code128);
    case 'code39':
      return pick(QRGenSymbology.code39);
    case 'code93':
      return pick(QRGenSymbology.code93);
    case 'codabar':
    case 'codebar':
      return pick(QRGenSymbology.codabar);
    case 'dataBar':
      return pick(QRGenSymbology.databar);
    case 'dataBarExpanded':
      return pick(QRGenSymbology.databarExpanded);
    case 'dataBarLimited':
      return pick(QRGenSymbology.databarLimited);
    default:
      return null;
  }
}
