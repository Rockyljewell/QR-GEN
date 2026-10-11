// End-to-end tests for the website and the web SDK in a real Chromium, with fake camera
// videos (Y4M) containing barcodes. Usage: npm run build && npm run test:e2e
//   E2E_BASE_URL=http://127.0.0.1:4321/QR-GEN/   use an already running server
//   CHROMIUM_PATH=/path/to/chrome                 use a specific browser binary
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { writeFakeCamera } from "./fake-camera.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4329/QR-GEN/";
const tmp = mkdtempSync(join(tmpdir(), "qrgen-e2e-"));
let server;
let serverLog = "";
let failures = 0;

async function startServer() {
  if (process.env.E2E_BASE_URL) return;
  // Run astro's CLI with node directly (not through npx) so kill() stops the server
  // itself; a surviving grandchild would keep this process alive after the tests.
  const pkg = createRequire(import.meta.url).resolve("astro/package.json");
  const bin = join(dirname(pkg), "bin", "astro.mjs");
  server = spawn(process.execPath, [bin, "preview", "--port", "4329", "--host", "127.0.0.1", "--ignore-lock"], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (d) => (serverLog = (serverLog + d).slice(-4000)));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview server did not start\n${serverLog}`);
}

const IGNORED_CONSOLE = /ERR_CERT|ERR_TOO_MANY_RETRIES|fonts\.g(oogleapis|static)|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_TUNNEL|ERR_PROXY/;

async function withBrowser(video, fn) {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  try {
    await fn(page, errors);
  } finally {
    await browser.close();
  }
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const u = (path) => new URL(path, BASE).href;

process.on("exit", () => server?.kill());
await startServer();
const qrVideo = join(tmp, "qr.y4m");
const multiVideo = join(tmp, "multi.y4m");
const polarityVideo = join(tmp, "mixed-polarity.y4m");
await writeFakeCamera(qrVideo, [{ data: "https://rockyljewell.github.io/QR-GEN/e2e", symbology: "qr", x: 230, y: 150, module: 6 }]);
await writeFakeCamera(multiVideo, [
  { data: "https://rockyljewell.github.io/QR-GEN/a", symbology: "qr", x: 60, y: 120, module: 5 },
  { data: "(01)09501101530003(17)271231(10)LOT4815", symbology: "data-matrix", gs1: true, x: 400, y: 140, module: 7 },
  { data: "5901234123457", symbology: "ean13", x: 150, y: 360, module: 3 },
]);

await writeFakeCamera(polarityVideo, [
  { data: "DUP-128", symbology: "code128", x: 30, y: 200, module: 2 },
  { data: "DUP-128", symbology: "code128", x: 370, y: 200, module: 2, inverted: true },
]);

console.log(`QRGen e2e against ${BASE}`);

await test("pages render without errors", async () => {
  await withBrowser(null, async (page, errors) => {
    for (const path of ["", "sdk/", "agent-skills/", "demo/", "docs/", "docs/quick-start/", "docs/react/", "products/barcode-scanning/", "products/batch-scanning/", "products/id-scanning/", "products/barcode-generator/", "solutions/", "pricing/", "about/"]) {
      const res = await page.goto(u(path), { waitUntil: "load" });
      assert(res?.ok(), `${path} returned ${res?.status()}`);
      const h1 = await page.locator("h1").first().textContent();
      assert(h1 && h1.trim().length > 3, `${path} has no h1`);
    }
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("SDK hero shows install commands and copy works", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("sdk/"));
    const text = await page.locator("#sdk-terminal").textContent();
    assert(text.includes("npx skills add https://github.com/Rockyljewell/QR-GEN"), "missing npx skills command");
    assert(text.includes("/plugin install qrgen-sdk@qrgen-plugins"), "missing plugin command");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#sdk-terminal .panel:not([hidden]) .copy-btn").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip.includes("npx skills add"), `clipboard was "${clip.slice(0, 60)}"`);
    await page.locator('#sdk-terminal [data-tab="1"]').click();
    assert(await page.locator("#sdk-terminal-code-1").isVisible(), "agent prompt tab not shown");
  });
});

await test("home scanner decodes a QR code from the camera", async () => {
  await withBrowser(qrVideo, async (page, errors) => {
    await page.goto(u(""), { waitUntil: "load" });
    const result = page.evaluate(
      () => new Promise((resolve) => document.querySelector("[data-home-scanner]").addEventListener("scan", (e) => resolve(e.detail.barcode), { once: true })),
    );
    await page.locator("[data-home-scanner]").scrollIntoViewIfNeeded();
    await page.locator("[data-home-scanner]").locator('button[data-a="start"]').click();
    const b = await Promise.race([result, new Promise((r) => setTimeout(() => r(null), 15000))]);
    assert(b, "no scan within 15 s");
    assert(b.symbology === "qr" && b.data === "https://rockyljewell.github.io/QR-GEN/e2e", `unexpected ${JSON.stringify(b).slice(0, 120)}`);
    assert(b.location.topLeft.x > 200 && b.location.topLeft.x < 260, `location off: ${JSON.stringify(b.location.topLeft)}`);
    const engine = await page.evaluate(() => document.querySelector("[data-home-scanner]").scanner.stats.engine);
    assert(engine === "worker", `engine was ${engine}`);
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("demo batch mode tracks three codes", async () => {
  await withBrowser(multiVideo, async (page) => {
    await page.goto(u("demo/"));
    await page.click('[data-mode="batch"]');
    await page.locator("#demo-scanner").locator('button[data-a="start"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".result-item").length >= 3, null, { timeout: 20000 });
    const syms = await page.$$eval(".result-item .r-sym", (n) => n.map((x) => x.textContent).sort());
    assert(JSON.stringify(syms) === JSON.stringify(["Data Matrix", "EAN-13", "QR Code"]), `got ${syms}`);
    const gs1 = await page.locator(".result-item", { hasText: "Data Matrix" }).textContent();
    assert(gs1.includes("2027-12-31") && gs1.includes("LOT4815"), "GS1 parse not shown");
  });
});

await test("batch results support keyboard selection outside a stable preview", async () => {
  await withBrowser(null, async (page, errors) => {
    await page.goto(u("embed/"));
    await page.addScriptTag({ url: u("sdk/qrgen.iife.js") });
    const before = await page.evaluate(() => {
      document.querySelector("qrgen-scanner")?.remove();
      const el = document.createElement("qrgen-scanner");
      el.id = "selection-test";
      el.autostart = false;
      el.mode = "batch";
      el.style.cssText = "width:320px;height:480px";
      document.body.append(el);
      const height = el.shadowRoot.querySelector(".preview").getBoundingClientRect().height;
      const location = { topLeft: { x: 20, y: 20 }, topRight: { x: 80, y: 20 }, bottomRight: { x: 80, y: 80 }, bottomLeft: { x: 20, y: 80 } };
      el.tracked = [1, 2].map((id) => ({ id, data: "<b>same value</b>", symbology: "qr", symbologyName: "QR Code", location }));
      el.updateCount();
      el.updateResults();
      return height;
    });
    const el = page.locator("#selection-test");
    const rows = el.locator(".result");
    assert(await rows.count() === 2, "identical values should have separate rows");
    assert(await rows.first().locator("b").count() === 0, "payload became HTML");
    await rows.first().focus();
    await page.keyboard.press("Space");
    assert(await rows.first().getAttribute("aria-pressed") === "true", "Space did not select");
    assert((await el.locator(".count").textContent()) === "2 barcodes in view", "selection changed detected total");
    const bounds = await el.evaluate((node) => {
      const preview = node.shadowRoot.querySelector(".preview").getBoundingClientRect();
      const results = node.shadowRoot.querySelector(".results").getBoundingClientRect();
      return { height: preview.height, bottom: preview.bottom, top: results.top, zoom: !!node.shadowRoot.querySelector('[data-a="zoom"]') };
    });
    assert(bounds.height === before && bounds.top >= bounds.bottom, "results overlap or resize preview");
    assert(!bounds.zoom, "unexpected preset zoom control");
    await el.locator("canvas").click({ force: true, position: { x: 160, y: 150 } });
    assert((await el.evaluate((node) => node.selection.length)) === 1, "preview click changed selection");
    await el.evaluate((node) => { node.tracked = []; node.updateCount(); node.updateResults(); });
    assert(await rows.count() === 1 && (await rows.first().textContent()).includes("out of view"), "selected result was lost");
    await rows.first().focus();
    await page.keyboard.press("Enter");
    assert(await rows.count() === 0, "Enter did not deselect an out-of-view result");
    await el.evaluate((node) => { node.mode = "continuous"; });
    assert(!await el.locator(".results").isVisible(), "results remained visible outside batch mode");
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("worker batch tracks both polarities of the same Code 128 payload", async () => {
  await withBrowser(polarityVideo, async (page, errors) => {
    await page.goto(u("demo/"));
    await page.click('[data-mode="batch"]');
    await page.evaluate(() => {
      const el = document.querySelector("#demo-scanner");
      el.setAttribute("symbologies", "code128");
      // Exercise decoding of the whole synthetic feed, including codes outside
      // the demo element's automatically cropped visible preview.
      el.scanArea = { x: 0, y: 0, width: 1, height: 1 };
      window.__polarityTracks = [];
      el.addEventListener("track", (event) => { window.__polarityTracks = event.detail.tracked; });
    });
    await page.locator("#demo-scanner").locator('button[data-a="start"]').click();
    try {
      await page.waitForFunction(() => window.__polarityTracks.filter((b) => b.data === "DUP-128").length === 2, null, { timeout: 20000 });
    } catch {
      const diagnostic = await page.evaluate(() => {
        const el = document.querySelector("#demo-scanner");
        return { tracks: window.__polarityTracks, options: el.options, state: el.state, stats: el.scanner?.stats };
      });
      throw new Error(`Mixed-polarity tracking did not reach two instances: ${JSON.stringify(diagnostic)}; ${errors.join("; ")}`);
    }
    const result = await page.evaluate(() => ({
      tracks: window.__polarityTracks,
      engine: document.querySelector("#demo-scanner").scanner.stats.engine,
    }));
    assert(result.engine === "worker", `engine was ${result.engine}`);
    assert(new Set(result.tracks.map((b) => b.id)).size === 2, "physical instances share an ID");
    const xs = result.tracks.map((b) => b.location.topLeft.x).sort((a, b) => a - b);
    assert(xs[0] < 100 && xs[1] > 300, `locations off: ${xs}`);
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("encoded browser images decode inverted Code 128 without changing input", async () => {
  await withBrowser(null, async (page, errors) => {
    await page.goto(u("demo/"));
    const result = await page.evaluate(async (sdkUrl) => {
      const sdk = await import(sdkUrl);
      const generated = await sdk.generate("INVERTED-FILE-128", { symbology: "code128", scale: 3, foreground: "#ffffff", background: "#000000" });
      const bytes = new Uint8Array(await generated.png.arrayBuffer());
      const before = bytes.slice();
      const found = await sdk.scanImage(bytes, { symbologies: ["code128"] });
      const disabled = await sdk.scanImage(bytes, { symbologies: ["code128"], tryInvert: false });
      const transparent = await sdk.generate("TRANSPARENT-FILE-QR", { background: "transparent" });
      const transparentBytes = new Uint8Array(await transparent.png.arrayBuffer());
      const transparentBlobFound = await sdk.scanImage(transparent.png, { symbologies: ["qr"] });
      const transparentBytesFound = await sdk.scanImage(transparentBytes, { symbologies: ["qr"] });
      const bitmap = await createImageBitmap(generated.png);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const jpeg = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 1))).arrayBuffer());
      // APP1 Exif, big-endian TIFF, orientation 6 (90 degrees clockwise).
      const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0]);
      const rotated = new Uint8Array(jpeg.length + exif.length);
      rotated.set(jpeg.subarray(0, 2));
      rotated.set(exif, 2);
      rotated.set(jpeg.subarray(2), 2 + exif.length);
      const rotatedBefore = rotated.slice();
      const rotatedFound = await sdk.scanImage(rotated, { symbologies: ["code128"] });
      const b = rotatedFound[0];
      return {
        codes: found.map((b) => [b.symbology, b.data]), disabled: disabled.length,
        unchanged: bytes.every((v, i) => v === before[i]) && rotated.every((v, i) => v === rotatedBefore[i]),
        rotated: b ? { data: b.data, size: b.frameSize, location: b.location } : null,
        expectedRotatedSize: { width: canvas.height, height: canvas.width },
        transparent: [transparentBlobFound.map((b) => b.data), transparentBytesFound.map((b) => b.data)],
      };
    }, u("sdk/qrgen.js"));
    assert(JSON.stringify(result.codes) === JSON.stringify([["code128", "INVERTED-FILE-128"]]), JSON.stringify(result));
    assert(result.disabled === 0 && result.unchanged, JSON.stringify(result));
    assert(JSON.stringify(result.transparent) === JSON.stringify([["TRANSPARENT-FILE-QR"], ["TRANSPARENT-FILE-QR"]]), JSON.stringify(result));
    assert(result.rotated?.data === "INVERTED-FILE-128", JSON.stringify(result));
    assert(JSON.stringify(result.rotated.size) === JSON.stringify(result.expectedRotatedSize), JSON.stringify(result));
    assert(Object.values(result.rotated.location).every((p) => p.x >= 0 && p.y >= 0 && p.x <= result.rotated.size.width && p.y <= result.rotated.size.height), JSON.stringify(result));
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("demo single mode stops after one scan and resumes", async () => {
  await withBrowser(qrVideo, async (page) => {
    await page.goto(u("demo/"));
    await page.click('[data-mode="single"]');
    await page.locator("#demo-scanner").locator('button[data-a="start"]').click();
    await page.waitForFunction(() => document.querySelector("#demo-scanner").state === "paused", null, { timeout: 15000 });
    assert((await page.locator(".result-item").count()) === 1, "expected exactly one result");
    await page.locator("#demo-scanner").locator('button[data-a="again"]').click();
    await page.waitForFunction(() => document.querySelector("#demo-scanner").state === "paused", null, { timeout: 15000 });
  });
});

for (const action of ["stop", "unmount"]) {
  await test(`late camera permission is released after ${action}`, async () => {
    await withBrowser(qrVideo, async (page, errors) => {
      await page.goto(u("demo/"));
      const result = await page.evaluate(async (action) => {
        const media = navigator.mediaDevices;
        const original = media.getUserMedia.bind(media);
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        let acquired;
        const captured = new Promise((resolve) => { acquired = resolve; });
        media.getUserMedia = async (constraints) => {
          const stream = await original(constraints);
          acquired(stream);
          await gate;
          return stream;
        };
        const el = document.createElement("qrgen-scanner");
        el.autostart = false;
        el.beep = false;
        el.vibrate = false;
        document.body.append(el);
        let ready = 0;
        el.addEventListener("ready", () => ready++);
        try {
          const starting = el.start();
          const stream = await Promise.race([
            captured,
            starting.then(() => { throw new Error("camera start finished before permission was released"); }),
          ]);
          const scanner = el.scanner;
          if (action === "stop") el.stop();
          else el.remove();
          release();
          await starting;
          return {
            state: scanner.state, ready,
            tracks: stream.getTracks().map((track) => track.readyState),
            attached: scanner.video.srcObject !== null,
          };
        } finally {
          release();
          media.getUserMedia = original;
          el.remove();
        }
      }, action);
      assert(result.tracks.every((state) => state === "ended"), `live camera after ${action}: ${JSON.stringify(result)}`);
      assert(!result.attached && result.ready === 0, JSON.stringify(result));
      assert(result.state === (action === "stop" ? "stopped" : "idle"), JSON.stringify(result));
      assert(errors.length === 0, errors.join("; "));
    });
  });
}

await test("demo image samples decode", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("demo/#image"));
    const expect = { label: 2, parcel: 3, license: 1, many: 12 };
    for (const [sample, count] of Object.entries(expect)) {
      await page.click(`[data-sample="${sample}"]`);
      await page.waitForFunction((n) => document.querySelectorAll("[data-img-results] .result-item").length === n, count, { timeout: 20000 });
      if (sample === "license") {
        const id = await page.locator("[data-img-results]").textContent();
        assert(id.includes("JANE Q SAMPLE") && id.includes("21+ verified"), "license not parsed");
      }
    }
  });
});

await test("demo generator renders every writable symbology and scans back", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("demo/#generate"));
    const ids = await page.$$eval("[data-gen-symbology] option", (o) => o.map((x) => x.value));
    assert(ids.length >= 20, `only ${ids.length} symbologies`);
    for (const id of ids) {
      await page.selectOption("[data-gen-symbology]", id);
      await page.waitForFunction(() => !!document.querySelector("[data-gen-preview] svg"), null, { timeout: 5000 });
      const err = await page.locator("[data-gen-error]").isVisible();
      assert(!err, `${id}: ${await page.textContent("[data-gen-error]")}`);
    }
    await page.selectOption("[data-gen-symbology]", "qr");
    await page.waitForTimeout(300);
    await page.click('[data-gen="test"]');
    await page.waitForFunction(() => document.querySelector("[data-gen-meta]").textContent.startsWith("Scanned back"), null, { timeout: 5000 });
  });
});

await test("embed page talks to its host through postMessage", async () => {
  await withBrowser(qrVideo, async (page) => {
    await page.goto(u(""), { waitUntil: "domcontentloaded" });
    const embed = u("embed/?symbologies=qr&mode=single&beep=0");
    const got = await page.evaluate(
      (src) =>
        new Promise((resolve) => {
          const seen = [];
          addEventListener("message", (e) => {
            if (e.data?.source !== "qrgen") return;
            seen.push(e.data.type);
            if (e.data.type === "scan") {
              e.source.postMessage({ source: "qrgen-host", type: "stop" }, "*");
              setTimeout(() => resolve({ seen, data: e.data.barcodes[0].data }), 600);
            }
          });
          const f = document.createElement("iframe");
          f.allow = "camera";
          f.src = src;
          f.style.cssText = "width:500px;height:500px";
          document.body.append(f);
          setTimeout(() => resolve({ seen, data: null }), 15000);
        }),
      embed,
    );
    assert(got.data === "https://rockyljewell.github.io/QR-GEN/e2e", `no scan message (${got.seen})`);
    assert(got.seen.includes("ready"), "no ready message");
    assert(got.seen.filter((t) => t === "state").length >= 2, "stop command had no effect");
  });
});

await test("share dialog links every network, copies the link and shows a scannable QR", async () => {
  await withBrowser(null, async (page, errors) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(u("pricing/"));
    await page.click(".header-actions [data-share-open]");
    await page.waitForSelector("[data-share][open]");
    const info = await page.evaluate(() => {
      const d = document.querySelector("[data-share]");
      return { url: d.dataset.shareUrl, targets: [...d.querySelectorAll("[data-share-target]")].map((a) => [a.dataset.shareTarget, a.getAttribute("href")]) };
    });
    assert(info.url.endsWith("/pricing/"), `share url ${info.url}`);
    const ids = info.targets.map(([id]) => id).join(",");
    assert(ids === "x,linkedin,facebook,reddit,hackernews,bluesky,mastodon,threads,whatsapp,telegram,email,sms", `targets ${ids}`);
    for (const [id, href] of info.targets) assert(href.includes(encodeURIComponent(info.url)), `${id} link lacks the page URL: ${href}`);
    await page.click("[data-share] [data-copy]");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip === info.url, `clipboard was "${clip}"`);
    await page.click('[data-share] [data-share-target="mastodon"]');
    assert(await page.locator("[data-mastodon]").isVisible(), "Mastodon server form not shown");
    const decoded = await page.evaluate(async (sdk) => {
      const { scanImage } = await import(sdk);
      const svg = document.querySelector("[data-share-qr] svg").cloneNode(true);
      svg.setAttribute("width", "400");
      svg.setAttribute("height", "400");
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await img.decode();
      return (await scanImage(img, { symbologies: ["qr"] }))[0]?.data;
    }, u("sdk/qrgen.js"));
    assert(decoded === info.url, `QR decoded to ${decoded}`);
    await page.keyboard.press("Escape");
    assert(!(await page.locator("[data-share]").evaluate((d) => d.open)), "dialog did not close");
    // Footer strip: inline networks, copy link and "More" re-opens the dialog.
    const footer = await page.locator(".footer-share-list [data-share-target]").count();
    assert(footer === 8, `footer has ${footer} networks`);
    await page.click(".footer-share-list [data-share-open]");
    assert(await page.locator("[data-share]").evaluate((d) => d.open), "footer More did not open the dialog");
    assert(errors.length === 0, errors.join("; "));
  });
});
await test("search finds docs", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("docs/"));
    await page.keyboard.press("Control+k");
    await page.fill("[data-search-input]", "react");
    await page.waitForFunction(() => document.querySelectorAll(".search-results a").length > 0, null, { timeout: 5000 });
    const first = await page.locator(".search-results a").first().textContent();
    assert(/react/i.test(first), `first result: ${first}`);
  });
});

await test("llms.txt, llms-full.txt, agent-prompt.txt, search.json and downloads are served", async () => {
  const llms = await (await fetch(u("llms.txt"))).text();
  assert(llms.startsWith("# QRGen") && llms.includes("/docs/quick-start/"), "llms.txt");
  const full = await (await fetch(u("llms-full.txt"))).text();
  assert(full.length > 20000 && full.includes("# Quick start"), "llms-full.txt");
  const prompt = await (await fetch(u("agent-prompt.txt"))).text();
  assert(prompt.includes("qrgen-sdk"), "agent-prompt.txt");
  const search = await (await fetch(u("search.json"))).json();
  assert(Array.isArray(search) && search.length > 30, "search.json");
  for (const f of ["sdk/qrgen.js", "sdk/qrgen.iife.js", "sdk/wasm/zxing_reader.wasm", "sdk/wasm/zxing_writer.wasm", "downloads/qrgen-sdk.tgz"]) {
    const r = await fetch(u(f), { method: "HEAD" });
    assert(r.ok, `${f}: ${r.status}`);
  }
});

await test("queued scanner autostart respects same-turn removal, stop and disabling", async () => {
  await withBrowser(null, async (page, errors) => {
    await page.goto(u("embed/"));
    await page.addScriptTag({ url: u("sdk/qrgen.iife.js") });
    const out = await page.evaluate(async () => {
      const original = navigator.mediaDevices.getUserMedia;
      let cameraRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        cameraRequests++;
        throw new DOMException("Unexpected camera request", "NotAllowedError");
      };
      const elements = [];
      try {
        for (const action of ["remove", "stop", "disable"]) {
          const el = document.createElement("qrgen-scanner");
          elements.push(el);
          document.body.append(el);
          if (action === "remove") el.remove();
          if (action === "stop") el.stop();
          if (action === "disable") el.autostart = false;
        }
        await Promise.resolve();
        await Promise.resolve();
        return { cameraRequests, scanners: elements.map((el) => el.scanner !== null) };
      } finally {
        elements.forEach((el) => el.remove());
        navigator.mediaDevices.getUserMedia = original;
      }
    });
    assert(out.cameraRequests === 0 && out.scanners.every((created) => !created), JSON.stringify(out));
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("reconnected scanner keeps one autostart and one handler per control click", async () => {
  await withBrowser(null, async (page, errors) => {
    await page.goto(u("embed/"));
    await page.addScriptTag({ url: u("sdk/qrgen.iife.js") });
    const out = await page.evaluate(async () => {
      const el = document.createElement("qrgen-scanner");
      let starts = 0;
      let torchClicks = 0;
      el.start = async () => { starts++; };
      el.toggleTorch = async () => { torchClicks++; return false; };
      document.body.append(el);
      el.remove();
      document.body.append(el);
      await Promise.resolve();
      const button = el.shadowRoot.querySelector('[data-a="torch"]');
      button.hidden = false;
      button.click();
      el.remove();
      return { starts, torchClicks };
    });
    assert(out.starts === 1 && out.torchClicks === 1, JSON.stringify(out));
    assert(errors.length === 0, errors.join("; "));
  });
});

await test("element properties accept booleans and strings (React 19 / Vue)", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("embed/"));
    await page.addScriptTag({ url: u("sdk/qrgen.iife.js") });
    const out = await page.evaluate(() => {
      const el = document.createElement("qrgen-scanner");
      el.autostart = "false";
      el.beep = false;
      el.vibrate = "false";
      el.torch = true;
      el.symbologies = ["qr", "ean13"];
      document.body.append(el);
      const r = { autostart: el.autostart, beep: el.beep, vibrate: el.vibrate, torch: el.torch, syms: el.getAttribute("symbologies"), state: el.state, styled: el.shadowRoot.adoptedStyleSheets.length };
      el.remove();
      return r;
    });
    assert(out.autostart === false && out.beep === false && out.vibrate === false && out.torch === true, JSON.stringify(out));
    assert(out.syms === "qr,ean13" && out.state === "idle", JSON.stringify(out));
    assert(out.styled === 1, "constructable stylesheet not used");
  });
});

await test("CDN IIFE build works from a plain script tag", async () => {
  await withBrowser(null, async (page) => {
    await page.goto(u("embed/"));
    await page.addScriptTag({ url: u("sdk/qrgen.iife.js") });
    const out = await page.evaluate(async () => {
      const g = await window.QRGen.generate("iife works", { symbology: "qr" });
      const found = await window.QRGen.scanImage(g.png);
      return { data: found[0]?.data, hasScanner: typeof window.QRGen.BarcodeScanner === "function", el: !!customElements.get("qrgen-scanner") };
    });
    assert(out.data === "iife works" && out.hasScanner && out.el, JSON.stringify(out));
  });
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll e2e tests passed");
process.exit(0);
