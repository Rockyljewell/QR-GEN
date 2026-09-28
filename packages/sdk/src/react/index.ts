// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type ReactElement, type Ref } from "react";
import { defineElements } from "../elements/define.js";
import type { QRGenScannerElement } from "../elements/scanner-element.js";
import type { GenerateOptions } from "../generator.js";
import type { ScannerState } from "../scanner.js";
import type { SymbologyInput } from "../symbologies.js";
import type { TrackerUpdate } from "../tracker.js";
import type { Barcode, QRGenErrorCode, ScanArea, ScanMode, TrackedBarcode, ViewfinderStyle } from "../types.js";

defineElements();

// Listeners must be attached before the element's autostart microtask runs, so use a layout effect
// in the browser (and a plain effect on the server, where layout effects warn).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface QRGenScannerProps {
  symbologies?: SymbologyInput[] | string;
  mode?: ScanMode;
  duplicateFilter?: number;
  beep?: boolean;
  vibrate?: boolean;
  camera?: "back" | "front" | (string & {});
  torch?: boolean;
  viewfinder?: ViewfinderStyle;
  scanArea?: ScanArea;
  maxResults?: number;
  /** Start the camera on mount. Default true. */
  autostart?: boolean;
  /** "none" hides the built-in buttons. */
  controls?: "default" | "none";
  /** Accent color for the viewfinder, highlights and buttons. */
  accent?: string;
  hint?: string;
  /** Show the success toast. Default true. */
  toast?: boolean;
  tryHarder?: boolean;
  resolution?: "sd" | "hd" | "fhd" | "4k";
  /** Decode in a Web Worker (default true). */
  worker?: boolean;
  className?: string;
  style?: CSSProperties;
  onScan?: (barcodes: Barcode[], barcode: Barcode) => void;
  onTrack?: (update: Pick<TrackerUpdate, "tracked" | "added" | "removed">) => void;
  onSelect?: (detail: { barcode: TrackedBarcode | null; selected: boolean; selection: TrackedBarcode[] }) => void;
  onError?: (error: { code: QRGenErrorCode; message: string }) => void;
  onReady?: (detail: { engine: "worker" | "main" }) => void;
  onStateChange?: (state: ScannerState) => void;
}

/** Imperative controls exposed through `ref`. */
export interface QRGenScannerHandle {
  element: QRGenScannerElement | null;
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  setTorch(on: boolean): Promise<boolean>;
  toggleTorch(): Promise<boolean>;
  switchCamera(): Promise<void>;
  setZoom(zoom: number): Promise<boolean>;
  /** Batch mode: clear the user's selection. */
  clearSelection(): void;
}

function attrs(p: QRGenScannerProps): Record<string, string | undefined> {
  const b = (v: boolean | undefined) => (v === undefined ? undefined : String(v));
  return {
    symbologies: Array.isArray(p.symbologies) ? p.symbologies.join(",") : p.symbologies,
    mode: p.mode,
    "duplicate-filter": p.duplicateFilter === undefined ? undefined : String(p.duplicateFilter),
    beep: b(p.beep),
    vibrate: b(p.vibrate),
    camera: p.camera,
    torch: b(p.torch),
    viewfinder: p.viewfinder,
    "scan-area": p.scanArea ? `${p.scanArea.x},${p.scanArea.y},${p.scanArea.width},${p.scanArea.height}` : undefined,
    "max-results": p.maxResults === undefined ? undefined : String(p.maxResults),
    autostart: b(p.autostart),
    controls: p.controls,
    accent: p.accent,
    hint: p.hint,
    toast: b(p.toast),
    "try-harder": b(p.tryHarder),
    resolution: p.resolution,
    worker: b(p.worker),
  };
}

/**
 * Camera barcode scanner component (wraps `<qrgen-scanner>`).
 *
 * ```tsx
 * <QRGenScanner symbologies={["qr", "ean13"]} mode="single" onScan={(codes) => setCode(codes[0].data)} />
 * ```
 */
export const QRGenScanner = forwardRef(function QRGenScanner(props: QRGenScannerProps, ref: Ref<QRGenScannerHandle>): ReactElement {
  const el = useRef<QRGenScannerElement | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useImperativeHandle(
    ref,
    () => ({
      get element() {
        return el.current;
      },
      start: () => el.current?.start() ?? Promise.resolve(),
      stop: () => el.current?.stop(),
      pause: () => el.current?.pause(),
      resume: () => el.current?.resume(),
      setTorch: (on: boolean) => el.current?.setTorch(on) ?? Promise.resolve(false),
      toggleTorch: () => el.current?.toggleTorch() ?? Promise.resolve(false),
      switchCamera: () => el.current?.switchCamera() ?? Promise.resolve(),
      setZoom: (z: number) => el.current?.setZoom(z) ?? Promise.resolve(false),
      clearSelection: () => el.current?.clearSelection(),
    }),
    [],
  );

  useIsomorphicLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const listen = (name: string, fn: (d: never) => void) => {
      const h = (e: Event) => fn((e as CustomEvent).detail as never);
      node.addEventListener(name, h);
      return () => node.removeEventListener(name, h);
    };
    const offs = [
      listen("scan", (d: { barcodes: Barcode[]; barcode: Barcode }) => handlers.current.onScan?.(d.barcodes, d.barcode)),
      listen("track", (d: Pick<TrackerUpdate, "tracked" | "added" | "removed">) => handlers.current.onTrack?.(d)),
      listen("select", (d: { barcode: TrackedBarcode | null; selected: boolean; selection: TrackedBarcode[] }) => handlers.current.onSelect?.(d)),
      listen("error", (d: { code: QRGenErrorCode; message: string }) => handlers.current.onError?.(d)),
      listen("ready", (d: { engine: "worker" | "main" }) => handlers.current.onReady?.(d)),
      listen("statechange", (d: { state: ScannerState }) => handlers.current.onStateChange?.(d.state)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const a = attrs(props);
  const clean: Record<string, unknown> = { ref: el, className: props.className, style: props.style };
  for (const [k, v] of Object.entries(a)) if (v !== undefined) clean[k] = v;
  return createElement("qrgen-scanner", clean);
});

export interface QRGenBarcodeProps extends Omit<GenerateOptions, "extraOptions" | "version"> {
  value: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Render a barcode as SVG (wraps `<qrgen-barcode>`).
 *
 * ```tsx
 * <QRGenBarcode value="https://example.com" symbology="qr" style={{ width: 160 }} />
 * ```
 */
export function QRGenBarcode(props: QRGenBarcodeProps): ReactElement {
  const p: Record<string, unknown> = { value: props.value, className: props.className, style: props.style };
  if (props.symbology) p.symbology = String(props.symbology);
  if (props.scale !== undefined) p.scale = String(props.scale);
  if (props.ecLevel) p["ec-level"] = props.ecLevel;
  if (props.foreground) p.foreground = props.foreground;
  if (props.background) p.background = props.background;
  if (props.hrt) p.hrt = "true";
  if (props.margin === false) p.margin = "false";
  if (props.gs1) p.gs1 = "true";
  if (props.rotate) p.rotate = String(props.rotate);
  if (props.alt) p.alt = props.alt;
  return createElement("qrgen-barcode", p);
}

export type { Barcode, TrackedBarcode, ScannerState };

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "qrgen-scanner": Record<string, unknown>;
      "qrgen-barcode": Record<string, unknown>;
    }
  }
}
