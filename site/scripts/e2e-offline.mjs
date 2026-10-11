// Requires a built site. All assets are served locally; no third parties are allowed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const basePath = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).pathname : "/QR-GEN/";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".wasm": "application/wasm" };

async function serve(initial = {}) {
  const state = { failWriter: false, corruptSdk: false, replacementVersion: null, compress: true, ...initial };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!pathname.startsWith(basePath)) { response.writeHead(404).end(); return; }
      if (pathname === `${basePath}offline-observer/`) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end('<!doctype html><meta charset="utf-8"><title>Offline update observer</title>');
        return;
      }
      if (state.failWriter && pathname.endsWith("/zxing_writer.wasm")) { response.writeHead(503).end("Test installation failure"); return; }
      let path = resolve(dist, pathname.slice(basePath.length));
      if (path !== resolve(dist) && !path.startsWith(resolve(dist) + sep)) { response.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      let body = await readFile(path);
      if (state.corruptSdk && pathname.endsWith("/sdk/qrgen.js")) body = Buffer.concat([body, Buffer.from("\n// Valid JavaScript from the wrong deployment.\n")]);
      if (state.replacementVersion && pathname.endsWith("/offline/")) {
        body = Buffer.from(body.toString("utf8").replace(/data-offline-version="[a-f0-9]{20}"/, `data-offline-version="${state.replacementVersion}"`)
          .replace(/client\.js\?v=[a-f0-9]{20}/, `client.js?v=${state.replacementVersion}`));
      }
      const suffix = Object.keys(types).find((type) => path.endsWith(type));
      const encoded = state.compress ? gzipSync(body) : body;
      response.writeHead(200, {
        "content-type": types[suffix] ?? "application/octet-stream", "cache-control": "no-store",
        "content-length": encoded.length,
        ...(state.compress ? { "content-encoding": "gzip" } : {}),
      }).end(encoded);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return { server, state, base: `http://127.0.0.1:${server.address().port}${basePath}` };
}

const normal = process.env.E2E_BASE_URL ? null : await serve();
const base = process.env.E2E_BASE_URL ?? normal.base;
const failure = await serve({ failWriter: true });
const updates = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;

async function test(name, root, run) {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "allow", viewport: { width: 390, height: 844 } });
  const origin = new URL(root).origin;
  const external = [];
  const errors = [];
  const requests = [];
  const consoleMessages = [];
  context.on("request", (request) => {
    requests.push(request.url());
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url());
  });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleMessages.push(message.text()); });
  try {
    await run(page, context);
    assert(!external.length, `Unexpected third-party requests: ${external.join(", ")}`);
    assert(!errors.length, errors.join("; "));
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}: ${error.message}`);
    if (!page.isClosed()) {
      try {
        console.error("    Diagnostic state:", JSON.stringify(await page.evaluate(async () => ({
          status: document.querySelector("[data-offline-status]")?.outerHTML,
          registrations: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
            scope: registration.scope, active: registration.active?.state, waiting: registration.waiting?.state, installing: registration.installing?.state,
          })) : [],
          caches: typeof caches !== "undefined" ? await caches.keys() : [],
        }))));
      } catch (diagnosticError) { console.error(`    Could not inspect page: ${diagnosticError.message}`); }
    }
    console.error("    Page errors:", JSON.stringify(errors), "Console errors:", JSON.stringify(consoleMessages));
    console.error("    Requests:", JSON.stringify(requests));
  } finally { await context.close(); }
}

try {
  await test("saved tools reload, generate and decode an image with the network offline", base, async (page, context) => {
    const offlineUrl = new URL("offline/", base).href;
    await page.goto(`${offlineUrl}?utm_source=offline-test`);
    await page.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    const installed = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      return { scope: registration.scope, script: navigator.serviceWorker.controller.scriptURL, cacheKeys: keys, assets: await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url))) };
    });
    assert(installed.scope === offlineUrl, "Worker scope extends beyond offline tools");
    assert(installed.assets.flat().length === 5, "Offline shell or engine assets missing");
    assert(installed.assets.flat().some((url) => url.includes("/sdk/wasm/zxing_reader.wasm?v=")), "Reader WASM is not explicitly saved");
    assert(installed.assets.flat().some((url) => url.includes("/sdk/wasm/zxing_writer.wasm?v=")), "Writer WASM is not explicitly saved");
    const headersValid = await page.evaluate(async () => {
      const responses = await Promise.all((await caches.keys()).map(async (name) => {
        const cache = await caches.open(name);
        return Promise.all((await cache.keys()).map((request) => cache.match(request)));
      }));
      return responses.flat().every((response) => !response.headers.has("content-encoding") && !response.headers.has("content-length") && !response.headers.has("transfer-encoding"));
    });
    assert(headersValid, "Decoded cache responses retained stale compression/length headers");
    await context.setOffline(true);
    await page.reload();
    await page.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile layout overflows");
    const payload = "Offline Café — 東京 🌍 / private-test-9fe26";
    await page.locator("#offline-kind").selectOption("text");
    await page.locator("#offline-content").fill(payload);
    await page.locator("[data-offline-generate]").click();
    await page.waitForFunction(() => !document.querySelector("[data-offline-download]").disabled);
    const downloading = page.waitForEvent("download");
    await page.locator("[data-offline-download]").click();
    const download = await downloading;
    const png = readFileSync(await download.path());
    await page.locator("[data-offline-image]").setInputFiles({ name: "offline-check.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction((expected) => document.querySelector("[data-offline-results]").textContent.includes(expected), payload);
    assert(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), "Content was saved to web storage");
    const cachedUrls = await page.evaluate(async () => {
      const requests = await Promise.all((await caches.keys()).map(async (key) => (await caches.open(key)).keys()));
      return requests.flat().map((request) => request.url);
    });
    assert(!cachedUrls.some((url) => url.includes("private-test")), "User content entered the cache");
    await page.locator("#offline-kind").selectOption("url");
    await page.locator("#offline-content").fill("https://example.com/offline?x=%2f&x=+");
    await page.locator("[data-offline-generate]").click();
    await page.waitForFunction(() => !document.querySelector("[data-offline-download]").disabled);
    let homeLoaded = false;
    try { await page.goto(base, { timeout: 10000 }); homeLoaded = true; } catch { /* another page is intentionally outside this worker */ }
    assert(!homeLoaded, "Offline worker intercepted the unrelated home page");
  });

  await test("failed engine installation never claims offline readiness", failure.base, async (page) => {
    await page.goto(new URL("offline/", failure.base).href);
    await page.locator('[data-offline-status][data-state="unavailable"]').waitFor({ timeout: 30000 });
    const saved = await page.evaluate(async () => ({ caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller }));
    assert(saved.caches.length === 0, "A failed installation left a partial offline cache");
    assert(!saved.controlled, "A failed installation took control");
    assert(!(await page.locator("[data-offline-status]").textContent()).includes("Saved and checked"), "Failed installation reported ready");
  });

  await test("failed replacement preserves the working copy and a valid update activates after old tabs close", updates.base, async (page, context) => {
    const offlineUrl = new URL("offline/", updates.base).href;
    await page.goto(offlineUrl);
    await page.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    const original = await page.evaluate(async () => ({ version: document.querySelector("[data-offline-version]").dataset.offlineVersion, caches: await caches.keys() }));
    const replacement = original.version === "b".repeat(20) ? "c".repeat(20) : "b".repeat(20);
    updates.state.replacementVersion = replacement;
    updates.state.corruptSdk = true;
    await page.reload();
    await page.locator('[data-offline-status][data-state="unavailable"]').waitFor({ timeout: 30000 });
    assert((await page.evaluate(async () => await caches.keys())).join() === original.caches.join(), "Failed replacement damaged the previous cache or left a partial cache");
    await context.setOffline(true);
    await page.reload();
    await page.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    assert(await page.locator("[data-offline-version]").getAttribute("data-offline-version") === original.version, "Rollback did not load the previous shell");
    await page.locator("#offline-kind").selectOption("text");
    await page.locator("#offline-content").fill("Working offline copy after failed update");
    await page.locator("[data-offline-generate]").click();
    await page.waitForFunction(() => !document.querySelector("[data-offline-download]").disabled);
    await context.setOffline(false);
    updates.state.corruptSdk = false;
    await page.reload();
    await page.locator('[data-offline-status][data-state="update-pending"]').waitFor({ timeout: 30000 });
    // A same-origin page outside /offline/ can observe registration activation
    // without keeping an old offline client open or evaluating a waiting worker.
    const observer = await context.newPage();
    await observer.goto(new URL("offline-observer/", updates.base).href);
    await page.close();
    await observer.waitForFunction(async ({ offlineUrl, replacement }) => {
      const registration = await navigator.serviceWorker.getRegistration(offlineUrl);
      return registration?.active?.state === "activated" && new URL(registration.active.scriptURL).searchParams.get("v") === replacement;
    }, { offlineUrl, replacement }, { timeout: 15000 });
    await observer.close();
    const fresh = await context.newPage();
    await fresh.goto(offlineUrl);
    await fresh.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    await context.setOffline(true);
    await fresh.reload();
    await fresh.locator('[data-offline-status][data-state="ready"]').waitFor({ timeout: 30000 });
    assert(await fresh.locator("[data-offline-version]").getAttribute("data-offline-version") === replacement, "Replacement shell was not retained offline");
    const cachesLeft = await fresh.evaluate(async () => await caches.keys());
    assert(cachesLeft.length === 1 && cachesLeft[0].endsWith(replacement), "Update did not clean only its previous version");
  });

  await test("first-ever offline visit cannot load an unsaved shell", base, async (page, context) => {
    await context.setOffline(true);
    let loaded = false;
    try { await page.goto(new URL("offline/", base).href, { timeout: 10000 }); loaded = true; } catch { /* expected cold-offline failure */ }
    assert(!loaded, "Unsaved tools unexpectedly loaded offline");
  });
} finally {
  await browser.close();
  if (normal) await new Promise((closed) => normal.server.close(closed));
  await new Promise((closed) => failure.server.close(closed));
  await new Promise((closed) => updates.server.close(closed));
}
if (failures) process.exitCode = 1;
