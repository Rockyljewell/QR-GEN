/**
 * Embed bridge (docs/SPEC.md §5): lets a scanner running in a WebView or iframe talk
 * to its host (React Native, Flutter, iOS/Android WebViews, .NET MAUI, iframes…).
 */
import type { Barcode, TrackedBarcode } from "../types.js";

export type BridgeMessage =
  | { source: "qrgen"; version: 1; type: "ready"; engine?: string }
  | { source: "qrgen"; version: 1; type: "scan"; barcodes: Barcode[] }
  | { source: "qrgen"; version: 1; type: "track"; tracked: TrackedBarcode[] }
  | { source: "qrgen"; version: 1; type: "select"; barcode: TrackedBarcode | null; selected: boolean; selection: TrackedBarcode[] }
  | { source: "qrgen"; version: 1; type: "state"; state: string }
  | { source: "qrgen"; version: 1; type: "error"; code: string; message: string };

export type BridgeCommand =
  | { type: "start" }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "torch"; value?: boolean }
  | { type: "switchCamera" }
  | { type: "zoom"; value: number }
  | { type: "options"; value: Record<string, string> };

type Poster = { postMessage: (msg: unknown, target?: string) => void };
type HostWindow = Window & {
  ReactNativeWebView?: Poster;
  QRGenBridge?: Poster;
  QRGenAndroid?: Poster;
  webkit?: { messageHandlers?: Record<string, Poster> };
  chrome?: { webview?: Poster };
  qrgen?: { command: (cmd: BridgeCommand) => void; channels: string[] };
};

/** Which host channels are present in this window. */
export function detectChannels(w: HostWindow = window as HostWindow): string[] {
  const c: string[] = [];
  if (w.ReactNativeWebView) c.push("react-native");
  if (w.QRGenBridge) c.push("flutter");
  if (w.webkit?.messageHandlers?.qrgen) c.push("wkwebview");
  if (w.chrome?.webview) c.push("webview2");
  if (w.QRGenAndroid) c.push("android");
  if (w.parent && w.parent !== w) c.push("iframe");
  if (w.opener) c.push("opener");
  return c;
}

/** Send a message to every host channel that exists. */
export function postToHost(message: BridgeMessage, w: HostWindow = window as HostWindow): void {
  const json = JSON.stringify(message);
  const tryPost = (fn: () => void) => {
    try {
      fn();
    } catch {
      // channel not usable
    }
  };
  if (w.ReactNativeWebView) tryPost(() => w.ReactNativeWebView!.postMessage(json));
  if (w.QRGenBridge) tryPost(() => w.QRGenBridge!.postMessage(json));
  if (w.webkit?.messageHandlers?.qrgen) tryPost(() => w.webkit!.messageHandlers!.qrgen!.postMessage(json));
  if (w.chrome?.webview) tryPost(() => w.chrome!.webview!.postMessage(json));
  if (w.QRGenAndroid) tryPost(() => w.QRGenAndroid!.postMessage(json));
  if (w.parent && w.parent !== w) tryPost(() => w.parent.postMessage(message, "*"));
  if (w.opener) tryPost(() => (w.opener as Window).postMessage(message, "*"));
}

/** Parse a message received from an embedded QRGen scanner (string or object). */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  let msg: unknown = data;
  if (typeof data === "string") {
    try {
      msg = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { source?: string; type?: string };
  if (m.source !== "qrgen" || typeof m.type !== "string") return null;
  return msg as BridgeMessage;
}

/** Element attributes from an embed URL query string (`?symbologies=qr,ean13&mode=single`). */
export function attributesFromQuery(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const map: Record<string, string> = {
    symbologies: "symbologies",
    mode: "mode",
    duplicateFilter: "duplicate-filter",
    "duplicate-filter": "duplicate-filter",
    beep: "beep",
    vibrate: "vibrate",
    camera: "camera",
    torch: "torch",
    viewfinder: "viewfinder",
    scanArea: "scan-area",
    "scan-area": "scan-area",
    maxResults: "max-results",
    "max-results": "max-results",
    accent: "accent",
    hint: "hint",
    controls: "controls",
    autostart: "autostart",
    resolution: "resolution",
    tryHarder: "try-harder",
    "try-harder": "try-harder",
    toast: "toast",
    worker: "worker",
  };
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    const attr = map[key];
    if (attr) out[attr] = value === "1" ? "true" : value === "0" ? "false" : value;
  });
  return out;
}

interface ScannerLike extends EventTarget {
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  setTorch(on: boolean): Promise<boolean>;
  toggleTorch(): Promise<boolean>;
  switchCamera(): Promise<void>;
  setZoom(z: number): Promise<boolean>;
  setAttribute(name: string, value: string): void;
}

/**
 * Forward a `<qrgen-scanner>`'s events to the host and accept host commands through
 * `window.qrgen.command(...)` and `postMessage({ source: "qrgen-host", ... })`.
 * Returns a function that disconnects the bridge.
 */
export function connectBridge(el: ScannerLike, w: HostWindow = window as HostWindow): () => void {
  const base = { source: "qrgen", version: 1 } as const;
  const on = (name: string, fn: (d: never) => BridgeMessage) => {
    const h = (e: Event) => postToHost(fn((e as CustomEvent).detail as never), w);
    el.addEventListener(name, h);
    return () => el.removeEventListener(name, h);
  };
  const offs = [
    on("ready", (d: { engine?: string }) => ({ ...base, type: "ready", engine: d?.engine })),
    on("scan", (d: { barcodes: Barcode[] }) => ({ ...base, type: "scan", barcodes: d.barcodes })),
    on("track", (d: { tracked: TrackedBarcode[] }) => ({ ...base, type: "track", tracked: d.tracked })),
    on("select", (d: { barcode: TrackedBarcode | null; selected: boolean; selection: TrackedBarcode[] }) => ({ ...base, type: "select", ...d })),
    on("statechange", (d: { state: string }) => ({ ...base, type: "state", state: d.state })),
    on("error", (d: { code: string; message: string }) => ({ ...base, type: "error", code: d.code, message: d.message })),
  ];
  const command = (cmd: BridgeCommand) => {
    switch (cmd?.type) {
      case "start":
        void el.start().catch(() => undefined);
        break;
      case "stop":
        el.stop();
        break;
      case "pause":
        el.pause();
        break;
      case "resume":
        el.resume();
        break;
      case "torch":
        void (cmd.value === undefined ? el.toggleTorch() : el.setTorch(cmd.value));
        break;
      case "switchCamera":
        void el.switchCamera();
        break;
      case "zoom":
        void el.setZoom(cmd.value);
        break;
      case "options":
        for (const [k, v] of Object.entries(cmd.value ?? {})) el.setAttribute(k, String(v));
        break;
    }
  };
  w.qrgen = { command, channels: detectChannels(w) };
  const onMessage = (e: MessageEvent) => {
    let d: unknown = e.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch {
        return;
      }
    }
    const m = d as { source?: string } & BridgeCommand;
    if (m && m.source === "qrgen-host") command(m);
  };
  w.addEventListener("message", onMessage);
  // React Native WebView on Android delivers host messages on document.
  document.addEventListener("message", onMessage as EventListener);
  // WebView2 (.NET, WinUI, WPF): CoreWebView2.PostWebMessageAsJson/AsString.
  const webview2 = (w.chrome?.webview as (Poster & EventTarget) | undefined) ?? undefined;
  webview2?.addEventListener?.("message", onMessage as EventListener);
  return () => {
    offs.forEach((off) => off());
    w.removeEventListener("message", onMessage);
    document.removeEventListener("message", onMessage as EventListener);
    webview2?.removeEventListener?.("message", onMessage as EventListener);
    delete w.qrgen;
  };
}
