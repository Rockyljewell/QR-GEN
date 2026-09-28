// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// qrgen_flutter example: a scanner screen with a mode switch, a torch toggle,
// a back end switch (mobile_scanner or WebView) and a result list.
//
// Generate the platform folders with `flutter create .` in this directory,
// then add the camera permissions described in the package README.
import 'package:flutter/material.dart';
import 'package:qrgen_flutter/qrgen_flutter.dart';

void main() => runApp(const QRGenExampleApp());

/// The example app.
class QRGenExampleApp extends StatelessWidget {
  /// Creates the app.
  const QRGenExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'QRGen scanner',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: qrgenAccentColor, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: const ScanPage(),
    );
  }
}

enum _Backend { native, web }

/// Scanner screen with controls and results.
class ScanPage extends StatefulWidget {
  /// Creates the page.
  const ScanPage({super.key});

  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  final QRGenScannerController _scanner = QRGenScannerController();
  final QRGenWebScannerController _webScanner = QRGenWebScannerController();
  final List<QRGenBarcode> _results = [];
  List<QRGenTrackedBarcode> _tracked = const [];
  QRGenScanMode _mode = QRGenScanMode.continuous;
  _Backend _backend = _Backend.native;
  bool _torch = false;
  QRGenError? _error;

  @override
  void dispose() {
    _scanner.dispose();
    _webScanner.dispose();
    super.dispose();
  }

  QRGenScannerOptions get _options => QRGenScannerOptions(mode: _mode, torch: _torch);

  void _onScan(List<QRGenBarcode> barcodes) {
    setState(() {
      _error = null;
      _results.insertAll(0, barcodes);
      if (_results.length > 50) _results.removeRange(50, _results.length);
    });
  }

  void _onTrack(List<QRGenTrackedBarcode> tracked) => setState(() => _tracked = tracked);

  void _onError(QRGenError error) => setState(() => _error = error);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('QRGen scanner'),
        actions: [
          IconButton(
            tooltip: _torch ? 'Torch off' : 'Torch on',
            icon: Icon(_torch ? Icons.flashlight_on : Icons.flashlight_off),
            onPressed: () => setState(() => _torch = !_torch),
          ),
          IconButton(
            tooltip: _backend == _Backend.native ? 'Use the WebView scanner' : 'Use the native scanner',
            icon: Icon(_backend == _Backend.native ? Icons.public : Icons.memory),
            onPressed: () => setState(() => _backend = _backend == _Backend.native ? _Backend.web : _Backend.native),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: _backend == _Backend.native
                ? QRGenScanner(
                    controller: _scanner,
                    options: _options,
                    onScan: _onScan,
                    onTrack: _onTrack,
                    onError: _onError,
                  )
                : QRGenWebScanner(
                    controller: _webScanner,
                    options: _options,
                    onScan: _onScan,
                    onTrack: _onTrack,
                    onError: _onError,
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SegmentedButton<QRGenScanMode>(
              segments: const [
                ButtonSegment(value: QRGenScanMode.single, label: Text('Single')),
                ButtonSegment(value: QRGenScanMode.continuous, label: Text('Continuous')),
                ButtonSegment(value: QRGenScanMode.batch, label: Text('Batch')),
              ],
              selected: {_mode},
              onSelectionChanged: (selection) => setState(() {
                _mode = selection.first;
                _tracked = const [];
              }),
            ),
          ),
          if (_mode == QRGenScanMode.single && _backend == _Backend.native)
            TextButton.icon(onPressed: _scanner.start, icon: const Icon(Icons.refresh), label: const Text('Scan again')),
          if (_mode == QRGenScanMode.batch) Text('${_tracked.length} code(s) in view', style: theme.textTheme.bodySmall),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text('${_error!.code.value}: ${_error!.message}', style: TextStyle(color: theme.colorScheme.error)),
            ),
          Expanded(
            flex: 2,
            child: _results.isEmpty
                ? const Center(child: Text('Point the camera at a barcode or QR code.'))
                : ListView.separated(
                    itemCount: _results.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final b = _results[index];
                      return ListTile(
                        dense: true,
                        title: Text(b.data, maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(b.symbologyName),
                        leading: const Icon(Icons.qr_code_2),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
