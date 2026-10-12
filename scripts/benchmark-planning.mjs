// Repeatable print-geometry experiment; generated pixels are not physical labels.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { planQRCode, scan } from "../packages/sdk/dist/node.js";

const cases = [];
const prefix = "https://example.org/item?ref=";
for (const bytes of [60, 120, 240]) {
  const data = prefix + "x".repeat(bytes - prefix.length);
  for (const widthMm of [20, 30]) for (const dpi of [203, 300]) for (const ecLevel of ["auto", "H"]) {
    const plan = await planQRCode(data, { widthMm, dpi, ecLevel });
    let exactText = null;
    let exactBytes = null;
    if (plan.suitable) {
      if (!plan.barcode.png) throw new Error("Suitable plan produced no PNG.");
      const found = await scan(new Uint8Array(await plan.barcode.png.arrayBuffer()), { symbologies: ["qr"] });
      exactText = found.length === 1 && found[0].data === data;
      exactBytes = found.length === 1 && Buffer.from(found[0].rawBytes, "base64").equals(Buffer.from(data, "utf8"));
      if (!exactText || !exactBytes) throw new Error(`Payload changed: ${JSON.stringify({ bytes, widthMm, dpi, ecLevel })}`);
    }
    cases.push({ bytes, widthMm, dpi, requestedEcLevel: ecLevel, suitable: plan.suitable,
      selectedEcLevel: plan.ecLevel, geometry: plan.geometry, exactText, exactBytes,
      candidates: plan.candidates.map((candidate) => ({ ecLevel: candidate.ecLevel, suitable: candidate.suitable,
        dotsPerModule: candidate.geometry.dotsPerModule, symbolModules: candidate.geometry.symbolModules,
        minimumWidthMm: candidate.minimumWidthMm })),
      diagnostics: plan.diagnostics.map(({ code, minimumWidthMm }) => ({ code, minimumWidthMm })),
    });
  }
}
const hash = (path) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), experiment: "whole-dot-print-planning",
  environment: { node: process.version, platform: platform(), sdkBundleSha256: hash("../packages/sdk/dist/node.js"),
    plannerSourceSha256: hash("../packages/sdk/src/planner.ts"), writerWasmSha256: hash("../packages/sdk/dist/wasm/zxing_writer.wasm") },
  limits: ["ASCII URL payloads only; module counts depend on actual content and encoding mode.",
    "Three printer dots/module is the chosen illustrative profile, not a universal reliability threshold.",
    "Exact text and bytes are checked on the generated PNG using QRGen's reader; printed material and other readers are untested.",
    "Automatic mode maximizes whole dots/module among M/Q/H then chooses strongest correction among ties; explicit H remains exact."],
  summary: { total: cases.length, suitable: cases.filter((item) => item.suitable).length,
    unsuitable: cases.filter((item) => !item.suitable).length,
    exactSuitablePngs: cases.filter((item) => item.suitable && item.exactBytes && item.exactText).length },
  cases,
};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary));
