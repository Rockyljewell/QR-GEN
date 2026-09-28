// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/options.dart';

/// The QRGen brand accent color.
const Color qrgenAccentColor = Color(0xFF2EC1CE);

/// A toast message; a new [id] restarts the animation.
@immutable
class QRGenToastData {
  /// Creates toast data.
  const QRGenToastData(this.id, this.text);

  /// Changes whenever a new toast should be shown.
  final int id;

  /// The text of the pill.
  final String text;
}

/// Scanner overlay: rounded corner-bracket viewfinder (or a scan line), a dim
/// mask outside it, highlight outlines for detected codes and a success toast
/// pill. It ignores pointer events.
class QRGenScannerOverlay extends StatelessWidget {
  /// Creates an overlay.
  const QRGenScannerOverlay({
    super.key,
    required this.viewfinder,
    this.viewfinderRect,
    this.accentColor = qrgenAccentColor,
    this.highlights = const [],
    this.toast,
    this.dimOutside = true,
  });

  /// Viewfinder style.
  final QRGenViewfinder viewfinder;

  /// Viewfinder rectangle in local coordinates; `null` hides it.
  final Rect? viewfinderRect;

  /// Accent color.
  final Color accentColor;

  /// Detected code outlines (four or more points each) in local coordinates.
  final List<List<Offset>> highlights;

  /// Toast to show, if any.
  final QRGenToastData? toast;

  /// Dim the area outside the viewfinder.
  final bool dimOutside;

  @override
  Widget build(BuildContext context) {
    final rect = viewfinderRect;
    return IgnorePointer(
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (rect != null && viewfinder != QRGenViewfinder.none)
            CustomPaint(
              painter: QRGenViewfinderPainter(
                rect: rect,
                color: accentColor,
                style: viewfinder,
                dimOutside: dimOutside,
              ),
            ),
          if (rect != null && viewfinder == QRGenViewfinder.line) _ScanLine(rect: rect, color: accentColor),
          if (highlights.isNotEmpty) CustomPaint(painter: QRGenHighlightPainter(highlights, color: accentColor)),
          if (toast != null)
            Positioned(
              top: 16,
              left: 16,
              right: 16,
              child: SafeArea(
                bottom: false,
                child: Center(child: _ToastPill(key: const ValueKey('qrgen-toast'), toast: toast!, accentColor: accentColor)),
              ),
            ),
        ],
      ),
    );
  }
}

/// Paints the dim mask and the rounded corner brackets of the viewfinder.
class QRGenViewfinderPainter extends CustomPainter {
  /// Creates the painter.
  QRGenViewfinderPainter({
    required this.rect,
    required this.color,
    this.style = QRGenViewfinder.frame,
    this.dimOutside = true,
    this.strokeWidth = 4,
  });

  /// Viewfinder rectangle.
  final Rect rect;

  /// Bracket color.
  final Color color;

  /// `frame` draws brackets; `line` only the mask (the line is animated separately).
  final QRGenViewfinder style;

  /// Whether to dim the outside.
  final bool dimOutside;

  /// Bracket stroke width.
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final shortest = math.min(rect.width, rect.height);
    final radius = math.min(18.0, shortest / 6);
    if (dimOutside) {
      final mask = Path()
        ..fillType = PathFillType.evenOdd
        ..addRect(Offset.zero & size)
        ..addRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)));
      canvas.drawPath(mask, Paint()..color = Colors.black.withAlpha(82));
    }
    if (style != QRGenViewfinder.frame) return;

    final length = math.max(16.0, math.min(34.0, shortest / 4));
    final r = math.min(radius, length * 0.6);
    final arc = Radius.circular(r);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    final path = Path()
      // Top-left.
      ..moveTo(rect.left, rect.top + length)
      ..lineTo(rect.left, rect.top + r)
      ..arcToPoint(Offset(rect.left + r, rect.top), radius: arc)
      ..lineTo(rect.left + length, rect.top)
      // Top-right.
      ..moveTo(rect.right - length, rect.top)
      ..lineTo(rect.right - r, rect.top)
      ..arcToPoint(Offset(rect.right, rect.top + r), radius: arc)
      ..lineTo(rect.right, rect.top + length)
      // Bottom-right.
      ..moveTo(rect.right, rect.bottom - length)
      ..lineTo(rect.right, rect.bottom - r)
      ..arcToPoint(Offset(rect.right - r, rect.bottom), radius: arc)
      ..lineTo(rect.right - length, rect.bottom)
      // Bottom-left.
      ..moveTo(rect.left + length, rect.bottom)
      ..lineTo(rect.left + r, rect.bottom)
      ..arcToPoint(Offset(rect.left, rect.bottom - r), radius: arc)
      ..lineTo(rect.left, rect.bottom - length);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(QRGenViewfinderPainter oldDelegate) =>
      oldDelegate.rect != rect ||
      oldDelegate.color != color ||
      oldDelegate.style != style ||
      oldDelegate.dimOutside != dimOutside ||
      oldDelegate.strokeWidth != strokeWidth;
}

/// Paints filled, outlined polygons around detected codes.
class QRGenHighlightPainter extends CustomPainter {
  /// Creates the painter.
  QRGenHighlightPainter(this.polygons, {required this.color});

  /// Polygons in local coordinates.
  final List<List<Offset>> polygons;

  /// Outline color (the fill uses it with low alpha).
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()..color = color.withAlpha(46);
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeJoin = StrokeJoin.round;
    for (final points in polygons) {
      if (points.length < 3) continue;
      final path = Path()..addPolygon(points, true);
      canvas
        ..drawPath(path, fill)
        ..drawPath(path, stroke);
    }
  }

  @override
  bool shouldRepaint(QRGenHighlightPainter oldDelegate) =>
      oldDelegate.color != color || !_samePolygons(oldDelegate.polygons, polygons);

  static bool _samePolygons(List<List<Offset>> a, List<List<Offset>> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].length != b[i].length) return false;
      for (var j = 0; j < a[i].length; j++) {
        if (a[i][j] != b[i][j]) return false;
      }
    }
    return true;
  }
}

class _ScanLine extends StatefulWidget {
  const _ScanLine({required this.rect, required this.color});

  final Rect rect;
  final Color color;

  @override
  State<_ScanLine> createState() => _ScanLineState();
}

class _ScanLineState extends State<_ScanLine> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
    lowerBound: 0.35,
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rect = widget.rect;
    final inset = math.min(16.0, rect.width * 0.05);
    return Positioned(
      left: rect.left + inset,
      width: math.max(0, rect.width - inset * 2),
      top: rect.center.dy - 1,
      height: 2,
      child: FadeTransition(
        opacity: _pulse,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: widget.color,
            borderRadius: BorderRadius.circular(1),
            boxShadow: [BoxShadow(color: widget.color, blurRadius: 8)],
          ),
        ),
      ),
    );
  }
}

class _ToastPill extends StatefulWidget {
  const _ToastPill({super.key, required this.toast, required this.accentColor});

  final QRGenToastData toast;
  final Color accentColor;

  @override
  State<_ToastPill> createState() => _ToastPillState();
}

class _ToastPillState extends State<_ToastPill> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 180),
    reverseDuration: const Duration(milliseconds: 260),
  );
  late final CurvedAnimation _curved = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
  late final Animation<Offset> _slide =
      Tween<Offset>(begin: const Offset(0, -0.3), end: Offset.zero).animate(_curved);
  Timer? _hide;

  @override
  void initState() {
    super.initState();
    _show();
  }

  @override
  void didUpdateWidget(_ToastPill oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.toast.id != widget.toast.id) _show();
  }

  void _show() {
    _hide?.cancel();
    unawaited(_controller.forward(from: 0));
    _hide = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) unawaited(_controller.reverse());
    });
  }

  @override
  void dispose() {
    _hide?.cancel();
    _curved.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _curved,
      child: SlideTransition(
        position: _slide,
        child: Semantics(
          liveRegion: true,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xE6111827),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(color: widget.accentColor, shape: BoxShape.circle),
                    child: const SizedBox(width: 8, height: 8),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      widget.toast.text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
