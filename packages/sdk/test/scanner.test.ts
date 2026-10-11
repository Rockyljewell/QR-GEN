// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanner } from "../src/scanner";
import { QRGenError } from "../src/errors";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), cameraStart: vi.fn() }));
vi.mock("../src/camera", () => ({ Camera: class {
  start = mocks.cameraStart;
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

describe("Scanner session isolation", () => {
  let tick: () => void;
  function scanner() {
    const video = {
      videoWidth: 640, videoHeight: 480,
      requestVideoFrameCallback: vi.fn((cb) => { tick = cb; return 1; }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    return new BarcodeScanner({ video, beep: false, vibrate: false });
  }
  beforeEach(() => {
    mocks.decode.mockReset();
    mocks.cameraStart.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return { drawImage() {}, getImageData() { return {}; } }; }
    });
    vi.spyOn(performance, "now").mockReturnValue(100);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["restart", "resume", "options", "switch"])("ignores an old frame after %s", async (action) => {
    let finish!: (value: []) => void;
    mocks.decode.mockReturnValue(new Promise<[]>((r) => { finish = r; }));
    const s = scanner();
    const frame = vi.fn();
    s.on("frame", frame);
    await s.start();
    tick();
    expect(mocks.decode).toHaveBeenCalledOnce();
    if (action === "restart") { s.stop(); await s.start(); }
    if (action === "resume") { s.pause(); s.resume(); }
    if (action === "options") s.setOptions({ symbologies: ["ean13"] });
    if (action === "switch") await s.switchCamera();
    finish([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(frame).not.toHaveBeenCalled();
    expect(s.state).toBe("scanning");
    s.destroy();
  });

  it("ignores an old engine failure after restart", async () => {
    let fail!: (err: Error) => void;
    mocks.decode.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const s = scanner();
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    tick();
    s.stop();
    await s.start();
    fail(new QRGenError("engine-load-failed", "old session failed"));
    await new Promise((r) => setTimeout(r, 0));
    expect(error).not.toHaveBeenCalled();
    expect(s.state).toBe("scanning");
    s.destroy();
  });

  it("does not emit ready if stopped while enabling the torch", async () => {
    const s = scanner();
    let finish!: (value: boolean) => void;
    vi.mocked(s.camera.setTorch).mockReturnValue(new Promise<boolean>((r) => { finish = r; }));
    s.setOptions({ torch: true });
    const ready = vi.fn();
    s.on("ready", ready);
    const starting = s.start();
    await vi.waitFor(() => expect(s.camera.setTorch).toHaveBeenCalled());
    s.stop();
    finish(true);
    await starting;
    expect(ready).not.toHaveBeenCalled();
    expect(s.state).toBe("stopped");
    s.destroy();
  });

  it("continues scheduling if options change while switching cameras", async () => {
    const s = scanner();
    let finish!: () => void;
    vi.mocked(s.camera.switch).mockReturnValue(new Promise<void>((r) => { finish = r; }));
    await s.start();
    const switching = s.switchCamera();
    s.setOptions({ symbologies: ["qr"] });
    finish();
    await switching;
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    s.destroy();
  });

  it("does not emit scans if a track listener stops the session", async () => {
    const position = {
      topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 },
      bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 },
    };
    mocks.decode.mockResolvedValue([{
      format: "QRCodeModel2", text: "test", bytes: new TextEncoder().encode("test"),
      contentType: "Text", position, orientation: 0, ecLevel: "M",
      symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
    }]);
    const s = scanner();
    s.setOptions({ mode: "batch" });
    const scan = vi.fn();
    const track = vi.fn(() => s.stop());
    s.on("track", track);
    s.on("scan", scan);
    await s.start();
    tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(track).toHaveBeenCalledOnce();
    expect(scan).not.toHaveBeenCalled();
    s.destroy();
  });

  it("releases the camera and reports frame capture failures", async () => {
    const failure = new Error("camera frame unavailable");
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return { drawImage() { throw failure; } }; }
    });
    const s = scanner();
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    // Await the frame directly to make an unhandled callback rejection observable.
    await (s as unknown as { onFrame(): Promise<void> }).onFrame();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![0].cause).toBe(failure);
    expect(s.camera.stop).toHaveBeenCalledOnce();
    expect(s.state).toBe("stopped");
    expect(mocks.decode).not.toHaveBeenCalled();
    s.destroy();
  });

  it.each(["stop", "resume", "options", "no change"])("keeps single-scan events consistent when the pause listener uses %s", async (action) => {
    mocks.decode.mockResolvedValue([{
      format: "QRCodeModel2", text: "test", bytes: new TextEncoder().encode("test"),
      contentType: "Text", position: {
        topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 },
        bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 },
      }, orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
    }]);
    const s = scanner();
    s.setOptions({ mode: "single" });
    const scan = vi.fn();
    s.on("state", (state) => {
      if (state !== "paused") return;
      if (action === "stop") s.stop();
      if (action === "resume") s.resume();
      if (action === "options") s.setOptions({ symbologies: ["ean13"] });
    });
    s.on("scan", scan);
    await s.start();
    tick();
    await new Promise((r) => setTimeout(r, 0));
    if (action === "no change") {
      expect(scan).toHaveBeenCalledOnce();
      expect(scan.mock.calls[0]![0].barcodes[0].data).toBe("test");
      expect(s.state).toBe("paused");
    } else {
      expect(scan).not.toHaveBeenCalled();
    }
    s.destroy();
  });
  it.each(["success", "failure"])("concurrent camera switches await one shared %s outcome", async (outcome) => {
    const s = scanner();
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    vi.mocked(s.camera.switch).mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    const first = s.switchCamera();
    const second = s.switchCamera();
    let secondSettled = false;
    void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeCamera = secondSettled;
    const failure = new QRGenError("camera-in-use", "camera reopening failed");
    if (outcome === "failure") fail(failure);
    else finish();
    const results = await Promise.allSettled([first, second]);
    expect(settledBeforeCamera).toBe(false);
    if (outcome === "failure") {
      expect(results).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
      expect(error).toHaveBeenCalledOnce();
      expect(s.camera.stop).toHaveBeenCalledOnce();
      expect(s.state).toBe("error");
    } else {
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      expect(error).not.toHaveBeenCalled();
      expect(s.state).toBe("scanning");
      expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    }
    s.destroy();
  });

  it("keeps a restarted session's switch independent of an old pending switch", async () => {
    const s = scanner();
    let finishOld!: () => void;
    let finishCurrent!: () => void;
    const oldPending = new Promise<void>((resolve) => { finishOld = resolve; });
    const currentPending = new Promise<void>((resolve) => { finishCurrent = resolve; });
    vi.mocked(s.camera.switch).mockReturnValueOnce(oldPending).mockReturnValueOnce(currentPending).mockResolvedValue(undefined);
    await s.start();
    const old = s.switchCamera();
    s.stop();
    await s.start();
    const current = s.switchCamera();
    finishOld();
    await old;
    const joined = s.switchCamera();
    let joinedSettled = false;
    void joined.then(() => { joinedSettled = true; }, () => { joinedSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeCamera = joinedSettled;
    finishCurrent();
    await Promise.all([current, joined]);
    expect(settledBeforeCamera).toBe(false);
    expect(s.state).toBe("scanning");
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
    s.destroy();
  });

  it.each(["scanning", "paused"])("waits for camera readiness when resuming a switch begun while %s", async (initialState) => {
    const s = scanner();
    let finish!: () => void;
    vi.mocked(s.camera.switch).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await s.start();
    if (initialState === "paused") s.pause();
    const switching = s.switchCamera();
    if (initialState === "scanning") s.pause();
    s.resume();
    const callbacksBeforeCamera = vi.mocked(s.video.requestVideoFrameCallback!).mock.calls.length;
    finish();
    await switching;
    expect(callbacksBeforeCamera).toBe(1);
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    expect(s.state).toBe("scanning");
    s.destroy();
  });

});
