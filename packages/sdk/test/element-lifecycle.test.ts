// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QRGenScannerElement } from "../src/elements/scanner-element";

describe("Scanner element autostart lifecycle", () => {
  function element() {
    const el = new QRGenScannerElement();
    const start = vi.spyOn(el, "start").mockResolvedValue(undefined);
    const attributes = new Map<string, string>();
    Object.assign(el, {
      getAttribute: (name: string) => attributes.get(name) ?? null,
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

});