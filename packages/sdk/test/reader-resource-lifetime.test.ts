// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";
import { PNG } from "pngjs";
import { prepareZXingModule } from "zxing-wasm/reader";
import { generatePNG, scanImage } from "../src/node";

it("releases native reader results after success, empty reads and conversion failure", async () => {
  const payload = "QRGEN-READER-RESOURCE-LIFETIME";
  const options = { symbologies: "qr", tryInvert: false };
  const png = await generatePNG(payload, { symbology: "qr", scale: 4 });
  const blank = new PNG({ width: 32, height: 32 });
  blank.data.fill(255);

  // Warm the public SDK first so its exact reader overrides own the module cache.
  expect(await scanImage(png, options)).toMatchObject([{ data: payload }]);
  const native = await prepareZXingModule({ fireImmediately: true });
  const originalRead = native.readBarcodesFromImage;
  const failure = new Error("Controlled native result conversion failure");
  let created = 0, deleted = 0;
  let failConversion = false;
  const read: typeof originalRead = (...args) => {
    // The runtime delete method also exists in 3.1.5, before its type declaration.
    const vector = originalRead.apply(native, args) as ReturnType<typeof originalRead> & { delete(): void };
    created++;
    const destroy = vector.delete.bind(vector);
    vector.delete = () => { deleted++; destroy(); };
    const get = vector.get.bind(vector);
    vector.get = (index) => {
      const result = get(index);
      if (failConversion) {
        // Keep the real native read; inject only the result-conversion failure.
        expect(result?.text).toBe(payload);
        throw failure;
      }
      return result;
    };
    return vector;
  };
  native.readBarcodesFromImage = read;
  try {
    const first = await scanImage(png, options);
    expect(first).toMatchObject([{ data: payload, symbology: "qr" }]);
    expect(Buffer.from(first[0]!.rawBytes, "base64").toString("utf8")).toBe(payload);
    const saved = structuredClone(first);
    expect(await scanImage(PNG.sync.write(blank), options)).toEqual([]);
    failConversion = true;
    const rejected = await scanImage(png, options).then(() => undefined, (error: unknown) => error);
    expect((rejected as { cause?: unknown } | undefined)?.cause).toBe(failure);
    expect(native.readBarcodesFromImage).toBe(read);
    expect(created).toBe(3);
    expect(deleted).toBe(3);
    expect(first).toEqual(saved);
    expect(await prepareZXingModule({ fireImmediately: true })).toBe(native);
  } finally {
    native.readBarcodesFromImage = originalRead;
  }
});
