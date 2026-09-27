---
title: JavaScript API
description: "Reference for every export of the qrgen-sdk package: scanning, camera, generation, parsers, symbologies, engine configuration, utilities and errors, with TypeScript signatures."
group: Reference
order: 1
badge: TypeScript
---

Everything on this page is exported from `qrgen-sdk`. `qrgen-sdk/node` re-exports all of it, and the [CDN bundles](../cdn/) expose it as named exports and on the `QRGen` global. Other entry points are summarized at the [end of the page](#other-entry-points).

```ts
import { BarcodeScanner, scanImage, generate, parseContent, configure } from "qrgen-sdk";
```

## Scanning

### BarcodeScanner

Camera scanning with duplicate filtering, feedback and batch tracking. Guide: [JavaScript](../javascript/).

```ts
class BarcodeScanner {
  constructor(options?: BarcodeScannerOptions);

  readonly camera: Camera;
  readonly video: HTMLVideoElement;
  readonly feedback: Feedback;
  readonly tracker: BarcodeTracker;
  readonly stats: { decodeMs: number; fps: number; engine: "" | "worker" | "main" };
  readonly state: ScannerState;
  readonly options: Readonly<BarcodeScannerOptions>; // current options with defaults applied

  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  setTorch(on: boolean): Promise<boolean>;
  toggleTorch(): Promise<boolean>;
  setZoom(zoom: number): Promise<boolean>;
  switchCamera(): Promise<void>;
  setOptions(partial: Partial<BarcodeScannerOptions>): void;
  destroy(): void;

  on<K extends keyof ScannerEvents>(event: K, listener: (payload: ScannerEvents[K]) => void): () => void;
  once<K extends keyof ScannerEvents>(event: K, listener: (payload: ScannerEvents[K]) => void): () => void;
  off<K extends keyof ScannerEvents>(event: K, listener: (payload: ScannerEvents[K]) => void): void;
  removeAllListeners(): void;
}

interface BarcodeScannerOptions extends ScannerOptions {
  video?: HTMLVideoElement;          // preview element; a detached one is created when omitted
  maxDecodeSize?: number;            // default 1280
  maxFps?: number;                   // default 24
  tryInvert?: boolean | "alternate"; // default "alternate"
}

interface ScannerEvents {
  scan: { barcodes: Barcode[] };
  track: TrackerUpdate;
  frame: FrameEvent;
  error: QRGenError;
  state: ScannerState;
  ready: { engine: "worker" | "main"; camera: Camera };
}

interface FrameEvent {
  barcodes: Barcode[];
  frameSize: Size;
  decodeMs: number;
}

type ScannerState = "idle" | "starting" | "scanning" | "paused" | "stopped" | "error";
```

`ScannerOptions` and every default are listed in [Options, events & errors](../options-events/#scanner-options). `QRGen.createScanner(options)` is a shortcut for `new BarcodeScanner(options)`.

### scanImage

```ts
function scanImage(input: ImageInput, options?: ScanImageOptions): Promise<Barcode[]>;

type ImageInput =
  | Blob | File | ArrayBuffer | Uint8Array | ImageData
  | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  | ImageBitmap | OffscreenCanvas
  | string; // URL or data URL

interface ScanImageOptions {
  symbologies?: SymbologyInput[] | string; // default: all
  maxResults?: number;                     // default 255 (1 to 255)
  tryHarder?: boolean;                     // default true
}
```

Guide: [Image scanning](../image-scanning/).

### BarcodeTracker

Assigns stable ids to codes across frames. Used by batch mode; usable on its own. Guide: [Batch scanning](../batch-scanning/#barcodetracker-for-custom-interfaces).

```ts
class BarcodeTracker {
  constructor(options?: TrackerOptions);
  readonly timeout: number;
  readonly maxJump: number;
  readonly size: number;             // number of live tracks
  readonly all: TrackedBarcode[];
  update(detections: readonly Barcode[], now?: number): TrackerUpdate;
  clear(): void;
}

interface TrackerOptions {
  timeout?: number; // ms without a detection before a track is dropped; default 500
  maxJump?: number; // max movement between frames, relative to code size; default 3
}

interface TrackerUpdate {
  tracked: TrackedBarcode[];
  added: TrackedBarcode[];
  updated: TrackedBarcode[];
  removed: TrackedBarcode[];
}
```

### DuplicateFilter

The filter behind the `duplicateFilter` option.

```ts
class DuplicateFilter {
  constructor(window?: number); // ms; default 1000; 0 = accept everything; negative = once until reset()
  window: number;
  accept(barcode: Pick<Barcode, "symbology" | "data">, now?: number): boolean; // true = report it
  reset(): void;
  static key(barcode: Pick<Barcode, "symbology" | "data">): string;
}
```

### Feedback

Beep and vibration. Available as `scanner.feedback`.

```ts
class Feedback {
  constructor(options?: FeedbackOptions);
  options: FeedbackOptions;
  unlock(): void;  // create or resume the audio context; call from a user gesture on iOS
  beep(): void;
  vibrate(pattern?: number | number[]): void; // default 40 ms
  success(): void; // beep + vibrate, as configured
  dispose(): void;
}

interface FeedbackOptions {
  beep?: boolean;
  vibrate?: boolean;
  frequency?: number; // Hz, default 2100
  duration?: number;  // ms, default 90
  volume?: number;    // 0 to 1, default 0.12
}
```

## Camera

A thin wrapper around `getUserMedia` with torch, zoom and camera switching. Available as `scanner.camera`.

```ts
class Camera {
  constructor(options?: CameraOptions);
  static isSupported(): boolean;             // getUserMedia exists
  static list(): Promise<MediaDeviceInfo[]>; // video inputs; labels need permission

  stream: MediaStream | null;
  readonly track: MediaStreamTrack | null;
  readonly isFront: boolean;
  readonly isTorchOn: boolean;
  readonly videoSize: { width: number; height: number };
  readonly capabilities: CameraCapabilities;
  readonly resolution: Resolution;

  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  setTorch(on: boolean): Promise<boolean>;
  setZoom(zoom: number): Promise<boolean>;
  switch(): Promise<void>;
}

interface CameraOptions {
  camera?: "back" | "front" | string; // facing mode or deviceId; default "back"
  resolution?: Resolution;            // default "hd"
}

interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
  focusMode: string[];
}

type Resolution = "sd" | "hd" | "fhd" | "4k"; // 640x480, 1280x720, 1920x1080, 3840x2160
```

## Generation

Guide: [Barcode generation](../barcode-generation/).

```ts
function generate(data: string, options?: GenerateOptions): Promise<GeneratedBarcode>;
function generateSVG(data: string, options?: GenerateOptions): Promise<string>;
function generateDataURL(data: string, options?: GenerateOptions): Promise<string>; // data:image/svg+xml
function styleSvg(svg: string, foreground?: string, background?: string): string;   // recolor generator SVG

interface GenerateOptions {
  symbology?: SymbologyInput;       // default "qr"
  scale?: number;                   // module size in px; default 4
  ecLevel?: "L" | "M" | "Q" | "H" | string;
  gs1?: boolean;
  hrt?: boolean;
  margin?: boolean;                 // quiet zone; default true
  foreground?: string;              // default "#000000"
  background?: string;              // default "#ffffff"; or "transparent"
  rotate?: 0 | 90 | 180 | 270;
  version?: number;                 // 2D symbol size, e.g. QR version 1-40
  extraOptions?: string;            // extra encoder options
}

interface GeneratedBarcode {
  symbology: Symbology;
  data: string;
  svg: string;
  png: Blob | null;
  matrix: { width: number; height: number; modules: Uint8Array }; // 1 = dark
  text: string;
}
```

## Parsers

Guide: [Parsers](../parsers/). Also available from `qrgen-sdk/parsers` without the engine.

```ts
function parseContent(data: string, options?: ParseContentOptions): ParsedContent;
interface ParseContentOptions { symbology?: string; now?: Date }

function parseGS1(input: string): GS1Result | null;
function parseDigitalLink(input: string): GS1Result | null;
function formatGS1(result: Pick<GS1Result, "elements">): string;  // back to "(01)...(10)..."
function gs1Date(yymmdd: string, now?: Date): string | undefined;  // "YYYY-MM-DD"
function isValidCheckDigit(digits: string): boolean;               // GS1 mod-10
function computeCheckDigit(body: string): number;
const GS1_AIS: Record<string, AIDefinition>;

function parseAAMVA(input: string, options?: AamvaOptions): AamvaResult | null;
function parseAamvaDate(value: string | undefined, canadian: boolean): string; // "YYYY-MM-DD" or ""
const AAMVA_FIELDS: Readonly<Record<string, string>>;               // element code -> label
interface AamvaOptions { now?: Date }

interface GS1Result {
  elements: GS1Element[];
  values: Record<string, string>;
  digitalLink?: string;
}

interface GS1Element {
  ai: string;
  title: string;
  description: string;
  value: string;
  date?: string;             // date AIs, ISO
  number?: number;           // decimal AIs
  iso?: string;              // ISO currency or country prefix
  checkDigitValid?: boolean; // AIs with a check digit
}

interface AIDefinition {
  title: string;
  description: string;
  fixed?: number;
  max?: number;
  numeric?: boolean;
  decimal?: boolean;
  date?: boolean;
  check?: boolean;
  isoPrefix?: boolean;
}
```

`ParsedContent` is a union discriminated by `type`; its members are listed in [Parsers](../parsers/#parsecontent). `AamvaResult` is listed in [ID scanning](../id-scanning/#result-fields).

## Symbologies

Reference: [Symbologies](../symbologies/).

```ts
const SYMBOLOGIES: readonly SymbologyInfo[];
const ALL_SYMBOLOGIES: readonly Symbology[];
const WRITABLE_SYMBOLOGIES: readonly Symbology[];
const SYMBOLOGY_GROUPS: Readonly<Record<SymbologyGroup, readonly Symbology[]>>;

function resolveSymbologies(input?: SymbologyInput | readonly SymbologyInput[] | null): Symbology[];
function toSymbology(name: string): Symbology | undefined; // one id, alias or name
function symbologyInfo(id: Symbology): SymbologyInfo;      // throws for an unknown id
function symbologyName(id: Symbology): string;             // display name
function normalizeName(name: string): string;              // lowercase, [a-z0-9] only

interface SymbologyInfo {
  id: Symbology;
  name: string;
  kind: "linear" | "matrix";
  read: string[];   // zxing-cpp reader formats
  write?: string;   // zxing-cpp writer format
  aliases: string[];
  example: string;  // sample payload
}

type Symbology = "qr" | "micro-qr" | "rmqr" | "data-matrix" | "aztec" | "pdf417" | "micro-pdf417" | "maxicode"
  | "ean13" | "ean8" | "upca" | "upce" | "isbn" | "code128" | "code39" | "code93" | "codabar" | "itf" | "itf14"
  | "databar" | "databar-expanded" | "databar-limited" | "code32" | "pzn" | "telepen" | "dx-film-edge";

type SymbologyGroup = "all" | "linear" | "1d" | "matrix" | "2d" | "retail" | "industrial" | "gs1";
type SymbologyInput = Symbology | SymbologyGroup | string;
```

`resolveSymbologies()` accepts arrays or comma, space, semicolon or pipe separated strings, expands groups, removes duplicates and ignores unknown names. With no input it returns every symbology; with only unknown names it returns `[]`.

## Engine configuration

```ts
function configure(config: EngineConfig): void;
const VERSION: string;        // SDK version, e.g. "1.0.0"
const ENGINE_VERSION: string; // zxing-wasm version the SDK is built with

interface EngineConfig {
  readerWasmUrl?: string;
  writerWasmUrl?: string;
  wasmBaseUrl?: string;
  readerWasmBinary?: ArrayBuffer | Uint8Array;
  writerWasmBinary?: ArrayBuffer | Uint8Array;
  worker?: boolean; // default true
}
```

Call `configure()` before the first scan or generate call. Each call merges into the current configuration. `globalThis.QRGEN_WASM_BASE` is used as `wasmBaseUrl` when none is configured. Details: [Installation](../installation/#self-host-the-webassembly-engine).

## Utilities

```ts
function toBase64(bytes: Uint8Array | null | undefined): string;
function fromBase64(input: string): Uint8Array; // also accepts data: URLs
function quadCenter(q: Quadrilateral): Point;
function quadBounds(q: Quadrilateral): { x: number; y: number; width: number; height: number };
```

Use `fromBase64(barcode.rawBytes)` to get a result's raw payload bytes.

## Errors

```ts
class QRGenError extends Error {
  readonly name: "QRGenError";
  readonly code: QRGenErrorCode;
  readonly cause?: unknown;
  toJSON(): { code: QRGenErrorCode; message: string };
}

function toQRGenError(err: unknown): QRGenError; // maps getUserMedia DOMExceptions to codes

type QRGenErrorCode =
  | "camera-permission-denied" | "camera-not-found" | "camera-in-use" | "insecure-context"
  | "engine-load-failed" | "unsupported" | "bad-request" | "unknown";
```

Causes and fixes for each code: [Options, events & errors](../options-events/#error-codes).

## Types

```ts
interface Barcode {
  data: string;
  symbology: Symbology;
  symbologyName: string;
  rawBytes: string; // base64
  contentType: ContentType;
  isGS1: boolean;
  location: Quadrilateral;
  frameSize: Size;
  orientation: number;
  ecLevel: string;
  symbologyIdentifier: string;
  timestamp: number;
}

interface TrackedBarcode extends Barcode {
  id: number;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

type ContentType = "text" | "binary" | "gs1" | "iso15434" | "mixed" | "unknown-eci";
interface Point { x: number; y: number }
interface Quadrilateral { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }
interface Size { width: number; height: number }
interface ScanArea { x: number; y: number; width: number; height: number } // normalized 0..1
type ScanMode = "single" | "continuous" | "batch";
type CameraFacing = "back" | "front";
type ViewfinderStyle = "frame" | "line" | "none";
```

The fields are explained in [Core concepts](../concepts/#the-barcode-result).

## The QRGen namespace

The default export (and the `QRGen` named export) groups the most used functions, mirroring the other QRGen SDKs:

```ts
import QRGen from "qrgen-sdk";

QRGen.version;                 // SDK version
QRGen.engineVersion;           // engine version
QRGen.configure(config);
QRGen.scanImage(input, options);
QRGen.generate(data, options);
QRGen.generateSVG(data, options);
QRGen.generateDataURL(data, options);
QRGen.parseContent(data, options);
QRGen.parseGS1(data);
QRGen.parseAAMVA(data, options);
QRGen.resolveSymbologies(input);
QRGen.symbologies;             // SYMBOLOGIES
QRGen.supportedSymbologies();  // { read: Symbology[], write: Symbology[] }
QRGen.createScanner(options);  // new BarcodeScanner(options)
```

## Other entry points

| Entry point | Exports | Reference |
| --- | --- | --- |
| `qrgen-sdk/elements` | `QRGenScannerElement`, `QRGenBarcodeElement`, `defineElements()` (called on import) | [Web Components](../web-components/) |
| `qrgen-sdk/react` | `QRGenScanner`, `QRGenBarcode`, types `QRGenScannerProps`, `QRGenScannerHandle`, `QRGenBarcodeProps` | [React](../react/) |
| `qrgen-sdk/vue` | `QRGenScanner`, `QRGenBarcode`, `QRGenPlugin` | [Vue & Nuxt](../vue/) |
| `qrgen-sdk/parsers` | The parser functions and types above | [Parsers](../parsers/) |
| `qrgen-sdk/node` | Everything above, plus `scanFile`, `scan`, `generatePNG`, `generateToFile`, `useLocalEngine` | [Node.js](../nodejs/) |
| `qrgen-sdk/server` | `createServer(options)`, `createHandler(options)`, type `ServerOptions` | [REST API](../rest-api/#mount-in-your-own-server) |
| `qrgen-sdk/bridge` | `connectBridge`, `parseBridgeMessage`, `postToHost`, `detectChannels`, `attributesFromQuery`, types `BridgeMessage`, `BridgeCommand` | [Embed bridge](../embed-bridge/#qrgen-sdkbridge) |
