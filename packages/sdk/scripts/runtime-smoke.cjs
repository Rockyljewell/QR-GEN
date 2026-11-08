// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("The built SDK smoke must use local engine assets.");
};
process.once("exit", () => {
  if (networkAttempts) {
    console.error(`SDK smoke rejected ${networkAttempts} fetch attempt(s).`);
    process.exitCode = 1;
  }
});

async function smoke() {
  const cases = [
    ["qr", " 00123 caf\u00e9 \u96ea \ud83d\ude42 "],
    ["ean13", "0012345678905"],
    ["data-matrix", "MIN-RUNTIME-DM-00123"],
    ["code128", "MIN-RUNTIME-128-00123"],
  ];
  const entries = [["ESM", await import("qrgen-sdk/node")], ["CommonJS", require("qrgen-sdk/node")]];
  const retained = [];
  for (const [entry, api] of entries) for (const [symbology, data] of cases) {
    const png = await api.generatePNG(data, { symbology, scale: 4 });
    const found = await api.scanImage(png, { symbologies: [symbology], tryInvert: false });
    assert.equal(found.length, 1, `${entry}: ${symbology}`);
    const barcode = found[0];
    assert.equal(barcode.data, data);
    assert.equal(barcode.symbology, symbology);
    assert.deepEqual(barcode.frameSize, { width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
    assert.deepEqual(Buffer.from(barcode.rawBytes, "base64"), Buffer.from(data, "utf8"));
    if (symbology === "qr") retained.push({ barcode, snapshot: structuredClone(barcode), png, pngSnapshot: Buffer.from(png) });
  }
  for (const { barcode, snapshot, png, pngSnapshot } of retained) {
    assert.deepEqual(barcode, snapshot);
    assert.deepEqual(png, pngSnapshot);
  }
  assert.equal(networkAttempts, 0);
  console.log(`Built SDK smoke passed on ${process.version}: ESM + CommonJS, ${cases.length} formats each.`);
}

// Run API checks directly, or preload only the fetch guard for the actual CLI.
if (require.main === module) smoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
