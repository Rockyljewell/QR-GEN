/**
 * Scanner overlay built from plain React Native views: rounded corner-bracket
 * viewfinder (or a scan line), highlight frames for detected codes and a
 * success toast pill.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { withAlpha } from './color';
import type { Rect, Size, ViewfinderStyle } from './types';

/** A highlight frame in view coordinates. */
export interface OverlayHighlight {
  key: string;
  rect: Rect;
}

/** A toast message; a new `id` restarts the animation. */
export interface OverlayToast {
  id: number;
  text: string;
}

/** Props of {@link ScannerOverlay}. */
export interface ScannerOverlayProps {
  /** Size of the scanner view; nothing is drawn until it is known. */
  viewSize: Size | null;
  viewfinder: ViewfinderStyle;
  /** Viewfinder rectangle in view points. */
  viewfinderRect: Rect | null;
  accentColor: string;
  highlights: readonly OverlayHighlight[];
  toast: OverlayToast | null;
  /** Dim the area outside the viewfinder. Default true. */
  dimOutside?: boolean;
}

const CORNER_THICKNESS = 4;
const MASK_COLOR = 'rgba(0, 0, 0, 0.32)';

function Corners({ rect, color }: { rect: Rect; color: string }) {
  const length = Math.max(16, Math.min(34, Math.min(rect.width, rect.height) / 4));
  const radius = Math.min(18, length * 0.6);
  const base = { position: 'absolute' as const, width: length, height: length, borderColor: color };
  const t = CORNER_THICKNESS;
  // Brackets sit centered on the viewfinder edge.
  const x0 = rect.x - t / 2;
  const y0 = rect.y - t / 2;
  const x1 = rect.x + rect.width + t / 2 - length;
  const y1 = rect.y + rect.height + t / 2 - length;
  return (
    <>
      <View style={[base, { left: x0, top: y0, borderTopWidth: t, borderLeftWidth: t, borderTopLeftRadius: radius }]} />
      <View style={[base, { left: x1, top: y0, borderTopWidth: t, borderRightWidth: t, borderTopRightRadius: radius }]} />
      <View style={[base, { left: x0, top: y1, borderBottomWidth: t, borderLeftWidth: t, borderBottomLeftRadius: radius }]} />
      <View style={[base, { left: x1, top: y1, borderBottomWidth: t, borderRightWidth: t, borderBottomRightRadius: radius }]} />
    </>
  );
}

function Mask({ rect, view }: { rect: Rect; view: Size }) {
  const bottomTop = rect.y + rect.height;
  const rightLeft = rect.x + rect.width;
  return (
    <>
      <View style={[styles.mask, { left: 0, top: 0, width: view.width, height: Math.max(0, rect.y) }]} />
      <View style={[styles.mask, { left: 0, top: bottomTop, width: view.width, height: Math.max(0, view.height - bottomTop) }]} />
      <View style={[styles.mask, { left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.height }]} />
      <View style={[styles.mask, { left: rightLeft, top: rect.y, width: Math.max(0, view.width - rightLeft), height: rect.height }]} />
    </>
  );
}

function ScanLine({ rect, color }: { rect: Rect; color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  const inset = Math.min(16, rect.width * 0.05);
  return (
    <Animated.View
      style={[
        styles.line,
        {
          left: rect.x + inset,
          width: Math.max(0, rect.width - inset * 2),
          top: rect.y + rect.height / 2 - 1,
          backgroundColor: color,
          shadowColor: color,
          opacity,
        },
      ]}
    />
  );
}

function Toast({ toast, accentColor }: { toast: OverlayToast; accentColor: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(-8);
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]),
      Animated.delay(1400),
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [toast.id, opacity, translateY]);
  return (
    <Animated.View style={[styles.toast, { opacity, transform: [{ translateY }] }]} accessibilityLiveRegion="polite">
      <View style={[styles.toastDot, { backgroundColor: accentColor }]} />
      <Text style={styles.toastText} numberOfLines={1}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

/**
 * Draws the scanner overlay. It never intercepts touches.
 */
export function ScannerOverlay(props: ScannerOverlayProps) {
  const { viewSize, viewfinder, viewfinderRect, accentColor, highlights, toast, dimOutside = true } = props;
  const fill = withAlpha(accentColor, 0.18);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {viewSize && viewfinderRect && viewfinder !== 'none' ? (
        <>
          {dimOutside ? <Mask rect={viewfinderRect} view={viewSize} /> : null}
          {viewfinder === 'frame' ? <Corners rect={viewfinderRect} color={accentColor} /> : null}
          {viewfinder === 'line' ? <ScanLine rect={viewfinderRect} color={accentColor} /> : null}
        </>
      ) : null}
      {highlights.map((h) => (
        <View
          key={h.key}
          style={[
            styles.highlight,
            {
              left: h.rect.x - 4,
              top: h.rect.y - 4,
              width: h.rect.width + 8,
              height: h.rect.height + 8,
              borderColor: accentColor,
              backgroundColor: fill,
            },
          ]}
        />
      ))}
      {toast ? (
        <View style={styles.toastRow}>
          <Toast toast={toast} accentColor={accentColor} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: MASK_COLOR,
  },
  line: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 8,
  },
  toastRow: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
  },
  toastDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
});
