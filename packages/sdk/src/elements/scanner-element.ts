// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { Camera } from "../camera.js";
import { toQRGenError } from "../errors.js";
import { BarcodeScanner, type BarcodeScannerOptions, type ScannerState } from "../scanner.js";
import { resolveSymbologies, symbologyInfo } from "../symbologies.js";
import type { TrackerUpdate } from "../tracker.js";
import type { Barcode, Quadrilateral, ScanArea, ScanMode, TrackedBarcode, ViewfinderStyle } from "../types.js";
import { coverTransform, ensureMinHeight, inflateQuad, pointInQuad, quadToView, viewRectToScanArea, type CoverTransform } from "./geometry.js";
import { ICONS } from "./icons.js";
import { SCANNER_CSS } from "./styles.js";

const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : class {}) as typeof HTMLElement;

const ATTRS = [
  "symbologies",
  "mode",
  "duplicate-filter",
  "beep",
  "vibrate",
  "camera",
  "torch",
  "viewfinder",
  "scan-area",
  "max-results",
  "autostart",
  "controls",
  "accent",
  "try-harder",
  "worker",
  "hint",
  "toast",
  "resolution",
] as const;

function bool(v: string | null, fallback: boolean): boolean {
  if (v === null) return fallback;
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

/** Attribute value for a boolean property: frameworks may pass true/false or "true"/"false". */
function boolAttr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  return String(!!v);
}

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseArea(v: string | null): ScanArea | undefined {
  if (!v) return undefined;
  const p = v.split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return undefined;
  return { x: p[0]!, y: p[1]!, width: p[2]!, height: p[3]! };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

let sharedSheet: CSSStyleSheet | null | undefined;

/** A constructable stylesheet works under a strict CSP (no style-src 'unsafe-inline'). */
function scannerSheet(): CSSStyleSheet | null {
  if (sharedSheet !== undefined) return sharedSheet;
  try {
    const supported = typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype && "adoptedStyleSheets" in Document.prototype;
    if (!supported) return (sharedSheet = null);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SCANNER_CSS);
    return (sharedSheet = sheet);
  } catch {
    return (sharedSheet = null);
  }
}

interface Highlight {
  location: Quadrilateral;
  linear: boolean;
  at: number;
}

/**
 * `<qrgen-scanner>`: a complete camera scanning UI.
 *
 * ```html
 * <qrgen-scanner symbologies="qr,ean13,code128" mode="continuous"></qrgen-scanner>
 * <script type="module">
 *   import "qrgen-sdk/elements";
 *   document.querySelector("qrgen-scanner").addEventListener("scan", (e) => console.log(e.detail.barcode.data));
 * </script>
 * ```
 *
 * Events: `scan`, `track`, `select`, `ready`, `error`, `statechange`.
 */
export class QRGenScannerElement extends Base {
  static get observedAttributes(): string[] {
    return [...ATTRS];
  }

  private root!: ShadowRoot;
  private els!: {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    hit: HTMLDivElement;
    vf: HTMLDivElement;
    hint: HTMLDivElement;
    toast: HTMLDivElement;
    torch: HTMLButtonElement;
    switch: HTMLButtonElement;
    pause: HTMLButtonElement;
    zoom: HTMLButtonElement;
    count: HTMLDivElement;
    again: HTMLButtonElement;
    start: HTMLDivElement;
    loading: HTMLDivElement;
    error: HTMLDivElement;
  };
  private _scanner: BarcodeScanner | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private highlights: Highlight[] = [];
  private tracked: TrackedBarcode[] = [];
  private drawn = new Map<number, Quadrilateral>();
  private _selection = new Map<number, TrackedBarcode>();
  private raf = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private rendered = false;
  private pausedBySingle = false;
  private zoomLevel = 1;
  private scanned = 0;
  private lastScan: Barcode | null = null;

  /** The underlying scanner (created on first start). */
  get scanner(): BarcodeScanner | null {
    return this._scanner;
  }

  get state(): ScannerState {
    return this._scanner?.state ?? "idle";
  }

  /** Batch mode: barcodes the user tapped. */
  get selection(): TrackedBarcode[] {
    return [...this._selection.values()];
  }

  /** Last barcode reported by a `scan` event. */
  get lastResult(): Barcode | null {
    return this.lastScan;
  }

  // Property accessors so frameworks can pass arrays/objects/booleans directly.
  get symbologies(): string[] {
    return resolveSymbologies(this.getAttribute("symbologies"));
  }
  set symbologies(v: string[] | string) {
    this.setAttribute("symbologies", Array.isArray(v) ? v.join(",") : String(v));
  }
  get mode(): ScanMode {
    return (this.getAttribute("mode") as ScanMode) || "continuous";
  }
  set mode(v: ScanMode) {
    this.setAttribute("mode", v);
  }
  get duplicateFilter(): number | undefined {
    return num(this.getAttribute("duplicate-filter"));
  }
  set duplicateFilter(v: number | undefined) {
    if (v === undefined) this.removeAttribute("duplicate-filter");
    else this.setAttribute("duplicate-filter", String(v));
  }
  get beep(): boolean {
    return bool(this.getAttribute("beep"), true);
  }
  set beep(v: boolean | string) {
    this.setBoolAttr("beep", v);
  }
  get vibrate(): boolean {
    return bool(this.getAttribute("vibrate"), true);
  }
  set vibrate(v: boolean | string) {
    this.setBoolAttr("vibrate", v);
  }
  get camera(): string {
    return this.getAttribute("camera") || "back";
  }
  set camera(v: string) {
    this.setAttribute("camera", v);
  }
  get torch(): boolean {
    return bool(this.getAttribute("torch"), false);
  }
  set torch(v: boolean | string) {
    this.setBoolAttr("torch", v);
  }
  get viewfinder(): ViewfinderStyle | undefined {
    return (this.getAttribute("viewfinder") as ViewfinderStyle) || undefined;
  }
  set viewfinder(v: ViewfinderStyle | undefined) {
    if (!v) this.removeAttribute("viewfinder");
    else this.setAttribute("viewfinder", v);
  }
  get scanArea(): ScanArea | undefined {
    return parseArea(this.getAttribute("scan-area"));
  }
  set scanArea(v: ScanArea | undefined) {
    if (!v) this.removeAttribute("scan-area");
    else this.setAttribute("scan-area", `${v.x},${v.y},${v.width},${v.height}`);
  }
  get maxResults(): number | undefined {
    return num(this.getAttribute("max-results"));
  }
  set maxResults(v: number | undefined) {
    if (v === undefined) this.removeAttribute("max-results");
    else this.setAttribute("max-results", String(v));
  }
  get autostart(): boolean {
    return bool(this.getAttribute("autostart"), true);
  }
  set autostart(v: boolean | string) {
    this.setBoolAttr("autostart", v);
  }

  get controls(): string {
    return this.getAttribute("controls") ?? "default";
  }
  set controls(v: string) {
    this.setAttribute("controls", v);
  }
  get accent(): string | null {
    return this.getAttribute("accent");
  }
  set accent(v: string | null) {
    if (v) this.setAttribute("accent", v);
    else this.removeAttribute("accent");
  }
  get hint(): string | null {
    return this.getAttribute("hint");
  }
  set hint(v: string | null) {
    if (v === null || v === undefined) this.removeAttribute("hint");
    else this.setAttribute("hint", v);
  }
  get toast(): boolean {
    return bool(this.getAttribute("toast"), true);
  }
  set toast(v: boolean | string) {
    this.setBoolAttr("toast", v);
  }
  get tryHarder(): boolean {
    return bool(this.getAttribute("try-harder"), false);
  }
  set tryHarder(v: boolean | string) {
    this.setBoolAttr("try-harder", v);
  }
  get resolution(): string {
    return this.getAttribute("resolution") || "hd";
  }
  set resolution(v: string) {
    this.setAttribute("resolution", v);
  }
  get worker(): boolean {
    return bool(this.getAttribute("worker"), true);
  }
  set worker(v: boolean | string) {
    this.setBoolAttr("worker", v);
  }

  private setBoolAttr(name: string, v: unknown): void {
    const value = boolAttr(v);
    if (value === null) this.removeAttribute(name);
    else this.setAttribute(name, value);
  }

  /** Scanner options derived from the element's attributes. */
  get options(): BarcodeScannerOptions {
    const mode = (this.getAttribute("mode") as ScanMode) || "continuous";
    return {
      symbologies: this.getAttribute("symbologies") ?? undefined,
      mode,
      duplicateFilter: num(this.getAttribute("duplicate-filter")),
      beep: bool(this.getAttribute("beep"), true),
      vibrate: bool(this.getAttribute("vibrate"), true),
      camera: this.getAttribute("camera") || "back",
      viewfinder: (this.getAttribute("viewfinder") as ViewfinderStyle) || undefined,
      scanArea: parseArea(this.getAttribute("scan-area")),
      maxResults: num(this.getAttribute("max-results")),
      tryHarder: this.hasAttribute("try-harder") ? bool(this.getAttribute("try-harder"), false) : undefined,
      worker: bool(this.getAttribute("worker"), true),
      resolution: (this.getAttribute("resolution") as BarcodeScannerOptions["resolution"]) || undefined,
    };
  }

  connectedCallback(): void {
    this.render();
    if (this.autostart) queueMicrotask(() => void this.start().catch(() => undefined));
    else this.updateScreens("idle");
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this._scanner?.destroy();
    this._scanner = null;
    this.rendered = false;
    this.root?.replaceChildren();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (oldValue === value || !this.rendered) return;
    if (name === "accent") this.applyAccent();
    if (name === "hint" || name === "mode" || name === "viewfinder") this.updateHint();
    if (name === "torch" && this._scanner) void this._scanner.setTorch(bool(value, false)).then(() => this.updateControls());
    if ((name === "camera" || name === "resolution" || name === "worker") && this._scanner) {
      const running = this._scanner.state === "scanning" || this._scanner.state === "paused";
      this._scanner.destroy();
      this._scanner = null;
      if (running) void this.start().catch(() => undefined);
      return;
    }
    if (this._scanner) {
      this._scanner.setOptions(this.options);
      if (name === "mode") {
        this.tracked = [];
        this._selection.clear();
        this.drawn.clear();
        this.pausedBySingle = false;
        if (this._scanner.state === "paused") this._scanner.resume();
      }
    }
    this.layout();
  }

  private render(): void {
    if (this.rendered) return;
    this.root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const sheet = scannerSheet();
    if (sheet) (this.root as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
    this.root.innerHTML = `
      ${sheet ? "" : `<style>${SCANNER_CSS}</style>`}
      <div class="root" part="root">
        <video part="video" playsinline muted autoplay></video>
        <canvas class="overlay" part="overlay"></canvas>
        <div class="hit"></div>
        <div class="vf frame" part="viewfinder"><div class="shade"></div><span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span><div class="laser"></div></div>
        <div class="hint" part="hint"></div>
        <div class="toast" part="toast" role="status" aria-live="polite"><span class="ok">${ICONS.check}</span><span class="txt"><span class="sym"></span><span class="data"></span></span></div>
        <div class="bar top" part="controls">
          <div class="group"><button class="btn" data-a="pause" aria-label="Pause scanning">${ICONS.pause}</button></div>
          <div class="group">
            <button class="btn" data-a="torch" aria-label="Toggle flashlight" hidden>${ICONS.torch}</button>
            <button class="btn" data-a="switch" aria-label="Switch camera" hidden>${ICONS.switchCamera}</button>
          </div>
        </div>
        <div class="bar bottom" part="controls">
          <button class="pill" data-a="zoom" aria-label="Zoom" hidden>1×</button>
          <div class="count" hidden></div>
        </div>
        <button class="again" data-a="again" hidden>Scan again</button>
        <div class="screen" data-s="start" hidden>
          <div class="icon">${ICONS.scan}</div>
          <h3>Scan barcodes &amp; QR codes</h3>
          <p>Your camera feed is processed on this device and never uploaded.</p>
          <button class="cta" data-a="start">Start scanning</button>
        </div>
        <div class="screen" data-s="loading" hidden><div class="spinner"></div><p>Starting camera…</p></div>
        <div class="screen" data-s="error" hidden>
          <div class="icon">${ICONS.alert}</div>
          <h3>Camera unavailable</h3>
          <p class="msg"></p>
          <button class="cta" data-a="retry">Try again</button>
        </div>
      </div>`;
    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.els = {
      video: q("video"),
      canvas: q("canvas"),
      hit: q(".hit"),
      vf: q(".vf"),
      hint: q(".hint"),
      toast: q(".toast"),
      torch: q('[data-a="torch"]'),
      switch: q('[data-a="switch"]'),
      pause: q('[data-a="pause"]'),
      zoom: q('[data-a="zoom"]'),
      count: q(".count"),
      again: q(".again"),
      start: q('[data-s="start"]'),
      loading: q('[data-s="loading"]'),
      error: q('[data-s="error"]'),
    };
    this.root.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    this.els.hit.addEventListener("pointerup", (e) => this.onTap(e));
    this.els.video.addEventListener("resize", () => this.layout());
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this);
    }
    this.rendered = true;
    this.applyAccent();
    this.updateHint();
    this.layout();
  }

  private applyAccent(): void {
    const accent = this.getAttribute("accent");
    if (accent) this.style.setProperty("--qrgen-accent", accent);
    else this.style.removeProperty("--qrgen-accent");
  }

  private emitEvent<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private ensureScanner(): BarcodeScanner {
    if (this._scanner) return this._scanner;
    const s = new BarcodeScanner({ ...this.options, video: this.els.video });
    s.on("state", (st) => {
      this.updateScreens(st);
      this.emitEvent("statechange", { state: st });
    });
    s.on("ready", ({ engine }) => {
      this.els.video.classList.toggle("mirror", s.camera.isFront);
      this.layout();
      void this.refreshCameraControls();
      if (this.torch) void s.setTorch(true).then(() => this.updateControls());
      this.emitEvent("ready", { engine });
    });
    s.on("error", (err) => {
      const msg = this.els.error.querySelector(".msg");
      if (msg) msg.textContent = err.message;
      this.emitEvent("error", err.toJSON());
    });
    s.on("frame", ({ barcodes }) => {
      if (s.options.mode === "batch" || !barcodes.length) return;
      const t = performance.now();
      this.highlights = barcodes.map((b) => ({ location: b.location, linear: symbologyInfo(b.symbology).kind === "linear", at: t }));
      this.requestDraw();
    });
    s.on("track", (u: TrackerUpdate) => {
      this.tracked = u.tracked;
      for (const r of u.removed) this.drawn.delete(r.id);
      this.updateCount();
      this.emitEvent("track", { tracked: u.tracked, added: u.added, removed: u.removed });
      this.requestDraw();
    });
    s.on("scan", ({ barcodes }) => {
      this.scanned += barcodes.length;
      this.lastScan = barcodes[barcodes.length - 1] ?? null;
      if (s.options.mode !== "batch") this.showToast(barcodes[0]!);
      this.flashViewfinder();
      this.els.hint.style.opacity = "0";
      if (s.options.mode === "single") {
        this.pausedBySingle = true;
        this.updateScreens(s.state);
      }
      this.emitEvent("scan", { barcodes, barcode: barcodes[0] });
    });
    this._scanner = s;
    return s;
  }

  /** Start the camera and scanning. Resolves when frames are being decoded. */
  async start(): Promise<void> {
    this.render();
    const s = this.ensureScanner();
    this.pausedBySingle = false;
    try {
      await s.start();
    } catch (err) {
      const e = toQRGenError(err);
      const msg = this.els.error.querySelector(".msg");
      if (msg) msg.textContent = e.message;
      throw e;
    }
  }

  /** Stop scanning and release the camera. */
  stop(): void {
    this._scanner?.stop();
    this.highlights = [];
    this.tracked = [];
    this.drawn.clear();
    this.requestDraw();
  }

  pause(): void {
    this._scanner?.pause();
  }

  resume(): void {
    this.pausedBySingle = false;
    this.els.again.hidden = true;
    this._scanner?.resume();
  }

  async setTorch(on: boolean): Promise<boolean> {
    const ok = (await this._scanner?.setTorch(on)) ?? false;
    this.updateControls();
    return ok;
  }

  async toggleTorch(): Promise<boolean> {
    const on = (await this._scanner?.toggleTorch()) ?? false;
    this.updateControls();
    return on;
  }

  async switchCamera(): Promise<void> {
    if (!this._scanner) return;
    await this._scanner.switchCamera();
    this.els.video.classList.toggle("mirror", this._scanner.camera.isFront);
    this.layout();
    await this.refreshCameraControls();
  }

  async setZoom(zoom: number): Promise<boolean> {
    return (await this._scanner?.setZoom(zoom)) ?? false;
  }

  /** Batch mode: clear the user's selection (tracking continues). */
  clearSelection(): void {
    this._selection.clear();
    this.requestDraw();
    this.updateCount();
    this.emitEvent("select", { barcode: null, selected: false, selection: [] });
  }

  private async refreshCameraControls(): Promise<void> {
    const s = this._scanner;
    if (!s) return;
    const caps = s.camera.capabilities;
    this.els.torch.hidden = !caps.torch;
    this.els.zoom.hidden = !caps.zoom || caps.zoom.max < 2;
    try {
      const cams = await Camera.list();
      this.els.switch.hidden = cams.length < 2;
    } catch {
      this.els.switch.hidden = true;
    }
    this.updateControls();
  }

  private updateControls(): void {
    const s = this._scanner;
    const torchOn = !!s?.camera.isTorchOn;
    this.els.torch.classList.toggle("on", torchOn);
    this.els.torch.innerHTML = torchOn ? ICONS.torchOn : ICONS.torch;
    this.els.torch.setAttribute("aria-pressed", String(torchOn));
    const paused = s?.state === "paused";
    this.els.pause.innerHTML = paused ? ICONS.play : ICONS.pause;
    this.els.pause.setAttribute("aria-label", paused ? "Resume scanning" : "Pause scanning");
    this.els.zoom.textContent = `${this.zoomLevel}×`;
  }

  private updateScreens(state: ScannerState): void {
    if (!this.rendered) return;
    this.els.start.hidden = !(state === "idle" || state === "stopped");
    this.els.loading.hidden = state !== "starting";
    this.els.error.hidden = state !== "error";
    this.els.again.hidden = !(state === "paused" && this.pausedBySingle);
    this.els.pause.hidden = state !== "scanning" && state !== "paused";
    if (state === "scanning") this.pausedBySingle = false;
    this.updateControls();
    if (state === "scanning" || state === "paused") this.requestDraw();
  }

  private updateHint(): void {
    if (!this.rendered) return;
    const custom = this.getAttribute("hint");
    const mode = this.getAttribute("mode") || "continuous";
    const text = custom ?? (mode === "batch" ? "Point the camera at several barcodes. Tap one to select it." : "Point the camera at a barcode or QR code");
    this.els.hint.textContent = text;
    this.els.hint.hidden = !text;
    this.els.hint.style.opacity = this.scanned ? "0" : "1";
  }

  private updateCount(): void {
    const batch = (this._scanner?.options.mode ?? this.mode) === "batch";
    const n = this.tracked.length;
    this.els.count.hidden = !batch || (n === 0 && this._selection.size === 0);
    const sel = this._selection.size;
    this.els.count.textContent = sel ? `${sel} selected · ${n} in view` : `${n} barcode${n === 1 ? "" : "s"} in view`;
  }

  private showToast(b: Barcode): void {
    if (!bool(this.getAttribute("toast"), true)) return;
    const sym = this.els.toast.querySelector(".sym");
    const data = this.els.toast.querySelector(".data");
    if (sym) sym.textContent = b.symbologyName;
    if (data) data.innerHTML = escapeHtml(b.data.length > 120 ? `${b.data.slice(0, 120)}…` : b.data);
    this.els.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.els.toast.classList.remove("show"), 2400);
  }

  private flashViewfinder(): void {
    this.els.vf.classList.add("hit-ok");
    setTimeout(() => this.els.vf.classList.remove("hit-ok"), 450);
  }

  private transform(): CoverTransform | null {
    const v = this.els.video;
    const w = this.clientWidth;
    const h = this.clientHeight;
    if (!v.videoWidth || !v.videoHeight || !w || !h) return null;
    return coverTransform({ width: w, height: h }, { width: v.videoWidth, height: v.videoHeight }, v.classList.contains("mirror"));
  }

  /** Size the viewfinder and derive the decode region from it. */
  private layout(): void {
    if (!this.rendered) return;
    const w = this.clientWidth;
    const h = this.clientHeight;
    const opts = this.options;
    const mode = opts.mode ?? "continuous";
    const syms = resolveSymbologies(opts.symbologies);
    const onlyLinear = syms.length > 0 && syms.every((s) => symbologyInfo(s).kind === "linear");
    const style: ViewfinderStyle = opts.viewfinder ?? (onlyLinear ? "line" : "frame");
    const vf = this.els.vf;
    const hidden = mode === "batch" || style === "none";
    vf.classList.toggle("hidden", hidden);
    vf.classList.toggle("line", style === "line");
    vf.classList.toggle("frame", style !== "line");
    let rect: { x: number; y: number; width: number; height: number };
    if (style === "line") {
      const vw = Math.min(w * 0.86, 560);
      const vh = Math.min(h * 0.3, 170);
      rect = { x: (w - vw) / 2, y: (h - vh) / 2, width: vw, height: vh };
    } else {
      const side = Math.min(Math.min(w, h) * 0.66, 380);
      rect = { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side };
    }
    vf.style.width = `${rect.width}px`;
    vf.style.height = `${rect.height}px`;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const c = this.els.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    // Decode only what the user sees inside the viewfinder (plus a margin), unless an explicit area was set.
    const t = this.transform();
    if (this._scanner && t && !opts.scanArea) {
      const area = hidden ? viewRectToScanArea({ x: 0, y: 0, width: w, height: h }, t, 0) : viewRectToScanArea(rect, t, 0.12);
      this._scanner.setOptions({ ...opts, scanArea: area });
    }
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.raf || !this.rendered) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(): void {
    const c = this.els.canvas;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = c.width / Math.max(1, this.clientWidth);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const t = this.transform();
    if (!t) return;
    ctx.scale(dpr, dpr);
    const accent = getComputedStyle(this).getPropertyValue("--qrgen-accent").trim() || "#5cc9d6";
    const batch = this._scanner?.options.mode === "batch";
    let again = false;
    if (batch) {
      this.drawn.clear();
      for (const tb of this.tracked) {
        const linear = symbologyInfo(tb.symbology).kind === "linear";
        let q = quadToView(tb.location, t);
        q = inflateQuad(linear ? ensureMinHeight(q, 26) : q, 6);
        this.drawn.set(tb.id, q);
        const selected = this._selection.has(tb.id);
        this.polygon(ctx, q);
        ctx.fillStyle = selected ? hexA(accent, 0.55) : hexA(accent, 0.2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent;
        ctx.stroke();
        if (selected) this.checkmark(ctx, q, accent);
        else if (this.tracked.length <= 8) this.label(ctx, q, tb.data);
      }
    } else {
      const now = performance.now();
      this.highlights = this.highlights.filter((hl) => now - hl.at < 700);
      for (const hl of this.highlights) {
        const alpha = 1 - (now - hl.at) / 700;
        let q = quadToView(hl.location, t);
        q = inflateQuad(hl.linear ? ensureMinHeight(q, 22) : q, 5);
        this.polygon(ctx, q);
        ctx.fillStyle = hexA(accent, 0.22 * alpha);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = hexA(accent, alpha);
        ctx.stroke();
      }
      again = this.highlights.length > 0;
    }
    if (again) this.requestDraw();
  }

  private polygon(ctx: CanvasRenderingContext2D, q: Quadrilateral): void {
    ctx.beginPath();
    ctx.lineJoin = "round";
    ctx.moveTo(q.topLeft.x, q.topLeft.y);
    ctx.lineTo(q.topRight.x, q.topRight.y);
    ctx.lineTo(q.bottomRight.x, q.bottomRight.y);
    ctx.lineTo(q.bottomLeft.x, q.bottomLeft.y);
    ctx.closePath();
  }

  private checkmark(ctx: CanvasRenderingContext2D, q: Quadrilateral, accent: string): void {
    const cx = (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4;
    const cy = (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx - 1.5, cy + 4.5);
    ctx.lineTo(cx + 6.5, cy - 4.5);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#062029";
    ctx.stroke();
  }

  private label(ctx: CanvasRenderingContext2D, q: Quadrilateral, text: string): void {
    const x = Math.min(q.topLeft.x, q.bottomLeft.x);
    const y = Math.min(q.topLeft.y, q.topRight.y) - 8;
    const s = text.length > 22 ? `${text.slice(0, 22)}…` : text;
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    const w = ctx.measureText(s).width + 12;
    ctx.fillStyle = "rgba(8,12,18,.78)";
    ctx.beginPath();
    const r = 6;
    const yy = Math.max(2, y - 20);
    ctx.roundRect ? ctx.roundRect(x, yy, w, 20, r) : ctx.rect(x, yy, w, 20);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(s, x + 6, yy + 14);
  }

  private onTap(e: PointerEvent): void {
    if (this._scanner?.options.mode !== "batch") return;
    const r = this.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    for (const tb of this.tracked) {
      const q = this.drawn.get(tb.id);
      if (!q || !pointInQuad(p, q)) continue;
      const selected = !this._selection.has(tb.id);
      if (selected) this._selection.set(tb.id, tb);
      else this._selection.delete(tb.id);
      this._scanner?.feedback.vibrate(20);
      this.updateCount();
      this.requestDraw();
      this.emitEvent("select", { barcode: tb, selected, selection: this.selection });
      return;
    }
  }

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.a;
    const s = this._scanner;
    switch (action) {
      case "start":
      case "retry":
        void this.start().catch(() => undefined);
        break;
      case "again":
        this.resume();
        break;
      case "pause":
        if (s?.state === "paused") this.resume();
        else this.pause();
        break;
      case "torch":
        void this.toggleTorch();
        break;
      case "switch":
        void this.switchCamera();
        break;
      case "zoom": {
        const z = s?.camera.capabilities.zoom;
        if (!z) break;
        this.zoomLevel = this.zoomLevel === 1 ? Math.min(2, z.max) : 1;
        void this.setZoom(this.zoomLevel).then(() => this.updateControls());
        break;
      }
    }
  }
}

let colorCtx: CanvasRenderingContext2D | null | undefined;

/** Any CSS color with the given alpha, e.g. hexA("teal", 0.2) → "rgba(0, 128, 128, 0.2)". */
function hexA(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  let c = color.trim();
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) {
    // Let the canvas normalize named, rgb() and hsl() colors to #rrggbb / rgba().
    if (colorCtx === undefined) colorCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (!colorCtx) return c;
    colorCtx.fillStyle = "#000";
    colorCtx.fillStyle = c;
    c = String(colorCtx.fillStyle);
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
  }
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
