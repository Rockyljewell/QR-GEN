// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import * as generator from "../src/generator";
import { QRGenError } from "../src/errors";
import { scan } from "../src/node";
import { planQRCode, type QRCodePlanOptions } from "../src/planner";

const LABEL_DATA = "https://example.com/" + "x".repeat(100);

afterEach(() => vi.restoreAllMocks());

describe("QR physical generation planner", () => {
  it("keeps larger whole-dot modules rather than maximizing ECC at their expense", async () => {
    const plan = await planQRCode(LABEL_DATA, { widthMm: 30, dpi: 203 });
    expect(plan.suitable).toBe(true);
    if (!plan.suitable) throw new Error("Expected a suitable label");
    expect(plan.ecLevel).toBe("M");
    expect(plan.geometry.dotsPerModule).toBe(4);
    expect(plan.candidates.find((candidate) => candidate.ecLevel === "H")!.geometry.dotsPerModule).toBe(3);
    expect(plan.geometry.widthMm).toBeLessThanOrEqual(30);
    expect(plan.geometry.widthDots).toBe(plan.geometry.totalModules * 4);
    expect(plan.geometry.totalModules).toBe(plan.geometry.symbolModules + 8);
    expect(plan.geometry.quietZoneModules).toBe(4);
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ecc-tradeoff", ecLevel: "M" }),
      expect.objectContaining({ code: "physical-validation-required" }),
    ]));
  });

  it("uses stronger ECC when whole-dot geometry is tied", async () => {
    const plan = await planQRCode("Hi!", { widthMm: 20, dpi: 203 });
    expect(plan.suitable).toBe(true);
    expect(plan.ecLevel).toBe("H");
    expect(plan.candidates.map((candidate) => candidate.geometry.dotsPerModule)).toEqual([5, 5, 5]);
  });

  it("shows the 20 mm / 203 DPI tradeoff and never emits a sub-profile image", async () => {
    const automatic = await planQRCode(LABEL_DATA, { widthMm: 20, dpi: 203 });
    expect(automatic.suitable).toBe(true);
    expect(automatic.ecLevel).toBe("M");
    expect(automatic.geometry?.dotsPerModule).toBe(3);
    const forcedHigh = await planQRCode(LABEL_DATA, { widthMm: 20, dpi: 203, ecLevel: "H" });
    expect(forcedHigh).toMatchObject({ suitable: false, ecLevel: null, geometry: null, barcode: null, printSvg: null });
    const diagnostic = forcedHigh.diagnostics.find((item) => item.code === "insufficient-space")!;
    expect(diagnostic.minimumWidthMm).toBeGreaterThan(20);
    expect(forcedHigh.candidates[0]!.geometry.dotsPerModule).toBe(2);
    const wider = await planQRCode(LABEL_DATA, { widthMm: diagnostic.minimumWidthMm!, dpi: 203, ecLevel: "H" });
    expect(wider.suitable).toBe(true);
    expect(wider.geometry?.dotsPerModule).toBe(3);
    const custom = await planQRCode(LABEL_DATA, { widthMm: 20, dpi: 203, ecLevel: "H", minDotsPerModule: 2 });
    expect(custom.suitable).toBe(true);
    expect(custom.ecLevel).toBe("H");
  });

  it("honors explicit ECC and the automatic minimum floor", async () => {
    const low = await planQRCode("Hi!", { widthMm: 20, dpi: 203, ecLevel: "L" });
    expect(low.ecLevel).toBe("L");
    expect(low.candidates.map((candidate) => candidate.ecLevel)).toEqual(["L"]);
    const floor = await planQRCode(LABEL_DATA, { widthMm: 30, dpi: 203, minEcLevel: "Q" });
    expect(floor.candidates.map((candidate) => candidate.ecLevel)).toEqual(["Q", "H"]);
    expect(floor.ecLevel).toBe("H");
    await expect(planQRCode("Hi!", { widthMm: 20, dpi: 203, ecLevel: "M", minEcLevel: "H" }))
      .rejects.toMatchObject({ code: "bad-request" });
  });

  it("round trips exact Unicode and whitespace through the final real raster", async () => {
    const data = "  Café e\u0301 — 東京 🌍\nhttps://example.com/a?b=%2F&c=+  ";
    const plan = await planQRCode(data, { widthMm: 35, dpi: 300, ecLevel: "Q" });
    expect(plan.suitable).toBe(true);
    if (!plan.suitable) throw new Error("Expected a suitable Unicode label");
    expect(plan.barcode.data).toBe(data);
    expect(plan.barcode.png).not.toBeNull();
    const png = new Uint8Array(await plan.barcode.png!.arrayBuffer());
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(header.getUint32(16)).toBe(plan.geometry.widthDots);
    expect(header.getUint32(20)).toBe(plan.geometry.widthDots);
    const [decoded] = await scan(png, { symbologies: ["qr"] });
    expect(decoded!.data).toBe(data);
    expect(new Uint8Array(Buffer.from(decoded!.rawBytes, "base64"))).toEqual(new TextEncoder().encode(data));
    expect(decoded!.ecLevel).toBe("Q");
    expect(plan.printSvg).toContain(`width="${plan.geometry.widthMm}mm"`);
    expect(plan.printSvg).toContain(`height="${plan.geometry.widthMm}mm"`);
    expect(plan.printSvg).toContain(`viewBox="0 0 ${plan.geometry.widthDots} ${plan.geometry.widthDots}"`);
    expect(plan.barcode.svg).toContain(`width="${plan.geometry.widthDots}"`);
  });

  it("does not round up a genuinely undersized label or render zero-scale candidates", async () => {
    const exactDots = 29 * 3;
    const exact = await planQRCode("Hi!", { widthMm: exactDots * 25.4 / 203, dpi: 203 });
    expect(exact.suitable).toBe(true);
    expect(exact.geometry?.widthDots).toBe(exactDots);
    const below = await planQRCode("Hi!", { widthMm: (exactDots - 0.001) * 25.4 / 203, dpi: 203 });
    expect(below.suitable).toBe(false);
    const generateSpy = vi.spyOn(generator, "generate");
    const tiny = await planQRCode("Hi!", { widthMm: 1, dpi: 203 });
    expect(tiny.suitable).toBe(false);
    expect(tiny.candidates.every((candidate) => candidate.geometry.dotsPerModule === 0)).toBe(true);
    expect(generateSpy.mock.calls.every(([, options]) => options?.scale === 1)).toBe(true);
  });

  it("returns capacity diagnostics without discarding payload or claiming a fit", async () => {
    const data = "a".repeat(4000);
    const plan = await planQRCode(data, { widthMm: 100, dpi: 300 });
    expect(plan.suitable).toBe(false);
    expect(plan.barcode).toBeNull();
    expect(plan.candidates).toEqual([]);
    expect(plan.diagnostics.filter((diagnostic) => diagnostic.code === "encoding-failed")).toHaveLength(3);
    expect(plan.diagnostics.find((diagnostic) => diagnostic.code === "insufficient-space")!.minimumWidthMm).toBeUndefined();
  });

  it("rejects malformed input and unbounded allocations before encoding", async () => {
    const generateSpy = vi.spyOn(generator, "generate");
    const valid: QRCodePlanOptions = { widthMm: 20, dpi: 203 };
    const invalidOptions: unknown[] = [
      undefined, null, {},
      ...[0, -1, NaN, Infinity, 1001, "20", null].map((widthMm) => ({ ...valid, widthMm })),
      ...[0, -1, NaN, Infinity, 9601, "203", null].map((dpi) => ({ ...valid, dpi })),
      ...[0, -1, NaN, Infinity, 2049, 1.5, "3", null].map((minDotsPerModule) => ({ ...valid, minDotsPerModule })),
      { widthMm: 0.01, dpi: 203 }, { widthMm: 1000, dpi: 9600 },
      { ...valid, ecLevel: "Z" }, { ...valid, ecLevel: null }, { ...valid, minEcLevel: "auto" },
    ];
    for (const options of invalidOptions) {
      await expect(planQRCode("Hi!", options as QRCodePlanOptions)).rejects.toMatchObject({ code: "bad-request" });
    }
    for (const data of ["", "1".repeat(7090), "界".repeat(3000), "\ud800", "\udc00", 123, null]) {
      await expect(planQRCode(data as string, valid)).rejects.toMatchObject({ code: "bad-request" });
    }
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("rejects a leading BOM before the writer can silently discard it", async () => {
    const generateSpy = vi.spyOn(generator, "generate");
    await expect(planQRCode("\ufeffABC", { widthMm: 20, dpi: 203 })).rejects.toMatchObject({
      code: "bad-request", message: expect.stringContaining("cannot be preserved"),
    });
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("preserves embedded controls and a trailing BOM as exact encoded bytes", async () => {
    const data = "ABC\u0000\u001d\u001e\u007f\ufeff";
    const plan = await planQRCode(data, { widthMm: 20, dpi: 203 });
    expect(plan.suitable).toBe(true);
    if (!plan.suitable) throw new Error("Expected a suitable control-character code");
    const [decoded] = await scan(new Uint8Array(await plan.barcode.png!.arrayBuffer()), { symbologies: ["qr"] });
    expect(new Uint8Array(Buffer.from(decoded!.rawBytes, "base64"))).toEqual(new TextEncoder().encode(data));
  });

  it("propagates engine failures instead of mislabeling them as size problems", async () => {
    const error = new QRGenError("engine-load-failed", "Offline engine is unavailable");
    vi.spyOn(generator, "generate").mockRejectedValue(error);
    await expect(planQRCode("Hi!", { widthMm: 20, dpi: 203 })).rejects.toBe(error);
  });

  it("rejects unexpected encoder rendering dimensions", async () => {
    const barcode = await generator.generate("Hi!", { ecLevel: "M", scale: 1 });
    vi.spyOn(generator, "generate").mockResolvedValue({ ...barcode, svg: barcode.svg.replace('width="29"', 'width="28"') });
    await expect(planQRCode("Hi!", { widthMm: 20, dpi: 203 })).rejects.toMatchObject({ code: "unknown" });
  });

  it.each(["", 'viewBox="0 0 28 29"'])("rejects an SVG viewBox unsuitable for physical resizing: %s", async (viewBox) => {
    const barcode = await generator.generate("Hi!", { ecLevel: "M", scale: 1 });
    vi.spyOn(generator, "generate").mockResolvedValue({ ...barcode, svg: barcode.svg.replace('viewBox="0 0 29 29"', viewBox) });
    await expect(planQRCode("Hi!", { widthMm: 20, dpi: 203 })).rejects.toMatchObject({ code: "unknown" });
  });

  it("rejects a final encode that changes the symbol geometry", async () => {
    const probe = await generator.generate("Hi!", { ecLevel: "M", scale: 1 });
    const changed = { ...probe, matrix: { ...probe.matrix, width: 25, height: 25 } };
    vi.spyOn(generator, "generate").mockResolvedValueOnce(probe).mockResolvedValueOnce(changed);
    await expect(planQRCode("Hi!", { widthMm: 20, dpi: 203, ecLevel: "M" })).rejects.toMatchObject({
      code: "unknown", message: expect.stringContaining("changed the planned"),
    });
  });
});
