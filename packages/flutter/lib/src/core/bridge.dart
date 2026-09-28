// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/// Embed bridge (SPEC section 5): URL building, message parsing and
/// host-to-page commands for the hosted WebView scanner. Pure Dart.
library;

import 'dart:convert';

import 'barcode.dart';
import 'error.dart';
import 'options.dart';

/// The hosted embed page. Override it to self-host.
const String qrgenDefaultEmbedUrl = 'https://rockyljewell.github.io/QR-GEN/embed/';

/// Name of the `webview_flutter` JavaScript channel the embed page posts to
/// (`window.QRGenBridge.postMessage(json)`).
const String qrgenBridgeChannelName = 'QRGenBridge';

/// Envelope `source` of page-to-host messages.
const String qrgenBridgeSource = 'qrgen';

/// Envelope `source` of host-to-page `postMessage` commands.
const String qrgenHostSource = 'qrgen-host';

/// Builds the embed URL with [options] in the query string (SPEC section 5).
/// Lists stay comma-separated, other values are percent-encoded. An existing
/// query string or fragment on [embedUrl] is preserved; [extra] parameters
/// are appended last and override options with the same name.
String buildEmbedUrl(
  QRGenScannerOptions options, {
  String? embedUrl,
  Map<String, String> extra = const {},
}) {
  final base = embedUrl == null || embedUrl.isEmpty ? qrgenDefaultEmbedUrl : embedUrl;
  final hashIndex = base.indexOf('#');
  final fragment = hashIndex >= 0 ? base.substring(hashIndex) : '';
  final withoutFragment = hashIndex >= 0 ? base.substring(0, hashIndex) : base;

  final params = {...options.toQueryParameters(), ...extra};
  if (params.isEmpty) return base;
  String encodeValue(String key, String value) =>
      key == 'symbologies' || key == 'scanArea' ? value.split(',').map(Uri.encodeComponent).join(',') : Uri.encodeComponent(value);
  final query = params.entries.map((e) => '${Uri.encodeComponent(e.key)}=${encodeValue(e.key, e.value)}').join('&');

  final String separator;
  if (!withoutFragment.contains('?')) {
    separator = '?';
  } else if (withoutFragment.endsWith('?') || withoutFragment.endsWith('&')) {
    separator = '';
  } else {
    separator = '&';
  }
  return '$withoutFragment$separator$query$fragment';
}

/// [buildEmbedUrl] as a [Uri].
Uri buildEmbedUri(QRGenScannerOptions options, {String? embedUrl, Map<String, String> extra = const {}}) =>
    Uri.parse(buildEmbedUrl(options, embedUrl: embedUrl, extra: extra));

/// A parsed page-to-host message.
sealed class QRGenBridgeMessage {
  const QRGenBridgeMessage(this.version);

  /// Envelope version (1).
  final int version;
}

/// The page is ready and the camera is starting.
final class QRGenReadyMessage extends QRGenBridgeMessage {
  /// Creates a ready message.
  const QRGenReadyMessage([super.version = 1]);
}

/// New codes were scanned.
final class QRGenScanMessage extends QRGenBridgeMessage {
  /// Creates a scan message.
  const QRGenScanMessage(this.barcodes, [super.version = 1]);

  /// The scanned codes (invalid entries are skipped).
  final List<QRGenBarcode> barcodes;
}

/// Batch mode: the tracked codes changed.
final class QRGenTrackMessage extends QRGenBridgeMessage {
  /// Creates a track message.
  const QRGenTrackMessage(this.tracked, [super.version = 1]);

  /// Every tracked code.
  final List<QRGenTrackedBarcode> tracked;
}

/// The page reported an error.
final class QRGenErrorMessage extends QRGenBridgeMessage {
  /// Creates an error message.
  const QRGenErrorMessage(this.error, [super.version = 1]);

  /// The error.
  final QRGenError error;
}

/// Parses a page-to-host message: the JSON string the page posts, or an
/// already decoded map. Returns `null` for anything that is not a valid
/// `source: "qrgen"` envelope, so unrelated messages are ignored safely.
QRGenBridgeMessage? parseBridgeMessage(Object? raw) {
  Object? value = raw;
  if (raw is String) {
    try {
      value = jsonDecode(raw);
    } on FormatException {
      return null;
    }
  }
  if (value is! Map) return null;
  final map = value.cast<String, Object?>();
  final type = map['type'];
  if (map['source'] != qrgenBridgeSource || type is! String) return null;
  final rawVersion = map['version'];
  final version = rawVersion is num ? rawVersion.toInt() : 1;
  switch (type) {
    case 'ready':
      return QRGenReadyMessage(version);
    case 'scan':
      final list = map['barcodes'];
      final barcodes = list is List ? list.map(QRGenBarcode.tryFromJson).whereType<QRGenBarcode>().toList() : <QRGenBarcode>[];
      return QRGenScanMessage(barcodes, version);
    case 'track':
      final list = map['tracked'];
      final tracked = list is List
          ? list.map(QRGenTrackedBarcode.tryFromJson).whereType<QRGenTrackedBarcode>().toList()
          : <QRGenTrackedBarcode>[];
      return QRGenTrackMessage(tracked, version);
    case 'error':
      return QRGenErrorMessage(QRGenError.fromJson(map), version);
    default:
      return null;
  }
}

/// Host-to-page command types.
enum QRGenBridgeCommandType {
  /// Start (or restart) the camera.
  start,

  /// Stop the camera.
  stop,

  /// Keep the camera open but stop decoding.
  pause,

  /// Resume decoding.
  resume,

  /// Turn the torch on or off (`value`).
  torch,
}

/// A host-to-page command (SPEC section 5).
final class QRGenBridgeCommand {
  /// Creates a command.
  const QRGenBridgeCommand(this.type, {this.value});

  /// `start`.
  static const QRGenBridgeCommand start = QRGenBridgeCommand(QRGenBridgeCommandType.start);

  /// `stop`.
  static const QRGenBridgeCommand stop = QRGenBridgeCommand(QRGenBridgeCommandType.stop);

  /// `pause`.
  static const QRGenBridgeCommand pause = QRGenBridgeCommand(QRGenBridgeCommandType.pause);

  /// `resume`.
  static const QRGenBridgeCommand resume = QRGenBridgeCommand(QRGenBridgeCommandType.resume);

  /// `torch` with `value`.
  factory QRGenBridgeCommand.torch(bool on) => QRGenBridgeCommand(QRGenBridgeCommandType.torch, value: on);

  /// The command type.
  final QRGenBridgeCommandType type;

  /// The optional value (`torch`).
  final bool? value;

  /// `{ "type": .., "value"?: .. }`.
  Map<String, Object?> toJson() => {'type': type.name, if (value != null) 'value': value};

  /// JavaScript for `WebViewController.runJavaScript`.
  String toScript() => 'window.qrgen && window.qrgen.command(${jsonEncode(toJson())});';

  /// The `postMessage` form: `{ "source": "qrgen-host", ...command }`.
  String toPostMessage() => jsonEncode({'source': qrgenHostSource, ...toJson()});

  @override
  bool operator ==(Object other) => other is QRGenBridgeCommand && other.type == type && other.value == value;

  @override
  int get hashCode => Object.hash(type, value);

  @override
  String toString() => 'QRGenBridgeCommand(${type.name}${value == null ? '' : ', $value'})';
}
