import { Camera } from "./camera.js";
import { DuplicateFilter } from "./duplicate-filter.js";
import { toBarcodes } from "./engine/convert.js";
import { createFrameDecoder, type FrameDecoder } from "./engine/decoder.js";
import type { DecodeParams } from "./engine/protocol.js";
import { QRGenError, toQRGenError } from "./errors.js";
import { Feedback } from "./feedback.js";
import { ALL_SYMBOLOGIES, resolveSymbologies, symbologyInfo, toZXingReadFormats, type Symbology } from "./symbologies.js";
import { BarcodeTracker, type TrackerUpdate } from "./tracker.js";
import type { Barcode, ScanArea, ScannerOptions, Size, ViewfinderStyle } from "./types.js";
import { Emitter } from "./util.js";

export type ScannerState = "idle" | "starting" | "scanning" | "paused" | "stopped" | "error";

export interface FrameEvent {
  barcodes: Barcode[];
  frameSize: Size;
  decodeMs: number;
}

export interface ScannerEvents extends Record<string, unknown> {
  /** New barcodes that passed the duplicate filter. */
  scan: { barcodes: Barcode[] };
  /** Batch mode: the full set of tracked barcodes after each frame. */
  track: TrackerUpdate;
  /** Every decoded frame (including duplicates), for custom overlays. */
  frame: FrameEvent;
  error: QRGenError;
  state: ScannerState;
  ready: { engine: "worker" | "main"; camera: Camera };
}

export interface BarcodeScannerOptions extends ScannerOptions {
  /** Video element to render the camera into. A hidden one is created when omitted. */
  video?: HTMLVideoElement;
  /** Longest side, in pixels, of the image handed to the decoder. Default 1280. */
  maxDecodeSize?: number;
  /** Upper bound for decodes per second. Default 24. */
  maxFps?: number;
  /** Also look for white-on-black codes (costs time). Default: alternate frames. */
  tryInvert?: boolean | "alternate";
}

interface ResolvedOptions {
  symbologies: Symbology[];
  mode: "single" | "continuous" | "batch";
  duplicateFilter: number;
  beep: boolean;
  vibrate: boolean;
  scanArea: ScanArea | null;
  maxResults: number;
  tryHarder: boolean;
  maxDecodeSize: number;
  maxFps: number;
  tryInvert: boolean | "alternate";
  viewfinder: ViewfinderStyle;
}

function resolveOptions(o: BarcodeScannerOptions): ResolvedOptions {
  const symbologies = resolveSymbologies(o.symbologies);
  const mode = o.mode ?? "continuous";
  const onlyLinear = symbologies.length > 0 && symbologies.every((s) => symbologyInfo(s).kind === "linear");
  return {
    symbologies,
    mode,
    duplicateFilter: o.duplicateFilter ?? (mode === "batch" ? -1 : 1000),
    beep: o.beep ?? true,
    vibrate: o.vibrate ?? true,
    scanArea: o.scanArea ?? null,
    maxResults: o.maxResults ?? (mode === "batch" ? 20 : 1),
    // Batch codes can be anywhere in the frame; linear codes off-center need tryHarder.
    tryHarder: o.tryHarder ?? mode === "batch",
    maxDecodeSize: o.maxDecodeSize ?? 1280,
    maxFps: o.maxFps ?? 24,
    tryInvert: o.tryInvert ?? "alternate",
    viewfinder: o.viewfinder ?? (onlyLinear ? "line" : "frame"),
  };
}

/**
 * Camera barcode scanner: opens the camera, decodes frames off the main thread and
 * reports results with duplicate filtering, feedback and batch tracking.
 *
 * ```ts
 * const scanner = new BarcodeScanner({ symbologies: ["qr", "ean13"], video: myVideo });
 * scanner.on("scan", ({ barcodes }) => console.log(barcodes[0].data));
 * await scanner.start();
 * ```
 *
 * For a ready-made UI use the `<qrgen-scanner>` element from `qrgen-sdk/elements`.
 */
export class BarcodeScanner extends Emitter<ScannerEvents> {
  readonly camera: Camera;
  readonly video: HTMLVideoElement;
  readonly feedback: Feedback;
  readonly tracker = new BarcodeTracker();
  private opts: ResolvedOptions;
  private filter: DuplicateFilter;
  private decoder: FrameDecoder | null = null;
  private _state: ScannerState = "idle";
  private busy = false;
  private frameHandle = 0;
  private lastDecodeStart = 0;
  private frameCount = 0;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private ownsVideo: boolean;
  private lastBatchBeep = 0;
  private startToken = 0;
  /** Rolling statistics for diagnostics. */
  readonly stats = { decodeMs: 0, fps: 0, engine: "" as "" | "worker" | "main" };
  private fpsWindow: number[] = [];

  /** Options as the caller gave them; defaults are re-derived from these on every change. */
  private raw: BarcodeScannerOptions;

  constructor(options: BarcodeScannerOptions = {}) {
    super();
    const { video: _video, ...raw } = options;
    this.raw = raw;
    this.opts = resolveOptions(options);
    this.filter = new DuplicateFilter(this.opts.duplicateFilter);
    this.camera = new Camera({ camera: options.camera, resolution: options.resolution });
    this.feedback = new Feedback({ beep: this.opts.beep, vibrate: this.opts.vibrate });
    this.ownsVideo = !options.video;
    this.video = options.video ?? (typeof document !== "undefined" ? document.createElement("video") : (null as unknown as HTMLVideoElement));
    if (options.worker === false) this.preferWorker = false;
  }

  private preferWorker = true;

  get state(): ScannerState {
    return this._state;
  }

  get options(): Readonly<ResolvedOptions> {
    return this.opts;
  }

  private setState(s: ScannerState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit("state", s);
  }

  /** Update options while running (symbologies, mode, duplicate filter, scan area…). */
  setOptions(partial: Partial<BarcodeScannerOptions>): void {
    const { video: _video, ...rest } = partial;
    this.raw = { ...this.raw, ...rest };
    const merged = resolveOptions(this.raw);
    const modeChanged = merged.mode !== this.opts.mode;
    this.opts = merged;
    this.filter.window = merged.duplicateFilter;
    this.feedback.options = { ...this.feedback.options, beep: merged.beep, vibrate: merged.vibrate };
    if (modeChanged) {
      this.tracker.clear();
      this.filter.reset();
    }
    if (partial.torch !== undefined && this._state === "scanning") void this.camera.setTorch(!!partial.torch);
  }

  /** Open the camera and start decoding. Call from a user gesture for sound on iOS. */
  async start(): Promise<void> {
    if (this._state === "scanning" || this._state === "starting") return;
    const token = ++this.startToken;
    this.setState("starting");
    this.feedback.unlock();
    try {
      const [decoder] = await Promise.all([this.decoder ? Promise.resolve(this.decoder) : createFrameDecoder(this.preferWorker), this.camera.start(this.video)]);
      if (token !== this.startToken) return; // stopped while starting
      this.decoder = decoder;
      this.stats.engine = decoder.kind;
      this.filter.reset();
      this.tracker.clear();
      this.setState("scanning");
      if (this.raw.torch) await this.camera.setTorch(true);
      this.emit("ready", { engine: decoder.kind, camera: this.camera });
      this.schedule();
    } catch (err) {
      if (token !== this.startToken) return;
      this.camera.stop();
      const e = toQRGenError(err);
      this.setState("error");
      this.emit("error", e);
      throw e;
    }
  }

  /** Stop decoding and release the camera. */
  stop(): void {
    this.startToken++;
    this.cancelFrame();
    this.camera.stop();
    this.tracker.clear();
    if (this._state !== "idle") this.setState("stopped");
  }

  /** Stop decoding but keep the camera running. */
  pause(): void {
    if (this._state !== "scanning") return;
    this.cancelFrame();
    this.setState("paused");
  }

  /** Resume decoding after pause() or a single-mode scan. */
  resume(): void {
    if (this._state !== "paused") return;
    this.filter.reset();
    this.setState("scanning");
    this.schedule();
  }

  async setTorch(on: boolean): Promise<boolean> {
    return this.camera.setTorch(on);
  }

  async toggleTorch(): Promise<boolean> {
    const next = !this.camera.isTorchOn;
    return (await this.camera.setTorch(next)) ? next : this.camera.isTorchOn;
  }

  async setZoom(zoom: number): Promise<boolean> {
    return this.camera.setZoom(zoom);
  }

  async switchCamera(): Promise<void> {
    const wasScanning = this._state === "scanning";
    this.cancelFrame();
    await this.camera.switch();
    this.tracker.clear();
    if (wasScanning) this.schedule();
  }

  /** Release everything, including the decoder reference. */
  destroy(): void {
    this.stop();
    this.feedback.dispose();
    this.removeAllListeners();
    if (this.ownsVideo) this.video?.remove();
    this.decoder = null;
    this.setState("idle");
  }

  private cancelFrame(): void {
    if (!this.frameHandle) return;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (typeof v.cancelVideoFrameCallback === "function") v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private schedule(): void {
    if (this._state !== "scanning") return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const tick = () => {
      this.frameHandle = 0;
      void this.onFrame();
    };
    this.frameHandle = typeof v.requestVideoFrameCallback === "function" ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  private grab(): { image: ImageData; offsetX: number; offsetY: number; scale: number; frame: Size } | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    const a = this.opts.scanArea;
    const sx = a ? Math.max(0, Math.round(a.x * vw)) : 0;
    const sy = a ? Math.max(0, Math.round(a.y * vh)) : 0;
    const sw = a ? Math.min(vw - sx, Math.round(a.width * vw)) : vw;
    const sh = a ? Math.min(vh - sy, Math.round(a.height * vh)) : vh;
    if (sw < 16 || sh < 16) return null;
    const scale = Math.max(1, Math.max(sw, sh) / this.opts.maxDecodeSize);
    const dw = Math.round(sw / scale);
    const dh = Math.round(sh / scale);
    if (!this.canvas || this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(dw, dh) : Object.assign(document.createElement("canvas"), { width: dw, height: dh });
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    }
    if (!this.ctx) return null;
    this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, dw, dh);
    return { image: this.ctx.getImageData(0, 0, dw, dh), offsetX: sx, offsetY: sy, scale, frame: { width: vw, height: vh } };
  }

  private async onFrame(): Promise<void> {
    if (this._state !== "scanning" || !this.decoder) return;
    const now = performance.now();
    const minInterval = 1000 / this.opts.maxFps;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (this.busy || hidden || now - this.lastDecodeStart < minInterval) return this.schedule();
    const grabbed = this.grab();
    if (!grabbed) return this.schedule();
    this.busy = true;
    this.lastDecodeStart = now;
    this.frameCount++;
    const o = this.opts;
    const params: DecodeParams = {
      formats: toZXingReadFormats(o.symbologies),
      tryHarder: o.tryHarder,
      tryRotate: true,
      tryInvert: o.tryInvert === "alternate" ? this.frameCount % 2 === 0 : o.tryInvert,
      tryDownscale: true,
      maxNumberOfSymbols: o.maxResults,
    };
    // Schedule the next frame now so the video callback chain never stalls.
    this.schedule();
    try {
      const raws = await this.decoder.decode(grabbed.image, params);
      const decodeMs = performance.now() - now;
      this.stats.decodeMs = this.stats.decodeMs ? this.stats.decodeMs * 0.8 + decodeMs * 0.2 : decodeMs;
      this.fpsWindow.push(now);
      while (this.fpsWindow.length && now - this.fpsWindow[0]! > 1000) this.fpsWindow.shift();
      this.stats.fps = this.fpsWindow.length;
      if (this._state !== "scanning") return;
      const requested = o.symbologies.length === ALL_SYMBOLOGIES.length ? undefined : new Set(o.symbologies);
      const barcodes = toBarcodes(raws, {
        frameSize: grabbed.frame,
        offsetX: grabbed.offsetX,
        offsetY: grabbed.offsetY,
        scale: grabbed.scale,
        requested,
      });
      this.emit("frame", { barcodes, frameSize: grabbed.frame, decodeMs });
      this.handleResults(barcodes);
    } catch (err) {
      const e = toQRGenError(err);
      if (e.code === "engine-load-failed") {
        this.emit("error", e);
        this.stop();
      }
    } finally {
      this.busy = false;
    }
  }

  private handleResults(barcodes: Barcode[]): void {
    const o = this.opts;
    if (o.mode === "batch") {
      const update = this.tracker.update(barcodes);
      this.emit("track", update);
      const fresh = update.added.filter((b) => this.filter.accept(b));
      if (fresh.length) {
        const t = Date.now();
        if (t - this.lastBatchBeep > 250) {
          this.feedback.success();
          this.lastBatchBeep = t;
        }
        this.emit("scan", { barcodes: fresh });
      }
      return;
    }
    const fresh = barcodes.filter((b) => this.filter.accept(b));
    if (!fresh.length) return;
    this.feedback.success();
    if (o.mode === "single") this.pause();
    this.emit("scan", { barcodes: fresh });
  }
}
