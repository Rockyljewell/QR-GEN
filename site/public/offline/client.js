// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

const get = (selector) => document.querySelector(selector);
const version = get("[data-offline-version]").dataset.offlineVersion;
const assetHashes = JSON.parse(get("[data-offline-version]").dataset.offlineHashes);
const scope = new URL("./", import.meta.url);
const asset = (path) => new URL(`${path}?v=${version}`, scope).href;
const status = get("[data-offline-status]");
const form = get("[data-offline-form]");
const content = get("#offline-content");
const generateButton = get("[data-offline-generate]");
const downloadButton = get("[data-offline-download]");
const imageInput = get("[data-offline-image]");
const preview = get("[data-offline-preview]");
const createStatus = get("[data-offline-create-status]");
const createError = get("[data-offline-create-error]");
const scanStatus = get("[data-offline-scan-status]");
const scanError = get("[data-offline-scan-error]");
const results = get("[data-offline-results]");
let currentPng = null;
let createRevision = 0;
let scanRevision = 0;
let checking = false;
let verified = false;

const sdkPromise = import(asset("../sdk/qrgen.js")).then((sdk) => {
  sdk.configure({ readerWasmUrl: asset("../sdk/wasm/zxing_reader.wasm"), writerWasmUrl: asset("../sdk/wasm/zxing_writer.wasm"), worker: false });
  generateButton.disabled = false;
  imageInput.disabled = false;
  return sdk;
});
sdkPromise.catch(() => {
  status.dataset.state = "unavailable";
  status.textContent = "The local tools could not load. Reopen this page online and try again.";
});

function offlineState(state, text) {
  status.dataset.state = state;
  status.textContent = text;
}

function workerStatus(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error("Offline status timed out")); }, 5000);
    channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type: "QRGEN_OFFLINE_STATUS" }, [channel.port2]);
  });
}

async function checkOffline() {
  if (checking || verified) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller || new URL(controller.scriptURL).searchParams.get("v") !== version) return;
  checking = true;
  try {
    const report = await workerStatus(controller);
    if (!report.ready || report.version !== version) throw new Error("Saved files are incomplete");
    // Verify both engines in memory before declaring availability. The fixed test
    // content and generated image are never written to persistent storage.
    const sdk = await sdkPromise;
    const check = await sdk.generate("QRGEN OFFLINE CHECK", { symbology: "qr", scale: 3 });
    if (!check.png) throw new Error("PNG unavailable");
    const decoded = await sdk.scanImage(check.png, { symbologies: ["qr"] });
    if (decoded[0]?.data !== "QRGEN OFFLINE CHECK") throw new Error("Local engine check failed");
    verified = true;
    offlineState("ready", "Saved and checked for offline use in this browser. You can reload this page without internet.");
  } catch {
    offlineState("unavailable", "Offline use could not be confirmed. Keep this page online, reload and try again.");
  } finally { checking = false; }
}

async function saveOffline() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    offlineState("unavailable", "This browser cannot save these tools for offline use here. The tools still work while their files are available online.");
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => void checkOffline());
  try {
    await checkOffline();
    const workerUrl = new URL(asset("sw.js"));
    workerUrl.searchParams.set("hashes", JSON.stringify(assetHashes));
    const registration = await navigator.serviceWorker.register(workerUrl.href, { scope: scope.pathname, updateViaCache: "none" });
    const watch = (worker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "redundant" && !verified) offlineState("unavailable", "Offline saving did not finish. Reopen this page online and reload to retry.");
        if (worker.state === "installed" && navigator.serviceWorker.controller && !verified) {
          offlineState("update-pending", "An updated offline copy is saved. Close other offline-tool tabs and reopen this page online to finish updating.");
        }
        if (worker.state === "activated") void checkOffline();
      });
    };
    if (registration.installing) watch(registration.installing);
    if (registration.waiting && !verified) offlineState("update-pending", "An updated offline copy is saved. Close other offline-tool tabs and reopen this page online to finish updating.");
    registration.addEventListener("updatefound", () => { if (registration.installing) watch(registration.installing); });
    await checkOffline();
  } catch {
    if (!verified) offlineState("unavailable", "Offline saving did not finish. Reopen this page online and reload to retry.");
  }
}
void saveOffline();

function invalidateCode() {
  createRevision++;
  currentPng = null;
  downloadButton.disabled = true;
  preview.replaceChildren();
  createStatus.textContent = "";
  createError.hidden = true;
}
form.addEventListener("input", invalidateCode);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  invalidateCode();
  const revision = createRevision;
  generateButton.disabled = true;
  createStatus.textContent = "Making your code…";
  try {
    const sdk = await sdkPromise;
    const data = get("#offline-kind").value === "url" ? sdk.buildUrlPayload(content.value) : content.value;
    // Reuse the bounded planner's payload validation; choose a generous screen
    // canvas rather than expose print settings in this minimal offline example.
    const plan = await sdk.planQRCode(data, { widthMm: 100, dpi: 300, minDotsPerModule: 3, ecLevel: "M" });
    if (!plan.suitable) throw new Error(plan.diagnostics.find((item) => item.severity === "error")?.message ?? "The content is too large for a QR code.");
    if (revision !== createRevision) return;
    preview.innerHTML = plan.barcode.svg;
    const svg = preview.querySelector("svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code for the content you entered");
    currentPng = plan.barcode.png;
    downloadButton.disabled = !currentPng;
    createStatus.textContent = "Your code is ready. Keep the readable content beside it as another way to access it.";
  } catch (error) {
    if (revision !== createRevision) return;
    createStatus.textContent = "Your code could not be made.";
    createError.textContent = error instanceof Error ? error.message : String(error);
    createError.hidden = false;
  } finally { generateButton.disabled = false; }
});

downloadButton.addEventListener("click", () => {
  if (!currentPng) return;
  const url = URL.createObjectURL(currentPng);
  const link = document.createElement("a");
  link.href = url;
  link.download = "qrgen-offline.png";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

imageInput.addEventListener("change", async () => {
  const revision = ++scanRevision;
  results.hidden = true;
  results.textContent = "";
  scanError.hidden = true;
  const file = imageInput.files?.[0];
  if (!file) { scanStatus.textContent = ""; return; }
  scanStatus.textContent = "Reading the image on this device…";
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image up to 20 MB.");
    const sdk = await sdkPromise;
    const found = await sdk.scanImage(file, { maxResults: 20 });
    if (revision !== scanRevision) return;
    scanStatus.textContent = found.length ? `Read ${found.length} ${found.length === 1 ? "code" : "codes"}.` : "No code found. Try a clearer image with the complete code and its border.";
    results.textContent = found.map((code) => `${code.symbologyName}\n${code.data}`).join("\n\n");
    results.hidden = found.length === 0;
  } catch (error) {
    if (revision !== scanRevision) return;
    scanStatus.textContent = "The image could not be read.";
    scanError.textContent = error instanceof Error ? error.message : String(error);
    scanError.hidden = false;
  }
});
