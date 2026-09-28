// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { QRGenError } from "../errors.js";
import { WORKER_SOURCE } from "../generated/worker-source.js";
import { getConfig, readerWasmUrl, toArrayBuffer } from "./config.js";
import { toRawBarcodes, toReaderOptions, type DecodeParams, type RawBarcode, type WorkerRequest, type WorkerResponse } from "./protocol.js";

type ReaderOverrides = { wasmBinary: ArrayBuffer } | { locateFile: (path: string, prefix: string) => string };
let cached: { version: number; overrides: ReaderOverrides } | null = null;

/** One overrides object per config version, so zxing-wasm reuses its module instance. */
function readerOverrides(): ReaderOverrides {
  const cfg = getConfig();
  if (!cached || cached.version !== cfg.version) {
    const url = readerWasmUrl();
    cached = {
      version: cfg.version,
      overrides: cfg.readerWasmBinary
        ? { wasmBinary: toArrayBuffer(cfg.readerWasmBinary) }
        : { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? url : prefix + path) },
    };
  }
  return cached.overrides;
}

function prepareReader(): void {
  prepareZXingModule({ overrides: readerOverrides(), fireImmediately: false });
}

function engineError(err: unknown): QRGenError {
  if (err instanceof QRGenError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new QRGenError(
    "engine-load-failed",
    `The barcode engine failed to load (${message}). Check network access to ${readerWasmUrl()} or self-host the wasm with configure({ wasmBaseUrl }).`,
    err,
  );
}

/** Decode an image file (PNG, JPEG, BMP, GIF…) or ImageData on the current thread. */
export async function decodeOnMainThread(input: Blob | ArrayBuffer | Uint8Array | ImageData, params: DecodeParams): Promise<RawBarcode[]> {
  prepareReader();
  try {
    const results = await readBarcodes(input, toReaderOptions(params));
    return toRawBarcodes(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Image decoding failures (unsupported file) are not engine failures.
    if (/image|decode|stbi|format/i.test(message) && !/wasm|fetch|instantiate|compile/i.test(message)) {
      throw new QRGenError("bad-request", `Could not read the image: ${message}`, err);
    }
    throw engineError(err);
  }
}

/** Decodes camera frames, in a worker when possible. */
export interface FrameDecoder {
  readonly kind: "worker" | "main";
  decode(image: ImageData, params: DecodeParams): Promise<RawBarcode[]>;
  dispose(): void;
}

class MainThreadDecoder implements FrameDecoder {
  readonly kind = "main" as const;
  decode(image: ImageData, params: DecodeParams): Promise<RawBarcode[]> {
    return decodeOnMainThread(image, params);
  }
  dispose(): void {}
}

class WorkerDecoder implements FrameDecoder {
  readonly kind = "worker" as const;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: RawBarcode[]) => void; reject: (e: unknown) => void }>();

  private constructor(private worker: Worker, private url: string) {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "result" || msg.type === "error") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === "result") p.resolve(msg.results);
        else p.reject(new Error(msg.message));
      }
    };
  }

  static async create(timeoutMs = 20000): Promise<WorkerDecoder> {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    let worker: Worker;
    try {
      worker = new Worker(url, { name: "qrgen-decoder" });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    const cfg = getConfig();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker init timeout")), timeoutMs);
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || "worker failed to start"));
      };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (e.data.type === "init-error") {
          clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
      const init: WorkerRequest = {
        type: "init",
        wasmUrl: readerWasmUrl(),
        wasmBinary: cfg.readerWasmBinary ? toArrayBuffer(cfg.readerWasmBinary).slice(0) : undefined,
      };
      worker.postMessage(init);
    }).catch((err) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      throw err;
    });
    worker.onerror = null;
    return new WorkerDecoder(worker, url);
  }

  decode(image: ImageData, params: DecodeParams): Promise<RawBarcode[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const buffer = image.data.buffer as ArrayBuffer;
      const msg: WorkerRequest = { type: "decode", id, width: image.width, height: image.height, buffer, params };
      this.worker.postMessage(msg, [buffer]);
    });
  }

  dispose(): void {
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
    for (const p of this.pending.values()) p.reject(new Error("decoder disposed"));
    this.pending.clear();
  }
}

let sharedWorker: Promise<FrameDecoder> | null = null;
let sharedWorkerVersion = -1;

/**
 * Create a frame decoder. Uses a shared Web Worker when available and allowed,
 * and falls back to the main thread (e.g. strict CSP without `worker-src blob:`).
 */
export async function createFrameDecoder(preferWorker = true): Promise<FrameDecoder> {
  const cfg = getConfig();
  const canWorker = preferWorker && cfg.worker !== false && typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  if (!canWorker) return warmMain();
  if (!sharedWorker || sharedWorkerVersion !== cfg.version) {
    sharedWorkerVersion = cfg.version;
    sharedWorker = WorkerDecoder.create().catch((err) => {
      console.warn("[qrgen] decoding on the main thread:", err instanceof Error ? err.message : err);
      sharedWorker = null;
      return warmMain();
    });
  }
  return sharedWorker;
}

async function warmMain(): Promise<FrameDecoder> {
  // Load the engine eagerly so the first frame is fast and load errors surface early.
  try {
    await prepareZXingModule({ overrides: readerOverrides(), fireImmediately: true });
  } catch (err) {
    throw engineError(err);
  }
  return new MainThreadDecoder();
}
