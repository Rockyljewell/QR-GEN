// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

// Synthetic image benchmark, not a physical camera or vendor parity benchmark.
// Build the SDK first. Usage: node scripts/benchmark-scanning.mjs [output.json]
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { generatePNG, scan, SYMBOLOGIES } from "../packages/sdk/dist/node.js";

const ids = ["qr", "data-matrix", "pdf417", "ean13", "code128", "databar"];
const sdkPackage = JSON.parse(readFileSync(new URL("../packages/sdk/package.json", import.meta.url), "utf8"));
const variants = [
  { name: "normal", foreground: "#000000", background: "#ffffff" },
  { name: "lower-contrast", foreground: "#555555", background: "#bbbbbb" },
  { name: "inverted", foreground: "#ffffff", background: "#000000" },
];
// Exclude engine initialization from warm decode timings.
await scan(new Uint8Array(await generatePNG("benchmark-warmup")));
const cases = [];
for (const symbology of ids) {
  const data = SYMBOLOGIES.find((s) => s.id === symbology).example;
  for (const rotate of [0, 90, 180, 270]) for (const variant of variants) {
    const { name, ...colors } = variant;
    const image = new Uint8Array(await generatePNG(data, {
      symbology, rotate, scale: 4, gs1: data.startsWith("("), ...colors,
    }));
    const start = performance.now();
    const barcodes = await scan(image, { symbologies: [symbology] });
    const decodeMs = performance.now() - start;
    const exact = barcodes.length === 1 && barcodes[0].symbology === symbology && barcodes[0].data === data;
    // QRGen's explicit raster fallback supports every generated PNG case,
    // including formats the upstream engine does not invert on its own.
    const expectedSupported = true;
    cases.push({ symbology, rotate, variant: name, expectedSupported, exact, decodeMs: Number(decodeMs.toFixed(3)), detections: barcodes.length });
  }
}
const times = cases.map((c) => c.decodeMs).sort((a, b) => a - b);
const percentile = (p) => times[Math.ceil(times.length * p) - 1];
const report = {
  schemaVersion: 1,
  scope: "Generated images only; does not measure camera capture, AR tracking, damaged labels, or Scandit parity.",
  environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model, engine: `zxing-wasm ${sdkPackage.dependencies["zxing-wasm"]}` },
  summary: {
    total: cases.length, exact: cases.filter((c) => c.exact).length,
    supportedCases: cases.filter((c) => c.expectedSupported).length,
    supportedExact: cases.filter((c) => c.expectedSupported && c.exact).length,
    p50DecodeMs: percentile(0.5), p95DecodeMs: percentile(0.95),
  },
  cases,
};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary));
for (const c of cases.filter((c) => !c.exact)) console.log(`miss: ${c.symbology} rotate=${c.rotate} variant=${c.variant}`);
if (report.summary.supportedExact !== report.summary.supportedCases) process.exitCode = 1;
