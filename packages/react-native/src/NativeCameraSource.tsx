// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/** Internal native-source ownership and accepted operational configuration. */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import type { CameraDevice, CameraRuntimeError, Code, CodeScannerFrame, CodeType, Orientation } from 'react-native-vision-camera';
import type { BeepHandler } from './feedback';
import type { QRGenScannerProps } from './QRGenScanner';
import { resolveSymbologies, toVisionCameraCodeTypes, type PlatformInfo, type SymbologyId } from './symbologies';
import { DEFAULT_SCANNER_OPTIONS, type ScanArea, type ScanMode, type Size } from './types';

export type CameraSourceToken = object;
export interface NativeConfiguration {
  mode: ScanMode;
  duplicateFilter: number;
  spatialTracking: boolean;
  trackMaxJump: number;
  trackMaxAssociationWork: number;
  requested: SymbologyId[];
  codeTypes: CodeType[];
  camera: string;
  device: CameraDevice | undefined;
  mirrored: boolean;
  scanArea: ScanArea | undefined;
  maxResults: number;
  beep: boolean | BeepHandler;
  vibrate: boolean;
  isActive: boolean;
  torch: boolean;
  conversionView: Size;
  viewSize: Size | null;
  orientationRevision: number;
}
export interface AcceptedNativeConfiguration extends NativeConfiguration {
  revision: number;
  coordinateEpoch: number;
}

export function nativeConfiguration(
  props: QRGenScannerProps, device: CameraDevice | undefined, platform: PlatformInfo,
  viewSize: Size | null, fallbackView: Size, orientationRevision: number,
): NativeConfiguration {
  const requested = resolveSymbologies(props.symbologies);
  const mode = props.mode ?? DEFAULT_SCANNER_OPTIONS.mode;
  const area = props.scanArea;
  const spatial = props.spatialTracking, jump = props.trackMaxJump, work = props.trackMaxAssociationWork;
  return {
    mode, duplicateFilter: props.duplicateFilter ?? DEFAULT_SCANNER_OPTIONS.duplicateFilter,
    spatialTracking: spatial === undefined ? false : spatial,
    trackMaxJump: jump === undefined ? 3 : jump,
    trackMaxAssociationWork: work === undefined ? 250_000 : work,
    requested, codeTypes: toVisionCameraCodeTypes(requested, platform),
    camera: props.camera ?? DEFAULT_SCANNER_OPTIONS.camera, device, mirrored: device?.position === 'front',
    scanArea: area ? { x: area.x, y: area.y, width: area.width, height: area.height } : undefined,
    maxResults: props.maxResults ?? (mode === 'batch' ? DEFAULT_SCANNER_OPTIONS.batchMaxResults : DEFAULT_SCANNER_OPTIONS.maxResults),
    beep: props.beep ?? DEFAULT_SCANNER_OPTIONS.beep, vibrate: props.vibrate ?? DEFAULT_SCANNER_OPTIONS.vibrate,
    isActive: props.isActive ?? true, torch: props.torch ?? false,
    conversionView: { ...(viewSize ?? fallbackView) }, viewSize: viewSize ? { ...viewSize } : null,
    orientationRevision,
  };
}

const sizeEqual = (a: Size | null, b: Size | null): boolean => a === b || !!a && !!b && a.width === b.width && a.height === b.height;
const equalValue = (a: unknown, b: unknown): boolean => a === b || Object.is(a, b);
export function nativeConfigurationEqual(a: NativeConfiguration, b: NativeConfiguration): boolean {
  const scalars: Array<keyof NativeConfiguration> = ['mode', 'duplicateFilter', 'spatialTracking', 'trackMaxJump',
    'trackMaxAssociationWork', 'mirrored', 'maxResults', 'beep', 'vibrate', 'isActive', 'torch', 'orientationRevision'];
  return scalars.every(key => equalValue(a[key], b[key]))
    && a.device?.id === b.device?.id && a.device?.hasTorch === b.device?.hasTorch
    && (a.device !== undefined || b.device !== undefined || a.camera === b.camera)
    && a.requested.length === b.requested.length && a.requested.every((value, index) => value === b.requested[index])
    && ['x', 'y', 'width', 'height'].every(key => equalValue(a.scanArea?.[key as keyof ScanArea], b.scanArea?.[key as keyof ScanArea]))
    && sizeEqual(a.viewSize, b.viewSize) && sizeEqual(a.conversionView, b.conversionView);
}

export function viewAxis(size: Size): 'unknown' | 'square' | 'portrait' | 'landscape' {
  if (!(size.width > 0 && size.height > 0)) return 'unknown';
  return size.width === size.height ? 'square' : size.width > size.height ? 'landscape' : 'portrait';
}
export function nativeSourceKey(config: AcceptedNativeConfiguration): string {
  return config.spatialTracking ? JSON.stringify(['spatial', config.device?.id ?? null, config.coordinateEpoch]) : 'legacy';
}

interface NativeCameraSourceProps {
  vc: typeof import('react-native-vision-camera');
  config: AcceptedNativeConfiguration;
  active: boolean;
  torch: boolean;
  onRegister(token: CameraSourceToken, revision: number, key: string): void;
  onUnregister(token: CameraSourceToken): void;
  onFrame(token: CameraSourceToken, codes: Code[], frame: CodeScannerFrame): void;
  onReady(token: CameraSourceToken): void;
  onError(token: CameraSourceToken, error: CameraRuntimeError): void;
  onOrientation(token: CameraSourceToken, kind: 'preview' | 'output', value: Orientation): void;
}

/** No native wrapper: the child owns the hook and the original Camera element. */
export function NativeCameraSource(props: NativeCameraSourceProps) {
  const { vc, config, onRegister, onUnregister, onFrame, onReady, onError, onOrientation } = props;
  const token = useRef<CameraSourceToken>({}).current;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onUnregister(token); };
  }, [onUnregister, token]);
  const key = nativeSourceKey(config);
  useLayoutEffect(() => { onRegister(token, config.revision, key); }, [onRegister, token, config.revision, key]);
  const scanned = useCallback((codes: Code[], frame: CodeScannerFrame) => {
    if (mounted.current) onFrame(token, codes, frame);
  }, [onFrame, token]);
  const initialized = useCallback(() => { if (mounted.current) onReady(token); }, [onReady, token]);
  const failed = useCallback((error: CameraRuntimeError) => { if (mounted.current) onError(token, error); }, [onError, token]);
  const previewOrientation = useCallback((value: Orientation) => {
    if (mounted.current) onOrientation(token, 'preview', value);
  }, [onOrientation, token]);
  const outputOrientation = useCallback((value: Orientation) => {
    if (mounted.current) onOrientation(token, 'output', value);
  }, [onOrientation, token]);
  const codeScanner = vc.useCodeScanner({ codeTypes: config.codeTypes.length ? config.codeTypes : ['qr'], onCodeScanned: scanned });
  return <vc.Camera
    style={StyleSheet.absoluteFill}
    device={config.device!}
    isActive={props.active}
    codeScanner={codeScanner}
    torch={props.torch ? 'on' : 'off'}
    resizeMode="cover"
    onError={failed}
    onInitialized={initialized}
    onPreviewOrientationChanged={config.spatialTracking ? previewOrientation : undefined}
    onOutputOrientationChanged={config.spatialTracking ? outputOrientation : undefined}
  />;
}
