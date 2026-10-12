// Public picking page + actual qrgen-scanner/decoder in real Chromium.
// Generated pixels are fixtures. Deferred bitmap/media permission completions
// are labeled platform-boundary controls; no scan/track results are injected.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { generatePNG } from "qrgen-sdk/node";
import { writeFakeCamera } from "./fake-camera.mjs";

const site = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(site, "..");
const fixtureDirectory = mkdtempSync(join(tmpdir(), "qrgen-picking-"));
const mixedVideo = join(fixtureDirectory, "mixed.y4m");
const expiryVideo = join(fixtureDirectory, "expiry.y4m");
const targetImage = join(fixtureDirectory, "target.png");
const otherImage = join(fixtureDirectory, "other.png");
const gtinVideo = join(fixtureDirectory, "gtin.y4m");
const gtinImage = join(fixtureDirectory, "gtin.png");
// An EAN-13 printed with a leading 0 decodes as this UPC-A under symbologies="all".
const RETAIL_TARGET = "0012345678905";
const RETAIL_SCAN = "012345678905";
const TARGET = " 00123a ";
const OTHER = "00123a";
const CASE_NEIGHBOR = " 00123A ";
const results = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let BASE = process.env.E2E_BASE_URL;
let server;
let serverError;
let serverLog = "";
let failures = 0;
let fatal;
let inputsBefore;
let fixtures;

function inventory(directory) {
  const output = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        const bytes = readFileSync(child);
        output[relative(root, child).replaceAll("\\", "/")] = { bytes: bytes.length, sha256: hash(bytes) };
      }
    }
  }
  visit(directory);
  return output;
}
function inputs() {
  return { ...inventory(join(site, "src")), ...inventory(join(root, "packages/sdk/src")), ...inventory(join(site, "dist")) };
}
async function startServer() {
  if (BASE) {
    assert.ok(BASE.endsWith("/"), "E2E_BASE_URL must include the site's base path and end in /.");
    return;
  }
  const probe = createServer();
  const port = await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return probe.close(() => reject(new Error("No preview port.")));
      probe.close((error) => error ? reject(error) : done(address.port));
    });
  });
  BASE = `http://127.0.0.1:${port}/QR-GEN/`;
  const pkg = createRequire(import.meta.url).resolve("astro/package.json");
  server = spawn(process.execPath, [join(dirname(pkg), "bin/astro.mjs"), "preview", "--port", String(port), "--host", "127.0.0.1", "--ignore-lock"], {
    cwd: site, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", (error) => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (bytes) => { serverLog = (serverLog + bytes).slice(-8000); });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverError) throw serverError;
    assert.ok(server.exitCode === null && server.signalCode === null, `Preview exited: ${serverLog}`);
    assert.ok(!/port\s+\d+\s+is in use/i.test(serverLog), `Preview port collision: ${serverLog}`);
    if (serverLog.includes(BASE)) {
      try { if ((await fetch(BASE, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* child starting */ }
    }
    await sleep(500);
  }
  throw new Error(`Preview did not become ready: ${serverLog}`);
}
process.on("exit", () => server?.kill());

async function installAudit(context) {
  await context.addInitScript(() => {
    const audit = window.__pickingAudit = {
      streams: [], trackEvents: [], scans: [], states: [], selections: [], scannerErrors: [],
      pendingCamera: 0, cameraRequests: 0, holdCamera: false, cameraHeld: false,
      pendingBitmap: 0, holdBitmap: false, bitmapHeld: false, bitmapReleased: false,
      denyNextCamera: false, imageMutations: [], bitmapCloses: 0, lifecycleEvents: [],
      imageChanges: [], imageCalls: [], imageObserverErrors: [], heldImageCallId: null,
    };
    // Observe the actual scanImage Promise, without replacing the controller,
    // decoded answer, emitted bundle or Promise returned to its caller. The
    // pinned handler synchronously registers scanImage(...).then after change.
    const nativeThen = Promise.prototype.then;
    const captured = new WeakMap();
    let armedChange = null;
    document.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.id !== "image-file" || !event.target.files?.[0]) return;
      const change = { id: audit.imageChanges.length + 1, calls: 0, file: event.target.files[0] };
      audit.imageChanges.push(change); armedChange = change;
      // Native input dispatch may checkpoint microtasks between capture and
      // target listeners. Keep the observation armed through this whole task.
      setTimeout(() => {
        if (armedChange === change) { armedChange = null; audit.imageObserverErrors.push(`No synchronous scanImage Promise registration for change ${change.id}.`); }
      }, 0);
    }, true);
    Promise.prototype.then = function (onFulfilled, onRejected) {
      const existing = captured.get(this);
      if (existing) existing.registrations++;
      if (!armedChange) return nativeThen.call(this, onFulfilled, onRejected);
      const stack = new Error("Actual image Promise registration").stack;
      const moduleURLs = [...document.querySelectorAll('script[type="module"][src]')].map((script) => script.src);
      const callerBundles = moduleURLs.filter((url) => stack.includes(url));
      const controllerCallback = typeof onFulfilled === "function" && onFulfilled.toString().includes("#image-results");
      if (!controllerCallback || callerBundles.length === 0) return nativeThen.call(this, onFulfilled, onRejected);
      const change = armedChange; armedChange = null; change.calls++;
      const record = { id: change.id, file: change.file, fileName: change.file.name, bytes: change.file.size, type: change.file.type, registrations: 1, stack, moduleURLs, callerBundles, controllerCallback, bitmapBindings: 0, settled: false, status: null, decoded: null, error: null };
      captured.set(this, record); audit.imageCalls.push(record);
      return nativeThen.call(this, (value) => {
        record.settled = true; record.status = "fulfilled";
        try {
          record.publicBarcodeArray = Array.isArray(value) && value.every((item) => typeof item.data === "string" && typeof item.symbologyName === "string" && typeof item.rawBytes === "string" && typeof item.symbology === "string" && Number.isFinite(item.timestamp));
          record.decoded = record.publicBarcodeArray ? value.map(({ data, symbologyName, symbology, timestamp }) => ({ data, symbologyName, symbology, timestamp })) : null;
        } catch (error) { audit.imageObserverErrors.push(String(error)); }
        return typeof onFulfilled === "function" ? onFulfilled(value) : value;
      }, (error) => {
        record.settled = true; record.status = "rejected"; record.error = String(error);
        if (typeof onRejected === "function") return onRejected(error);
        throw error;
      });
    };
    const media = navigator.mediaDevices;
    if (media?.getUserMedia) {
      const actual = media.getUserMedia.bind(media);
      media.getUserMedia = async (...args) => {
        audit.cameraRequests++;
        audit.pendingCamera++;
        try {
          if (audit.denyNextCamera) { audit.denyNextCamera = false; throw new DOMException("Controlled permission denial", "NotAllowedError"); }
          const stream = await actual(...args);
          audit.streams.push(stream);
          if (audit.holdCamera) {
            audit.holdCamera = false; audit.cameraHeld = true;
            await new Promise((done) => { audit.releaseCamera = () => { audit.cameraHeld = false; done(); }; });
          }
          return stream;
        } finally { audit.pendingCamera--; }
      };
    }
    if (typeof createImageBitmap === "function") {
      const actual = window.createImageBitmap.bind(window);
      window.createImageBitmap = async (...args) => {
        const call = audit.imageCalls.find((record) => record.file === args[0] && record.bitmapBindings === 0);
        if (call) call.bitmapBindings++;
        const bitmap = await actual(...args);
        const close = bitmap.close.bind(bitmap);
        bitmap.close = () => { audit.bitmapCloses++; close(); };
        if (audit.holdBitmap && args[0] instanceof Blob) {
          audit.holdBitmap = false; audit.bitmapHeld = true; audit.pendingBitmap++;
          audit.heldImageCallId = call?.id ?? null;
          await new Promise((done) => { audit.releaseBitmap = () => { audit.bitmapHeld = false; audit.bitmapReleased = true; done(); }; });
          audit.pendingBitmap--;
        }
        return bitmap;
      };
    }
    for (const kind of ["track", "scan", "statechange", "select", "error"]) document.addEventListener(kind, (event) => {
      if (!(event.target instanceof Element) || !event.target.matches("qrgen-scanner")) return;
      const detail = event.detail;
      if (kind === "track") {
        const record = { at: performance.now(), tracked: structuredClone(detail.tracked), added: structuredClone(detail.added), removed: structuredClone(detail.removed) };
        audit.trackEvents.push(record);
        if (audit.trackEvents.length > 1000) audit.trackEvents.shift();
      } else if (kind === "scan") audit.scans.push(...detail.barcodes.map(({ data }) => data));
      else if (kind === "statechange") audit.states.push(detail.state);
      else if (kind === "select") audit.selections.push({ selected: detail.selected, id: detail.barcode?.id, data: detail.barcode?.data });
      else audit.scannerErrors.push(structuredClone(detail));
    }, true);
    document.addEventListener("DOMContentLoaded", () => {
      const target = document.querySelector("#image-results");
      if (target) new MutationObserver(() => audit.imageMutations.push(target.textContent)).observe(target, { childList: true, subtree: true, characterData: true });
    }, { once: true });
  });
}
async function goto(page) {
  const response = await page.goto(new URL("picking/", BASE).href);
  assert.ok(response?.ok(), `Picking HTTP ${response?.status()}.`);
  await page.locator("#target-form").waitFor();
  await page.waitForFunction(() => !!customElements.get("qrgen-scanner") && !document.querySelector("#picking-app")?.hasAttribute("aria-busy"));
}
async function setTarget(page, data = TARGET, name = "Exact target") {
  await page.locator("#target-code").fill(data);
  await page.locator("#target-name").fill(name);
  await page.locator('#target-form button[type="submit"]').click();
  assert.equal(await page.locator("#target-code").inputValue(), data);
}
const matchRows = (page) => page.locator("#match-list [data-id]");
const otherRows = (page) => page.locator("#other-list [data-id]");
async function waitMatches(page, count) {
  await page.waitForFunction((count) => document.querySelectorAll("#match-list [data-id]").length === count, count, { timeout: 20_000 });
}
async function rows(page, selector) {
  return page.locator(`${selector} [data-id]`).evaluateAll((nodes) => nodes.map((node) => ({ id: Number(node.dataset.id), data: node.dataset.code, text: node.textContent })));
}
const startButton = (page) => page.locator('#scanner [data-a="start"]');
async function start(page) { await startButton(page).click(); }
async function chooseSource(page, source) { await page.locator("#source-mode").selectOption(source); }
async function stopped(page) {
  await page.waitForFunction(() => ["idle", "stopped"].includes(document.querySelector("#scanner").state) && window.__pickingAudit.pendingCamera === 0 && window.__pickingAudit.streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")));
  assert.equal(await matchRows(page).count(), 0);
  assert.equal(await otherRows(page).count(), 0);
  assert.deepEqual(await page.locator("#scanner").evaluate((element) => element.selection), []);
}
async function imageRows(page) {
  return page.locator("#image-results li").evaluateAll((nodes) => nodes.map((node) => ({ data: node.dataset.code, matches: node.dataset.match, id: node.dataset.id })));
}
async function imageCall(page, id, status = "fulfilled") {
  await page.waitForFunction((id) => window.__pickingAudit.imageObserverErrors.length > 0 || window.__pickingAudit.imageCalls.some((call) => call.id === id && call.settled), id);
  // A subsequent normal task/render turn also lets the original controller
  // callback, chained catch and MutationObserver delivery finish.
  await page.evaluate(async () => { await new Promise((done) => setTimeout(done, 0)); await new Promise(requestAnimationFrame); });
  const record = await page.evaluate((id) => {
    if (window.__pickingAudit.imageObserverErrors.length) return { observerErrors: window.__pickingAudit.imageObserverErrors };
    const { file, ...call } = window.__pickingAudit.imageCalls.find((call) => call.id === id);
    return { ...call, changeCalls: window.__pickingAudit.imageChanges.find((change) => change.id === id).calls, observerErrors: window.__pickingAudit.imageObserverErrors };
  }, id);
  assert.deepEqual(record.observerErrors, []);
  assert.equal(record.changeCalls, 1); assert.equal(record.registrations, 1);
  assert.equal(record.controllerCallback, true, "Captured Promise was not the actual controller scanImage result.");
  assert.ok(record.callerBundles.length > 0, JSON.stringify(record));
  assert.deepEqual(record.observerErrors, []); assert.equal(record.status, status);
  if (status === "fulfilled") assert.equal(record.publicBarcodeArray, true);
  return record;
}
async function readImage(page, file = targetImage, data = TARGET, matching = true) {
  const before = await page.evaluate(() => window.__pickingAudit.imageChanges.length);
  await page.locator("#image-file").setInputFiles(file);
  const call = await imageCall(page, before + 1);
  assert.deepEqual(call.decoded.map((item) => item.data), [data]);
  await page.waitForFunction(({ data, matching }) => [...document.querySelectorAll("#image-results li")].some((row) => row.dataset.code === data && row.dataset.match === String(matching)), { data, matching });
  const decoded = await imageRows(page);
  assert.deepEqual(decoded, [{ data, matches: String(matching), id: undefined }]);
  assert.equal(await matchRows(page).count(), 0, "Static image results entered the live-track list.");
  return decoded;
}
async function holdImage(page, file = targetImage) {
  await page.evaluate(() => { window.__pickingAudit.holdBitmap = true; window.__pickingAudit.bitmapHeld = false; window.__pickingAudit.bitmapReleased = false; window.__pickingAudit.imageMutations = []; });
  await page.locator("#image-file").setInputFiles(file);
  await page.waitForFunction(() => window.__pickingAudit.bitmapHeld);
  assert.match(await page.locator("#image-status").textContent(), /Reading/);
}
async function releaseImage(page) {
  const id = await page.evaluate(() => window.__pickingAudit.heldImageCallId);
  assert.ok(Number.isSafeInteger(id) && id > 0, "Held real bitmap was not bound to the captured file-change Promise.");
  await page.evaluate(() => window.__pickingAudit.releaseBitmap());
  const call = await imageCall(page, id);
  assert.equal(call.bitmapBindings, 1);
  assert.deepEqual(call.decoded.map((item) => item.data), [TARGET]);
  await page.waitForFunction(() => window.__pickingAudit.pendingBitmap === 0);
  return call;
}
async function screenshot(page, name) {
  if (!process.env.PICKING_SCREENSHOTS_DIR) return;
  mkdirSync(process.env.PICKING_SCREENSHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PICKING_SCREENSHOTS_DIR, name), fullPage: true });
}
async function design(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { tokens: Object.fromEntries(["--ink", "--muted", "--line", "--white", "--teal-500", "--radius", "--radius-lg", "--font-sans", "--font-display"].map((name) => [name, root.getPropertyValue(name).trim()])), body: getComputedStyle(document.body).fontFamily, heading: getComputedStyle(document.querySelector("h1")).fontFamily };
  });
}
async function test(name, run, { width = 1280, video = mixedVideo, expectedCameraError = false } = {}) {
  if (process.env.PICKING_TEST_FILTER && !process.env.PICKING_TEST_FILTER.split("|").some((part) => name.includes(part))) return;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`] });
  let context;
  let page;
  const errors = [], consoleErrors = [], external = [], resources = [], resourceReads = [], workers = new Set();
  let evidence, observation, cleanup, failure;
  const started = Date.now();
  try {
    context = await browser.newContext({ viewport: { width, height: 960 }, permissions: ["camera"] });
    await installAudit(context);
    const origin = new URL(BASE).origin;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (!/^https?:$/.test(url.protocol) || url.origin === origin) return route.continue();
      external.push(url.href); return route.abort();
    });
    context.on("page", (opened) => {
      opened.on("pageerror", (error) => errors.push(error.message));
      opened.on("console", (message) => { if (message.type() === "error" && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(message.location().url ?? "")) consoleErrors.push(message.text()); });
      opened.on("worker", (worker) => { workers.add(worker); worker.once("close", () => workers.delete(worker)); });
      opened.on("response", (response) => {
        if (!/\.(js|wasm)(?:\?|$)/.test(response.url())) return;
        resourceReads.push(response.body().then((bytes) => resources.push({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: hash(bytes) })).catch((error) => errors.push(`Resource body: ${error.message}`)));
      });
    });
    page = await context.newPage();
    evidence = await run(page, context);
  } catch (error) {
    failure = error.stack ?? String(error);
    if (page && !page.isClosed()) {
      try { await screenshot(page, `failure-${results.length + 1}.png`); } catch { /* keep original failure */ }
    }
  } finally {
    if (page && !page.isClosed()) {
      try {
        observation = await page.evaluate(() => {
          const element = document.querySelector("#scanner"), active = element?.scanner, preview = element?.querySelector(".preview")?.getBoundingClientRect();
          const audit = window.__pickingAudit;
          return { state: element?.state, video: active ? { width: active.video.videoWidth, height: active.video.videoHeight } : null, preview: preview ? { width: preview.width, height: preview.height } : null, scanArea: active?.options.scanArea ?? null, tracked: element?.tracked, selection: element?.selection, scans: [...new Set(audit.scans)], trackEventCount: audit.trackEvents.length, lastTrackEvents: audit.trackEvents.slice(-12), streams: audit.streams.map((stream) => ({ id: stream.id, tracks: stream.getTracks().map((track) => ({ id: track.id, state: track.readyState })) })), imageCalls: audit.imageCalls.map(({ file, ...call }) => call), imageChanges: audit.imageChanges.map(({ file, ...change }) => change), imageObserverErrors: audit.imageObserverErrors };
        });
        await page.evaluate(() => {
          document.querySelector("#scanner")?.stop();
          window.__pickingAudit?.releaseCamera?.(); window.__pickingAudit?.releaseBitmap?.();
        });
        await page.waitForFunction(() => window.__pickingAudit.pendingCamera === 0 && window.__pickingAudit.pendingBitmap === 0 && window.__pickingAudit.streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")), undefined, { timeout: 10_000 });
        cleanup = await page.evaluate(() => ({ liveTracks: window.__pickingAudit.streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState !== "ended").length, streamCount: window.__pickingAudit.streams.length, pendingCamera: window.__pickingAudit.pendingCamera, pendingBitmap: window.__pickingAudit.pendingBitmap, scannerErrors: window.__pickingAudit.scannerErrors, states: window.__pickingAudit.states, cameraRequests: window.__pickingAudit.cameraRequests }));
        assert.equal(cleanup.liveTracks, 0, "Camera cleanup leaked a real MediaStreamTrack.");
        assert.deepEqual(observation.imageObserverErrors, []);
        assert.ok(observation.imageChanges.every((change) => change.calls === 1));
        assert.ok(observation.imageCalls.every((call) => call.registrations === 1 && call.settled && call.controllerCallback && call.callerBundles.length > 0));
        assert.ok(expectedCameraError ? cleanup.scannerErrors.length === 1 && cleanup.scannerErrors[0].code === "camera-permission-denied" : cleanup.scannerErrors.length === 0, JSON.stringify(cleanup.scannerErrors));
      } catch (error) { failure ??= `Cleanup: ${error.stack ?? error}`; }
    }
    try { await Promise.all(resourceReads); } catch (error) { failure ??= `Resource cleanup: ${error.stack ?? error}`; }
    try { await context?.close(); } catch (error) { failure ??= `Context cleanup: ${error.stack ?? error}`; }
    if (workers.size) failure ??= "Context close retained a browser worker.";
    try { await browser.close(); } catch (error) { failure ??= `Browser cleanup: ${error.stack ?? error}`; }
    if (errors.length || consoleErrors.length || external.some((url) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url))) failure ??= JSON.stringify({ errors, consoleErrors, external });
    if (failure) failures++;
    results.push({ name, passed: !failure, elapsedMs: Date.now() - started, evidence, observation, cleanup, failure, errors, consoleErrors, external, loadedResources: resources, workersAfterContextClose: workers.size });
    console.log(`  ${failure ? "✗" : "✓"} ${name}${failure ? `: ${failure}` : ""}`);
  }
}

try {
  inputsBefore = inputs();
  await startServer();
  // Central grid stays wholly visible under the actual scanner's object-fit
  // crop at both desktop and phone widths. Production scanArea is untouched.
  await writeFakeCamera(mixedVideo, [
    { data: TARGET, symbology: "qr", x: 220, y: 135, module: 3 },
    { data: TARGET, symbology: "qr", x: 335, y: 135, module: 3 },
    { data: OTHER, symbology: "qr", x: 220, y: 250, module: 3 },
    { data: CASE_NEIGHBOR, symbology: "data-matrix", x: 335, y: 250, module: 5 },
  ], { frames: 60 });
  const blank = join(fixtureDirectory, "blank.y4m");
  await writeFakeCamera(blank, [], { frames: 90 });
  const blankBytes = readFileSync(blank);
  writeFileSync(expiryVideo, Buffer.concat([readFileSync(mixedVideo), blankBytes.subarray(blankBytes.indexOf(10) + 1)]));
  writeFileSync(targetImage, await generatePNG(TARGET, { symbology: "qr", scale: 6 }));
  writeFileSync(otherImage, await generatePNG(OTHER, { symbology: "qr", scale: 6 }));
  // The same digits as a non-GS1 Code 128 are not a retail product number.
  await writeFakeCamera(gtinVideo, [
    { data: RETAIL_TARGET, symbology: "ean13", x: 220, y: 140, module: 2 },
    { data: RETAIL_SCAN, symbology: "code128", x: 220, y: 270, module: 2 },
  ], { frames: 60 });
  writeFileSync(gtinImage, await generatePNG(RETAIL_TARGET, { symbology: "ean13", scale: 3 }));
  fixtures = Object.fromEntries([mixedVideo, expiryVideo, targetImage, otherImage, gtinVideo, gtinImage].map((path) => {
    const bytes = readFileSync(path); return [basename(path), { bytes: bytes.length, sha256: hash(bytes) }];
  }));

  await test("mixed camera pixels preserve exact target and separate duplicate observations", async (page) => {
    await goto(page); await setTarget(page); await start(page); await waitMatches(page, 2);
    await page.waitForFunction(({ other, neighbor }) => {
      const codes = [...document.querySelectorAll("#other-list [data-id]")].map((row) => row.dataset.code);
      return codes.includes(other) && codes.includes(neighbor);
    }, { other: OTHER, neighbor: CASE_NEIGHBOR });
    const matching = await rows(page, "#match-list"), others = await rows(page, "#other-list");
    assert.deepEqual(matching.map((row) => row.data), [TARGET, TARGET]);
    assert.equal(new Set(matching.map((row) => row.id)).size, 2);
    assert.deepEqual(others.map((row) => row.data).sort(), [OTHER, CASE_NEIGHBOR].sort());
    const before = await page.evaluate(() => window.__pickingAudit.trackEvents.length);
    await page.waitForFunction((count) => window.__pickingAudit.trackEvents.length >= count + 4, before);
    assert.deepEqual((await rows(page, "#match-list")).map((row) => row.id).sort(), matching.map((row) => row.id).sort());
    assert.equal(await page.locator("#match-status").textContent(), "2 recent matching observations.");
    assert.doesNotMatch(await page.locator("#match-list").textContent(), /\b(quantity|received|physical items)\b/i);
    assert.match(await page.locator("#camera-observations").textContent(), /does not count stock or record received quantities/);
    const audit = await page.evaluate(() => ({ scans: window.__pickingAudit.scans, tracks: window.__pickingAudit.trackEvents.length }));
    assert.ok(audit.scans.includes(TARGET) && audit.scans.includes(OTHER) && audit.scans.includes(CASE_NEIGHBOR));
    const storage = await page.evaluate(async () => ({ databases: (await indexedDB.databases()).map((db) => db.name), localEntries: localStorage.length, sessionEntries: sessionStorage.length }));
    assert.deepEqual(storage, { databases: [], localEntries: 0, sessionEntries: 0 }, "The finder wrote a receiving/storage record.");
    await screenshot(page, "picking-desktop.png");
    return { matching, others, audit, storage };
  });

  await test("a decoded UPC-A matches its 13-digit EAN target while the same digits in Code 128 do not", async (page) => {
    await goto(page); await setTarget(page, RETAIL_TARGET, "Retail target");
    assert.match(await page.locator("#target-status").textContent(), /product number 00012345678905/);
    await start(page); await waitMatches(page, 1);
    await page.waitForFunction((data) => [...document.querySelectorAll("#other-list [data-id]")].some((row) => row.dataset.code === data), RETAIL_SCAN, { timeout: 20_000 });
    const matching = await rows(page, "#match-list"), others = await rows(page, "#other-list");
    assert.deepEqual(matching.map((row) => row.data), [RETAIL_SCAN], "The decoded value is shown as decoded.");
    assert.match(matching[0].text, /UPC-A · observation \d+ · same product number/);
    assert.deepEqual(others.map((row) => row.data), [RETAIL_SCAN]);
    assert.match(others[0].text, /Code 128 · observation \d+$/);
    await chooseSource(page, "image"); await stopped(page);
    const image = await readImage(page, gtinImage, RETAIL_SCAN, true);
    assert.match(await page.locator("#image-results li").textContent(), /Target match.*UPC-A · same product number/);
    return { matching, others, image };
  }, { video: gtinVideo });

  await test("wrong target stays unmatched and exact target replacement retires selection and camera", async (page) => {
    await goto(page); await setTarget(page, "00123A"); await start(page);
    await page.waitForFunction(() => document.querySelectorAll("#other-list [data-id]").length === 4);
    assert.equal(await matchRows(page).count(), 0);
    await setTarget(page); await stopped(page); await start(page); await waitMatches(page, 2);
    const selectedId = (await rows(page, "#match-list"))[0].id;
    assert.equal(await page.locator("#scanner").evaluate((element, id) => element.selectBarcode(id, true), selectedId), true);
    await setTarget(page, OTHER, "Replacement"); await stopped(page);
    assert.equal(await page.locator("#target-value").textContent(), OTHER);
    assert.equal(await page.locator("#image-results li").count(), 0);
    await start(page); await waitMatches(page, 1);
    assert.deepEqual((await rows(page, "#match-list")).map((row) => row.data), [OTHER]);
    return { selectedId, replacement: await rows(page, "#match-list") };
  });

  await test("actual blank frames remove matches while retained selected snapshot stays excluded", async (page) => {
    await goto(page); await setTarget(page); await start(page); await waitMatches(page, 2);
    const matching = await rows(page, "#match-list"), selectedId = matching[0].id;
    assert.equal(await page.locator("#scanner").evaluate((element, id) => element.selectBarcode(id, true), selectedId), true);
    await page.waitForFunction((ids) => {
      const removed = new Set(window.__pickingAudit.trackEvents.flatMap((event) => event.removed.map((track) => track.id)));
      return ids.every((id) => removed.has(id));
    }, matching.map((row) => row.id), { timeout: 15_000 });
    await waitMatches(page, 0);
    const selected = await page.locator("#scanner").evaluate((element) => element.selection);
    assert.equal(selected.length, 1); assert.equal(selected[0].id, selectedId); assert.equal(selected[0].data, TARGET);
    const builtIn = page.locator(`#scanner [data-a="select-barcode"][data-id="${selectedId}"]`);
    assert.match(await builtIn.textContent(), /out of view/i);
    assert.equal(await page.locator("#scanner").evaluate((element, id) => element.selectBarcode(id, true), selectedId), true);
    assert.equal(await matchRows(page).count(), 0, "Retained selected snapshot revived an expired observation.");
    return { initial: matching, selected, removal: await page.evaluate(() => window.__pickingAudit.trackEvents.filter((event) => event.removed.length)) };
  }, { video: expiryVideo });

  await test("reset and stop retire observations without discarding the chosen target", async (page) => {
    await goto(page); await setTarget(page); await start(page); await waitMatches(page, 2);
    await matchRows(page).first().locator("button").click();
    await page.locator("#reset-picking").click(); await stopped(page);
    assert.equal(await page.locator("#target-value").textContent(), TARGET);
    await start(page); await waitMatches(page, 2);
    await page.locator("#stop-picking").click(); await stopped(page);
    assert.equal(await page.locator("#target-value").textContent(), TARGET);
    return { states: await page.evaluate(() => window.__pickingAudit.states) };
  });

  await test("source and camera-facing changes clear old observations and require explicit start", async (page) => {
    await goto(page); await setTarget(page); await start(page); await waitMatches(page, 2);
    await chooseSource(page, "image"); await stopped(page);
    assert.equal(await page.locator("#image-source").isVisible(), true);
    await chooseSource(page, "camera"); await stopped(page);
    await start(page); await waitMatches(page, 2);
    await page.locator("#camera-facing").selectOption("front"); await stopped(page);
    assert.equal(await page.locator("#scanner").getAttribute("camera"), "front");
    await start(page); await waitMatches(page, 2);
    return { states: await page.evaluate(() => window.__pickingAudit.states), facing: await page.locator("#camera-facing").inputValue() };
  });

  await test("actual still images classify exact payloads separately from live observations", async (page) => {
    await goto(page); await setTarget(page); await chooseSource(page, "image");
    const matching = await readImage(page), other = await readImage(page, otherImage, OTHER, false);
    assert.equal(await page.locator("#image-results [data-id]").count(), 0);
    await page.locator("#reset-picking").click();
    assert.deepEqual(await imageRows(page), []);
    await readImage(page); await chooseSource(page, "camera"); await stopped(page);
    assert.deepEqual(await imageRows(page), []);
    return { matching, other };
  });

  await test("held actual image completion cannot publish an obsolete target", async (page) => {
    await goto(page); await setTarget(page); await chooseSource(page, "image"); await readImage(page);
    await holdImage(page); await setTarget(page, OTHER); await releaseImage(page);
    assert.deepEqual(await imageRows(page), []);
    assert.doesNotMatch(await page.locator("#image-status").textContent(), /Reading/);
    const staleMutations = await page.evaluate(() => window.__pickingAudit.imageMutations);
    assert.ok(staleMutations.every((text) => !text.includes("Target match")), JSON.stringify(staleMutations));
    const current = await readImage(page, otherImage, OTHER, true);
    return { boundary: "Real createImageBitmap completion held after actual decode preparation; target changed before release.", staleMutations, current };
  });

  await test("held actual image completion is cancelled by stop reset and source replacement", async (page) => {
    await goto(page); await setTarget(page); await chooseSource(page, "image"); await readImage(page);
    const actions = [];
    for (const action of ["stop", "reset", "source"]) {
      await holdImage(page);
      if (action === "source") await chooseSource(page, "camera");
      else await page.locator(action === "stop" ? "#stop-picking" : "#reset-picking").click();
      await releaseImage(page);
      assert.deepEqual(await imageRows(page), [], `Late image escaped ${action}.`);
      const mutations = await page.evaluate(() => window.__pickingAudit.imageMutations);
      assert.ok(mutations.every((text) => !text.includes("Target match")), `${action}: ${JSON.stringify(mutations)}`);
      actions.push({ action, mutations });
      if (action === "source") await chooseSource(page, "image");
      await readImage(page);
    }
    return { boundary: "Actual bitmap completion gates only; actual SDK image decoding and public controls.", actions };
  });

  await test("old camera lifecycle events do not cancel a current held still image", async (page) => {
    await goto(page); await setTarget(page); await start(page); await waitMatches(page, 2);
    await chooseSource(page, "image"); await stopped(page); await readImage(page);
    await holdImage(page);
    const lifecycle = await page.locator("#scanner").evaluate((element) => {
      const video = element.scanner.video;
      const before = { width: video.videoWidth, height: video.videoHeight, state: element.state, currentStream: element.scanner.camera.stream?.id ?? null, actualStreams: window.__pickingAudit.streams.map((stream) => ({ id: stream.id, states: stream.getTracks().map((track) => track.readyState) })) };
      for (const type of ["emptied", "resize"]) { video.dispatchEvent(new Event(type)); window.__pickingAudit.lifecycleEvents.push(type); }
      return before;
    });
    await releaseImage(page);
    await page.waitForFunction(() => document.querySelector("#image-results li")?.dataset.match === "true");
    assert.deepEqual(await imageRows(page), [{ data: TARGET, matches: "true", id: undefined }]);
    assert.doesNotMatch(await page.locator("#image-status").textContent(), /Reading/);
    return { boundary: "Controlled DOM lifecycle notification on actual stopped video, no fabricated dimensions or scan results.", lifecycle, events: await page.evaluate(() => window.__pickingAudit.lifecycleEvents) };
  });

  await test("late actual media permission completion cannot restart an obsolete target", async (page) => {
    await goto(page); await setTarget(page);
    await page.evaluate(() => { window.__pickingAudit.holdCamera = true; });
    await start(page); await page.waitForFunction(() => window.__pickingAudit.cameraHeld);
    await setTarget(page, OTHER);
    await page.evaluate(() => window.__pickingAudit.releaseCamera());
    await stopped(page);
    assert.doesNotMatch(await page.locator("#picking-status").textContent(), /Camera running/);
    await start(page); await waitMatches(page, 1);
    assert.deepEqual((await rows(page, "#match-list")).map((row) => row.data), [OTHER]);
    return { boundary: "Actual getUserMedia resolved stream held before SDK admission; target changed then stream released.", matching: await rows(page, "#match-list") };
  });

  await test("controlled camera denial reports an error and the scanner retry recovers", async (page) => {
    await goto(page); await setTarget(page);
    await page.evaluate(() => { window.__pickingAudit.denyNextCamera = true; });
    await start(page);
    await page.waitForFunction(() => window.__pickingAudit.scannerErrors.length === 1);
    assert.equal(await matchRows(page).count(), 0);
    assert.equal(await page.locator("#picking-status").getAttribute("data-error"), "true");
    assert.ok((await page.locator("#picking-status").textContent()).length > 0);
    await page.locator('#scanner [data-a="retry"]').click(); await waitMatches(page, 2);
    return { boundary: "Controlled getUserMedia NotAllowedError, followed by actual fake-camera success.", error: await page.evaluate(() => window.__pickingAudit.scannerErrors[0]) };
  }, { expectedCameraError: true });

  await test("corrupt still image reports failure and valid image retry recovers", async (page) => {
    await goto(page); await setTarget(page); await chooseSource(page, "image"); await readImage(page);
    await page.locator("#image-file").setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("not a valid image") });
    await page.waitForFunction(() => { const text = document.querySelector("#image-status").textContent; return text.length > 0 && !text.includes("Reading"); });
    assert.deepEqual(await imageRows(page), []);
    const error = await page.locator("#image-status").textContent();
    assert.match(error, /unsupported|corrupt|image/i);
    const recovered = await readImage(page);
    return { error, recovered };
  });

  for (const width of [320, 390]) await test(`keyboard target and keyed highlight focus at ${width}px`, async (page) => {
    const home = await page.goto(BASE); assert.ok(home?.ok()); const original = await design(page);
    await goto(page); assert.deepEqual(await design(page), original);
    await page.locator("#target-code").fill(TARGET);
    await page.locator("#target-code").press("Shift+Enter");
    assert.equal(await page.locator("#target-code").inputValue(), `${TARGET}\n`);
    await page.locator("#target-code").press("Backspace");
    await page.locator("#target-code").press("Enter");
    assert.equal(await page.locator("#target-code").inputValue(), TARGET);
    assert.equal(await page.locator("#target-value").textContent(), TARGET);
    await page.locator("#target-name").fill("Keyboard target");
    await page.locator("#target-name").press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#target-form button[type="submit"]')), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#target-value").textContent(), TARGET);
    await startButton(page).focus(); await page.keyboard.press("Enter"); await waitMatches(page, 2);
    const button = matchRows(page).first().locator("button");
    await button.focus(); await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("#scanner").selection.length === 1);
    const id = await button.evaluate((element) => Number(element.parentElement.dataset.id));
    const count = await page.evaluate(() => window.__pickingAudit.trackEvents.length);
    await page.waitForFunction((count) => window.__pickingAudit.trackEvents.length >= count + 3, count);
    const focus = await page.evaluate(() => ({ id: Number(document.activeElement.parentElement?.dataset.id), pressed: document.activeElement.getAttribute("aria-pressed"), overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    assert.equal(focus.id, id); assert.equal(focus.pressed, "true"); assert.equal(focus.overflow, false);
    await screenshot(page, `picking-${width}.png`);
    return { width, focus, originalDesign: original, currentDesign: await design(page) };
  }, { width });
  assert.ok(results.length > 0, "No picking browser case matched PICKING_TEST_FILTER.");
} catch (error) {
  failures++;
  fatal = error.stack ?? String(error);
  console.error(fatal);
} finally {
  if (inputsBefore) {
    try { assert.deepEqual(inputs(), inputsBefore, "Source/build bytes changed during picking tests."); }
    catch (error) { failures++; fatal ??= error.stack ?? String(error); }
  }
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((done) => server.once("exit", done)); server.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  if (process.env.PICKING_RESULTS_PATH) {
    const destination = resolve(process.env.PICKING_RESULTS_PATH); mkdirSync(dirname(destination), { recursive: true });
    const harness = Object.fromEntries(["e2e-picking.mjs", "test-picking.mjs", "fake-camera.mjs"].map((name) => { const bytes = readFileSync(join(site, "scripts", name)); return [name, { bytes: bytes.length, sha256: hash(bytes) }]; }));
    writeFileSync(destination, JSON.stringify({ recordedAt: new Date().toISOString(), base: BASE, scope: "Actual Chromium public scanner/decoder and generated QR/Data Matrix fixtures; explicitly controlled bitmap/media completion timing. No physical quantities, handset or Scandit parity claim.", failures, fatal, inputs: inputsBefore, harness, fixtures, results }, null, 2) + "\n");
  }
  const owned = resolve(fixtureDirectory);
  assert.ok(dirname(owned) === resolve(tmpdir()) && basename(owned).startsWith("qrgen-picking-"), "Refusing cleanup outside owned fixture directory.");
  rmSync(owned, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
