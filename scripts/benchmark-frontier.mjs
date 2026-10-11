// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

// Synthetic Chromium camera experiment; not physical-camera reliability evidence.
// Build the repository first, then: node scripts/benchmark-frontier.mjs [output.json]
// Optional: E2E_BASE_URL, CHROMIUM_PATH, FRONTIER_BENCHMARK_MS (2000..4000).
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, release, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { generate } from "../packages/sdk/dist/node.js";
import { writeFakeCamera } from "../site/scripts/fake-camera.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const siteRequire = createRequire(join(site, "package.json"));
const base = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:4331/QR-GEN/");
if (!base.pathname.endsWith("/")) base.pathname += "/";
const durationMs = Number(process.env.FRONTIER_BENCHMARK_MS ?? 3000);
if (!Number.isInteger(durationMs) || durationMs < 2000 || durationMs > 4000) {
  throw new Error("FRONTIER_BENCHMARK_MS must be an integer between 2000 and 4000.");
}
const output = resolve(root, process.argv[2] ?? "docs/frontier-benchmark-2026-10-11.json");
const temporary = mkdtempSync(join(tmpdir(), "qrgen-frontier-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let server;
let serverLog = "";
let browserVersion;

async function startServer() {
  if (process.env.E2E_BASE_URL) return;
  const bin = join(dirname(siteRequire.resolve("astro/package.json")), "bin", "astro.mjs");
  server = spawn(process.execPath, [bin, "preview", "--port", "4331", "--host", "127.0.0.1", "--ignore-lock"], {
    cwd: site, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.on("error", (err) => { serverLog += `\n${err.message}`; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverLog = (serverLog + data).slice(-4000); });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Still starting. */ }
    if (server.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Astro preview did not start. Run the repository build first.\n${serverLog}`);
}

const sceneSize = { width: 1280, height: 720, frames: 6 };
const scenarios = [
  {
    id: "large-easy-qr", description: "Large, high-contrast standard QR code.",
    codes: [{ data: "https://qrgen.example/frontier/easy", symbology: "qr", x: 440, y: 170, module: 8 }],
  },
  {
    id: "tiny-dense-qr", description: "Dense QR payload at two source pixels per module, away from the frame center.",
    codes: [{ data: "https://qrgen.example/dense?data=" + "0123456789abcdefghijklmnopqrstuvwxyz".repeat(8), symbology: "qr", x: 105, y: 115, module: 2 }],
  },
  {
    id: "inverted-linear", description: "White-on-black Code 128 with a dark quiet zone.",
    codes: [{ data: "QRGEN-INVERTED-128", symbology: "code128", x: 230, y: 310, module: 3, inverted: true }],
  },
  { id: "blank", description: "Uniform gray frame; any detection is unexpected.", codes: [] },
];

async function runCase(videoPath, scenario, adaptive) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${videoPath}`],
  });
  browserVersion ??= browser.version();
  const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
  const pageErrors = [];
  const blockedExternalRequests = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const harness = new URL("__qrgen_frontier_benchmark__", base).href;
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === harness) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><title>QRGen synthetic capture benchmark</title></body></html>" });
    if (new URL(url).origin !== base.origin) {
      blockedExternalRequests.push(url);
      return route.abort();
    }
    return route.continue();
  });
  try {
    await page.goto(harness);
    const result = await page.evaluate(async ({ sdkUrl, wasmBaseUrl, expected, adaptive, durationMs }) => {
      const sdk = await import(sdkUrl);
      sdk.configure({ wasmBaseUrl, worker: true });
      const video = document.createElement("video");
      video.style.cssText = "width:640px;height:360px";
      document.body.append(video);
      const scanner = new sdk.BarcodeScanner({
        video, symbologies: ["qr", "code128"], mode: "continuous", duplicateFilter: 0,
        beep: false, vibrate: false, resolution: "hd", maxDecodeSize: 1280, maxFps: 24, adaptive,
      });
      const inputs = [];
      const samples = [];
      const errors = [];
      // Record actual captured decoder input for both policies, including fixed
      // capture, which deliberately does not expose adaptive diagnostics.
      const contexts = [globalThis.OffscreenCanvasRenderingContext2D, globalThis.CanvasRenderingContext2D].filter(Boolean);
      const restorers = contexts.map((Context) => {
        const original = Context.prototype.getImageData;
        Context.prototype.getImageData = function (...args) {
          const image = original.apply(this, args);
          inputs.push({ width: image.width, height: image.height });
          return image;
        };
        return () => { Context.prototype.getImageData = original; };
      });
      const start = performance.now();
      let ready = null;
      let firstExact = null;
      let measurementStart;
      const expectedKeys = expected.map((code) => `${code.symbology}\u0000${code.data}`);
      scanner.on("error", (err) => errors.push({ code: err.code, message: err.message }));
      scanner.on("ready", () => { ready = performance.now(); });
      scanner.on("frame", ({ barcodes, decodeMs }) => {
        if (inputs.length !== 1) errors.push({ code: "benchmark-input-accounting", message: `Expected one captured input for an accepted frame; found ${inputs.length}.` });
        const input = inputs.pop();
        inputs.length = 0;
        const keys = barcodes.map((code) => `${code.symbology}\u0000${code.data}`);
        const exact = expectedKeys.length > 0 && expectedKeys.every((key) => keys.includes(key));
        if (exact && firstExact === null) firstExact = performance.now();
        const diagnostics = scanner.stats.adaptive;
        samples.push({
          // The public frame timing includes capture and async decoder latency.
          captureAndDecodeMs: decodeMs, input, exact,
          detections: keys.length, unexpectedDetections: keys.filter((key) => !expectedKeys.includes(key)).length,
          adaptive: diagnostics ? { ...diagnostics } : null,
        });
      });
      try {
        await scanner.start();
        measurementStart = performance.now();
        const camera = { width: video.videoWidth, height: video.videoHeight };
        const track = scanner.camera.track?.getSettings();
        await new Promise((done) => setTimeout(done, durationMs));
        const elapsedMs = performance.now() - measurementStart;
        const state = scanner.state;
        const engine = scanner.stats.engine;
        scanner.stop();
        return {
          camera, track: { width: track?.width, height: track?.height, frameRate: track?.frameRate },
          engine, stateAtEnd: state, observationDurationMs: elapsedMs,
          startupMs: measurementStart - start,
          firstExactFromStartMs: firstExact === null ? null : firstExact - start,
          firstExactFromReadyMs: firstExact === null || ready === null ? null : firstExact - ready,
          samples, errors, unacceptedCapturedFramesAtStop: inputs.length,
        };
      } finally {
        scanner.destroy();
        for (const restore of restorers) restore();
        video.remove();
      }
    }, {
      sdkUrl: new URL("sdk/qrgen.js", base).href, wasmBaseUrl: new URL("sdk/wasm/", base).href,
      expected: scenario.codes, adaptive, durationMs,
    });
    return { policy: adaptive ? "adaptive" : "fixed", ...result, pageErrors, blockedExternalRequests };
  } finally {
    await browser.close();
  }
}

const rounded = (value) => value === null ? null : Math.round(value * 1000) / 1000;
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return rounded(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]);
}
function summarize(run) {
  const timings = run.samples.map((sample) => sample.captureAndDecodeMs);
  const inputs = run.samples.filter((sample) => sample.input).map((sample) => sample.input);
  return {
    acceptedFrames: run.samples.length, exactFrames: run.samples.filter((sample) => sample.exact).length,
    exactPayloadObserved: run.samples.some((sample) => sample.exact),
    unexpectedDetections: run.samples.reduce((count, sample) => count + sample.unexpectedDetections, 0),
    firstExactFromStartMs: rounded(run.firstExactFromStartMs), firstExactFromReadyMs: rounded(run.firstExactFromReadyMs),
    captureAndDecodeP50Ms: percentile(timings, 0.5), captureAndDecodeP95Ms: percentile(timings, 0.95),
    adaptiveDecoderP50Ms: percentile(run.samples.flatMap((sample) => sample.adaptive ? [sample.adaptive.decodeMs] : []), 0.5),
    adaptiveDecoderP95Ms: percentile(run.samples.flatMap((sample) => sample.adaptive ? [sample.adaptive.decodeMs] : []), 0.95),
    discoveryFrames: run.samples.filter((sample) => sample.adaptive?.phase === "discovery").length,
    inputSizes: [...new Set(inputs.map((input) => `${input.width}x${input.height}`))],
    meanInputPixels: inputs.length ? rounded(inputs.reduce((total, input) => total + input.width * input.height, 0) / inputs.length) : null,
  };
}

process.on("exit", () => server?.kill());
try {
  await startServer();
  const sdkBytes = Buffer.from(await (await fetch(new URL("sdk/qrgen.js", base))).arrayBuffer());
  const builtSdkBytes = readFileSync(join(root, "packages/sdk/dist/browser/qrgen.js"));
  if (sha256(sdkBytes) !== sha256(builtSdkBytes)) throw new Error("Served SDK differs from the current SDK build; rebuild the site or use the matching E2E_BASE_URL.");
  const wasmBytes = Buffer.from(await (await fetch(new URL("sdk/wasm/zxing_reader.wasm", base))).arrayBuffer());
  const builtWasmBytes = readFileSync(join(root, "packages/sdk/dist/wasm/zxing_reader.wasm"));
  if (sha256(wasmBytes) !== sha256(builtWasmBytes)) throw new Error("Served reader WASM differs from the local SDK build; rebuild the site or use the matching E2E_BASE_URL.");
  const results = [];
  for (const scenario of scenarios) {
    const videoPath = join(temporary, `${scenario.id}.y4m`);
    const geometry = [];
    for (const code of scenario.codes) {
      const generated = await generate(code.data, { symbology: code.symbology, scale: 1 });
      geometry.push({ ...code, matrixWidth: generated.matrix.width, matrixHeight: generated.matrix.height });
    }
    await writeFakeCamera(videoPath, scenario.codes, sceneSize);
    const runs = [];
    // Fresh browser per run; alternate order to reduce a consistent ordering bias.
    const order = results.length % 2 ? [true, false] : [false, true];
    for (const adaptive of order) {
      const run = await runCase(videoPath, scenario, adaptive);
      run.summary = summarize(run);
      runs.push(run);
      console.log(`${scenario.id} ${run.policy}: exact=${run.summary.exactPayloadObserved}, frames=${run.summary.acceptedFrames}, p50=${run.summary.captureAndDecodeP50Ms}ms, discovery=${run.summary.discoveryFrames}`);
    }
    results.push({ id: scenario.id, description: scenario.description, scene: { ...sceneSize, codes: geometry }, runs });
  }
  const pkg = JSON.parse(readFileSync(join(root, "packages/sdk/package.json"), "utf8"));
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), experiment: "synthetic-full-frame-adaptive-capture",
    environment: {
      node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model,
      chromium: browserVersion, sdkVersion: pkg.version, engine: `zxing-wasm ${pkg.dependencies["zxing-wasm"]}`,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
      workingTreeChangesPresent: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
      servedSdkSha256: sha256(sdkBytes), readerWasmSha256: sha256(wasmBytes), localWasm: true,
    },
    settings: { observationDurationMs: durationMs, maxDecodeSize: 1280, maxFps: 24, symbologies: ["qr", "code128"], tryInvert: "alternate", adaptive: "SDK defaults; explicit opt-in" },
    limits: [
      "Static generated Y4M camera frames in desktop Chromium; no physical labels, phone cameras, motion, glare, damaged codes or autofocus.",
      "One short run per policy per scene; these timings are exploratory and include browser scheduling noise, not statistically established improvements.",
      "Time to first exact result from start includes cold camera/worker/WASM initialization; the separate ready-relative timing excludes those startup steps.",
      "Comparable frame timing includes canvas capture and asynchronous decoder latency. Decoder-only timings are reported only for adaptive diagnostics and must not be compared with fixed frame timings.",
      "All expected payloads are synthetic. Blank-frame detections are counted, but a short blank run cannot establish a real-world false-positive rate.",
      "Actual accepted decoder-input dimensions are instrumented in the page; any frame still in flight at stop is excluded from accepted-frame metrics.",
    ],
    scenarios: results,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Saved ${output}`);
  if (results.some((scenario) => scenario.runs.some((run) => run.errors.length || run.pageErrors.length || run.blockedExternalRequests.length || !run.samples.length || run.stateAtEnd !== "scanning" || run.summary.unexpectedDetections))) process.exitCode = 1;
} finally {
  server?.kill();
  // Verify the exact freshly-created directory before any recursive deletion.
  const cleanup = resolve(temporary);
  if (dirname(cleanup) !== resolve(tmpdir()) || !basename(cleanup).startsWith("qrgen-frontier-")) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${cleanup}`);
  }
  rmSync(cleanup, { recursive: true, force: true });
}
