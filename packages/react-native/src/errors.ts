/**
 * QRGen error helpers (SPEC section 4). Pure TypeScript.
 */
import type { QRGenError, QRGenErrorCode } from './types';

/** Every error code defined by the specification. */
export const QRGEN_ERROR_CODES: readonly QRGenErrorCode[] = [
  'camera-permission-denied',
  'camera-not-found',
  'camera-in-use',
  'insecure-context',
  'engine-load-failed',
  'unsupported',
  'unknown',
];

const CODE_SET = new Set<string>(QRGEN_ERROR_CODES);

/** True when `value` is one of the SPEC error codes. */
export function isQRGenErrorCode(value: unknown): value is QRGenErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Creates a `{ code, message }` error object. Unknown codes become `unknown`. */
export function createQRGenError(code: string, message?: string): QRGenError {
  const safe: QRGenErrorCode = isQRGenErrorCode(code) ? code : 'unknown';
  return { code: safe, message: message && message.length > 0 ? message : defaultMessage(safe) };
}

function defaultMessage(code: QRGenErrorCode): string {
  switch (code) {
    case 'camera-permission-denied':
      return 'Camera permission was denied.';
    case 'camera-not-found':
      return 'No camera was found on this device.';
    case 'camera-in-use':
      return 'The camera is in use by another app.';
    case 'insecure-context':
      return 'Camera access requires a secure (https) context.';
    case 'engine-load-failed':
      return 'The scanning engine could not be loaded.';
    case 'unsupported':
      return 'This operation is not supported on this device.';
    default:
      return 'An unknown error occurred.';
  }
}

/**
 * Maps a react-native-vision-camera `CameraRuntimeError` code (such as
 * `device/camera-already-in-use`) to a QRGen error code.
 */
export function mapVisionCameraErrorCode(code: string | undefined | null): QRGenErrorCode {
  switch (code) {
    case 'permission/camera-permission-denied':
    case 'system/camera-is-restricted':
      return 'camera-permission-denied';
    case 'device/no-device':
    case 'device/invalid-device':
    case 'device/camera-not-available-on-simulator':
      return 'camera-not-found';
    case 'device/camera-already-in-use':
    case 'system/max-cameras-in-use':
    case 'session/hardware-cost-too-high':
      return 'camera-in-use';
    case 'code-scanner/code-type-not-supported':
    case 'code-scanner/not-compatible-with-outputs':
      return 'unsupported';
    case 'code-scanner/cannot-load-model':
    case 'system/camera-module-not-found':
    case 'system/view-not-found':
      return 'engine-load-failed';
    default:
      return 'unknown';
  }
}

/** Converts any thrown value or vision-camera error to a QRGen error. */
export function toQRGenError(error: unknown, fallback: QRGenErrorCode = 'unknown'): QRGenError {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (isQRGenErrorCode(e.code)) return createQRGenError(e.code, message);
    if (typeof e.code === 'string') {
      const mapped = mapVisionCameraErrorCode(e.code);
      return createQRGenError(mapped === 'unknown' ? fallback : mapped, message);
    }
    return createQRGenError(fallback, message);
  }
  return createQRGenError(fallback, typeof error === 'string' ? error : undefined);
}
