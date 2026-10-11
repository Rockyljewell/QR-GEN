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
  it("merges the same physical result with corner jitter but keeps another copy", async () => {
    read.mockResolvedValueOnce([detection(0)]).mockResolvedValueOnce([detection(1), detection(100)]);
    const found = await readWithInversion(frame, params);
    expect(found).toHaveLength(2);
    expect(found.map(x => x.position.topLeft.x)).toEqual([0, 100]);
    expect(found[1]!.isInverted).toBe(true);
    expect(read.mock.calls[1]![1]).toMatchObject({ tryInvert: false, maxNumberOfSymbols: 2 });
  });
  it.each([false, true])("skips fallback when disabled or full (full=%s)", async full => {
    const load = vi.fn();
    read.mockResolvedValue(full ? [detection(0), detection(100)] : []);
    await readWithInversion(new Uint8Array([1]), { ...params, tryInvert: full }, load);
    expect(read).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
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
  it("preserves normal results when the optional encoded codec is unavailable", async () => {
    read.mockResolvedValue([detection(0)]);
    const result = await readWithInversion(new Uint8Array([1]), params, async () => { throw new Error("unsupported codec"); });
    expect(result).toHaveLength(1); expect(read).toHaveBeenCalledOnce();
  });
  it("propagates engine failure from either decode pass", async () => {
    read.mockRejectedValueOnce(new Error("wasm first"));
    await expect(readWithInversion(frame, params)).rejects.toThrow("wasm first");
    read.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("wasm second"));
    await expect(readWithInversion(frame, params)).rejects.toThrow("wasm second");
  });
});
