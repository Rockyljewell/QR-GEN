// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { ENGINE_VERSION, getConfig, type EngineConfig } from "./engine/config.js";
import { ALL_SYMBOLOGIES, resolveSymbologies, WRITABLE_SYMBOLOGIES, type Symbology, type SymbologyInput } from "./symbologies.js";

/** Optional input for server rendering, diagnostics and deterministic capability checks. */
export interface CapabilityEnvironment {
  window?: { isSecureContext?: boolean };
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  document?: { baseURI?: string };
  location?: { href?: string };
  WebAssembly?: unknown;
  Worker?: unknown;
  BarcodeDetector?: unknown;
  QRGEN_WASM_BASE?: string;
}

export interface RuntimeCapabilitiesOptions {
  /** Defaults to the current global environment. No APIs on it are invoked. */
  environment?: CapabilityEnvironment;
  /** Defaults to the current configuration. This function never changes it. */
  config?: Readonly<EngineConfig>;
}

export interface EngineAssetCapability {
  source: "binary" | "configured-url" | "configured-base-url" | "global-base-url" | "default-cdn";
  /** Effective URL when the asset is not supplied as bytes; it has not been fetched. */
  url?: string;
  /** Supplied byte count, without copying, validating or instantiating the binary. */
  binaryBytes?: number;
}

export interface RuntimeCapabilities {
  runtime: "browser" | "non-browser";
  engine: {
    name: "zxing-wasm";
    version: string;
    /** API presence only, not successful WASM compilation or initialization. */
    webAssembly: boolean;
    /** Declared portable engine formats, not a runtime engine health check. */
    read: Symbology[];
    write: Symbology[];
  };
  camera: {
    status: "not-browser" | "insecure-context" | "api-unavailable" | "context-unknown" | "available";
    secureContext: boolean | null;
    getUserMedia: boolean;
    permission: "not-queried";
    devices: "not-queried";
  };
  worker: {
    available: boolean;
    configured: boolean;
  };
  barcodeDetector: {
    /** The constructor may be native or supplied by a polyfill. */
    available: boolean;
    formatQueryAvailable: boolean;
    formats: "not-queried";
    usedByQRGen: false;
  };
  assets: {
    reader: EngineAssetCapability;
    writer: EngineAssetCapability;
    /** URLs and supplied bytes cannot prove that the complete app works offline. */
    offlineReadiness: "unverified";
  };
}

function resolveAssetUrl(url: string, environment: CapabilityEnvironment): string {
  const base = environment.document?.baseURI ?? environment.location?.href;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/** Mirrors the selection order in engine/config without fetching or changing state. */
function assetCapability(kind: "reader" | "writer", config: Readonly<EngineConfig>, environment: CapabilityEnvironment): EngineAssetCapability {
  const binary = kind === "reader" ? config.readerWasmBinary : config.writerWasmBinary;
  if (binary) return { source: "binary", binaryBytes: binary.byteLength };
  const url = kind === "reader" ? config.readerWasmUrl : config.writerWasmUrl;
  if (url) return { source: "configured-url", url: resolveAssetUrl(url, environment) };
  const base = config.wasmBaseUrl ?? environment.QRGEN_WASM_BASE;
  if (base) {
    return {
      source: config.wasmBaseUrl != null ? "configured-base-url" : "global-base-url",
      url: resolveAssetUrl(base.replace(/\/?$/, "/") + `zxing_${kind}.wasm`, environment),
    };
  }
  return { source: "default-cdn", url: `https://cdn.jsdelivr.net/npm/zxing-wasm@${ENGINE_VERSION}/dist/${kind}/zxing_${kind}.wasm` };
}

/**
 * Read available browser APIs and portable engine declarations without opening the
 * camera, querying permission, loading the engine or making network requests.
 * `camera.status === "available"` means only that basic prerequisites are present:
 * permission, a physical device, iframe policy and actual startup remain untested.
 * Worker presence likewise does not prove the app's CSP permits a worker.
 */
export function getRuntimeCapabilities(options: RuntimeCapabilitiesOptions = {}): RuntimeCapabilities {
  const environment = options.environment ?? globalThis as unknown as CapabilityEnvironment;
  const config = options.config ?? getConfig();
  const browser = environment.window != null;
  const secureContext = typeof environment.window?.isSecureContext === "boolean" ? environment.window.isSecureContext : null;
  const getUserMedia = typeof environment.navigator?.mediaDevices?.getUserMedia === "function";
  const detector = environment.BarcodeDetector;
  const detectorAvailable = typeof detector === "function";
  const formatQueryAvailable = detectorAvailable && typeof (detector as { getSupportedFormats?: unknown }).getSupportedFormats === "function";
  const cameraStatus = !browser ? "not-browser" : secureContext === false ? "insecure-context"
    : !getUserMedia ? "api-unavailable" : secureContext === null ? "context-unknown" : "available";
  return {
    runtime: browser ? "browser" : "non-browser",
    engine: { name: "zxing-wasm", version: ENGINE_VERSION, webAssembly: environment.WebAssembly != null, read: [...ALL_SYMBOLOGIES], write: [...WRITABLE_SYMBOLOGIES] },
    camera: { status: cameraStatus, secureContext, getUserMedia, permission: "not-queried", devices: "not-queried" },
    worker: { available: typeof environment.Worker === "function", configured: config.worker !== false },
    barcodeDetector: { available: detectorAvailable, formatQueryAvailable, formats: "not-queried", usedByQRGen: false },
    assets: { reader: assetCapability("reader", config, environment), writer: assetCapability("writer", config, environment), offlineReadiness: "unverified" },
  };
}

export interface SymbologyCheckOptions {
  operation?: "read" | "write";
  /** Override with another engine's declared support when checking platform compatibility. */
  supported?: readonly Symbology[];
}

export interface SymbologyCheck {
  operation: "read" | "write";
  requested: Symbology[];
  supported: Symbology[];
  unsupported: Symbology[];
  unknown: string[];
  valid: boolean;
}

/**
 * Resolve names, aliases and groups while keeping unknown or unavailable requests
 * visible. Missing/empty input uses all formats, matching resolveSymbologies.
 * This is an explicit check; it does not change the scanner's existing behavior.
 */
export function checkSymbologies(input?: SymbologyInput | readonly SymbologyInput[] | null, options: SymbologyCheckOptions = {}): SymbologyCheck {
  const operation = options.operation ?? "read";
  const available = new Set(options.supported ?? (operation === "read" ? ALL_SYMBOLOGIES : WRITABLE_SYMBOLOGIES));
  const names: readonly string[] = input == null ? [] : Array.isArray(input) ? input : String(input).split(/[\s,;|]+/);
  const requested = new Set<Symbology>();
  const unknown = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    const resolved = resolveSymbologies([name]);
    if (resolved.length === 0) unknown.add(name);
    for (const format of resolved) requested.add(format);
  }
  if (names.every((name) => !name)) for (const format of ALL_SYMBOLOGIES) requested.add(format);
  const supported = [...requested].filter((format) => available.has(format));
  const unsupported = [...requested].filter((format) => !available.has(format));
  return { operation, requested: [...requested], supported, unsupported, unknown: [...unknown], valid: unknown.size === 0 && unsupported.length === 0 };
}
