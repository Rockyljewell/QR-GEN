// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { QRGenScannerElement } from "../src/elements/scanner-element";
import type { TrackedBarcode } from "../src/types";

function barcode(id: number, data = "same payload"): TrackedBarcode {
  return { id, data, symbology: "qr", symbologyName: "QR Code" } as TrackedBarcode;
}

function setup(mode = "batch") {
  const el = new QRGenScannerElement();
  const internals = el as unknown as {
    tracked: TrackedBarcode[];
    _scanner: unknown;
    els: { count: { hidden: boolean; textContent: string } };
    emitEvent(name: string, detail: unknown): void;
    updateCount(): void;
  };
  internals.tracked = [barcode(1), barcode(2)];
  internals._scanner = { options: { mode }, feedback: { vibrate: vi.fn() } };
  internals.els = { count: { hidden: false, textContent: "" } };
  const emit = vi.spyOn(internals, "emitEvent").mockImplementation(() => {});
  internals.updateCount();
  return { el, internals, emit };
}

afterEach(() => vi.restoreAllMocks());

describe("Scanner element batch selection", () => {
  it("selects identical payloads independently by track id without changing the detected total", () => {
    const { el, internals, emit } = setup();
    expect(el.selectBarcode(2)).toBe(true);
    expect(el.selection.map((item) => item.id)).toEqual([2]);
    expect(internals.els.count.textContent).toBe("2 barcodes in view");
    expect(emit).toHaveBeenLastCalledWith("select", { barcode: internals.tracked[1], selected: true, selection: el.selection });
    el.selectBarcode(1, true);
    expect(el.selection.map((item) => item.id)).toEqual([2, 1]);
    expect(internals.els.count.textContent).toBe("2 barcodes in view");
  });

  it("allows a selected barcode to be deselected after its track leaves view", () => {
    const { el, internals } = setup();
    el.selectBarcode(1, true);
    internals.tracked = [];
    internals.updateCount();
    expect(el.selectBarcode(1, false)).toBe(true);
    expect(el.selection).toEqual([]);
    expect(el.selectBarcode(1, true)).toBe(false);
    expect(internals.els.count.hidden).toBe(true);
  });

  it("ignores unknown tracks and selection requests outside batch mode", () => {
    const { el, internals, emit } = setup("continuous");
    expect(el.selectBarcode(1)).toBe(false);
    internals._scanner = { options: { mode: "batch" }, feedback: { vibrate: vi.fn() } };
    expect(el.selectBarcode(99)).toBe(false);
    expect(el.selection).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not duplicate selection events for an already applied state", () => {
    const { el, emit } = setup();
    el.selectBarcode(1, true);
    expect(el.selectBarcode(1, true)).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    el.clearSelection();
    expect(el.selection).toEqual([]);
    expect(emit).toHaveBeenLastCalledWith("select", { barcode: null, selected: false, selection: [] });
  });
});
