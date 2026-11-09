// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanner } from "../src/scanner";
import { BarcodeTracker } from "../src/tracker";
import { DuplicateFilter } from "../src/duplicate-filter";
import { toBarcode } from "../src/engine/convert";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), cameraStart: vi.fn(), decoderStart: vi.fn(), feedbackSuccess: vi.fn() }));
vi.mock("../src/camera", () => ({ Camera: class {
  start = mocks.cameraStart;
  stop = vi.fn();
  setTorch = vi.fn().mockResolvedValue(true);
  switch = vi.fn().mockResolvedValue(undefined);
} }));
vi.mock("../src/feedback", () => ({ Feedback: class {
  options = {};
  unlock() {} success = mocks.feedbackSuccess; dispose() {}
} }));
vi.mock("../src/engine/decoder", () => ({ createFrameDecoder: () => mocks.decoderStart() }));

const epoch = Date.UTC(2026, 10, 8, 23, 0, 0);
function decodedCode() {
  return {
    format: "QRCodeModel2", text: "web-clock-control", bytes: new TextEncoder().encode("web-clock-control"), contentType: "Text",
    position: {
      topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 },
      bottomRight: { x: 50, y: 50 }, bottomLeft: { x: 10, y: 50 },
    }, orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
  };
}
function scanner(mode: "continuous" | "batch") {
  const events = new EventTarget();
  const video = {
    videoWidth: 640, videoHeight: 480,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    requestVideoFrameCallback: vi.fn(() => 1), cancelVideoFrameCallback: vi.fn(),
  } as unknown as HTMLVideoElement;
  return new BarcodeScanner({ video, mode, duplicateFilter: 1000, beep: false, vibrate: false });
}
const frame = (s: BarcodeScanner) => (s as unknown as { onFrame(): Promise<void> }).onFrame();

describe("Web scanner duration clocks", () => {
  let wall: number;
  let elapsed: number;
  beforeEach(() => {
    wall = epoch;
    elapsed = 1000;
    mocks.decode.mockReset().mockResolvedValue([decodedCode()]);
    mocks.feedbackSuccess.mockReset();
    mocks.cameraStart.mockReset().mockResolvedValue(undefined);
    mocks.decoderStart.mockReset().mockResolvedValue({ kind: "worker", decode: mocks.decode });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage() {}, getImageData() { return {}; } }; }
    });
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([
    { direction: "backward", elapsedMs: 2000, correction: -60000, expectedScans: 2 },
    { direction: "forward", elapsedMs: 100, correction: 60000, expectedScans: 1 },
  ])("uses elapsed duplicate windows after a $direction wall-clock correction", async ({ direction, elapsedMs, correction, expectedScans }) => {
    const s = scanner("continuous");
    const scan = vi.fn(), frames = vi.fn();
    s.on("scan", scan);
    s.on("frame", frames);
    try {
      await s.start();
      await frame(s);
      expect(scan).toHaveBeenCalledOnce();
      const first = JSON.stringify(scan.mock.calls[0]![0].barcodes[0]);
      wall += elapsedMs + correction;
      elapsed += elapsedMs;
      expect(Date.now()).toBe(epoch + elapsedMs + correction);
      expect(performance.now()).toBe(1000 + elapsedMs);
      await frame(s);
      expect(mocks.decode).toHaveBeenCalledTimes(2);
      expect(frames).toHaveBeenCalledTimes(2);
      expect(frames.mock.calls[1]![0].barcodes[0].timestamp).toBe(wall);
      expect(JSON.stringify(scan.mock.calls[0]![0].barcodes[0])).toBe(first);
      expect(s.state).toBe("scanning");
      console.log("WEB_CLOCK_RECEIPT " + JSON.stringify({ kind: "duplicate", direction, elapsedMs, correction, scans: scan.mock.calls.length, expectedScans, first: JSON.parse(first), secondFrame: frames.mock.calls[1]![0].barcodes[0] }));
      expect(scan).toHaveBeenCalledTimes(expectedScans);
    } finally {
      s.destroy();
      expect(s.state).toBe("idle");
      expect(s.camera.stop).toHaveBeenCalled();
    }
  });

  it.each([
    { direction: "backward", elapsedMs: 2000, correction: -60000, expectedTracks: 0 },
    { direction: "forward", elapsedMs: 100, correction: 60000, expectedTracks: 1 },
  ])("uses elapsed unseen-track expiry after a $direction wall-clock correction", async ({ direction, elapsedMs, correction, expectedTracks }) => {
    const s = scanner("batch");
    const track = vi.fn(), frames = vi.fn();
    s.on("track", track);
    s.on("frame", frames);
    try {
      await s.start();
      await frame(s);
      const first = s.tracker.all[0]!;
      const snapshot = JSON.stringify(first);
      expect(first).toMatchObject({ timestamp: epoch, firstSeen: epoch, lastSeen: epoch, count: 1 });
      wall += elapsedMs + correction;
      elapsed += elapsedMs;
      expect(Date.now()).toBe(epoch + elapsedMs + correction);
      expect(performance.now()).toBe(1000 + elapsedMs);
      mocks.decode.mockResolvedValue([]);
      await frame(s);
      expect(mocks.decode).toHaveBeenCalledTimes(2);
      expect(frames).toHaveBeenCalledTimes(2);
      expect(track).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(first)).toBe(snapshot);
      expect(s.state).toBe("scanning");
      console.log("WEB_CLOCK_RECEIPT " + JSON.stringify({ kind: "expiry", direction, elapsedMs, correction, expectedTracks, first, update: track.mock.calls[1]![0] }));
      expect(s.tracker.all).toHaveLength(expectedTracks);
      if (expectedTracks) expect(s.tracker.all[0]).toEqual(first);
      else expect(track.mock.calls[1]![0].removed).toEqual([first]);
    } finally {
      s.destroy();
      expect(s.state).toBe("idle");
      expect(s.camera.stop).toHaveBeenCalled();
    }
  });

  it("admits an ordinary continuous repeat after the window", async () => {
    const s = scanner("continuous"), scan = vi.fn();
    s.on("scan", scan);
    try {
      await s.start();
      await frame(s);
      wall += 2000;
      elapsed += 2000;
      await frame(s);
      expect(scan).toHaveBeenCalledTimes(2);
      expect(scan.mock.calls[1]![0].barcodes[0].timestamp).toBe(epoch + 2000);
    } finally { s.destroy(); expect(s.state).toBe("idle"); }
  });

  it("expires an ordinary unseen batch track after the timeout", async () => {
    const s = scanner("batch");
    try {
      await s.start();
      await frame(s);
      expect(s.tracker.size).toBe(1);
      wall += 2000;
      elapsed += 2000;
      mocks.decode.mockResolvedValue([]);
      await frame(s);
      expect(s.tracker.size).toBe(0);
    } finally { s.destroy(); expect(s.state).toBe("idle"); }
  });

  it("keeps explicit duplicate-filter times deterministic despite ambient clock changes", () => {
    const barcode = toBarcode(decodedCode(), { frameSize: { width: 640, height: 480 }, timestamp: epoch })!;
    const filter = new DuplicateFilter(1000);
    expect(filter.accept(barcode, 0)).toBe(true);
    wall -= 60000;
    elapsed += 2000;
    expect(filter.accept(barcode, 999)).toBe(false);
    wall += 120000;
    elapsed += 100;
    expect(filter.accept(barcode, 1000)).toBe(true);
    expect(barcode.timestamp).toBe(epoch);
  });

  it("keeps explicit tracker times, exact boundaries and metadata deterministic", () => {
    const barcode = toBarcode(decodedCode(), { frameSize: { width: 640, height: 480 }, timestamp: epoch })!;
    const tracker = new BarcodeTracker();
    const first = tracker.update([barcode], 0).added[0]!;
    wall -= 60000;
    elapsed += 2000;
    expect(tracker.update([], 500).tracked).toEqual([first]);
    wall += 120000;
    elapsed += 100;
    const returning = tracker.update([barcode], 501);
    expect(returning.removed).toEqual([first]);
    expect(returning.added[0]).toMatchObject({ timestamp: epoch, firstSeen: 501, lastSeen: 501, count: 1 });
    expect(returning.added[0]!.id).not.toBe(first.id);
  });

  it.each([
    { direction: "backward", elapsedMs: 300, correction: -60000, expectedFeedback: 2 },
    { direction: "forward", elapsedMs: 100, correction: 60000, expectedFeedback: 1 },
  ])("uses elapsed batch feedback spacing after a $direction wall-clock correction", async ({ direction, elapsedMs, correction, expectedFeedback }) => {
    const s = scanner("batch");
    s.setOptions({ beep: true });
    const scan = vi.fn();
    s.on("scan", scan);
    try {
      await s.start();
      await frame(s);
      expect(mocks.feedbackSuccess).toHaveBeenCalledOnce();
      wall += elapsedMs + correction;
      elapsed += elapsedMs;
      mocks.decode.mockResolvedValue([{ ...decodedCode(), text: "second-unique-code", bytes: new TextEncoder().encode("second-unique-code") }]);
      await frame(s);
      expect(scan).toHaveBeenCalledTimes(2);
      expect(mocks.decode).toHaveBeenCalledTimes(2);
      expect(scan.mock.calls[1]![0].barcodes[0].timestamp).toBe(wall);
      console.log("WEB_CLOCK_FEEDBACK_RECEIPT " + JSON.stringify({ direction, elapsedMs, correction, scans: scan.mock.calls.length, feedback: mocks.feedbackSuccess.mock.calls.length, expectedFeedback }));
      expect(mocks.feedbackSuccess).toHaveBeenCalledTimes(expectedFeedback);
    } finally { s.destroy(); expect(s.state).toBe("idle"); }
  });

  it("dispatches the first batch feedback near the elapsed clock origin", async () => {
    elapsed = 100;
    const s = scanner("batch");
    s.setOptions({ beep: true });
    try {
      await s.start();
      await frame(s);
      expect(mocks.decode).toHaveBeenCalledOnce();
      expect(mocks.feedbackSuccess).toHaveBeenCalledOnce();
    } finally { s.destroy(); expect(s.state).toBe("idle"); }
  });

  it("preserves explicit timestamp boundaries after a default-clock sighting", () => {
    const barcode = toBarcode(decodedCode(), { frameSize: { width: 640, height: 480 }, timestamp: epoch })!;
    const filter = new DuplicateFilter(1000), tracker = new BarcodeTracker();
    expect(filter.accept(barcode)).toBe(true);
    const first = tracker.update([barcode]).added[0]!;
    wall += 60000;
    elapsed += 100;
    // Non-epoch explicit numbers keep their legacy numeric timestamp meaning.
    expect(filter.accept(barcode, 0)).toBe(false);
    expect(tracker.update([], 0).tracked).toEqual([first]);
    expect(filter.accept(barcode, epoch + 999)).toBe(false);
    expect(filter.accept(barcode, epoch + 1000)).toBe(true);
    expect(tracker.update([], epoch + 500).tracked).toEqual([first]);
    expect(tracker.update([], epoch + 501).removed).toEqual([first]);
    expect(first).toMatchObject({ timestamp: epoch, firstSeen: epoch, lastSeen: epoch });
  });

  it("rebases explicit epoch history once before subsequent default-clock corrections", () => {
    const barcode = toBarcode(decodedCode(), { frameSize: { width: 640, height: 480 }, timestamp: epoch })!;
    const filter = new DuplicateFilter(1000), tracker = new BarcodeTracker();
    expect(filter.accept(barcode, epoch)).toBe(true);
    const first = tracker.update([barcode], epoch).added[0]!;
    wall += 500;
    elapsed += 100;
    expect(filter.accept(barcode)).toBe(false);
    expect(tracker.update([]).tracked).toEqual([first]);
    wall -= 60000;
    elapsed += 500;
    expect(filter.accept(barcode)).toBe(true);
    expect(tracker.update([]).removed).toEqual([first]);
    expect(first).toMatchObject({ timestamp: epoch, firstSeen: epoch, lastSeen: epoch });
  });

  it("retains legacy non-epoch timestamp ages when returning to the default clock", () => {
    const barcode = toBarcode(decodedCode(), { frameSize: { width: 640, height: 480 }, timestamp: epoch })!;
    const filter = new DuplicateFilter(1000), tracker = new BarcodeTracker();
    expect(filter.accept(barcode, 0)).toBe(true);
    const first = tracker.update([barcode], 0).added[0]!;
    expect(filter.accept(barcode)).toBe(true);
    expect(tracker.update([]).removed).toEqual([first]);
    expect(first).toMatchObject({ timestamp: epoch, firstSeen: 0, lastSeen: 0 });
    filter.reset();
    tracker.clear();
    wall -= 60000;
    elapsed += 100;
    expect(filter.accept(barcode)).toBe(true);
    const replacement = tracker.update([barcode]).added[0]!;
    expect(replacement).toMatchObject({ firstSeen: wall, lastSeen: wall, count: 1 });
    expect(replacement.id).not.toBe(first.id);
  });
});
