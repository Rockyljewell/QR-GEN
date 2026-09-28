// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { Symbology, SymbologyInput } from "./symbologies.js";

export interface Point {
  x: number;
  y: number;
}

export interface Quadrilateral {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface Size {
  width: number;
  height: number;
}

export type ContentType = "text" | "binary" | "gs1" | "iso15434" | "mixed" | "unknown-eci";

/** A decoded barcode. Same shape on every QRGen platform (docs/SPEC.md §2). */
export interface Barcode {
  /** Decoded text. GS1 data is returned in HRI form, e.g. "(01)09501101530003(10)ABC". */
  data: string;
  symbology: Symbology;
  symbologyName: string;
  /** Base64 of the raw payload bytes ("" when not available). */
  rawBytes: string;
  contentType: ContentType;
  isGS1: boolean;
  /** Corner points in source frame/image pixels. */
  location: Quadrilateral;
  frameSize: Size;
  orientation: number;
  ecLevel: string;
  symbologyIdentifier: string;
  timestamp: number;
}

/** A barcode followed across frames in batch mode. */
export interface TrackedBarcode extends Barcode {
  /** Stable id for the lifetime of the track. */
  id: number;
  firstSeen: number;
  lastSeen: number;
  /** Number of frames the barcode was seen in. */
  count: number;
}

export type ScanMode = "single" | "continuous" | "batch";
export type CameraFacing = "back" | "front";
export type ViewfinderStyle = "frame" | "line" | "none";

/** Normalized (0..1) rectangle relative to the camera frame. */
export interface ScanArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options shared by every QRGen scanner (docs/SPEC.md §4). */
export interface ScannerOptions {
  /** Symbology ids, aliases or groups. Default: all. */
  symbologies?: SymbologyInput[] | string;
  /** Default "continuous". */
  mode?: ScanMode;
  /**
   * Ignore the same data+symbology within this window in ms. Default 1000.
   * `0` reports every frame, `-1` reports each code once per session.
   */
  duplicateFilter?: number;
  /** Default true. */
  beep?: boolean;
  /** Default true. */
  vibrate?: boolean;
  /** "back" (default), "front" or a MediaDeviceInfo.deviceId. */
  camera?: CameraFacing | (string & {});
  torch?: boolean;
  /** Default "frame" ("line" when only linear symbologies are enabled). */
  viewfinder?: ViewfinderStyle;
  /** Region of interest. Default: the whole frame. */
  scanArea?: ScanArea;
  /** Maximum codes per frame. Default 1 (20 in batch mode). */
  maxResults?: number;
  /** Spend more CPU per frame for damaged or tiny codes. Default false for camera, true for images. */
  tryHarder?: boolean;
  /** Preferred camera resolution. Default "hd" (1280x720). */
  resolution?: "sd" | "hd" | "fhd" | "4k";
  /** Decode in a Web Worker when possible. Default true. */
  worker?: boolean;
}

export type QRGenErrorCode =
  | "camera-permission-denied"
  | "camera-not-found"
  | "camera-in-use"
  | "insecure-context"
  | "engine-load-failed"
  | "unsupported"
  | "bad-request"
  | "unknown";
