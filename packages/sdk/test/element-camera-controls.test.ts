// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QRGenScannerElement } from "../src/elements/scanner-element";

const mocks = vi.hoisted(() => ({ list: vi.fn(), decode: vi.fn(), nextTrack: 0 }));
vi.mock("../src/camera", () => ({ Camera: class {
  static list() { return mocks.list(); }
  capabilities = { torch: false, zoom: null, focusMode: [] };
  isFront = false;
  isTorchOn = false;
  track: { id: number } | null = null;
  start = vi.fn(async () => { this.track = { id: ++mocks.nextTrack }; });
  stop = vi.fn(() => { this.track = null; });
  setTorch = vi.fn().mockResolvedValue(false);
  switch = vi.fn().mockResolvedValue(undefined);
} }));
vi.mock("../src/feedback", () => ({ Feedback: class {
  options = {};
  unlock() {} success() {} dispose() {}
} }));
vi.mock("../src/engine/decoder", () => ({
  createFrameDecoder: async () => ({ kind: "worker", decode: mocks.decode }),
}));

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function button() {
  return { hidden: true, innerHTML: "", textContent: "", classList: { toggle: vi.fn() }, setAttribute: vi.fn() };
}
function element() {
  const el = new QRGenScannerElement();
  const internals = el as any;
  const attributes = new Map<string, string>([["autostart", "false"], ["beep", "false"], ["vibrate", "false"]]);
  const events = new EventTarget();
  let renderCount = 0;
  Object.assign(el, {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute(name: string, value: string) {
      const previous = attributes.get(name) ?? null;
      attributes.set(name, value);
      el.attributeChangedCallback(name, previous, value);
    },
    removeAttribute(name: string) {
      const previous = attributes.get(name) ?? null;
      attributes.delete(name);
      el.attributeChangedCallback(name, previous, null);
    },
    dispatchEvent: events.dispatchEvent.bind(events),
    isConnected: true,
  });
  // Node unit fixtures replace DOM rendering only; scanner ownership, ready
  // delivery, source lifecycle and the actual controls-refresh path stay real.
  vi.spyOn(internals, "render").mockImplementation(() => {
    if (internals.rendered) return;
    renderCount++;
    const videoEvents = new EventTarget();
    internals.root = { removeEventListener: vi.fn(), replaceChildren: vi.fn() };
    internals.els = {
      video: {
        videoWidth: 640, videoHeight: 480, classList: { toggle: vi.fn() },
        addEventListener: videoEvents.addEventListener.bind(videoEvents),
        removeEventListener: videoEvents.removeEventListener.bind(videoEvents),
        requestVideoFrameCallback: vi.fn(() => 1), cancelVideoFrameCallback: vi.fn(),
      },
      torch: button(), switch: button(), zoom: button(), pause: button(), again: button(),
      start: button(), loading: button(), error: button(),
    };
    internals.rendered = true;
  });
  vi.spyOn(internals, "layout").mockImplementation(() => {});
  vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
  vi.spyOn(internals, "updateCount").mockImplementation(() => {});
  vi.spyOn(internals, "updateResults").mockImplementation(() => {});
  return { el, internals, renderCount: () => renderCount };
}

const devices = (count: number) => Array.from({ length: count }, (_, id) => ({ kind: "videoinput", deviceId: String(id) }));

describe("Element camera-control refresh ownership", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.decode.mockReset();
    mocks.nextTrack = 0;
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each((["camera", "resolution", "worker", "reconnect", "restart"] as const).flatMap(change =>
    (["resolve", "reject"] as const).map(outcome => ({ change, outcome })),
  ))("ignores stale device-list $outcome after $change", async ({ change, outcome }) => {
    const a = pending<ReturnType<typeof devices>>(), b = pending<ReturnType<typeof devices>>();
    mocks.list.mockReset().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { el, internals, renderCount } = element();
    let oldScanner = el.scanner;
    let currentScanner = el.scanner;
    try {
      el.connectedCallback();
      await el.start();
      oldScanner = el.scanner;
      expect(oldScanner?.state).toBe("scanning");
      expect(mocks.list).toHaveBeenCalledOnce();
      const oldButton = internals.els.switch;
      if (change === "reconnect") {
        Object.assign(el, { isConnected: false });
        el.disconnectedCallback();
        Object.assign(el, { isConnected: true });
        el.connectedCallback();
        await el.start();
      } else if (change === "restart") {
        el.stop();
        await el.start();
      } else if (change === "camera") el.camera = "front";
      else if (change === "resolution") el.resolution = "fhd";
      else el.worker = false;
      await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 1 });
      const current = el.scanner;
      currentScanner = current;
      expect(current?.state).toBe("scanning");
      expect(current === oldScanner).toBe(change === "restart");
      const currentButton = internals.els.switch;
      expect(currentButton === oldButton).toBe(change !== "reconnect");
      b.resolve(devices(2));
      await Promise.resolve();
      expect(currentButton.hidden).toBe(false);
      if (outcome === "resolve") a.resolve(devices(1));
      else a.reject(new Error("obsolete device enumeration failed"));
      await Promise.resolve();
      expect(el.scanner).toBe(current);
      expect(current?.state).toBe("scanning");
      expect(mocks.decode).not.toHaveBeenCalled();
      console.log("ELEMENT_CONTROLS_RECEIPT " + JSON.stringify({ change, outcome, renders: renderCount(), sameScanner: current === oldScanner, sameButton: currentButton === oldButton, currentState: current?.state, currentSwitchHidden: currentButton.hidden, expectedSwitchHidden: false }));
      expect(currentButton.hidden).toBe(false);
    } finally {
      Object.assign(el, { isConnected: false });
      el.disconnectedCallback();
      expect(el.scanner).toBeNull();
      expect(oldScanner?.camera.stop).toHaveBeenCalled();
      expect(currentScanner?.camera.stop).toHaveBeenCalled();
      expect(currentScanner?.state).toBe("idle");
    }
  });

  it.each(["resolve", "reject"] as const)("applies current-owner device enumeration %s", async (outcome) => {
    const result = pending<ReturnType<typeof devices>>();
    mocks.list.mockReturnValueOnce(result.promise);
    const { el, internals } = element();
    let currentScanner = el.scanner;
    try {
      el.connectedCallback();
      await el.start();
      currentScanner = el.scanner;
      expect(mocks.list).toHaveBeenCalledOnce();
      if (outcome === "resolve") result.resolve(devices(2));
      else result.reject(new Error("current device enumeration failed"));
      await Promise.resolve();
      expect(el.state).toBe("scanning");
      expect(internals.els.switch.hidden).toBe(outcome === "reject");
      expect(mocks.decode).not.toHaveBeenCalled();
    } finally {
      Object.assign(el, { isConnected: false });
      el.disconnectedCallback();
      expect(el.scanner).toBeNull();
      expect(currentScanner?.camera.stop).toHaveBeenCalled();
      expect(currentScanner?.state).toBe("idle");
    }
  });
});
