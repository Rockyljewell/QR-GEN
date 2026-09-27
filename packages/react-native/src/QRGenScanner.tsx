/**
 * `QRGenScanner`: native-performance scanner built on react-native-vision-camera 4.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Dimensions,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { CameraDevice, CameraRuntimeError, Code, CodeScannerFrame } from 'react-native-vision-camera';
import { quadrilateralBounds } from './barcode';
import { createQRGenError, toQRGenError } from './errors';
import { playScanFeedback, type BeepHandler } from './feedback';
import { defaultViewfinderRect, frameToViewTransform, quadrilateralToView } from './geometry';
import { ScannerOverlay, type OverlayHighlight, type OverlayToast } from './ScannerOverlay';
import { ScanSession } from './session';
import {
  isLinearOnly,
  resolveSymbologies,
  symbologyName,
  toVisionCameraCodeTypes,
  visionCameraSupportedSymbologies,
  type PlatformInfo,
  type SymbologyId,
} from './symbologies';
import { barcodeKey } from './duplicateFilter';
import { convertVisionCameraCodes, selectBarcodes } from './visionCameraAdapter';
import {
  DEFAULT_SCANNER_OPTIONS,
  QRGEN_ACCENT_COLOR,
  type Barcode,
  type QRGenError,
  type QRGenErrorCode,
  type Rect,
  type ScannerOptions,
  type Size,
  type TrackedBarcode,
} from './types';

declare const require: (id: string) => unknown;

type VisionCameraModule = typeof import('react-native-vision-camera');

let visionCameraCache: { module: VisionCameraModule | null; error: unknown } | undefined;

/**
 * Loads react-native-vision-camera lazily. Returns `null` when the package is
 * missing or its native module is not linked (for example in Expo Go), so the
 * rest of qrgen-react-native (including `QRGenWebScanner`) keeps working.
 */
export function loadVisionCamera(): VisionCameraModule | null {
  if (!visionCameraCache) {
    try {
      visionCameraCache = { module: require('react-native-vision-camera') as VisionCameraModule, error: null };
    } catch (error) {
      visionCameraCache = { module: null, error };
    }
  }
  return visionCameraCache.module;
}

/** True when react-native-vision-camera and its native module are available. */
export function isVisionCameraAvailable(): boolean {
  return loadVisionCamera() !== null;
}

/** The QRGen ids `QRGenScanner` can read on this device. */
export function supportedSymbologies(): SymbologyId[] {
  return visionCameraSupportedSymbologies({ os: Platform.OS, version: Platform.Version });
}

/** Props of {@link QRGenScanner}. */
export interface QRGenScannerProps extends Omit<ScannerOptions, 'beep'> {
  /**
   * Play a sound on scan. `true` (default) plays the handler registered with
   * `setBeepHandler` (silent when none is registered); a function is called
   * directly; `false` disables it.
   */
  beep?: boolean | BeepHandler;
  /** Run the camera. Set it to `false` when the screen is not visible (for example with `useIsFocused()`). Default `true`. */
  isActive?: boolean;
  /** Called with newly scanned codes (after the duplicate filter). */
  onScan?: (barcodes: Barcode[]) => void;
  /** Batch mode: called with every tracked code whenever the tracked set changes. */
  onTrack?: (tracked: TrackedBarcode[]) => void;
  /** Called with `{ code, message }` errors (SPEC error codes). */
  onError?: (error: QRGenError) => void;
  /** Called once the camera is initialized. */
  onReady?: () => void;
  /** Accent color of the viewfinder, highlights and toast dot. Default `#2EC1CE`. */
  accentColor?: string;
  /** Show the success toast pill. Default `true`. */
  showToast?: boolean;
  /** Draw highlight frames around detected codes. Default `true`. */
  showHighlights?: boolean;
  /** Rendered instead of the camera when it cannot run (permission denied, no camera, missing native module). */
  fallback?: React.ReactNode;
  /** Rendered above the camera and overlay (buttons, hints, ...). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Imperative handle of {@link QRGenScanner} (use with `ref`). */
export interface QRGenScannerHandle {
  /** Starts (or restarts after `stop` or a `single` mode scan) the camera. */
  start(): void;
  /** Stops the camera. */
  stop(): void;
  /** Keeps the preview running but ignores codes. */
  pause(): void;
  /** Resumes after `pause`, `stop` or a `single` mode scan. */
  resume(): void;
  /** Clears duplicate history and tracked codes, and resumes. */
  reset(): void;
  /** Turns the flashlight on or off. */
  setTorch(on: boolean): void;
  /** The QRGen ids this back end can read on this device. */
  supportedSymbologies(): SymbologyId[];
}

type RunState = 'running' | 'paused' | 'stopped';

const HIGHLIGHT_LINGER_MS = 280;
const BATCH_TICK_MS = 100;

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function toastText(barcodes: readonly Barcode[]): string {
  if (barcodes.length === 1) {
    const b = barcodes[0]!;
    return `${b.symbologyName || symbologyName(b.symbology)} · ${truncate(b.data, 48)}`;
  }
  return `${barcodes.length} codes scanned`;
}

function DefaultFallback({ error, onOpenSettings }: { error: QRGenError | null; onOpenSettings?: () => void }) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>{error ? error.message : 'Starting camera…'}</Text>
      {onOpenSettings ? (
        <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.fallbackButton}>
          <Text style={styles.fallbackButtonText}>Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const noopHandle: QRGenScannerHandle = {
  start() {},
  stop() {},
  pause() {},
  resume() {},
  reset() {},
  setTorch() {},
  supportedSymbologies: () => [],
};

/** Rendered when vision-camera is missing: reports `engine-load-failed` once. */
const VisionCameraUnavailable = forwardRef<QRGenScannerHandle, QRGenScannerProps>(function VisionCameraUnavailable(props, ref) {
  useImperativeHandle(ref, () => noopHandle, []);
  const error = useMemo(
    () =>
      createQRGenError(
        'engine-load-failed',
        'react-native-vision-camera is not installed or its native module is not linked (Expo Go does not include it). Use a development build, or QRGenWebScanner.',
      ),
    [],
  );
  const onError = props.onError;
  useEffect(() => {
    onError?.(error);
    // Report once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={[styles.container, props.style]}>{props.fallback ?? <DefaultFallback error={error} />}</View>;
});

interface InnerProps extends QRGenScannerProps {
  vc: VisionCameraModule;
}

const VisionCameraScanner = forwardRef<QRGenScannerHandle, InnerProps>(function VisionCameraScanner(props, ref) {
  const { vc } = props;
  const latest = useRef(props);
  latest.current = props;

  const platform = useMemo<PlatformInfo>(() => ({ os: Platform.OS, version: Platform.Version }), []);
  const symbologyKey = (props.symbologies ?? DEFAULT_SCANNER_OPTIONS.symbologies).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const requested = useMemo(() => resolveSymbologies(props.symbologies), [symbologyKey]);
  const codeTypes = useMemo(() => toVisionCameraCodeTypes(requested, platform), [requested, platform]);
  const mode = props.mode ?? DEFAULT_SCANNER_OPTIONS.mode;
  const duplicateFilter = props.duplicateFilter ?? DEFAULT_SCANNER_OPTIONS.duplicateFilter;
  const maxResults = props.maxResults ?? (mode === 'batch' ? DEFAULT_SCANNER_OPTIONS.batchMaxResults : DEFAULT_SCANNER_OPTIONS.maxResults);
  const viewfinder = props.viewfinder ?? (isLinearOnly(requested) ? 'line' : 'frame');
  const accentColor = props.accentColor ?? QRGEN_ACCENT_COLOR;
  const camera = props.camera ?? DEFAULT_SCANNER_OPTIONS.camera;
  const isActiveProp = props.isActive ?? true;

  const [runState, setRunState] = useState<RunState>('running');
  const [torchOn, setTorchOn] = useState<boolean>(props.torch ?? false);
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [highlights, setHighlights] = useState<OverlayHighlight[]>([]);
  const [toast, setToast] = useState<OverlayToast | null>(null);
  const [appActive, setAppActive] = useState<boolean>(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [error, setError] = useState<QRGenError | null>(null);

  const sessionRef = useRef<ScanSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ScanSession({ mode, duplicateFilter });
  const session = sessionRef.current;

  const emitError = useCallback((code: QRGenErrorCode | QRGenError, message?: string) => {
    const err = typeof code === 'string' ? createQRGenError(code, message) : code;
    setError(err);
    latest.current.onError?.(err);
  }, []);

  // Options -> session. Changing the mode also restarts a finished `single` scan.
  const previousMode = useRef(mode);
  useEffect(() => {
    session.configure({ mode, duplicateFilter });
    if (previousMode.current !== mode) {
      previousMode.current = mode;
      setRunState('running');
    }
  }, [session, mode, duplicateFilter]);

  // Torch prop -> state (the ref's setTorch can override until the prop changes).
  useEffect(() => {
    setTorchOn(props.torch ?? false);
  }, [props.torch]);

  // Pause the camera while the app is in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Permission.
  const { hasPermission, requestPermission } = vc.useCameraPermission();
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>(hasPermission ? 'granted' : 'unknown');
  useEffect(() => {
    if (hasPermission) {
      setPermission('granted');
      setError((e) => (e?.code === 'camera-permission-denied' ? null : e));
      return;
    }
    let cancelled = false;
    requestPermission()
      .then((granted) => {
        if (cancelled) return;
        setPermission(granted ? 'granted' : 'denied');
        if (!granted) emitError('camera-permission-denied', 'Camera permission was denied. Enable it in Settings to scan.');
      })
      .catch((e: unknown) => {
        if (!cancelled) emitError(toQRGenError(e, 'camera-permission-denied'));
      });
    return () => {
      cancelled = true;
    };
  }, [hasPermission, requestPermission, emitError]);

  // Device.
  const position = camera === 'front' ? 'front' : 'back';
  const devices = vc.useCameraDevices();
  const byPosition = vc.useCameraDevice(position);
  const device: CameraDevice | undefined =
    camera === 'front' || camera === 'back' ? byPosition : devices.find((d) => d.id === camera) ?? byPosition;
  const mirrored = device?.position === 'front';

  useEffect(() => {
    if (permission === 'granted' && !device) emitError('camera-not-found', `No ${camera} camera was found on this device.`);
  }, [permission, device, camera, emitError]);

  useEffect(() => {
    if (codeTypes.length === 0) {
      emitError('unsupported', `None of the requested symbologies (${requested.join(', ') || 'none'}) can be read by react-native-vision-camera on ${Platform.OS}.`);
    }
  }, [codeTypes, requested, emitError]);

  const hasTorch = device?.hasTorch ?? false;
  useEffect(() => {
    if (torchOn && device && !hasTorch) emitError('unsupported', 'This camera has no torch.');
  }, [torchOn, device, hasTorch, emitError]);

  const canRun = permission === 'granted' && device != null && codeTypes.length > 0;
  const cameraActive = canRun && isActiveProp && appActive && runState !== 'stopped';

  // Values read by the frame callback.
  const live = useRef({ cameraActive, runState, requested, maxResults, mirrored, mode });
  live.current = { cameraActive, runState, requested, maxResults, mirrored, mode };
  const viewSizeRef = useRef<Size | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);

  const showHighlightsFor = useCallback((list: readonly Barcode[], linger: boolean) => {
    if (latest.current.showHighlights === false) return;
    const view = viewSizeRef.current;
    if (!view) return;
    const next = list.map((b, i) => {
      const t = frameToViewTransform(b.frameSize, view, { resizeMode: 'cover', mirrored: live.current.mirrored });
      const rect = quadrilateralBounds(quadrilateralToView(b.location, t));
      const key = 'id' in b ? String((b as TrackedBarcode).id) : `${barcodeKey(b)}#${i}`;
      return { key, rect };
    });
    setHighlights(next);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    if (linger && next.length > 0) {
      highlightTimer.current = setTimeout(() => setHighlights([]), HIGHLIGHT_LINGER_MS);
    }
  }, []);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const onCodeScanned = useCallback(
    (codes: Code[], frame: CodeScannerFrame) => {
      const state = live.current;
      if (!state.cameraActive || state.runState !== 'running') return;
      const now = Date.now();
      const window = Dimensions.get('window');
      const view = viewSizeRef.current ?? { width: window.width, height: window.height };
      const converted = convertVisionCameraCodes(codes, frame, { requested: state.requested, platform, viewSize: view, timestamp: now });
      const barcodes = selectBarcodes(converted, { scanArea: latest.current.scanArea, maxResults: state.maxResults });
      if (barcodes.length > 0) {
        const fs = barcodes[0]!.frameSize;
        setFrameSize((prev) => (prev && prev.width === fs.width && prev.height === fs.height ? prev : fs));
      }
      const result = session.process(barcodes, now);
      if (state.mode === 'batch') {
        if (result.tracked) showHighlightsFor(result.tracked, false);
      } else if (barcodes.length > 0) {
        showHighlightsFor(barcodes, true);
      }
      const p = latest.current;
      if (result.scanned.length > 0) {
        playScanFeedback(p.beep ?? DEFAULT_SCANNER_OPTIONS.beep, p.vibrate ?? DEFAULT_SCANNER_OPTIONS.vibrate);
        if (p.showToast !== false) {
          toastId.current += 1;
          setToast({ id: toastId.current, text: toastText(result.scanned) });
        }
        p.onScan?.(result.scanned);
      }
      if (result.tracked) p.onTrack?.(result.tracked);
      if (result.stop) setRunState('stopped');
    },
    [platform, session, showHighlightsFor],
  );

  // vision-camera throws for an empty type list, so keep a placeholder when nothing is supported (the camera is not rendered then).
  const codeScanner = vc.useCodeScanner({ codeTypes: codeTypes.length > 0 ? codeTypes : ['qr'], onCodeScanned });

  // Batch mode: drop codes that left the frame even when no new frames with codes arrive.
  useEffect(() => {
    if (mode !== 'batch' || !cameraActive) return;
    const id = setInterval(() => {
      const tracked = session.tick(Date.now());
      if (tracked) {
        showHighlightsFor(tracked, false);
        latest.current.onTrack?.(tracked);
      }
    }, BATCH_TICK_MS);
    return () => clearInterval(id);
  }, [mode, cameraActive, session, showHighlightsFor]);

  // Clear highlights whenever the camera stops.
  useEffect(() => {
    if (!cameraActive) setHighlights([]);
  }, [cameraActive]);

  useImperativeHandle(
    ref,
    () => ({
      start() {
        session.resume();
        setRunState('running');
      },
      stop() {
        setRunState('stopped');
      },
      pause() {
        setRunState('paused');
      },
      resume() {
        session.resume();
        setRunState('running');
      },
      reset() {
        session.reset();
        setHighlights([]);
        setRunState('running');
      },
      setTorch(on: boolean) {
        setTorchOn(on);
      },
      supportedSymbologies: () => visionCameraSupportedSymbologies(platform),
    }),
    [session, platform],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    viewSizeRef.current = { width, height };
    setViewSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const onCameraError = useCallback((e: CameraRuntimeError) => emitError(toQRGenError(e)), [emitError]);
  const onInitialized = useCallback(() => {
    setError(null);
    latest.current.onReady?.();
  }, []);

  const viewfinderRect = useMemo<Rect | null>(() => {
    if (!viewSize || viewfinder === 'none') return null;
    const area = props.scanArea;
    if (area && frameSize) {
      const t = frameToViewTransform(frameSize, viewSize, { resizeMode: 'cover', mirrored });
      const q = quadrilateralToView(
        {
          topLeft: { x: area.x * frameSize.width, y: area.y * frameSize.height },
          topRight: { x: (area.x + area.width) * frameSize.width, y: area.y * frameSize.height },
          bottomRight: { x: (area.x + area.width) * frameSize.width, y: (area.y + area.height) * frameSize.height },
          bottomLeft: { x: area.x * frameSize.width, y: (area.y + area.height) * frameSize.height },
        },
        t,
      );
      return quadrilateralBounds(q);
    }
    if (area) {
      // Frame size unknown until the first code: approximate with the view.
      return { x: area.x * viewSize.width, y: area.y * viewSize.height, width: area.width * viewSize.width, height: area.height * viewSize.height };
    }
    return defaultViewfinderRect(viewSize, viewfinder);
  }, [viewSize, viewfinder, props.scanArea, frameSize, mirrored]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  return (
    <View style={[styles.container, props.style]} onLayout={onLayout}>
      {canRun ? (
        <vc.Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraActive}
          codeScanner={codeScanner}
          torch={torchOn && hasTorch ? 'on' : 'off'}
          resizeMode="cover"
          onError={onCameraError}
          onInitialized={onInitialized}
        />
      ) : (
        props.fallback ?? (
          <DefaultFallback error={permission === 'unknown' ? null : error} onOpenSettings={permission === 'denied' ? openSettings : undefined} />
        )
      )}
      {canRun ? (
        <ScannerOverlay
          viewSize={viewSize}
          viewfinder={viewfinder}
          viewfinderRect={viewfinderRect}
          accentColor={accentColor}
          highlights={highlights}
          toast={toast}
        />
      ) : null}
      {props.children}
    </View>
  );
});

/**
 * Barcode, QR and ID scanner built on react-native-vision-camera 4 (ML Kit on
 * Android, AVFoundation on iOS), with QRGen symbology ids, SPEC results,
 * scan modes, duplicate filter, feedback and overlay.
 *
 * @example
 * <QRGenScanner
 *   style={{ flex: 1 }}
 *   symbologies={['qr', 'ean13']}
 *   mode="single"
 *   onScan={(codes) => console.log(codes[0].data)}
 * />
 */
export const QRGenScanner = forwardRef<QRGenScannerHandle, QRGenScannerProps>(function QRGenScanner(props, ref) {
  const vc = loadVisionCamera();
  if (!vc) return <VisionCameraUnavailable ref={ref} {...props} />;
  return <VisionCameraScanner ref={ref} {...props} vc={vc} />;
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  fallback: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0B0F14',
  },
  fallbackText: {
    color: '#E5E7EB',
    fontSize: 15,
    textAlign: 'center',
  },
  fallbackButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: QRGEN_ACCENT_COLOR,
  },
  fallbackButtonText: {
    color: '#0B0F14',
    fontWeight: '700',
    fontSize: 15,
  },
});
