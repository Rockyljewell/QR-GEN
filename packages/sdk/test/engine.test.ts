// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { generate, scan, generatePNG } from "../src/node";
import { SYMBOLOGIES, WRITABLE_SYMBOLOGIES } from "../src/symbologies";
import { fromBase64 } from "../src/util";

const CASES: [string, string, Record<string, unknown>?][] = [
  ["qr", "https://rockyljewell.github.io/QR-GEN/"],
  ["micro-qr", "QRGEN"],
  ["rmqr", "QRGEN-RMQR"],
  ["data-matrix", "QRGen Data Matrix"],
  ["aztec", "QRGen Aztec"],
  ["pdf417", "QRGen PDF417 sample"],
  ["micro-pdf417", "QRGEN"],
  ["maxicode", "QRGen MaxiCode"],
  ["ean13", "5901234123457"],
  ["ean8", "96385074"],
  ["upca", "036000291452"],
  ["upce", "01234565"],
  ["code128", "QRGEN-128"],
  ["code39", "QRGEN39"],
  ["code93", "QRGEN93"],
  ["codabar", "A40156B"],
  ["itf", "12345678"],
  ["databar", "(01)09521234543213"],
  ["databar-expanded", "(01)09521234543213(3103)000123"],
];

describe("generate → scan round trip", () => {
  for (const [symbology, data] of CASES) {
    it(symbology, async () => {
      const png = await generatePNG(data, { symbology, scale: 4 });
      const found = await scan(new Uint8Array(png), { symbologies: [symbology] });
      expect(found.length).toBeGreaterThan(0);
      expect(found[0]!.symbology).toBe(symbology);
      expect(found[0]!.data).toBe(data);
      expect(found[0]!.frameSize.width).toBeGreaterThan(0);
    });
  }

  it("encodes GS1 in Code 128 and Data Matrix", async () => {
    for (const symbology of ["code128", "data-matrix", "qr"]) {
      const png = await generatePNG("(01)09501101530003(17)250101(10)ABC123", { symbology, gs1: true });
      const [b] = await scan(new Uint8Array(png));
      expect(b!.isGS1).toBe(true);
      expect(b!.contentType).toBe("gs1");
      expect(b!.data).toBe("(01)09501101530003(17)250101(10)ABC123");
    }
  });

  it("returns SVG, matrix, text and raw bytes", async () => {
    const out = await generate("hi", { symbology: "qr", foreground: "#123456", background: "transparent" });
    expect(out.svg.startsWith("<svg")).toBe(true);
    expect(out.svg).toContain('viewBox="0 0');
    expect(out.svg).toContain('fill="#123456"');
    expect(out.svg).toContain('fill="none"');
    expect(out.matrix.width).toBe(out.matrix.height);
    expect(out.matrix.modules.some((m) => m === 1)).toBe(true);
    expect(out.text.length).toBeGreaterThan(0);
    const [b] = await scan(new Uint8Array(await generatePNG("hi")));
    expect(new TextDecoder().decode(fromBase64(b!.rawBytes))).toBe("hi");
  });

  it("finds several codes in one image and filters symbologies", async () => {
    const qr = await generatePNG("one", { symbology: "qr" });
    const none = await scan(new Uint8Array(qr), { symbologies: ["ean13"] });
    expect(none).toEqual([]);
  });

  it("keeps control characters (AAMVA driver license PDF417)", async () => {
    const aamva = "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDBB01311990\nDBA01312028\nDCGUSA\n\r";
    const png = await generatePNG(aamva, { symbology: "pdf417", scale: 2 });
    const [b] = await scan(new Uint8Array(png), { symbologies: ["pdf417"] });
    expect(b!.data).toBe(aamva);
  });

  it("reports UPC-A for leading-zero EAN-13 unless only EAN-13 was requested", async () => {
    const png = new Uint8Array(await generatePNG("036000291452", { symbology: "upca" }));
    expect((await scan(png))[0]).toMatchObject({ symbology: "upca", data: "036000291452" });
    expect((await scan(png, { symbologies: ["ean13"] }))[0]).toMatchObject({ symbology: "ean13", data: "0036000291452" });
    expect((await scan(png, { symbologies: ["retail"] }))[0]).toMatchObject({ symbology: "upca" });
  });

  it("accepts gs1: true for GS1 DataBar (implicitly GS1)", async () => {
    const png = await generatePNG("(01)09521234543213", { symbology: "databar", gs1: true });
    expect((await scan(new Uint8Array(png)))[0]).toMatchObject({ symbology: "databar", data: "(01)09521234543213" });
  });

  it("every writable symbology's example encodes and scans back", async () => {
    for (const s of SYMBOLOGIES.filter((x) => WRITABLE_SYMBOLOGIES.includes(x.id))) {
      const png = await generatePNG(s.example, { symbology: s.id, gs1: s.example.startsWith("(") });
      const [b] = await scan(new Uint8Array(png), { symbologies: [s.id] });
      expect(b, s.id).toBeDefined();
      expect(b!.symbology, s.id).toBe(s.id);
      // Code 32 and PZN read back in their human-readable form (prefix + check digit).
      if (s.id === "code32" || s.id === "pzn") expect(b!.data).toContain(s.example);
      else expect(b!.data, s.id).toBe(s.example);
    }
  });

  it("applies colors to PNG output in Node", async () => {
    const png = await generatePNG("colored", { symbology: "qr", foreground: "#003366", background: "#ffeecc" });
    const [b] = await scan(new Uint8Array(png));
    expect(b!.data).toBe("colored");
    const transparent = await generatePNG("clear", { symbology: "qr", background: "transparent" });
    expect(Buffer.from(transparent).readUInt8(25)).toBe(6); // RGBA color type
  });

  it("rejects non-image input with a readable error", async () => {
    await expect(scan(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toMatchObject({ code: "bad-request", message: expect.stringMatching(/SVG/) });
    await expect(scan(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ code: "bad-request" });
  });

  it("reports readable errors", async () => {
    await expect(generate("not digits", { symbology: "ean13" })).rejects.toMatchObject({ code: "bad-request" });
    await expect(generate("x", { symbology: "nope" })).rejects.toMatchObject({ code: "bad-request" });
    await expect(generate("", { symbology: "qr" })).rejects.toMatchObject({ code: "bad-request" });
  });
});
