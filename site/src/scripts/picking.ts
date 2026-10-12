import { scanImage, type BarcodeScanner } from "qrgen-sdk";
import "qrgen-sdk/elements";
import type { QRGenScannerElement } from "qrgen-sdk/elements";
import { typedGtin } from "../lib/gtin";
import { PickingSession, classifyPickingBarcodes, type PickingBarcode, type PickingObservation, type PickingTarget } from "../lib/picking";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const scanner = $<QRGenScannerElement>("#scanner");
const source = $<HTMLSelectElement>("#source-mode");
const imageFile = $<HTMLInputElement>("#image-file");
const session = new PickingSession();
let imageOperation = 0;
let suspended = false;
let interval: ReturnType<typeof setInterval> | null = null;
let owner: BarcodeScanner | null = null;
let stream: MediaStream | null = null;
let width = 0;
let height = 0;
let unbind: (() => void) | null = null;

function text(selector: string, value: string): void {
  const element = $(selector);
  if (element.textContent !== value) element.textContent = value;
}
function report(value: string, error = false): void {
  text("#picking-status", value);
  $("#picking-status").dataset.error = String(error);
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, value?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  return element;
}
function clearImage(): void {
  imageOperation++;
  $("#image-results").replaceChildren();
  text("#image-status", "");
  imageFile.value = "";
}
function clearObservations(): void {
  session.reset();
}
function retire(): void {
  clearImage();
  clearObservations();
  scanner.stop();
  scanner.clearSelection();
  refreshSource();
  render();
}

function targetStatus(target: PickingTarget | null): string {
  if (!target) return "Set a target barcode to begin.";
  const gtin = typedGtin(target.data);
  return gtin ? `Target set. Retail barcodes with product number ${gtin} match in any printed form, such as UPC-A or EAN-13.` : "Target set. Only this exact value matches, including spaces, line breaks, case and leading zeros.";
}
/** A match whose decoded value differs from the target matched by its GTIN; the value itself is shown as decoded. */
function productNote(target: PickingTarget, item: PickingBarcode): string {
  return item.data === target.data ? "" : " · same product number";
}

/** A selected snapshot is deliberately absent here: only current track events enter the model. */
function renderRows(selector: string, items: PickingObservation[], matching: boolean, target: PickingTarget | null = null): void {
  const list = $(selector);
  const wanted = new Set(items.map(item => String(item.id)));
  for (const child of [...list.children]) if (!wanted.has((child as HTMLElement).dataset.id!)) child.remove();
  const selected = new Set(scanner.selection.map(item => item.id));
  items.forEach((item, index) => {
    let row = [...list.children].find(child => (child as HTMLElement).dataset.id === String(item.id)) as HTMLLIElement | undefined;
    if (!row) {
      row = node("li"); row.dataset.id = String(item.id);
      row.append(node("code"), node("span"));
      if (matching) {
        const button = node("button", "Highlight");
        button.type = "button"; button.className = "btn btn-light btn-sm";
        button.setAttribute("aria-label", `Highlight matching observation ${item.id}`);
        button.onclick = () => { scanner.selectBarcode(item.id); render(); };
        row.append(button);
      }
    }
    row.dataset.code = item.data;
    row.querySelector("code")!.textContent = item.data;
    row.querySelector("span")!.textContent = `${item.symbologyName} · observation ${item.id}${matching && target ? productNote(target, item) : ""}`;
    row.querySelector("button")?.setAttribute("aria-pressed", String(selected.has(item.id)));
    // Keep an already-focused button in its existing DOM node between frames.
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
  });
}
function render(): void {
  const current = session.snapshot(performance.now());
  const camera = source.value === "camera";
  text("#target-value", current.target?.data ?? "No target set");
  text("#target-label", current.target?.name ?? "");
  text("#target-status", targetStatus(current.target));
  renderRows("#match-list", current.matches, true, current.target);
  renderRows("#other-list", current.others, false);
  text("#match-status", current.matches.length ? `${current.matches.length} recent matching ${current.matches.length === 1 ? "observation" : "observations"}.` : "No recent matching observations.");
  text("#other-status", current.others.length ? `${current.others.length} recent other ${current.others.length === 1 ? "observation" : "observations"}.` : "No recent other observations.");
  $("#camera-source").hidden = !camera;
  $("#image-source").hidden = camera;
  $("#camera-observations").hidden = !camera;
  $("#camera-gate").hidden = Boolean(current.target);
  $("#camera-stage").hidden = !current.target;
  $<HTMLButtonElement>("#stop-picking").disabled = suspended || !current.target;
  $<HTMLButtonElement>("#reset-picking").disabled = suspended || !current.target;
  $<HTMLButtonElement>("#clear-target").disabled = !current.target;
  imageFile.disabled = suspended || camera || !current.target;
}

/** Bind the public scanner source, including switches which emit no element state change. */
function refreshSource(): boolean {
  const next = scanner.scanner;
  let changed = next !== owner;
  if (changed) {
    unbind?.(); unbind = null;
    owner = next;
    if (next) {
      const spatialReset = () => {
        if (owner !== next || scanner.scanner !== next) return;
        width = next.video.videoWidth; height = next.video.videoHeight;
        if (source.value === "camera") { clearObservations(); render(); }
      };
      const sourceChanged = () => { if (refreshSource()) render(); };
      const off = next.on("spatialreset", spatialReset);
      next.video.addEventListener("emptied", sourceChanged);
      next.video.addEventListener("resize", sourceChanged);
      unbind = () => { off(); next.video.removeEventListener("emptied", sourceChanged); next.video.removeEventListener("resize", sourceChanged); };
    }
  }
  const nextStream = next?.camera.stream ?? null;
  const nextWidth = next?.video.videoWidth ?? 0;
  const nextHeight = next?.video.videoHeight ?? 0;
  changed ||= stream !== nextStream || width !== nextWidth || height !== nextHeight;
  stream = nextStream; width = nextWidth; height = nextHeight;
  if (changed && source.value === "camera") clearObservations();
  return changed;
}

// Enter sets the target; Shift+Enter keeps a line break for codes that contain one.
$<HTMLTextAreaElement>("#target-code").addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  $<HTMLFormElement>("#target-form").requestSubmit();
});
$("#target-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    session.setTarget($<HTMLTextAreaElement>("#target-code").value, $<HTMLInputElement>("#target-name").value);
    retire();
    report(source.value === "camera" ? "Target set. Press Start scanning and point the camera at the shelf." : "Target set. Choose an image to review.");
  } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
});
$("#clear-target").addEventListener("click", () => { session.clearTarget(); retire(); report("Target cleared."); });
$("#reset-picking").addEventListener("click", () => { retire(); report("Observations cleared. Start again when ready."); });
$("#stop-picking").addEventListener("click", () => { retire(); report("Stopped. Camera released and observations cleared."); });
source.addEventListener("change", () => { retire(); report(source.value === "camera" ? "Camera source selected. Start when ready." : "Still-image source selected. Choose an image to review."); });
$<HTMLSelectElement>("#camera-facing").addEventListener("change", event => {
  retire();
  scanner.camera = (event.target as HTMLSelectElement).value;
  report("Camera changed. Start when ready.");
});
scanner.addEventListener("track", event => {
  refreshSource();
  if (suspended || !session.target || source.value !== "camera" || scanner.scanner !== owner || owner?.state !== "scanning") return;
  const detail = (event as CustomEvent).detail;
  try { session.update(detail.tracked, performance.now()); render(); }
  catch (error) { clearObservations(); render(); report(error instanceof Error ? error.message : String(error), true); }
});
scanner.addEventListener("select", () => render());
scanner.addEventListener("statechange", event => {
  const state = (event as CustomEvent).detail.state;
  if ((state === "starting" || state === "scanning") && (suspended || document.hidden || !session.target || source.value !== "camera")) {
    scanner.stop();
    if (!session.target) report("Set a target barcode before starting the camera.");
    return;
  }
  if (state === "starting" || state === "stopped" || state === "error") clearObservations();
  if (state === "starting") report("Starting camera…");
  if (state === "scanning") report("Camera running. Matching observations appear below.");
  if (state === "paused") report("Camera paused. Recent observations expire while paused.");
  if (state === "stopped") report("Stopped. Camera released and observations cleared.");
  refreshSource(); render();
});
scanner.addEventListener("error", event => {
  if (!suspended && source.value === "camera" && session.target) report((event as unknown as CustomEvent).detail.message ?? "The camera could not be started.", true);
});
// Use the existing accessible UI name, without altering the scanner's controls.
scanner.addEventListener("click", event => {
  if (event.composedPath().some(part => part instanceof HTMLElement && part.getAttribute("aria-label") === "Switch camera")) {
    clearObservations(); render(); report("Switching camera…");
  }
  queueMicrotask(() => { if (!suspended && refreshSource()) render(); });
}, true);
const attributes = new MutationObserver(() => { clearObservations(); refreshSource(); render(); });
function observeAttributes(): void { attributes.observe(scanner, { attributes: true, attributeFilter: ["camera", "resolution", "worker", "mode", "symbologies"] }); }

imageFile.addEventListener("change", () => {
  const file = imageFile.files?.[0];
  const target = session.target;
  if (!file || !target || suspended || source.value !== "image") return;
  clearImage();
  const token = ++imageOperation;
  const generation = session.generation;
  const current = () => !suspended && token === imageOperation && generation === session.generation && source.value === "image";
  text("#image-status", "Reading this image…");
  void scanImage(file, { symbologies: "all", maxResults: 255 }).then(barcodes => {
    if (!current()) return;
    const result = classifyPickingBarcodes(target, barcodes);
    const rows: HTMLLIElement[] = [];
    for (const [matches, items] of [[true, result.matches], [false, result.others]] as [boolean, PickingBarcode[]][]) {
      for (const item of items) {
        const row = node("li"); row.dataset.code = item.data; row.dataset.match = String(matches);
        row.append(node("strong", matches ? "Target match" : "Other barcode"), node("code", item.data), node("span", `${item.symbologyName}${matches ? productNote(target, item) : ""}`)); rows.push(row);
      }
    }
    $("#image-results").replaceChildren(...rows);
    text("#image-status", `${result.matches.length} matching and ${result.others.length} other decoded results in this still image.`);
  }).catch(error => { if (current()) text("#image-status", error instanceof Error ? error.message : String(error)); });
});

function startTimer(): void {
  if (interval !== null) return;
  interval = setInterval(() => { refreshSource(); render(); }, 100);
}
window.addEventListener("pagehide", () => {
  suspended = true; retire(); unbind?.(); unbind = null; owner = null;
  attributes.disconnect();
  if (interval !== null) clearInterval(interval);
  interval = null;
});
window.addEventListener("pageshow", () => { suspended = false; observeAttributes(); refreshSource(); startTimer(); render(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { retire(); report("Camera stopped while this page is hidden."); } });
observeAttributes(); startTimer(); render();
