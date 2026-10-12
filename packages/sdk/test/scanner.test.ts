// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanner } from "../src/scanner";
import { QRGenError } from "../src/errors";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), cameraStart: vi.fn(), decoderStart: vi.fn() }));
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
  createFrameDecoder: () => mocks.decoderStart(),
}));

describe("Scanner session isolation", () => {
  let tick: () => void;
  function decodedCode(text: string) {
    return {
      format: "QRCodeModel2", text, bytes: new TextEncoder().encode(text), contentType: "Text",
      position: {
        topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 },
        bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 },
      }, orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
    };
  }

  function scanner() {
    const events = new EventTarget();
    const video = {
      videoWidth: 640, videoHeight: 480,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      requestVideoFrameCallback: vi.fn((cb) => { tick = cb; return 1; }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    return new BarcodeScanner({ video, beep: false, vibrate: false });
  }
  beforeEach(() => {
    mocks.decode.mockReset();
    mocks.cameraStart.mockReset().mockResolvedValue(undefined);
    mocks.decoderStart.mockReset().mockResolvedValue({ kind: "worker", decode: mocks.decode });
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

  it.each(["resize event", "late resize event"])("rejects an old coordinate-space frame after an intrinsic size change (%s)", async (event) => {
    let finish!: (value: ReturnType<typeof decodedCode>[]) => void;
    mocks.decode.mockReturnValue(new Promise<ReturnType<typeof decodedCode>[]>((resolve) => { finish = resolve; }));
    const s = scanner();
    const frame = vi.fn();
    s.on("frame", frame);
    await s.start();
    const decoding = (s as any).onFrame();
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    if (event === "resize event") s.video.dispatchEvent(new Event("resize"));
    finish([decodedCode("old orientation")]);
    await decoding;
    expect(frame).not.toHaveBeenCalled();
    expect(s.tracker.all).toEqual([]);
    expect(s.state).toBe("scanning");
    s.destroy();
  });

  it("clears paused spatial state and pending reports on intrinsic resize, preserving duplicate policy", async () => {
    mocks.decode.mockResolvedValue([decodedCode("test")]);
    const s = scanner();
    s.setOptions({ mode: "batch", duplicateFilter: -1 });
    let first = true;
    s.on("track", () => { if (first) { first = false; s.pause(); } });
    const reset = vi.fn();
    s.on("spatialreset", reset);
    const scan = vi.fn();
    s.on("scan", scan);
    await s.start();
    await (s as any).onFrame();
    const id = s.tracker.all[0]!.id;
    expect((s as any).pendingBatchScans.has(id)).toBe(true);
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    s.video.dispatchEvent(new Event("resize"));
    expect(s.state).toBe("paused");
    expect(s.tracker.all).toEqual([]);
    expect((s as any).pendingBatchScans.size).toBe(0);
    expect(s.options.duplicateFilter).toBe(-1);
    expect(reset).toHaveBeenCalledOnce();
    expect(reset.mock.calls[0]![0]).toEqual({ frameSize: { width: 480, height: 640 } });
    s.resume();
    vi.mocked(performance.now).mockReturnValue(200);
    await (s as any).onFrame();
    expect(s.tracker.all[0]!.id).not.toBe(id);
    expect(scan).toHaveBeenCalledOnce();
    s.destroy();
  });

  it("reports tracks dropped by an intrinsic resize as removed", async () => {
    mocks.decode.mockResolvedValue([decodedCode("test")]);
    const s = scanner();
    s.setOptions({ mode: "batch" });
    // An onTrack consumer that keeps its own map from added/removed (React, Vue, DOM event).
    const live = new Map<number, string>();
    s.on("track", ({ added, removed }) => {
      for (const t of removed) live.delete(t.id);
      for (const t of added) live.set(t.id, t.data);
    });
    await s.start();
    await (s as any).onFrame();
    const id = s.tracker.all[0]!.id;
    expect([...live.keys()]).toEqual([id]);
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    s.video.dispatchEvent(new Event("resize"));
    expect(live.size).toBe(0);
    vi.mocked(performance.now).mockReturnValue(200);
    await (s as any).onFrame();
    expect([...live.keys()]).toEqual(s.tracker.all.map((t) => t.id));
    expect(live.has(id)).toBe(false);
    s.destroy();
  });

  it("keeps batch identity through CSS-only preview resize", async () => {
    mocks.decode.mockResolvedValue([decodedCode("test")]);
    const s = scanner();
    s.setOptions({ mode: "batch" });
    const reset = vi.fn();
    s.on("spatialreset", reset);
    await s.start();
    await (s as any).onFrame();
    const id = s.tracker.all[0]!.id;
    Object.assign(s.video, { clientWidth: 320, clientHeight: 500 });
    s.video.dispatchEvent(new Event("resize"));
    vi.mocked(performance.now).mockReturnValue(200);
    await (s as any).onFrame();
    expect(s.tracker.all[0]).toMatchObject({ id, count: 2 });
    expect(reset).not.toHaveBeenCalled();
    s.destroy();
  });

  it("honors a spatial-reset listener pausing before another frame starts", async () => {
    mocks.decode.mockResolvedValue([]);
    const s = scanner();
    s.on("spatialreset", () => s.pause());
    await s.start();
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    await (s as any).onFrame();
    expect(s.state).toBe("paused");
    expect(mocks.decode).not.toHaveBeenCalled();
    s.destroy();
  });

  it("drops a stale engine failure after an intrinsic resize without failing the current camera", async () => {
    let fail!: (error: Error) => void;
    mocks.decode.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const s = scanner();
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    const decoding = (s as any).onFrame();
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    fail(new QRGenError("engine-load-failed", "obsolete frame failed"));
    await decoding;
    expect(error).not.toHaveBeenCalled();
    expect(s.camera.stop).not.toHaveBeenCalled();
    expect(s.state).toBe("scanning");
    s.destroy();
  });

  it("does not scan a batch frame when its track callback changes intrinsic dimensions", async () => {
    mocks.decode.mockResolvedValue([decodedCode("test")]);
    const s = scanner();
    s.setOptions({ mode: "batch" });
    s.on("track", () => Object.assign(s.video, { videoWidth: 480, videoHeight: 640 }));
    const scan = vi.fn();
    s.on("scan", scan);
    await s.start();
    await (s as any).onFrame();
    expect(scan).not.toHaveBeenCalled();
    expect(s.tracker.all).toEqual([]);
    expect((s as any).pendingBatchScans.size).toBe(0);
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


  it("reports the first batch scan after a track listener pauses and resumes without expiring the track", async () => {
    mocks.decode.mockResolvedValue([{
      format: "QRCodeModel2", text: "test", bytes: new TextEncoder().encode("test"),
      contentType: "Text", position: {
        topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 },
        bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 },
      }, orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
    }]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const s = scanner();
    s.setOptions({ mode: "batch", duplicateFilter: -1 });
    const scan = vi.fn();
    const track = vi.fn();
    s.on("track", (update) => {
      track(update);
      if (track.mock.calls.length === 1) s.pause();
    });
    s.on("scan", scan);
    const frame = () => (s as unknown as { onFrame(): Promise<void> }).onFrame();
    try {
      await s.start();
      await frame();
      expect(s.state).toBe("paused");
      expect(scan).not.toHaveBeenCalled();
      const originalId = track.mock.calls[0]![0].tracked[0].id;

      s.resume();
      vi.mocked(performance.now).mockReturnValue(200);
      clock.mockReturnValue(1020);
      await frame();
      expect(track).toHaveBeenCalledTimes(2);
      expect(track.mock.calls[1]![0].tracked[0]).toMatchObject({ id: originalId, count: 2 });
      expect(track.mock.calls[1]![0].added).toEqual([]);
      expect(scan).toHaveBeenCalledOnce();
      expect(scan.mock.calls[0]![0].barcodes[0].data).toBe("test");

      vi.mocked(performance.now).mockReturnValue(300);
      clock.mockReturnValue(1040);
      await frame();
      expect(scan).toHaveBeenCalledOnce();

      s.pause();
      s.resume();
      vi.mocked(performance.now).mockReturnValue(400);
      clock.mockReturnValue(1060);
      await frame();
      expect(s.tracker.all[0]).toMatchObject({ id: originalId, count: 4 });
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      s.destroy();
    }
  });


  it("keeps a pending batch scan until that track is observed again", async () => {
    const raw = decodedCode("test");
    mocks.decode.mockResolvedValue([raw]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const s = scanner();
    s.setOptions({ mode: "batch", duplicateFilter: -1 });
    const scan = vi.fn();
    s.on("scan", scan);
    let first = true;
    s.on("track", () => { if (first) { first = false; s.pause(); } });
    const frame = () => (s as unknown as { onFrame(): Promise<void> }).onFrame();
    try {
      await s.start();
      await frame();
      const id = s.tracker.all[0]!.id;
      s.resume();

      mocks.decode.mockResolvedValue([]);
      vi.mocked(performance.now).mockReturnValue(200);
      clock.mockReturnValue(1020);
      await frame();
      expect(s.tracker.all[0]).toMatchObject({ id, count: 1 });
      expect(scan).not.toHaveBeenCalled();

      mocks.decode.mockResolvedValue([raw]);
      vi.mocked(performance.now).mockReturnValue(300);
      clock.mockReturnValue(1040);
      await frame();
      expect(s.tracker.all[0]).toMatchObject({ id, count: 2 });
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      s.destroy();
    }
  });

  it("expires an unreported batch track without scanning it and reports a later new track", async () => {
    const raw = decodedCode("test");
    mocks.decode.mockResolvedValue([raw]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const s = scanner();
    s.setOptions({ mode: "batch", duplicateFilter: -1 });
    const scan = vi.fn();
    const track = vi.fn();
    s.on("scan", scan);
    s.on("track", (update) => { track(update); if (track.mock.calls.length === 1) s.pause(); });
    const frame = () => (s as unknown as { onFrame(): Promise<void> }).onFrame();
    try {
      await s.start();
      await frame();
      const id = s.tracker.all[0]!.id;
      s.resume();

      mocks.decode.mockResolvedValue([]);
      vi.mocked(performance.now).mockReturnValue(200);
      clock.mockReturnValue(1600);
      await frame();
      expect(s.tracker.all).toEqual([]);
      expect(track.mock.calls[1]![0].removed[0].id).toBe(id);
      expect(scan).not.toHaveBeenCalled();

      mocks.decode.mockResolvedValue([raw]);
      vi.mocked(performance.now).mockReturnValue(300);
      clock.mockReturnValue(1620);
      await frame();
      expect(s.tracker.all[0]!.id).not.toBe(id);
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      s.destroy();
    }
  });

  it.each(["restart", "mode change", "camera switch"])("clears a pending batch report across %s", async (reset) => {
    const raw = decodedCode("test");
    mocks.decode.mockResolvedValue([raw]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const s = scanner();
    s.setOptions({ mode: "batch", duplicateFilter: -1 });
    const scan = vi.fn();
    s.on("scan", scan);
    let first = true;
    s.on("track", () => { if (first) { first = false; s.pause(); } });
    const frame = () => (s as unknown as { onFrame(): Promise<void> }).onFrame();
    try {
      await s.start();
      await frame();
      const id = s.tracker.all[0]!.id;
      if (reset === "restart") { s.stop(); await s.start(); }
      if (reset === "mode change") { s.setOptions({ mode: "continuous" }); s.setOptions({ mode: "batch" }); s.resume(); }
      if (reset === "camera switch") { await s.switchCamera(); s.resume(); }
      expect(s.tracker.all).toEqual([]);

      mocks.decode.mockResolvedValue([]);
      vi.mocked(performance.now).mockReturnValue(200);
      clock.mockReturnValue(1020);
      await frame();
      expect(scan).not.toHaveBeenCalled();
      expect(s.tracker.all).toEqual([]);

      mocks.decode.mockResolvedValue([raw]);
      vi.mocked(performance.now).mockReturnValue(300);
      clock.mockReturnValue(1040);
      await frame();
      expect(s.tracker.all[0]!.id).not.toBe(id);
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      s.destroy();
    }
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

  it.each(["capture", "decode"] as const)("reports a current %s failure exactly once", async (failure) => {
    const cause = new QRGenError("engine-load-failed", "current frame failed");
    if (failure === "capture") {
      vi.stubGlobal("OffscreenCanvas", class {
        getContext() { return { drawImage() { throw cause; } }; }
      });
    } else mocks.decode.mockRejectedValue(cause);
    const s = scanner();
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    await (s as any).onFrame();
    expect(error).toHaveBeenCalledExactlyOnceWith(cause);
    expect(s.camera.stop).toHaveBeenCalledOnce();
    expect(s.state).toBe("stopped");
    expect((s as any).decoder).toBeNull();
    s.destroy();
  });

  it.each([
    ["capture", "restart"], ["capture", "stop"], ["capture", "destroy"],
    ["decode", "restart"], ["decode", "stop"], ["decode", "destroy"],
  ] as const)("does not emit an obsolete %s error after a stopped listener uses %s", async (failure, action) => {
    const cause = new QRGenError("engine-load-failed", "obsolete frame failed");
    if (failure === "capture") {
      vi.stubGlobal("OffscreenCanvas", class {
        getContext() { return { drawImage() { throw cause; } }; }
      });
    } else mocks.decode.mockRejectedValue(cause);
    const s = scanner();
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    let finish!: () => void;
    let replacement: Promise<void> | undefined;
    s.once("state", (state) => {
      expect(state).toBe("stopped");
      if (action === "restart") {
        mocks.cameraStart.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
        replacement = s.start();
      } else if (action === "stop") s.stop();
      else s.destroy();
    });
    await (s as any).onFrame();
    expect(error).not.toHaveBeenCalled();
    if (action === "restart") {
      expect(s.state).toBe("starting");
      finish();
      await replacement;
      expect(s.state).toBe("scanning");
      expect(s.camera.stop).toHaveBeenCalledOnce();
    } else expect(s.state).toBe(action === "destroy" ? "idle" : "stopped");
    s.destroy();
  });

  async function realCameraScanner() {
    const { Camera } = await vi.importActual<typeof import("../src/camera")>("../src/camera");
    const s = scanner();
    Object.assign(s.video, {
      readyState: 1, srcObject: null, setAttribute: vi.fn(), play: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(s, "camera", { value: new Camera() });
    return s;
  }

  function mediaStream() {
    const track = { stop: vi.fn(), getSettings: () => ({}), getCapabilities: () => ({}) };
    return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
  }

  it("prevents a stopped listener from reopening the real camera during destroy", async () => {
    const active = mediaStream(), late = mediaStream();
    let finish!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn().mockResolvedValueOnce(active.stream)
      .mockReturnValueOnce(new Promise<MediaStream>((resolve) => { finish = resolve; }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const s = await realCameraScanner();
    await s.start();
    let replacement: Promise<void> | undefined;
    s.once("state", () => { replacement = s.start(); });
    s.destroy();
    finish(late.stream);
    await replacement;
    expect(s.state).toBe("idle");
    expect((s as any).decoder).toBeNull();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(active.track.stop).toHaveBeenCalledOnce();
    expect(s.camera.stream).toBeNull();
    expect(s.video.srcObject).toBeNull();
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledOnce();
    s.destroy();
  });

  it("cancels deferred camera permission and decoder initialization on destroy", async () => {
    const late = mediaStream();
    let finishCamera!: (stream: MediaStream) => void;
    let finishDecoder!: (decoder: unknown) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { finishCamera = resolve; }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    mocks.decoderStart.mockReturnValueOnce(new Promise((resolve) => { finishDecoder = resolve; }));
    const s = await realCameraScanner();
    const ready = vi.fn(), error = vi.fn();
    s.on("ready", ready);
    s.on("error", error);
    const starting = s.start();
    s.destroy();
    finishDecoder({ kind: "worker", decode: mocks.decode });
    finishCamera(late.stream);
    await starting;
    expect(s.state).toBe("idle");
    expect((s as any).decoder).toBeNull();
    expect(late.track.stop).toHaveBeenCalledOnce();
    expect(s.camera.stream).toBeNull();
    expect(s.video.srcObject).toBeNull();
    expect(s.video.requestVideoFrameCallback).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("ignores a nested destroy and camera switch requested during teardown", async () => {
    const s = scanner();
    await s.start();
    let switching: Promise<void> | undefined;
    s.once("state", () => { s.destroy(); switching = s.switchCamera(); });
    s.destroy();
    await switching;
    expect(s.camera.switch).not.toHaveBeenCalled();
    expect(s.camera.stop).toHaveBeenCalledOnce();
    expect(s.state).toBe("idle");
    expect((s as any).decoder).toBeNull();
  });

  it("preserves explicit start after destroy completes", async () => {
    const s = scanner();
    await s.start();
    s.destroy();
    const ready = vi.fn();
    s.on("ready", ready);
    await s.start();
    expect(s.state).toBe("scanning");
    expect(ready).toHaveBeenCalledOnce();
    expect(mocks.cameraStart).toHaveBeenCalledTimes(2);
    s.destroy();
  });

  it("restores intrinsic resize resets after explicit reuse following destroy", async () => {
    const s = scanner();
    s.setOptions({ mode: "batch" });
    mocks.decode.mockResolvedValue([decodedCode("test")]);
    await s.start();
    s.destroy();
    const reset = vi.fn();
    s.on("spatialreset", reset);
    await s.start();
    await (s as any).onFrame();
    expect(s.tracker.all).toHaveLength(1);
    s.pause();
    Object.assign(s.video, { videoWidth: 480, videoHeight: 640 });
    s.video.dispatchEvent(new Event("resize"));
    expect(s.state).toBe("paused");
    expect(reset).toHaveBeenCalledExactlyOnceWith({ frameSize: { width: 480, height: 640 } });
    expect(s.tracker.all).toEqual([]);
    expect((s as any).pendingBatchScans.size).toBe(0);
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

  it.each(["stopped", "error"])("does not deliver an old camera-switch failure over a session restarted by the %s listener", async (state) => {
    const s = scanner();
    const failure = new QRGenError("camera-in-use", "old camera could not reopen");
    vi.mocked(s.camera.switch).mockRejectedValue(failure);
    const error = vi.fn();
    s.on("error", error);
    await s.start();
    const states = vi.fn();
    s.on("state", states);
    let replacement!: Promise<void>;
    const off = s.on("state", (next) => {
      if (next !== state) return;
      off();
      replacement = s.start();
    });
    await expect(s.switchCamera()).rejects.toBe(failure);
    await replacement;
    expect(s.state).toBe("scanning");
    expect(states.mock.calls.map(([next]) => next)).toEqual(state === "stopped"
      ? ["stopped", "starting", "scanning"] : ["stopped", "error", "starting", "scanning"]);
    expect(error).not.toHaveBeenCalled();
    expect(s.camera.stop).toHaveBeenCalledOnce();
    expect(mocks.cameraStart).toHaveBeenCalledTimes(2);
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
