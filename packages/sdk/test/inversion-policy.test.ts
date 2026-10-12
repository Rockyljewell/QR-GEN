// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("zxing-wasm/reader", () => ({ readBarcodes: read }));
import { invertRaster, readWithInversion } from "../src/engine/inversion";
import type { DecodeParams } from "../src/engine/protocol";
const params: DecodeParams = { formats: ["Code128"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 2 };
const frame = { width: 1, height: 1, data: new Uint8ClampedArray([0, 32, 255, 73]) } as ImageData;
const detection = (x: number, format = "Code128") => ({ isValid: true, format, text: "SAME", bytes: new Uint8Array([1]), contentType: "Text", position: { topLeft: { x, y: 0 }, topRight: { x: x + 20, y: 0 }, bottomRight: { x: x + 20, y: 20 }, bottomLeft: { x, y: 20 } } });
describe("inversion policy", () => {
  beforeEach(() => { read.mockReset(); });
  it("inverts only RGB in a fresh buffer and preserves dimensions and alpha", () => {
    expect(invertRaster(frame)).toEqual({ width: 1, height: 1, data: new Uint8ClampedArray([255, 223, 0, 73]) });
    expect(frame.data).toEqual(new Uint8ClampedArray([0, 32, 255, 73]));
  });
  it("runs the inverted pass when the normal pass found nothing and keeps every copy", async () => {
    read.mockResolvedValueOnce([]).mockResolvedValueOnce([detection(0), detection(100)]);
    const found = await readWithInversion(frame, params);
    expect(found.map(x => [x.position.topLeft.x, x.isInverted])).toEqual([[0, true], [100, true]]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![1]).toMatchObject({ tryInvert: false, maxNumberOfSymbols: 2 });
  });
  it.each([1, 2])("never runs the inverted pass or loads pixels when the normal pass found %i code(s)", async count => {
    const load = vi.fn();
    read.mockResolvedValue([detection(0), detection(100)].slice(0, count));
    // maxNumberOfSymbols 3: capacity remains, so this is the found-something rule, not the limit.
    const found = await readWithInversion(new Uint8Array([1]), { ...params, maxNumberOfSymbols: 3 }, load);
    expect(found).toHaveLength(count);
    expect(found.every(x => !x.isInverted)).toBe(true);
    expect(read).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
  });
  it("does not invert a raster frame when the normal pass found something", async () => {
    read.mockResolvedValue([detection(0)]);
    await readWithInversion(frame, { ...params, maxNumberOfSymbols: 255 });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toBe(frame);
  });
  it("skips the fallback when disabled", async () => {
    const load = vi.fn();
    read.mockResolvedValue([]);
    await readWithInversion(new Uint8Array([1]), { ...params, tryInvert: false }, load);
    expect(read).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
  });
  it("applies the limit to the inverted pass", async () => {
    read.mockResolvedValueOnce([]).mockResolvedValueOnce([detection(0), detection(100)]);
    expect(await readWithInversion(frame, { ...params, maxNumberOfSymbols: 1 })).toHaveLength(1);
  });
  it("does not explicitly invert formats already handled by the engine", async () => {
    read.mockResolvedValue([]);
    const load = vi.fn();
    await readWithInversion(new Uint8Array([1]), { ...params, formats: ["QRCodeModel2", "MicroQRCode", "RMQRCode", "DataMatrix", "AztecCode"] }, load);
    expect(read).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
  });
  it("limits fallback to requested formats needing explicit inversion", async () => {
    read.mockResolvedValue([]);
    await readWithInversion(frame, { ...params, formats: ["QRCodeModel2", "Code128"] });
    expect(read.mock.calls[1]![1]).toMatchObject({ formats: ["Code128"], tryInvert: false });
  });
  it("returns no results instead of failing when the optional encoded codec is unavailable", async () => {
    read.mockResolvedValue([]);
    const load = vi.fn(async () => { throw new Error("unsupported codec"); });
    expect(await readWithInversion(new Uint8Array([1]), params, load)).toEqual([]);
    expect(load).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  });
  it("propagates engine failure from either decode pass", async () => {
    read.mockRejectedValueOnce(new Error("wasm first"));
    await expect(readWithInversion(frame, params)).rejects.toThrow("wasm first");
    read.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("wasm second"));
    await expect(readWithInversion(frame, params)).rejects.toThrow("wasm second");
  });
});
