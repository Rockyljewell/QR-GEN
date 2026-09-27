/// QRGen errors (SPEC section 4). Pure Dart.
library;

/// Error codes shared by every QRGen platform.
enum QRGenErrorCode {
  /// The user denied camera access.
  cameraPermissionDenied('camera-permission-denied'),

  /// No (matching) camera exists.
  cameraNotFound('camera-not-found'),

  /// Another app or component is using the camera.
  cameraInUse('camera-in-use'),

  /// The page is not served from a secure context (web).
  insecureContext('insecure-context'),

  /// The scanning engine or page could not be loaded.
  engineLoadFailed('engine-load-failed'),

  /// The feature is not supported on this device.
  unsupported('unsupported'),

  /// Anything else.
  unknown('unknown');

  const QRGenErrorCode(this.value);

  /// The SPEC string value, for example `camera-permission-denied`.
  final String value;

  /// Parses a SPEC value; unknown values become [unknown].
  static QRGenErrorCode fromValue(Object? value) {
    for (final c in values) {
      if (c.value == value) return c;
    }
    return unknown;
  }

  /// A default, human readable message.
  String get defaultMessage => switch (this) {
        cameraPermissionDenied => 'Camera permission was denied.',
        cameraNotFound => 'No camera was found on this device.',
        cameraInUse => 'The camera is in use by another app.',
        insecureContext => 'Camera access requires a secure (https) context.',
        engineLoadFailed => 'The scanning engine could not be loaded.',
        unsupported => 'This operation is not supported on this device.',
        unknown => 'An unknown error occurred.',
      };
}

/// An error reported through `onError`.
class QRGenError implements Exception {
  /// Creates an error; [message] defaults to [QRGenErrorCode.defaultMessage].
  QRGenError(this.code, [String? message])
      : message = message == null || message.isEmpty ? code.defaultMessage : message;

  /// Reads `{ "code": .., "message": .. }`.
  factory QRGenError.fromJson(Map<String, Object?> json) {
    final message = json['message'];
    return QRGenError(QRGenErrorCode.fromValue(json['code']), message is String ? message : null);
  }

  /// The SPEC error code.
  final QRGenErrorCode code;

  /// A human readable message.
  final String message;

  /// `{ "code": .., "message": .. }`.
  Map<String, Object?> toJson() => {'code': code.value, 'message': message};

  @override
  bool operator ==(Object other) => other is QRGenError && other.code == code && other.message == message;

  @override
  int get hashCode => Object.hash(code, message);

  @override
  String toString() => 'QRGenError(${code.value}): $message';
}

/// Maps a `mobile_scanner` `MobileScannerErrorCode` name (for example
/// `permissionDenied`) to a QRGen error code.
QRGenErrorCode errorCodeFromMobileScanner(String errorCodeName) => switch (errorCodeName) {
      'permissionDenied' => QRGenErrorCode.cameraPermissionDenied,
      'unsupported' => QRGenErrorCode.unsupported,
      _ => QRGenErrorCode.unknown,
    };
