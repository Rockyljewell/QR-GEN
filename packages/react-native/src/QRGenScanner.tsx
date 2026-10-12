// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * `QRGenScanner`: native-performance scanner built on react-native-vision-camera 4.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { CameraDevice, CameraRuntimeError, Code, CodeScannerFrame, Orientation } from 'react-native-vision-camera';
import { quadrilateralBounds } from './barcode';
import { createQRGenError, toQRGenError } from './errors';
import { playScanFeedback, type BeepHandler } from './feedback';
import { defaultViewfinderRect, frameToViewTransform, quadrilateralToView, uprightFrameSize } from './geometry';
import { NativeCameraSource, nativeConfiguration, nativeConfigurationEqual, nativeSourceKey, viewAxis,
  type AcceptedNativeConfiguration, type CameraSourceToken, type NativeConfiguration } from './NativeCameraSource';
import { ScannerOverlay, type OverlayHighlight, type OverlayToast } from './ScannerOverlay';
import { ScanSession } from './session';
import {
  isLinearOnly,
  symbologyName,
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
  /** Batch mode: follow separate equal-payload observations by position. Default false. Native only. */
  spatialTracking?: boolean;
  /** Spatial movement gate relative to barcode size. Default 3; finite and nonnegative. */
  trackMaxJump?: number;
  /** Spatial assignment-work budget. Default 250,000; a positive safe integer. */
  trackMaxAssociationWork?: number;
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
  useLayoutEffect(() => { latest.current = props; });
  const platform = useMemo<PlatformInfo>(() => ({ os: Platform.OS, version: Platform.Version }), []);
  const [runState, setRunState] = useState<RunState>('running');
  const [torchOn, setTorchOn] = useState<boolean>(props.torch ?? false);
  const [measuredView, setMeasuredView] = useState<Size | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [highlights, setHighlights] = useState<OverlayHighlight[]>([]);
  const [toast, setToast] = useState<OverlayToast | null>(null);
  const [appActive, setAppActive] = useState<boolean>(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [error, setError] = useState<QRGenError | null>(null);
  const [orientationRevision, setOrientationRevision] = useState(0);
  const [accepted, setAccepted] = useState<AcceptedNativeConfiguration | null>(null);
  const acceptedRef = useRef(accepted);
  const sessionRef = useRef<ScanSession | null>(null);
  // Validate the initial proposal in layout before rendering any camera.
  if (!sessionRef.current) sessionRef.current = new ScanSession();
  const session = sessionRef.current;
  const deliveryGeneration = useRef(0);
  const mounted = useRef(true);
  const transition = useRef(true);
  const activeSource = useRef<CameraSourceToken | null>(null);
  const registration = useRef<{ token: CameraSourceToken; revision: number; key: string } | null>(null);
  const pendingClear = useRef<{ generation: number; key: string } | null>(null);
  const attempted = useRef<{ config?: NativeConfiguration; rejectedInputs?: readonly unknown[] } | null>(null);
  const knownOrientations = useRef(new Map<string, { preview?: Orientation; output?: Orientation }>());
  const viewSizeRef = useRef<Size | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      transition.current = true;
      activeSource.current = null;
      deliveryGeneration.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (props.showHighlights !== false) return;
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    setHighlights(current => current.length === 0 ? current : []);
  }, [props.showHighlights]);

  const emitError = useCallback((code: QRGenErrorCode | QRGenError, message?: string) => {
    const err = typeof code === 'string' ? createQRGenError(code, message) : code;
    setError(err);
    latest.current.onError?.(err);
  }, []);

  const { hasPermission, requestPermission } = vc.useCameraPermission();
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>(hasPermission ? 'granted' : 'unknown');
  useEffect(() => {
    if (hasPermission) {
      setPermission('granted');
      setError(e => e?.code === 'camera-permission-denied' ? null : e);
      return;
    }
    let cancelled = false;
    requestPermission().then(granted => {
      if (cancelled) return;
      setPermission(granted ? 'granted' : 'denied');
      if (!granted) emitError('camera-permission-denied', 'Camera permission was denied. Enable it in Settings to scan.');
    }).catch((e: unknown) => { if (!cancelled) emitError(toQRGenError(e, 'camera-permission-denied')); });
    return () => { cancelled = true; };
  }, [hasPermission, requestPermission, emitError]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  const cameraProposal = props.camera ?? DEFAULT_SCANNER_OPTIONS.camera;
  const devices = vc.useCameraDevices();
  const byPosition = vc.useCameraDevice(cameraProposal === 'front' ? 'front' : 'back');
  const proposedDevice: CameraDevice | undefined = cameraProposal === 'front' || cameraProposal === 'back'
    ? byPosition : devices.find(d => d.id === cameraProposal) ?? byPosition;
  const windowSize = Dimensions.get('window');
  // Nested throwing inputs retain stable identity across internal error renders.
  // Callback/presentation props do not create a new operational proposal.
  const rejectionInputs: readonly unknown[] = [props.mode, props.duplicateFilter, props.spatialTracking,
    props.trackMaxJump, props.trackMaxAssociationWork, props.camera, props.symbologies, props.scanArea,
    props.maxResults, props.isActive, props.torch, props.beep, props.vibrate];
  let proposal: NativeConfiguration | undefined;
  let proposalError: unknown;
  try {
    proposal = nativeConfiguration(props, proposedDevice, platform, measuredView, windowSize, orientationRevision);
  } catch (e: unknown) { proposalError = e; }

  const device = accepted?.device;
  const hasTorch = device?.hasTorch ?? false;
  const viewSize = accepted?.viewSize ?? null;
  const mirrored = accepted?.mirrored ?? false;
  const mode = accepted?.mode ?? DEFAULT_SCANNER_OPTIONS.mode;
  const viewfinder = props.viewfinder ?? (accepted && isLinearOnly(accepted.requested) ? 'line' : 'frame');
  const accentColor = props.accentColor ?? QRGEN_ACCENT_COLOR;
  // Physical availability gates the accepted source even when a new prop proposal is rejected.
  const deviceAvailable = device !== undefined && devices.some(current => current.id === device.id);
  const canRun = accepted !== null && hasPermission && permission === 'granted' && deviceAvailable && accepted.codeTypes.length > 0;
  const cameraActive = canRun && accepted!.isActive && appActive && runState !== 'stopped';
  const runtime = useRef({ cameraActive, runState });
  useLayoutEffect(() => {
    runtime.current = { cameraActive, runState };
    viewSizeRef.current = viewSize;
  });

  // Called only after successful configure, or for an external coordinate fact.
  const publish = useCallback((candidate: NativeConfiguration, policyChanged: boolean, oldCount: number) => {
    const previous = acceptedRef.current;
    if (previous && nativeConfigurationEqual(previous, candidate)) return;
    const modeChanged = previous !== null && previous.mode !== candidate.mode;
    const spatialSourceChanged = previous !== null && (previous.spatialTracking || candidate.spatialTracking)
      && previous.device?.id !== candidate.device?.id;
    const coordinateChanged = previous !== null && candidate.spatialTracking
      && (viewAxis(previous.viewSize ?? { width: 0, height: 0 }) !== viewAxis(candidate.viewSize ?? { width: 0, height: 0 })
        || viewAxis(previous.conversionView) !== viewAxis(candidate.conversionView)
        || previous.orientationRevision !== candidate.orientationRevision);
    const owedClear = previous !== null && pendingClear.current?.generation === deliveryGeneration.current
      && pendingClear.current.key === nativeSourceKey(previous);
    const boundary = modeChanged || policyChanged || spatialSourceChanged || coordinateChanged;
    if (boundary) {
      deliveryGeneration.current += 1;
      pendingClear.current = null;
      activeSource.current = null;
    }
    transition.current = true;
    if ((spatialSourceChanged || coordinateChanged) && !policyChanged) session.resetSpatial();
    const next: AcceptedNativeConfiguration = { ...candidate,
      revision: (previous?.revision ?? 0) + 1,
      coordinateEpoch: (previous?.coordinateEpoch ?? 0) + (coordinateChanged ? 1 : 0) };
    if (policyChanged || spatialSourceChanged || coordinateChanged) {
      setHighlights([]);
      if (spatialSourceChanged || coordinateChanged) setFrameSize(null);
      if ((oldCount > 0 || owedClear) && previous?.mode === 'batch' && candidate.mode === 'batch') {
        pendingClear.current = { generation: deliveryGeneration.current, key: nativeSourceKey(next) };
      }
    }
    acceptedRef.current = next;
    setAccepted(next);
    if (modeChanged) setRunState('running');
  }, [session]);

  useLayoutEffect(() => {
    const previous = acceptedRef.current;
    const applyExternalCoordinates = () => {
      if (!previous?.spatialTracking) return;
      const basis = measuredView ?? windowSize;
      // Only plain accepted settings and independent native facts participate.
      const coordinates: NativeConfiguration = { ...previous,
        conversionView: { width: basis.width, height: basis.height },
        viewSize: measuredView ? { ...measuredView } : null, orientationRevision };
      if (nativeConfigurationEqual(previous, coordinates)) return;
      if (!Number.isSafeInteger(previous.revision + 1) || !Number.isSafeInteger(previous.coordinateEpoch + 1)) {
        throw new RangeError('Native configuration range exhausted');
      }
      publish(coordinates, false, session.tracked.length);
    };
    if (!proposal) {
      let failure = proposalError;
      try { applyExternalCoordinates(); } catch (e: unknown) { failure = e; }
      const rejected = attempted.current?.rejectedInputs;
      if (rejected && rejected.length === rejectionInputs.length
        && rejected.every((value, index) => value === rejectionInputs[index] || Object.is(value, rejectionInputs[index]))) return;
      attempted.current = { rejectedInputs: rejectionInputs };
      emitError(toQRGenError(failure));
      return;
    }
    if (attempted.current?.config && nativeConfigurationEqual(attempted.current.config, proposal)) return;
    attempted.current = { config: proposal };
    try {
      if (!Number.isSafeInteger((previous?.revision ?? 0) + 1)
        || !Number.isSafeInteger((previous?.coordinateEpoch ?? 0) + 1)) throw new RangeError('Native configuration range exhausted');
      const oldCount = session.tracked.length;
      const oldSpatial = session.spatialTracking, oldJump = session.trackMaxJump, oldWork = session.trackMaxAssociationWork;
      session.configure({ mode: proposal.mode, duplicateFilter: proposal.duplicateFilter,
        spatialTracking: proposal.spatialTracking, trackMaxJump: proposal.trackMaxJump,
        trackMaxAssociationWork: proposal.trackMaxAssociationWork });
      const changed = oldSpatial !== session.spatialTracking || oldJump !== session.trackMaxJump || oldWork !== session.trackMaxAssociationWork;
      publish(proposal, changed, oldCount);
    } catch (e: unknown) {
      // A real layout/orientation event is independent of rejected prop policy.
      let failure = e;
      try { applyExternalCoordinates(); } catch (coordinateError: unknown) { failure = coordinateError; }
      emitError(toQRGenError(failure));
    }
  });

  const registerSource = useCallback((token: CameraSourceToken, revision: number, key: string) => {
    registration.current = { token, revision, key };
  }, []);
  const unregisterSource = useCallback((token: CameraSourceToken) => {
    if (registration.current?.token === token) registration.current = null;
    if (activeSource.current !== token) return;
    activeSource.current = null;
    if (!mounted.current || transition.current) return;
    transition.current = true;
    const config = acceptedRef.current;
    if (config?.spatialTracking) {
      deliveryGeneration.current += 1;
      if (session.resetSpatial() && config.mode === 'batch') pendingClear.current = {
        generation: deliveryGeneration.current, key: nativeSourceKey(config),
      };
      setHighlights([]);
      setFrameSize(null);
    }
  }, [session]);

  // The parent activates after runtime/configuration effects, regardless of child effect order.
  useLayoutEffect(() => {
    const config = acceptedRef.current, child = registration.current;
    if (!mounted.current || !config) return;
    const key = nativeSourceKey(config);
    if (accepted?.revision !== config.revision) return;
    if (config.spatialTracking && (config.orientationRevision !== orientationRevision
      || viewAxis(config.conversionView) !== viewAxis(measuredView ?? windowSize)
      || viewAxis(config.viewSize ?? { width: 0, height: 0 }) !== viewAxis(measuredView ?? { width: 0, height: 0 }))) return;
    if (canRun) {
      if (!child || child.revision !== config.revision || child.key !== key) return;
      activeSource.current = child.token;
      transition.current = false;
    }
    const clear = pendingClear.current;
    if (clear && clear.generation === deliveryGeneration.current && clear.key === key && config.mode === 'batch'
      && (!canRun || !transition.current)) {
      pendingClear.current = null;
      latest.current.onTrack?.([]);
    }
  });

  // Only an accepted torch prop change overrides setTorch; the first acceptance
  // of the initial value must not revert an earlier imperative setTorch call.
  const appliedTorch = useRef(torchOn);
  useEffect(() => {
    if (!accepted || accepted.torch === appliedTorch.current) return;
    appliedTorch.current = accepted.torch;
    setTorchOn(accepted.torch);
  }, [accepted?.torch]);
  useEffect(() => {
    if (permission === 'granted' && accepted && !deviceAvailable) emitError('camera-not-found', `No ${accepted.camera} camera was found on this device.`);
  }, [permission, accepted?.camera, deviceAvailable, emitError]);
  useEffect(() => {
    if (accepted && accepted.codeTypes.length === 0) emitError('unsupported',
      `None of the requested symbologies (${accepted.requested.join(', ') || 'none'}) can be read by react-native-vision-camera on ${Platform.OS}.`);
  }, [accepted?.codeTypes.join(','), emitError]);
  useEffect(() => { if (torchOn && device && !hasTorch) emitError('unsupported', 'This camera has no torch.'); }, [torchOn, device, hasTorch, emitError]);

  const showHighlightsFor = useCallback((list: readonly Barcode[], linger: boolean) => {
    if (latest.current.showHighlights === false) return;
    const view = viewSizeRef.current;
    if (!view) return;
    const next = list.map((b, i) => {
      const t = frameToViewTransform(b.frameSize, view, { resizeMode: 'cover', mirrored: acceptedRef.current?.mirrored ?? false });
      const rect = quadrilateralBounds(quadrilateralToView(b.location, t));
      const key = 'id' in b ? String((b as TrackedBarcode).id) : `${barcodeKey(b)}#${i}`;
      return { key, rect };
    });
    setHighlights(next);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    if (linger && next.length > 0) highlightTimer.current = setTimeout(() => setHighlights([]), HIGHLIGHT_LINGER_MS);
  }, []);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  const sourceEligible = useCallback((token: CameraSourceToken) => mounted.current && !transition.current
    && activeSource.current === token, []);
  const onCodeScanned = useCallback((token: CameraSourceToken, codes: Code[], frame: CodeScannerFrame) => {
    const state = acceptedRef.current;
    if (!state || !sourceEligible(token) || !runtime.current.cameraActive || runtime.current.runState !== 'running') return;
    let barcodes: Barcode[], result: ReturnType<ScanSession['process']>, sourceSize: Size;
    try {
      const rawFrame = { width: frame.width, height: frame.height };
      sourceSize = uprightFrameSize(rawFrame, state.conversionView);
      const converted = convertVisionCameraCodes(codes, rawFrame, {
        requested: state.requested, platform, viewSize: state.conversionView, timestamp: Date.now(),
      });
      barcodes = selectBarcodes(converted, { scanArea: state.scanArea, maxResults: state.maxResults });
      result = session.process(barcodes, undefined, state.spatialTracking ? sourceSize : undefined);
    } catch (e: unknown) { emitError(toQRGenError(e)); return; }
    if (state.spatialTracking || barcodes.length > 0) {
      const size = state.spatialTracking ? sourceSize : barcodes[0]!.frameSize;
      setFrameSize(prev => prev && prev.width === size.width && prev.height === size.height ? prev : size);
    }
    const delivery = result.tracked !== null ? ++deliveryGeneration.current : deliveryGeneration.current;
    if (result.tracked !== null) pendingClear.current = null;
    if (result.stop) setRunState('stopped');
    if (state.mode === 'batch') {
      if (result.tracked) showHighlightsFor(result.tracked, false);
    } else if (barcodes.length > 0) showHighlightsFor(barcodes, true);
    const p = latest.current;
    if (result.scanned.length > 0) {
      playScanFeedback(state.beep, state.vibrate);
      if (p.showToast !== false) {
        toastId.current += 1;
        setToast({ id: toastId.current, text: toastText(result.scanned) });
      }
      p.onScan?.(result.scanned);
    }
    // Ordinary accepted settings changes keep ownership of this admitted frame.
    if (mounted.current && activeSource.current === token && deliveryGeneration.current === delivery && result.tracked) p.onTrack?.(result.tracked);
  }, [platform, session, sourceEligible, showHighlightsFor, emitError]);

  const onCameraError = useCallback((token: CameraSourceToken, e: CameraRuntimeError) => {
    if (sourceEligible(token)) emitError(toQRGenError(e));
  }, [sourceEligible, emitError]);
  const onInitialized = useCallback((token: CameraSourceToken) => {
    if (!sourceEligible(token)) return;
    setError(null);
    latest.current.onReady?.();
  }, [sourceEligible]);
  const onOrientation = useCallback((token: CameraSourceToken, kind: 'preview' | 'output', value: Orientation) => {
    const config = acceptedRef.current;
    // VisionCamera's scanner follows preview rotation; output rotation is photo/video only.
    if (kind !== 'preview' || !config?.spatialTracking || !sourceEligible(token) || !config.device) return;
    const known = knownOrientations.current.get(config.device.id) ?? {};
    const old = known[kind];
    known[kind] = value;
    knownOrientations.current.set(config.device.id, known);
    if (old === undefined || old === value) return;
    transition.current = true;
    activeSource.current = null;
    deliveryGeneration.current += 1;
    setOrientationRevision(previous => previous + 1);
  }, [sourceEligible]);

  useEffect(() => {
    if (mode !== 'batch' || !cameraActive) return;
    const id = setInterval(() => {
      if (!mounted.current || transition.current || !activeSource.current || !runtime.current.cameraActive) return;
      let tracked: TrackedBarcode[] | null;
      try { tracked = session.tick(); } catch (e: unknown) { emitError(toQRGenError(e)); return; }
      if (tracked) {
        deliveryGeneration.current += 1;
        pendingClear.current = null;
        showHighlightsFor(tracked, false);
        latest.current.onTrack?.(tracked);
      }
    }, BATCH_TICK_MS);
    return () => clearInterval(id);
  }, [mode, cameraActive, session, showHighlightsFor, emitError]);
  useEffect(() => { if (!cameraActive) setHighlights([]); }, [cameraActive]);

  useImperativeHandle(ref, () => ({
    start() { session.resume(); setRunState('running'); },
    stop() { setRunState('stopped'); },
    pause() { setRunState('paused'); },
    resume() { session.resume(); setRunState('running'); },
    reset() {
      deliveryGeneration.current += 1;
      pendingClear.current = null;
      session.reset();
      setHighlights([]);
      setRunState('running');
    },
    setTorch(on: boolean) { setTorchOn(on); },
    supportedSymbologies: () => visionCameraSupportedSymbologies(platform),
  }), [session, platform]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMeasuredView(prev => prev && prev.width === width && prev.height === height ? prev : { width, height });
  }, []);
  const area = accepted?.scanArea;
  const viewfinderRect = useMemo<Rect | null>(() => {
    if (!viewSize || viewfinder === 'none') return null;
    if (area && frameSize) {
      const t = frameToViewTransform(frameSize, viewSize, { resizeMode: 'cover', mirrored });
      const q = quadrilateralToView({
        topLeft: { x: area.x * frameSize.width, y: area.y * frameSize.height },
        topRight: { x: (area.x + area.width) * frameSize.width, y: area.y * frameSize.height },
        bottomRight: { x: (area.x + area.width) * frameSize.width, y: (area.y + area.height) * frameSize.height },
        bottomLeft: { x: area.x * frameSize.width, y: (area.y + area.height) * frameSize.height },
      }, t);
      return quadrilateralBounds(q);
    }
    if (area) return { x: area.x * viewSize.width, y: area.y * viewSize.height, width: area.width * viewSize.width, height: area.height * viewSize.height };
    return defaultViewfinderRect(viewSize, viewfinder);
  }, [viewSize, viewfinder, area, frameSize, mirrored]);
  const openSettings = useCallback(() => { Linking.openSettings().catch(() => undefined); }, []);

  return (
    <View style={[styles.container, props.style]} onLayout={onLayout}>
      {canRun ? (
        <NativeCameraSource
          key={nativeSourceKey(accepted!)}
          vc={vc} config={accepted!} active={cameraActive} torch={torchOn && hasTorch}
          onRegister={registerSource} onUnregister={unregisterSource} onFrame={onCodeScanned}
          onReady={onInitialized} onError={onCameraError} onOrientation={onOrientation}
        />
      ) : props.fallback ?? <DefaultFallback error={permission === 'unknown' ? null : error} onOpenSettings={permission === 'denied' ? openSettings : undefined} />}
      {canRun ? <ScannerOverlay viewSize={viewSize} viewfinder={viewfinder} viewfinderRect={viewfinderRect}
        accentColor={accentColor} highlights={highlights} toast={toast} /> : null}
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
