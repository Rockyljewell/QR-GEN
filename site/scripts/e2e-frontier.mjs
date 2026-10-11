// Real browser checks for the print-planning experiment. Requires npm run build.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

let BASE = process.env.E2E_BASE_URL;
const site = fileURLToPath(new URL("../", import.meta.url));
let server;
let serverLog = "";
let serverError;
let failures = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const url = (path) => new URL(path, BASE).href;
const goto = async (page, path) => {
  const response = await page.goto(url(path));
  assert(response?.ok(), `${path} returned HTTP ${response?.status() ?? "no response"} at ${page.url()}`);
};
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
if (!process.env.E2E_BASE_URL) {
  const port = await availablePort();
  BASE = `http://127.0.0.1:${port}/QR-GEN/`;
  const pkg = createRequire(import.meta.url).resolve("astro/package.json");
  server = spawn(process.execPath, [join(dirname(pkg), "bin", "astro.mjs"), "preview", "--port", String(port), "--host", "127.0.0.1", "--ignore-lock"], { cwd: site, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.on("error", (error) => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => (serverLog = (serverLog + chunk).slice(-4000)));
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (serverError) throw new Error(`Preview failed to launch: ${serverError.message}`);
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Preview exited before readiness: ${serverLog}`);
    if (/port\s+\d+\s+is in use/i.test(serverLog)) throw new Error(`Allocated preview port became occupied: ${serverLog}`);
    // The child must announce its own bound URL before a response can count as
    // readiness. Never accept a different chat's already-running preview.
    if (serverLog.includes(BASE)) {
      try {
        const response = await fetch(BASE);
        if (response.ok && server.exitCode === null && server.signalCode === null) { ready = true; break; }
      } catch { /* starting */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Preview did not start: ${serverLog}`);
}
console.log(`Print-planning browser checks against ${BASE}`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function test(name, run, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, acceptDownloads: true });
  // Fonts are optional and external; all QR assets must work without third parties.
  await context.route("**/*", (route) => new URL(route.request().url()).origin === new URL(BASE).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await run(page, context);
    assert(errors.length === 0, errors.join("; "));
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}: ${error.message}${errors.length ? `; browser errors: ${errors.join("; ")}` : ""}`);
  } finally { await context.close(); }
}
const ready = async (page) => page.locator('[data-plan-download="svg"]').waitFor({ state: "visible" }).then(() => page.waitForFunction(() => !document.querySelector('[data-plan-download="svg"]').disabled));
try {
  await test("print flow keeps physical SVG geometry and verifies exported pixels", async (page) => {
    await goto(page, "plan/");
    await ready(page);
    if (process.env.FRONTIER_SCREENSHOTS_DIR) {
      mkdirSync(process.env.FRONTIER_SCREENSHOTS_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.FRONTIER_SCREENSHOTS_DIR, "print-planner-desktop.png"), fullPage: true });
    }
    const expected = await page.locator('[name="content"]').inputValue();
    assert(await page.locator("[data-plan-payload]").textContent() === expected, "payload changed");
    await page.locator("[data-plan-verify]").click();
    await page.waitForFunction(() => document.querySelector("[data-plan-verification]").textContent.includes("Export checked:"));
    const waiting = page.waitForEvent("download");
    await page.locator('[data-plan-download="svg"]').click();
    const download = await waiting;
    const svg = readFileSync(await download.path(), "utf8");
    assert(/<svg[^>]+width="[\d.]+mm"/.test(svg), "SVG width isn't physical mm");
    assert(/<svg[^>]+height="[\d.]+mm"/.test(svg), "SVG height isn't physical mm");
    assert(/viewBox="0 0 \d+ \d+"/.test(svg), "SVG lost pixel viewBox");
    assert(download.suggestedFilename().includes("300dpi.svg"), "filename loses print settings");
  });
  await test("invalid and oversized plans invalidate old downloads immediately", async (page) => {
    await goto(page, "plan/");
    await ready(page);
    await page.locator('[name="content"]').fill("javascript:alert(1)");
    assert(await page.locator('[data-plan-download="svg"]').isDisabled(), "old export still enabled during debounce");
    await page.locator("[data-plan-error]").waitFor({ state: "visible" });
    assert(await page.locator("[data-plan-preview]").textContent() === "", "old preview retained");
    await page.locator('[name="kind"]').selectOption("text");
    await page.locator('[name="content"]').fill("long payload ".repeat(25));
    await page.locator('[name="widthMm"]').fill("5");
    await page.locator("[data-plan-error]").waitFor({ state: "visible" });
    assert(await page.locator('[data-plan-download="png"]').isDisabled(), "unsuitable raster can download");
    assert((await page.locator("[data-plan-error]").textContent()).includes("Allow at least"), "no concrete size remedy");
  });
  await test("Wi-Fi escaping and open-network transitions preserve intended content", async (page) => {
    await goto(page, "plan/");
    await page.locator('[name="kind"]').selectOption("wifi");
    await page.locator('[name="ssid"]').fill("Café; room:1");
    await page.locator('[name="password"]').fill("p;ass\\word");
    await ready(page);
    const encoded = await page.locator("[data-plan-payload]").textContent();
    assert(encoded.includes("S:Café\\; room\\:1;"), "SSID separators not escaped");
    assert(encoded.includes("P:p\\;ass\\\\word;"), "password escaping changed");
    await page.locator("[data-plan-verify]").click();
    await page.waitForFunction(() => document.querySelector("[data-plan-verification]").textContent.includes("Export checked:"));
    await page.locator('[name="security"]').selectOption("nopass");
    await ready(page);
    assert(!(await page.locator("[data-plan-payload]").textContent()).includes("P:"), "open network retained password");
  });
  await test("mobile layout stays usable and camera experiment is opt-in", async (page) => {
    await goto(page, "plan/");
    await ready(page);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile horizontal overflow");
    if (process.env.FRONTIER_SCREENSHOTS_DIR) await page.screenshot({ path: join(process.env.FRONTIER_SCREENSHOTS_DIR, "print-planner-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, class: element.getAttribute("class"), width: element.getBoundingClientRect().width })).slice(0, 10) }));
    if (process.env.FRONTIER_SCREENSHOTS_DIR) await page.screenshot({ path: join(process.env.FRONTIER_SCREENSHOTS_DIR, "print-planner-320.png"), fullPage: true });
    assert(overflow.scrollWidth <= overflow.width, `320px horizontal overflow: ${JSON.stringify(overflow.elements)}`);
    await page.locator('[name="kind"]').focus();
    await page.keyboard.press("Tab");
    assert(await page.locator('[name="content"]').evaluate((field) => document.activeElement === field), "content field not reachable by keyboard");
    await goto(page, "demo/");
    const initial = await page.evaluate(() => document.querySelector("#demo-scanner").options.adaptive);
    assert(initial === false, "adaptive capture became the default");
    await page.locator("[data-settings]").evaluate((details) => { details.open = true; });
    await page.locator('[data-opt="adaptive"]').check();
    assert(await page.evaluate(() => document.querySelector("#demo-scanner").options.adaptive) === true, "experiment toggle not applied");
  }, { width: 390, height: 844 });
  await test("existing generator handles clipboard completion and discards stale checks", async (page, context) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await goto(page, "demo/#generate");
    await page.waitForFunction(() => !document.querySelector('[data-gen="svg"]').disabled && !!document.querySelector('[data-gen-preview] svg'));
    await page.locator('[data-gen="copy-svg"]').click();
    await page.waitForFunction(() => document.querySelector('[data-gen="copy-svg"] span').textContent === "Copied");
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes("<svg"), "clipboard lacks SVG");
    await page.evaluate(() => {
      document.querySelector('[data-gen="test"]').click();
      const field = document.querySelector("[data-gen-data]");
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert(await page.locator('[data-gen="svg"]').isDisabled(), "old generic export remains enabled");
    await page.locator("[data-gen-error]").waitFor({ state: "visible" });
    assert(await page.locator("[data-gen-meta]").textContent() === "", "old verification overwrote current metadata");
  });
} finally {
  await browser.close();
  server?.kill();
}
if (failures) process.exitCode = 1;
