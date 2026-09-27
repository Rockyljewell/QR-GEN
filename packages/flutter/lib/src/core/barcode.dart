/// QRGen result models (SPEC section 2). Pure Dart.
library;

import 'symbology.dart';

/// A point in pixels.
final class QRGenPoint {
  /// Creates a point.
  const QRGenPoint(this.x, this.y);

  /// The origin.
  static const QRGenPoint zero = QRGenPoint(0, 0);

  /// Horizontal coordinate.
  final double x;

  /// Vertical coordinate.
  final double y;

  /// Reads `{ "x": .., "y": .. }`; missing or invalid values become 0.
  factory QRGenPoint.fromJson(Object? json) {
    if (json is Map) return QRGenPoint(_toDouble(json['x']), _toDouble(json['y']));
    return zero;
  }

  /// `{ "x": .., "y": .. }`.
  Map<String, Object?> toJson() => {'x': _jsonNum(x), 'y': _jsonNum(y)};

  @override
  bool operator ==(Object other) => other is QRGenPoint && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'QRGenPoint($x, $y)';
}

/// A width and height in pixels.
final class QRGenSize {
  /// Creates a size.
  const QRGenSize(this.width, this.height);

  /// Zero size.
  static const QRGenSize zero = QRGenSize(0, 0);

  /// Width.
  final double width;

  /// Height.
  final double height;

  /// Whether the size has no area.
  bool get isEmpty => width <= 0 || height <= 0;

  /// The same size with width and height swapped.
  QRGenSize get flipped => QRGenSize(height, width);

  /// Reads `{ "width": .., "height": .. }`.
  factory QRGenSize.fromJson(Object? json) {
    if (json is Map) return QRGenSize(_toDouble(json['width']), _toDouble(json['height']));
    return zero;
  }

  /// `{ "width": .., "height": .. }`.
  Map<String, Object?> toJson() => {'width': _jsonNum(width), 'height': _jsonNum(height)};

  @override
  bool operator ==(Object other) => other is QRGenSize && other.width == width && other.height == height;

  @override
  int get hashCode => Object.hash(width, height);

  @override
  String toString() => 'QRGenSize($width x $height)';
}

/// An axis-aligned rectangle.
final class QRGenRect {
  /// Creates a rectangle from its top-left corner and size.
  const QRGenRect(this.x, this.y, this.width, this.height);

  /// Left edge.
  final double x;

  /// Top edge.
  final double y;

  /// Width.
  final double width;

  /// Height.
  final double height;

  /// Right edge.
  double get right => x + width;

  /// Bottom edge.
  double get bottom => y + height;

  /// Center point.
  QRGenPoint get center => QRGenPoint(x + width / 2, y + height / 2);

  /// Whether [p] lies inside (edges included).
  bool contains(QRGenPoint p) => p.x >= x && p.x <= right && p.y >= y && p.y <= bottom;

  @override
  bool operator ==(Object other) =>
      other is QRGenRect && other.x == x && other.y == y && other.width == width && other.height == height;

  @override
  int get hashCode => Object.hash(x, y, width, height);

  @override
  String toString() => 'QRGenRect($x, $y, $width, $height)';
}

/// The four corners of a detected code.
final class QRGenQuadrilateral {
  /// Creates a quadrilateral from its corners.
  const QRGenQuadrilateral({
    required this.topLeft,
    required this.topRight,
    required this.bottomRight,
    required this.bottomLeft,
  });

  /// All corners at the origin.
  static const QRGenQuadrilateral zero = QRGenQuadrilateral(
    topLeft: QRGenPoint.zero,
    topRight: QRGenPoint.zero,
    bottomRight: QRGenPoint.zero,
    bottomLeft: QRGenPoint.zero,
  );

  /// A quadrilateral covering [rect].
  factory QRGenQuadrilateral.fromRect(QRGenRect rect) => QRGenQuadrilateral(
        topLeft: QRGenPoint(rect.x, rect.y),
        topRight: QRGenPoint(rect.right, rect.y),
        bottomRight: QRGenPoint(rect.right, rect.bottom),
        bottomLeft: QRGenPoint(rect.x, rect.bottom),
      );

  /// Top-left corner.
  final QRGenPoint topLeft;

  /// Top-right corner.
  final QRGenPoint topRight;

  /// Bottom-right corner.
  final QRGenPoint bottomRight;

  /// Bottom-left corner.
  final QRGenPoint bottomLeft;

  /// Corners in clockwise order, starting at [topLeft].
  List<QRGenPoint> get points => [topLeft, topRight, bottomRight, bottomLeft];

  /// Average of the corners.
  QRGenPoint get center => QRGenPoint(
        (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4,
        (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4,
      );

  /// Axis-aligned bounding box.
  QRGenRect get bounds {
    final xs = points.map((p) => p.x);
    final ys = points.map((p) => p.y);
    final minX = xs.reduce((a, b) => a < b ? a : b);
    final minY = ys.reduce((a, b) => a < b ? a : b);
    final maxX = xs.reduce((a, b) => a > b ? a : b);
    final maxY = ys.reduce((a, b) => a > b ? a : b);
    return QRGenRect(minX, minY, maxX - minX, maxY - minY);
  }

  /// Reads the SPEC `location` object.
  factory QRGenQuadrilateral.fromJson(Object? json) {
    if (json is! Map) return zero;
    return QRGenQuadrilateral(
      topLeft: QRGenPoint.fromJson(json['topLeft']),
      topRight: QRGenPoint.fromJson(json['topRight']),
      bottomRight: QRGenPoint.fromJson(json['bottomRight']),
      bottomLeft: QRGenPoint.fromJson(json['bottomLeft']),
    );
  }

  /// The SPEC `location` object.
  Map<String, Object?> toJson() => {
        'topLeft': topLeft.toJson(),
        'topRight': topRight.toJson(),
        'bottomRight': bottomRight.toJson(),
        'bottomLeft': bottomLeft.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      other is QRGenQuadrilateral &&
      other.topLeft == topLeft &&
      other.topRight == topRight &&
      other.bottomRight == bottomRight &&
      other.bottomLeft == bottomLeft;

  @override
  int get hashCode => Object.hash(topLeft, topRight, bottomRight, bottomLeft);

  @override
  String toString() => 'QRGenQuadrilateral($topLeft, $topRight, $bottomRight, $bottomLeft)';
}

/// What the payload of a code contains (SPEC section 2).
enum QRGenContentType {
  /// Plain text.
  text('text'),

  /// Binary bytes.
  binary('binary'),

  /// GS1 element strings.
  gs1('gs1'),

  /// ISO/IEC 15434 formatted data.
  iso15434('iso15434'),

  /// Mixed text and binary segments.
  mixed('mixed'),

  /// Data in an ECI the engine does not know.
  unknownEci('unknown-eci');

  const QRGenContentType(this.value);

  /// The SPEC string value.
  final String value;

  /// Parses a SPEC value; unknown values become [text].
  static QRGenContentType fromValue(Object? value) {
    for (final t in values) {
      if (t.value == value) return t;
    }
    return text;
  }
}

/// A decoded barcode, identical on every QRGen platform (SPEC section 2).
class QRGenBarcode {
  /// Creates a barcode. Only [data] and [symbology] are required.
  QRGenBarcode({
    required this.data,
    required this.symbology,
    String? symbologyName,
    this.rawBytes = '',
    this.contentType = QRGenContentType.text,
    bool? isGS1,
    this.location = QRGenQuadrilateral.zero,
    this.frameSize = QRGenSize.zero,
    this.orientation = 0,
    this.ecLevel = '',
    this.symbologyIdentifier = '',
    DateTime? timestamp,
  })  : symbologyName = symbologyName ?? symbology.displayName,
        isGS1 = isGS1 ?? contentType == QRGenContentType.gs1,
        timestamp = timestamp ?? DateTime.now();

  /// Decoded text. GS1 content is in HRI form (`(01)...`) when the engine can tell.
  final String data;

  /// The symbology.
  final QRGenSymbology symbology;

  /// Human readable symbology name, for example `QR Code`.
  final String symbologyName;

  /// Base64 of the raw payload bytes, or `''` when unavailable.
  final String rawBytes;

  /// Payload classification.
  final QRGenContentType contentType;

  /// Whether the content is GS1 formatted.
  final bool isGS1;

  /// Corner points in pixels of the frame described by [frameSize].
  final QRGenQuadrilateral location;

  /// Size of the frame [location] refers to.
  final QRGenSize frameSize;

  /// Orientation in degrees, `0` when unknown.
  final double orientation;

  /// Error-correction level when known, else `''`.
  final String ecLevel;

  /// AIM symbology identifier (for example `]Q1`) when known, else `''`.
  final String symbologyIdentifier;

  /// When the code was decoded.
  final DateTime timestamp;

  /// Reads a SPEC result. Throws a [FormatException] when `data` or
  /// `symbology` is missing or the symbology is unknown; use [tryFromJson] to
  /// get `null` instead.
  factory QRGenBarcode.fromJson(Map<String, Object?> json) {
    final data = json['data'];
    final symbologyValue = json['symbology'];
    if (data is! String) throw FormatException('QRGenBarcode: "data" must be a string', json);
    if (symbologyValue is! String) throw FormatException('QRGenBarcode: "symbology" must be a string', json);
    final symbology = QRGenSymbology.parse(symbologyValue);
    final contentType = QRGenContentType.fromValue(json['contentType']);
    final name = json['symbologyName'];
    final gs1 = json['isGS1'];
    return QRGenBarcode(
      data: data,
      symbology: symbology,
      symbologyName: name is String && name.isNotEmpty ? name : null,
      rawBytes: _toStr(json['rawBytes']),
      contentType: contentType,
      isGS1: gs1 is bool ? gs1 : null,
      location: QRGenQuadrilateral.fromJson(json['location']),
      frameSize: QRGenSize.fromJson(json['frameSize']),
      orientation: _toDouble(json['orientation']),
      ecLevel: _toStr(json['ecLevel']),
      symbologyIdentifier: _toStr(json['symbologyIdentifier']),
      timestamp: _toTime(json['timestamp']),
    );
  }

  /// Like [QRGenBarcode.fromJson] but returns `null` for invalid input.
  static QRGenBarcode? tryFromJson(Object? json) {
    if (json is! Map) return null;
    try {
      return QRGenBarcode.fromJson(json.cast<String, Object?>());
    } on FormatException {
      return null;
    }
  }

  /// The SPEC JSON object.
  Map<String, Object?> toJson() => {
        'data': data,
        'symbology': symbology.id,
        'symbologyName': symbologyName,
        'rawBytes': rawBytes,
        'contentType': contentType.value,
        'isGS1': isGS1,
        'location': location.toJson(),
        'frameSize': frameSize.toJson(),
        'orientation': _jsonNum(orientation),
        'ecLevel': ecLevel,
        'symbologyIdentifier': symbologyIdentifier,
        'timestamp': timestamp.millisecondsSinceEpoch,
      };

  /// Key used by the duplicate filter and tracker: symbology + data.
  String get key => '${symbology.id}\u0000$data';

  @override
  String toString() => 'QRGenBarcode(${symbology.id}: $data)';
}

/// A barcode followed across frames in batch mode.
class QRGenTrackedBarcode extends QRGenBarcode {
  /// Creates a tracked barcode.
  QRGenTrackedBarcode({
    required this.id,
    required this.firstSeen,
    required this.lastSeen,
    required this.count,
    required super.data,
    required super.symbology,
    super.symbologyName,
    super.rawBytes,
    super.contentType,
    super.isGS1,
    super.location,
    super.frameSize,
    super.orientation,
    super.ecLevel,
    super.symbologyIdentifier,
    super.timestamp,
  });

  /// Wraps [barcode] with tracking information.
  factory QRGenTrackedBarcode.fromBarcode(
    QRGenBarcode barcode, {
    required String id,
    required DateTime firstSeen,
    required DateTime lastSeen,
    required int count,
  }) =>
      QRGenTrackedBarcode(
        id: id,
        firstSeen: firstSeen,
        lastSeen: lastSeen,
        count: count,
        data: barcode.data,
        symbology: barcode.symbology,
        symbologyName: barcode.symbologyName,
        rawBytes: barcode.rawBytes,
        contentType: barcode.contentType,
        isGS1: barcode.isGS1,
        location: barcode.location,
        frameSize: barcode.frameSize,
        orientation: barcode.orientation,
        ecLevel: barcode.ecLevel,
        symbologyIdentifier: barcode.symbologyIdentifier,
        timestamp: barcode.timestamp,
      );

  /// Stable id (derived from symbology and data by the QRGen trackers).
  final String id;

  /// When the code was first seen.
  final DateTime firstSeen;

  /// When the code was last seen.
  final DateTime lastSeen;

  /// Number of frames the code was seen in.
  final int count;

  /// Reads a SPEC tracked barcode. `id` defaults to `symbology:data`,
  /// `firstSeen`/`lastSeen` to the timestamp and `count` to 1.
  factory QRGenTrackedBarcode.fromJson(Map<String, Object?> json) {
    final base = QRGenBarcode.fromJson(json);
    final rawId = json['id'];
    final rawCount = json['count'];
    return QRGenTrackedBarcode.fromBarcode(
      base,
      id: rawId is String || rawId is num ? rawId.toString() : '${base.symbology.id}:${base.data}',
      firstSeen: json['firstSeen'] is num ? _toTime(json['firstSeen']) : base.timestamp,
      lastSeen: json['lastSeen'] is num ? _toTime(json['lastSeen']) : base.timestamp,
      count: rawCount is num && rawCount >= 1 ? rawCount.floor() : 1,
    );
  }

  /// Like [QRGenTrackedBarcode.fromJson] but returns `null` for invalid input.
  static QRGenTrackedBarcode? tryFromJson(Object? json) {
    if (json is! Map) return null;
    try {
      return QRGenTrackedBarcode.fromJson(json.cast<String, Object?>());
    } on FormatException {
      return null;
    }
  }

  @override
  Map<String, Object?> toJson() => {
        ...super.toJson(),
        'id': id,
        'firstSeen': firstSeen.millisecondsSinceEpoch,
        'lastSeen': lastSeen.millisecondsSinceEpoch,
        'count': count,
      };

  @override
  String toString() => 'QRGenTrackedBarcode($id, ${symbology.id}: $data, count: $count)';
}

double _toDouble(Object? v) => v is num && v.isFinite ? v.toDouble() : 0;

String _toStr(Object? v) => v is String ? v : '';

DateTime _toTime(Object? v) =>
    v is num && v.isFinite ? DateTime.fromMillisecondsSinceEpoch(v.round()) : DateTime.now();

/// Writes whole numbers as `int` so JSON matches other platforms (`10`, not `10.0`).
num _jsonNum(double v) => v == v.roundToDouble() && v.abs() < 9007199254740992 ? v.toInt() : v;
