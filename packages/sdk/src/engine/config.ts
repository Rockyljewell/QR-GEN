// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { ZXING_WASM_VERSION } from "zxing-wasm/reader";

export interface EngineConfig {
  /** Absolute or relative URL of `zxing_reader.wasm`. Default: jsDelivr CDN, pinned to the bundled engine version. */
  readerWasmUrl?: string;
  /** Absolute or relative URL of `zxing_writer.wasm`. Default: jsDelivr CDN. */
  writerWasmUrl?: string;
  /** Folder containing both wasm files (e.g. "/wasm/"). Used when the specific URLs are not set. */
  wasmBaseUrl?: string;
  /** Pre-loaded reader wasm binary (Node, Electron, offline apps). */
  readerWasmBinary?: ArrayBuffer | Uint8Array;
  /** Pre-loaded writer wasm binary. */
  writerWasmBinary?: ArrayBuffer | Uint8Array;
  /** Decode camera frames in a Web Worker when possible. Default true. */
  worker?: boolean;
}

export const ENGINE_VERSION: string = ZXING_WASM_VERSION;

const CDN = `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_WASM_VERSION}/dist`;

const state: EngineConfig & { version: number } = { worker: true, version: 0 };

/**
 * Configure where the decoding engine is loaded from. Call before the first scan.
 *
 * ```ts
 * configure({ wasmBaseUrl: "/assets/qrgen/" }); // self-host zxing_reader.wasm + zxing_writer.wasm
 * ```
 */
export function configure(config: EngineConfig): void {
  Object.assign(state, config);
  state.version++;
}

export function getConfig(): Readonly<EngineConfig & { version: number }> {
  return state;
}

function resolveUrl(url: string): string {
  try {
    const base = typeof document !== "undefined" ? document.baseURI : typeof location !== "undefined" ? location.href : undefined;
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

function autoBase(): string | undefined {
  const g = globalThis as { QRGEN_WASM_BASE?: string };
  return g.QRGEN_WASM_BASE;
}

export function readerWasmUrl(): string {
  if (state.readerWasmUrl) return resolveUrl(state.readerWasmUrl);
  const base = state.wasmBaseUrl ?? autoBase();
  if (base) return resolveUrl(base.replace(/\/?$/, "/") + "zxing_reader.wasm");
  return `${CDN}/reader/zxing_reader.wasm`;
}

export function writerWasmUrl(): string {
  if (state.writerWasmUrl) return resolveUrl(state.writerWasmUrl);
  const base = state.wasmBaseUrl ?? autoBase();
  if (base) return resolveUrl(base.replace(/\/?$/, "/") + "zxing_writer.wasm");
  return `${CDN}/writer/zxing_writer.wasm`;
}

export function toArrayBuffer(bin: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bin instanceof ArrayBuffer) return bin;
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
}
