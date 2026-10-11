// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QRGenScannerElement } from "../src/elements/scanner-element";
import type { TrackedBarcode } from "../src/types";

describe("Scanner element autostart lifecycle", () => {
  function element() {
    const el = new QRGenScannerElement();
    const start = vi.spyOn(el, "start").mockResolvedValue(undefined);
    const attributes = new Map<string, string>();
    Object.assign(el, {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      hasAttribute: (name: string) => attributes.has(name),
      isConnected: true,
    });
    vi.spyOn(el as unknown as { render(): void }, "render").mockImplementation(() => {});
    return { el, start, attributes };
  }

  beforeEach(() => vi.stubGlobal("cancelAnimationFrame", vi.fn()));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("does not autostart after being disconnected before its microtask", async () => {
    const { el, start } = element();
    el.connectedCallback();
    Object.assign(el, { isConnected: false });
    el.disconnectedCallback();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps only the latest connection's queued autostart", async () => {
    const { el, start } = element();
    el.connectedCallback();
    Object.assign(el, { isConnected: false });
    el.disconnectedCallback();
    Object.assign(el, { isConnected: true });
    el.connectedCallback();
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
  });

  it("honors autostart being disabled before the queued callback", async () => {
    const { el, start, attributes } = element();
    el.connectedCallback();
    attributes.set("autostart", "false");
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });

  it("honors stop before the queued autostart", async () => {
    const { el, start } = element();
    el.connectedCallback();
    el.stop();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });
  it.each(["disconnect", "replace"])("discards camera-switch UI updates after scanner %s", async (action) => {
    const { el } = element();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const oldScanner = { switchCamera: () => pending, destroy: vi.fn(), camera: { isFront: true } };
    const toggle = vi.fn();
    const internals = el as unknown as {
      _scanner: unknown; els: unknown; layout(): void; refreshCameraControls(): Promise<void>;
    };
    internals._scanner = oldScanner;
    internals.els = { video: { classList: { toggle } } };
    const layout = vi.spyOn(internals, "layout").mockImplementation(() => {});
    const controls = vi.spyOn(internals, "refreshCameraControls").mockResolvedValue(undefined);
    const switching = el.switchCamera();
    el.disconnectedCallback();
    if (action === "replace") internals._scanner = { camera: { isFront: false } };
    finish();
    await expect(switching).resolves.toBeUndefined();
    expect(toggle).not.toHaveBeenCalled();
    expect(layout).not.toHaveBeenCalled();
    expect(controls).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("clears source-A results immediately during a paused camera switch (%s)", async (outcome) => {
    const { el } = element();
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const internals = el as any;
    const selected = { id: 1, data: "source A" } as TrackedBarcode;
    internals.tracked = [selected];
    internals.highlights = [{ at: 100 }];
    internals._selection.set(1, selected);
    internals._scanner = { switchCamera: () => pending, state: "paused", camera: { isFront: true } };
    internals.els = { video: { classList: { toggle: vi.fn() } } };
    internals.rendered = true;
    const results = vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    vi.spyOn(internals, "layout").mockImplementation(() => {});
    vi.spyOn(internals, "refreshCameraControls").mockResolvedValue(undefined);
    const switching = el.switchCamera();
    const clearedBeforeCamera = internals.tracked.length === 0 && internals.highlights.length === 0;
    if (outcome === "failure") fail(new Error("camera unavailable"));
    else finish();
    await Promise.allSettled([switching]);
    expect(clearedBeforeCamera).toBe(true);
    expect(internals.tracked).toEqual([]);
    expect(internals.highlights).toEqual([]);
    expect(el.selection).toEqual([selected]);
    expect(results).toHaveBeenCalled();
  });

  it.each(["camera", "resolution", "worker"])("clears old highlights and selection when %s recreates the scanner", (attribute) => {
    const { el, start } = element();
    const internals = el as any;
    internals.rendered = true;
    internals.tracked = [{ id: 1 }];
    internals.highlights = [{ at: 100 }];
    internals._selection.set(1, { id: 1 });
    internals._scanner = { state: "paused", destroy: vi.fn() };
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    const draw = vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    el.attributeChangedCallback(attribute, "old", "new");
    expect(internals.tracked).toEqual([]);
    expect(internals.highlights).toEqual([]);
    expect(el.selection).toEqual([]);
    expect(draw).toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
  });

  it.each([
    { attribute: "camera", value: "front", expected: "front" },
    { attribute: "resolution", value: "hd", expected: "hd" },
    { attribute: "worker", value: "false", expected: false },
  ])("restarts pending startup with the new $attribute setting", async ({ attribute, value, expected }) => {
    const { el, start, attributes } = element();
    const internals = el as any;
    internals.rendered = true;
    const oldScanner = { state: "starting", destroy: vi.fn() };
    internals._scanner = oldScanner;
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    const screens = vi.spyOn(internals, "updateScreens").mockImplementation(() => {});
    let replacementOptions: unknown;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    start.mockImplementation(() => { replacementOptions = el.options; return pending; });
    attributes.set(attribute, value);

    el.attributeChangedCallback(attribute, "old", value);

    expect(oldScanner.destroy).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(replacementOptions).toMatchObject({ [attribute]: expected });
    expect(screens).not.toHaveBeenCalledWith("idle");
    finish();
    await pending;
  });

  it.each(["starting", "scanning", "paused"])("honors a stop during %s configuration teardown", (state) => {
    const { el, start } = element();
    const internals = el as any;
    internals.rendered = true;
    internals._scanner = { state, destroy: () => el.stop() };
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    const screens = vi.spyOn(internals, "updateScreens").mockImplementation(() => {});

    el.attributeChangedCallback("camera", "back", "front");

    expect(start).not.toHaveBeenCalled();
    expect(internals._scanner).toBeNull();
    expect(screens).toHaveBeenLastCalledWith("idle");
  });

  it("keeps a replacement started during pending-start teardown", () => {
    const { el, start } = element();
    const internals = el as any;
    internals.rendered = true;
    const replacement = { state: "starting" };
    internals._scanner = { state: "starting", destroy: () => { internals._scanner = replacement; } };
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    const screens = vi.spyOn(internals, "updateScreens").mockImplementation(() => {});

    el.attributeChangedCallback("worker", "true", "false");

    expect(start).not.toHaveBeenCalled();
    expect(internals._scanner).toBe(replacement);
    expect(screens).not.toHaveBeenCalled();
  });

  it("does not clear a replacement scanner's results after a reentrant stop listener", () => {
    const { el } = element();
    const internals = el as any;
    const current = { id: 2 };
    internals._scanner = { stop: () => { internals._scanner = {}; internals.tracked = [current]; internals.highlights = [{ at: 200 }]; } };
    el.stop();
    expect(internals.tracked).toEqual([current]);
    expect(internals.highlights).toEqual([{ at: 200 }]);
  });

  it("clears intrinsic-resize overlays but ignores events from a replaced scanner", () => {
    const { el } = element();
    const internals = el as any;
    Object.assign(el, { hasAttribute: () => false });
    internals.els = { video: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const scanner = internals.ensureScanner();
    internals.rendered = true;
    vi.spyOn(internals, "updateCount").mockImplementation(() => {});
    vi.spyOn(internals, "updateResults").mockImplementation(() => {});
    vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
    const selected = { id: 1 };
    internals._selection.set(1, selected);
    internals.tracked = [selected];
    internals.highlights = [{ at: 100 }];
    scanner.emit("spatialreset", { frameSize: { width: 480, height: 640 } });
    expect(internals.tracked).toEqual([]);
    expect(internals.highlights).toEqual([]);
    expect(el.selection).toEqual([selected]);

    const replacement = { id: 2 };
    internals._scanner = {};
    internals.tracked = [replacement];
    internals.highlights = [{ at: 200 }];
    scanner.emit("spatialreset", { frameSize: { width: 640, height: 480 } });
    scanner.emit("track", { tracked: [selected], added: [selected], removed: [] });
    scanner.emit("frame", { barcodes: [{ symbology: "qr" }], frameSize: { width: 640, height: 480 } });
    scanner.emit("state", "stopped");
    expect(internals.tracked).toEqual([replacement]);
    expect(internals.highlights).toEqual([{ at: 200 }]);
  });

});
