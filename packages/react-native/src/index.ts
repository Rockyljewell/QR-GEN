/**
 * qrgen-react-native: QRGen barcode, QR and ID scanning for React Native.
 *
 * - `QRGenScanner`: native performance, built on react-native-vision-camera 4.
 * - `QRGenWebScanner`: zero native setup, runs the hosted embed page in react-native-webview.
 *
 * Both components share the QRGen symbology ids, result shape and error codes
 * defined in the cross-platform specification.
 */
export { QRGenScanner, isVisionCameraAvailable, supportedSymbologies } from './QRGenScanner';
export type { QRGenScannerProps, QRGenScannerHandle } from './QRGenScanner';

export { QRGenWebScanner, isWebViewAvailable } from './QRGenWebScanner';
export type { QRGenWebScannerProps, QRGenWebScannerHandle } from './QRGenWebScanner';

export { ScannerOverlay } from './ScannerOverlay';
export type { ScannerOverlayProps, OverlayHighlight, OverlayToast } from './ScannerOverlay';

export { setBeepHandler } from './feedback';
export type { BeepHandler } from './feedback';

export * from './types';
export {
  SYMBOLOGIES,
  SYMBOLOGY_IDS,
  SYMBOLOGY_GROUPS,
  normalizeSymbologyKey,
  isSymbologyId,
  resolveSymbology,
  resolveSymbologyGroup,
  resolveSymbologies,
  getSymbologyInfo,
  symbologyName,
  isLinearOnly,
  toVisionCameraCodeTypes,
  fromVisionCameraCode,
  visionCameraSupportedSymbologies,
} from './symbologies';
export { QRGEN_ERROR_CODES, isQRGenErrorCode, createQRGenError, mapVisionCameraErrorCode, toQRGenError } from './errors';
export { createBarcode, normalizeBarcode, normalizeTrackedBarcode, quadrilateralFromRect, quadrilateralBounds, quadrilateralCenter } from './barcode';
export type { BarcodeInit } from './barcode';
export { DuplicateFilter, barcodeKey } from './duplicateFilter';
export type { DuplicateKeySource } from './duplicateFilter';
export { BarcodeTracker, trackingId, DEFAULT_TRACKING_TIMEOUT } from './tracker';
export type { TrackerOptions, TrackerUpdate } from './tracker';
export { ScanSession } from './session';
export type { ScanSessionOptions, ScanSessionResult } from './session';
export {
  DEFAULT_EMBED_URL,
  EMBED_SOURCE,
  EMBED_HOST_SOURCE,
  buildEmbedUrl,
  parseEmbedMessage,
  buildCommandScript,
  buildCommandMessage,
} from './embed';
export type { EmbedMessage, EmbedCommand } from './embed';
export {
  needsSwap,
  uprightFrameSize,
  frameToViewTransform,
  applyTransform,
  quadrilateralToView,
  viewRectToFrame,
  orderQuadrilateral,
} from './geometry';
export type { FrameToViewTransform } from './geometry';
export { convertVisionCameraCodes, selectBarcodes } from './visionCameraAdapter';
export type { VisionCameraCodeLike, VisionCameraFrameLike, ConvertCodesContext } from './visionCameraAdapter';
