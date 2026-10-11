// Real Chromium receiving workflow checks. Requires the SDK/site build first.
// Uses real IndexedDB, generated image decoding and Chromium's fake camera.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { generatePNG } from "qrgen-sdk/node";
import { writeFakeCamera } from "./fake-camera.mjs";

const site = fileURLToPath(new URL("../", import.meta.url));
const fixtureDirectory = mkdtempSync(join(tmpdir(), "qrgen-receiving-"));
const video = join(fixtureDirectory, "coffee.y4m");
const teaImage = join(fixtureDirectory, "tea.png");
const COFFEE = "QRGEN-COFFEE";
const TEA = "QRGEN-TEA";
const scannerSelector = "qrgen-scanner#scanner, #scanner qrgen-scanner";
const results = [];
let BASE = process.env.E2E_BASE_URL;
let server;
let browser;
let serverLog = "";
let serverError;
let failures = 0;
let fatal;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.on("exit", () => server?.kill());

async function availablePort() {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return probe.close(() => reject(new Error("Could not allocate a preview port.")));
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (BASE) {
    assert(BASE.endsWith("/"), "E2E_BASE_URL must end in / and include the site's base path.");
    return;
  }
  const port = await availablePort();
  BASE = `http://127.0.0.1:${port}/QR-GEN/`;
  const pkg = createRequire(import.meta.url).resolve("astro/package.json");
  server = spawn(process.execPath, [join(dirname(pkg), "bin", "astro.mjs"), "preview", "--port", String(port), "--host", "127.0.0.1", "--ignore-lock"], {
    cwd: site, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", (error) => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-8000); });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverError) throw new Error(`Preview failed to launch: ${serverError.message}`);
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Preview exited before readiness: ${serverLog}`);
    if (/port\s+\d+\s+is in use/i.test(serverLog)) throw new Error(`Allocated preview port became occupied: ${serverLog}`);
    // A response from another process cannot establish readiness. Require this
    // child to announce its own bound URL, as in the frontier browser checks.
    if (serverLog.includes(BASE)) {
      try {
        const response = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
        if (response.ok && server.exitCode === null && server.signalCode === null) return;
      } catch { /* preview starting */ }
    }
    await sleep(500);
  }
  throw new Error(`Preview did not start: ${serverLog}`);
}

async function goto(page) {
  const response = await page.goto(new URL("receiving/", BASE).href);
  assert(response?.ok(), `Receiving page returned HTTP ${response?.status() ?? "no response"}`);
  await ready(page);
}

async function ready(page) {
  await page.locator("#new-delivery").waitFor();
  await page.waitForFunction(() => document.querySelector("#receiving-app")?.getAttribute("aria-busy") === "false");
}

async function submit(page, selector) {
  await page.locator(selector).locator('button[type="submit"], button:not([type]), input[type="submit"]').first().click();
}

async function createDelivery(page, name) {
  await page.locator("#delivery-name").fill(name);
  await submit(page, "#new-delivery");
  await page.waitForFunction((wanted) => {
    const select = document.querySelector("#delivery-select");
    return select?.selectedOptions[0]?.textContent.trim() === wanted && !!select.value;
  }, name);
  return page.locator("#delivery-select").inputValue();
}

async function addExpected(page, code = COFFEE, name = "Coffee", expected = 5) {
  await page.locator("#item-code").fill(code);
  await page.locator("#item-name").fill(name);
  await page.locator("#item-expected").fill(String(expected));
  await submit(page, "#expected-item");
  await waitReceived(page, code, 0);
}

const row = (page, code) => page.locator("#product-rows tr[data-code]").filter({ has: page.locator(`[data-col="code"]`, { hasText: code }) });

async function waitReceived(page, code, quantity) {
  await page.waitForFunction(({ code, quantity }) => {
    const match = [...document.querySelectorAll("#product-rows tr[data-code]")].find((element) => element.dataset.code === code);
    return match && Number(match.querySelector('[data-col="received"]')?.textContent.trim()) === quantity;
  }, { code, quantity });
}

async function selectProduct(page, code) {
  await row(page, code).locator("button[data-select]").click();
  await page.waitForFunction((code) => document.querySelector("#selected-code")?.textContent.includes(code), code);
}

async function confirm(page, quantity) {
  await page.locator("#receive-quantity").fill(String(quantity));
  await submit(page, "#confirm-quantity");
}

async function exportDelivery(page) {
  const waiting = page.waitForEvent("download");
  await page.locator("#export-delivery").click();
  const download = await waiting;
  const path = await download.path();
  assert(path, "No local export download path.");
  const text = readFileSync(path, "utf8");
  const value = JSON.parse(text);
  assert(value.schema === "qrgen-receiving-v1", "Unexpected receiving export schema.");
  assert(value.exportId === `${value.sessionId}:${value.revision}`, "Export ID does not bind session/revision.");
  assert(Array.isArray(value.items) && Array.isArray(value.history), "Export lost products/history.");
  return { text, value, sha256: sha256(text) };
}

function item(exported, code) {
  const found = exported.value.items.find((product) => product.code === code);
  assert(found, `Export lacks ${code}`);
  return found;
}

// Corrupt only explicit test records through actual IndexedDB. This deliberately
// bypasses application validation to exercise recovery from existing bad storage.
async function corruptSaved(page, sourceId, targetId, clearOthers = false) {
  return page.evaluate(({ sourceId, targetId, clearOthers }) => new Promise((resolve, reject) => {
    const opening = indexedDB.open("qrgen-receiving-v1", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(["sessions", "settings"], "readwrite");
      const records = tx.objectStore("sessions");
      const request = records.get(sourceId);
      let corrupted;
      request.onsuccess = () => {
        if (!request.result) { tx.abort(); return; }
        corrupted = structuredClone(request.result);
        corrupted.id = targetId;
        corrupted.name = "Unreadable control";
        if (corrupted.items.length) corrupted.items[0].received += 77;
        else corrupted.items.push({ code: "CORRUPT-CONTROL", name: "Corrupt", expected: 1, received: 77 });
        if (clearOthers) records.clear();
        records.put(corrupted);
        tx.objectStore("settings").put(targetId, "active");
      };
      tx.oncomplete = () => { db.close(); resolve(corrupted); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Corrupt-record setup aborted.")); };
    };
  }), { sourceId, targetId, clearOthers });
}

async function readSaved(page, id) {
  return page.evaluate((id) => new Promise((resolve, reject) => {
    const opening = indexedDB.open("qrgen-receiving-v1", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("sessions", "readonly");
      const request = tx.objectStore("sessions").get(id);
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), id);
}

async function observeImage(page, path, code) {
  await page.locator("#image-file").setInputFiles(path);
  const observation = page.locator("#observations button[data-code]").filter({ hasText: code });
  await observation.waitFor();
  await observation.click();
  await page.waitForFunction((code) => document.querySelector("#selected-code")?.textContent.includes(code), code);
}

async function screenshot(page, name) {
  if (!process.env.RECEIVING_SCREENSHOTS_DIR) return;
  mkdirSync(process.env.RECEIVING_SCREENSHOTS_DIR, { recursive: true });
  await page.evaluate(() => { scrollTo({ top: 0, behavior: "instant" }); document.querySelectorAll(".table-scroll").forEach((element) => { element.scrollLeft = 0; }); });
  await page.screenshot({ path: join(process.env.RECEIVING_SCREENSHOTS_DIR, name), fullPage: true });
}

async function design(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      tokens: Object.fromEntries(["--ink", "--muted", "--line", "--white", "--teal-500", "--radius", "--radius-lg", "--font-sans", "--font-display"].map((name) => [name, root.getPropertyValue(name).trim()])),
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector("h1")).fontFamily,
      note: "Computed CSS font stacks; external font downloads are blocked by this offline browser check.",
    };
  });
}

async function test(name, run, viewport = { width: 1280, height: 960 }) {
  if (process.env.RECEIVING_TEST_FILTER && !name.includes(process.env.RECEIVING_TEST_FILTER)) return;
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, acceptDownloads: true, permissions: ["camera"] });
  const errors = [];
  const consoleErrors = [];
  const external = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(message.location().url ?? "")) consoleErrors.push(message.text());
    });
  });
  const origin = new URL(BASE).origin;
  await context.route("**/*", (route) => {
    const request = new URL(route.request().url());
    if (!/^https?:$/.test(request.protocol) || request.origin === origin) return route.continue();
    external.push(request.href);
    return route.abort();
  });
  const page = await context.newPage();
  const started = Date.now();
  let evidence;
  let failure;
  try {
    evidence = await run(page, context);
    assert(errors.length === 0, errors.join("; "));
    assert(consoleErrors.length === 0, consoleErrors.join("; "));
    assert(external.every((value) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(value)), `Unexpected external requests: ${external.join(", ")}`);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    failure = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${name}: ${failure}`);
    if (!page.isClosed()) {
      try {
        console.error("    State:", JSON.stringify(await page.evaluate(() => ({
          message: document.querySelector("#receiving-message")?.textContent,
          revision: document.querySelector("#delivery-revision")?.textContent,
          rows: document.querySelector("#product-rows")?.textContent,
          abortProbe: window.__receivingAbort,
          camera: window.__receivingCamera && { count: window.__receivingCamera.count, scanCount: window.__receivingCamera.scanCount, payloads: window.__receivingCamera.payloads },
          scanner: document.querySelector("#scanner") && { state: document.querySelector("#scanner").state, options: document.querySelector("#scanner").scanner?.options },
          overflow: [...document.querySelectorAll("body *")].map((element) => ({ tag: element.tagName, id: element.id, class: String(element.className), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })).filter((element) => element.right > innerWidth + 0.5 || element.left < -0.5).slice(0, 30),
          viewport: { innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, scrollX, visualWidth: visualViewport?.width, table: [...document.querySelectorAll(".table-scroll")].map((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft, overflow: getComputedStyle(element).overflowX })) },
        }))));
        await screenshot(page, `failure-${results.length + 1}.png`);
      } catch { /* retain the original error */ }
    }
    if (errors.length || consoleErrors.length) console.error("    Browser errors:", JSON.stringify({ errors, consoleErrors }));
  } finally {
    results.push({ name, passed: !failure, elapsedMs: Date.now() - started, evidence, failure, errors, consoleErrors, external });
    await context.close();
  }
}

try {
  await startServer();
  await writeFakeCamera(video, [{ data: COFFEE, symbology: "qr", x: 230, y: 150, module: 6 }]);
  writeFileSync(teaImage, await generatePNG(TEA, { symbology: "qr", scale: 6 }));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: [
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`,
  ] });
  console.log(`Receiving browser checks against ${BASE}`);

  await test("explicit quantities, repeated camera observations, unknown product, correction and reload/export", async (page, context) => {
    await goto(page);
    const id = await createDelivery(page, "Morning delivery");
    await addExpected(page);
    let cameraSummary;
    assert((await row(page, COFFEE).locator('[data-col="expected"]').textContent()).trim() === "5", "Expected quantity missing.");
    await page.locator(scannerSelector).evaluate(async (element) => {
      await customElements.whenDefined("qrgen-scanner");
      element.setAttribute("duplicate-filter", "0");
      window.__receivingCamera = { count: 0, scanCount: 0, payloads: [], scanPayloads: [], tracks: [] };
      element.addEventListener("scan", (event) => {
        for (const barcode of event.detail.barcodes) {
          window.__receivingCamera.scanCount++;
          window.__receivingCamera.scanPayloads.push(barcode.data);
        }
      });
      element.addEventListener("track", (event) => {
        for (const barcode of event.detail.tracked) {
          window.__receivingCamera.count++;
          window.__receivingCamera.payloads.push(barcode.data);
        }
      });
      await element.start();
      window.__receivingCamera.tracks = element.shadowRoot.querySelector("video").srcObject.getTracks();
    });
    try {
      await page.waitForFunction(() => window.__receivingCamera.count >= 5, undefined, { timeout: 20_000 });
      assert(await page.evaluate((code) => window.__receivingCamera.scanCount >= 1 && window.__receivingCamera.scanPayloads.every((value) => value === code), COFFEE), "Initial camera scan or its exact payload is missing.");
      await waitReceived(page, COFFEE, 0);
      await page.locator(scannerSelector).locator('[data-a="select-barcode"]').filter({ hasText: COFFEE }).click();
      await page.waitForFunction((code) => document.querySelector("#selected-code").textContent.includes(code), COFFEE);
      assert(await page.locator(scannerSelector).evaluate((element) => element.selection.length === 1), "Built-in scanner selection was not retained.");
      await confirm(page, 2);
      await waitReceived(page, COFFEE, 2);
      assert((await row(page, COFFEE).locator('[data-col="status"]').textContent()).trim() === "3 remaining", "Remaining quantity status is wrong.");
      const before = await exportDelivery(page);
      const count = await page.evaluate(() => window.__receivingCamera.count);
      await page.waitForFunction((count) => window.__receivingCamera.count >= count + 5, count, { timeout: 20_000 });
      await waitReceived(page, COFFEE, 2);
      const after = await exportDelivery(page);
      assert(after.text === before.text, "Repeated observations changed saved quantities/history.");
      assert(await page.evaluate((code) => window.__receivingCamera.payloads.every((value) => value === code), COFFEE), "Fake-camera payload changed.");
      cameraSummary = { observationsBeforeConfirmation: count, observationsAfterConfirmation: await page.evaluate(() => window.__receivingCamera.count), scanCount: await page.evaluate(() => window.__receivingCamera.scanCount), scanPayloads: await page.evaluate(() => window.__receivingCamera.scanPayloads) };
    } finally {
      const ended = await page.locator(scannerSelector).evaluate((element) => {
        element.stop();
        return window.__receivingCamera.tracks.map((track) => track.readyState);
      });
      assert(ended.length > 0 && ended.every((state) => state === "ended"), "Stopped receiving camera retained a live track.");
    }
    await observeImage(page, teaImage, TEA);
    await page.locator("#unknown-name").fill("Tea");
    await submit(page, "#unknown-item");
    await waitReceived(page, TEA, 0);
    await confirm(page, 1);
    await waitReceived(page, TEA, 1);
    assert((await row(page, TEA).locator('[data-col="status"]').textContent()).trim() === "Unexpected product", "Unknown-product status missing.");
    await selectProduct(page, COFFEE);
    await page.locator("#correction-quantity").fill("1");
    await page.locator("#correction-reason").fill("One pack was damaged");
    await submit(page, "#correct-quantity");
    await waitReceived(page, COFFEE, 1);
    const saved = await exportDelivery(page);
    assert(item(saved, COFFEE).difference === -4, "Expected/received difference is wrong.");
    assert(item(saved, TEA).expected === null && item(saved, TEA).received === 1, "Unknown product was silently expected or lost.");
    const corrections = saved.value.history.filter((action) => action.command.kind === "correct");
    assert(corrections.length === 1 && corrections[0].command.quantity === 1 && corrections[0].command.reason === "One pack was damaged", "Correction audit history missing.");
    assert((await page.locator("#receiving-history").textContent()).includes("One pack was damaged"), "Visible correction history missing.");
    assert((await exportDelivery(page)).text === saved.text, "Same revision exported different bytes.");
    await screenshot(page, "receiving-desktop.png");
    const receivingDesign = await design(page);
    const original = await context.newPage();
    assert((await original.goto(BASE))?.ok(), "Original home page could not load for styling comparison.");
    const originalDesign = await design(original);
    assert(JSON.stringify(receivingDesign) === JSON.stringify(originalDesign), "Receiving changed original computed design tokens/font stacks.");
    await original.close();
    await page.reload();
    await ready(page);
    assert(await page.locator("#delivery-select").inputValue() === id, "Active delivery lost after reload.");
    await waitReceived(page, COFFEE, 1);
    assert((await exportDelivery(page)).text === saved.text, "Reload changed saved export/history.");
    const second = await createDelivery(page, "Afternoon delivery");
    assert(second !== id, "New delivery reused the previous ID.");
    await addExpected(page, TEA, "Tea", 3);
    await page.locator(scannerSelector).evaluate(async (element) => {
      await element.start();
      window.__receivingSwitchTracks = element.shadowRoot.querySelector("video").srcObject.getTracks();
    });
    await page.locator(scannerSelector).locator('[data-a="select-barcode"]').filter({ hasText: COFFEE }).click();
    assert(await page.locator(scannerSelector).evaluate((element) => element.selection.length === 1), "Session-switch control lacks a selected barcode.");
    await page.locator("#delivery-select").selectOption(id);
    await waitReceived(page, COFFEE, 1);
    assert(await page.locator(scannerSelector).evaluate((element) => element.selection.length === 0), "Delivery switch retained scanner selection from another delivery.");
    assert(await page.evaluate(() => window.__receivingSwitchTracks.length > 0 && window.__receivingSwitchTracks.every((track) => track.readyState === "ended")), "Delivery switch retained a live camera track.");
    assert(await page.locator("#observations button").count() === 0, "Delivery switch retained observations from another delivery.");
    assert((await exportDelivery(page)).text === saved.text, "Switching deliveries changed previous saved state.");
    return { sessionId: id, finalRevision: saved.value.revision, exportSha256: saved.sha256, camera: cameraSummary, receivingDesign, originalDesign, sessionSwitchSelectionCleared: true, sessionSwitchTracksEnded: true };
  });

  await test("an already open empty tab adopts the first saved delivery through broadcast", async (page, context) => {
    await goto(page);
    const other = await context.newPage();
    await goto(other);
    assert(await other.locator("#delivery-select").inputValue() === "", "Control tab was not initially empty.");
    assert(await other.locator("#item-code").isDisabled(), "Empty tab unexpectedly enabled product editing.");
    const id = await createDelivery(page, "First shared delivery");
    await other.waitForFunction((id) => document.querySelector("#delivery-select").value === id && !document.querySelector("#item-code").matches(":disabled"), id);
    await addExpected(other);
    await waitReceived(page, COFFEE, 0);
    const adopted = await exportDelivery(other);
    assert(adopted.value.sessionId === id, "Empty tab saved to a different delivery.");
    return { adoptedSessionId: id, editorsEnabledWithoutReload: true, revision: adopted.value.revision };
  });

  await test("parallel tabs retain both confirmations and reject a stale correction", async (page, context) => {
    await goto(page);
    await createDelivery(page, "Shared delivery");
    await addExpected(page, COFFEE, "Coffee", 10);
    await selectProduct(page, COFFEE);
    const other = await context.newPage();
    await goto(other);
    await waitReceived(other, COFFEE, 0);
    await selectProduct(other, COFFEE);
    await page.locator("#receive-quantity").fill("2");
    await other.locator("#receive-quantity").fill("3");
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      const observer = new BroadcastChannel("qrgen-receiving-v1");
      const state = window.__receivingHeldRefresh = { completed: false, released: false, broadcastsWhileBusy: 0, release: () => {} };
      let transaction;
      let completeEvent;
      observer.addEventListener("message", () => {
        if (state.completed && !state.released && document.querySelector("#receiving-app").getAttribute("aria-busy") === "true") state.broadcastsWhileBusy++;
      });
      state.release = () => {
        IDBDatabase.prototype.transaction = original;
        observer.close();
        if (state.completed && !state.released) {
          state.released = true;
          const callback = transaction.oncomplete;
          if (typeof callback !== "function") throw new Error("Production completion callback was not installed.");
          callback.call(transaction, completeEvent);
          transaction = completeEvent = null;
        }
      };
      IDBDatabase.prototype.transaction = function (...args) {
        const actual = Reflect.apply(original, this, args);
        if (args[1] === "readonly") {
          IDBDatabase.prototype.transaction = original;
          transaction = actual;
          // This is a real, already completed IndexedDB transaction. Only its
          // application callback is deferred; no request/result/storage is faked.
          actual.addEventListener("complete", (event) => {
            event.stopImmediatePropagation();
            completeEvent = event;
            state.completed = true;
          }, { capture: true, once: true });
        }
        return actual;
      };
    });
    let refreshEvidence;
    try {
      await page.locator("#confirm-quantity").evaluate((form) => form.requestSubmit());
      await page.waitForFunction(() => window.__receivingHeldRefresh.completed && document.querySelector("#receiving-app").getAttribute("aria-busy") === "true");
      await waitReceived(page, COFFEE, 2);
      await other.locator("#confirm-quantity").evaluate((form) => form.requestSubmit());
      await waitReceived(other, COFFEE, 5);
      await page.waitForFunction(() => window.__receivingHeldRefresh.broadcastsWhileBusy > 0);
      refreshEvidence = await page.evaluate(() => ({ committedCompletionHeld: window.__receivingHeldRefresh.completed, broadcastsWhileBusy: window.__receivingHeldRefresh.broadcastsWhileBusy }));
    } finally {
      await page.evaluate(() => window.__receivingHeldRefresh.release());
    }
    await waitReceived(page, COFFEE, 5);
    await waitReceived(other, COFFEE, 5);
    const confirmed = await exportDelivery(page);
    const quantities = confirmed.value.history.filter((action) => action.command.kind === "receive").map((action) => action.command.quantity).sort();
    assert(JSON.stringify(quantities) === "[2,3]", "A concurrent confirmation was lost or repeated.");
    await other.locator("#correction-quantity").fill("1");
    await other.locator("#correction-reason").fill("Draft before another confirmation");
    await confirm(page, 1);
    await waitReceived(page, COFFEE, 6);
    await waitReceived(other, COFFEE, 6);
    const latest = await exportDelivery(page);
    await submit(other, "#correct-quantity");
    await other.waitForFunction(() => document.querySelector("#receiving-message")?.textContent.includes("changed in another tab"));
    await waitReceived(other, COFFEE, 6);
    assert((await exportDelivery(other)).text === latest.text, "Stale correction overwrote a newer confirmation.");
    await other.locator("#correction-quantity").fill("4");
    await other.locator("#correction-reason").fill("Reviewed current quantities");
    await submit(other, "#correct-quantity");
    await waitReceived(other, COFFEE, 4);
    await waitReceived(page, COFFEE, 4);
    const corrected = await exportDelivery(other);
    assert(corrected.value.history.filter((action) => action.command.kind === "correct").length === 1, "Rejected correction entered audit history.");
    return { concurrentQuantities: quantities, refreshEvidence, revisionBeforeStaleCorrection: latest.value.revision, finalRevision: corrected.value.revision, exportSha256: corrected.sha256 };
  });

  await test("aborted actual IndexedDB write preserves prior visible and persisted state", async (page) => {
    await goto(page);
    await createDelivery(page, "Abort control");
    await addExpected(page);
    await selectProduct(page, COFFEE);
    await confirm(page, 2);
    await waitReceived(page, COFFEE, 2);
    const before = await exportDelivery(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      window.__receivingAbort = { staged: 0, aborted: 0 };
      IDBObjectStore.prototype.put = function (...args) {
        const request = Reflect.apply(original, this, args);
        if (this.name === "sessions" && this.transaction.mode === "readwrite") {
          IDBObjectStore.prototype.put = original;
          window.__receivingAbort.staged++;
          const transaction = this.transaction;
          request.addEventListener("success", () => {
            transaction.abort();
            window.__receivingAbort.aborted++;
          }, { once: true });
        }
        return request;
      };
    });
    await confirm(page, 3);
    await page.waitForFunction(() => window.__receivingAbort.aborted === 1 && document.querySelector("#receiving-message")?.textContent.includes("previous saved quantities are unchanged"));
    await waitReceived(page, COFFEE, 2);
    const after = await exportDelivery(page);
    assert(after.text === before.text, "Failed transaction changed visible/exported state.");
    const probe = await page.evaluate(() => window.__receivingAbort);
    assert(probe.staged === 1 && probe.aborted === 1, "Abort hook did not intercept exactly one real write.");
    await page.reload();
    await ready(page);
    await waitReceived(page, COFFEE, 2);
    assert((await exportDelivery(page)).text === before.text, "Aborted write survived reload.");
    return { probe, unchangedExportSha256: before.sha256, revision: before.value.revision };
  });

  await test("unreadable saved records remain untouched while valid and new deliveries work", async (page, context) => {
    await goto(page);
    const validId = await createDelivery(page, "Valid recovery control");
    await addExpected(page);
    await selectProduct(page, COFFEE);
    await confirm(page, 2);
    await waitReceived(page, COFFEE, 2);
    const corruptId = "corrupt-active-control";
    const corrupt = await corruptSaved(page, validId, corruptId);
    await page.close();
    const recovered = await context.newPage();
    await goto(recovered);
    assert(await recovered.locator("#delivery-select").inputValue() === validId, "Corrupt active record blocked valid fallback.");
    await recovered.locator("#storage-warning").waitFor({ state: "visible" });
    assert((await recovered.locator("#storage-warning").textContent()).includes("1 saved delivery"), "Unreadable record warning lost its count.");
    await selectProduct(recovered, COFFEE);
    await confirm(recovered, 1);
    await waitReceived(recovered, COFFEE, 3);
    const valid = await exportDelivery(recovered);
    assert(item(valid, COFFEE).received === 3, "Valid record could not be confirmed/exported after recovery.");
    const openedId = await createDelivery(recovered, "Open-record recovery control");
    await addExpected(recovered);
    await selectProduct(recovered, COFFEE);
    assert(JSON.stringify(await readSaved(recovered, corruptId)) === JSON.stringify(corrupt), "Recovery rewrote the corrupt record.");
    const openedCorrupt = await corruptSaved(recovered, openedId, openedId);
    await confirm(recovered, 1);
    await recovered.waitForFunction(() => document.querySelector("#receiving-message").dataset.error === "true" && document.querySelector("#delivery-select").selectedOptions[0].textContent.includes("unavailable"));
    await recovered.locator("#storage-warning").waitFor({ state: "visible" });
    assert(JSON.stringify(await readSaved(recovered, openedId)) === JSON.stringify(openedCorrupt), "Failed operation rewrote the now-unreadable open record.");
    await recovered.locator("#delivery-select").selectOption(validId);
    await waitReceived(recovered, COFFEE, 3);
    assert((await exportDelivery(recovered)).text === valid.text, "Unreadable open delivery blocked an existing valid delivery.");
    const onlyCorruptId = "only-corrupt-control";
    const onlyCorrupt = await corruptSaved(recovered, validId, onlyCorruptId, true);
    await recovered.close();
    const emptyRecovery = await context.newPage();
    await goto(emptyRecovery);
    assert(await emptyRecovery.locator("#delivery-select").inputValue() === "", "No-valid-record control unexpectedly adopted corrupt state.");
    await emptyRecovery.locator("#storage-warning").waitFor({ state: "visible" });
    assert(await emptyRecovery.locator("#item-code").isDisabled(), "Corrupt-only state enabled product operations.");
    const newId = await createDelivery(emptyRecovery, "Fresh after unreadable storage");
    await addExpected(emptyRecovery);
    assert(JSON.stringify(await readSaved(emptyRecovery, onlyCorruptId)) === JSON.stringify(onlyCorrupt), "Creating a fresh delivery removed or changed unreadable storage.");
    return { validSessionId: validId, validQuantity: 3, corruptRecordsPreserved: true, currentCorruptionReported: true, corruptOnlyNewSessionId: newId };
  });

  await test("mobile receiving controls remain usable without horizontal overflow", async (page) => {
    await goto(page);
    await createDelivery(page, "Mobile delivery");
    await addExpected(page);
    await selectProduct(page, COFFEE);
    await confirm(page, 1);
    await waitReceived(page, COFFEE, 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390px horizontal overflow.");
    await screenshot(page, "receiving-mobile.png");
    await page.setViewportSize({ width: 320, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "320px horizontal overflow.");
    await screenshot(page, "receiving-320.png");
    return { mobileWidths: [390, 320] };
  }, { width: 390, height: 844 });
} catch (error) {
  failures++;
  fatal = error instanceof Error ? error.message : String(error);
  console.error(`Receiving harness failed: ${fatal}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  if (process.env.RECEIVING_RESULTS_PATH) {
    const target = resolve(process.env.RECEIVING_RESULTS_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ recordedAt: new Date().toISOString(), base: BASE, filter: process.env.RECEIVING_TEST_FILTER ?? null, scope: "Desktop Chromium, generated QR fake camera and actual IndexedDB; no physical item/phone/vendor parity claim", failures, fatal, results }, null, 2) + "\n");
  }
  // Delete only this invocation's verified mkdtemp directory.
  const owned = resolve(fixtureDirectory);
  assert(dirname(owned) === resolve(tmpdir()) && basename(owned).startsWith("qrgen-receiving-"), "Refusing cleanup outside owned fixture directory.");
  rmSync(owned, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
