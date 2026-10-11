// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toBarcode } from "../src/engine/convert";
import type { RawBarcode } from "../src/engine/protocol";

const raw: RawBarcode = {
  format: "QRCodeModel2", text: "scale", bytes: new Uint8Array(), contentType: "Text",
  position: { topLeft: { x: 1, y: 2 }, topRight: { x: 5, y: 2 }, bottomRight: { x: 5, y: 8 }, bottomLeft: { x: 1, y: 8 } },
  orientation: 0, ecLevel: "M", symbologyIdentifier: "]Q1", isMirrored: false, isInverted: false,
};

describe("Decoded region coordinate scales", () => {
  it("keeps existing uniform scale and offsets unchanged", () => {
    const barcode = toBarcode(raw, { frameSize: { width: 100, height: 80 }, scale: 3, offsetX: 10, offsetY: 20 })!;
    expect(barcode.location.topLeft).toEqual({ x: 13, y: 26 });
    expect(barcode.location.bottomRight).toEqual({ x: 25, y: 44 });
  });

  it("maps each rounded raster dimension with its actual scale and preserves mirroring", () => {
    const barcode = toBarcode(raw, { frameSize: { width: 100, height: 80 }, scale: 3, scaleX: 4, scaleY: 2, offsetX: 10, offsetY: 20, mirror: true })!;
    expect(barcode.location.topLeft).toEqual({ x: 86, y: 24 });
    expect(barcode.location.bottomRight).toEqual({ x: 70, y: 36 });
    expect(raw.position.topLeft).toEqual({ x: 1, y: 2 });
  });

  it("falls back to uniform scale for an unspecified axis", () => {
    const barcode = toBarcode(raw, { frameSize: { width: 100, height: 80 }, scale: 3, scaleY: 2 })!;
    expect(barcode.location.topLeft).toEqual({ x: 3, y: 4 });
  });
});
