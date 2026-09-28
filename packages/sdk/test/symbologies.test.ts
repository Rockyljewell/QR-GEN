// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ALL_SYMBOLOGIES, fromZXingFormat, resolveSymbologies, toSymbology, toZXingReadFormats } from "../src/symbologies";

describe("symbologies", () => {
  it("resolves ids, names and aliases case-insensitively", () => {
    expect(toSymbology("QRCode")).toBe("qr");
    expect(toSymbology("qr-code")).toBe("qr");
    expect(toSymbology("QR")).toBe("qr");
    expect(toSymbology("EAN-13")).toBe("ean13");
    expect(toSymbology("Data Matrix")).toBe("data-matrix");
    expect(toSymbology("GS1-128")).toBe("code128");
    expect(toSymbology("rss14")).toBe("databar");
    expect(toSymbology("nope")).toBeUndefined();
  });

  it("expands groups and de-duplicates", () => {
    expect(resolveSymbologies(["retail"])).toEqual(["ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited"]);
    expect(resolveSymbologies("qr, ean13 qr")).toEqual(["qr", "ean13"]);
    expect(resolveSymbologies(["2d"])).toContain("pdf417");
    expect(resolveSymbologies(["1d"])).not.toContain("qr");
  });

  it("defaults to all symbologies and ignores unknown names", () => {
    expect(resolveSymbologies()).toHaveLength(ALL_SYMBOLOGIES.length);
    expect(resolveSymbologies([])).toHaveLength(ALL_SYMBOLOGIES.length);
    expect(resolveSymbologies(["qr", "bogus"])).toEqual(["qr"]);
    expect(resolveSymbologies(["bogus"])).toEqual([]);
  });

  it("maps to and from zxing-cpp formats", () => {
    expect(toZXingReadFormats(["qr"])).toEqual(["QRCodeModel1", "QRCodeModel2"]);
    expect(toZXingReadFormats([...ALL_SYMBOLOGIES])).toEqual([]);
    expect(fromZXingFormat("MicroQRCode")).toBe("micro-qr");
    expect(fromZXingFormat("EAN13")).toBe("ean13");
    expect(fromZXingFormat("DataBarExpStk")).toBe("databar-expanded");
    expect(fromZXingFormat("ITF14")).toBe("itf14");
  });
});
