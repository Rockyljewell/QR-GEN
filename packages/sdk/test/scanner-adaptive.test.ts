// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanner, type BarcodeScannerOptions } from "../src/scanner";
import { QRGenError } from "../src/errors";
import type { RawBarcode } from "../src/engine/protocol";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), drawImage: vi.fn() }));
vi.mock("../src/camera", () => ({ Camera: class {
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn();
  setTorch = vi.fn().mockResolvedValue(true);
  switch = vi.fn().mockResolvedValue(undefined);
} }));
vi.mock("../src/feedback", () => ({ Feedback: class {
  options = {};
  unlock() {} success() {} dispose() {}
} }));
vi.mock("../src/engine/decoder", () => ({
  createFrameDecoder: async () => ({ kind: "worker", decode: mocks.decode }),
}));

const barcode: RawBarcode = {
  format: "QRCodeModel2", text: "test", bytes: new TextEncoder().encode("test"), contentType: "Text",
  position: { topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 }, bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 } },
  orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
};

describe("Scanner adaptive capture integration", () => {
  let now: number;
  let captureMs: number;
  let decodeMs: number;
  let tick: () => void;
  const scanners: BarcodeScanner[] = [];
  function scanner(options: BarcodeScannerOptions = {}, width = 4000, height = 3000) {
    const video = {
      videoWidth: width, videoHeight: height,
      requestVideoFrameCallback: vi.fn((cb) => { tick = cb; return 1; }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    const s = new BarcodeScanner({ video, beep: false, vibrate: false, ...options });
    scanners.push(s);
    return s;
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function frame() {
    now += 100;
    tick();
    await flush();
  }
  beforeEach(() => {
    now = 100;
    captureMs = 0;
    decodeMs = 10;
    mocks.decode.mockReset().mockImplementation(async () => { now += decodeMs; return []; });
    mocks.drawImage.mockReset();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() {
        return {
          drawImage: mocks.drawImage,
          getImageData: (_x: number, _y: number, width: number, height: number) => {
            now += captureMs;
            return { width, height };
          },
        };
      }
    });
  });
  afterEach(() => {
    for (const s of scanners.splice(0)) s.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([undefined, false])("preserves fixed dimensions and decoder options when adaptive is %s", async (adaptive) => {
    const s = scanner({ adaptive });
    await s.start();
    for (let i = 0; i < 10; i++) await frame();
    for (const [image, params] of mocks.decode.mock.calls) {
      expect(image).toEqual({ width: 1280, height: 960 });
      expect(params).toMatchObject({ tryHarder: false, tryRotate: true, tryDownscale: true, maxNumberOfSymbols: 1 });
    }
    expect(mocks.decode.mock.calls.map((call) => call[1].tryInvert)).toEqual([false, true, false, true, false, true, false, true, false, true]);
    expect(s.stats.adaptive).toBeNull();
  });

  it("starts cheaply and periodically samples the full frame at higher resolution without stalling", async () => {
    const s = scanner({ adaptive: { discoveryInterval: 2, missesBeforeDiscovery: 2, maxDecodePixels: 2_000_000 } });
    await s.start();
    const phases = [];
    for (let i = 0; i < 7; i++) { await frame(); phases.push(s.stats.adaptive!.phase); }
    expect(phases).toEqual(["normal", "normal", "discovery", "normal", "normal", "discovery", "normal"]);
    expect(mocks.decode.mock.calls.map((call) => call[0].width)).toEqual([640, 640, 1280, 640, 640, 1280, 640]);
    for (const call of mocks.drawImage.mock.calls) expect(call.slice(1, 5)).toEqual([0, 0, 4000, 3000]);
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(8);
    expect(s.stats.adaptive).toMatchObject({ completedFrames: 7, consecutiveMisses: 7 });
  });

  it("uses decoder-only timing for adaptation and preserves frame event elapsed time", async () => {
    const s = scanner({ adaptive: true });
    const event = vi.fn();
    s.on("frame", event);
    captureMs = 100;
    decodeMs = 10;
    await s.start();
    await frame();
    await frame();
    expect(event.mock.calls[1]![0].decodeMs).toBe(110);
    expect(s.stats.adaptive).toMatchObject({ decodeMs: 10, normalDecodeSize: 640 });
    decodeMs = 80;
    await frame();
    await frame();
    await frame();
    expect(mocks.decode.mock.calls[4]![0].width).toBe(512);
  });

  it("counts successful decodes even when the duplicate filter suppresses scans", async () => {
    mocks.decode.mockImplementation(async () => { now += 10; return [barcode]; });
    const s = scanner({ adaptive: { discoveryInterval: 2, missesBeforeDiscovery: 1 }, duplicateFilter: -1 });
    const scan = vi.fn();
    s.on("scan", scan);
    await s.start();
    for (let i = 0; i < 5; i++) await frame();
    expect(scan).toHaveBeenCalledOnce();
    expect(s.stats.adaptive).toMatchObject({ phase: "normal", consecutiveMisses: 0, consecutiveSuccesses: 5 });
    expect(mocks.decode.mock.calls.every((call) => call[0].width === 640)).toBe(true);
  });

  it.each([[8192, 8192], [8192, 4097], [4097, 8192]])("enforces side and pixel budgets for %s x %s camera frames", async (width, height) => {
    const s = scanner({ adaptive: { initialDecodeSize: 2048, maxDecodePixels: 1_000_000, discoveryInterval: 2, missesBeforeDiscovery: 1 }, maxDecodeSize: 8192 }, width, height);
    await s.start();
    for (let i = 0; i < 4; i++) await frame();
    for (const [image] of mocks.decode.mock.calls) {
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2048);
      expect(image.width * image.height).toBeLessThanOrEqual(1_000_000);
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
    }
    expect(s.stats.adaptive!.completedFrames).toBe(4);
  });

  it("never exceeds a smaller caller side cap", async () => {
    const s = scanner({ adaptive: { discoveryInterval: 2, missesBeforeDiscovery: 1 }, maxDecodeSize: 256 });
    await s.start();
    for (let i = 0; i < 4; i++) await frame();
    expect(mocks.decode.mock.calls.every((call) => Math.max(call[0].width, call[0].height) <= 256)).toBe(true);
  });

  it("preserves the caller scan area, source coordinates and full area discovery", async () => {
    mocks.decode.mockImplementation(async () => { now += 10; return [barcode]; });
    const s = scanner({ adaptive: true, scanArea: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, 2000, 1600);
    const event = vi.fn();
    s.on("frame", event);
    await s.start();
    await frame();
    expect(mocks.drawImage.mock.calls[0]!.slice(1)).toEqual([500, 400, 1000, 800, 0, 0, 640, 512]);
    expect(event.mock.calls[0]![0].barcodes[0].location.topLeft).toEqual({ x: 515.625, y: 415.625 });
    expect(event.mock.calls[0]![0].frameSize).toEqual({ width: 2000, height: 1600 });
  });

  it.each(["restart", "resume", "options", "switch"])("resets history after %s and rejects the cancelled in-flight frame", async (action) => {
    let finish!: (value: []) => void;
    mocks.decode.mockReturnValueOnce(new Promise<[]>((resolve) => { finish = resolve; }));
    const s = scanner({ adaptive: { discoveryInterval: 2, missesBeforeDiscovery: 1 } });
    const event = vi.fn();
    s.on("frame", event);
    await s.start();
    now += 100;
    tick();
    if (action === "restart") { s.stop(); await s.start(); }
    if (action === "resume") { s.pause(); s.resume(); }
    if (action === "options") s.setOptions({ tryHarder: true });
    if (action === "switch") await s.switchCamera();
    now += 500;
    finish([]);
    await flush();
    expect(event).not.toHaveBeenCalled();
    expect(s.stats.adaptive).toBeNull();
    await frame();
    expect(s.stats.adaptive).toMatchObject({ completedFrames: 1, phase: "normal", normalDecodeSize: 640, consecutiveMisses: 1 });
    expect(mocks.decode.mock.calls[1]![0].width).toBe(640);
    expect(s.state).toBe("scanning");
  });

  it("toggles adaptation while running and resets all learned work settings", async () => {
    const s = scanner({ adaptive: true });
    decodeMs = 100;
    await s.start();
    await frame();
    await frame();
    expect(s.stats.adaptive!.normalDecodeSize).toBe(512);
    s.setOptions({ adaptive: false });
    expect(s.stats.adaptive).toBeNull();
    await frame();
    expect(mocks.decode.mock.calls[2]![0].width).toBe(1280);
    expect(s.stats.adaptive).toBeNull();
    s.setOptions({ adaptive: true });
    await frame();
    expect(s.stats.adaptive).toMatchObject({ completedFrames: 1, normalDecodeSize: 640 });
    expect(mocks.decode.mock.calls[3]![0].width).toBe(640);
  });

  it("keeps options atomic if adaptive validation rejects an update", async () => {
    const s = scanner({ adaptive: true });
    await s.start();
    await frame();
    expect(() => s.setOptions({ adaptive: { discoveryInterval: Infinity }, maxDecodeSize: 256 })).toThrowError(expect.objectContaining({ code: "bad-request" }));
    expect(s.options.maxDecodeSize).toBe(1280);
    expect(s.stats.adaptive!.completedFrames).toBe(1);
    s.setOptions({ beep: false });
    await frame();
    expect(s.options.maxDecodeSize).toBe(1280);
    expect(mocks.decode.mock.calls[1]![0].width).toBe(640);
  });

  it("keeps scheduling after a recoverable decoder failure without training on it", async () => {
    mocks.decode.mockRejectedValueOnce(new QRGenError("unknown", "recoverable frame failure"));
    const s = scanner({ adaptive: true });
    await s.start();
    await frame();
    expect(s.stats.adaptive).toBeNull();
    expect(s.state).toBe("scanning");
    await frame();
    expect(s.stats.adaptive!.completedFrames).toBe(1);
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
  });
});
