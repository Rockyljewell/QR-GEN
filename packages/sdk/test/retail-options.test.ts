// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QRGenScannerElement } from "../src/elements/scanner-element";
import { QRGenError } from "../src/errors";
import type { Barcode } from "../src/types";

function barcode(symbology: "qr" | "ean13", data: string, x = 10): Barcode {
  return { data, symbology, symbologyName: symbology, rawBytes: "", contentType: "text", isGS1: false,
    location: { topLeft: { x, y: 10 }, topRight: { x: x + 40, y: 10 }, bottomRight: { x: x + 40, y: 50 }, bottomLeft: { x, y: 50 } },
    frameSize: { width: 640, height: 480 }, orientation: 0, ecLevel: "", symbologyIdentifier: "", timestamp: 1000 };
}

function setup() {
  const el = new QRGenScannerElement();
  const internals = el as any;
  const attributes = new Map<string, string>([["mode", "batch"], ["symbologies", "qr,ean13"], ["beep", "false"], ["vibrate", "false"]]);
  const events = new EventTarget();
  const video = { videoWidth: 640, videoHeight: 480,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    requestVideoFrameCallback: vi.fn(() => 1), cancelVideoFrameCallback: vi.fn() };
  Object.assign(internals, { rendered: true, getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name), root: { replaceChildren: vi.fn(), removeEventListener: vi.fn() },
    els: { video, count: { hidden: true, textContent: "" }, hint: { style: { opacity: "" } } } });
  vi.spyOn(el, "start").mockResolvedValue(undefined);
  vi.spyOn(internals, "updateResults").mockImplementation(() => {});
  vi.spyOn(internals, "updateScreens").mockImplementation(() => {});
  vi.spyOn(internals, "updateHint").mockImplementation(() => {});
  vi.spyOn(internals, "requestDraw").mockImplementation(() => {});
  vi.spyOn(internals, "layout").mockImplementation(() => {});
  vi.spyOn(internals, "flashViewfinder").mockImplementation(() => {});
  const emit = vi.spyOn(internals, "emitEvent").mockImplementation(() => {});
  const scanner = internals.ensureScanner();
  scanner._state = "scanning";
  const change = (name: string, value: string) => {
    const old = attributes.get(name) ?? null;
    attributes.set(name, value);
    el.attributeChangedCallback(name, old, value);
  };
  return { el, internals, scanner, attributes, emit, change };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Date, "now").mockReturnValue(1000);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("batch scan configuration and selection", () => {
  it.each(["ordinary", "restart", "stop"])("keeps a startup error owned by its original session (%s)", async (action) => {
    const { scanner } = setup();
    scanner.removeAllListeners();
    scanner._state = "idle";
    scanner.decoder = { kind: "main", decode: vi.fn() };
    const failure = new QRGenError("camera-in-use", "initial camera failure");
    let finish!: () => void;
    let replacement: Promise<void> | undefined;
    scanner.camera.start = vi.fn().mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const errors = vi.fn();
    scanner.on("error", errors);
    scanner.on("state", (state: string) => {
      if (state !== "error") return;
      if (action === "restart") replacement = scanner.start();
      if (action === "stop") scanner.stop();
    });
    await expect(scanner.start()).rejects.toBe(failure);
    expect(errors).toHaveBeenCalledTimes(action === "ordinary" ? 1 : 0);
    expect(scanner.state).toBe(action === "restart" ? "starting" : action === "stop" ? "stopped" : "error");
    if (replacement) { finish(); await replacement; }
    scanner.stop();
  });

  it("removes disabled paused tracks and pending scans while preserving enabled identity and chosen snapshots", () => {
    const { el, internals, scanner, change } = setup();
    const scan = vi.fn();
    const tracks = vi.fn();
    scanner.on("scan", scan);
    scanner.on("track", tracks);
    scanner.on("track", () => { if (tracks.mock.calls.length === 1) scanner.pause(); });
    scanner.handleResults([barcode("qr", "chosen"), barcode("ean13", "5901234123457", 100)]);
    const [qr, ean] = scanner.tracker.all;
    el.selectBarcode(qr.id, true);
    expect(scanner.pendingBatchScans.size).toBe(2);
    change("symbologies", "ean13");
    expect(scanner.state).toBe("paused");
    expect(scanner.tracker.all).toEqual([ean]);
    expect(scanner.tracker.all[0]).toBe(ean);
    expect(scanner.pendingBatchScans).toEqual(new Set([ean.id]));
    expect(tracks.mock.calls[1]?.[0]).toEqual({ tracked: [ean], added: [], updated: [], removed: [qr] });
    expect(internals.tracked).toEqual([ean]);
    expect(internals.els.count.textContent).toBe("1 barcode in view");
    expect(el.selection).toEqual([qr]);
    expect(el.selectBarcode(qr.id, false)).toBe(true);
    expect(el.selectBarcode(qr.id, true)).toBe(false);
    expect(scan).not.toHaveBeenCalled();
    scanner.resume();
    scanner.handleResults([barcode("ean13", "5901234123457", 102)]);
    expect(scanner.tracker.all[0]).toMatchObject({ id: ean.id, count: 2 });
    expect(scan).toHaveBeenCalledOnce();
    expect(scan.mock.calls[0]![0].barcodes).toMatchObject([{ id: ean.id }]);
  });

  it("preserves tracks and sends no removal event for an equivalent or expanded effective symbology set", () => {
    const { scanner } = setup();
    scanner.handleResults([barcode("qr", "same")]);
    const track = scanner.tracker.all[0];
    const changed = vi.fn();
    scanner.on("track", changed);
    scanner.setOptions({ symbologies: ["ean13", "qr", "qr"] });
    scanner.setOptions({ symbologies: ["all"] });
    expect(scanner.tracker.all).toEqual([track]);
    expect(scanner.tracker.all[0]).toBe(track);
    expect(changed).not.toHaveBeenCalled();
  });

  for (const attribute of ["mode", "camera", "resolution", "worker", "disconnect"]) {
    it(`notifies a nonempty automatic selection clear exactly once on ${attribute}`, () => {
      const { el, scanner, emit, change } = setup();
      vi.spyOn(el, "start").mockResolvedValue(undefined);
      scanner.handleResults([barcode("qr", "chosen")]);
      el.selectBarcode(scanner.tracker.all[0].id, true);
      emit.mockClear();
      if (attribute === "disconnect") el.disconnectedCallback();
      else change(attribute, attribute === "mode" ? "continuous" : attribute === "worker" ? "false" : "new");
      expect(el.selection).toEqual([]);
      expect(emit.mock.calls.filter(([name]) => name === "select")).toEqual([
        ["select", { barcode: null, selected: false, selection: [] }],
      ]);
      emit.mockClear();
      if (attribute === "disconnect") el.disconnectedCallback();
      else change(attribute, attribute === "mode" ? "batch" : "other");
      expect(emit.mock.calls.filter(([name]) => name === "select")).toEqual([]);
    });
  }

  it("preserves a fresh selection when an automatic mode-clear listener changes mode back", () => {
    const { el, internals, scanner, emit, change } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    emit.mockImplementation((name, detail: any) => {
      if (name !== "select" || detail.barcode !== null) return;
      change("mode", "batch");
      scanner.handleResults([barcode("qr", "fresh")]);
      el.selectBarcode(scanner.tracker.all[0].id, true);
    });
    change("mode", "continuous");
    expect(scanner.options.mode).toBe("batch");
    expect(el.selection).toMatchObject([{ data: "fresh" }]);
    expect(internals.tracked).toMatchObject([{ data: "fresh" }]);
  });

  it("destroys only the old scanner when a camera-reset listener creates a replacement", () => {
    const { el, internals, scanner, emit, change } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    const destroyed = vi.spyOn(scanner, "destroy");
    let replacement: any;
    emit.mockImplementation((name, detail: any) => {
      if (name !== "select" || detail.barcode !== null) return;
      replacement = internals.ensureScanner();
      replacement._state = "scanning";
      replacement.handleResults([barcode("qr", "fresh")]);
      el.selectBarcode(replacement.tracker.all[0].id, true);
    });
    change("camera", "front");
    expect(destroyed).toHaveBeenCalledOnce();
    expect(internals._scanner).toBe(replacement);
    expect(replacement?.state).toBe("scanning");
    expect(el.selection).toMatchObject([{ data: "fresh" }]);
    expect(internals.tracked).toMatchObject([{ data: "fresh" }]);
  });

  it("restarts with the latest source options after a reset listener updates the hint", () => {
    const { el, internals, scanner, emit, change } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    emit.mockImplementation((name, detail: any) => {
      if (name !== "select" || detail.barcode !== null) return;
      change("hint", "Ready for the next camera");
      change("camera", "back");
    });
    change("camera", "front");
    expect(el.start).toHaveBeenCalledOnce();
    expect(internals._scanner).toBeNull(); // The mocked start does not open a camera.
    expect(el.options.camera).toBe("back");
  });

  it.each(["scanning", "paused"])("respects a reset listener's explicit pause from %s", (state) => {
    const { el, scanner, emit, change } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    if (state === "paused") scanner.pause();
    const resume = vi.spyOn(scanner, "resume");
    emit.mockImplementation((name, detail: any) => {
      if (name === "select" && detail.barcode === null) el.pause();
    });
    change("mode", "continuous");
    expect(scanner.state).toBe("paused");
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes a preexisting mode pause after a reset listener changes only the hint", () => {
    const { el, scanner, emit, change } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    scanner.pause();
    emit.mockImplementation((name, detail: any) => {
      if (name === "select" && detail.barcode === null) change("hint", "Continue scanning");
    });
    change("mode", "continuous");
    expect(scanner.state).toBe("scanning");
  });

  it("finishes old disconnect cleanup before notifying a listener that creates a new session", () => {
    const { el, internals, scanner, emit } = setup();
    scanner.handleResults([barcode("qr", "old")]);
    el.selectBarcode(scanner.tracker.all[0].id, true);
    let replacement: any;
    emit.mockImplementation((name, detail: any) => {
      if (name !== "select" || detail.barcode !== null) return;
      internals.rendered = true;
      replacement = internals.ensureScanner();
      replacement._state = "scanning";
      replacement.handleResults([barcode("qr", "fresh")]);
      el.selectBarcode(replacement.tracker.all[0].id, true);
    });
    el.disconnectedCallback();
    expect(internals._scanner).toBe(replacement);
    expect(internals.rendered).toBe(true);
    expect(el.selection).toMatchObject([{ data: "fresh" }]);
    expect(internals.tracked).toMatchObject([{ data: "fresh" }]);
  });
});
