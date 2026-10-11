// Browser lifecycle and continuous-decoding stress check. Build the SDK/site first.
// npm run test:stress
// E2E_BASE_URL=https://example.com/QR-GEN/  use an existing deployment instead of preview
// CHROMIUM_PATH=/path/to/chrome           use a specific Chromium binary
// STRESS_SOAK_SECONDS=180                 continuous scanning duration (integer >= 1)
// STRESS_OUTPUT_PATH=/path/to/result.json  default: docs/browser-stress-YYYY-MM-DD.json
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { writeFakeCamera } from "./fake-camera.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4330/QR-GEN/";
const soakSeconds = Number(process.env.STRESS_SOAK_SECONDS ?? 180);
if (!Number.isSafeInteger(soakSeconds) || soakSeconds < 1) throw new Error("STRESS_SOAK_SECONDS must be an integer >= 1");
const started = new Date().toISOString();
const output = resolve(process.env.STRESS_OUTPUT_PATH ?? join(scriptDir, "../../docs", `browser-stress-${started.slice(0, 10)}.json`));
const tempRoot = resolve(tmpdir());
const temp = mkdtempSync(join(tempRoot, "qrgen-stress-"));
const fixture = join(temp, "camera.y4m");
const expectedPayload = "QRGEN-SCANDIT-SMOKE-20261011";
const phases = [], pageErrors = [], consoleErrors = [];
let server, serverLog = "", browser, page, sdkAsset, fixtureSha256;
let status = "running", completedAt = null;

function save() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({
    schemaVersion: 1, started, completedAt, status, baseUrl: base,
    node: process.version, browser: browser?.version(), sdkAsset, fixtureSha256,
    configuration: { startStopCycles: 50, cameraSwitches: 20, pauseResumeCycles: 20, soakSeconds, expectedPayload },
    phases, pageErrors: [...pageErrors], consoleErrors: [...consoleErrors],
    limitations: [
      "Synthetic static feed in desktop headless Chromium; no physical-device, multi-hour, thermal or Scandit parity evidence.",
      "Front/back switching is requested but the fake camera supplies the same input for both.",
      "Worker counts are lifecycle diagnostics, not heap/native-memory measurements; one shared decoder worker may remain cached until browser closure.",
    ],
  }, null, 2) + "\n");
}

async function startServer() {
  if (process.env.E2E_BASE_URL) return;
  const pkg = createRequire(import.meta.url).resolve("astro/package.json");
  const bin = join(dirname(pkg), "bin", "astro.mjs");
  server = spawn(process.execPath, [bin, "preview", "--port", "4330", "--host", "127.0.0.1", "--ignore-lock"], {
    cwd: join(scriptDir, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", (error) => { serverLog += error.message; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverLog = (serverLog + data).slice(-4000); });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(base);
      const ok = response.ok;
      await response.body?.cancel();
      if (ok) return;
    } catch { /* Preview has not started yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Preview server did not start\n${serverLog}`);
}

async function run(name, action) {
  const began = Date.now();
  const result = await action();
  phases.push({ name, durationMs: Date.now() - began, ...result });
  save();
  console.log(`${name}: ${Date.now() - began} ms, ${result.scans ?? result.stopped?.metrics.scans ?? 0} scans`);
}

process.on("exit", () => server?.kill());
try {
  await startServer();
  const sdkUrl = new URL("sdk/qrgen.js", base).href;
  const response = await fetch(sdkUrl);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`SDK asset returned HTTP ${response.status}`);
  }
  const assetBytes = Buffer.from(await response.arrayBuffer());
  sdkAsset = { url: sdkUrl, sha256: createHash("sha256").update(assetBytes).digest("hex"), bytes: assetBytes.length };
  await writeFakeCamera(fixture, [{ data: expectedPayload, symbology: "qr", x: 230, y: 150, module: 6 }]);
  fixtureSha256 = createHash("sha256").update(readFileSync(fixture)).digest("hex");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${fixture}`],
  });
  page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const navigation = await page.goto(new URL("demo/", base).href, { waitUntil: "networkidle" });
  if (!navigation?.ok()) throw new Error(`Demo page returned HTTP ${navigation?.status()}`);
  await page.evaluate(async ({ sdkUrl, expectedPayload }) => {
    const NativeWorker = window.Worker, workers = [], streams = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); workers.push(this); this.__terminated = false; }
      terminate() { this.__terminated = true; return super.terminate(); }
    };
    const media = navigator.mediaDevices, originalGet = media.getUserMedia.bind(media);
    media.getUserMedia = async (...args) => { const stream = await originalGet(...args); streams.push(stream); return stream; };
    const sdk = await import(sdkUrl);
    const video = document.createElement("video");
    video.width = 640; video.height = 480;
    document.body.append(video);
    const scanner = new sdk.BarcodeScanner({ video, symbologies: ["qr"], mode: "continuous", duplicateFilter: 0, beep: false, vibrate: false, maxFps: 24 });
    const metrics = { frames: 0, scans: 0, exactScans: 0, wrongScans: [], scannerErrors: [], stateHistory: [] };
    scanner.on("frame", () => metrics.frames++);
    scanner.on("scan", ({ barcodes }) => {
      metrics.scans++;
      for (const barcode of barcodes) {
        if (barcode.data === expectedPayload) metrics.exactScans++;
        else metrics.wrongScans.push(barcode.data);
      }
    });
    scanner.on("error", (error) => metrics.scannerErrors.push({ code: error.code, message: error.message }));
    scanner.on("state", (state) => metrics.stateHistory.push(state));
    const waitScan = (before, timeout = 5000) => new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (metrics.scans > before) { clearInterval(timer); clearTimeout(expiry); resolve(); }
      }, 10);
      const expiry = setTimeout(() => { clearInterval(timer); reject(new Error(`No fresh scan after ${timeout}ms; state=${scanner.state}`)); }, timeout);
    });
    const resources = () => ({
      state: scanner.state, streams: streams.length,
      activeWorkers: workers.filter((worker) => !worker.__terminated).length,
      liveTracks: streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length,
      attachedStream: video.srcObject !== null,
    });
    // Copy every collection: phase evidence must remain a snapshot, and the
    // current state string must never be overwritten by state-history metrics.
    const snapshot = () => ({
      ...resources(), frames: metrics.frames, scans: metrics.scans, exactScans: metrics.exactScans,
      wrongScans: [...metrics.wrongScans], scannerErrors: metrics.scannerErrors.map((error) => ({ ...error })),
      stateHistory: [...metrics.stateHistory],
    });
    window.__stress = { scanner, metrics, waitScan, resources, snapshot, video };
  }, { sdkUrl, expectedPayload });

  await run("50 start/stop cycles", () => page.evaluate(async () => {
    const { scanner, metrics, waitScan, resources, snapshot } = window.__stress;
    const failures = [];
    for (let cycle = 0; cycle < 50; cycle++) {
      const before = metrics.scans;
      await scanner.start(); await waitScan(before); scanner.stop();
      const state = resources();
      if (state.liveTracks !== 0) failures.push(`live track after cycle ${cycle + 1}`);
      if (state.attachedStream) failures.push(`attached stream after cycle ${cycle + 1}`);
      if (state.activeWorkers > 1) failures.push(`extra decoder worker after cycle ${cycle + 1}`);
    }
    return { cycles: 50, failures, ...snapshot() };
  }));

  await run("20 camera switches and 20 pause/resume cycles", () => page.evaluate(async () => {
    const { scanner, metrics, waitScan, resources, snapshot } = window.__stress;
    const failures = [];
    let before = metrics.scans;
    await scanner.start(); await waitScan(before);
    for (let cycle = 0; cycle < 20; cycle++) {
      before = metrics.scans; await scanner.switchCamera(); await waitScan(before);
      const state = resources();
      if (state.liveTracks !== 1) failures.push(`live track count ${state.liveTracks} after switch ${cycle + 1}`);
      if (state.activeWorkers !== 1) failures.push(`decoder worker count ${state.activeWorkers} after switch ${cycle + 1}`);
      scanner.pause(); const paused = metrics.scans;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (metrics.scans !== paused) failures.push(`scan emitted while paused at cycle ${cycle + 1}`);
      scanner.resume(); await waitScan(paused);
    }
    scanner.stop();
    const state = resources();
    if (state.liveTracks !== 0) failures.push("live track after final stop");
    if (state.attachedStream) failures.push("attached stream after final stop");
    return { switches: 20, pauseResumeCycles: 20, failures, ...snapshot() };
  }));

  await run("continuous decode soak", async () => {
    const initialScans = await page.evaluate(async () => {
      const { scanner, metrics, waitScan } = window.__stress;
      const before = metrics.scans; await scanner.start(); await waitScan(before);
      return metrics.exactScans;
    });
    const samples = [], began = performance.now();
    for (let elapsed = 0; elapsed < soakSeconds * 1000; elapsed += 10000) {
      await page.waitForTimeout(Math.min(10000, soakSeconds * 1000 - elapsed));
      const sample = await page.evaluate(() => {
        const { scanner, metrics, resources } = window.__stress;
        return { ...resources(), frames: metrics.frames, exactScans: metrics.exactScans, wrongScans: metrics.wrongScans.length, errors: metrics.scannerErrors.length, engine: scanner.stats.engine };
      });
      samples.push({ elapsedSeconds: +(performance.now() - began).toFixed(0) / 1000, ...sample });
      if (samples.length % 3 === 0) console.log(`soak ${Math.round((performance.now() - began) / 1000)}s: ${sample.exactScans} exact scans, ${sample.errors} scanner errors`);
    }
    const stopped = await page.evaluate(() => {
      const { scanner, resources, snapshot, video } = window.__stress;
      scanner.destroy(); video.remove();
      return { ...resources(), metrics: snapshot() };
    });
    return { initialScans, samples, stopped };
  });

  const invalid = phases.some((phase) => (phase.failures?.length ?? 0) > 0 || phase.wrongScans?.length > 0 || phase.scannerErrors?.length > 0
    || phase.samples?.some((sample, index, all) => sample.errors > 0 || sample.wrongScans > 0 || sample.state !== "scanning"
      || sample.liveTracks !== 1 || sample.activeWorkers !== 1 || sample.engine !== "worker"
      || sample.exactScans <= (index ? all[index - 1].exactScans : phase.initialScans))
    || (phase.stopped && (phase.stopped.liveTracks !== 0 || phase.stopped.attachedStream || phase.stopped.activeWorkers > 1)));
  if (invalid || pageErrors.length || consoleErrors.length) throw new Error("Stress validation failed; inspect saved evidence.");
  status = "passed";
  console.log("PASS: lifecycle and soak checks");
} catch (error) {
  status = "failed";
  let snapshot;
  try { snapshot = await page?.evaluate(() => window.__stress?.snapshot()); } catch { /* Page may already be closed. */ }
  phases.push({ name: "failure", message: error.stack ?? String(error), snapshot });
  process.exitCode = 1;
  console.error(error.message ?? error);
} finally {
  completedAt = new Date().toISOString();
  try { save(); } finally {
    try { await browser?.close(); } finally {
      server?.kill();
      // Delete only the exact temporary directory created by this run.
      if (dirname(temp) === tempRoot && basename(temp).startsWith("qrgen-stress-")) rmSync(temp, { recursive: true, force: true });
    }
  }
  console.log(`Evidence: ${output}`);
}
