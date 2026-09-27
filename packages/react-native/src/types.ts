/**
 * Cross-platform QRGen types (SPEC sections 2 and 4). Pure TypeScript.
 */
import type { SymbologyId } from './symbologies';

export type { SymbologyId, SymbologyGroup, SymbologyInfo, PlatformInfo, VisionCameraCodeType } from './symbologies';

/** A point in pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A width and height in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** A rectangle. `x`/`y` is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The four corners of a detected code, in source-frame pixels. */
export interface Quadrilateral {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

/** What the payload of a code contains (SPEC section 2). */
export type ContentType = 'text' | 'binary' | 'gs1' | 'iso15434' | 'mixed' | 'unknown-eci';

/**
 * A decoded barcode, identical on every QRGen platform (SPEC section 2).
 */
export interface Barcode {
  /** Decoded text. GS1 content is in HRI form, `(01)...(10)...`, when the engine can tell. */
  data: string;
  /** Symbology id, for example `qr` or `ean13`. */
  symbology: SymbologyId;
  /** Human readable symbology name, for example `QR Code`. */
  symbologyName: string;
  /** Base64 of the raw payload bytes, or `""` when the engine does not expose them. */
  rawBytes: string;
  /** Payload classification; `text` unless the engine knows better. */
  contentType: ContentType;
  /** True for GS1 formatted content. */
  isGS1: boolean;
  /** Corner points in pixels of the (upright) source frame described by `frameSize`. */
  location: Quadrilateral;
  /** Size of the frame the `location` refers to. */
  frameSize: Size;
  /** Orientation in degrees, `0` when unknown. */
  orientation: number;
  /** Error-correction level when known, else `""`. */
  ecLevel: string;
  /** AIM symbology identifier (for example `]Q1`) when known, else `""`. */
  symbologyIdentifier: string;
  /** Milliseconds since the epoch when the code was decoded. */
  timestamp: number;
}

/** A barcode followed across frames in `batch` mode. */
export interface TrackedBarcode extends Barcode {
  /** Stable id derived from symbology and data. */
  id: string;
  /** When the code was first seen (ms since epoch). */
  firstSeen: number;
  /** When the code was last seen (ms since epoch). */
  lastSeen: number;
  /** Number of frames the code has been seen in. */
  count: number;
}

/** `single` stops after the first scan, `continuous` keeps scanning, `batch` tracks many codes at once. */
export type ScanMode = 'single' | 'continuous' | 'batch';

/** `back`, `front`, or a platform camera device id. */
export type CameraSelection = 'back' | 'front' | (string & {});

/** Overlay style. */
export type ViewfinderStyle = 'frame' | 'line' | 'none';

/** Region of interest, normalized `0..1` relative to the camera frame. */
export interface ScanArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shared scanner options (SPEC section 4). */
export interface ScannerOptions {
  /** Ids or groups from SPEC section 1. Default `["all"]`. */
  symbologies?: readonly string[];
  /** Default `continuous`. */
  mode?: ScanMode;
  /** Duplicate window in ms. `0` reports every frame, `-1` reports once per session. Default `1000`. */
  duplicateFilter?: number;
  /** Play a short tone on scan. Default `true`. */
  beep?: boolean;
  /** Haptic feedback on scan. Default `true`. */
  vibrate?: boolean;
  /** Camera selection. Default `back`. */
  camera?: CameraSelection;
  /** Flashlight. Default `false`. */
  torch?: boolean;
  /** Overlay style. Default `frame` (`line` for linear-only symbology sets). */
  viewfinder?: ViewfinderStyle;
  /** Region of interest, normalized to the frame. Default: full frame. */
  scanArea?: ScanArea;
  /** Codes reported per frame. Default `1` (`20` in batch mode). */
  maxResults?: number;
}

/** Error codes shared by every QRGen platform (SPEC section 4). */
export type QRGenErrorCode =
  | 'camera-permission-denied'
  | 'camera-not-found'
  | 'camera-in-use'
  | 'insecure-context'
  | 'engine-load-failed'
  | 'unsupported'
  | 'unknown';

/** An error reported through `onError`. */
export interface QRGenError {
  code: QRGenErrorCode;
  message: string;
}

/** Payload of the `scan` event. */
export interface ScanEvent {
  barcodes: Barcode[];
}

/** Payload of the `track` event (batch mode only). */
export interface TrackEvent {
  tracked: TrackedBarcode[];
}

/** SPEC defaults for scanner options. */
export const DEFAULT_SCANNER_OPTIONS = {
  symbologies: ['all'] as readonly string[],
  mode: 'continuous' as ScanMode,
  duplicateFilter: 1000,
  beep: true,
  vibrate: true,
  camera: 'back' as CameraSelection,
  torch: false,
  maxResults: 1,
  batchMaxResults: 20,
} as const;

/** QRGen brand accent color. */
export const QRGEN_ACCENT_COLOR = '#2EC1CE';
