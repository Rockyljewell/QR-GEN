// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSymbologies, getRuntimeCapabilities } from "../src/capabilities";
import { getConfig } from "../src/engine/config";
import { ALL_SYMBOLOGIES, WRITABLE_SYMBOLOGIES } from "../src/symbologies";

afterEach(() => vi.unstubAllGlobals());

describe("runtime capability queries", () => {
  it("works without browser globals and declares formats separately from runtime readiness", () => {
    const report = getRuntimeCapabilities({ environment: {}, config: {} });
    expect(report.runtime).toBe("non-browser");
    expect(report.camera).toEqual({ status: "not-browser", secureContext: null, getUserMedia: false, permission: "not-queried", devices: "not-queried" });
    expect(report.engine.webAssembly).toBe(false);
    expect(report.engine.read).toEqual(ALL_SYMBOLOGIES);
    expect(report.engine.write).toEqual(WRITABLE_SYMBOLOGIES);
    expect(report.assets.reader.source).toBe("default-cdn");
    expect(report.assets.offlineReadiness).toBe("unverified");
  });

  it("reads browser prerequisites without invoking APIs, creating engines or fetching", () => {
    const getUserMedia = vi.fn();
    const query = vi.fn();
    const fetch = vi.fn();
    const detector = Object.assign(vi.fn(), { getSupportedFormats: vi.fn() });
    const worker = vi.fn();
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, permissions: { query } });
    vi.stubGlobal("BarcodeDetector", detector);
    vi.stubGlobal("Worker", worker);
    vi.stubGlobal("fetch", fetch);
    const configBefore = { ...getConfig() };
    const report = getRuntimeCapabilities();
    expect(report.camera.status).toBe("available");
    expect(report.worker).toEqual({ available: true, configured: true });
    expect(report.barcodeDetector).toEqual({ available: true, formatQueryAvailable: true, formats: "not-queried", usedByQRGen: false });
    for (const fn of [getUserMedia, query, fetch, detector, detector.getSupportedFormats, worker]) expect(fn).not.toHaveBeenCalled();
    expect(getConfig()).toEqual(configBefore);
  });

  it("reports insecure, missing and unknown camera prerequisites accurately", () => {
    const media = { mediaDevices: { getUserMedia() {} } };
    expect(getRuntimeCapabilities({ environment: { window: { isSecureContext: false }, navigator: media } }).camera.status).toBe("insecure-context");
    expect(getRuntimeCapabilities({ environment: { window: { isSecureContext: true } } }).camera.status).toBe("api-unavailable");
    expect(getRuntimeCapabilities({ environment: { window: {}, navigator: media } }).camera.status).toBe("context-unknown");
    expect(getRuntimeCapabilities({ environment: { navigator: media } }).camera.status).toBe("not-browser");
  });

  it("describes asset precedence and byte views without asserting offline readiness", () => {
    const bytes = new Uint8Array(100).subarray(10, 20);
    const report = getRuntimeCapabilities({
      environment: { document: { baseURI: "https://example.test/app/" }, QRGEN_WASM_BASE: "/automatic/" },
      config: { readerWasmBinary: bytes, readerWasmUrl: "/ignored.wasm", writerWasmUrl: "../writer.wasm", wasmBaseUrl: "/ignored/", worker: false },
    });
    expect(report.assets.reader).toEqual({ source: "binary", binaryBytes: 10 });
    expect(report.assets.writer).toEqual({ source: "configured-url", url: "https://example.test/writer.wasm" });
    expect(report.assets.offlineReadiness).toBe("unverified");
    expect(report.worker.configured).toBe(false);
    expect(bytes.byteLength).toBe(10);
  });

  it("distinguishes configured bases, browser auto bases and default CDN assets", () => {
    const environment = { location: { href: "https://example.test/app/" }, QRGEN_WASM_BASE: "/automatic" };
    expect(getRuntimeCapabilities({ environment, config: { wasmBaseUrl: "/assets" } }).assets.reader).toEqual({ source: "configured-base-url", url: "https://example.test/assets/zxing_reader.wasm" });
    expect(getRuntimeCapabilities({ environment, config: {} }).assets.writer).toEqual({ source: "global-base-url", url: "https://example.test/automatic/zxing_writer.wasm" });
    expect(getRuntimeCapabilities({ environment, config: { wasmBaseUrl: "" } }).assets.reader.source).toBe("default-cdn");
    expect(getRuntimeCapabilities({ environment: {}, config: { readerWasmUrl: "./reader.wasm" } }).assets.reader.url).toBe("./reader.wasm");
  });

  it("returns independent format arrays and tolerates partial optional APIs", () => {
    const first = getRuntimeCapabilities({ environment: { BarcodeDetector: {}, Worker: {} } });
    first.engine.read.length = 0;
    expect(getRuntimeCapabilities({ environment: {} }).engine.read).toEqual(ALL_SYMBOLOGIES);
    expect(first.barcodeDetector.available).toBe(false);
    expect(first.worker.available).toBe(false);
  });
});

describe("explicit symbology checks", () => {
  it("keeps unknown requests visible while resolving aliases and removing duplicates", () => {
    expect(checkSymbologies("qrcode, QR;made-up|pdf417")).toEqual({ operation: "read", requested: ["qr", "pdf417"], supported: ["qr", "pdf417"], unsupported: [], unknown: ["made-up"], valid: false });
  });

  it("checks platform support and groups without silently losing unsupported formats", () => {
    const result = checkSymbologies(["matrix", "qr"], { operation: "write", supported: ["qr", "data-matrix"] });
    expect(result.supported).toEqual(["qr", "data-matrix"]);
    expect(result.unsupported).toContain("micro-qr");
    expect(result.requested).toEqual(resolveMatrix());
    expect(result.valid).toBe(false);
  });

  it("distinguishes empty requests from unknown-only requests", () => {
    for (const input of [undefined, null, "", [], " , ; "] as const) expect(checkSymbologies(input).requested).toEqual(ALL_SYMBOLOGIES);
    expect(checkSymbologies("???")).toMatchObject({ requested: [], supported: [], unknown: ["???"], valid: false });
    expect(checkSymbologies("qr", { supported: [] })).toMatchObject({ unsupported: ["qr"], valid: false });
    expect(checkSymbologies("qr", { operation: "write" })).toMatchObject({ supported: ["qr"], valid: true });
  });
});

function resolveMatrix() {
  return ["qr", "micro-qr", "rmqr", "data-matrix", "aztec", "pdf417", "micro-pdf417", "maxicode"];
}
